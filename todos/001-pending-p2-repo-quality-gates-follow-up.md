---
status: pending
priority: p2
issue_id: "001"
tags: [quality, tests, lint, build]
dependencies: []
---

# Stabilize repo-wide quality gates outside Falkor feature scope

## Problem Statement

The Falkor people-graph work is landing with its feature tests green, but the repo's global quality gates are still failing for unrelated reasons. That makes it harder to trust branch-level signal and obscures whether future failures are caused by new changes or by existing instability.

## Findings

- `npm run test` still fails on unrelated suites after the Falkor work is green:
  - `tests/age-gate.test.ts` fails the Jan 1 birthday case.
  - `tests/chat-send-regression.test.ts` fails `chat room sends text messages through API`.
  - `tests/components/members/connected-accounts-section-source.test.ts` fails the `showFeedback` source assertion.
  - `tests/dashboard-counts.test.ts` fails stale source-code expectations around member count filters and dynamic rendering.
  - `tests/form-admin-rework.test.ts` still finds `.responses` references.
  - `tests/parent-invite-migrations-regressions.test.ts` expects a different migration ordering.
  - `tests/parents-crud.test.ts` fails schema expectations.
  - `tests/schedule-connectors.test.ts` and `tests/schedule-source-sync.test.ts` fail schedule coverage.
- `npm run lint` fails on existing non-Falkor files, especially Blackbaud-related `no-explicit-any` violations plus a few unused variable errors.
- `npm run build` fails in a network-restricted environment because `next/font` fetches Google Fonts from `fonts.googleapis.com` at build time.

## Proposed Solutions

### Option 1: Triage and fix each failing quality gate directly

**Approach:** Work through the failing tests and lint errors one cluster at a time, then rerun the full suite until it is green.

**Pros:**
- Restores trustworthy repo-wide CI signal.
- Removes noise for future feature work.

**Cons:**
- Touches multiple unrelated domains.
- Higher coordination risk if some failures are mid-refactor work.

**Effort:** 1-2 days

**Risk:** Medium

---

### Option 2: Split into focused follow-up issues by domain

**Approach:** Create separate tasks for age gate, chat, connected accounts, dashboard counts, form admin, parents, schedule, lint debt, and offline build behavior.

**Pros:**
- Easier prioritization and ownership.
- Lower risk of a single large cleanup branch.

**Cons:**
- More tracking overhead.
- Repo-wide red state may linger longer.

**Effort:** 2-4 hours for triage, then distributed implementation

**Risk:** Low

---

### Option 3: Do nothing for now

**Approach:** Accept the current repo-wide failures and continue landing scoped feature work with targeted verification only.

**Pros:**
- No immediate interruption to roadmap work.

**Cons:**
- CI signal remains noisy.
- Future regressions are harder to identify quickly.

**Effort:** None

**Risk:** High

## Recommended Action

Prefer Option 2. Split the repo-wide failures into focused follow-ups, starting with the red tests that affect frequently touched product areas, then address the offline `next/font` build behavior separately so local and sandbox builds are reproducible.

## Technical Details

**Affected commands:**
- `npm run lint`
- `npm run test`
- `npm run build`

**Related areas:**
- Blackbaud integration files
- AI/chat tests
- dashboard count source assertions
- schedule connectors
- parent and form schema flows
- app font loading in `src/app/layout.tsx`

## Resources

- Feature branch: `codex/falkor-people-graph`
- Verification commands run during Falkor implementation:
  - `node --test --loader ./tests/ts-loader.js tests/routes/ai/chat-handler-tools.test.ts tests/routes/ai/chat-handler.test.ts tests/routes/ai/tool-definitions.test.ts tests/routes/ai/tool-executor.test.ts tests/ai-tool-grounding.test.ts tests/ai-cron-routes.test.ts tests/falkordb-people-graph.test.ts`
  - `npm run lint`
  - `npm run test`
  - `npm run build`

## Acceptance Criteria

- [ ] Repo-wide failing tests are triaged into owned follow-up work or fixed.
- [ ] `npm run lint` passes, or remaining failures are intentionally excluded and documented.
- [ ] `npm run test` passes consistently in local/CI environments.
- [ ] `npm run build` succeeds in the intended build environment, including any offline/sandbox expectations.

## Work Log

### 2026-03-24 - Falkor landing follow-up capture

**By:** Codex

**Actions:**
- Ran targeted Falkor/AI tests and confirmed the new graph feature path is green.
- Ran `npm run lint`, `npm run test`, and `npm run build`.
- Captured unrelated gate failures so they do not get lost during Falkor rollout.

**Learnings:**
- The Falkor feature itself is not the source of the remaining repo-wide failures.
- Offline build environments need a plan for `next/font` Google Fonts fetching.

## Notes

- This todo intentionally excludes the Falkor people-graph implementation itself, which has focused feature coverage and passing targeted tests.
