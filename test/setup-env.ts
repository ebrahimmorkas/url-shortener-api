process.env.NODE_ENV = 'test';
process.env.REDIS_ENABLED ??= 'false';
process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-definitely-long-enough';
process.env.BASE_URL = 'http://sho.rt';
// Suites share one client IP; the limiter has its own test with low limits.
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.REDIRECT_RATE_LIMIT_MAX = '100000';
// Flushes are driven explicitly by tests via clicks.flush().
process.env.CLICK_FLUSH_INTERVAL_MS = '60000';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/shortener_test';
