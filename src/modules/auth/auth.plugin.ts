import { createHash } from 'node:crypto';
import jwt from '@fastify/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { apiKeys, users } from '../../db/schema.js';
import { Unauthorized } from '../../lib/errors.js';

export interface AuthUser {
  id: string;
  email: string;
  via: 'jwt' | 'api_key';
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: AuthUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

export const API_KEY_HEADER = 'x-api-key';
export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * Registers JWT support and an `authenticate` preHandler that accepts either
 * `Authorization: Bearer <jwt>` (dashboard users) or `X-API-Key` (scripts and
 * integrations). Registered on the root instance so every route can use it.
 */
export async function registerAuth(app: FastifyInstance) {
  await app.register(jwt, {
    secret: app.ctx.config.JWT_SECRET,
    sign: { expiresIn: '1d' },
    formatUser: (payload) => ({ id: payload.sub, email: payload.email, via: 'jwt' as const }),
  });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    const apiKey = request.headers[API_KEY_HEADER];
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      const { db } = app.ctx;
      const [row] = await db
        .select({ id: apiKeys.id, userId: apiKeys.userId, email: users.email })
        .from(apiKeys)
        .innerJoin(users, eq(users.id, apiKeys.userId))
        .where(and(eq(apiKeys.keyHash, hashApiKey(apiKey)), isNull(apiKeys.revokedAt)))
        .limit(1);
      if (!row) throw Unauthorized('Invalid API key');
      request.user = { id: row.userId, email: row.email, via: 'api_key' };
      // Fire-and-forget: usage tracking must not slow the request down.
      void db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, row.id))
        .catch((err) => request.log.warn({ err }, 'failed to record API key usage'));
      return;
    }

    try {
      await request.jwtVerify();
    } catch {
      throw Unauthorized('Missing or invalid credentials');
    }
  });
}
