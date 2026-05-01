---
title: Mobile OAuth Parity with Web — Full Sign-in Provider Coverage and Correctness
type: feat
status: active
date: 2026-04-26
---

# Mobile OAuth Parity with Web — Full Sign-in Provider Coverage and Correctness

## Context

Web (`apps/web`) supports five sign-in paths: email/password, magic link/OTP, Google OAuth, LinkedIn OIDC, and Microsoft Azure SSO. Mobile (`apps/mobile`) currently only ships email/password and Google OAuth (via a server-side handoff). Three of the five web providers are missing on mobile, magic link is missing, and there is no Apple Sign-In — which Apple App Store Review Guideline 4.8 requires once any third-party social login is offered. The recently-merged mobile handoff machinery (`mobile_auth_handoffs` table, `/auth/mobile/google`, `consumeMobileAuthHandoff`) is the right architectural foundation but only Google has been wired through it.

This plan brings mobile to **functional parity with web** for all sign-in services, removes broken/dead paths, hardens the existing handoff flow, and ties the work to verifiable acceptance tests.

## Goals

1. **Provider parity** — mobile supports every sign-in service web supports: email/password, magic link, Google, LinkedIn, Microsoft (and add Apple to satisfy App Store rules).
2. **Same UX surface area** — login and signup screens expose the same options as the web equivalents (subject to platform constraints: Apple-only on iOS, etc.).
3. **One canonical handoff mechanism** — every OAuth provider on mobile uses the existing `mobile_auth_handoffs` flow; no native Google sign-in, no implicit-flow tokens in deep links.
4. **Correctness** — flows that exist today (email/password, Google, password reset, signup with age gate) work end-to-end on a real device build, not just in unit tests.
5. **Test coverage** — every provider has at least one mobile unit test and one web handoff test; we add a smoke E2E that runs through the `teammeet://callback` consumption.

## Out of Scope

- Reworking the web auth UI (changes to web are limited to **adding** new mobile-handoff initiation routes that mirror `/auth/mobile/google`, plus a `mobile=1` branch in any new code paths).
- SMS/phone OTP. Web doesn't support it; not pursuing on mobile either.
- Reworking session storage or cookie strategy.

---

## Current State Audit (from exploration)

### Web sign-in surface — `apps/web`

| Provider | Login entry | Callback entry | Server lib |
|---|---|---|---|
| Email/password | `app/auth/login/LoginClient.tsx:92` (`signInWithPassword`) | n/a | — |
| Magic link / OTP | `app/auth/login/LoginClient.tsx:121` (`signInWithOtp`) | `app/auth/confirm/route.ts` | — |
| Google | `app/auth/login/LoginClient.tsx:159` (`signInWithOAuth`) | `app/auth/callback/route.ts` | — |
| LinkedIn OIDC | `app/auth/login/LoginClient.tsx:185` | `app/auth/callback/route.ts` + `lib/linkedin/oidc-sync.ts` | `lib/linkedin/oauth.ts` |
| Microsoft Azure | `app/auth/login/LoginClient.tsx:200` | `app/auth/callback/route.ts` | `lib/microsoft/sso-config.ts` |
| Forgot password | `app/auth/forgot-password/ForgotPasswordClient.tsx` | `app/auth/confirm/route.ts` (recovery) | — |

The callback route at `apps/web/src/app/auth/callback/route.ts` already handles a `mobile=1` query flag generically: it exchanges the code, runs the age gate, then either inserts a row into `mobile_auth_handoffs` (mobile) or redirects (web). **The provider does not matter to the callback** — only the `mobile=1` flag does. This is critical: every provider can re-use the existing handoff insert in `apps/web/src/app/auth/callback/route.ts:231-253` once we add per-provider initiation routes.

### Mobile sign-in surface — `apps/mobile`

