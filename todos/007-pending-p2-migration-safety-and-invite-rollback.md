---
status: pending
priority: p2
issue_id: "007"
tags: [migrations, data-integrity, transactions, invites]
dependencies: []
---

# Migration safety review and parent-invite rollback gap

## Problem Statement

Two recent migrations need pre-deploy verification, and the parent-invite acceptance flow has an incomplete manual rollback path that can leave inconsistent state on partial failure.

## Findings

### MEDIUM — Non-concurrent index creation

`supabase/migrations/20260812000003_perf_hotpath_indexes_and_initplan.sql` creates 5 indexes without `CONCURRENTLY`. This is correct for a Supabase migration file (migrations run in an implicit transaction; `CONCURRENTLY` is disallowed there), but it holds locks during build. `discussion_replies` and `discussion_threads` may be large enough that this blocks writes during the migration window.

### RESOLVED — Index drop without verifying unique constraint independence

`supabase/migrations/20260812000001_drop_unused_indexes.sql` drops `enterprise_invites_token_idx` and `enterprise_invites_code_idx`. Verified against production 2026-04-07: both columns have independent UNIQUE constraints (`enterprise_invites_token_key`, `enterprise_invites_code_key`) backed by their own indexes. A partial index `idx_enterprise_invites_token WHERE revoked_at IS NULL` also covers the active-lookup hot path. Safe to deploy.

### MEDIUM — Parent invite accept rollback gap

`src/app/api/organizations/[organizationId]/parents/invite/accept/route.ts:132` — the manual `rollback` callback only covers the legacy invite-claim path. If `grantParentMembership` fails after `claimOrgInviteUse` succeeds, the invite use is consumed but no membership exists. The user is locked out and the invite cannot be re-redeemed.

## Proposed Solutions

### Migration safety

**Option 1 (RECOMMENDED):** Schedule migration `20260812000003` for an off-peak maintenance window. Migration `20260812000001` verified safe 2026-04-07 — UNIQUE constraints on enterprise_invites are independent of the dropped duplicate indexes.

**Effort:** 30 min for off-peak scheduling.

### Parent invite rollback

**Option 1 (RECOMMENDED):** Move the three-step accept flow into a Postgres RPC (`accept_parent_invite`) so all writes happen in a single transaction.

**Pros:** True atomicity.

**Cons:** Logic moves to PL/pgSQL.

**Effort:** 3-4 hours

---

**Option 2:** Extend the manual rollback to cover `grantParentMembership` failure by deleting the consumed invite use.

**Pros:** Stays in TypeScript.

**Cons:** Manual rollback is fragile and easy to miss when adding new steps.

**Effort:** 1-2 hours

**Risk:** Medium — manual rollback is the pattern that caused the problem in the first place.

---

**Option 3:** Do nothing. Accept rare partial-state on invite accept.

**Cons:** Lockout incidents are customer-visible.

## Recommended Action

- Migration `20260812000001`: ✅ verified safe 2026-04-07, deploy as-is.
- Migration `20260812000003`: schedule off-peak deploy.
- Parent invite: Option 1 (Postgres RPC). The manual-rollback pattern is exactly what gets these flows wrong.

## Technical Details

**Affected files:**
- `supabase/migrations/20260812000001_drop_unused_indexes.sql`
- `supabase/migrations/20260812000003_perf_hotpath_indexes_and_initplan.sql`
- `src/app/api/organizations/[organizationId]/parents/invite/accept/route.ts`

## Acceptance Criteria

- [x] Migration `20260812000001` verified safe (UNIQUE constraints independent of dropped indexes). — 2026-04-07
- [ ] Migration `20260812000003` scheduled for off-peak window with rollback plan.
- [ ] Parent invite accept flow is atomic — partial state impossible.
- [ ] Test covers: invite consumed, membership grant fails → user can re-attempt successfully.

## Resources

- Audit: data-integrity-guardian, 2026-04-06
