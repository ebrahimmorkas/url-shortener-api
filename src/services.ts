import type { FastifyBaseLogger } from 'fastify';
import { Redis } from 'ioredis';
import type { Config } from './config/env.js';
import type { Database } from './db/client.js';
import {
  BullMqClickQueue,
  MemoryClickQueue,
  type ClickQueue,
} from './modules/redirects/click-queue.js';
import {
  MemoryRedirectCache,
  RedisRedirectCache,
  type RedirectCache,
} from './modules/redirects/redirect-cache.js';

/** Chooses Redis-backed or in-process implementations based on configuration. */
export function createServices(
  config: Config,
  db: Database,
  redis: Redis | null,
  logger: FastifyBaseLogger,
): { cache: RedirectCache; clicks: ClickQueue } {
  if (redis) {
    return {
      cache: new RedisRedirectCache(redis),
      clicks: new BullMqClickQueue(
        db,
        // BullMQ workers need dedicated (blocking) connections.
        () => new Redis(config.REDIS_URL, { maxRetriesPerRequest: null }),
        logger,
        config.CLICK_FLUSH_INTERVAL_MS,
        config.CLICK_BATCH_SIZE,
      ),
    };
  }
  return {
    cache: new MemoryRedirectCache(),
    clicks: new MemoryClickQueue(
      db,
      logger,
      config.CLICK_FLUSH_INTERVAL_MS,
      config.CLICK_BATCH_SIZE,
    ),
  };
}
