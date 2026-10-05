import { createHash } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

/** Per-route overrides, used as `config: { rateLimit: authLimit(app) }`. */
export const authLimit = (app: FastifyInstance) => ({
  max: app.ctx.config.AUTH_RATE_LIMIT_MAX,
  timeWindow: '1 minute',
});

export const redirectLimit = (app: FastifyInstance) => ({
  max: app.ctx.config.REDIRECT_RATE_LIMIT_MAX,
  timeWindow: '1 minute',
});

/**
 * Rate limiting for the whole API. Counters live in Redis when it is enabled,
 * so limits hold across instances; otherwise each process keeps its own.
 *
 * Callers are identified by API key when they send one (integrations often
 * share an IP) and by IP address otherwise. The key is hashed so the secret
 * never ends up in Redis.
 */
export async function registerRateLimit(app: FastifyInstance) {
  const { config, redis } = app.ctx;
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    redis: redis ?? undefined,
    nameSpace: 'ratelimit:',
    // If Redis is briefly unavailable, serving traffic matters more than counting it.
    skipOnError: true,
    allowList: (request) => request.url === '/health',
    keyGenerator: (request) => {
      const apiKey = request.headers['x-api-key'];
      return typeof apiKey === 'string' && apiKey.length > 0
        ? `key:${createHash('sha256').update(apiKey).digest('hex').slice(0, 32)}`
        : `ip:${request.ip}`;
    },
  });
}
