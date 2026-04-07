---
status: pending
priority: p2
issue_id: "005"
tags: [refactor, code-quality, stripe, ai]
dependencies: []
---

# Split oversized API handlers (Stripe webhook, AI chat, billing adjust)

## Problem Statement

Three API handler files exceed or approach the 800-line ceiling and concentrate too much branching logic in one place. Adding any new event type or rule requires editing a giant file, and unit-testing individual code paths is impractical.

## Findings

| File | Lines | Issue |
|---|---|---|
| `src/app/api/ai/[orgId]/chat/handler.ts` | 980 | Largest file in repo. 96+ conditional branches. Routing and execution logic merged. |
| `src/app/api/stripe/webhook/handler.ts` | 791 | 8 webhook event types handled inline. `reconcileSubscriptionFromStripe` at line 67 is 95 lines. 96 branches in 791 lines (~1 every 8 lines). |
| `src/app/api/enterprise/[enterpriseId]/billing/adjust/route.ts` | 751 | 42 `if` blocks. `retryDbWrite` at line 51 is a generic helper that should live in `src/lib/`. |
| `src/lib/falkordb/suggestions.ts` | 787 | Approaching the 800-line ceiling. |

## Proposed Solutions

### Option 1: Split Stripe webhook handler first (RECOMMENDED)

**Approach:** Extract each webhook event into `src/lib/payments/webhook/handlers/[eventType].ts`. Move `reconcileSubscriptionFromStripe` to `src/lib/stripe/`. The top-level `handler.ts` becomes a dispatcher only.

**Pros:**
- Highest immediate value — webhook handler is the most security-sensitive of the three.
- Enables unit-testing each handler in isolation (currently impossible).
- Pattern can be reused for the other two files.

**Cons:**
- Touches a critical payment path. Needs careful review.

**Effort:** 3-5 hours

**Risk:** Medium — payment code changes always require care.

---

### Option 2: Tackle all three at once

**Approach:** One refactor sprint splitting all three.

**Pros:** Done in one pass.

**Cons:** Large blast radius. Hard to review.

**Effort:** 1-2 days

**Risk:** Medium-high

---

### Option 3: Do nothing

**Cons:** Files keep growing. Each new feature compounds the problem.

## Recommended Action

Option 1. Start with the Stripe webhook split. Use it as the template. File 005a / 005b for the AI chat handler and billing adjust route as separate follow-ups once the pattern is proven.

## Technical Details

**Target structure for Stripe webhook:**

```
src/app/api/stripe/webhook/
  handler.ts                    # dispatcher only, <100 lines
  route.ts                      # unchanged
src/lib/payments/webhook/
  handlers/
    customer-subscription-updated.ts
    customer-subscription-deleted.ts
    invoice-payment-succeeded.ts
    invoice-payment-failed.ts
    enterprise-subscription-update.ts
    enterprise-payment-failed.ts
    ...
  dispatch.ts                   # event-type → handler map
src/lib/stripe/
  reconcile-subscription.ts     # extracted from handler.ts:67
```

**Pre-refactor:** Issue 002 should land first so the silent-error fixes don't get tangled with restructuring.

## Acceptance Criteria

- [ ] `src/app/api/stripe/webhook/handler.ts` is under 200 lines.
- [ ] Each webhook event handler is independently unit-testable.
- [ ] Existing webhook integration tests still pass.
- [ ] At least one new unit test per extracted handler.

## Resources

- Audit: repo-research-analyst, 2026-04-06
