# Testing Patterns

**Last Updated:** 2026-07-12

## Test Framework

- Runner: Node.js built-in test runner (`node:test`)
- Assertions: `node:assert/strict`
- TypeScript loader: `apps/web/tests/register-ts-loader.mjs` registers the custom `ts-loader.mjs` (see [TypeScript loader strategy](#typescript-loader-strategy))
- E2E: Playwright (`@playwright/test`)
- Property-based testing: `fast-check`

## Run Commands

```bash
bun run test
bun run --cwd apps/web test:unit
bun run --cwd apps/web test:security
bun run --cwd apps/web test:payments
bun run --cwd apps/web test:schedules
bun run --cwd apps/web test:routes
bun run --cwd apps/web test:jobs
bun run --cwd apps/web test:media
bun run --cwd apps/web test:qrcode
bun run test:e2e
bun run --cwd apps/web test:e2e:ui
bun run --cwd apps/web test:e2e:debug
```

Single-file example:

```bash
cd apps/web && node --import ./tests/register-ts-loader.mjs --test tests/payment-idempotency.test.ts
```

Enterprise example:

```bash
cd apps/web && node --import ./tests/register-ts-loader.mjs --test tests/enterprise/*.test.ts tests/routes/enterprise/*.test.ts
```

## Current Inventory Snapshot

- Total files under `apps/web/tests/`: 575
- Tests are not colocated with source files
- Route simulation suites live under `tests/routes/`

Current route test directories:

- `admin`
- `analytics`
- `calendar`
- `chat`
- `cron`
- `dev-admin`
- `discussions`
- `enterprise`
- `feed`
- `feedback`
- `jobs`
- `notifications`
- `organizations`
- `schedules`
- `stripe`

## Layout

```text
tests/
├── *.test.ts
├── enterprise/
├── routes/
│   ├── admin/
│   ├── analytics/
│   ├── calendar/
│   ├── chat/
│   ├── cron/
│   ├── dev-admin/
│   ├── discussions/
│   ├── enterprise/
│   ├── feed/
│   ├── feedback/
│   ├── jobs/
│   ├── notifications/
│   ├── organizations/
│   ├── schedules/
│   └── stripe/
├── e2e/
│   ├── auth.setup.ts
│   ├── fixtures/
│   ├── page-objects/
│   └── specs/
├── fixtures/
├── utils/
├── register-ts-loader.mjs
└── ts-loader.mjs
```

## Common Patterns

- Unit and integration tests are mostly flat top-level `test()` calls.
- Route tests usually simulate handler behavior directly instead of making real HTTP requests.
- Each test creates fresh state instead of relying on `beforeEach` / `afterEach`.
- `tests/utils/supabaseStub.ts` is the primary in-memory database stub.
- `tests/utils/stripeMock.ts` provides typed Stripe factories.
- `tests/utils/authMock.ts` provides role and auth presets.

## Notes

- `playwright.config.ts` defines `e2e-setup` and `e2e` projects.
- There is no committed `tests/routes/auth/` directory.
- `playwright.config.ts` still references an `audit-crawler` project whose `tests/audit/` suite was removed — running `--project=audit-crawler` will fail. See `docs/audit-setup.md` for the replacement plan.

---

## TypeScript Loader Strategy

The current path is the custom `apps/web/tests/ts-loader.mjs`, registered by `apps/web/tests/register-ts-loader.mjs`. It keeps `@/` path alias resolution, rewrites the small set of `next/*` imports used by tests, and sets test-only rate-limit environment flags. The package scripts invoke the registering loader directly; keep direct test commands consistent with that path.

## Coverage Reporting

`node:test` has built-in coverage since Node 22.

```bash
cd apps/web && node --import ./tests/register-ts-loader.mjs --test \
     --experimental-test-coverage \
     --test-reporter=lcov --test-reporter-destination=coverage/lcov.info \
     --enable-source-maps \
     'tests/**/*.test.ts'
```

`--enable-source-maps` is required for correct line numbers under TypeScript. If coverage is flaky or you need consolidated HTML reports, fall back to `c8`:

```bash
bunx c8 --reporter=lcov --reporter=html node --import ./tests/register-ts-loader.mjs --test 'tests/**/*.test.ts'
```

## Route-Handler Testing

Three options, pick per test:

1. **Direct import** (current default).
   ```ts
   import { POST } from "@/app/api/x/route";
   const res = await POST(new Request("http://localhost/api/x", { … }));
   ```
   Fast, zero deps. **Limitation:** no Next runtime — `cookies()` / `headers()` / `NextResponse.redirect()` won't work without manual shims.
2. **[`next-test-api-route-handler`](https://www.npmjs.com/package/next-test-api-route-handler) (NTARH)**. Emulates Next runtime; use when the handler relies on `cookies()`, redirects, or middleware-dependent behavior.
3. **Supertest + live dev server**. Rare; defer to Playwright E2E for end-to-end coverage.

## Playwright Auth & Roles

- Storage state reuse is already configured via the `e2e-setup` → `e2e` project dependency.
- Per-role storage states (one file per role: admin / active_member / alumni / parent) is the scaling path when role-specific flows grow.
- Verify `playwright/.auth/` is in `.gitignore`. Storage-state JSON contains bearer tokens.
