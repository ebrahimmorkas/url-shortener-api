import { format } from 'date-fns';
import type { Breakdown, Link, LinkStats } from '@/lib/types';

export type LinkState = 'active' | 'disabled' | 'expired' | 'capped';

/** Why a short link does or doesn't redirect right now, mirroring the API's 410 rules. */
export function linkState(link: Link, now = new Date()): LinkState {
  if (!link.isActive) return 'disabled';
  if (link.expiresAt && new Date(link.expiresAt) <= now) return 'expired';
  if (link.maxClicks !== null && link.clickCount >= link.maxClicks) return 'capped';
  return 'active';
}

export const STATE_LABEL: Record<LinkState, string> = {
  active: 'Active',
  disabled: 'Disabled',
  expired: 'Expired',
  capped: 'Click limit reached',
};

export const STATE_TONE = {
  active: 'success',
  disabled: 'neutral',
  expired: 'warning',
  capped: 'warning',
} as const;

export type RangeKey = '24h' | '7d' | '30d';

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: '24h', label: 'Last 24 hours' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Query parameters for the stats endpoint; hourly buckets for a day, daily otherwise. */
export function rangeParams(key: RangeKey, now = new Date()) {
  const days = key === '24h' ? 1 : key === '7d' ? 7 : 30;
  return {
    from: new Date(now.getTime() - days * DAY_MS).toISOString(),
    to: now.toISOString(),
    interval: key === '24h' ? ('hour' as const) : ('day' as const),
  };
}

/** Chart rows with a readable label per bucket, in the viewer's timezone. */
export function chartPoints(stats: Pick<LinkStats, 'timeseries' | 'range'>) {
  const pattern = stats.range.interval === 'hour' ? 'ha' : 'd MMM';
  return stats.timeseries.map((point) => ({
    label: format(new Date(point.bucket), pattern),
    Clicks: point.clicks,
    'Unique visitors': point.uniqueVisitors,
  }));
}

/** Adds each row's share of the total, for the bar width and percentage label. */
export function withShare(rows: Breakdown[]) {
  const total = rows.reduce((sum, row) => sum + row.clicks, 0);
  return rows.map((row) => ({ ...row, share: total === 0 ? 0 : row.clicks / total }));
}

export const compactNumber = (value: number) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

/** Shows a long destination as "host/path…" so tables stay readable. */
export function prettyUrl(url: string, max = 48) {
  const clean = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
