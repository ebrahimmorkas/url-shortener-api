# URL Shortener API + dashboard

[![CI](https://github.com/ebrahimmorkas/url-shortener-api/actions/workflows/ci.yml/badge.svg)](https://github.com/ebrahimmorkas/url-shortener-api/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Drizzle-4169E1?logo=postgresql&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-blue)

A URL shortener with click analytics, in the style of Bitly: short links with custom aliases,
expiry dates, click caps and QR codes, a redirect path that stays fast under load, and
per-link statistics. Built with Node.js, TypeScript, Fastify and PostgreSQL.

It ships with **Snip**, a React + TypeScript dashboard in [`client/`](client) for creating links
and reading their analytics.

![Link analytics: clicks over time and breakdowns](docs/screenshots/analytics.png)

## Web client (Snip)

| Links and overview                           | Analytics in dark mode                                 |
| -------------------------------------------- | ------------------------------------------------------ |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Dark analytics](docs/screenshots/analytics-dark.png) |
| **API keys, shown once**                     |                                                        |
| ![API keys](docs/screenshots/api-keys.png)   |                                                        |

What it does:

- **Shorten a link** with an optional alias, title, expiry and click limit. The short URL is
  copied to the clipboard.
- **Links table** with search, "load more" (cursor pagination), copy buttons and a status badge
  that explains why a link no longer redirects (disabled, expired, click limit reached).
- **Analytics per link:** range switch (24 hours hourly, 7 or 30 days daily), clicks and unique
  visitors over time, top referrers, countries, devices, browsers and operating systems, and
  the QR code as a downloadable PNG.
- **API keys:** create, list and revoke. The secret is displayed once.
- "Continue as demo user", light and dark themes, responsive layout.

How it is built: React 19, TypeScript, Vite, React Router, TanStack Query (infinite query for the
table, previous data kept while a new range loads), React Hook Form + Zod, Tailwind CSS v4 and
Recharts. Chart colours were checked for colour-blind separation and contrast in both themes,
every chart has a table view, and breakdowns label values in text, not by colour alone. Status,
range and formatting logic are pure functions with unit tests.

```bash
npm run db:seed    # demo@example.com / Password123, 5 links, a month of clicks
npm run dev        # API on :3002
cd client && npm install && npm run dev   # http://localhost:5178
```

## Highlights

| Problem                                    | Solution                                                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redirects must be fast                     | Short codes are resolved from a cache (Redis, or an in-memory LRU). Editing or disabling a link invalidates its cache entry.                                         |
| Recording a click must not slow a redirect | The redirect only enqueues the click in memory. A buffer flushes in batches (through BullMQ when Redis is enabled) and is drained on shutdown so no clicks are lost. |
| Counting unique visitors without tracking  | A salted, daily-rotating hash of IP and user agent. No raw IP addresses are stored.                                                                                  |
| Charts need continuous data                | Time series are gap-filled in SQL with `generate_series`, in UTC, so empty hours or days come back as zero.                                                          |
| Scripts need access without a login        | API keys (`X-API-Key`), stored hashed and shown once, alongside JWT for interactive use.                                                                             |
| Abuse and brute force                      | Rate limits per API key or IP, stricter on login/registration, counted before authentication so bad credentials are throttled too.                                   |
| Docs drifting from code                    | OpenAPI is generated from the same Zod schemas that validate requests and responses. Swagger UI is at `/docs`.                                                       |
| Needs Redis to run?                        | **No.** Every Redis-backed feature has an in-process fallback (see below).                                                                                           |

## Tech stack

- **Runtime:** Node.js 20+, TypeScript (strict, ESM), Fastify 5 with the Zod type provider
- **Database:** PostgreSQL with Drizzle ORM and SQL migrations
- **Optional infrastructure:** Redis (ioredis) for the redirect cache and rate limits, BullMQ for
  click ingestion
- **Security:** JWT, hashed API keys, bcrypt, Helmet, CORS, rate limiting, Zod validation
- **Docs:** OpenAPI 3 + Swagger UI generated from route schemas
- **Testing:** Vitest integration tests against a real PostgreSQL database
- **DevOps:** Docker multi-stage build, docker compose, GitHub Actions CI (with and without Redis)

## Architecture

```mermaid
flowchart LR
    V[Visitor] -->|GET /:code| R[Redirect route]
    R --> C{Cache}
    C -- miss --> PG[(PostgreSQL)]
    R -->|302| V
    R -. enqueue click .-> Q[Click queue]
    Q -->|batched insert| PG
    U[API user] -->|JWT or API key| A[Links · Analytics · Auth]
    A --> PG
    A -. invalidate .-> C
    C -. REDIS_ENABLED=true .-> RD[(Redis)]
    Q -. REDIS_ENABLED=true .-> RD
```

### Running with or without Redis

| Feature         | `REDIS_ENABLED=true`                  | `REDIS_ENABLED=false` (default)  |
| --------------- | ------------------------------------- | -------------------------------- |
| Redirect cache  | Redis, shared by all instances        | In-memory LRU                    |
| Rate limiting   | Redis counters, consistent everywhere | Per-process counters             |
| Click ingestion | BullMQ queue                          | In-process buffer, batched flush |

CI runs the full test suite in **both** modes.

## Getting started

### Docker

```bash
docker compose up --build                                    # API + PostgreSQL
REDIS_ENABLED=true docker compose --profile redis up --build  # + Redis
```

The API is at http://localhost:3002 and the interactive docs at http://localhost:3002/docs.

### Local Node.js

Requirements: Node.js 20+, PostgreSQL 14+ (Redis optional).

```bash
git clone https://github.com/ebrahimmorkas/url-shortener-api.git
cd url-shortener-api
cp .env.example .env          # adjust DATABASE_URL if needed
npm install
npm run dev                   # migrations run on startup; http://localhost:3002
```

### Try it

```bash
# 1. Create an account and keep the token
TOKEN=$(curl -s localhost:3002/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","name":"Me","password":"Password123"}' | jq -r .token)

# 2. Shorten a URL (alias, expiry and click cap are optional)
curl -s localhost:3002/api/v1/links -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"targetUrl":"https://nodejs.org/en/docs","alias":"node-docs"}' | jq .link.shortUrl

# 3. Follow it
curl -si localhost:3002/node-docs | head -3

# 4. See the clicks
curl -s "localhost:3002/api/v1/links/<link-id>/stats?interval=hour" \
  -H "Authorization: Bearer $TOKEN" | jq '{totals, referrers}'
```

## API overview

Full reference: **`/docs`** (Swagger UI) or `/docs/json` (OpenAPI).

| Method | Endpoint                     | Access | Description                                                    |
| ------ | ---------------------------- | ------ | -------------------------------------------------------------- |
| POST   | `/api/v1/auth/register`      | Public | Create an account                                              |
| POST   | `/api/v1/auth/login`         | Public | Log in and receive a JWT                                       |
| GET    | `/api/v1/auth/me`            | User   | Current user                                                   |
| POST   | `/api/v1/api-keys`           | User   | Create an API key (the secret is shown only once)              |
| GET    | `/api/v1/api-keys`           | User   | List API keys                                                  |
| DELETE | `/api/v1/api-keys/:id`       | User   | Revoke an API key                                              |
| POST   | `/api/v1/links`              | User   | Shorten a URL (optional alias, expiry, click cap)              |
| GET    | `/api/v1/links`              | User   | My links, newest first, cursor-paginated                       |
| GET    | `/api/v1/links/:id`          | Owner  | One link                                                       |
| PATCH  | `/api/v1/links/:id`          | Owner  | Change destination, title or limits; disable                   |
| DELETE | `/api/v1/links/:id`          | Owner  | Delete a link                                                  |
| GET    | `/api/v1/links/:id/qr`       | Owner  | QR code (PNG) for the short URL                                |
| GET    | `/api/v1/links/:id/stats`    | Owner  | Totals, unique visitors, time series and breakdowns            |
| GET    | `/api/v1/analytics/overview` | User   | Account totals and most-clicked links                          |
| GET    | `/:code`                     | Public | Redirect (`302`), `404` unknown, `410` disabled/expired/capped |
| GET    | `/health`                    | Public | Liveness and dependency status                                 |

"User" endpoints accept `Authorization: Bearer <jwt>` or `X-API-Key: <key>`.

Errors share one shape:

```json
{ "error": { "code": "RATE_LIMITED", "message": "Rate limit exceeded, retry in 1 minute" } }
```

## Configuration

| Variable                     | Default                  | Description                                            |
| ---------------------------- | ------------------------ | ------------------------------------------------------ |
| `PORT`                       | `3002`                   | HTTP port                                              |
| `BASE_URL`                   | `http://localhost:3002`  | Public origin used to build short links                |
| `DATABASE_URL`               | —                        | PostgreSQL connection string (**required**)            |
| `MIGRATE_ON_START`           | `true`                   | Apply pending SQL migrations on startup                |
| `JWT_SECRET`                 | —                        | ≥ 32 characters (**required**)                         |
| `REDIS_ENABLED`              | `false`                  | Redis cache, distributed rate limits and BullMQ clicks |
| `REDIS_URL`                  | `redis://localhost:6379` | Redis connection                                       |
| `REDIRECT_CACHE_TTL_SECONDS` | `300`                    | How long a resolved short code is cached               |
| `CLICK_FLUSH_INTERVAL_MS`    | `1000`                   | How often buffered clicks are written                  |
| `CLICK_BATCH_SIZE`           | `500`                    | Flush early when this many clicks are waiting          |
| `RATE_LIMIT_MAX`             | `120`                    | Requests per minute per caller (API key, otherwise IP) |
| `AUTH_RATE_LIMIT_MAX`        | `10`                     | Login/registration requests per minute                 |
| `REDIRECT_RATE_LIMIT_MAX`    | `600`                    | Redirects per minute per IP                            |
| `CORS_ORIGIN`                | `*`                      | Comma-separated allowed origins                        |
| `LOG_LEVEL`                  | `info`                   | pino log level                                         |

The environment is validated at startup; the process exits with a clear message if anything is
missing.

## Testing

```bash
npm test          # integration tests (needs PostgreSQL)
npm run lint
npm run typecheck
```

Tests run against a real database (`shortener_test` by default, override with
`TEST_DATABASE_URL`). The database is created and migrated automatically before the suite. They
cover authentication and API keys, link rules, redirects and caching, click ingestion,
analytics, rate limiting and the generated OpenAPI document.

## Project structure

```
src/
├── app.ts                 # Fastify app factory
├── server.ts              # Bootstrap, migrations, graceful shutdown
├── config/env.ts          # Zod-validated environment
├── db/                    # Drizzle schema, client, migration runner
├── plugins/               # error handler, rate limiting, OpenAPI docs
├── modules/
│   ├── auth/              # accounts, JWT, API keys
│   ├── links/             # short codes, aliases, expiry, click caps, QR
│   ├── redirects/         # cached redirect, click queue and batch writer
│   └── analytics/         # per-link stats and account overview
└── routes/health.ts
client/                    # Snip React dashboard
drizzle/                   # SQL migrations
test/                      # Vitest integration suites
```

## Possible extensions

- Custom domains per account
- Geo lookup for the country breakdown from a local IP database
- Scheduled rollups of old click rows into daily aggregates
- Link-in-bio pages and UTM builders

## License

[MIT](LICENSE)
