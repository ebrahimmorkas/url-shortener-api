import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { links } from '../../db/schema.js';
import { Gone, NotFound } from '../../lib/errors.js';
import type { CachedLink } from './redirect-cache.js';
import { parseUserAgent, referrerHost, visitorHash } from './visitor.js';

const CODE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const NEGATIVE_CACHE_TTL_SECONDS = 30;

/** Two-letter country code set by the CDN/edge (Cloudflare or a custom proxy), if any. */
function countryFrom(headers: Record<string, string | string[] | undefined>) {
  const value = headers['cf-ipcountry'] ?? headers['x-country-code'];
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null;
}

/**
 * The hot path: `GET /:code` → 302. One cache lookup (Redis or in-process
 * LRU) in the common case, no database write: the click is queued and
 * persisted in batches.
 */
export const redirectRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, cache, clicks, config } = app.ctx;

  async function resolve(code: string): Promise<(CachedLink & { found: true }) | null> {
    const cached = await cache.get(code);
    if (cached) return cached.found ? cached : null;

    const link = await db.query.links.findFirst({ where: eq(links.code, code) });
    if (!link) {
      // Negative caching protects the database from floods of unknown codes.
      await cache.set(code, { found: false }, NEGATIVE_CACHE_TTL_SECONDS);
      return null;
    }
    if (link.maxClicks !== null && link.clickCount >= link.maxClicks) {
      throw Gone('This link has reached its click limit');
    }

    const entry = {
      found: true as const,
      linkId: link.id,
      targetUrl: link.targetUrl,
      isActive: link.isActive,
      expiresAt: link.expiresAt?.toISOString() ?? null,
    };
    // Click-capped links need a fresh counter on every hit, so they aren't cached.
    if (link.maxClicks === null) await cache.set(code, entry, config.REDIRECT_CACHE_TTL_SECONDS);
    return entry;
  }

  app.get(
    '/:code',
    { schema: { hide: true, params: z.object({ code: z.string() }) } },
    async (request, reply) => {
      const { code } = request.params;
      if (!CODE_PATTERN.test(code)) throw NotFound('Short link');

      const link = await resolve(code);
      if (!link) throw NotFound('Short link');
      if (!link.isActive) throw Gone('This link has been disabled');
      if (link.expiresAt && new Date(link.expiresAt) <= new Date()) {
        throw Gone('This link has expired');
      }

      // HEAD requests (link previews, uptime checks) are not counted as clicks.
      if (request.method === 'GET') {
        const userAgent = request.headers['user-agent'];
        const now = new Date();
        clicks.enqueue({
          linkId: link.linkId,
          clickedAt: now.toISOString(),
          referrerHost: referrerHost(request.headers.referer),
          country: countryFrom(request.headers),
          ...parseUserAgent(userAgent),
          visitorHash: visitorHash(request.ip, userAgent, config.JWT_SECRET, now),
        });
      }

      // 302 (not 301) so browsers don't cache the redirect and every visit is counted.
      return reply.header('cache-control', 'private, no-store').redirect(link.targetUrl, 302);
    },
  );
};
