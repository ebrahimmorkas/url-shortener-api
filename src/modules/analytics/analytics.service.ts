import { and, count, countDistinct, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/client.js';
import { clicks, links } from '../../db/schema.js';
import { BadRequest } from '../../lib/errors.js';

export type Interval = 'hour' | 'day';

const MAX_BUCKETS: Record<Interval, number> = { hour: 24 * 14, day: 366 };
const HOUR_MS = 60 * 60 * 1000;

export interface Range {
  from: Date;
  to: Date;
  interval: Interval;
}

export function validateRange({ from, to, interval }: Range) {
  if (from >= to) throw BadRequest('"from" must be before "to"');
  const buckets = (to.getTime() - from.getTime()) / (interval === 'hour' ? HOUR_MS : 24 * HOUR_MS);
  if (buckets > MAX_BUCKETS[interval]) {
    throw BadRequest(
      `Range too large for interval "${interval}" (max ${MAX_BUCKETS[interval]} buckets)`,
    );
  }
}

export class AnalyticsService {
  constructor(private readonly db: Database) {}

  private inRange(linkId: string, range: Range) {
    return and(
      eq(clicks.linkId, linkId),
      gte(clicks.clickedAt, range.from),
      lte(clicks.clickedAt, range.to),
    );
  }

  async totals(linkId: string, range: Range) {
    const [row] = await this.db
      .select({ clicks: count(), uniqueVisitors: countDistinct(clicks.visitorHash) })
      .from(clicks)
      .where(this.inRange(linkId, range));
    return { clicks: row?.clicks ?? 0, uniqueVisitors: row?.uniqueVisitors ?? 0 };
  }

  /**
   * Clicks per hour/day in UTC, gap-filled with `generate_series` so charts get
   * a zero for periods without traffic instead of missing points.
   */
  async timeseries(linkId: string, range: Range) {
    // `interval` is a validated enum ('hour' | 'day'), so inlining it is injection-safe.
    const step = sql.raw(`'1 ${range.interval}'::interval`);
    const unit = sql.raw(`'${range.interval}'`);
    const result = await this.db.execute<{
      bucket: string;
      clicks: number;
      unique_visitors: number;
    }>(sql`
      WITH buckets AS (
        SELECT generate_series(
          date_trunc(${unit}, ${range.from.toISOString()}::timestamptz AT TIME ZONE 'UTC'),
          date_trunc(${unit}, ${range.to.toISOString()}::timestamptz AT TIME ZONE 'UTC'),
          ${step}
        ) AS bucket
      )
      -- Formatted in SQL so the driver cannot reinterpret it in the local timezone.
      SELECT to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bucket,
             count(c.id)::int AS clicks,
             count(DISTINCT c.visitor_hash)::int AS unique_visitors
      FROM buckets b
      LEFT JOIN clicks c
        ON c.link_id = ${linkId}
       AND c.clicked_at BETWEEN ${range.from.toISOString()}::timestamptz AND ${range.to.toISOString()}::timestamptz
       AND date_trunc(${unit}, c.clicked_at AT TIME ZONE 'UTC') = b.bucket
      GROUP BY b.bucket
      ORDER BY b.bucket`);

    return result.rows.map((row) => ({
      bucket: new Date(row.bucket),
      clicks: row.clicks,
      uniqueVisitors: row.unique_visitors,
    }));
  }

  /** Top values of a dimension (referrer, browser…); nulls are reported as `fallback`. */
  async breakdown(linkId: string, range: Range, column: PgColumn, fallback: string, limit = 10) {
    // Group by the raw column (a parameterised coalesce in SELECT and GROUP BY
    // would be two different expressions to PostgreSQL) and label nulls here.
    const rows = await this.db
      .select({ value: sql<string | null>`${column}`, clicks: count() })
      .from(clicks)
      .where(this.inRange(linkId, range))
      .groupBy(column)
      .orderBy(desc(count()), sql`${column} NULLS LAST`)
      .limit(limit);
    return rows.map((row) => ({ value: row.value ?? fallback, clicks: row.clicks }));
  }

  async linkStats(linkId: string, range: Range) {
    const [totals, timeseries, referrers, browsers, os, devices, countries] = await Promise.all([
      this.totals(linkId, range),
      this.timeseries(linkId, range),
      this.breakdown(linkId, range, clicks.referrerHost, 'direct'),
      this.breakdown(linkId, range, clicks.browser, 'unknown'),
      this.breakdown(linkId, range, clicks.os, 'unknown'),
      this.breakdown(linkId, range, clicks.device, 'unknown'),
      this.breakdown(linkId, range, clicks.country, 'unknown'),
    ]);
    return { totals, timeseries, referrers, browsers, os, devices, countries };
  }

  /** Account-wide summary: totals and the most-clicked links in the range. */
  async overview(userId: string, range: Pick<Range, 'from' | 'to'>, limit = 5) {
    const clickCount = count(clicks.id);
    const [summary, topLinks] = await Promise.all([
      this.db
        .select({
          links: countDistinct(links.id),
          clicks: count(clicks.id),
          uniqueVisitors: countDistinct(clicks.visitorHash),
        })
        .from(links)
        .leftJoin(
          clicks,
          and(
            eq(clicks.linkId, links.id),
            gte(clicks.clickedAt, range.from),
            lte(clicks.clickedAt, range.to),
          ),
        )
        .where(eq(links.userId, userId)),
      this.db
        .select({ id: links.id, code: links.code, title: links.title, clicks: clickCount })
        .from(links)
        .innerJoin(
          clicks,
          and(
            eq(clicks.linkId, links.id),
            gte(clicks.clickedAt, range.from),
            lte(clicks.clickedAt, range.to),
          ),
        )
        .where(eq(links.userId, userId))
        .groupBy(links.id)
        .orderBy(desc(clickCount))
        .limit(limit),
    ]);
    return { totals: summary[0]!, topLinks };
  }
}
