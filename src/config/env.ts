import 'dotenv/config';
import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3002),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('*'),
  BASE_URL: z.url().default('http://localhost:3002'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  REDIS_ENABLED: booleanFromString,
  REDIS_URL: z.string().default('redis://localhost:6379'),

  REDIRECT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  CLICK_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  CLICK_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(source: Record<string, unknown> = process.env): Config {
  const parsed = configSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return parsed.data;
}
