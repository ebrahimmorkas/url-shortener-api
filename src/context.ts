import type { Redis } from 'ioredis';
import type { Config } from './config/env.js';
import type { Database } from './db/client.js';

/**
 * Everything a route needs, created once at startup and injected into the
 * Fastify instance. Tests build their own context with isolated resources.
 */
export interface AppContext {
  config: Config;
  db: Database;
  redis: Redis | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
