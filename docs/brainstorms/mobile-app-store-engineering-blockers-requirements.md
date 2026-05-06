# Mobile App Store Engineering Blockers — Requirements

**Status:** Brainstorm output — ready for `ce-plan` handoff
**Scope:** Items NOT already covered in `app-store-release-readiness-{workbook,requirements}.md`
**Source audit:** Five-agent parallel pass (security, performance, repo/tech-debt, mobile readiness, architecture/DX)
**Date:** 2026-05-05

## 1. Goal

Close the mobile-app-store engineering gaps that the existing release-readiness workbook does not already track. These are code- and config-level issues — distinct from the metadata/ASC items in `app-store-release-readiness-workbook.md` (R1–R20).

## 2. Stated requirements (from user + audit)

- **S1.** Identify engineering blockers/risks for App Store + Play Store submission **not already** in the release-readiness workbook.
- **S2.** Verify each finding by reading source — no speculative claims.
- **S3.** Hand off to `ce-plan` once approved; eventual fix work goes through `ce-work`.
- **S4.** Commit + push findings to `MyTeamNetwork/App` (remote `app`).

## 3. Inferred requirements

- **I1.** Findings remain decoupled — each blocker is a standalone fix with its own PR. Bundling raises review cost.
- **I2.** Workbook (`app-store-release-readiness-workbook.md`) stays the canonical reviewer-facing artifact; this doc is engineering-internal.
- **I3.** Don't introduce new abstractions or refactor adjacent code while fixing each blocker. Surgical only.
- **I4.** OTA (B1) and Sentry (B2) ship before next production submission — they affect ability to triage rejections + recover from a bad build.

## 4. Out of scope

- Workbook items R1–R20 (ASC metadata, screenshots, privacy labels, age rating, UGC controls, payments classification, account deletion, demo account, exact-build smoke test).
- Other audit themes: T1 (security), T3 (architecture/DX), T4 (perf), T5 (hygiene).
- Code fixes themselves — this doc captures findings + approach. `ce-plan` produces the implementation plan.
- Icon alpha-channel concern (audited; `icon.png` is RGB, only Android adaptive icon foreground has alpha — correct per spec).

## 5. Verified findings

### B1 — EAS Update OTA wiring missing (BLOCKER if OTA wanted)

**Symptom:** OTA infrastructure shipped, never invoked.

**Evidence:**
- `apps/mobile/eas.json` — no `channel` key in any profile (development, development-simulator, preview, production).
- `apps/mobile/app/_layout.tsx` — no `Updates.checkForUpdateAsync()` call; no import of `expo-updates` anywhere in `app/` or `src/`.
- `apps/mobile/app.json:268-270` — `updates.url` configured.
- `apps/mobile/package.json:77` — `expo-updates ~29.0.16` declared.

**Impact:** `eas update --branch production` will publish runtime bundles to EAS, but devices will silently no-op because (a) no profile binds a channel, (b) the app never asks. Cannot ship a bug-fix update without a full store re-submission.

**Severity:** BLOCKER if OTA recovery is part of the rollout plan. MEDIUM otherwise.

**Acceptance:**
- Each EAS profile gets an explicit `channel` (`development`, `preview`, `production`).
- Root layout calls `Updates.checkForUpdateAsync()` + `fetchUpdateAsync()` on cold start (post-hydration).
- Failed update fetches are logged via Sentry, not crashed-on.
- Test: publish no-op `eas update` to `production` channel; relaunched device picks it up within one cold start.

---

### B2 — Sentry default-off swallows first-launch + opt-out crashes (HIGH)

**Symptom:** Crashes between app start and telemetry-hydration finish disappear.

**Evidence:**
- `apps/mobile/src/lib/analytics/index.ts:20` — module-level `enabled = !__DEV__` (prod default-on, dev default-off).
- `apps/mobile/src/lib/analytics/index.ts:234-239` — `captureException` returns early when `!enabled || !sdksInitialized`.
- `apps/mobile/src/lib/analytics/sentry.ts:8` — `telemetryEnabled = false` until `setEnabled` is called.
- `apps/mobile/src/lib/analytics/sentry.ts:43-49` — `captureException` returns early when `!initialized || !telemetryEnabled`.
- `apps/mobile/app/_layout.tsx:152-171` — `bootstrapAnalytics()` runs in `useEffect`, calling `hydrateEnabled()` then `initAnalytics()` (which calls `sentry.init()` and `sentry.setEnabled(true)`).
- `apps/mobile/app/_layout.tsx:38-39` — `ErrorBoundary` calls `captureException(error, { context: "RootErrorBoundary" })` during render; render-phase crashes fire before any `useEffect` runs.

**Impact:**
1. Render-phase crashes (the most reviewer-visible kind) fire before `useEffect` runs `initAnalytics()`. `sdksInitialized` is `false`, so `captureException` short-circuits and the event is dropped — even though prod default is enabled.
2. Users with telemetry off (persisted via `hydrateEnabled`) contribute zero crash signal — even when triaging a submission rejection would benefit from it.
3. In `__DEV__`, `enabled = false` initial value masks the bug during dev testing.

**Severity:** HIGH — directly affects ability to diagnose crashes that cause App Review rejections.

**Acceptance:**
- Two clean options for `ce-plan` to choose between:
  - **Option A:** Default-on with explicit opt-out UI in Settings. Privacy policy must reflect.
  - **Option B:** Keep default-off but buffer pre-hydration errors and flush after `hydrateEnabled()` resolves; ErrorBoundary uses the buffer path.
- Test: force a JS crash before hydration finishes → confirm Sentry receives the event after the fix vs. drops it today.

---

