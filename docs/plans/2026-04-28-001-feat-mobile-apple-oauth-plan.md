---
title: Implement Apple OAuth in the Mobile App
type: feat
status: completed
date: 2026-04-28
---

# Implement Apple OAuth in the Mobile App

## Overview

Add Sign in with Apple to the Expo mobile app so iOS users can authenticate with their Apple ID from the native login and signup screens. The app already offers third-party social login on mobile through Google, LinkedIn, and Microsoft, so Apple support is both a product parity improvement and an App Store review requirement.

The implementation should use native iOS Apple Authentication via `expo-apple-authentication`, then exchange Apple’s identity token with Supabase using `supabase.auth.signInWithIdToken({ provider: "apple", token, nonce })`. This keeps Apple separate from the existing web-handoff OAuth flow used by Google, LinkedIn, and Microsoft.

## Problem Statement / Motivation

Mobile login currently supports email/password plus Google, LinkedIn, and Microsoft in `apps/mobile/app/(auth)/login.tsx`. Mobile signup supports the same social providers behind the age gate in `apps/mobile/app/(auth)/signup.tsx`. Apple Sign-In is absent.

Apple App Store Review Guideline 4.8 requires apps that offer third-party social login to also offer Sign in with Apple unless an exception applies. Expo’s current Apple Authentication docs also call this out for apps with third-party auth options. Without this feature, the next iOS submission is at risk.

## Proposed Solution

Implement Apple as an iOS-only native provider:

1. Add `expo-apple-authentication` to the mobile workspace and configure the Expo app for Apple Sign-In.
2. Add a small mobile auth helper in `apps/mobile/src/lib/apple-auth.ts` that owns nonce generation, native Apple credential retrieval, Supabase `signInWithIdToken`, and optional first-login name metadata updates.
3. Add an Apple button to login and signup screens only when `Platform.OS === "ios"` and `AppleAuthentication.isAvailableAsync()` returns true.
4. Preserve signup age-gate behavior by blocking Apple signup until the age gate has produced an allowed `ageGate` result, then passing age metadata into Supabase user metadata after Apple auth succeeds.
5. Add focused unit tests for helper behavior and UI/platform gating where practical.
6. Update mobile auth docs and App Store setup notes.

## Technical Considerations

- **Native, not web handoff:** Supabase recommends native Sign in with Apple capabilities for Expo/native platforms. Do not route Apple through `/auth/mobile/<provider>` unless Android Apple support is intentionally added later.
- **Nonce handling:** Generate a raw nonce client-side, hash it for the Apple request if required by the chosen API shape, and pass the raw nonce to Supabase. Supabase requires the nonce for Apple native sign-in.
- **Name metadata:** Apple only returns full name on first authorization. If `credential.fullName` is present, persist it immediately with `supabase.auth.updateUser({ data: ... })`.
- **Availability:** `expo-apple-authentication` is iOS/tvOS only and does not support Android or web. Only render the official Apple button when available.
- **Button compliance:** Use `AppleAuthentication.AppleAuthenticationButton`, not a custom `Pressable`, because Expo docs state the App Store guidelines require the official component to start the flow.
- **Signup age gate:** Email/social signup already blocks under-13 users through `validateSignupAge()`. Apple signup must keep the same boundary before initiating native Apple auth.
- **Supabase provider setup:** `supabase/config.toml` currently has `[auth.external.apple] enabled = false`; production Supabase Auth needs Apple configured and enabled outside code.

## System-Wide Impact

- **Interaction graph:** User taps Apple button -> native Apple sheet returns identity token -> `apple-auth.ts` calls Supabase Auth -> Supabase persists session in secure storage through the existing mobile client -> `AuthContext` receives auth state change -> app routes to `/(app)`.
- **Error propagation:** Apple cancellation should be silent or low-noise; missing identity token, Supabase errors, and network failures should surface through existing `apiError`, toast, and analytics patterns in login/signup.
- **State lifecycle risks:** If Apple auth succeeds but metadata update fails, the session should remain valid and the metadata failure should be captured without signing the user out.
- **API surface parity:** Apply to both `login.tsx` and `signup.tsx`; signup must not bypass age verification.
- **Integration test scenarios:** Native Apple auth must be smoke tested on a real iOS device or dev client build. Expo docs note some credential-state checks need a real device.

