import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppContext, BaseContext } from './context.js';
import { analyticsRoutes } from './modules/analytics/analytics.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { linksRoutes } from './modules/links/links.routes.js';
import { registerAuth } from './modules/auth/auth.plugin.js';
import { redirectRoutes } from './modules/redirects/redirect.routes.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { createServices } from './services.js';

export async function buildApp(base: BaseContext) {
  const { config } = base;
  const app = Fastify({
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
      ...(config.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } },
      }),
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const ctx: AppContext = { ...base, ...createServices(config, base.db, base.redis, app.log) };
  app.decorate('ctx', ctx);
  app.addHook('onReady', () => ctx.clicks.start());
  // Flush buffered clicks before shutting down so none are lost.
  app.addHook('onClose', () => ctx.clicks.close());
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(','),
  });
  registerErrorHandler(app);

  await registerAuth(app);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(linksRoutes, { prefix: '/api/v1' });
  await app.register(analyticsRoutes, { prefix: '/api/v1' });
  // Registered last: the catch-all short-code route.
  await app.register(redirectRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
