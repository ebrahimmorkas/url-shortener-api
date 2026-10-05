import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/**
 * OpenAPI 3 document generated from the same Zod schemas that validate the
 * routes, so the docs cannot drift from the implementation. Swagger UI is
 * served at /docs and the raw document at /docs/json.
 */
export async function registerDocs(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'URL Shortener API',
        description:
          'Short links with expiry, click caps, QR codes and click analytics. ' +
          'Authenticate with a JWT from `/api/v1/auth/login` or with an API key in `X-API-Key`.',
        version: '1.0.0',
      },
      servers: [{ url: app.ctx.config.BASE_URL }],
      tags: [
        { name: 'auth', description: 'Accounts and API keys' },
        { name: 'links', description: 'Create and manage short links' },
        { name: 'analytics', description: 'Click statistics' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
}
