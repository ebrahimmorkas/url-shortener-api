import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clicks } from '../src/db/schema.js';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

describe('analytics', () => {
  let t: TestApp;
  let auth: { authorization: string };
  let linkId: string;

  const click = (
    clickedAt: string,
    extra: Partial<typeof clicks.$inferInsert> = {},
  ): typeof clicks.$inferInsert => ({
    linkId,
    clickedAt: new Date(clickedAt),
    visitorHash: 'a'.repeat(64),
    device: 'desktop',
    ...extra,
  });

  const stats = (query: string) =>
    t.app.inject({ method: 'GET', url: `/api/v1/links/${linkId}/stats?${query}`, headers: auth });

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t);
    const reg = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'stats@example.com', name: 'Stats', password: 'Password123' },
    });
    auth = { authorization: `Bearer ${reg.json().token}` };
    const link = await t.app.inject({
      method: 'POST',
      url: '/api/v1/links',
      headers: auth,
      payload: { targetUrl: 'https://example.com', title: 'Launch' },
    });
    linkId = link.json().link.id;

    await t.app.ctx.db.insert(clicks).values([
      click('2026-03-01T09:15:00Z', {
        referrerHost: 'twitter.com',
        browser: 'Chrome',
        country: 'IN',
        visitorHash: '1'.repeat(64),
      }),
      click('2026-03-01T09:45:00Z', {
        referrerHost: 'twitter.com',
        browser: 'Chrome',
        country: 'IN',
        visitorHash: '1'.repeat(64),
      }),
      click('2026-03-01T18:00:00Z', {
        browser: 'Safari',
        device: 'mobile',
        country: 'US',
        visitorHash: '2'.repeat(64),
      }),
      click('2026-03-03T12:00:00Z', { referrerHost: 'google.com', visitorHash: '3'.repeat(64) }),
      // Outside the queried range:
      click('2026-02-20T12:00:00Z', { visitorHash: '4'.repeat(64) }),
    ]);
  });
  afterAll(() => t.close());

  it('returns totals, unique visitors and breakdowns', async () => {
    const res = await stats('from=2026-03-01T00:00:00Z&to=2026-03-04T00:00:00Z');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals).toEqual({ clicks: 4, uniqueVisitors: 3 });
    expect(body.referrers).toEqual([
      { value: 'twitter.com', clicks: 2 },
      // Ties are ordered alphabetically, with unknown ("direct") values last.
      { value: 'google.com', clicks: 1 },
      { value: 'direct', clicks: 1 },
    ]);
    expect(body.devices).toEqual([
      { value: 'desktop', clicks: 3 },
      { value: 'mobile', clicks: 1 },
    ]);
    expect(body.countries[0]).toEqual({ value: 'IN', clicks: 2 });
  });

  it('builds a gap-filled daily time series in UTC', async () => {
    const res = await stats('from=2026-03-01T00:00:00Z&to=2026-03-04T00:00:00Z&interval=day');
    expect(res.json().timeseries).toEqual([
      { bucket: '2026-03-01T00:00:00.000Z', clicks: 3, uniqueVisitors: 2 },
      { bucket: '2026-03-02T00:00:00.000Z', clicks: 0, uniqueVisitors: 0 },
      { bucket: '2026-03-03T00:00:00.000Z', clicks: 1, uniqueVisitors: 1 },
      { bucket: '2026-03-04T00:00:00.000Z', clicks: 0, uniqueVisitors: 0 },
    ]);
  });

  it('supports hourly buckets and rejects oversized ranges', async () => {
    const hourly = await stats('from=2026-03-01T09:00:00Z&to=2026-03-01T11:00:00Z&interval=hour');
    expect(hourly.json().timeseries).toEqual([
      { bucket: '2026-03-01T09:00:00.000Z', clicks: 2, uniqueVisitors: 1 },
      { bucket: '2026-03-01T10:00:00.000Z', clicks: 0, uniqueVisitors: 0 },
      { bucket: '2026-03-01T11:00:00.000Z', clicks: 0, uniqueVisitors: 0 },
    ]);

    const tooBig = await stats('from=2025-01-01T00:00:00Z&to=2026-03-01T00:00:00Z&interval=hour');
    expect(tooBig.statusCode).toBe(400);
    const inverted = await stats('from=2026-03-02T00:00:00Z&to=2026-03-01T00:00:00Z');
    expect(inverted.statusCode).toBe(400);
  });

  it('summarises the account and hides other users’ links', async () => {
    const overview = await t.app.inject({
      method: 'GET',
      url: '/api/v1/analytics/overview?from=2026-02-01T00:00:00Z&to=2026-03-31T00:00:00Z',
      headers: auth,
    });
    expect(overview.json().totals).toEqual({ links: 1, clicks: 5, uniqueVisitors: 4 });
    expect(overview.json().topLinks).toEqual([
      { id: linkId, code: expect.any(String), title: 'Launch', clicks: 5 },
    ]);

    const other = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'nosy@example.com', name: 'Nosy', password: 'Password123' },
    });
    const peek = await t.app.inject({
      method: 'GET',
      url: `/api/v1/links/${linkId}/stats`,
      headers: { authorization: `Bearer ${other.json().token}` },
    });
    expect(peek.statusCode).toBe(404);
  });
});
