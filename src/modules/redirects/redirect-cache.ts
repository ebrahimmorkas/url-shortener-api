import type { Redis } from 'ioredis';

/** What the redirect hot path needs to know about a code (or that it doesn't exist). */
export type CachedLink =
  | {
      found: true;
      linkId: string;
      targetUrl: string;
      isActive: boolean;
      expiresAt: string | null;
    }
  | { found: false };

export interface RedirectCache {
  get(code: string): Promise<CachedLink | null>;
  set(code: string, entry: CachedLink, ttlSeconds: number): Promise<void>;
  delete(code: string): Promise<void>;
}

/** Bounded LRU with per-entry TTL (Map preserves insertion order). */
export class MemoryRedirectCache implements RedirectCache {
  private readonly entries = new Map<string, { value: CachedLink; expiresAt: number }>();

  constructor(private readonly maxEntries = 10_000) {}

  async get(code: string) {
    const entry = this.entries.get(code);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(code);
      return null;
    }
    // Refresh recency.
    this.entries.delete(code);
    this.entries.set(code, entry);
    return entry.value;
  }

  async set(code: string, value: CachedLink, ttlSeconds: number) {
    this.entries.delete(code);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(code, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(code: string) {
    this.entries.delete(code);
  }
}

/** Shared cache for multiple API instances. Failures degrade to cache misses. */
export class RedisRedirectCache implements RedirectCache {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'shortener:link:',
  ) {}

  async get(code: string) {
    const raw = await this.redis.get(this.prefix + code).catch(() => null);
    return raw ? (JSON.parse(raw) as CachedLink) : null;
  }

  async set(code: string, value: CachedLink, ttlSeconds: number) {
    await this.redis
      .set(this.prefix + code, JSON.stringify(value), 'EX', ttlSeconds)
      .catch(() => undefined);
  }

  async delete(code: string) {
    await this.redis.del(this.prefix + code).catch(() => undefined);
  }
}
