---
status: pending
priority: p1
issue_id: "004"
tags: [tests, security, ssrf, invites]
dependencies: []
---

# Add tests for security-critical untested modules

## Problem Statement

Several high-risk modules in `src/lib/` have zero or near-zero direct test coverage. These are the modules where regressions cause real security or correctness incidents — SSRF protection, invite redemption, write-gating during subscription grace periods, enterprise auth context.

## Findings

| Module | Risk | Why it matters |
|---|---|---|
| `src/lib/schedule-security/safe-fetch.ts` | HIGH | SSRF protection layer. Blocks private IPs, validates redirects, enforces content-type. A regression is a live SSRF vulnerability. The existing `schedule-domain.test.ts` covers allowlist logic, NOT fetch execution. |
| `src/lib/invites/redeemInvite.ts` | HIGH | Primary onboarding path for new members. Direct DB writes with fallback logic. `tests/invite-validation.test.ts` only tests the schema, not the redemption flow. |
| `src/lib/subscription/read-only-guard.ts` | HIGH | Gates writes across 10+ API routes during subscription grace period. |
| `src/lib/auth/enterprise-context.ts` | MEDIUM | Enterprise auth gating. |
| `src/lib/alumni/validate-import-request.ts` | MEDIUM | Alumni CSV import authorization. |
| `src/lib/invites/buildInviteLink.ts` | MEDIUM | Invite link generation. |
| `src/lib/errors/api-wrapper.ts` | MEDIUM | Error boundary, no tests. |

## Proposed Solutions

### Option 1: Tackle highest-risk first (SSRF + invites)

**Approach:** Two focused PRs — one for `safe-fetch.ts` (SSRF), one for `redeemInvite.ts`. Use existing `tests/utils/supabaseStub.ts` pattern for mocking.

**Pros:**
- Closes the two highest-impact gaps.
- Each PR is reviewable in isolation.

**Cons:**
- Other gaps remain.

**Effort:** 4-6 hours per module (2 modules)

**Risk:** Low

---

### Option 2: Full coverage sweep

**Approach:** One initiative covering all 7 modules.

**Pros:** Comprehensive.

**Cons:** Large PR, slower to land.

**Effort:** 2-3 days

**Risk:** Low

---

### Option 3: Do nothing

**Cons:** Continued exposure to silent regressions in security-critical paths.

## Recommended Action

Option 1. Start with `safe-fetch.ts` — SSRF protection without tests is a live risk. Then `redeemInvite.ts`. File the rest as P2 follow-ups.

## Technical Details

**Test cases for `safe-fetch.ts`:**
- Private IPv4 ranges blocked (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x)
- Private IPv6 ranges blocked
- DNS rebinding (resolve to public, then private on second lookup)
- Redirect chains: max depth, redirect to private IP
- Content-type enforcement
- Timeout behavior
- Response size limits (if any)

**Test cases for `redeemInvite.ts`:**
- Valid invite redemption happy path
- Expired invite rejected
- Already-redeemed invite rejected
- Invite for different org rejected
- RPC fallback to direct path
- Concurrent redemption (race condition)

## Acceptance Criteria

- [ ] `safe-fetch.ts` has direct tests covering SSRF blocking, redirect handling, and timeout
- [ ] `redeemInvite.ts` has tests covering happy path, expiration, and double-redemption
- [ ] Both modules reach 80%+ line coverage
- [ ] Tests run as part of `npm run test`

## Resources

- Audit: repo-research-analyst, 2026-04-06
- Existing pattern: `tests/utils/supabaseStub.ts`
