import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createDb } from './db/client.js';
import { createRedis } from './lib/redis.js';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_ENABLED, config.REDIS_URL);

const app = await buildApp({ config, db, redis });

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down gracefully');
  setTimeout(() => process.exit(1), 10_000).unref();
  await app.close();
  await pool.end();
  await redis?.quit();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: config.HOST });
