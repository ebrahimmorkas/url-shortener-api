import { eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { clicks, links, type NewClick } from '../../db/schema.js';

/** Serializable click event (travels through BullMQ as JSON). */
export interface ClickEvent {
  linkId: string;
  clickedAt: string;
  referrerHost: string | null;
  country: string | null;
  browser: string | null;
  os: string | null;
  device: string;
  visitorHash: string;
}

/**
 * Persists a batch of clicks in one transaction: a single multi-row INSERT
 * plus one counter UPDATE per link (instead of one write per redirect).
 */
export async function writeClicks(db: Database, batch: ClickEvent[]) {
  if (batch.length === 0) return;
  const counts = new Map<string, number>();
  for (const click of batch) counts.set(click.linkId, (counts.get(click.linkId) ?? 0) + 1);

  const rows: NewClick[] = batch.map((c) => ({ ...c, clickedAt: new Date(c.clickedAt) }));

  await db.transaction(async (tx) => {
    // Links deleted meanwhile would violate the FK: keep only clicks for existing links.
    const existing = await tx
      .select({ id: links.id })
      .from(links)
      .where(inArray(links.id, [...counts.keys()]));
    const alive = new Set(existing.map((l) => l.id));
    const kept = rows.filter((r) => alive.has(r.linkId));
    if (kept.length === 0) return;

    await tx.insert(clicks).values(kept);
    for (const [linkId, count] of counts) {
      if (!alive.has(linkId)) continue;
      await tx
        .update(links)
        .set({ clickCount: sql`${links.clickCount} + ${count}` })
        .where(eq(links.id, linkId));
    }
  });
}
