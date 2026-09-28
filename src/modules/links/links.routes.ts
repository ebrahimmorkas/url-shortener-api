import QRCode from 'qrcode';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ALIAS_PATTERN } from './codes.js';
import { LinksService, serializeLink } from './links.service.js';

const linkSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  shortUrl: z.string(),
  targetUrl: z.string(),
  title: z.string().nullable(),
  expiresAt: z.date().nullable(),
  maxClicks: z.number().int().nullable(),
  clickCount: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
const errorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

const targetUrl = z.url({ protocol: /^https?$/, normalize: true }).max(2048);
const futureDate = z.coerce
  .date()
  .refine((d) => d.getTime() > Date.now(), 'expiresAt must be in the future');

const createBody = z.object({
  targetUrl,
  alias: z.string().regex(ALIAS_PATTERN, '3-32 characters: letters, digits, "-" or "_"').optional(),
  title: z.string().trim().min(1).max(200).optional(),
  expiresAt: futureDate.optional(),
  maxClicks: z.number().int().positive().max(10_000_000).optional(),
});

const updateBody = z
  .object({
    targetUrl,
    title: z.string().trim().min(1).max(200),
    expiresAt: futureDate,
    maxClicks: z.number().int().positive().max(10_000_000),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const idParams = z.object({ id: z.uuid() });

export const linksRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, config, cache } = app.ctx;
  const service = new LinksService(db, config.BASE_URL);
  const toDto = (link: Parameters<typeof serializeLink>[0]) => serializeLink(link, config.BASE_URL);
  const security: Record<string, string[]>[] = [{ bearerAuth: [] }, { apiKey: [] }];

  app.addHook('onRequest', app.authenticate);

  app.post(
    '/links',
    {
      schema: {
        tags: ['links'],
        summary: 'Shorten a URL',
        security,
        body: createBody,
        response: { 201: z.object({ link: linkSchema }), 400: errorResponse, 409: errorResponse },
      },
    },
    async (request, reply) => {
      const link = await service.create(request.user.id, request.body);
      return reply.status(201).send({ link: toDto(link) });
    },
  );

  app.get(
    '/links',
    {
      schema: {
        tags: ['links'],
        summary: 'List my links (newest first, cursor pagination)',
        security,
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
          cursor: z.string().optional(),
          search: z.string().trim().min(1).max(100).optional(),
        }),
        response: {
          200: z.object({ data: z.array(linkSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const page = await service.list(request.user.id, request.query);
      return { data: page.data.map(toDto), nextCursor: page.nextCursor };
    },
  );

  app.get(
    '/links/:id',
    {
      schema: {
        tags: ['links'],
        security,
        params: idParams,
        response: { 200: z.object({ link: linkSchema }), 404: errorResponse },
      },
    },
    async (request) => ({
      link: toDto(await service.getOwned(request.user.id, request.params.id)),
    }),
  );

  app.patch(
    '/links/:id',
    {
      schema: {
        tags: ['links'],
        summary: 'Update the destination, title, limits or disable a link',
        security,
        params: idParams,
        body: updateBody,
        response: { 200: z.object({ link: linkSchema }), 400: errorResponse, 404: errorResponse },
      },
    },
    async (request) => {
      const link = await service.update(request.user.id, request.params.id, request.body);
      // Redirects must see the new destination/state immediately.
      await cache.delete(link.code);
      return { link: toDto(link) };
    },
  );

  app.delete(
    '/links/:id',
    {
      schema: {
        tags: ['links'],
        security,
        params: idParams,
        response: { 204: z.null(), 404: errorResponse },
      },
    },
    async (request, reply) => {
      const link = await service.delete(request.user.id, request.params.id);
      await cache.delete(link.code);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/links/:id/qr',
    {
      schema: {
        tags: ['links'],
        summary: 'QR code (PNG) for the short URL',
        security,
        params: idParams,
        querystring: z.object({ size: z.coerce.number().int().min(64).max(1024).default(256) }),
      },
    },
    async (request, reply) => {
      const link = await service.getOwned(request.user.id, request.params.id);
      const png = await QRCode.toBuffer(toDto(link).shortUrl, {
        width: request.query.size,
        margin: 1,
      });
      return reply.type('image/png').header('cache-control', 'private, max-age=3600').send(png);
    },
  );
};
