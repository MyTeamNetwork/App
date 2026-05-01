---
title: "fix: Mobile login Turnstile captcha"
type: fix
status: active
date: 2026-04-25
origin: /Users/louisciccone/.claude/plans/when-i-try-to-shimmering-floyd.md
---

# fix: Mobile login Turnstile captcha

## Overview

Mobile users cannot sign in or sign up. Every attempt fails with `"captcha verification process failed"`. Production Supabase Auth was reconfigured to **Cloudflare Turnstile** during the `0313cab7` cutover on `main`, and now requires every auth call to include a `captchaToken`. The mobile app's `signInWithPassword` and `signUp` calls don't pass one — there is no captcha widget on the mobile auth screens.

Fix: add a Turnstile verification step on the mobile login and sign-up screens, modelled after the existing mobile `HCaptcha` modal used by donations. Submit gets gated on a Turnstile token; we then forward that token to Supabase. Donations stay on hCaptcha — they don't go through Supabase Auth.

## Problem Statement

- **What's broken:** Mobile email/password login (`apps/mobile/app/(auth)/login.tsx:189`) and signup (`apps/mobile/app/(auth)/signup.tsx:166`) call Supabase without `options.captchaToken`.
- **Why it broke:** Supabase Auth project setting is now Turnstile. Any auth call without a Turnstile token gets rejected with the generic `captcha verification process failed` error.
- **User impact:** No mobile user can sign in or create an account. Total mobile auth outage.
- **Web on this branch (`react-native`):** Still on hCaptcha — likely also broken in production. **Out of scope here**, but flagged so it doesn't get lost.

## Proposed Solution

Mirror the existing `apps/mobile/src/components/HCaptcha.tsx` modal pattern, but for Cloudflare Turnstile. Render Turnstile inside a `react-native-webview` (already installed at v13.15.0) using a tiny inline HTML doc that loads `challenges.cloudflare.com/turnstile/v0/api.js`. Bridge widget callbacks to React Native via `window.ReactNativeWebView.postMessage`.

Login and sign-up screens keep their existing UX up until the user taps submit. On submit, we validate the form, then `turnstileRef.current?.show()`. The user completes the challenge in a modal; on verify, we call Supabase Auth with `options: { captchaToken: token }`.

## Technical Considerations

### Turnstile WebView component

New file: **`apps/mobile/src/components/Turnstile.tsx`**. Same surface as `HCaptcha.tsx` (`forwardRef` exposing `show()` / `hide()`, callbacks `onVerify`, `onExpire`, `onError`, `onCancel`).

```tsx
// apps/mobile/src/components/Turnstile.tsx
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { Modal, View, ActivityIndicator, Text, Pressable, StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { getWebAppUrl } from "@/lib/web-api";

const TURNSTILE_SITE_KEY =
  process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || "1x00000000000000000000AA"; // always-pass test key
const BASE_URL = process.env.EXPO_PUBLIC_HCAPTCHA_BASE_URL || getWebAppUrl();

const buildHtml = (siteKey: string, theme: "light" | "dark") => `
<!DOCTYPE html>
<html><head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad" async defer></script>
  <style>html,body{margin:0;padding:0;background:transparent;}#w{display:flex;justify-content:center;padding:16px;}</style>
</head><body>
  <div id="w"></div>
  <script>
    const send = (p) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(p));
    function onTurnstileLoad() {
      send({ type: "open" });
      window.turnstile.render("#w", {
        sitekey: ${JSON.stringify(siteKey)},
        theme: ${JSON.stringify(theme)},
        callback: (token) => send({ type: "verify", token }),
        "expired-callback": () => send({ type: "expire" }),
        "error-callback": (e) => send({ type: "error", error: String(e) }),
      });
    }
  </script>
</body></html>`;
```

Key behavior:
- **`baseUrl`** on the WebView source is set to the web app's URL (`https://www.myteamnetwork.com`) so Turnstile's domain whitelist on the site key matches the document origin.
- **Single-use token:** Reset the widget after every consume — call `hide()` from the parent on success or auth error before re-issuing `show()`.
- **5-min expiry:** `expired-callback` is wired so a stale token never silently fails.

### Login wiring

Modify `apps/mobile/app/(auth)/login.tsx`:

