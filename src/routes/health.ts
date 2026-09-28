import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/health', { schema: { hide: true } }, async (_request, reply) => {
    const { db, redis } = app.ctx;
    const database = await db
      .execute(sql`select 1`)
      .then(() => 'up')
      .catch(() => 'down');
    const cache = redis
      ? await redis
          .ping()
          .then(() => 'up')
          .catch(() => 'down')
      : 'disabled';

    const healthy = database === 'up' && cache !== 'down';
    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      uptime: Math.round(process.uptime()),
      services: { database, redis: cache },
    });
  });
};
