import pg from 'pg';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

/** Creates the test database if needed and applies all migrations once per run. */
export default async function setup() {
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/shortener_test',
  );
  const admin = new pg.Client({ connectionString: new URL('/postgres', url).toString() });
  await admin.connect();
  const name = url.pathname.slice(1);
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const { db, pool } = createDb(url.toString());
  await runMigrations(db);
  await pool.end();
}
