process.env.NODE_ENV = 'test';
process.env.REDIS_ENABLED ??= 'false';
process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-definitely-long-enough';
process.env.BASE_URL = 'http://sho.rt';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/shortener_test';
