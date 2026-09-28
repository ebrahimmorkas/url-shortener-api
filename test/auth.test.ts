import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

describe('auth and API keys', () => {
  let t: TestApp;
  const credentials = { email: 'Ana@Example.com', name: 'Ana', password: 'Shorten1234' };

  const register = () =>
    t.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: credentials });

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => resetDb(t));
  afterAll(() => t.close());

  it('registers, logs in and resolves the current user', async () => {
    const reg = await register();
    expect(reg.statusCode).toBe(201);
    expect(reg.json().user).toMatchObject({ email: 'ana@example.com', name: 'Ana' });
    expect(reg.json().user.passwordHash).toBeUndefined();

    const login = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ana@example.com', password: credentials.password },
    });
    expect(login.statusCode).toBe(200);

    const me = await t.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${login.json().token}` },
    });
    expect(me.json().user.email).toBe('ana@example.com');
  });

  it('rejects duplicates, invalid input and bad credentials', async () => {
    await register();
    expect((await register()).statusCode).toBe(409);

    const invalid = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'not-an-email', name: 'A', password: 'x' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');

    const wrong = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ana@example.com', password: 'nope-1234' },
    });
    expect(wrong.statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
  });

  it('creates, uses, lists and revokes API keys', async () => {
    const token = (await register()).json().token;
    const auth = { authorization: `Bearer ${token}` };

    const created = await t.app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: auth,
      payload: { name: 'CI script' },
    });
    expect(created.statusCode).toBe(201);
    const { secret, apiKey } = created.json();
    expect(secret).toMatch(/^sk_/);
    expect(apiKey.prefix).toBe(secret.slice(0, 10));

    const viaKey = await t.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { 'x-api-key': secret },
    });
    expect(viaKey.statusCode).toBe(200);

    const list = await t.app.inject({ method: 'GET', url: '/api/v1/api-keys', headers: auth });
    expect(list.json().data).toHaveLength(1);
    expect(JSON.stringify(list.json())).not.toContain(secret);

    const revoke = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/api-keys/${apiKey.id}`,
      headers: auth,
    });
    expect(revoke.statusCode).toBe(204);

    const afterRevoke = await t.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { 'x-api-key': secret },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });
});
