---
title: Mobile-Native Upgrade — Push, QR, Calendar, Share, Biometrics, Wallet, Live Activities, Quick Actions
type: feat
status: active
date: 2026-04-26
origin: /Users/louisciccone/.claude/plans/give-me-some-ideas-zany-hearth.md
---

# Mobile-Native Upgrade

## Overview

Ship eight mobile-native capabilities to the Expo SDK 54 app at `apps/mobile/`. The lane is deliberately **mobile-native** (push, QR, native calendar, share sheet, biometrics, Wallet, Live Activities, quick actions) rather than web→mobile parity gaps (calendar full view, media gallery, mentorship depth, etc.) — those are tracked separately. The work spans 4 phases (P0 foundation → P1 high-leverage → P2 polish → P3 premium native).

Origin requirements doc: `/Users/louisciccone/.claude/plans/give-me-some-ideas-zany-hearth.md`. All eight capabilities (R1–R8) and the success criteria are carried forward unchanged. The phasing has been revised based on cross-cutting concerns surfaced during planning research (deep-link convergence, permission UX precedent, iOS extension target reuse).

## Enhancement Summary

**Deepened on:** 2026-04-27 via `/ce:deepen-plan` with 5 parallel review agents (architecture, data integrity, performance, simplicity, pattern consistency).

**The original plan body below is preserved verbatim.** This section consolidates the revisions that should be applied during execution. Each revision is tagged with the section it amends and a severity (Critical / High / Medium) so engineers can scan-and-fix without re-reading the full plan.

### Critical revisions (must address before any migration or code lands)

- **Naming collision fix [§0.2]**: `apps/mobile/src/lib/permissions.ts` already exists (re-exports role-permission helpers from `@teammeet/core`). Rename the new module to `apps/mobile/src/lib/device-permissions.ts` and the hook to `useDevicePermission`.
- **`notification_jobs` schema [§0.5, Acceptance Criteria]**: 
  - Add service-role-only RLS (no policies for `authenticated`).
  - Add ops columns: `attempts int DEFAULT 0`, `last_error text`, `leased_at timestamptz`, `scheduled_for timestamptz DEFAULT now()`.
  - Add `kind text CHECK (kind IN ('standard','wallet_update','live_activity_start','live_activity_update','live_activity_end'))` discriminator so P3 wallet/LA dispatch reuses the same dispatcher (forward-compat).
  - Add `priority smallint DEFAULT 5` so latency-sensitive LA updates don't queue behind 25k-recipient broadcasts.
  - `status` is a CHECK enum: `pending|processing|succeeded|failed|cancelled`.
  - Partial index `(created_at) WHERE status = 'pending'` for the worker drain hot path.
  - **Don't add to `supabase_realtime` publication.** Use `pg_cron` every 30s drain + `pg_notify` from `AFTER INSERT` trigger as the realtime mechanism. Realtime on a queue containing cross-tenant PII is a footgun.
- **`device_calendar_entries` schema [§2.2]**: Plan as written has no PK and no `user_id`. Required shape: PK `(user_id, device_id, event_id)`, columns `user_id`, `organization_id`, `event_id`, `device_id`, `device_event_id`, `last_sync`. **No FK on `event_id`** — `events` is soft-deleted and FK cascade can race; reconcile via a sweeper instead. Drop `last_sync` if presence of `device_event_id` is sufficient for idempotency (it is).
- **`wallet_passes.authentication_token` encryption [§3.2]**: Apple Wallet web service tokens are bearer credentials. Store as `authentication_token_ciphertext bytea` + `authentication_token_iv bytea` (mirror `LINKEDIN_TOKEN_ENCRYPTION_KEY` pattern). Expose via a `wallet_passes_public` view without the token column for client reads; service-role only on the base table.
- **`live_activity_tokens` enforcement [§3.3]**: Add `device_id text NOT NULL` (sign-out is per-device, missing in plan). Add unique partial index `(user_id, event_id) WHERE ended_at IS NULL` to enforce the per-(user,event) cap of 1 active LA at the schema level.
- **Push preference defaults [§0.5, R1.1]**: Plan says `DEFAULT true` mirroring email; origin doc says default OFF except announcements/chat/event reminders. Resolve by encoding origin-doc semantics in column defaults: `announcement_push_enabled`, `chat_push_enabled`, `event_reminder_push_enabled` default `true`; `event_push_enabled`, `workout_push_enabled`, `competition_push_enabled`, `discussion_push_enabled`, `mentorship_push_enabled`, `donation_push_enabled` default `false`. Mismatched defaults are durable and require backfills if changed later.
- **Cascade audit [§Cross-cutting X.1, X.2]**: All per-user tables (`user_app_preferences`, `device_calendar_entries`, `wallet_passes`, `live_activity_tokens`) need `ON DELETE CASCADE` from `users(id)`. `wallet_passes` and `live_activity_tokens` additionally need `BEFORE DELETE` triggers that enqueue revocation/end pushes before the cascade wipes the token. Document explicitly.
- **Recipient + token resolution N+1 [§0.5]**: Replace 3-step (resolve users → check prefs → load tokens) with one `SECURITY DEFINER` RPC `resolve_push_targets(p_org_id, p_audience, p_target_user_ids, p_category, p_kind)` returning `(user_id, expo_token, platform)`. One query, server-side join across `user_organization_roles`, `notification_preferences`, `user_push_tokens`. Saves ~150–300ms per fan-out and avoids 32k-parameter ceiling at scale.
- **APNs HTTP/2 client placement [§3.1]**: Move from `apps/web/src/lib/apns/` to `packages/core/src/apns/` so both Vercel API routes (R6 wallet GET, R7 register/unregister) AND the Supabase Edge Function for fan-out can consume it without duplication. Use `jose` (cross-runtime) not `jsonwebtoken` (Node-only) for the JWT signer.
- **Server-side wallet/LA kill switches [§Risk Analysis]**: `EXPO_PUBLIC_*` flags bake at build time and can't roll back without an OTA. Add `GET /api/wallet/eligibility` and `GET /api/live-activity/eligibility` endpoints that mobile checks before showing the "Add to Wallet" button or starting an LA. Server can disable globally without a mobile release.

### High revisions (apply during the relevant phase, costly to retrofit later)

