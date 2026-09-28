import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clicks, links } from '../src/db/schema.js';
import { MemoryRedirectCache } from '../src/modules/redirects/redirect-cache.js';
import { parseUserAgent, visitorHash } from '../src/modules/redirects/visitor.js';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

describe('redirects and click ingestion', () => {
  let t: TestApp;
  let auth: { authorization: string };

  const shorten = async (payload: object) =>
    (await t.app.inject({ method: 'POST', url: '/api/v1/links', headers: auth, payload })).json()
      .link;

  const visit = (
    code: string,
    headers: Record<string, string> = {},
    method: 'GET' | 'HEAD' = 'GET',
  ) => t.app.inject({ method, url: `/${code}`, headers: { 'user-agent': CHROME_WIN, ...headers } });

  const clicksFor = (linkId: string) =>
    t.app.ctx.db.select().from(clicks).where(eq(clicks.linkId, linkId));

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t);
    const reg = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'r@example.com', name: 'Redirector', password: 'Password123' },
    });
    auth = { authorization: `Bearer ${reg.json().token}` };
  });
  afterAll(() => t.close());

  it('redirects with 302 and records the click asynchronously', async () => {
    const link = await shorten({ targetUrl: 'https://example.com/landing' });
    const res = await visit(link.code, {
      'user-agent': IPHONE,
      referer: 'https://news.ycombinator.com/item?id=1',
      'cf-ipcountry': 'in',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://example.com/landing');
    expect(res.headers['cache-control']).toBe('private, no-store');

    await t.app.ctx.clicks.flush();
    const [click] = await clicksFor(link.id);
    expect(click).toMatchObject({
      referrerHost: 'news.ycombinator.com',
      country: 'IN',
      browser: 'Safari',
      os: 'iOS',
      device: 'mobile',
    });
    expect(click!.visitorHash).toMatch(/^[0-9a-f]{64}$/);

    const [stored] = await t.app.ctx.db.select().from(links).where(eq(links.id, link.id));
    expect(stored!.clickCount).toBe(1);
  });

  it('batches many clicks into few writes and keeps the counter exact', async () => {
    const link = await shorten({ targetUrl: 'https://example.com' });
    await Promise.all(Array.from({ length: 50 }, () => visit(link.code)));
    await t.app.ctx.clicks.flush();
    expect(await clicksFor(link.id)).toHaveLength(50);
    const [stored] = await t.app.ctx.db.select().from(links).where(eq(links.id, link.id));
    expect(stored!.clickCount).toBe(50);
  });

  it('does not count HEAD requests', async () => {
    const link = await shorten({ targetUrl: 'https://example.com' });
    const head = await visit(link.code, {}, 'HEAD');
    expect(head.statusCode).toBe(302);
    await t.app.ctx.clicks.flush();
    expect(await clicksFor(link.id)).toHaveLength(0);
  });

  it('returns 404 for unknown codes and 410 for disabled or expired links', async () => {
    expect((await visit('doesNotExist')).statusCode).toBe(404);
    expect((await visit('bad.code!')).statusCode).toBe(404);

    const link = await shorten({ targetUrl: 'https://example.com' });
    await visit(link.code); // warm the cache
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/links/${link.id}`,
      headers: auth,
      payload: { isActive: false },
    });
    // The update invalidated the cached entry.
    expect((await visit(link.code)).statusCode).toBe(410);

    const expiring = await shorten({ targetUrl: 'https://example.com' });
    await t.app.ctx.db
      .update(links)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(links.id, expiring.id));
    const res = await visit(expiring.code);
    expect(res.statusCode).toBe(410);
    expect(res.json().error.message).toMatch(/expired/);
  });

  it('serves the new destination right after an update', async () => {
    const link = await shorten({ targetUrl: 'https://old.example.com' });
    expect((await visit(link.code)).headers.location).toBe('https://old.example.com/');
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/links/${link.id}`,
      headers: auth,
      payload: { targetUrl: 'https://new.example.com' },
    });
    expect((await visit(link.code)).headers.location).toBe('https://new.example.com/');
  });

  it('stops redirecting once the click cap is reached', async () => {
    const link = await shorten({ targetUrl: 'https://example.com', maxClicks: 2 });
    expect((await visit(link.code)).statusCode).toBe(302);
    expect((await visit(link.code)).statusCode).toBe(302);
    await t.app.ctx.clicks.flush();
    const capped = await visit(link.code);
    expect(capped.statusCode).toBe(410);
    expect(capped.json().error.message).toMatch(/click limit/);
  });

  it('drops clicks for links deleted before ingestion', async () => {
    const link = await shorten({ targetUrl: 'https://example.com' });
    await visit(link.code);
    await t.app.inject({ method: 'DELETE', url: `/api/v1/links/${link.id}`, headers: auth });
    await expect(t.app.ctx.clicks.flush()).resolves.toBeUndefined();
    expect((await visit(link.code)).statusCode).toBe(404);
  });
});

describe('visitor helpers', () => {
  it('classifies user agents and bots', () => {
    expect(parseUserAgent(CHROME_WIN)).toEqual({
      browser: 'Chrome',
      os: 'Windows',
      device: 'desktop',
    });
    expect(parseUserAgent('Twitterbot/1.0').device).toBe('bot');
    expect(parseUserAgent(undefined).device).toBe('unknown');
  });

  it('rotates the visitor hash daily and never contains the IP', () => {
    const day1 = visitorHash('203.0.113.9', CHROME_WIN, 'salt', new Date('2026-01-01T10:00:00Z'));
    const sameDay = visitorHash(
      '203.0.113.9',
      CHROME_WIN,
      'salt',
      new Date('2026-01-01T23:00:00Z'),
    );
    const day2 = visitorHash('203.0.113.9', CHROME_WIN, 'salt', new Date('2026-01-02T10:00:00Z'));
    expect(day1).toBe(sameDay);
    expect(day1).not.toBe(day2);
    expect(day1).not.toContain('203');
  });
});

describe('MemoryRedirectCache', () => {
  it('expires entries and evicts the least recently used', async () => {
    const cache = new MemoryRedirectCache(2);
    await cache.set('a', { found: false }, 60);
    await cache.set('b', { found: false }, 60);
    await cache.get('a'); // a is now most recent
    await cache.set('c', { found: false }, 60);
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('a')).toEqual({ found: false });

    await cache.set('short', { found: false }, 0);
    expect(await cache.get('short')).toBeNull();
  });
});
