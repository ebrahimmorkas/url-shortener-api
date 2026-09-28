import { sql } from 'drizzle-orm';
import { buildApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb } from '../src/db/client.js';
import { createRedis } from '../src/lib/redis.js';

export interface TestApp {
  app: App;
  close: () => Promise<void>;
}

export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const config = loadConfig({ ...process.env, ...overrides });
  const { db, pool } = createDb(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_ENABLED, config.REDIS_URL);
  const app = await buildApp({ config, db, redis });
  await app.ready();
  return {
    app,
    close: async () => {
      await app.close();
      await pool.end();
      await redis?.quit();
    },
  };
}

export async function resetDb(t: TestApp) {
  await t.app.ctx.db.execute(sql`TRUNCATE clicks, links, api_keys, users RESTART IDENTITY CASCADE`);
}