## Implementation Plan

### Phase 1: Dependencies and App Config

- Add `expo-apple-authentication` with the Expo-managed installer from the mobile workspace.
- Update `apps/mobile/app.json`:
  - Add the `expo-apple-authentication` config plugin.
  - Set `ios.usesAppleSignIn` to `true`.
  - Keep existing bundle ID `com.myteamnetwork.teammeet`.
- Confirm Apple Developer App ID for `com.myteamnetwork.teammeet` has the Sign in with Apple capability enabled.
- Enable/configure Apple provider in Supabase Auth for the deployed project. Treat `supabase/config.toml` as local reference only unless self-hosting/local auth depends on it.

### Phase 2: Mobile Apple Auth Helper

Create `apps/mobile/src/lib/apple-auth.ts`.

Responsibilities:

- Check availability with `AppleAuthentication.isAvailableAsync()`.
- Generate a nonce/state value with `expo-crypto` or an existing secure helper.
- Call `AppleAuthentication.signInAsync()` requesting `FULL_NAME` and `EMAIL`.
- Require `credential.identityToken`; throw a friendly error if missing.
- Call `supabase.auth.signInWithIdToken({ provider: "apple", token: credential.identityToken, nonce })`.
- If Apple returns `fullName`, format and persist:

```typescript
await supabase.auth.updateUser({
  data: {
    full_name: formattedName,
    given_name: credential.fullName.givenName,
    family_name: credential.fullName.familyName,
  },
});
```

- Export separate entry points if useful:
  - `isAppleAuthAvailable()`
  - `signInWithApple()`
  - `signUpWithApple(ageGate)`

### Phase 3: Login UI

Update `apps/mobile/app/(auth)/login.tsx`.

- Import `AppleAuthentication`, `Platform`, and the helper.
- Track Apple loading without breaking the existing `socialLoading: MobileOAuthProvider | null` type. Prefer a separate `appleLoading` boolean over expanding `MobileOAuthProvider`, since Apple does not use `buildMobileOAuthUrl`.
- Add an official Apple button below the divider and above or alongside other social providers when available.
- On success, call `track("user_logged_in", { method: "apple" })`.
- On cancellation (`ERR_REQUEST_CANCELED`), clear loading and leave the user on the form without an error banner.
- On failure, capture analytics and show the existing API error pattern.

### Phase 4: Signup UI and Age Gate

Update `apps/mobile/app/(auth)/signup.tsx`.

- Render the Apple button only during the `registration` step after the user has passed the age gate.
- If `ageGate` is missing, show the existing age-gate error and return before opening Apple auth.
- After successful Apple sign-in, persist age metadata using `supabase.auth.updateUser({ data: { age_bracket, is_minor, age_validation_token } })`.
- Track `track("user_signed_up", { method: "apple" })`.
- Handle cancellation silently and errors through the existing `apiError` state.

### Phase 5: Tests

Add or update focused tests:

- `apps/mobile/__tests__/lib/apple-auth.test.ts`
  - Mocks `expo-apple-authentication`, `expo-crypto`, and `supabase`.
  - Asserts unavailable platforms return false.
  - Asserts cancellation is distinguishable from real errors.
  - Asserts missing identity token throws a friendly error.
  - Asserts Supabase receives provider `apple`, identity token, and nonce.
  - Asserts first-login full name metadata is saved when present.
- Login/signup component tests if the repo has a stable pattern for auth screen rendering; otherwise include manual dev-client verification as the quality gate.

### Phase 6: Docs and Release Checklist

- Update `docs/MobileAuth.md` to include Apple in the status matrix and architecture notes.
- Update `apps/mobile/CLAUDE.md` App Store section if needed with Apple provider setup notes.
- Document Supabase dashboard requirements:
  - Authentication -> Providers -> Apple enabled.
  - Apple Service ID / secret configured if web Apple auth is later enabled.
  - Native iOS Sign in with Apple configured for the bundle ID.
- Add a manual QA checklist for iOS dev client and TestFlight.

## Acceptance Criteria

