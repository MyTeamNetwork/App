---
status: pending
priority: p2
issue_id: "006"
tags: [refactor, conventions, supabase, zod, security]
dependencies: []
---

# Fix convention drift: service-role usage, raw ssr clients, inline Zod

## Problem Statement

Three documented project conventions are only partially followed across the codebase, weakening the guarantees they exist to provide. Service-role clients are used in places that should run under RLS, two auth routes bypass the project's Supabase wrappers entirely, and roughly half of API routes define inline Zod schemas instead of using `src/lib/schemas`.

## Findings

### Service-role client used in org-scoped pages (bypasses RLS)

- `src/app/[orgSlug]/parents/[parentId]/edit/page.tsx:3` — imports `createServiceClient` in a Server Component that already has an authenticated user context. Should use `createClient` from `@/lib/supabase/server`.
- `src/app/[orgSlug]/feed/[postId]/page.tsx:71` — uses `createServiceClient` only for `fetchMediaForEntities`. The rest of the file correctly uses the authenticated client. The service-role call bypasses RLS for media fetching.

### Raw `@supabase/ssr` instead of project wrappers

- `src/app/auth/signout/route.ts:1,32` — manually instantiates `createServerClient` from `@supabase/ssr` with hand-rolled cookie plumbing.
- `src/app/auth/callback/route.ts:1,46` — same pattern.

These are the only non-wrapper locations using raw `createServerClient` outside the wrapper files themselves. The wrapper at `src/lib/supabase/server.ts` handles cookies correctly and is the place to add future telemetry/refresh logic. Each file is ~25 lines of cookie wiring that disappears when swapped.

### Inline Zod schemas in API routes

72 inline Zod definitions exist across `src/app/api/`, versus 65 imports from `src/lib/schemas`. The CLAUDE.md convention is centralized schemas. Notable example:

- `src/app/api/enterprise/[enterpriseId]/billing/adjust/route.ts:22-25` defines inline enums likely duplicating `src/lib/schemas/enterprise`.

## Proposed Solutions

### Option 1: Three small focused PRs (RECOMMENDED)

**Approach:**
1. Swap the two service-role usages for authenticated clients (verify the queries actually work under RLS).
2. Swap the two auth routes to use the wrapper.
3. Audit inline Zod usages, consolidate duplicates into `src/lib/schemas/`.

**Pros:**
- Each PR is small and reviewable.
- Each closes a different category of drift.

**Cons:**
- Three reviews.

**Effort:** 1-2 hours, 1 hour, 4-6 hours respectively.

**Risk:** Service-role swap is the only one with non-trivial risk (RLS may block the query if policies are missing).

---

### Option 2: Single sweep PR

**Pros:** One review.

**Cons:** Bigger blast radius, harder to roll back individual changes.

**Effort:** 6-8 hours total

**Risk:** Medium

---

### Option 3: Do nothing

**Cons:** Drift compounds. Future code copies the wrong pattern.

## Recommended Action

Option 1, in order:
1. Auth route wrapper swap (lowest risk, immediate cleanup).
2. Service-role removal in `[orgSlug]` pages (verify RLS policies first).
3. Zod consolidation as a slower-burn cleanup.

## Technical Details

**For service-role removal:** Before swapping, verify with `supabase` that RLS policies on `media` (for the feed case) and `parents` (for the parent edit case) allow the authenticated user's read. If they don't, the fix is the policy, not the client choice.

## Acceptance Criteria

- [ ] No `createServiceClient` usage in `src/app/[orgSlug]/**` outside explicit admin paths.
- [ ] `src/app/auth/signout/route.ts` and `src/app/auth/callback/route.ts` use `@/lib/supabase/server`.
- [ ] Inline Zod schema count in `src/app/api/` reduced; duplicates consolidated.
- [ ] No regressions in `npm run test`.

## Resources

- Audit: repo-research-analyst, 2026-04-06
- CLAUDE.md: "Supabase Client Wrappers" and "Schema Validation" sections
