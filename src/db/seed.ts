/**
 * Demo data for the dashboard: one user, a handful of links and a month of
 * realistic click traffic. Idempotent: does nothing if the demo user exists.
 *
 *   npm run db:seed      →  demo@example.com / Password123
 */
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config/env.js';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { clicks, links, users } from './schema.js';

const DEMO = { email: 'demo@example.com', name: 'Demo User', password: 'Password123' };
const HOUR = 60 * 60 * 1000;
const DAYS = 30;

const LINKS = [
  {
    code: 'launch',
    title: 'Product launch post',
    targetUrl: 'https://example.com/blog/launch',
    weight: 10,
  },
  { code: 'docs', title: 'API documentation', targetUrl: 'https://example.com/docs', weight: 6 },
  { code: 'pricing', title: 'Pricing page', targetUrl: 'https://example.com/pricing', weight: 4 },
  {
    code: 'webinar',
    title: 'Webinar sign-up',
    targetUrl: 'https://example.com/webinar',
    weight: 2,
  },
  { code: 'careers', title: "We're hiring", targetUrl: 'https://example.com/careers', weight: 1 },
];

/** Weighted options, so the breakdown charts have a realistic shape. */
const REFERRERS: [string | null, number][] = [
  ['twitter.com', 30],
  [null, 25],
  ['google.com', 20],
  ['linkedin.com', 12],
  ['news.ycombinator.com', 8],
  ['github.com', 5],
];
const BROWSERS: [string, number][] = [
  ['Chrome', 60],
  ['Safari', 22],
  ['Firefox', 10],
  ['Edge', 8],
];
const PLATFORMS: [[string, string], number][] = [
  [['Windows', 'desktop'], 34],
  [['macOS', 'desktop'], 22],
  [['Android', 'mobile'], 24],
  [['iOS', 'mobile'], 16],
  [['Linux', 'desktop'], 4],
];
const COUNTRIES: [string, number][] = [
  ['IN', 35],
  ['US', 30],
  ['GB', 12],
  ['DE', 10],
  ['BR', 7],
  ['JP', 6],
];

// A small seeded generator keeps the demo data identical on every run.
let state = 42;
function random() {
  state = (state * 1664525 + 1013904223) % 2 ** 32;
  return state / 2 ** 32;
}
function pick<T>(options: [T, number][]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return options[0]![0];
}

async function main() {
  const config = loadConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  try {
    await runMigrations(db);
    const existing = await db.query.users.findFirst({ where: eq(users.email, DEMO.email) });
    if (existing) {
      console.log('Demo data already present, nothing to do.');
      return;
    }

    const [user] = await db
      .insert(users)
      .values({
        email: DEMO.email,
        name: DEMO.name,
        passwordHash: await bcrypt.hash(DEMO.password, 10),
      })
      .returning();

    const now = Date.now();
    for (const [index, link] of LINKS.entries()) {
      const rows: (typeof clicks.$inferInsert)[] = [];
      const createdAt = new Date(now - (DAYS - index * 4) * 24 * HOUR);
      const [created] = await db
        .insert(links)
        .values({
          userId: user!.id,
          code: link.code,
          title: link.title,
          targetUrl: link.targetUrl,
          createdAt,
        })
        .returning();

      for (let t = createdAt.getTime(); t < now; t += HOUR) {
        const date = new Date(t);
        // Busier during the day and on weekdays, with a gentle upward trend.
        const daytime = 0.3 + Math.max(0, Math.sin(((date.getUTCHours() - 4) / 24) * Math.PI * 2));
        const weekday = [0, 6].includes(date.getUTCDay()) ? 0.5 : 1;
        const trend = 0.6 + ((t - createdAt.getTime()) / (now - createdAt.getTime() || 1)) * 0.8;
        const expected = link.weight * 0.35 * daytime * weekday * trend;
        const amount = Math.floor(expected + random());
        for (let i = 0; i < amount; i++) {
          const [os, device] = pick(PLATFORMS);
          rows.push({
            linkId: created!.id,
            clickedAt: new Date(t + random() * HOUR),
            referrerHost: pick(REFERRERS),
            country: pick(COUNTRIES),
            browser: pick(BROWSERS),
            os,
            device,
            // Roughly two clicks per visitor per day.
            visitorHash: createHash('sha256')
              .update(`${date.toISOString().slice(0, 10)}:${Math.floor(random() * amount * 12)}`)
              .digest('hex'),
          });
        }
      }

      for (let i = 0; i < rows.length; i += 1000) {
        await db.insert(clicks).values(rows.slice(i, i + 1000));
      }
      await db.update(links).set({ clickCount: rows.length }).where(eq(links.id, created!.id));
    }

    console.log(`Seeded ${LINKS.length} links. Log in as ${DEMO.email} / ${DEMO.password}`);
  } finally {
    await pool.end();
  }
}

await main();
