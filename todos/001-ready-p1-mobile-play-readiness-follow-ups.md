---
status: ready
priority: p1
issue_id: "001"
tags: [mobile, expo, android, auth, deep-linking, play-store]
dependencies: []
---

# Problem Statement

The `react-native` branch has multiple overlapping mobile changes in flight: auth hardening, Android local-tooling setup, billing web handoff, regenerated Android native files, and deletion of the tracked `ios/` tree. The next steps need to be explicit so mobile work can be validated and landed without losing track of Play-readiness gaps.

# Findings

- Android local tooling is now mostly repaired:
  - `mobile:android:doctor` resolves `ANDROID_HOME`, `JAVA_HOME`, and `adb`.
  - Homebrew Android command-line tools plus SDK packages were installed under `/opt/homebrew/share/android-commandlinetools`.
- The Expo scripts now encode a managed-workflow/dev-client path:
  - `apps/mobile/package.json`
  - repo root `package.json`
  - `apps/mobile/scripts/with-android-env.sh`
- Auth/deep-link hardening is partially implemented:
  - `app/_layout.tsx`
  - `src/lib/auth-redirects.ts`
  - `src/lib/auth-storage.ts`
  - `src/lib/url-safety.ts`
  - new auth tests exist but are still unverified in this session.
- Billing remains incomplete relative to the documented handoff plan:
  - Current mobile code opens `/${orgSlug}/settings/billing`
  - Existing plan doc says the canonical web destination is `/${orgSlug}/settings/invites`
  - There is still no verified return-to-app checkout flow.
- The tracked `ios/` project is deleted in the working tree, while Android has been regenerated.
- `dist/` and generated native assets are also dirty and may be noise rather than intentional product changes.

# Proposed Solutions

## Option 1: Land Everything As One Large Mobile Branch

**Pros**
- Fastest path if no additional cleanup is needed

**Cons**
- High review risk
- Hard to separate intentional product changes from generated/native churn
- Easy to ship accidental `ios/` or `dist/` changes

**Effort**
- Medium

**Risk**
- High

## Option 2: Stabilize Tooling First, Then Finish Auth + Billing

**Pros**
- Keeps local Android testing reliable
- Makes auth/deep-link work easier to validate
- Reduces confusion around Play-readiness blockers

**Cons**
- Requires one cleanup pass before feature work continues

**Effort**
- Medium

**Risk**
- Medium

## Option 3: Re-split The Branch Into Tooling, Auth, And Billing Commits

**Pros**
- Best reviewability
- Clearest rollback path
- Easier to isolate generated changes

**Cons**
- More upfront git hygiene work

**Effort**
- Medium to high

**Risk**
- Low

# Recommended Action

Use Option 2 immediately, with Option 3 if the branch is going to be shared or reviewed broadly.

Ordered next steps:

1. Validate the auth hardening work already in the branch.
2. Confirm whether the tracked `ios/` deletions are intentional or should be restored/ignored.
3. Clean up generated `dist/` and native churn that should not ship.
4. Finish the billing web handoff against the actual existing web route.
5. Re-test Android on a real emulator/device and then run an iOS sanity pass if `ios/` remains part of the repo strategy.

# Acceptance Criteria

- [ ] `bun run mobile:android:doctor` passes on the local machine.
- [ ] Android app launches from `bun run mobile:android` or `bun run mobile:run:android` on a real device/emulator.
- [ ] Auth-focused tests pass:
- [ ] `__tests__/lib/auth-redirects.test.ts`
- [ ] `__tests__/lib/auth-storage.test.ts`
- [ ] `__tests__/lib/notifications.test.ts`
- [ ] `__tests__/analytics.test.ts`
- [ ] The team decides whether tracked `ios/` deletion is intentional.
- [ ] Any accidental `dist/` or generated native churn is removed from the final change set.
- [ ] Billing handoff points to a verified web route and copy matches product intent.
- [ ] Deep-link return behavior is either implemented and tested or explicitly tracked as a follow-up blocker.

# Technical Details

Likely files to revisit:

- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/(auth)/login.tsx`
- `apps/mobile/app/(auth)/forgot-password.tsx`
- `apps/mobile/src/lib/auth-redirects.ts`
- `apps/mobile/src/lib/auth-storage.ts`
- `apps/mobile/src/lib/url-safety.ts`
- `apps/mobile/src/components/settings/SettingsBillingSection.tsx`
- `apps/mobile/src/components/settings/SettingsDangerSection.tsx`
- `apps/mobile/app/(app)/(drawer)/[orgSlug]/billing/index.tsx`
- `apps/mobile/app.json`
- `apps/mobile/package.json`
- `apps/mobile/scripts/with-android-env.sh`

# Resources

- `docs/plans/2026-03-16-mobile-web-billing-handoff.md`
- Current branch: `react-native`

# Notes

- The current branch has both product work and environment/tooling work mixed together.
- Web testing is only a rough UI smoke test for mobile and should not be treated as Android/Play behavior validation.

# Work Log

### 2026-04-06 - Created Mobile Next-Steps Tracker

**By:** Codex

**Actions:**
- Reviewed current `react-native` working tree state.
- Confirmed there was no existing `todos/` directory in the repo.
- Read the mobile billing handoff plan in `docs/plans/2026-03-16-mobile-web-billing-handoff.md`.
- Created this todo file to track the next mobile follow-ups.

**Learnings:**
- The most immediate risk is not lack of ideas; it is lack of separation between intentional mobile work and generated/tooling noise.
- Android local setup is now close enough to usable that feature validation should resume there first.