```tsx
// pseudo
const turnstileRef = useRef<TurnstileRef>(null);

const signInWithEmail = async () => {
  // ... existing validation ...
  setEmailLoading(true);
  turnstileRef.current?.show();
};

const onCaptchaVerify = async (captchaToken: string) => {
  turnstileRef.current?.hide();
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail.toLowerCase(),
      password,
      options: { captchaToken },
    });
    // ... existing error handling ...
  } finally {
    setEmailLoading(false);
  }
};

// In JSX:
<Turnstile
  ref={turnstileRef}
  onVerify={onCaptchaVerify}
  onCancel={() => setEmailLoading(false)}
  onError={() => { setEmailLoading(false); setApiError("Verification failed. Try again."); }}
  onExpire={() => setEmailLoading(false)}
/>
```

### Signup wiring

`apps/mobile/app/(auth)/signup.tsx:166` — same pattern. Merge `captchaToken` into existing `options` so we keep `emailRedirectTo: "teammeet://callback"`:

```ts
await supabase.auth.signUp({
  email: trimmedEmail.toLowerCase(),
  password,
  options: {
    emailRedirectTo: "teammeet://callback",
    captchaToken,
  },
});
```

### Environment

Add to `apps/mobile/.env.example`:

```
EXPO_PUBLIC_TURNSTILE_SITE_KEY=your-turnstile-site-key
```

Also document in `apps/mobile/CLAUDE.md` env table. Reuse `EXPO_PUBLIC_HCAPTCHA_BASE_URL` as the WebView base URL — it already points at the web app domain that Turnstile's site key will whitelist. If we want a dedicated var later, fine, but no need to add one now.

### What we are NOT doing

- Not touching Google OAuth (`signInWithGoogle`), magic link, or password reset. Supabase enforces captcha there too in theory, but those flows aren't in the bug report and Supabase exempts OAuth redirect captcha when the provider redirects out of the app. Will revisit if reports come in.
- Not replacing donations' hCaptcha. Donations don't use Supabase Auth; they hit the web API.
- Not bringing this branch's web app onto Turnstile. Tracked separately as part of `main`-sync.

## System-Wide Impact

- **Interaction graph:** Submit button → form validation → `Turnstile.show()` → WebView loads Turnstile → user solves → `postMessage` → `onVerify` → `supabase.auth.signInWithPassword` → Supabase validates token against project Turnstile secret → success or auth error → `Turnstile.hide()`. On expire/error: same flow with reset.
- **Error propagation:** Three failure modes — (a) WebView fails to load Cloudflare JS (network), (b) user fails the challenge (Turnstile error), (c) Supabase rejects token (server-side validation). All three surface a clear inline error and let the user retry without leaving the screen.
- **State lifecycle:** `setEmailLoading(true)` is set on submit and cleared in **every** terminal path (verify success, verify error, expire, cancel, Supabase error). Guard against double-tap by ignoring `show()` calls when already loading.
- **API surface parity:** None — login and sign-up are the only two auth flows in scope.
- **Integration test scenarios:**
  1. Valid credentials + valid Turnstile → user lands in app.
  2. Invalid password + valid Turnstile → "Invalid credentials" (not captcha error). Widget resets.
  3. Cancelled captcha → loading state cleared, no auth call made.
  4. Token expired (idle 6+ min) → expire callback resets widget, user can retry.
  5. Airplane mode → WebView load failure surfaces error.

## Acceptance Criteria

### Functional

- [ ] `apps/mobile/src/components/Turnstile.tsx` created, exports default `Turnstile` and `TurnstileRef` matching the HCaptcha component's surface (`show`, `hide`).
- [ ] `apps/mobile/app/(auth)/login.tsx` triggers Turnstile on email submit and passes `captchaToken` into `signInWithPassword`. Google OAuth path untouched.
- [ ] `apps/mobile/app/(auth)/signup.tsx` triggers Turnstile on submit and passes `captchaToken` into `signUp` while preserving `emailRedirectTo: "teammeet://callback"`.
- [ ] User can complete email/password sign-in and sign-up against production Supabase without "captcha verification process failed".
- [ ] Wrong password produces the existing "Invalid email or password" error, not a captcha error (proves the token is being accepted server-side).
- [ ] Cancelling the captcha modal clears `emailLoading` / `loading` state — no stuck spinner.
- [ ] Token expiry (after ~5 min idle) resets the widget cleanly; user can re-verify and retry.

