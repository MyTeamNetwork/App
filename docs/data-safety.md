# TeamMeet Android Data Safety Reference

Package: `com.myteamnetwork.teammeet`  
Prepared for: Google Play Console Data Safety form  
Last reviewed: 2026-04-12

Interpretation note: This document follows Google Play's Data Safety definitions. In particular, `Shared with third parties?` below follows Play's definition, which excludes transfers to service providers acting on our behalf and user-initiated transfers that users reasonably expect (for example, Google OAuth or Stripe checkout). See Google Play Console Help: <https://support.google.com/googleplay/android-developer/answer/10787469?hl=en>.

## 1. App overview

TeamMeet is a multi-tenant mobile app for organizations such as teams, clubs, fraternities, and alumni groups. Members use it to sign in, manage their profile and organization membership, read announcements, message other members, browse events and schedules, log workouts, upload photos, receive push notifications, and optionally make donations through Stripe-powered checkout.

## 2. Data collection & sharing matrix

| Data Type | Collected? | Shared with third parties? | Purpose | Required or Optional | User-facing disclosure |
| --- | --- | --- | --- | --- | --- |
| Location | Yes | No | App functionality, account management. Current evidence is limited to optional user-entered `current_city` on alumni profiles; no device-derived location permissions are requested. | Optional | Alumni/profile editing fields. `VERIFY:` confirm Play classification for user-entered city data before final submission. |
| Personal info | Yes | No | Account management, app functionality, developer communications, fraud prevention/security/compliance | Mixed: account email/user ID required; name/profile fields largely optional after signup | Email/password signup, Google sign-in, profile editing, organization membership, member/alumni/parent directory screens |
| Financial info | Yes | No | App functionality, account management, fraud prevention/security/compliance | Optional / feature-dependent | Donation and billing flows. TeamMeet records donation and transaction metadata; payment card data goes directly to Stripe and is not stored in TeamMeet tables. |
| Health and fitness | Yes | No | App functionality | Optional / feature-dependent | Workout and workout-log screens |
| Messages | Yes | No | App functionality, developer communications, fraud prevention/security/compliance | Optional / feature-dependent | In-app chat and announcement/discussion flows |
| Photos and videos | Yes | No | App functionality | Optional | Profile avatar uploads, feed/chat image attachments, chat-group avatars, org customization images. Photos are collected; videos are not evidenced in current mobile code. |
| Audio | No | No | Not collected | N/A | `RECORD_AUDIO` is blocked in `app.json`. |
| Contacts | No | No | Not collected | N/A | No contacts/address-book permission or contact import flow. Member directory data is first-party app profile data, not device contacts. |
| Calendar | Yes | No | App functionality, developer communications | Optional / feature-dependent | Events, schedules, academic schedules, and in-app calendar features. No Android calendar permission is requested. |
| App activity | Yes | No | Analytics, app functionality, fraud prevention/security/compliance | `VERIFY:` optional in SDK design, but mobile settings/UI toggle was not confirmed in current source | PostHog screen/event tracking and related telemetry. Current code supports enable/disable at the SDK layer. |
| Web browsing | No | No | Not collected | N/A | OAuth opens a browser session, but the app does not collect browsing history. |
| App info and performance | Yes | No | Analytics, fraud prevention/security/compliance | `VERIFY:` optional in SDK design, but mobile settings/UI toggle was not confirmed in current source | Sentry crash/error/diagnostic reporting |
| Device or other IDs | Yes | No | App functionality, analytics, fraud prevention/security/compliance | Mixed: account ID required; push/analytics/device IDs optional or feature-dependent | Supabase user ID, Expo push token, hashed device ID for push-token deduplication, SDK/device identifiers used by analytics and crash reporting |

## 3. Third-party SDKs and their data practices

### Supabase

- Purpose: authentication, database, storage, realtime subscriptions
- Data involved: account email, user ID, profile data, organization membership, messages, events, schedules, workout logs, donation metadata, uploaded photos, push tokens
- Shared or sold: not sold; treated as a service provider / processor
- Privacy policy: <https://supabase.com/privacy>

### Stripe

