import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { apiKeys, users } from '../../db/schema.js';
import { Conflict, NotFound, Unauthorized } from '../../lib/errors.js';
import { hashApiKey } from './auth.plugin.js';

const BCRYPT_ROUNDS = 12;

const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  createdAt: z.date(),
});
const authResponse = z.object({ user: userSchema, token: z.string() });
const errorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

const email = z.string().trim().toLowerCase().pipe(z.email());
const password = z
  .string()
  .min(8)
  .max(72)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

const apiKeySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  lastUsedAt: z.date().nullable(),
  createdAt: z.date(),
});

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.ctx;
  const publicUser = (u: typeof users.$inferSelect) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt,
  });

  app.post(
    '/auth/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Create an account',
        body: z.object({ email, name: z.string().trim().min(2).max(100), password }),
        response: { 201: authResponse, 400: errorResponse, 409: errorResponse },
      },
    },
    async (request, reply) => {
      const { email: address, name, password: plain } = request.body;
      const existing = await db.query.users.findFirst({ where: eq(users.email, address) });
      if (existing) throw Conflict('Email is already registered', 'EMAIL_TAKEN');

      const [user] = await db
        .insert(users)
        .values({ email: address, name, passwordHash: await bcrypt.hash(plain, BCRYPT_ROUNDS) })
        .returning();
      const token = app.jwt.sign({ sub: user!.id, email: user!.email });
      return reply.status(201).send({ user: publicUser(user!), token });
    },
  );

  app.post(
    '/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Log in and receive a JWT',
        body: z.object({ email, password: z.string().min(1) }),
        response: { 200: authResponse, 401: errorResponse },
      },
    },
    async (request) => {
      const user = await db.query.users.findFirst({ where: eq(users.email, request.body.email) });
      if (!user || !(await bcrypt.compare(request.body.password, user.passwordHash))) {
        throw Unauthorized('Invalid email or password');
      }
      return { user: publicUser(user), token: app.jwt.sign({ sub: user.id, email: user.email }) };
    },
  );

  app.get(
    '/auth/me',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['auth'],
        security: [{ bearerAuth: [] }, { apiKey: [] }],
        response: { 200: z.object({ user: userSchema }), 401: errorResponse },
      },
    },
    async (request) => {
      const user = await db.query.users.findFirst({ where: eq(users.id, request.user.id) });
      if (!user) throw NotFound('User');
      return { user: publicUser(user) };
    },
  );

  app.post(
    '/api-keys',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['api-keys'],
        summary: 'Create an API key (the secret is shown only once)',
        security: [{ bearerAuth: [] }],
        body: z.object({ name: z.string().trim().min(1).max(100) }),
        response: { 201: z.object({ apiKey: apiKeySchema, secret: z.string() }) },
      },
    },
    async (request, reply) => {
      const secret = `sk_${randomBytes(24).toString('base64url')}`;
      const [key] = await db
        .insert(apiKeys)
        .values({
          userId: request.user.id,
          name: request.body.name,
          prefix: secret.slice(0, 10),
          keyHash: hashApiKey(secret),
        })
        .returning();
      return reply.status(201).send({
        apiKey: {
          id: key!.id,
          name: key!.name,
          prefix: key!.prefix,
          lastUsedAt: key!.lastUsedAt,
          createdAt: key!.createdAt,
        },
        secret,
      });
    },
  );

  app.get(
    '/api-keys',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['api-keys'],
        security: [{ bearerAuth: [] }],
        response: { 200: z.object({ data: z.array(apiKeySchema) }) },
      },
    },
    async (request) => {
      const data = await db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
          lastUsedAt: apiKeys.lastUsedAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, request.user.id), isNull(apiKeys.revokedAt)))
        .orderBy(desc(apiKeys.createdAt));
      return { data };
    },
  );

  app.delete(
    '/api-keys/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['api-keys'],
        summary: 'Revoke an API key',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.uuid() }),
        response: { 204: z.null(), 404: errorResponse },
      },
    },
    async (request, reply) => {
      const revoked = await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiKeys.id, request.params.id),
            eq(apiKeys.userId, request.user.id),
            isNull(apiKeys.revokedAt),
          ),
        )
        .returning({ id: apiKeys.id });
      if (revoked.length === 0) throw NotFound('API key');
      return reply.status(204).send(null);
    },
  );
};
