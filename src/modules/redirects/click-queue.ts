import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../../db/client.js';
import { writeClicks, type ClickEvent } from './click-writer.js';

/**
 * Click ingestion, decoupled from the redirect response. Redirects only
 * `enqueue()` (in-memory, O(1)); a micro-buffer is flushed every
 * `flushIntervalMs` or when `batchSize` clicks are waiting.
 */
export interface ClickQueue {
  readonly backend: 'memory' | 'bullmq';
  enqueue(click: ClickEvent): void;
  /** Flushes everything buffered locally (and, for tests, waits until persisted). */
  flush(): Promise<void>;
  start(): Promise<void>;
  close(): Promise<void>;
}

abstract class BufferedClickQueue implements ClickQueue {
  abstract readonly backend: 'memory' | 'bullmq';
  protected buffer: ClickEvent[] = [];
  private timer?: NodeJS.Timeout;
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    protected readonly logger: FastifyBaseLogger,
    private readonly flushIntervalMs: number,
    private readonly batchSize: number,
  ) {}

  protected abstract deliver(batch: ClickEvent[]): Promise<void>;

  enqueue(click: ClickEvent) {
    this.buffer.push(click);
    if (this.buffer.length >= this.batchSize) void this.flush();
  }

  flush(): Promise<void> {
    // Serialise flushes so batches are delivered in order and never concurrently.
    this.flushing = this.flushing.then(async () => {
      while (this.buffer.length > 0) {
        const batch = this.buffer.splice(0, this.batchSize);
        try {
          await this.deliver(batch);
        } catch (err) {
          this.logger.error(
            { err, size: batch.length },
            'click batch delivery failed; re-buffering',
          );
          this.buffer.unshift(...batch);
          return;
        }
      }
    });
    return this.flushing;
  }

  async start() {
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.timer.unref();
  }

  async close() {
    clearInterval(this.timer);
    await this.flush();
  }
}

/** No Redis: batches are written straight to PostgreSQL by this process. */
export class MemoryClickQueue extends BufferedClickQueue {
  readonly backend = 'memory' as const;

  constructor(
    private readonly db: Database,
    logger: FastifyBaseLogger,
    flushIntervalMs: number,
    batchSize: number,
  ) {
    super(logger, flushIntervalMs, batchSize);
  }

  protected deliver(batch: ClickEvent[]) {
    return writeClicks(this.db, batch);
  }
}

/**
 * With Redis: batches become durable BullMQ jobs, processed by a worker (in
 * this or any other instance) with retries, so a DB hiccup never loses clicks
 * and redirects stay fast under write load.
 */
export class BullMqClickQueue extends BufferedClickQueue {
  readonly backend = 'bullmq' as const;
  private static readonly NAME = 'click-batches';
  private readonly queue: Queue;
  private worker?: Worker;

  constructor(
    private readonly db: Database,
    private readonly redisFactory: () => Redis,
    logger: FastifyBaseLogger,
    flushIntervalMs: number,
    batchSize: number,
  ) {
    super(logger, flushIntervalMs, batchSize);
    this.queue = new Queue(BullMqClickQueue.NAME, {
      connection: redisFactory(),
      defaultJobOptions: {
        attempts: 8,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 10_000,
      },
    });
  }

  protected async deliver(batch: ClickEvent[]) {
    await this.queue.add('batch', { clicks: batch });
  }

  override async start() {
    this.worker = new Worker(
      BullMqClickQueue.NAME,
      async (job) => writeClicks(this.db, (job.data as { clicks: ClickEvent[] }).clicks),
      { connection: this.redisFactory(), concurrency: 2 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error({ err, jobId: job?.id }, 'click batch job failed'),
    );
    await super.start();
  }

  override async flush() {
    await super.flush();
    // Wait until the worker has drained what we enqueued (keeps tests deterministic).
    for (let i = 0; i < 200; i++) {
      const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed');
      if ((counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) === 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  override async close() {
    await super.close();
    await this.worker?.close();
    await this.queue.close();
  }
}
