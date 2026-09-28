import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateCode } from '../src/modules/links/codes.js';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

describe('links', () => {
  let t: TestApp;
  let auth: { authorization: string };

  const create = (payload: object, headers = auth) =>
    t.app.inject({ method: 'POST', url: '/api/v1/links', headers, payload });

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t);
    const reg = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'owner@example.com', name: 'Owner', password: 'Password123' },
    });
    auth = { authorization: `Bearer ${reg.json().token}` };
  });
  afterAll(() => t.close());

  it('generates random base62 codes', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateCode()));
    expect(codes.size).toBe(1000);
    for (const code of codes) expect(code).toMatch(/^[0-9A-Za-z]{7}$/);
  });

  it('shortens a URL with a random code', async () => {
    const res = await create({
      targetUrl: 'https://example.com/some/long/path?x=1',
      title: 'Docs',
    });
    expect(res.statusCode).toBe(201);
    const { link } = res.json();
    expect(link.code).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(link.shortUrl).toBe(`http://sho.rt/${link.code}`);
    expect(link).toMatchObject({ title: 'Docs', clickCount: 0, isActive: true });
  });

  it('supports custom aliases and rejects duplicates and reserved words', async () => {
    const first = await create({ targetUrl: 'https://example.com', alias: 'launch-2026' });
    expect(first.json().link.code).toBe('launch-2026');

    const dup = await create({ targetUrl: 'https://example.org', alias: 'launch-2026' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('ALIAS_TAKEN');

    const reserved = await create({ targetUrl: 'https://example.org', alias: 'API' });
    expect(reserved.json().error.code).toBe('ALIAS_RESERVED');

    const invalid = await create({ targetUrl: 'https://example.org', alias: 'no spaces!' });
    expect(invalid.statusCode).toBe(400);
  });

  it('rejects unsafe targets', async () => {
    for (const targetUrl of ['javascript:alert(1)', 'ftp://example.com/file', 'not a url']) {
      expect((await create({ targetUrl })).statusCode).toBe(400);
    }
    const loop = await create({ targetUrl: 'http://sho.rt/abc' });
    expect(loop.statusCode).toBe(400);
    expect(loop.json().error.message).toMatch(/shortener itself/);
  });

  it('lists links with search and cursor pagination', async () => {
    for (let i = 1; i <= 5; i++) {
      await create({
        targetUrl: `https://example.com/${i}`,
        title: i % 2 ? `Campaign ${i}` : `Other ${i}`,
      });
    }
    const page1 = await t.app.inject({
      method: 'GET',
      url: '/api/v1/links?limit=2',
      headers: auth,
    });
    expect(page1.json().data.map((l: { title: string }) => l.title)).toEqual([
      'Campaign 5',
      'Other 4',
    ]);

    const page2 = await t.app.inject({
      method: 'GET',
      url: `/api/v1/links?limit=10&cursor=${page1.json().nextCursor}`,
      headers: auth,
    });
    expect(page2.json().data).toHaveLength(3);
    expect(page2.json().nextCursor).toBeNull();

    const search = await t.app.inject({
      method: 'GET',
      url: '/api/v1/links?search=campaign',
      headers: auth,
    });
    expect(search.json().data).toHaveLength(3);
  });

  it('updates, disables and deletes links; other users cannot see them', async () => {
    const { link } = (await create({ targetUrl: 'https://example.com' })).json();

    const updated = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/links/${link.id}`,
      headers: auth,
      payload: { targetUrl: 'https://example.org/new', isActive: false },
    });
    expect(updated.json().link).toMatchObject({
      targetUrl: 'https://example.org/new',
      isActive: false,
    });

    const other = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'other@example.com', name: 'Other', password: 'Password123' },
    });
    const peek = await t.app.inject({
      method: 'GET',
      url: `/api/v1/links/${link.id}`,
      headers: { authorization: `Bearer ${other.json().token}` },
    });
    expect(peek.statusCode).toBe(404);

    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/links/${link.id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
  });

  it('renders a QR code PNG', async () => {
    const { link } = (await create({ targetUrl: 'https://example.com' })).json();
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/links/${link.id}/qr?size=128`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.subarray(1, 4).toString()).toBe('PNG');
  });
});