- Purpose: subscription billing and donation checkout
- Data involved: user-entered payment details, payer name/email, amount, checkout/session/payment intent metadata
- Shared or sold: not sold; treated as a service provider. Card/payment account data goes directly to Stripe rather than TeamMeet storage.
- Privacy policy: <https://stripe.com/privacy>

### PostHog

- Purpose: product analytics
- Data involved: screen views, event names/properties, user ID / distinct identifier, org/role properties, device/app context
- Shared or sold: not sold; treated as a service provider
- Privacy policy: <https://posthog.com/privacy>

### Sentry

- Purpose: crash reporting and diagnostics
- Data involved: crash logs, stack traces, diagnostic/performance context, user ID, device/app/OS context
- Shared or sold: not sold; treated as a service provider
- Privacy policy: <https://sentry.io/privacy/>

### Expo Notifications / FCM

- Purpose: push notifications on Android
- Data involved: Expo push token, hashed stable device identifier, platform, notification routing metadata/payload needed for delivery
- Shared or sold: not sold; treated as service-provider processing for delivery
- Privacy policies: <https://expo.dev/privacy>, <https://policies.google.com/privacy>

### Google Sign-In

- Purpose: account authentication
- Data involved: Google account email and identifier, OAuth/ID token flow data, profile data returned through Google-authenticated sign-in
- Shared or sold: not sold; user-initiated authentication flow
- Privacy policy: <https://policies.google.com/privacy>

## 4. Data handling practices

### Encryption in transit

Yes. TeamMeet uses HTTPS and TLS for app-to-server communication, including Supabase, Stripe, Google OAuth, and other backend/API traffic.

### Encryption at rest

Yes. Source compliance docs state Supabase PostgreSQL uses encryption at rest (documented as AES-256 in `docs/Data_Inventory.md` and `docs/FERPA_COMPLIANCE.md`).

### User data deletion mechanism

Yes. TeamMeet provides account deletion through both mobile and web:

- Mobile: `/(app)/(drawer)/delete-account`
- Web/API: `DELETE /api/user/delete-account`

Current flow:

1. User confirms deletion with `DELETE MY ACCOUNT`.
2. System creates or updates a `user_deletion_requests` record.
3. Account deletion is scheduled for 30 days later.
4. Analytics-related records are deleted immediately.
5. User can cancel during the grace period via `POST /api/user/delete-account`.
6. After the grace period, the intended behavior is permanent deletion cascading through user data.

### Data retention policy

- Core account and organization data: retained while the account remains active and as needed to provide the service.
- Account deletion: 30-day grace period before permanent deletion.
- Analytics deletion on account deletion: immediate cleanup of analytics-related records in the deletion route.
- Web privacy policy: behavioral analytics retained for 90 days; ops telemetry retained for 30 days.
- Push tokens: removed on logout and replaced when a device token rotates.
- `VERIFY:` there is no single mobile-specific retention schedule covering every application table beyond active-account retention plus deletion flow.

## 5. Account & authentication

### Is an account required?

Yes. The authenticated app experience requires a TeamMeet account.

### Is account deletion available?

Yes. Available in-app and on the web.

### How does authentication work?

- Email/password via Supabase Auth
- Google OAuth via Supabase Auth + Google sign-in flow

### How does account deletion work?

- In-app path: drawer -> `Delete My Account`
- Web/API path: `/api/user/delete-account`
- Users must confirm the destructive action
- Admins must transfer org ownership/admin rights before deletion
- Pending deletion can be cancelled during the 30-day grace period

`VERIFY:` `docs/DATA_FLOW.md` and `apps/mobile/CLAUDE.md` describe native session persistence as AsyncStorage, but current mobile implementation uses `expo-secure-store` in `apps/mobile/src/lib/auth-storage.ts`. Use the code path, not the older docs, when answering storage questions elsewhere.

## 6. Children's privacy

### Age gate implementation

Web source shows a neutral age gate implemented through `POST /api/auth/validate-age`, which returns an under-13 redirect and rejects `under_13` age tokens until parental consent is implemented. Web analytics policy also fail-closes for `under_13` users.

### COPPA compliance posture

Intended posture: TeamMeet is not supposed to allow self-serve under-13 registration until parental consent tooling exists.

