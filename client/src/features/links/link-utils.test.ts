import { describe, expect, it } from 'vitest';
import type { Link } from '@/lib/types';
import { linkState, prettyUrl, rangeParams, withShare } from './link-utils';

const link = (overrides: Partial<Link> = {}): Link => ({
  id: '1',
  code: 'abc',
  shortUrl: 'http://sho.rt/abc',
  targetUrl: 'https://example.com',
  title: null,
  expiresAt: null,
  maxClicks: null,
  clickCount: 0,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

describe('linkState', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('is active by default', () => {
    expect(linkState(link(), now)).toBe('active');
  });

  it('reports why a link no longer redirects', () => {
    expect(linkState(link({ isActive: false }), now)).toBe('disabled');
    expect(linkState(link({ expiresAt: '2026-06-01T11:59:00Z' }), now)).toBe('expired');
    expect(linkState(link({ maxClicks: 10, clickCount: 10 }), now)).toBe('capped');
  });

  it('keeps links with remaining time or clicks active', () => {
    expect(linkState(link({ expiresAt: '2026-06-02T00:00:00Z' }), now)).toBe('active');
    expect(linkState(link({ maxClicks: 10, clickCount: 9 }), now)).toBe('active');
  });

  it('treats a manual disable as the main reason', () => {
    expect(linkState(link({ isActive: false, maxClicks: 1, clickCount: 5 }), now)).toBe('disabled');
  });
});

describe('rangeParams', () => {
  const now = new Date('2026-06-10T00:00:00.000Z');

  it('uses hourly buckets for the last day', () => {
    expect(rangeParams('24h', now)).toEqual({
      from: '2026-06-09T00:00:00.000Z',
      to: '2026-06-10T00:00:00.000Z',
      interval: 'hour',
    });
  });

  it('uses daily buckets for longer ranges', () => {
    expect(rangeParams('7d', now)).toMatchObject({
      from: '2026-06-03T00:00:00.000Z',
      interval: 'day',
    });
    expect(rangeParams('30d', now)).toMatchObject({
      from: '2026-05-11T00:00:00.000Z',
      interval: 'day',
    });
  });
});

describe('formatting helpers', () => {
  it('computes each row share of the total', () => {
    expect(
      withShare([
        { value: 'a', clicks: 3 },
        { value: 'b', clicks: 1 },
      ]).map((r) => r.share),
    ).toEqual([0.75, 0.25]);
    expect(withShare([{ value: 'a', clicks: 0 }])[0]!.share).toBe(0);
  });

  it('shortens long destinations and drops the protocol', () => {
    expect(prettyUrl('https://example.com/')).toBe('example.com');
    expect(prettyUrl(`https://example.com/${'x'.repeat(80)}`, 20)).toHaveLength(20);
  });
});