- [ ] `apps/mobile/package.json` includes `expo-apple-authentication` installed at the Expo SDK 54-compatible version.
- [ ] `apps/mobile/app.json` enables the Apple Sign-In capability for iOS and includes the Expo Apple Authentication plugin.
- [ ] `apps/mobile/src/lib/apple-auth.ts` implements native Apple auth through Supabase `signInWithIdToken`.
- [ ] Login screen shows an official Apple button on supported iOS builds and hides it on Android/web.
- [ ] Signup screen shows an official Apple button only after the age gate passes.
- [ ] Apple login creates a persisted Supabase session and routes through existing `AuthContext` into `/(app)`.
- [ ] Apple signup stores age metadata consistently with email/social signup.
- [ ] User cancellation does not produce an error banner or captured exception.
- [ ] Real errors are captured through existing analytics and shown through existing UI patterns.
- [ ] First-login Apple full name is saved when Apple provides it.
- [ ] Unit tests cover helper success, cancellation, missing token, metadata update, and platform availability behavior.
- [ ] `bun --filter @teammeet/mobile typecheck` and relevant Jest tests pass.
- [ ] iOS dev-client or TestFlight smoke test proves the native Apple sheet opens and completes sign-in.

## Success Metrics

- iOS App Store submission no longer has a Sign in with Apple compliance blocker.
- iOS users can complete Apple login/signup without leaving the app for a browser handoff.
- Apple auth errors appear in analytics with enough context to debug provider/configuration issues.

## Dependencies & Risks

- **Apple Developer access:** Requires App ID capability changes for Teamra LLC / bundle ID `com.myteamnetwork.teammeet`.
- **Supabase configuration:** Apple provider must be enabled in the production Supabase project before release.
- **Expo native rebuild:** Adding the native module and entitlement requires a new dev client / EAS build; Expo Go is not sufficient for final validation.
- **Nonce mismatch:** Incorrect nonce hashing/raw nonce pairing will cause Supabase auth failures. Follow Supabase’s current Apple native sign-in docs precisely during implementation.
- **Metadata race:** Name and age metadata updates happen after session creation. Failure should be captured and retried manually if needed, but should not invalidate login.
- **Simulator limits:** Some Apple credential-state behavior must be tested on a real device.

## Out of Scope

- Adding Apple login to the web app.
- Android Apple login through `@invertase/react-native-apple-authentication`.
- Reworking Google/LinkedIn/Microsoft mobile web-handoff flows.
- Replacing existing email/password or Turnstile flows.

## Verification Plan

Run local checks:

```bash
bun --filter @teammeet/mobile typecheck
bun --filter @teammeet/mobile test -- __tests__/lib/apple-auth.test.ts
```

Run native validation:

```bash
cd apps/mobile
bun expo run:ios
```

Manual scenarios:

- Login screen on iOS shows Apple, Google, LinkedIn, Microsoft, and email/password.
- Login screen on Android/web does not show Apple.
- Apple login cancel returns to the login screen without an error.
- Apple login success routes to the authenticated app.
- Signup under 13 remains blocked before Apple auth opens.
- Signup 13-17 and 18+ can open Apple auth after age validation.
- New Apple account receives age metadata and, when Apple provides it, name metadata.

## Sources & References

- Internal auth plan: `docs/plans/2026-04-26-001-feat-mobile-oauth-parity-with-web-plan.md`
- Mobile login screen: `apps/mobile/app/(auth)/login.tsx`
- Mobile signup screen: `apps/mobile/app/(auth)/signup.tsx`
- Mobile Supabase client: `apps/mobile/src/lib/supabase.ts`
- Mobile auth redirects: `apps/mobile/src/lib/auth-redirects.ts`
- Mobile auth handoff helper: `apps/mobile/src/lib/mobile-auth.ts`
- Existing mobile auth tests: `apps/mobile/__tests__/lib/auth-redirects.test.ts`, `apps/mobile/__tests__/lib/deep-link.test.ts`
- Local Apple provider config reference: `supabase/config.toml`
- Supabase Apple auth docs: https://supabase.com/docs/guides/auth/social-login/auth-apple
- Supabase JavaScript `signInWithIdToken` docs: https://supabase.com/docs/reference/javascript/auth-signinwithidtoken
- Expo Apple Authentication docs: https://docs.expo.dev/versions/latest/sdk/apple-authentication
- Apple Authentication Services docs: https://developer.apple.com/documentation/authenticationservices
- Apple App Store Review Guideline 4.8: https://developer.apple.com/app-store/review/guidelines/#sign-in-with-apple
