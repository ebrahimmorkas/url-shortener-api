import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';

/** Every error leaves the API as `{ error: { code, message, details? } }`. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.validation.map((v) => ({
            path: v.instancePath.replace(/^\//, '').replaceAll('/', '.'),
            message: v.message,
          })),
        },
      });
    }

    if (error.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: error.message } });
    }

    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        error: { code: error.code ?? 'BAD_REQUEST', message: error.message },
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
    });
  });
}