### B3 — Dual config (`app.json` + `app.config.ts`) drift surface (MED)

**Symptom:** Two near-parallel Expo config files; only one is loaded.

**Evidence:**
- `apps/mobile/app.json` — 272 lines.
- `apps/mobile/app.config.ts` — 207 lines.
- `app.json:31` — `ios.deploymentTarget: "17.0"` set inline.
- `app.config.ts:184-189` — relies on `expo-build-properties` plugin instead.
- `app.config.ts:3-19` — runs production env preflight; `app.json` does not.
- Expo loads `app.config.ts`, ignores `app.json` (per Expo precedence rules).

**Impact:** Future edits to `app.json` silently disappear. Reviewer surprise factor when the file in source doesn't match what's actually shipped.

**Severity:** MED — not a submission blocker but a sustained foot-gun.

**Acceptance:** One config file. Either delete `app.json` and rely fully on `app.config.ts`, OR delete `app.config.ts` and inline its dynamic bits as a static `app.json` (loses env preflight, so probably option 1). Run `expo prebuild --clean` and confirm `ios/`/`android/` outputs unchanged.

---

### B4 — Deep-link parity gap iOS vs Android (MED)

**Symptom:** Android handles ~20 explicit deep-link paths; iOS uses a catch-all whose AASA file isn't audited.

**Evidence:**
- `apps/mobile/app.json` `ios.associatedDomains` — 2 entries: `applinks:www.myteamnetwork.com`, `applinks:myteamnetwork.com`.
- `apps/mobile/app.json` Android `intentFilters` — explicit paths including `/app/join`, `/auth/callback`, `/.*/{announcements,events,chat,discussions,feed,jobs,mentorship}/.*`.
- AASA file (`https://www.myteamnetwork.com/.well-known/apple-app-site-association`) — existence + contents unverified.

**Impact:** iOS may silently fail to handle paths that Android handles. Reviewer-visible if the demo flow includes a deep link.

**Severity:** MED.

**Acceptance:**
- `curl https://www.myteamnetwork.com/.well-known/apple-app-site-association` returns valid AASA JSON with path coverage matching Android list.
- Physical iOS device deep-link smoke test for at least: announcements, events, chat, auth callback, app/join.

---

### B5 — `NSPhotoLibraryUsageDescription` not literal in `infoPlist` (LOW)

**Symptom:** Permission string shipped via plugin injection, not explicit override.

**Evidence:**
- `expo-image-picker` plugin block injects `photosPermission` at prebuild — string ships.
- `app.config.ts` / `app.json` `infoPlist` block has no explicit `NSPhotoLibraryUsageDescription`.
- Convention in this repo: `NSCameraUsageDescription` is set explicitly (`app.json:46`).

**Impact:** Inconsistent with repo convention. App Review reviewers occasionally flag plugin-injected strings if they read as generic.

**Severity:** LOW.

**Acceptance:** Either add explicit `NSPhotoLibraryUsageDescription` override in `infoPlist` matching the in-product reason, OR document plugin injection as authoritative in `apps/mobile/CLAUDE.md`.

---

## 6. Disconfirmed earlier finding

**Icon alpha channel** — initial pass flagged `assets/icon.png` having alpha. Re-verified with `file`: `icon.png` is RGB no-alpha (correct for iOS). Only `adaptive-icon.png` has alpha, which is correct for Android adaptive icon foreground. **Not a blocker.**

## 7. Approach options

| Option | Mechanism | Trade-off |
|--------|-----------|-----------|
| **A** | Surgical PRs per blocker (B1, B2, B3, B4, B5 separate) | Low coupling, fast review. Most velocity. **Recommended.** |
| **B** | Single "submission-readiness" branch combining B1–B5 + workbook revisits | One reviewer-facing artifact updated atomically. Higher coordination cost. |
| **C** | Defer + document as known issues; ship current build | Only viable if submission window is tight AND items aren't rejection-causing. B1+B2 disqualify this path. |

**Recommendation: A.** B1+B2 first (production observability + recovery mechanism), then B3, B4, B5 as fast-follows.

## 8. Critical files for `ce-plan`

- `apps/mobile/eas.json`
- `apps/mobile/app.json`
- `apps/mobile/app.config.ts`
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/src/lib/analytics/sentry.ts`
- `apps/mobile/src/lib/analytics/index.ts`
- `apps/mobile/package.json`
- Cross-ref only: `docs/brainstorms/app-store-release-readiness-workbook.md`, `app-store-release-readiness-requirements.md`

## 9. Open questions for `ce-plan` / user

1. **OTA scope (B1):** production OTA wanted on day one, or staging-only until rollout pattern stabilizes?
2. **Sentry policy (B2):** default-on (Option A) or default-off + pre-hydration buffer (Option B)?
3. **Config consolidation (B3):** drop `app.json` (keeps env preflight) or drop `app.config.ts` (loses preflight)?
4. **Submission timeline:** hard date driving B1+B2 priority?

## 10. Verification (downstream)

- **B1:** Publish no-op `eas update` to `production` channel; cold-relaunched device picks it up. Log line confirms `Updates.checkForUpdateAsync` ran.
- **B2:** Force JS crash before `hydrateEnabled()` resolves → Sentry receives event after fix; today drops it.
- **B3:** `expo prebuild --clean` after consolidation — diff `ios/`/`android/` outputs vs. pre-consolidation. Zero diff = pass.
- **B4:** `curl` AASA file; `cmp` path list against Android `intentFilters`. Device smoke test on iOS for top 5 paths.
- **B5:** `eas prebuild` then grep `Info.plist` for `NSPhotoLibraryUsageDescription` — either present via override or via plugin (with doc).