| Provider | Status | Files |
|---|---|---|
| Email/password | Working | `app/(auth)/login.tsx:173`, `app/(auth)/signup.tsx:159` |
| Google | Working via handoff | `app/(auth)/login.tsx:258`, `src/lib/auth-redirects.ts:buildMobileGoogleAuthUrl`, `src/lib/mobile-auth.ts:consumeMobileAuthHandoff` |
| Magic link / OTP | **Missing** | — |
| LinkedIn | **Missing** | — |
| Microsoft | **Missing** | — |
| Apple Sign-In | **Missing** (App Store blocker) | — |
| Forgot password screen | Exists | `app/(auth)/forgot-password.tsx` |
| Reset password screen | Exists | `app/(auth)/reset-password.tsx` |
| Callback / deep-link consumer | Exists | `app/(auth)/callback.tsx`, `app/_layout.tsx:180-289` |

### Handoff infrastructure (already built, ready to extend)

- Migration: `supabase/migrations/20261012000000_mobile_auth_handoffs.sql` — `mobile_auth_handoffs` table + `consume_mobile_auth_handoff` RPC. Provider-agnostic.
- Helpers: `apps/web/src/lib/auth/mobile-oauth.ts` — `buildMobileAuthCallbackUrl`, `buildMobileCallbackDeepLink`, `buildMobileErrorDeepLink`, `buildMobileHandoffInsert`. Provider-agnostic.
- Initiation: `apps/web/src/app/auth/mobile/google/route.ts` — **Google only**. We will mirror this for each provider.
- Consumption API: `apps/web/src/app/api/auth/mobile-handoff/consume/route.ts` — provider-agnostic.
- Mobile consumption: `apps/mobile/src/lib/mobile-auth.ts:consumeMobileAuthHandoff` — provider-agnostic.

### Gaps and known issues

