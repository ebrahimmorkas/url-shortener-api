import type { Redis } from 'ioredis';
import type { Config } from './config/env.js';
import type { Database } from './db/client.js';
import type { ClickQueue } from './modules/redirects/click-queue.js';
import type { RedirectCache } from './modules/redirects/redirect-cache.js';

/** Infrastructure created by the caller (server or tests). */
export interface BaseContext {
  config: Config;
  db: Database;
  redis: Redis | null;
}

/**
 * Everything a route needs, injected into the Fastify instance. Cache and
 * click queue are created by `buildApp` (Redis-backed or in-process).
 */
export interface AppContext extends BaseContext {
  cache: RedirectCache;
  clicks: ClickQueue;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
