import { Redis } from 'ioredis';

/** Returns a Redis client when enabled, otherwise `null` (features fall back to in-memory). */
export function createRedis(enabled: boolean, url: string): Redis | null {
  if (!enabled) return null;
  return new Redis(url, { maxRetriesPerRequest: null });
}
