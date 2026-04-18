---
status: pending
priority: p0
issue_id: "002"
tags: [security, auth, payments, supabase, data-integrity]
dependencies: []
---

# Fix silent Supabase error cluster in auth and Stripe webhooks

## Problem Statement

Multiple authorization-gating and payment-critical Supabase queries destructure only `data` without capturing `error`. A transient DB error returns `{ data: null, error: {...} }` and is treated identically to "no row found." This silently masks failures, can cause privilege downgrades, and lets Stripe webhooks return 200 on writes that never happened — preventing Stripe from retrying.

Both the repo-research-analyst and data-integrity-guardian audits independently flagged this cluster as the highest-priority issue.

## Findings

### CRITICAL — Auth role checks swallow errors

- `src/lib/auth/roles.ts:61` — `getOrgRole` destructures only `{ data }`. A DB error returns `null`, indistinguishable from "user has no role." Every org-scoped page calls this. A transient error causes a valid admin to be treated as an outsider.
- `src/lib/parents/auth.ts:13` — `getOrgMemberRole` has the same pattern on `user_organization_roles`.

### HIGH — Stripe webhook lookups silently skip

- `src/app/api/stripe/webhook/handler.ts:216` — `handleEnterpriseSubscriptionUpdate` lookup of `enterprise_subscriptions` swallows error. A failed lookup is treated as "not an enterprise subscription" and the status update is silently skipped.
- `src/app/api/stripe/webhook/handler.ts:268` — `handleEnterprisePaymentFailed` has the same pattern.

### HIGH — Stripe webhook UPDATEs discard return value

- `src/app/api/stripe/webhook/handler.ts:252` — enterprise subscription update awaited without destructuring `{ error }`. If the update fails, the webhook returns 200, Stripe marks the event processed, and the row stays stale with no log entry.
- `src/app/api/stripe/webhook/handler.ts:277` — same pattern in payment-failed handler.

### HIGH — Provisioner existence check swallows error

- `src/lib/stripe/org-provisioner.ts:154` — `ensureSubscriptionSeed` checks for an existing row without capturing `error`. A DB error causes a duplicate insert attempt, surfacing as a unique constraint violation rather than the underlying error.

### Additional instances flagged by audit

- `src/lib/payments/idempotency.ts:47, 57, 234`
- `src/lib/payments/webhook-handlers.ts:123`
- `src/lib/auth.ts:27`
- `src/lib/stripe/org-provisioner.ts:54`

## Proposed Solutions

### Option 1: Fix all instances in one sweep (RECOMMENDED)

**Approach:** Single PR that destructures `{ data, error }` everywhere flagged, throws or returns 500 on error, and adds a `resolveCheck({ data, error })` helper to `src/lib/supabase/` for reuse. Add unit tests proving each guard fails closed when the underlying query errors.

**Pros:**
- Single review surface for a recurring bug class.
- Establishes the pattern for future code.
- Both audits flagged this as top priority.

**Cons:**
- Touches multiple domains (auth, payments, webhooks).

**Effort:** 2-4 hours

**Risk:** Low — fail-closed by definition, every change is more conservative than the current behavior.

---

### Option 2: Fix per-domain in separate PRs

**Approach:** Auth fixes in one PR, Stripe fixes in another, payments in a third.

**Pros:** Smaller PRs, easier rollback.

**Cons:** Three reviews, slower close.

**Effort:** 4-6 hours total

**Risk:** Low

---

### Option 3: Do nothing

**Approach:** Leave as-is.

**Pros:** None.

**Cons:** Live privilege-downgrade and webhook-silent-failure risk. This bug class has bitten the project at least twice already (per MEMORY.md).

**Effort:** None

**Risk:** HIGH

## Recommended Action

Option 1. Single PR. Extract a `resolveCheck` helper. Add a test for each guard proving it fails closed on injected DB errors.

## Technical Details

**Affected files:**
- `src/lib/auth/roles.ts`
- `src/lib/parents/auth.ts`
- `src/lib/auth.ts`
- `src/lib/payments/idempotency.ts`
- `src/lib/payments/webhook-handlers.ts`
- `src/lib/stripe/org-provisioner.ts`
- `src/app/api/stripe/webhook/handler.ts`

**Pattern reference:** `src/lib/auth/api-helpers.ts:getOrgMembership` already does this correctly — use as the template.

## Acceptance Criteria

- [ ] Every flagged query destructures `{ data, error }` and handles `error` explicitly.
- [ ] Stripe webhook handlers return non-200 (or throw) when an UPDATE fails, allowing Stripe retry.
- [ ] Unit tests cover the fail-closed behavior of each auth guard.
- [ ] No regressions in `npm run test`.

## Resources

- Audit: repo-research-analyst + data-integrity-guardian, 2026-04-06
- MEMORY.md: "Always fail closed on authorization-gating queries" and "Silent Supabase errors"