- **Phase split [§Proposed Solution]**: Decompose P0 into:
  - **P0a (truly blocking P1)**: deep-link router (0.1), device-permissions hook (0.2), push spine schema + minimal `sendPush()` (0.5 trimmed), sign-out cleanup as a direct function `signOutCleanup()` not a hook registry (0.4 simplified).
  - **P0b (parallel-safe with P1)**: Universal Links (0.3, only blocks R4 share), event-reminders cron (0.6, **move to R1 in P1** since it's an R1 consumer not foundation).
- **Two-tier push dispatch [§0.5]**: For jobs with `target_user_ids.length === 1` (chat DM, single mention), inline-send from the API route with a warm `expo-server-sdk` instance — P50 ~400ms. For broadcasts (audience='all', large `target_user_ids[]`), enqueue to `notification_jobs`. Defer the Edge Function fanout entirely until an org actually breaches the Vercel 60s timeout — ship inline `await sendPush()` + `EdgeRuntime.waitUntil`-style background task on Vercel for v1.
- **Worker scale checkpoint [§Risk Analysis]**: Add explicit threshold: when any single org's `user_push_tokens` count exceeds 5,000 OR sustained job throughput exceeds 100/min platform-wide, migrate to PgBoss (Postgres-native, no new infra). Cursor-streaming (`scheduled_for`, `leased_at`, resume-from-cursor) becomes mandatory at this point.
- **APNs concurrency bound [§3.2, §3.3]**: Wrap APNs HTTP/2 sends in `pLimit(20)` per topic. Maintain one warm HTTP/2 session in module scope (requires `runtime = 'nodejs'` on the routes — not edge runtime — because edge can't keep HTTP/2 sessions). Per-topic fair scheduling so R7 LA traffic doesn't starve R6 wallet wakes.
- **`.pkpass` cache strategy [§3.2]**: Don't regenerate per-request via `passkit-generator` (100–300ms each). Persist generated bytes to Supabase Storage at `wallet/{passType}/{serial}/{last_updated_at}.pkpass`; the route returns `302` to the signed Storage URL. Storage's CDN serves with edge caching for free. `Cache-Control: public, max-age=300, s-maxage=86400, stale-while-revalidate=86400`.
- **LA update debouncing [§3.3]**: Coalesce check-in count updates per `eventId` to **max 1 push every 2s** (Apple's sustained budget is ~1/sec; 2s gives headroom). Drop stale updates if a newer one is queued. A 200-attendee burst becomes ~10 pushes instead of 200.
- **Single filtered realtime channel per user [§2.2]**: User in 5 orgs × per-org channel = 5 channels per device. Subscribe to **one** `events` channel with row filter `organization_id=in.(...)` based on user's org memberships. Only subscribe at all when calendar permission is `granted` AND ≥1 org has sync enabled. Reuse the existing `events:<orgId>` channel rather than inventing `calendar:<orgId>`.
- **`BiometricLockContext` rename + split [§1.3]**: Rename to `BiometricContext` (matches `AuthContext`/`OrgContext`/`NetworkContext` single-noun pattern). Internally split into `BiometricStatusContext` (just `isUnlocked: boolean`) and a separate ref-based timer (no state, no re-renders). `lastBackgroundedAt` lives in a `useRef`, not state. Render `<LockScreen />` via portal/`Modal` as a sibling to the nav tree, not a wrapper, so screens never unmount on lock. Couple to `useAuth()` — only lock when `session != null`.
- **`OrganizationWalletSection` rename [§3.2]**: → `SettingsWalletSection.tsx` in `apps/mobile/src/components/settings/` to match the `Settings<Name>Section` family. Add to the existing settings barrel export.
- **`useActiveEventsForLiveActivity(orgId)` hook [§3.3]**: Extract the active-event query out of `LiveActivityContext` into a hook following the canonical shape (`useRequestTracker`, `isMountedRef`, 30s stale time, realtime subscription). Context consumes the hook.
- **Wallet opt-out column placement [§3.2]**: Put `wallet_pass_opt_out boolean DEFAULT false` on `user_organization_roles` (the unified role table) instead of duplicating on both `members` AND `alumni`. Avoids extending the known alumni-divergence issue (per `MEMORY.md`).
- **Apple Wallet WebService middleware bypass [§3.2]**: `/api/wallet/apple/v1/devices/...` and `/api/wallet/apple/v1/log` are called by Apple's servers, not authenticated users. Add to the middleware bypass list (alongside Stripe webhooks, telemetry, parent-invite-accept). Auth via per-pass `authentication_token` header per Apple spec.
- **`event-reminders` cron index + dedup [§0.6]**: 
  - Partial index: `CREATE INDEX events_upcoming_idx ON events (start_date) WHERE cancelled_at IS NULL AND status != 'cancelled'`.
  - Dedup: unique constraint on `notification_jobs (user_id, push_resource_id, push_type)` partial-indexed `WHERE created_at > now() - interval '2 hours'`. Use `ON CONFLICT DO NOTHING` to prevent duplicate fires on overlapping cron windows.
- **Migration timestamp pre-allocation [§Implementation Phases]**: Per `MEMORY.md`, collisions are a known risk. Reserve now in the plan: `20261101000000_notification_jobs.sql`, `20261101000001_notification_push_prefs.sql`, `20261101000002_user_app_preferences.sql`, `20261101000003_device_calendar_entries.sql`, `20261101000004_wallet_passes.sql`, `20261101000005_live_activity_tokens.sql`. Latest existing migration is `20261013000000`; leave headroom.

### Medium revisions (good hygiene; apply when in the area)

- **Drop SIGNOUT_HOOKS registry [§0.4]**: With 6 known callers shipped over 4 phases by the same team, a registry is YAGNI. Use a concrete `signOutCleanup(userId)` function in `apps/mobile/src/lib/lifecycle.ts` that calls the 6 things directly. Easier to grep ("what runs at sign-out?") and same testability.
- **Drop unused `Intent` variants [§0.1]**: `chat-thread` and `mentorship-pair` have no producers in this plan. Add when needed.
- **Per-category push prefs as JSONB [§0.5]**: One column `push_categories jsonb` instead of 6 booleans. Filter via `(push_categories->>category)::boolean IS NOT FALSE`. Won't index on these (always small recipient set).
- **`user_app_preferences` table [§1.3]**: Two scalar settings (`biometric_enabled`, `biometric_timeout_seconds`). Consider folding into existing `users.app_preferences jsonb` instead of a new table — fewer migrations, fewer FKs, fewer RLS policies. Still needs the `BETWEEN 0 AND 86400` check on the timeout.
- **Defer App Group setup [§2.1]**: Plan sets up `group.com.teammeet.shared` in P2 R8 to "amortize for P3". Quick actions can use plain AsyncStorage for `last_active_org_slug`. Defer App Group entitlement to P3 where the Widget Extension actually needs it.
- **Bundle QR RCA into the fix PR [§1.2]**: "Document RCA before shipping" is a process gate that delays a known-bug fix. Write `docs/qr-bug-rca.md` in the same PR as the fix, not before.
- **Scanner decode throttle [§1.4]**: Use ref-timestamp throttle (`if (now - lastDecodeTs < 500) return`) not `setTimeout` debounce (which leaks if the user navigates away mid-debounce).
- **Audit log direct APNs sends [§3.2, §3.3]**: Wallet wake and LA update pushes bypass `/api/notifications/send`. Log them to the same `notifications` audit table the regular path writes (with `kind` field) so admins can debug delivery from one place.
- **Platform guard at `LiveActivityProvider` root [§3.3]**: Don't rely only on `EXPO_PUBLIC_MOBILE_LIVE_ACTIVITIES_ENABLED`; also `if (Platform.OS !== 'ios') return children` at the provider level so Android renders no-op.
- **Theme tokens in new settings sections [§1.3, §2.2, §3.2]**: New `SettingsSecuritySection`, `SettingsCalendarSection`, `SettingsWalletSection` must use `SPACING`, `RADIUS`, `SHADOWS` tokens — not literals. Calendar color comes from `useOrgTheme()`; wallet role badge from `ROLE_COLORS`.
- **OAuth plan coordination [§Dependencies]**: Concrete handoff: have `2026-04-26-001-feat-mobile-oauth-parity-with-web-plan.md` land its handler with a `// TODO(deep-link.ts)` comment referencing the eventual `Intent` shape. This plan's P0 does the consolidation in one pass. Avoids two refactors.
- **P3 go/no-go gate [§Resource Requirements]**: P3 is not 4–6 weeks if Apple Developer admin role escalation is needed and you don't have it. Add an explicit gate at the start of P3: "Verify Apple Developer admin role + Apple Pass Type ID cert request approved + Google Wallet Issuer onboarded (≈1 week lead time) BEFORE writing any code."

### Architectural reframings worth noting

- **Two notification surfaces, not one**: User-visible notifications (`/api/notifications/send`) vs silent device wakes (wallet/LA). The plan's `notification_jobs` table can serve both via the new `kind` discriminator, but the dispatch endpoint and worker logic should treat them differently (priority, payload validation, audit). Don't overload `/api/notifications/send` with `kind: 'wallet_update'`.
- **`notification_jobs` is a load-bearing table**: Every later feature writes to it. Schema decisions made now persist for years. Get the `kind` discriminator + `priority` + ops columns right in the first migration; they're awkward to add later.
- **Mobile-side: ship value as fast as possible**: The simplicity reviewer's net assessment: P0 can shrink ~30% by deferring registry abstractions, the Edge Function fanout, and several speculative plumbing decisions. The plan as written front-loads infrastructure; the revised approach front-loads working chat-push and announcement-push for users while keeping the architecture clean enough to scale into broadcasts.

### Open questions surfaced during review (decide before P0 implementation)

1. **`user_app_preferences` table vs JSONB column on `users`** — table is more orthodox; JSONB saves a migration. Either is defensible.
2. **`push_categories` JSONB vs typed columns** — JSONB is simpler for 6 booleans; typed columns are easier to introspect in admin tools. Either is defensible.
3. **`packages/core/src/apns/` vs `apps/web/src/lib/apns/`** — `packages/core` is the architectural correct answer if the Edge Function will consume it; `apps/web` is fine if dispatch stays inline forever. Couple this decision to "defer Edge Function" — if Edge Function is deferred, `apps/web` is fine for now with a documented promotion path.
4. **Wallet pass for parents** — origin doc deferred this. Decision needed before R6 implementation: is `parent` role eligible for a Wallet pass at all? Recommendation: not v1 (parents already have a separate identity surface).

## Problem Statement

The mobile app has reached strong feature **breadth** — 25+ org-scoped screens covering chat, feed, announcements, events, members, alumni, mentorship, donations, expenses, jobs, parents, schedules, competition, forms, records, invites — but it does not feel **native**. Specifically:

- **Push infrastructure exists but is dark.** `apps/mobile/src/hooks/usePushNotifications.ts` and migration `supabase/migrations/20260425100000_push_notifications.sql` (creating `user_push_tokens`) are in place, but `apps/web/src/app/api/notifications/send/route.ts` only fans out via Resend email. Mobile callers already pass `pushType`/`pushResourceId` in their POST bodies but the server schema is `.strict()` and silently drops them. `useNotificationPreferences` shows a Push Notifications switch that never reads or writes the `push_enabled` column. The single highest-engagement channel is unwired end-to-end.
- **QR codes are half-broken.** `react-native-qrcode-svg` is installed and rendering invite QRs in three places (`apps/mobile/app/(app)/(drawer)/[orgSlug]/invites/index.tsx:647`, `members/new.tsx:432`, `SettingsInvitesSection.tsx:518`), but `docs/REPRO.md` Issue #1 documents a generation failure on web (`apps/web/src/lib/qr-utils.ts` swallows the underlying error). No camera scanner exists anywhere — users can display their org's join QR but no one can scan it. Admin event check-in (`apps/mobile/app/(app)/(drawer)/[orgSlug]/events/check-in.tsx`) is manual list-tap only.
- **No native calendar handoff.** Users have to context-switch into the mobile app to see practice times. There is rich web-side calendar sync infrastructure (`calendar_sync_preferences` with 6 event-type categories, `event_calendar_entries` mapping events to Google Calendar IDs) but no `expo-calendar` integration to write to the device calendar.
- **No native share.** Sharing an event/invite/job pushes to clipboard and forces the user to switch to iMessage/WhatsApp themselves.
- **No biometric unlock.** `expo-secure-store` is wired for the Supabase session but `expo-local-authentication` is not installed. Active members re-type passwords every session.
- **No Wallet pass.** Greenfield. Members can't show a scannable card at the door.
- **No Live Activities.** Greenfield. Active events have no Lock Screen presence.
- **No quick actions.** Long-press on app icon does nothing. No Siri/Spotlight surface.

The priority users for this work are **org admins and active members**, with parents/alumni as solid secondary users.

## Proposed Solution

A 4-phase rollout that front-loads the cross-cutting infrastructure (deep-link router, permission UX patterns, universal links, push fan-out, sign-out cleanup registry) before shipping per-capability features.

**Phase 0 — Foundation** (cross-cutting, blocks every other phase)
- Unify the deep-link handler in `apps/mobile/app/_layout.tsx:180–289` into a single `parseTeammeetUrl(url): Intent` + `routeIntent(intent)` helper at `apps/mobile/src/lib/deep-link.ts`. Coordinate with the active OAuth parity plan (`docs/plans/2026-04-26-001-feat-mobile-oauth-parity-with-web-plan.md`) so both converge on this helper.
- Establish a single permission-UX pattern: pre-prompt screen with "why we need this" copy → system prompt → soft-deny recovery via `Linking.openSettings()`.
- Configure Universal Links / App Links (`https://www.myteamnetwork.com/.well-known/apple-app-site-association`, `assetlinks.json`, `associatedDomains` in `app.json`). Without this, R4 share links open Safari blank for non-app users.
- Build a `SIGNOUT_HOOKS` and `USER_ERASE_HOOKS` registry so every feature in P1–P3 can register its own cleanup.
- Build the server push-fan-out spine: extend `apps/web/src/app/api/notifications/send/route.ts` Zod schema with `pushType`/`pushResourceId`/`channel`; add `apps/web/src/lib/notifications/push.ts` with `sendPush()` using `expo-server-sdk`; implement `notification_jobs` queue + worker (Supabase Edge Function or background Node worker) so pushes don't block API request threads.

**Phase 1 — High-leverage native** (R1, R2a, R5, R2b, R4)
- R1 push wired into real triggers (chat, announcements, events, mentorship, donations)
- R2a fix QR generation (root-cause `react-native-svg` hoisting and/or web URL length)
- R5 biometric unlock
- R2b camera scanner (depends on permission UX from P0)
- R4 native share sheet (depends on universal links from P0)

**Phase 2 — Calendar & shortcuts** (R8, R3)
- R8 quick actions / Siri shortcuts via `expo-quick-actions`
- R3 native calendar write-out via `expo-calendar` (one device calendar per org)

**Phase 3 — Premium native** (R6, R7) — both require iOS Widget Extension target via `@bacons/apple-targets`
- R6 Apple Wallet (server-side `.pkpass` via passkit-generator + web-handoff via `Linking.openURL`) and Google Wallet (signed JWT save link); APNs direct push for `apns-push-type: wallet`
- R7 iOS Live Activities via the same Widget Extension target; APNs direct push for `apns-push-type: liveactivity`

## Technical Approach

### Architecture overview

```
                            ┌──────────────────────────────────┐
                            │  Mobile App (Expo SDK 54)        │
                            │                                  │
  ┌────────────┐  push      │  expo-notifications              │
  │ APNs/FCM   │ ─────────▶ │  expo-camera                     │
  └────▲───────┘            │  expo-calendar                   │
       │ liveactivity, wallet│  expo-sharing                    │
       │ direct (no Expo)   │  expo-local-authentication       │
       │                    │  expo-secure-store (existing)    │
  ┌────┴────────┐           │  expo-quick-actions              │
  │ Expo Push   │           │  @bacons/apple-targets           │
  │ Service     │           │   ├─ Widget Extension (LA + Wallet hint)
  └────▲────────┘           │   └─ App Intent target           │
       │                    │                                  │
       │ HTTPS              │  src/lib/deep-link.ts (NEW, P0)  │
       │                    │  src/lib/permissions.ts (NEW)    │
       │                    │  src/lib/native-calendar.ts      │
       │                    │  src/lib/share.ts                │
       │                    │  src/contexts/BiometricLockCtx   │
       │                    └──────────────────────────────────┘
       │                                    ▲
       │                                    │ Supabase realtime
  ┌────┴───────────────────────────┐        │
  │  Web (Next.js + Supabase)      │        │
  │                                │        │
  │  api/notifications/send        │ ◀──────┤ POST from mobile screens
  │   ├─ extends to push channel   │        │ that already pass pushType
  │   ├─ writes notification_jobs  │        │
  │   └─ persists notifications    │        │
  │                                │        │
  │  api/cron/event-reminders (NEW)│        │
  │  api/wallet/apple/[serial]     │        │
  │  api/wallet/google/[id]        │        │
  │  api/live-activity/start, /end │        │
  │                                │        │
  │  lib/notifications/push.ts     │        │
  │  lib/apns/                     │ ──────▶ direct APNs (wallet, LA)
  │  lib/wallet/                   │        │
  └──────────────┬─────────────────┘        │
                 │                          │
                 ▼                          │
  ┌──────────────────────────────────────────┴───┐
  │  Supabase Edge Function: push-fanout         │
  │   - drains notification_jobs queue           │
  │   - resolves recipients via filterAnnouncementsForUser
  │   - chunks 100/req, calls expo-server-sdk    │
  │   - polls receipts, deletes DeviceNotRegistered tokens
  └──────────────────────────────────────────────┘
```

### Phase 0 — Foundation

#### 0.1 Unified deep-link router

- New file: `apps/mobile/src/lib/deep-link.ts`
- Exports:
  - `type Intent = | { kind: 'auth-callback', code: string } | { kind: 'join-org', token: string } | { kind: 'event', orgSlug: string, eventId: string } | { kind: 'event-checkin', orgSlug: string, eventId: string, memberId: string } | { kind: 'announcement', orgSlug: string, id: string } | { kind: 'chat-thread', orgSlug: string, threadId: string } | { kind: 'mentorship-pair', orgSlug: string, pairId: string } | { kind: 'wallet-add', passUrl: string } | { kind: 'shortcut', action: 'new-announcement' | 'check-in' | 'today-events' | 'scan' | 'open-chat' } | { kind: 'unknown' }`
  - `parseTeammeetUrl(url: string): Intent`
  - `routeIntent(router: Router, intent: Intent): void`
- Replaces the inline parsing in `apps/mobile/app/_layout.tsx:180–289`. Both this plan and `2026-04-26-001-feat-mobile-oauth-parity-with-web-plan.md` converge on this module — coordinate before merging either.
- All consumers (push tap handler, quick actions, share targets, wallet add, live activity tap, QR scanner) call `routeIntent`. The intent enum is the single contract.

#### 0.2 Permission UX pattern

- New file: `apps/mobile/src/lib/permissions.ts`
- Exports a `usePermission(kind: 'camera' | 'calendar' | 'notifications' | 'biometric')` hook returning `{ status, request, openSettings, copy }` where:
  - `request()` shows a pre-prompt sheet (component `<PermissionPrePrompt />` in `apps/mobile/src/components/permissions/`) with the `copy` for the kind, then calls the system request
  - `openSettings()` calls `Linking.openSettings()` for the soft-deny recovery
- All four capabilities that need permissions (R1, R2, R3, R5) reuse this hook. Single source of truth for "why we ask" copy.
- Goal: a fresh-install user reaches the home feed with **at most one** system permission prompt (push, requested after sign-in); all other permissions request just-in-time on user intent.

#### 0.3 Universal Links / App Links

- Web side: serve `apps/web/public/.well-known/apple-app-site-association` (no extension, `application/json`) and `apps/web/public/.well-known/assetlinks.json`. Bundle ID `com.myteamnetwork.teammeet` and the corresponding `applinks:` and `assetlinks` entries.
- Mobile side: add `ios.associatedDomains: ["applinks:www.myteamnetwork.com", "applinks:myteamnetwork.com"]` to `apps/mobile/app.json`. Add Android `intentFilters` for `https://www.myteamnetwork.com/*` with `autoVerify: true`.
- Without this, R4's share UX is "tap link → Safari → blank" for users without the app installed. With it, a shared link routes into the app on devices that have it and falls through to the web app on devices that don't.
- Verify with Apple's `https://search.developer.apple.com/appsearch-validation-tool/` and Google's Statement List Generator.

#### 0.4 Sign-out and account-erasure registries

- New file: `apps/mobile/src/lib/lifecycle-hooks.ts`
- Exports:
  - `registerSignOutHook(name: string, fn: () => Promise<void>): void`
  - `registerEraseHook(name: string, fn: (userId: string) => Promise<void>): void`
  - `runSignOutHooks(): Promise<void>` — called by `AuthContext` on sign-out
  - `runEraseHooks(userId): Promise<void>` — called by `apps/web/src/app/api/user/delete-account` after auth deletion
- Each later feature registers its cleanup at module load:
  - R1: delete row(s) from `user_push_tokens` for this device
  - R3: delete the per-org device calendars
  - R5: clear biometric flag and any biometric-protected keychain items
  - R6: invalidate wallet pass server-side (`wallet_passes.revoked_at = now()`); APNs wake all devices
  - R7: end any active Live Activity for this user
  - R8: clear dynamic quick action items
- Test: a single `signOut.test.ts` verifies all hooks fire.

#### 0.5 Push fan-out spine

- Migration: `notification_jobs(id, organization_id, audience, target_user_ids, push_type, push_resource_id, title, body, data, status, created_at, sent_at)`. RLS service-role-only.
- Migration: extend `notification_preferences` with `*_push_enabled` columns mirroring the existing `*_emails_enabled` columns: `announcement_push_enabled`, `event_push_enabled`, `workout_push_enabled`, `competition_push_enabled`, `discussion_push_enabled`, `mentorship_push_enabled`. Default `true`.
- Web schema: extend `apps/web/src/app/api/notifications/send/route.ts` Zod schema with `pushType`/`pushResourceId`/`channel: "email" | "sms" | "push" | "all"`. Inline-callers already pass these — schema needs to accept them.
- New `apps/web/src/lib/notifications/push.ts` with `sendPush(jobId)`:
  - Loads `notification_jobs` row
  - Resolves recipient user IDs (uses existing `filterAnnouncementsForUser` from `@teammeet/core` if `audience` is set; uses `target_user_ids` directly otherwise)
  - Filters by `notification_preferences.push_enabled` and per-category `*_push_enabled`
  - Loads `user_push_tokens` for those users (joins all devices)
  - `expo.chunkPushNotifications` → `expo.sendPushNotificationsAsync`
  - Stores ticket IDs back on the job row
- Receipt polling: new cron `apps/web/src/app/api/cron/push-receipts/route.ts` runs every 15 min, polls receipts, deletes tokens with `DeviceNotRegistered`, logs `MessageRateExceeded` for backoff.
- Workers options (pick one during P0 implementation):
  - **Recommended**: Supabase Edge Function `supabase/functions/push-fanout/index.ts` triggered by inserts on `notification_jobs` via Realtime or `pg_net`. Uses `EdgeRuntime.waitUntil()` so HTTP returns fast.
  - Alternative: Inline call from API route with `await` — works for small orgs; will time out on Vercel for large ones.
- Add `EXPO_ACCESS_TOKEN` env var (recommended; required if Expo project has push security enabled).
- Existing inline-callers (7 already pass `pushType`): no UI change. Just stop dropping the field.

#### 0.6 New cron: event reminders

- New: `apps/web/src/app/api/cron/event-reminders/route.ts`
- Reuses `validateCronAuth(request)` and `createServiceClient` patterns from `apps/web/src/app/api/cron/calendar-sync/route.ts`.
- Queries `events` where `start_date BETWEEN now()+55min AND now()+65min` (1h reminder) and same for 24h with a window. Inserts into `notification_jobs` for each user with `event_rsvps.status='attending'`.
- Filter cancelled events (`events.cancelled_at IS NOT NULL`) explicitly — known issue per `docs/REPRO.md` Issue #6.
- `vercel.json` cron schedule: every 5 minutes for the 1h window, hourly for the 24h window. Document in `docs/cron.md`.

### Phase 1 — High-leverage native

#### 1.1 R1 — Push notifications wired

- Audit and fix `apps/mobile/src/hooks/useNotificationPreferences.ts` so it reads and writes `push_enabled` and the new per-category `*_push_enabled` columns.
- Add per-category Switch toggles to `apps/mobile/src/components/settings/SettingsNotificationsSection.tsx`. Defaults (per origin doc): announcements + chat mentions + event reminders ON; everything else OFF.
- Extend `apps/mobile/src/lib/notifications.ts` `NotificationData` type with `chat`, `mentorship`, `donation`, `membership` cases. Update `getNotificationRoute()` accordingly.
- Wire trigger sites (web side, all add `pushType`/`pushResourceId` to the existing POST body):
  - Chat new message → push to group members minus sender (mention escalation: `@user` mentions get higher priority sound)
  - Announcement create → push respects audience targeting via `filterAnnouncementsForUser`
  - Event create / RSVP open → already in `events/new.tsx:536–537`, currently dropped
  - Event reminders 1h + 24h → from new cron in P0
  - Mentorship pair proposal accepted, new pair message → already in `mentorship/MentorPairManager.tsx:142`, currently dropped
  - Donation success → admin push from Stripe webhook handler

##### test.ts

```ts
// apps/web/src/lib/notifications/__tests__/push.test.ts
test("respects audience targeting", async () => {
  const job = await createJob({ audience: "alumni", organizationId: orgId });
  await sendPush(job.id);
  const sent = await getSentTokens(job.id);
  expect(sent).not.toContain(activeMemberToken);
  expect(sent).toContain(alumniToken);
});

test("filters by per-category preference", async () => {
  await setPref(userId, "announcement_push_enabled", false);
  const job = await createJob({ audience: "all", category: "announcement", organizationId: orgId });
  await sendPush(job.id);
  expect(await getSentTokens(job.id)).not.toContain(userToken);
});

test("deletes DeviceNotRegistered tokens", async () => {
  mockExpoReceipt(ticketId, { status: "error", details: { error: "DeviceNotRegistered" } });
  await processReceipts([ticketId]);
  expect(await getToken(badTokenId)).toBeNull();
});
```

#### 1.2 R2a — Fix QR generation

- Investigate root cause first per `docs/REPRO.md:17–35`. Surface the swallowed error in `apps/web/src/lib/qr-utils.ts:28` to confirm the actual exception. Two leading hypotheses:
  - (a) **URL length** exceeds level-M QR capacity. Fix: introduce a `/i/<short-token>` redirect endpoint that resolves to the full invite URL. Web QR encodes the short URL.
  - (b) **`react-native-svg` hoisting** under Bun workspaces — Metro's `extraNodeModules` only pins react variants. Pin `react-native-svg` in `apps/mobile/metro.config.js extraNodeModules`.
- Document RCA in `docs/qr-bug-rca.md` before shipping the fix.
- Verification: 100 consecutive invite QR generations succeed in dev + prod.

#### 1.3 R5 — Biometric unlock

- Add `expo-local-authentication` to `apps/mobile/package.json` deps. Add `["expo-local-authentication", { "faceIDPermission": "Use Face ID to quickly and securely sign in to TeamMeet." }]` to plugins in `app.json`.
- Add `NSFaceIDUsageDescription` is set by the plugin.
- New context: `apps/mobile/src/contexts/BiometricLockContext.tsx`
  - Tracks `isUnlocked`, `lastBackgroundedAt`
  - Subscribes to `AppState`; on foreground after configured timeout (default 5 min, stored in `user_app_preferences`), sets `isUnlocked = false` and renders `<LockScreen />`
  - On cold start, if `biometric_enabled` flag in SecureStore, presents `LocalAuthentication.authenticateAsync` before letting the navigation tree mount
  - Renders a privacy overlay (`<PrivacyOverlay />`) when locked or backgrounding to prevent app-switcher screenshot leaks
- Migration: new `user_app_preferences (user_id PK, biometric_enabled boolean, biometric_timeout_seconds int default 300, created_at, updated_at)`. User-scoped (not org-scoped) so it spans orgs and devices.
- Use the SDK 54 best practice: `SecureStore.setItemAsync` with `requireAuthentication: true` rather than a separate `authenticateAsync` then `getItemAsync` (avoids race conditions).
- Strategy on biometric re-enrollment: **invalidate**. Use `kSecAccessControlBiometryCurrentSet` semantics so a new face/finger forces password re-auth and explicit re-opt-in. Test by toggling enrolled biometrics in the simulator.
- Settings UI: new `apps/mobile/src/components/settings/SettingsSecuritySection.tsx` with the toggle. Hide entirely when `LocalAuthentication.hasHardwareAsync()` returns false.
- Sign-out hook: clear `biometric_enabled` from SecureStore and any biometric-protected keychain items.
- Update `apps/mobile/docs/data-safety.md` Section 6 to include biometric disclosure.

#### 1.4 R2b — Camera-based scanner

- Add `expo-camera` to `apps/mobile/package.json` deps.
- Add `ios.infoPlist.NSCameraUsageDescription: "Scan a TeamMeet QR code to join your organization or check in to events."` to `app.json`.
- Add `android.permission.CAMERA` to `android.permissions` in `app.json`. Verify `apps/mobile/plugins/withOptionalHardwareFeatures.js` keeps `android.hardware.camera` as `required="false"` (it already does).
- New screen: `apps/mobile/app/(app)/(drawer)/[orgSlug]/events/[eventId]/scan.tsx`
  - `<CameraView>` with `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}`
  - Uses scanned-ref pattern (not state) per best practices to avoid re-render storms
  - On decode: `parseTeammeetUrl(decoded)` → if `kind === 'event-checkin'`, call existing `useEventRSVPs.checkInAttendee` (extended with `findByUserId(eventId, userId)` helper)
  - Continuous scan mode: re-arm scanner after 1.5s, do not unmount/remount `CameraView`
- New screen: `apps/mobile/app/(auth)/scan-join.tsx` for cold-scan from outside the app (entry: pre-auth)
  - On decode: if `kind === 'join-org'`, route to existing join flow at `/app/join?token=...`
- Add a "Scan" button to `apps/mobile/app/(app)/(drawer)/[orgSlug]/events/check-in.tsx` (existing manual check-in screen) header.
- Add a "Scan QR" entry to drawer / settings for general join-org use.
- Pre-prompt UI: `<PermissionPrePrompt kind="camera">` from P0.
- Soft-deny: if `permission?.canAskAgain === false`, show `<Linking.openSettings()>` CTA.
- Manual check-in remains the fallback when camera is denied (existing screen).

#### 1.5 R4 — Native share sheet

- Add `expo-sharing` to `apps/mobile/package.json` deps. (`expo-file-system` already present; needed for `.pkpass` share path used later in P3.)
- New helper: `apps/mobile/src/lib/share.ts`
  - `shareEvent(event)`, `shareJob(job)`, `shareInvite(invite)`, `sharePost(post)` — each builds a canonical URL via existing `getWebPath(orgSlug, path)` from `apps/mobile/src/lib/web-api.ts:11–22`, then calls `Share.share({ message, url })` (RN built-in for URLs/text) or `Sharing.shareAsync(uri)` (for file payloads).
- Replace `Clipboard.setString` calls in:
  - `apps/mobile/app/(app)/(drawer)/[orgSlug]/invites/index.tsx`
  - `apps/mobile/app/(app)/(drawer)/[orgSlug]/members/new.tsx`
  - `apps/mobile/src/components/settings/SettingsInvitesSection.tsx`
  - `apps/mobile/app/(app)/(drawer)/[orgSlug]/jobs/[jobId].tsx`
  - `apps/mobile/app/(app)/(drawer)/[orgSlug]/events/[eventId].tsx`
  - `apps/mobile/app/(app)/(drawer)/[orgSlug]/feed/[postId].tsx`
- Sensitive: `SettingsInvitesSection.tsx` is on the linter-hook footgun list (per `MEMORY.md`) — use `Write` rather than `Edit` for that file and re-read after.
- Universal links from P0 ensure recipients without the app installed land on the web equivalent.

### Phase 2 — Calendar & shortcuts

#### 2.1 R8 — Quick actions / Siri shortcuts

- Add `expo-quick-actions` to `apps/mobile/package.json`.
- Configure static items in `app.json` plugin block:
  - Admin (top of list when last-active org role is admin): "Send announcement", "Start check-in", "Today's events"
  - Member (top of list otherwise): "Today's events", "Open chat", "Scan QR"
- Hook `useQuickActionRouting()` from `expo-quick-actions/router` at the top of `apps/mobile/app/_layout.tsx` so taps route via the unified `routeIntent` from P0.
- Persist `last_active_org_slug` and `last_active_role` in App Group UserDefaults (`group.com.teammeet.shared`) so quick actions reflect the user's most recent context even when the app is cold. Setup the App Group entitlement now to amortize for P3.
- Cold start race: `<LockScreen />` from R5 must queue and replay any incoming intent until unlock succeeds.
- Donate intents to Siri (after each action) sparingly — only after explicit user action, not on navigation.

#### 2.2 R3 — Native calendar write-out

- Add `expo-calendar` to `apps/mobile/package.json`.
- Add the plugin: `["expo-calendar", { "calendarPermission": "TeamMeet adds events from your organizations to your calendar so you can see them alongside your other commitments." }]`
- Add `ios.infoPlist.NSCalendarsFullAccessUsageDescription` and `NSCalendarsWriteOnlyAccessUsageDescription` (iOS 17+ prefers write-only). Use write-only — much friendlier prompt and matches our needs.
- Add Android `READ_CALENDAR` and `WRITE_CALENDAR` to `android.permissions`.
- New helper: `apps/mobile/src/lib/native-calendar.ts`
  - `getOrCreateAppCalendar(orgId, orgName, color): Promise<calendarId>` — creates a calendar named `TeamMeet — ${orgName}` per org so users can hide/delete per org. Decision (was open per origin): **one calendar per org**, color-tagged with the org's primary color.
  - `syncEventToDevice(orgId, event)` — idempotent. Uses a new `device_calendar_entries (org_id, event_id, device_event_id, last_sync)` table to map server events to device event IDs. Update on event change, delete on cancellation, remove on RSVP-no when in "RSVP'd yes only" mode.
  - `removeOrgCalendar(orgId)` — for sign-out and org-leave.
- Reuse the existing `calendar_sync_preferences` table (per-org-per-user, 6 categories: general/game/meeting/social/fundraiser/philanthropy) for which event types to sync.
- New settings panel: `apps/mobile/src/components/settings/SettingsCalendarSection.tsx`
  - Master toggle "Sync to device calendar" (per device, opt-in default off)
  - Sub-choice: "All org events" / "Only events I'm attending" (default: attending only)
  - Per-category toggles re-using the 6-category UI
  - Per-org toggles to disable for specific orgs
  - "Remind me before events" sub-toggle (default off — see best-practices "don't auto-set alarms")
- Sync triggers:
  - On settings change: full sync for affected org(s)
  - On Supabase realtime event change for a sync-enabled org: incremental sync
  - On RSVP change: add/remove device event when in "attending only" mode
- Filter `events.cancelled_at IS NOT NULL` and `events.status = 'cancelled'` explicitly per known schedule-sync issue #6.
- Sign-out hook: ask the user "Remove TeamMeet calendars from your device?" with default Yes; on yes, delete all `TeamMeet — *` calendars created by the app.

### Phase 3 — Premium native (iOS extension target)

#### 3.1 Shared infrastructure (do once at start of P3)

- Install `@bacons/apple-targets` (`expo-apple-targets`) — supports widget, app-intent, and other extension types. Adds Widget Extension via `targets/widget/expo-target.config.js`.
- Bundle ID for extension: `com.myteamnetwork.teammeet.widget`. Provisioning profile + App Group entitlement (`group.com.teammeet.shared`) added in Apple Developer portal manually before `eas build` (per known EAS credential gap).
- Reconcile the two `eas.json` files (root and `apps/mobile/eas.json` disagree on `appVersionSource`). Pick `remote` for both.
- Add `apps/web/src/lib/apns/` — direct APNs HTTP/2 client for `apns-push-type: wallet` and `apns-push-type: liveactivity`. Token-based auth with `.p8` key. New env vars: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_AUTH_KEY`. (Apple's Pass Type ID cert is separate, used only for `.pkpass` signing.)
- New env var pattern: store `.p8` and Apple WWDR + Pass signer certs as base64-encoded text env vars; decode at boot. Document in `docs/env.md`.

#### 3.2 R6 — Apple Wallet / Google Wallet member pass

- Migration: `wallet_passes(id, user_id, organization_id, platform: 'apple'|'google', serial_number, pass_type_identifier, authentication_token, last_updated_at, revoked_at)` with unique `(user_id, organization_id, platform)`. RLS service-role-only on writes.
- Migration: extend `organizations` with `wallet_enabled boolean DEFAULT false`. (Or extend the `get_subscription_status` RPC to mirror the `parents_bucket` pattern; choose the simpler.)
- Migration: extend `members`/`alumni` with `wallet_pass_opt_out boolean DEFAULT false` so individual members can disable their pass.
- New web routes:
  - `apps/web/src/app/api/wallet/apple/[serial]/route.ts` — GET returns signed `.pkpass` bytes (`Cache-Control: public, max-age=60`, `Last-Modified` from `wallet_passes.last_updated_at`); supports `If-Modified-Since` for 304s
  - `apps/web/src/app/api/wallet/apple/v1/devices/[deviceId]/registrations/[passType]/[serial]/route.ts` — POST register, DELETE unregister (Apple-defined web service per spec)
  - `apps/web/src/app/api/wallet/apple/v1/devices/[deviceId]/registrations/[passType]/route.ts` — GET serials updated since
  - `apps/web/src/app/api/wallet/apple/v1/log/route.ts` — POST receives device error logs, persist to Sentry
  - `apps/web/src/app/api/wallet/google/[memberId]/route.ts` — GET returns signed JWT save URL (for `Linking.openURL`)
- Web-side libraries:
  - `apps/web/src/lib/wallet/apple.ts` using `passkit-generator` for `.pkpass` generation
  - `apps/web/src/lib/wallet/google.ts` using `google-auth-library` for JWT signing
  - Both consume a shared `getMemberPassPayload(memberId, orgId)` helper
- Update push: new Edge Function or inline worker for `wallet-update-fanout`. On `members`/`alumni`/`organizations` update of (name, photo, role, status), enqueue an APNs `apns-push-type: wallet` push with empty `{}` payload to all serials in the affected org. Wallet wakes the device, hits our GET endpoint, downloads new `.pkpass`.
- Mobile UX:
  - "Add to Wallet" button on profile screen: Apple Wallet on iOS (`Linking.openURL(passUrl)` — iOS recognizes `.pkpass` MIME type and triggers system Add sheet); Google Wallet on Android (`Linking.openURL(saveUrl)`). Hide the wrong platform's button.
  - Org admins enable per-org via existing org settings UI; new `OrganizationWalletSection.tsx` settings panel
  - Per-member opt-out toggle in personal Settings
- Pass payload:
  - Photo: member photo if uploaded, otherwise generate an initials avatar server-side (use existing avatar generator if present; otherwise add `apps/web/src/lib/avatar-init.ts`)
  - QR code on the back: encodes `teammeet://event/<eventId>/checkin/<userId>?sig=<hmac>` for use with R2's admin scanner. Use the same payload format as other QR codes for parser consistency.
- Revocation: when `user_organization_roles.status` flips to `revoked` or member graduates AND org disables wallet for alumni, set `wallet_passes.revoked_at`, queue APNs wake. Server returns `voided: true` in the next pass JSON. Google: `PATCH genericObject { state: 'INACTIVE' }`.
- Org rebrand (name/logo change) triggers full re-push for all serials in that org.
- Open in v1: parents are excluded from wallet pass (decision pending product call). Alumni inclusion is per-org via `wallet_enabled_for_alumni` boolean (default false).

#### 3.3 R7 — iOS Live Activities for active events

- Reuses Widget Extension target from 3.1.
- Native files in `targets/widget/`:
  - `EventActivityAttributes.swift` — `ActivityAttributes` with `eventId, orgName, eventTitle`; `ContentState` with `checkedInCount, isCheckedIn, status`
  - `EventLiveActivityWidget.swift` — SwiftUI views for compact, minimal, expanded Dynamic Island variants and Lock Screen view
- Mobile: new context `apps/mobile/src/contexts/LiveActivityContext.tsx`
  - Reads `events` where `start_date <= now() <= end_date` and user has `event_rsvps.status='attending'` for any of their orgs
  - Calls native `Activity.request(...)` via a small native bridge in `targets/widget/` (exposed via Expo modules pattern)
  - Captures the per-activity APNs push token from `Activity.pushTokenUpdates` and POSTs to new `/api/live-activity/register`
  - Cap: max 1 activity per (user, org, event); user can have up to 3 concurrent across orgs
- Migration: `live_activity_tokens(activity_id, user_id, event_id, push_token, started_at, ends_at, ended_at)`
- New web routes:
  - `apps/web/src/app/api/live-activity/register/route.ts` — POST persists token
  - `apps/web/src/app/api/live-activity/unregister/route.ts` — POST clears token
- Update push: when an event mutates (check-in count changes, end time changes, cancellation), enqueue APNs `apns-push-type: liveactivity` with `event: 'update'` (or `'end'` for cancellation). Direct APNs via `apps/web/src/lib/apns/`. Topic `<bundleId>.push-type.liveactivity`. Payload ≤ 4KB.
- Trigger: on `event_rsvps` insert/update for events with active LA, broadcast updated `checkedInCount` to all subscribed activity tokens.
- Lifecycle:
  - Start automatically when event begins (or when admin manually starts check-in early); ContentState `staleDate` = end_date + 30 min grace.
  - Update on check-in count and time-remaining changes.
  - End on event end time or cancellation. `dismissalDate: now()` for cancellation so it disappears immediately.
- Add `NSSupportsLiveActivities: true` and `NSSupportsLiveActivitiesFrequentUpdates: true` to `ios.infoPlist`.
- Feature flag: `EXPO_PUBLIC_MOBILE_LIVE_ACTIVITIES_ENABLED` (defaults false in EAS profile until verified) so a misconfigured Widget Extension can't break the iOS build for the rest of the app.
- Out of scope (non-goal documented): Android Live Updates equivalent.

#### 3.4 R8 add-on — App Intents (Siri voice + Spotlight)

- Reuses extension target. Add `targets/shortcuts/expo-target.config.js` with `type: 'app-intent'`.
- New `targets/shortcuts/Intents.swift`:
  - `ScanQRIntent`, `OpenChatIntent`, `TodayEventsIntent` — all use `openAppWhenRun: true` and return `OpensIntent(URL("teammeet://..."))` so RN starts up and the unified deep-link router from P0 takes over
  - `TeamMeetShortcuts: AppShortcutsProvider` exposes phrases like `"Scan a code in \(.applicationName)"`, max 10 shortcuts
- This is the Siri/Spotlight surface. The home-screen long-press shortcuts from R8 in P2 already cover that path.

## System-Wide Impact

### Interaction Graph

- **Push trigger fan-out** (P0 + R1): `apps/web/src/app/api/notifications/send/route.ts` POST → schema validates → conditionally inserts `notifications` row → conditionally enqueues `notification_jobs` row → Edge Function `push-fanout` resolves recipients via `filterAnnouncementsForUser` → loads `user_push_tokens` filtered by `notification_preferences.push_enabled` AND `*_push_enabled` for category → `expo.chunkPushNotifications` → `expo.sendPushNotificationsAsync` → APNs/FCM → device → `usePushNotifications` foreground handler → badge increment OR background handler → `getNotificationRoute(data)` → `routeIntent` (P0) → `router.push(route)`.
- **Wallet update flow**: any `members.UPDATE`, `alumni.UPDATE`, or `organizations.UPDATE(name, logo)` row → DB trigger or service-side hook → enqueue wallet push job → APNs direct (`apns-push-type: wallet`, empty body) → device wakes Wallet → hits `/api/wallet/apple/[serial]` with `If-Modified-Since` → returns fresh `.pkpass` or 304.
- **Live Activity update flow**: `event_rsvps.INSERT` (a check-in) → realtime subscription on web → enqueue APNs LA update → device receives `event: 'update'` → SwiftUI re-renders with new count.
- **Quick action cold start**: long-press app icon → tap "Start check-in" → iOS wakes app with deep link `teammeet://shortcut?action=check-in` → `_layout.tsx` mounts → biometric lock prompt if enabled → on unlock, queued intent replays → `routeIntent({ kind: 'shortcut', action: 'check-in' })` → router pushes to current org's most recent event check-in screen.

### Error & Failure Propagation

- **Push send error (synchronous)**: `expo-server-sdk` returns ticket with `status: 'error'` → worker logs and continues; doesn't fail entire batch.
- **Push receipt error (asynchronous)**: `DeviceNotRegistered` → cron deletes the token; `MessageRateExceeded` → cron logs for backoff; `MessageTooBig` → cron alerts (this is a payload bug, not a runtime issue).
- **Wallet sign error**: `passkit-generator` throws on missing certs → API route returns 500 with sanitized message; Sentry captures with `context: 'wallet.apple.sign'`. Pass install fails on device with "couldn't add pass" — user-facing.
- **Live Activity start failure**: `Activity.request` throws on iOS 16.0 (LA needs 16.1+) → caught in native bridge → mobile logs warning, no LA started, in-app event detail screen still works.
- **Calendar sync failure**: device permission revoked mid-sync → `Calendar.createEventAsync` throws → mobile shows toast "Calendar access lost — re-enable in Settings" once per session.
- **Biometric lockout**: 3 failures + cancel passcode → route to password sign-in (not sign-out).
- **Deep link parse failure**: `parseTeammeetUrl` returns `{ kind: 'unknown' }` → toast "Not a TeamMeet code", no navigation.

### State Lifecycle Risks

- **Device calendar orphans**: a user signs out without clicking "remove calendars" → `TeamMeet — Org` calendars remain on device. Mitigation: sign-out hook prompts; on app reinstall, helper finds and offers to clean up by name.
- **Wallet pass after server rebuild / wallet_passes migration**: passes already on devices have stale `webServiceURL` if domain changes. Mitigation: never change the domain; if needed, ship `voided: true` and instruct users to re-add.
- **Live Activity zombies**: if device loses network during event end, `end` push doesn't arrive → activity sits on Lock Screen until 8h max. Mitigation: end push with 24h `apns-expiration` retry; also send a regular push notification on event end as belt-and-suspenders.
- **Push token rotation**: APNs/FCM rotate tokens periodically → `usePushNotifications` already handles via `addPushTokenListener` and re-registers (deletes old row, inserts new).
- **Sign-out partial cleanup**: a hook fails (network down) → `runSignOutHooks` continues other hooks; failed cleanup queued for next sign-in via `pending_cleanup_hooks` localStorage flag.

### API Surface Parity

- The `apps/web/src/app/api/notifications/send/route.ts` is the single send-side surface. Mobile composers (`apps/mobile/app/(app)/(drawer)/[orgSlug]/notifications/new.tsx:26`) and web composers both POST here. After P0, both can also pick a "push" channel.
- The `getInviteLink(invite, baseUrl)` helper at `apps/mobile/src/hooks/useInvites.ts:215` is the canonical link builder. R4 share, R6 wallet QR, and R2 scanner all consume the same format.
- The `getNotificationRoute(data)` helper at `apps/mobile/src/lib/notifications.ts:230–243` is the single push-tap router. R1 expansion, R6 wallet add taps, R7 LA taps, R8 quick actions, and R2 QR scans all funnel through `parseTeammeetUrl + routeIntent` (the post-P0 successor).
- Sign-out logic in `AuthContext`: today only clears Supabase session. Post-P0, calls `runSignOutHooks()`. Account-deletion path at `apps/web/src/app/api/user/delete-account` similarly calls `runEraseHooks(userId)`.

### Integration Test Scenarios

1. **Push fan-out respects audience**: announcement targeting `audience='alumni'` → only alumni device tokens receive push; alumni who muted `announcement_push_enabled` do not. Cross-layer: web schema, lib/notifications/push.ts, Supabase RLS, expo-server-sdk, mobile foreground handler.
2. **QR roundtrip**: admin generates invite QR (web) → member scans on mobile (R2) → joins via `/app/join?token=...` → org appears in member list. Cross-layer: web QR generator, mobile camera, deep link parser, web join handler, RLS for org membership.
3. **Wallet pass updates on role change**: admin promotes member to admin → APNs wallet wake fires → device pulls fresh `.pkpass` with "Admin" role label. Cross-layer: web update API, wallet update worker, APNs direct, Apple Wallet device behavior.
4. **Biometric + cold-start push tap**: user taps push notification on locked device → iOS opens app → biometric prompt fires → on unlock, queued deep link replays → routes to announcement detail. Cross-layer: notifications, BiometricLockContext, deep link router, Expo Router.
5. **Live Activity end on event cancel**: admin cancels active event → APNs LA `event: 'end'` push fires → activity disappears from Lock Screen within 30s. Cross-layer: web event update, LA worker, APNs direct, ActivityKit.

## Acceptance Criteria

### Phase 0 — Foundation

- [ ] **P0.1**: All deep-link consumers (auth callback, push tap, share intent, wallet add, LA tap, quick action, QR scan) route through `parseTeammeetUrl + routeIntent` in `apps/mobile/src/lib/deep-link.ts`. The legacy parsing in `app/_layout.tsx:180–289` is removed.
- [ ] **P0.2**: A fresh-install user reaches the home feed with at most one system permission prompt (push, after sign-in). Camera, calendar, and biometric prompt only on user intent.
- [ ] **P0.3**: Universal Links resolve: `https://www.myteamnetwork.com/[orgSlug]/announcements/[id]` opens the app to the announcement detail screen on devices with the app installed; falls through to the web app otherwise. Verified via Apple Validation Tool and Google Statement List Generator.
- [ ] **P0.4**: `runSignOutHooks` and `runEraseHooks` registries exist and are called from `AuthContext.signOut` and `api/user/delete-account` respectively. Test verifies all registered hooks fire.
- [ ] **P0.5**: A POST to `/api/notifications/send` with `pushType: 'announcement'`, `pushResourceId: '<id>'`, `channel: 'push'` enqueues a `notification_jobs` row, the worker processes it, and an Expo push reaches a registered test device within 5s P95.
- [ ] **P0.6**: `cron/event-reminders` runs successfully and enqueues 1h-before reminders for attending RSVPs without duplicates and without notifying for cancelled events.

### Phase 1 — High-leverage native

- [ ] **R1.1**: `useNotificationPreferences` reads and writes `push_enabled` and the per-category `*_push_enabled` columns. Settings UI exposes per-category Switch toggles. Defaults: announcements + chat mentions + event reminders ON; rest OFF.
- [ ] **R1.2**: Push fires within 5s P95 for: chat new message in a group I'm in, new announcement targeting my role, event reminder 24h/1h before RSVP'd-yes events, mentor message, donation confirmation.
- [ ] **R1.3**: Audience targeting respected (alumni-targeted announcement does not push to active members).
- [ ] **R1.4**: DeviceNotRegistered tokens deleted within 15 min of receipt poll.
- [ ] **R2a.1**: `docs/qr-bug-rca.md` documents the confirmed root cause. 100 consecutive invite QR generations succeed in dev and prod.
- [ ] **R5.1**: Biometric Settings toggle hidden when `hasHardwareAsync()` returns false. Visible and functional otherwise. Cold-start prompts when enabled.
- [ ] **R5.2**: Background > 5min → foreground requires biometric. App-switcher shows privacy overlay when locked or backgrounding.
- [ ] **R5.3**: After 3 biometric failures + passcode cancel, user lands on password sign-in (not signed out).
- [ ] **R5.4**: Re-enrollment of biometrics on the device invalidates the stored credential; user is re-prompted for password and re-opt-in.
- [ ] **R2b.1**: Camera scanner accessible from event check-in (admin) and from a "Scan to join" entry (auth and post-auth). Scans `teammeet://event-checkin/...` and `teammeet://join/...` formats.
- [ ] **R2b.2**: Camera permission denial routes to manual check-in (existing screen) without breaking other features.
- [ ] **R2b.3**: Continuous-scan mode for admin event check-in re-arms after 1.5s without flicker (does not unmount `CameraView`).
- [ ] **R4.1**: Share buttons present on event detail, job detail, post detail, invite detail, and member directory (when admin can invite). Each opens the system share sheet with the canonical URL.
- [ ] **R4.2**: Recipient with the app installed lands on the right screen (universal link); recipient without app falls through to web equivalent.

### Phase 2 — Calendar & shortcuts

- [ ] **R8.1**: Long-press app icon shows 4 actions matching the user's last-active role (admin or member) for their last-active org.
- [ ] **R8.2**: Tapping an action routes to the correct screen, surviving cold start (queued behind biometric lock if enabled).
- [ ] **R3.1**: Enabling calendar sync creates `TeamMeet — ${orgName}` calendar(s) on device, one per org. New events appear within one sync cycle.
- [ ] **R3.2**: Cancelled events are removed from device calendar within one sync cycle.
- [ ] **R3.3**: Disabling sync removes only events sourced by the app (does not touch user-created entries).
- [ ] **R3.4**: Per-category sync preferences (game/meeting/social/etc.) are respected.
- [ ] **R3.5**: Sign-out prompts user to remove calendars; default Yes; on Yes, all `TeamMeet — *` calendars deleted.
- [ ] **R3.6**: Calendar permission denied → all per-org toggles render disabled with "Re-enable in Settings" CTA.

### Phase 3 — Premium native

- [ ] **R6.1**: Org admin enables wallet → eligible members see "Add to Apple Wallet" (iOS) or "Save to Google Wallet" (Android) on profile screen.
- [ ] **R6.2**: Tapping installs a pass containing org logo, member name, role, graduation year (if member), and a QR code that decodes to `teammeet://event/<id>/checkin/<userId>` format usable by R2's admin scanner.
- [ ] **R6.3**: Member role/photo change → device pass updates within 60s of next wallet wake.
- [ ] **R6.4**: Member opt-out works; admin sees opted-out count in org settings.
- [ ] **R6.5**: Member graduated/revoked → pass voided within 60s; QR scan returns "expired" toast.
- [ ] **R7.1**: When event becomes live (start <= now <= end), Live Activity appears on Lock Screen for users with `event_rsvps.status='attending'`.
- [ ] **R7.2**: Admin sees check-in count updating live; member sees own check-in status + countdown.
- [ ] **R7.3**: Event cancellation → activity dismissed within 30s.
- [ ] **R7.4**: Activity ends at event end_time + 30 min grace; never exceeds 8h.
- [ ] **R7.5**: Feature flag `EXPO_PUBLIC_MOBILE_LIVE_ACTIVITIES_ENABLED` cleanly disables the LA flow without breaking the iOS build.
- [ ] **R8.3**: Siri Shortcut "Scan a code in TeamMeet" appears in Spotlight search and triggers the scanner.

### Cross-cutting

- [ ] **X.1**: Sign-out cleans up: push tokens, biometric flag, secure-store session, device calendars, wallet passes (server-side revoke), Live Activity tokens, quick action items.
- [ ] **X.2**: Account deletion (`api/user/delete-account`) iterates `runEraseHooks` and removes all of the above server-side data.
- [ ] **X.3**: `apps/mobile/docs/data-safety.md` and `docs/data-safety.md` updated with disclosures for new permissions (camera, calendar, biometric).
- [ ] **X.4**: Multi-device per user: 2 phones registered for push, both ring on every push.
- [ ] **X.5**: No regressions on other screens (run `bun run test:routes` + `bun run test:unit` + manual smoke on chat, feed, events, admin flows).

### Non-Functional Requirements

- [ ] **N.1**: Push latency P95 ≤ 5s end-to-end (web POST → device receipt).
- [ ] **N.2**: Push fan-out queue handles 25k bursts without exceeding 600 push/sec/project (Expo limit) — drains at ≤ 500/sec with retry on 429.
- [ ] **N.3**: `.pkpass` GET endpoint serves with `Cache-Control: public, max-age=60` and supports `If-Modified-Since` 304s.
- [ ] **N.4**: Biometric prompt latency ≤ 200ms on a recent iPhone.
- [ ] **N.5**: Camera scan-to-decode latency ≤ 500ms in normal lighting.

### Quality Gates

- [ ] **Q.1**: `bun typecheck` passes.
- [ ] **Q.2**: `bun lint` passes (linter hook may rewrite Settings files; re-read after edits).
- [ ] **Q.3**: New unit tests for `parseTeammeetUrl`, `sendPush`, `runSignOutHooks`, `getOrCreateAppCalendar`, `getMemberPassPayload`. Coverage of new code paths ≥ 80%.
- [ ] **Q.4**: Manual smoke test on iOS 16.4+ (LA min) and Android 10+. Test biometric on a device with no enrolled biometrics (toggle should hide).
- [ ] **Q.5**: EAS build succeeds for both `development` and `production` profiles after Widget Extension target is added.

## Success Metrics

- **Engagement**: WAU and average sessions/day for active members rise meaningfully after P1 (push + biometric).
- **Admin self-sufficiency**: % of admin actions (announcements sent, check-ins recorded, RSVPs viewed) originating on mobile rises after P1 + P2.
- **Growth loops**: invite-sent and invite-accepted rates rise after R2 + R4 + universal links.
- **Reliability**: zero QR generation failures in production after R2a fix (per `docs/REPRO.md` Issue #1).
- **Adoption**: ≥30% of eligible members opt into biometric unlock within 60 days of release; ≥50% of members at participating orgs install their Wallet pass.
- **Push quality**: < 1% receipt-level error rate (excluding `DeviceNotRegistered`) sustained.

## Alternative Approaches Considered

- **Inline push fan-out from API route (rejected)**: simpler but Vercel function timeout (~10–60s) and no receipt handling. Queue + worker is the only sane path at scale.
- **Two-way calendar sync (rejected)**: read device calendar back into the app. 80% more complexity for ~10% of the value. One-way write is in scope.
- **Hand-rolled config plugin for Widget Extension (rejected)**: maintenance nightmare, breaks every SDK upgrade. Use `@bacons/apple-targets`.
- **Native PassKit module on iOS (rejected for v1)**: `react-native-passkit-wallet` works but adds a native module. Web-handoff via `Linking.openURL(passUrl)` + system MIME handling is simpler and sufficient.
- **Android Live Activities equivalent (deferred)**: Live Updates / Ongoing Notifications API is newer and more fragmented. iOS first; Android in a follow-up.
- **Apple Push Notification per-user single device (rejected)**: causes silent failures when users have multiple devices. Push to all device tokens; the user wants every device to ring.
- **Use `expo-barcode-scanner` (rejected)**: deprecated. Use `CameraView` + `barcodeScannerSettings` per SDK 54.
- **One device calendar across all orgs (rejected)**: harder to hide/delete by org. Per-org calendars cost a few extra entries in the user's calendar list but match how multi-org users think.
- **All eight features parallelized (rejected)**: skips P0 cross-cutting work, accumulates technical debt across multiple features touching the deep-link handler simultaneously, conflicts with active OAuth parity plan.

## Dependencies & Prerequisites

- **Active dependency**: `docs/plans/2026-04-26-001-feat-mobile-oauth-parity-with-web-plan.md` is refactoring the same deep-link handler this plan touches. Coordinate or sequence: ideally OAuth plan ships first, then P0 of this plan extends the handler. If parallel, both plans converge on `apps/mobile/src/lib/deep-link.ts`.
- **Apple Developer Program** account with: APNs key (`.p8`) — already provisioned for Expo Push; Pass Type ID + cert (NEW for R6); Widget Extension provisioning profile (NEW for R7).
- **Google Wallet Issuer account** + service account JSON key (NEW for R6).
- **Expo SDK 54** confirmed compatible with all required modules (`expo-camera`, `expo-calendar`, `expo-sharing`, `expo-local-authentication`, `expo-quick-actions`). All available now per framework docs research.
- **`@bacons/apple-targets`** community package — pinned version, fork as fallback if maintainer disappears.
- **`expo-server-sdk`** added to `apps/web/package.json`.
- **`passkit-generator`** added to `apps/web/package.json` for `.pkpass` signing (P3).
- **`google-auth-library`** added to `apps/web/package.json` for Google Wallet JWT signing (P3).
- **Env vars**: `EXPO_ACCESS_TOKEN` (P0), `APNS_KEY_ID` + `APNS_TEAM_ID` + `APNS_AUTH_KEY` (P3), `APPLE_WWDR_PEM` + `PASS_SIGNER_PEM` + `PASS_SIGNER_KEY_PEM` + `PASS_SIGNER_PASSPHRASE` (P3), `GOOGLE_WALLET_SA_KEY` + `GOOGLE_WALLET_ISSUER_ID` (P3).
- **Reconciled `eas.json`** between root and `apps/mobile/` before P3.

## Risk Analysis & Mitigation

| Risk | Severity | Mitigation |
|------|----------|------------|
| Deep-link handler conflict with active OAuth plan | High | Sequence after OAuth plan, or coordinate on the shared `deep-link.ts` module. Communicate before merging either. |
| Live Activities Widget Extension breaks iOS build | High | Feature flag `EXPO_PUBLIC_MOBILE_LIVE_ACTIVITIES_ENABLED` defaulting OFF until verified in TestFlight. EAS production profile excludes the target until cleared. |
| Apple Pass Type ID cert expires (annual) | Medium | Calendar reminder 11 months out. Document rotation in `docs/runbook.md`. Existing passes keep working visually but stop receiving updates after expiry. |
| Universal Links AASA misconfig | Medium | Verify on Apple Validation Tool before merging. Test on a real device, not simulator. |
| Push token hoarding causing > 600/sec on big org | Medium | Queue + worker drains at ≤ 500/sec. Backoff on 429 receipts. |
| Wallet pass generation slow at scale | Medium | Cache generated `.pkpass` bytes by `(passTypeId, serial, last_updated_at)` in Vercel edge cache; serve from there with `If-Modified-Since` 304s. |
| `react-native-svg` hoisting breaks more than just QR | Low | If pinning in `metro.config.js extraNodeModules` doesn't fix QR, swap to `@react-native-community/qr-code` as fallback. |
| Linter hook overwriting Settings files breaks edits | Low | Per `MEMORY.md`: use `Write` not `Edit` on `SettingsInvitesSection.tsx`, forms files. Re-read after each modification. |
| Camera permission disclosure changes Play Store review | Low | Update `docs/data-safety.md` before submission; flag for Play Console form re-review. |
| Biometric stale-session on iOS Keychain after reinstall | Low | On cold start, validate session against server within 5s; on 401, clear biometric flag. |

## Resource Requirements

- **Engineering**: one mobile-fluent engineer (Expo + native iOS), one backend engineer (Node + Supabase), iterating across 4 phases. P3 needs Swift familiarity for ActivityKit + App Intents.
- **Apple Developer**: account admin role to create extension App IDs and add App Group entitlements (App Manager role isn't enough).
- **Time estimate**: P0 ≈ 1–2 weeks; P1 ≈ 3–4 weeks; P2 ≈ 1.5–2 weeks; P3 ≈ 4–6 weeks (R7 dominates). Total: 9.5–14 weeks of focused work.
- **External services**: Expo (existing); APNs `.p8` (existing); Apple Pass Type ID cert (new, $99/yr already covers); Google Wallet Issuer (free, requires approval ~1 week).
- **Vercel**: existing capacity sufficient for the new endpoints. Consider provisioned concurrency for `/api/wallet/apple/[serial]` if many devices register simultaneously.

## Future Considerations

- **Android Live Updates** (Android equivalent of Live Activities) once API matures.
- **Two-way calendar sync** (read device calendar to detect conflicts when proposing event times).
- **Apple Watch / Wear OS**: Wallet passes auto-flow to Apple Watch once on iPhone; explicit watch app is a separate plan.
- **Background sync / offline-first feed**: deferred until offline becomes a stated goal.
- **Home-screen widgets** (Lock Screen LA gives most of the value already).
- **Contacts import for parent invites** (deferred; nice-to-have).
- **Apple Sign-In on iOS** (mandated by Apple Guideline 4.8 once social OAuth ships per OAuth parity plan; coordinate with that plan).
- **Push web/PWA channel** if a web app push is ever scoped.

## Documentation Plan

- New: `docs/qr-bug-rca.md` (P1, R2a investigation)
- New: `docs/runbook.md` additions for Pass Type ID + APNs `.p8` cert rotation (P3)
- New: `docs/cron.md` documents the new `event-reminders` and `push-receipts` crons
- Update: `docs/data-safety.md` and `apps/mobile/docs/data-safety.md` with new permission disclosures (camera, calendar, biometric, wallet)
- Update: `apps/mobile/CLAUDE.md` with new patterns (deep-link router, sign-out hook registration, permission UX hook)
- Update: `docs/env.md` with new env vars
- Update: this plan's status when each phase completes
- Update: origin requirements doc at `/Users/louisciccone/.claude/plans/give-me-some-ideas-zany-hearth.md` is referenced via `origin:` frontmatter and not modified

## Sources & References

### Origin

- **Origin requirements doc**: `/Users/louisciccone/.claude/plans/give-me-some-ideas-zany-hearth.md` (2026-04-26). Key decisions carried forward:
  1. Mobile-native lane chosen over web→mobile parity gaps (highest leverage; latent infrastructure exists)
  2. One-way calendar write, not two-way (80% value at 20% complexity)
  3. Push notification defaults conservative (announcements + chat mentions + event reminders ON; rest OFF)
  4. Wallet opt-in per org with per-member opt-out
  5. iOS-first for Live Activities; Android equivalent deferred
  6. QR generation gets a real fix, not a retry loop

  Key revisions made during planning research:
  - Phasing revised: added P0 foundation phase before any feature work (deep-link router, permission UX, universal links, sign-out hooks, push spine, event-reminder cron) because 6 of 8 capabilities depend on these cross-cutting concerns
  - R2 split into R2a (QR generation fix) and R2b (camera scanner) for sequencing
  - Universal links added to scope (R4 share UX is broken without them)

### Internal references

- `apps/mobile/CLAUDE.md` — mobile conventions (read first)
- `apps/mobile/app/_layout.tsx:111–321` — root provider stack, deep-link handler to refactor
- `apps/mobile/app/_layout.tsx:130` — existing `usePushNotifications` mount point
- `apps/mobile/src/hooks/usePushNotifications.ts` — token registration; reuse
- `apps/mobile/src/lib/notifications.ts:230–243` — `getNotificationRoute`, extend
- `apps/mobile/src/lib/auth-storage.ts` — SecureStore wrapper, biometric pattern reference
- `apps/mobile/src/components/settings/SettingsNotificationsSection.tsx` — extend with per-category Switches
- `apps/mobile/src/hooks/useNotificationPreferences.ts` — fix; currently ignores `push_enabled`
- `apps/mobile/app/(app)/(drawer)/[orgSlug]/events/check-in.tsx` — extend with Scan button
- `apps/mobile/src/hooks/useEvents.ts:199–222` — realtime subscription pattern
- `apps/mobile/src/lib/web-api.ts:11–22` — `getWebPath` helper for canonical URLs
- `apps/mobile/src/hooks/useInvites.ts:215` — `getInviteLink` helper
- `apps/mobile/src/lib/featureFlags.ts` — local feature flag pattern
- `apps/mobile/metro.config.js` — `extraNodeModules` for `react-native-svg` pinning
- `apps/mobile/app.json` — scheme, permissions, plugins
- `apps/mobile/eas.json` and root `eas.json` — reconcile before P3
- `apps/mobile/plugins/withOptionalHardwareFeatures.js` — keeps camera optional on Android
- `apps/web/src/app/api/notifications/send/route.ts` — extend with push channel + Zod fields
- `apps/web/src/lib/notifications.ts` — extend with `sendPush`
- `apps/web/src/lib/qr-utils.ts` — surface swallowed error in P1 R2a investigation
- `apps/web/src/app/api/cron/calendar-sync/route.ts` — pattern reference for new cron
- `packages/core/src/announcements.ts` (or similar) — `filterAnnouncementsForUser` for audience targeting
- `supabase/migrations/20260425100000_push_notifications.sql` — `user_push_tokens` table; reuse
- `supabase/migrations/20260605000000_add_category_notification_prefs.sql` — pattern for new `*_push_enabled` columns
- `docs/REPRO.md` — known bugs, including QR Issue #1
- `docs/db/schema-audit.md` — calendar sync data model
- `docs/data-safety.md` and `apps/mobile/docs/data-safety.md` — permission disclosures
- `docs/plans/2026-04-26-001-feat-mobile-oauth-parity-with-web-plan.md` — concurrent plan refactoring deep-link handler
- `docs/plans/2026-03-16-mobile-web-billing-handoff.md` — `StripeWebView` web-handoff pattern reference
- `MEMORY.md` — linter hook footguns on Settings/forms files

### External references

- [Expo Notifications — SDK 54](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo Push Service — sending notifications](https://docs.expo.dev/push-notifications/sending-notifications/)
- [expo-server-sdk-node](https://github.com/expo/expo-server-sdk-node)
- [Expo Camera — SDK 54](https://docs.expo.dev/versions/latest/sdk/camera/)
- [Expo Calendar — SDK 54](https://docs.expo.dev/versions/latest/sdk/calendar/)
- [Expo LocalAuthentication — SDK 54](https://docs.expo.dev/versions/latest/sdk/local-authentication/)
- [Expo SecureStore — SDK 54](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [Expo Sharing — SDK 54](https://docs.expo.dev/versions/latest/sdk/sharing/)
- [Expo Linking & Universal Links](https://docs.expo.dev/guides/deep-linking/)
- [Expo Config Plugins](https://docs.expo.dev/config-plugins/introduction/)
- [@bacons/apple-targets (expo-apple-targets)](https://github.com/EvanBacon/expo-apple-targets)
- [expo-quick-actions](https://github.com/EvanBacon/expo-quick-actions)
- [Apple WalletPasses (PassKit)](https://developer.apple.com/documentation/walletpasses)
- [Apple — Pass update web service](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes)
- [passkit-generator](https://github.com/alexandercerutti/passkit-generator)
- [Apple ActivityKit (Live Activities)](https://developer.apple.com/documentation/activitykit)
- [Apple — Live Activity push notifications](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications)
- [Apple App Intents (iOS 16+)](https://developer.apple.com/documentation/appintents)
- [Google Wallet API — Generic Passes](https://developers.google.com/wallet/generic)
- [Google Wallet — JWT format](https://developers.google.com/wallet/generic/use-cases/jwt)
- [Supabase Edge Functions — Background tasks](https://supabase.com/docs/guides/functions/background-tasks)
- [Supabase Realtime — postgres_changes](https://supabase.com/docs/guides/realtime/postgres-changes)
