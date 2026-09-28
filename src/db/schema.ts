import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 255 }).notNull().unique(),
  name: varchar({ length: 100 }).notNull(),
  passwordHash: varchar({ length: 100 }).notNull(),
  ...timestamps,
});

/** API keys for programmatic access. Only a SHA-256 hash of the key is stored. */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar({ length: 100 }).notNull(),
    /** First characters of the key, shown in listings so users can tell keys apart. */
    prefix: varchar({ length: 16 }).notNull(),
    keyHash: char({ length: 64 }).notNull().unique(),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

export const links = pgTable(
  'links',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Case-sensitive short code: random base62 or a custom alias. */
    code: varchar({ length: 32 }).notNull().unique(),
    targetUrl: text().notNull(),
    title: varchar({ length: 200 }),
    expiresAt: timestamp({ withTimezone: true }),
    maxClicks: integer(),
    /** Denormalised counter, advanced by the click-ingestion worker. */
    clickCount: bigint({ mode: 'number' }).notNull().default(0),
    isActive: boolean().notNull().default(true),
    ...timestamps,
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('links_user_created_idx').on(t.userId, t.createdAt),
    check('links_max_clicks_positive', sql`${t.maxClicks} IS NULL OR ${t.maxClicks} > 0`),
  ],
);

/**
 * One row per redirect. Privacy by design: no raw IP addresses are stored,
 * only a salted daily visitor hash used to count unique visitors.
 */
export const clicks = pgTable(
  'clicks',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    linkId: uuid()
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    clickedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    referrerHost: varchar({ length: 255 }),
    country: char({ length: 2 }),
    browser: varchar({ length: 50 }),
    os: varchar({ length: 50 }),
    device: varchar({ length: 20 }).notNull().default('unknown'),
    visitorHash: char({ length: 64 }).notNull(),
  },
  (t) => [index('clicks_link_time_idx').on(t.linkId, t.clickedAt)],
);

export type User = typeof users.$inferSelect;
export type Link = typeof links.$inferSelect;
export type NewClick = typeof clicks.$inferInsert;