### Non-functional

- [ ] No new dependencies added to `apps/mobile/package.json` (`react-native-webview` already at v13.15.0).
- [ ] Component respects `useOrgTheme()` light/dark — Turnstile widget theme set from theme context.
- [ ] No regressions in donation hCaptcha flow.

### Quality gates

- [ ] `bun run typecheck` passes in `apps/mobile/`.
- [ ] Manual smoke test on iOS simulator and Android emulator.
- [ ] Supabase Auth logs show successful captcha verification for new mobile login attempts.

## Success Metrics

- Mobile auth success rate returns to pre-cutover baseline (compare PostHog `user_logged_in` and `user_signed_up` events for 7 days post-deploy).
- Sentry error count for `captcha verification process failed` from mobile drops to ~0.

## Dependencies & Risks

**Dependencies**
- `react-native-webview@13.15.0` — already installed.
- `EXPO_PUBLIC_TURNSTILE_SITE_KEY` must be set in Expo env (dev `.env.local` and EAS secrets for prod builds). Reuse the same site key configured for web on `main` so Supabase's project-level secret matches.

**Risks**
- **Site key domain whitelist mismatch.** Turnstile validates the embedding origin. If the site key on Cloudflare doesn't allow `myteamnetwork.com`, the widget will fail to load. Mitigation: confirm in Cloudflare dashboard before testing.
- **Expo dev client / Metro bundler:** environment variables prefixed with `EXPO_PUBLIC_` are inlined at bundle time. Restart Metro after editing `.env.local`.
- **iOS WebView quirk:** older iOS versions can drop `postMessage` if `originWhitelist` is wrong. Use `originWhitelist={["*"]}` (matches the existing HCaptcha component pattern) and verify on iOS 16+.
- **Token consumed on Supabase failure.** If Supabase rejects for a non-captcha reason (e.g., locked account), the token is already consumed — user must re-verify. UX-wise we just reset the widget on every error.

## Sources & References

### Origin

- **Origin document:** [/Users/louisciccone/.claude/plans/when-i-try-to-shimmering-floyd.md](/Users/louisciccone/.claude/plans/when-i-try-to-shimmering-floyd.md) — brainstorm requirements doc. Carried-forward decisions:
  - Provider = Turnstile (Supabase project setting confirmed by user)
  - WebView-hosted widget (no first-class RN SDK exists, no new native deps)
  - Scope limited to email/password sign-in + sign-up

### Internal references

- Mobile hCaptcha pattern (Modal + WebView + postMessage): `apps/mobile/src/components/HCaptcha.tsx:1-128`
- Mobile login (where to wire it): `apps/mobile/app/(auth)/login.tsx:189-192`
- Mobile sign-up (where to wire it): `apps/mobile/app/(auth)/signup.tsx:166-173`
- Web `useCaptcha` hook (token-state shape to mirror if it grows): `apps/web/src/hooks/useCaptcha.ts:32`
- Web Turnstile cutover commit (context, not code reuse — lives on `main`): `0313cab7`
- Mobile env conventions: `apps/mobile/CLAUDE.md` (Environment Variables section)
- Mobile package versions: `apps/mobile/package.json` (`@supabase/supabase-js@^2.39.6`, `react-native-webview@13.15.0`)

### External references

- Cloudflare Turnstile JS API: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
- Turnstile test site keys (dev): https://developers.cloudflare.com/turnstile/troubleshooting/testing/
  - `1x00000000000000000000AA` — always passes (use in dev)
  - `2x00000000000000000000AB` — always blocks
- Supabase `signInWithPassword` captcha: https://supabase.com/docs/guides/auth/auth-captcha
- `react-native-webview` `onMessage` + `postMessage` bridge: https://github.com/react-native-webview/react-native-webview/blob/master/docs/Guide.md#communicating-between-js-and-native

### Related work

- Web captcha cutover: `0313cab7` (on `main`, not on `react-native`)
- Mobile hCaptcha hardening: `4a7da1ac fix(auth): harden hcaptcha mobile loading UX`
- Captcha policy consistency: `7f8e9726 Keep captcha fallback policy consistent`
