import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

describe('health', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('reports database and redis status', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().services).toEqual({
      database: 'up',
      redis: process.env.REDIS_ENABLED === 'true' ? 'up' : 'disabled',
    });
  });

  it('returns JSON 404s and echoes the request id', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/nope',
      headers: { 'x-request-id': 'req-123' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(res.headers['x-request-id']).toBe('req-123');
  });
});
