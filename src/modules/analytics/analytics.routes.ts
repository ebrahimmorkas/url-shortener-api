import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { LinksService } from '../links/links.service.js';
import { AnalyticsService, validateRange } from './analytics.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const rangeQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  interval: z.enum(['hour', 'day']).default('day'),
});

const breakdownItem = z.object({ value: z.string(), clicks: z.number().int() });
const errorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

export const analyticsRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, config } = app.ctx;
  const analytics = new AnalyticsService(db);
  const linksService = new LinksService(db, config.BASE_URL);
  const security: Record<string, string[]>[] = [{ bearerAuth: [] }, { apiKey: [] }];

  app.addHook('onRequest', app.authenticate);

  /** Defaults: last 30 days by day, or last 24 hours by hour. */
  const resolveRange = (query: z.infer<typeof rangeQuery>) => {
    const to = query.to ?? new Date();
    const span = query.interval === 'hour' ? DAY_MS : 30 * DAY_MS;
    const range = {
      from: query.from ?? new Date(to.getTime() - span),
      to,
      interval: query.interval,
    };
    validateRange(range);
    return range;
  };

  app.get(
    '/links/:id/stats',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Click analytics for one link',
        security,
        params: z.object({ id: z.uuid() }),
        querystring: rangeQuery,
        response: {
          200: z.object({
            link: z.object({ id: z.uuid(), code: z.string(), totalClicks: z.number().int() }),
            range: z.object({ from: z.date(), to: z.date(), interval: z.enum(['hour', 'day']) }),
            totals: z.object({ clicks: z.number().int(), uniqueVisitors: z.number().int() }),
            timeseries: z.array(
              z.object({
                bucket: z.date(),
                clicks: z.number().int(),
                uniqueVisitors: z.number().int(),
              }),
            ),
            referrers: z.array(breakdownItem),
            browsers: z.array(breakdownItem),
            os: z.array(breakdownItem),
            devices: z.array(breakdownItem),
            countries: z.array(breakdownItem),
          }),
          400: errorResponse,
          404: errorResponse,
        },
      },
    },
    async (request) => {
      const link = await linksService.getOwned(request.user.id, request.params.id);
      const range = resolveRange(request.query);
      const stats = await analytics.linkStats(link.id, range);
      return {
        link: { id: link.id, code: link.code, totalClicks: link.clickCount },
        range,
        ...stats,
      };
    },
  );

  app.get(
    '/analytics/overview',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Account-wide totals and top links',
        security,
        querystring: rangeQuery.omit({ interval: true }),
        response: {
          200: z.object({
            range: z.object({ from: z.date(), to: z.date() }),
            totals: z.object({
              links: z.number().int(),
              clicks: z.number().int(),
              uniqueVisitors: z.number().int(),
            }),
            topLinks: z.array(
              z.object({
                id: z.uuid(),
                code: z.string(),
                title: z.string().nullable(),
                clicks: z.number().int(),
              }),
            ),
          }),
          400: errorResponse,
        },
      },
    },
    async (request) => {
      const { from, to } = resolveRange({ ...request.query, interval: 'day' });
      const overview = await analytics.overview(request.user.id, { from, to });
      return { range: { from, to }, ...overview };
    },
  );
};
