import { createHash } from 'node:crypto';
import Bowser from 'bowser';

const BOT_PATTERN = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|curl|wget/i;

export interface VisitorInfo {
  browser: string | null;
  os: string | null;
  device: string;
}

export function parseUserAgent(userAgent: string | undefined): VisitorInfo {
  if (!userAgent) return { browser: null, os: null, device: 'unknown' };
  if (BOT_PATTERN.test(userAgent)) return { browser: null, os: null, device: 'bot' };
  const parsed = Bowser.parse(userAgent);
  return {
    browser: parsed.browser.name ?? null,
    os: parsed.os.name ?? null,
    device: parsed.platform.type ?? 'unknown',
  };
}

export function referrerHost(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).host.toLowerCase().slice(0, 255) || null;
  } catch {
    return null;
  }
}

/**
 * Pseudonymous visitor id for unique-visitor counts: a salted hash of IP and
 * user agent that rotates daily, so raw IPs are never stored and visitors
 * can't be tracked across days.
 */
export function visitorHash(
  ip: string,
  userAgent: string | undefined,
  salt: string,
  at = new Date(),
) {
  const day = at.toISOString().slice(0, 10);
  return createHash('sha256')
    .update(`${salt}|${day}|${ip}|${userAgent ?? ''}`)
    .digest('hex');
}