1. **Provider initiation routes missing** for LinkedIn, Microsoft. Need `/auth/mobile/linkedin` and `/auth/mobile/microsoft` mirroring the Google one.
2. **Magic link** has no mobile handoff. Web emails send users to `/auth/confirm?token_hash=…&type=magiclink`, which sets cookies on web — mobile's secure store never receives a session.
3. **Apple Sign-In** is unimplemented and is an iOS submission blocker once any third-party social login ships. Uses native flow + Supabase `signInWithIdToken`, **not** the handoff path (Apple's identity token is consumed locally).
4. **Dead dependency** `@react-native-google-signin/google-signin` (in `apps/mobile/package.json` and `app.json` plugins). Never imported. Adds binary bloat and a useless URL scheme to `Info.plist`.
5. **Universal links** are not configured. Custom scheme `teammeet://` is the only mobile redirect; this is fine for now but means any deep link from email opens a chooser dialog on Android and breaks if scheme is hijacked. Document and defer.
6. **Mobile error UX** when handoff expires (TTL 5 minutes): currently the callback screen just shows a generic error after 8s timeout (`app/(auth)/callback.tsx:setTimeout(8000)`). Needs an explicit handler when `error=expired` or `consume` returns 410.
7. **`detectSessionInUrl: false` on native** is correct, but the `_layout.tsx` deep-link handler at `apps/mobile/app/_layout.tsx:180-289` mixes PKCE code exchange and handoff consumption — needs clearer branching by query param so a future provider can't fall through silently.
8. **Signup age gate** must flow through *every* OAuth provider's mobile handoff, not just Google. The age token is already passed to `buildMobileAuthCallbackUrl` so each new initiation route just needs to forward it through.
9. **Redundant URL builders**: `auth-redirects.ts` has `buildMobileGoogleAuthUrl`. Generalize to `buildMobileOAuthUrl(provider, …)` to avoid copy-paste for each provider.

---

## Architecture

### Single handoff pattern for all OAuth providers

```
[mobile app]
  ↓ WebBrowser.openAuthSessionAsync(url)
[web /auth/mobile/<provider>?mode=login|signup&redirect=…&age_*=…]
  ↓ supabase.auth.signInWithOAuth({ provider, options: { redirectTo: /auth/callback?mobile=1&mode=…&… } })
[provider OAuth screen]
  ↓ provider redirect
[web /auth/callback?mobile=1&code=…]
  ↓ exchangeCodeForSession + age gate + buildMobileHandoffInsert + insert into mobile_auth_handoffs
  ↓ redirect to teammeet://callback?handoff_code=<code>
[mobile Linking listener] → consumeMobileAuthHandoff(code)
  ↓ POST /api/auth/mobile-handoff/consume → access+refresh tokens
  ↓ supabase.auth.setSession({ access_token, refresh_token })
[mobile auth state change → /(app)]
```

### Magic link on mobile (special case, still a handoff)

Magic link emails from Supabase go to `/auth/confirm?token_hash=…&type=magiclink&next=…`. We will:

1. Build `next=/auth/callback?mobile=1&mode=login` so after `verifyOtp` the existing callback route fires (we extend `recovery-confirm-handler` to allow that `next`).
2. The callback route detects `mobile=1`, sees the user already has a session (from `verifyOtp`), and runs the same handoff insert as OAuth.
3. The browser ends on `teammeet://callback?handoff_code=…` and the mobile app picks it up.

Result: magic link is just OAuth-without-the-provider-dance — same handoff plumbing.

### Apple Sign-In (native, not handoff)

Apple is **iOS-native** via `expo-apple-authentication`:

1. Get identity token from Apple via the native module.
2. Call `supabase.auth.signInWithIdToken({ provider: "apple", token: identityToken, nonce })`.
3. Session lands directly in mobile secure store. No web round-trip, no handoff row.

This is the pattern Supabase recommends for iOS Apple Sign-In and it sidesteps the PKCE/nonce problems that the comment in `login.tsx:257` calls out for native Google. Android falls back to the web-handoff path through Apple's web auth (rare; we may simply not show Apple on Android).

---

## Provider Implementation Details

### 1. LinkedIn handoff

**New file:** `apps/web/src/app/auth/mobile/linkedin/route.ts`

- Mirror `apps/web/src/app/auth/mobile/google/route.ts` exactly, swapping `provider: "google"` → `provider: LINKEDIN_OIDC_PROVIDER` (from `apps/web/src/lib/linkedin/config.ts`).
- Reuse `buildMobileAuthCallbackUrl(...)` for `redirectTo`.
- Validate that `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET`/`LINKEDIN_TOKEN_ENCRYPTION_KEY` are set via `lib/linkedin/config.server.ts`; on missing config, return `buildMobileErrorDeepLink("provider_unavailable", "LinkedIn sign-in is not configured")`.
- LinkedIn OIDC sync (`runLinkedInOidcSyncSafe`) already runs in the existing callback at `apps/web/src/app/auth/callback/route.ts:217` — no change needed.

**Mobile changes** in `apps/mobile/src/lib/auth-redirects.ts`:

- Generalize `buildMobileGoogleAuthUrl` → `buildMobileOAuthUrl(provider: "google" | "linkedin" | "microsoft", siteUrl, params)` that returns `${siteUrl}/auth/mobile/${provider}?...`. Keep a thin `buildMobileGoogleAuthUrl` wrapper for now to avoid breaking imports, then remove after one cycle.

**Mobile UI** in `apps/mobile/app/(auth)/login.tsx` and `signup.tsx`:

- Add a "Continue with LinkedIn" button below the Google button.
- Reuse the existing `handleOAuth(provider)` pattern (which calls `WebBrowser.openAuthSessionAsync`).

### 2. Microsoft Azure handoff

**New file:** `apps/web/src/app/auth/mobile/microsoft/route.ts`

- Same pattern as LinkedIn. Provider: `MICROSOFT_SSO_PROVIDER` from `apps/web/src/lib/microsoft/sso-config.ts`.
- Pass `scopes: "openid profile email"` (matches `LoginClient.tsx:212`).

**Mobile UI**: add "Continue with Microsoft" button.

### 3. Apple Sign-In (iOS native)

**Mobile dependency:** `npm i expo-apple-authentication --workspace apps/mobile`. Add `expo-apple-authentication` plugin to `app.json`. Set `usesAppleSignIn: true` under `ios`.

**Mobile new file:** `apps/mobile/src/lib/apple-auth.ts`

- Wraps `AppleAuthentication.signInAsync({ requestedScopes: [FULL_NAME, EMAIL] })`.
- Generates random nonce, hashes with SHA-256 for the request, passes raw nonce to Supabase.
- Calls `supabase.auth.signInWithIdToken({ provider: "apple", token: credential.identityToken, nonce })`.
- Returns `{ user, session }` or throws.

**Mobile UI changes** in `login.tsx` / `signup.tsx`:

- Show Apple button **only when** `Platform.OS === "ios"` and `AppleAuthentication.isAvailableAsync()` resolves true.
- Apple HIG: button must be at least as prominent as other social buttons. Use the official Apple button styling via `AppleAuthentication.AppleAuthenticationButton`.

**Web side:** No change. Apple Sign-In on iOS bypasses web entirely.

**App Store note:** Section 4.8 requires Apple Sign-In whenever Google/LinkedIn/Microsoft are offered. This unblocks the next iOS submission.

### 4. Magic link / OTP

**Mobile UI changes** in `login.tsx`:

- Add a "Send me a link" toggle next to the password field, mirroring `LoginClient.tsx:121-151`. Default to password mode.
- When in magic-link mode, after Turnstile verification, call:
  ```typescript
  supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: buildMobileMagicLinkRedirectTo(siteUrl),
      captchaToken,
    },
  });
  ```
- Show "Check your email" success state. The user opens email on phone → tap link → browser opens → web verifies → web redirects to `teammeet://callback?handoff_code=…` → app picks it up.

**Web changes:**

1. Extend `apps/web/src/app/auth/confirm/route.ts` (or its `recovery-confirm-handler`) so that when `next` points to `/auth/callback?mobile=1&...`, it forwards there instead of just to a path. The current `sanitizeRecoveryNextParam` strips full URLs; relax it to allow same-origin `/auth/callback?mobile=1` specifically.
2. `apps/web/src/app/auth/callback/route.ts` already handles `mobile=1` for sessions that already exist after the OAuth code exchange step — but for magic link, there is no `code` query param, only an existing session. Add a branch: if `mobile=1` and `code` is absent, skip code exchange, fetch the current session via `supabase.auth.getUser()`, and proceed to age gate + handoff insert. If no session, deep-link an error.

**New mobile helper** in `apps/mobile/src/lib/auth-redirects.ts`:

- `buildMobileMagicLinkRedirectTo(siteUrl)` returns `${siteUrl}/auth/confirm?next=${encodeURIComponent("/auth/callback?mobile=1&mode=login")}`.

### 5. Email confirmation for signup (already partially works)

After email signup, Supabase emails the user a confirmation link. The same magic-link plumbing above handles it — just pass `mode=signup` in the embedded `next` URL. Confirm by reading current `apps/mobile/app/(auth)/signup.tsx` to ensure `emailRedirectTo` already uses a callback that ends in `mobile=1`. If not, fix.

### 6. Forgot/reset password on mobile

Already in code at `apps/mobile/app/(auth)/forgot-password.tsx` and `reset-password.tsx`. Verify:

- Forgot password screen calls `resetPasswordForEmail(email, { redirectTo: buildMobileRecoveryRedirectTo(siteUrl, redirect), captchaToken })` with Turnstile.
- The `buildMobileRecoveryRedirectTo` helper points to `/auth/confirm?next=/auth/callback?mobile=1&mode=login&redirect=/(auth)/reset-password` so after `verifyOtp` the user lands back in the mobile app already authenticated, then the mobile app routes to its own `reset-password` screen.
- Mobile `reset-password.tsx` calls `supabase.auth.updateUser({ password })`.

If anything in the existing screens diverges, fix to match this contract.

---

## Correctness Improvements to Existing Flow

### a. Clean up `_layout.tsx` deep-link handler

`apps/mobile/app/_layout.tsx:180-289` currently mixes:
- Trusted-host PKCE code exchange (legacy)
- `teammeet://callback?handoff_code=…` consumption
- `teammeet://callback?error=…` error handling

Refactor into one switch:

```typescript
function handleDeepLink(url: string) {
  const parsed = parseMobileAuthCallbackUrl(url);
  if (parsed.type === "ignored") return;
  if (parsed.type === "error") return showAuthError(parsed.message);
  if (parsed.type === "handoff") return consumeMobileAuthHandoff(parsed.code).then(routeToApp).catch(showAuthError);
}
```

Move PKCE-code exchange behind a clear `parseMobileAuthCallbackUrl` branch (or delete it if no remaining flow uses raw PKCE codes on `teammeet://`).

### b. Tighten error UX on `app/(auth)/callback.tsx`

Replace the blanket 8s timeout with explicit error states from the deep-link handler. Distinguish:
- `expired` — handoff TTL exceeded → "This sign-in link has expired. Please try again."
- `consumed` — code already used → same message.
- `network` — fetch failure → "Couldn't reach the server. Try again."
- `unknown` — anything else.

### c. Drop dead `@react-native-google-signin/google-signin`

- Remove from `apps/mobile/package.json`.
- Remove plugin entry from `apps/mobile/app.json`.
- Remove the `com.googleusercontent.apps.…` URL scheme from `Info.plist` config (it's only there for native sign-in).

### d. Harden `consume_mobile_auth_handoff` migration

Audit flagged `SECURITY DEFINER` functions for `search_path` — current definition is `SET search_path = public`. The `20261008000001_harden_remaining_security_definer_search_paths.sql` migration set the project standard to `SET search_path = ''` (empty) with fully-qualified table refs. **Update the consume function** (in a new migration, never edit existing migrations) to:
```sql
ALTER FUNCTION public.consume_mobile_auth_handoff(text) SET search_path = '';
```
…and adjust the body to reference `public.mobile_auth_handoffs` explicitly.

### e. Add periodic cleanup of expired handoffs

Add a tiny SQL job or scheduled function to delete rows where `expires_at < now() - interval '1 day'`. Either:
- Cron via `pg_cron` if enabled, or
- Lightweight cleanup-on-write inside the RPC (delete a few expired rows opportunistically).

Defer if low-priority; flag in the plan.

---

## File List

### Web — new files

- `apps/web/src/app/auth/mobile/linkedin/route.ts` — LinkedIn mobile OAuth initiation.
- `apps/web/src/app/auth/mobile/microsoft/route.ts` — Microsoft mobile OAuth initiation.
- `supabase/migrations/<next-timestamp>_harden_consume_mobile_auth_handoff.sql` — search_path hardening.

### Web — modifications

- `apps/web/src/app/auth/callback/route.ts` — add no-`code` branch for magic-link mobile flow (use existing session, skip exchange, proceed to handoff insert).
- `apps/web/src/lib/auth/recovery-confirm-handler.ts` (or wherever `sanitizeRecoveryNextParam` lives) — allow `next=/auth/callback?mobile=1&...`.

### Mobile — new files

- `apps/mobile/src/lib/apple-auth.ts` — native Apple Sign-In wrapper.
- `apps/mobile/__tests__/lib/apple-auth.test.ts`.

### Mobile — modifications

- `apps/mobile/src/lib/auth-redirects.ts` — generalize `buildMobileGoogleAuthUrl` → `buildMobileOAuthUrl(provider, …)`; add `buildMobileMagicLinkRedirectTo`; ensure `buildMobileRecoveryRedirectTo` includes `mobile=1`.
- `apps/mobile/app/(auth)/login.tsx` — add LinkedIn, Microsoft, Apple, magic-link mode.
- `apps/mobile/app/(auth)/signup.tsx` — add LinkedIn, Microsoft, Apple buttons (gated on age token).
- `apps/mobile/app/(auth)/callback.tsx` — distinct error states.
- `apps/mobile/app/_layout.tsx` — refactor deep-link handler to a single switch.
- `apps/mobile/package.json` — add `expo-apple-authentication`, remove `@react-native-google-signin/google-signin`.
- `apps/mobile/app.json` — add Apple plugin + `usesAppleSignIn: true`; remove Google native scheme.

### Tests

- `apps/web/tests/mobile-auth-handoff.test.ts` — add cases for LinkedIn and Microsoft initiation routes returning the right `redirectTo`. The handoff insert is provider-agnostic so existing coverage stands.
- `apps/web/tests/auth-callback.test.ts` — add a magic-link mobile branch (no `code`, existing session, `mobile=1` → returns deep link).
- `apps/mobile/__tests__/lib/auth-redirects.test.ts` — add cases for `buildMobileOAuthUrl("linkedin"|"microsoft", …)`, `buildMobileMagicLinkRedirectTo`, error branches of `parseMobileAuthCallbackUrl`.
- `apps/mobile/__tests__/lib/apple-auth.test.ts` — mock `AppleAuthentication.signInAsync`, assert `signInWithIdToken` is called with hashed nonce and identity token.
- `apps/mobile/__tests__/lib/mobile-auth.test.ts` — extend to cover 410/expired and network errors with friendly mapping.

---

## Acceptance Criteria

### Functional

- [ ] Login screen on iOS shows: Email/password, Magic link toggle, Google, LinkedIn, Microsoft, Apple.
- [ ] Login screen on Android shows: Email/password, Magic link toggle, Google, LinkedIn, Microsoft. (Apple optional.)
- [ ] Signup screen mirrors login providers, gated by age gate.
- [ ] Each social button on a real device launches the system browser, completes auth, returns to the app, and lands the user on `/(app)`.
- [ ] Magic link email tapped on the device returns the user to the app authenticated.
- [ ] Forgot password email tapped on the device returns the user to the in-app reset screen authenticated.
- [ ] Apple button on iOS uses native Apple sheet, not a web browser.
- [ ] Expired handoff codes (>5 min) produce a clear "expired, try again" message in-app.
- [ ] Re-using a consumed handoff code produces the same friendly error.
- [ ] No raw access/refresh tokens appear in any deep link URL.

### Non-functional

- [ ] All providers go through the same `buildMobileHandoffInsert` path on web — no parallel implementations.
- [ ] Tests: unit tests for every new helper; integration tests for callback `mobile=1` branches; a smoke test for the consume endpoint.
- [ ] `bun run lint && bun run typecheck` clean across web and mobile.
- [ ] `apps/mobile/app.json` plugin list contains `expo-apple-authentication` and does NOT contain `@react-native-google-signin/google-signin`.
- [ ] Supabase config: LinkedIn OIDC and Microsoft Azure providers enabled; `additional_redirect_urls` includes `teammeet://callback`.

### Security gates

- [ ] `consume_mobile_auth_handoff` runs with `search_path = ''`.
- [ ] `mobile_auth_handoffs` rows older than 1 day are cleaned up (or doc'd as TODO).
- [ ] Apple nonce is generated client-side, hashed with SHA-256 for the Apple request, and the raw nonce is sent to Supabase (per Supabase docs).

---

## Verification Plan

### Local unit + integration

```bash
bun run typecheck
bun run lint
bun run test --cwd apps/web
bun run test --cwd apps/mobile
```

Expect new tests to pass; existing `mobile-auth-handoff.test.ts` and `auth-callback.test.ts` to remain green.

### Local manual — web initiation routes

With `bun dev` + Supabase local stack:

```bash
curl -i "http://127.0.0.1:3000/auth/mobile/google?mode=login&redirect=/app"
curl -i "http://127.0.0.1:3000/auth/mobile/linkedin?mode=login"
curl -i "http://127.0.0.1:3000/auth/mobile/microsoft?mode=login"
```

Each should return a 302 to the corresponding provider's authorization URL with `redirect_uri` pointing at `…/auth/callback?mobile=1&mode=login`.

### Local manual — mobile

Build a development client:

```bash
bun dev:mobile
```

On a real iOS/Android device, tap each social button. After completing auth in the system browser, you should be redirected back into the app and land on `/(app)`. Magic link: trigger `signInWithOtp`, receive email, tap on phone, confirm app opens authenticated.

### Edge-case manual checks

1. Cancel auth in the browser — app shows clear "cancelled" message, not a blank screen.
2. Wait >5 minutes between completing OAuth and the deep-link firing — app shows "expired" not generic 8s timeout.
3. Try the same handoff code twice (open the deep link manually) — second attempt shows friendly error.

### CI

GitHub Actions web and mobile workflows must pass without manual interventions.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Apple Sign-In native module breaks bare workflow | Blocks iOS build | Use the Expo plugin, prebuild on a branch, smoke test before merging |
| LinkedIn/Microsoft Supabase providers not configured in production | Initiation route 500s | Each new route checks env config and returns a clean deep-link error if unconfigured |
| Magic-link `next=` allowlist relaxation introduces open-redirect | Auth bypass | Allow only the literal path prefix `/auth/callback` with `mobile=1` query, validate origin matches site URL |
| Removing `@react-native-google-signin` plugin breaks an iOS scheme another consumer relies on | Surprise app bug | Grep all of `apps/mobile` for the scheme; the package is unimported, so safe to drop |
| Native Apple nonce mismatch with Supabase | 401 on signInWithIdToken | Follow Supabase docs precisely: hash with SHA-256 hex string, raw nonce passed to Supabase |
| Provider deep-links collide on Android with another app's intent | User sees app picker | Document; out of scope for parity but worth a follow-up universal-link plan |

---

## Sources & References

### Internal references

- Web callback route (provider-agnostic mobile branch): `apps/web/src/app/auth/callback/route.ts:231-253`
- Mobile handoff helpers: `apps/web/src/lib/auth/mobile-oauth.ts`
- Google initiation route to mirror: `apps/web/src/app/auth/mobile/google/route.ts`
- Mobile consume API: `apps/web/src/app/api/auth/mobile-handoff/consume/route.ts`
- Mobile consume client lib: `apps/mobile/src/lib/mobile-auth.ts`
- LinkedIn OIDC sync (already runs in callback): `apps/web/src/lib/linkedin/oidc-sync.ts`
- Migration: `supabase/migrations/20261012000000_mobile_auth_handoffs.sql`
- Web login UI to mirror: `apps/web/src/app/auth/login/LoginClient.tsx:159-213`
- Mobile login screen: `apps/mobile/app/(auth)/login.tsx`
- Mobile signup screen: `apps/mobile/app/(auth)/signup.tsx`
- Deep-link handler to refactor: `apps/mobile/app/_layout.tsx:180-289`
- Existing mobile redirect helpers: `apps/mobile/src/lib/auth-redirects.ts`
- Existing mobile tests: `apps/mobile/__tests__/lib/mobile-auth.test.ts`, `apps/mobile/__tests__/lib/auth-redirects.test.ts`

### External references

- Supabase Apple Sign-In on Expo: https://supabase.com/docs/guides/auth/social-login/auth-apple
- Supabase `signInWithIdToken`: https://supabase.com/docs/reference/javascript/auth-signinwithidtoken
- App Store Review Guideline 4.8 (Apple Sign-In requirement): https://developer.apple.com/app-store/review/guidelines/#sign-in-with-apple
- Expo `expo-apple-authentication` docs: https://docs.expo.dev/versions/latest/sdk/apple-authentication/
- Supabase LinkedIn OIDC: https://supabase.com/docs/guides/auth/social-login/auth-linkedin
- Supabase Azure: https://supabase.com/docs/guides/auth/social-login/auth-azure

### Related local memory

- `parents` role pattern (mobile auth state shape compatibility) — see project memory entry on parents feature.
- `Turnstile` migration commit `ba29404d` — establishes captcha pattern for mobile to reuse on every new sign-in path.
