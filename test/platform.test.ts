import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

describe('rate limiting', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ RATE_LIMIT_MAX: '5', AUTH_RATE_LIMIT_MAX: '2' });
    await resetDb(t);
  });
  afterAll(() => t.close());

  const login = (ip: string) =>
    t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: ip,
      payload: { email: 'nobody@example.com', password: 'wrong-password' },
    });

  it('throttles credential endpoints sooner than the rest of the API', async () => {
    expect((await login('10.0.0.1')).statusCode).toBe(401);
    expect((await login('10.0.0.1')).statusCode).toBe(401);
    const blocked = await login('10.0.0.1');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('counts each client separately', async () => {
    expect((await login('10.0.0.2')).statusCode).toBe(401);
  });

  it('identifies callers by API key rather than IP when one is sent', async () => {
    const hit = (key: string) =>
      t.app.inject({
        method: 'GET',
        url: '/api/v1/links',
        remoteAddress: '10.0.0.3',
        headers: { 'x-api-key': key },
      });
    for (let i = 0; i < 5; i++) expect((await hit('key-a')).statusCode).toBe(401);
    expect((await hit('key-a')).statusCode).toBe(429);
    // Same IP, different key: its own budget.
    expect((await hit('key-b')).statusCode).toBe(401);
  });

  it('never limits the health check', async () => {
    for (let i = 0; i < 8; i++) {
      const res = await t.app.inject({ method: 'GET', url: '/health', remoteAddress: '10.0.0.4' });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('API documentation', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('serves an OpenAPI document generated from the route schemas', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/api/v1/auth/login', '/api/v1/links', '/api/v1/links/{id}/stats']),
    );
    expect(doc.components.securitySchemes).toHaveProperty('bearerAuth');
    expect(doc.components.securitySchemes).toHaveProperty('apiKey');
    // Internal routes stay out of the public contract.
    expect(doc.paths).not.toHaveProperty('/health');
    expect(doc.paths).not.toHaveProperty('/{code}');
  });

  it('serves Swagger UI', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});
