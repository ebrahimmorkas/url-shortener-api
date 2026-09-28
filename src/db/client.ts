import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}

export type Database = ReturnType<typeof createDb>['db'];