### `BLOCKER / VERIFY` before Play submission

Current native mobile auth source does **not** show equivalent age-gate enforcement:

- `apps/mobile/app/(auth)/signup.tsx` calls `supabase.auth.signUp()` directly
- `apps/mobile/app/(auth)/login.tsx` Google OAuth flow does not pass through the web age-gate validation flow

Because of that, do **not** state that the Android app has a fully enforced mobile age gate without remediation or a deliberate distribution policy decision. Before Play submission, either:

1. Align native signup/sign-in with the web age-gate flow, or
2. Update target-audience/compliance posture to reflect the current mobile behavior.

## 7. Play Console form answers

### Top-level Data safety answers

- Does this app collect or share any of the required user data types? `Yes`
- Is all user data collected by this app encrypted in transit? `Yes`
- Does this app provide a way for users to request deletion of their data? `Yes`

### Data types to mark as collected

- Location: `Yes`  
  Note: based on optional user-entered `current_city`; no device-derived location permission. `VERIFY` classification before final submission.
- Personal info: `Yes`
- Financial info: `Yes`
- Health and fitness: `Yes`
- Messages: `Yes`
- Photos and videos: `Yes`
- Audio: `No`
- Contacts: `No`
- Calendar: `Yes`
- App activity: `Yes`
- Web browsing: `No`
- App info and performance: `Yes`
- Device or other IDs: `Yes`

### Data types to mark as shared

- Location: `No`
- Personal info: `No`
- Financial info: `No`
- Health and fitness: `No`
- Messages: `No`
- Photos and videos: `No`
- Audio: `No`
- Contacts: `No`
- Calendar: `No`
- App activity: `No`
- Web browsing: `No`
- App info and performance: `No`
- Device or other IDs: `No`

### Required / optional guidance for collected categories

- Personal info: `Required` for account email/user ID; profile enrichment fields are optional
- Financial info: `Optional`
- Health and fitness: `Optional`
- Messages: `Optional`
- Photos and videos: `Optional`
- Calendar: `Optional`
- App activity: `VERIFY` before submission; code supports disablement but user-facing mobile toggle was not confirmed
- App info and performance: `VERIFY` before submission; code supports disablement but user-facing mobile toggle was not confirmed
- Device or other IDs: `Mixed` because account IDs are required while push/analytics/device IDs are feature-dependent
- Location: `Optional`

### Purposes to select for collected categories

- App functionality
- Account management
- Developer communications
- Analytics
- Fraud prevention, security, and compliance

Do **not** select:

- Advertising or marketing
- Personalization

### Submission checklist

- [ ] Confirm final Play treatment of optional user-entered `current_city` as `Location`
- [ ] Confirm whether the released Android build exposes a user-facing telemetry toggle
- [ ] Resolve mobile age-gate parity or update compliance posture before submission
- [ ] Confirm no additional data types are introduced by the final release artifact or transitive SDK changes

## Sources

Primary repository sources reviewed:

- `docs/DATA_FLOW.md`
- `docs/Data_Inventory.md`
- `docs/COPPA_COMPLIANCE.md`
- `docs/FERPA_COMPLIANCE.md`
- `apps/mobile/app.json`
- `apps/mobile/CLAUDE.md`
- `apps/mobile/src/lib/analytics/`
- `apps/mobile/src/lib/notifications.ts`
- `apps/mobile/app/(auth)/signup.tsx`
- `apps/mobile/app/(auth)/login.tsx`
- `apps/mobile/app/(app)/(drawer)/delete-account.tsx`
- `apps/web/src/app/api/user/delete-account/route.ts`
- `docs/db/schema-audit.md`
- `apps/web/src/app/privacy/page.tsx`

External references:

- Google Play Data Safety form guidance: <https://support.google.com/googleplay/android-developer/answer/10787469?hl=en>
- Supabase privacy policy: <https://supabase.com/privacy>
- Stripe privacy policy: <https://stripe.com/privacy>
- PostHog privacy policy: <https://posthog.com/privacy>
- Sentry privacy policy: <https://sentry.io/privacy/>
- Expo privacy policy: <https://expo.dev/privacy>
- Google privacy policy: <https://policies.google.com/privacy>
