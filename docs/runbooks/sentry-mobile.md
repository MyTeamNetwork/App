# Runbook: Sentry (mobile — errors + performance)

Ops reference for the `@teammeet/mobile` Sentry project. Covers the dashboard,
alert setup, quota tuning, and OTA source maps. For the web app's own
error-alert email pipeline (unrelated system, Resend-based), see
`docs/Incident_Response_Runbook.md` section 5.

## 1. What's instrumented

- **Errors:** `captureException` / `captureMessage` via `src/lib/analytics/sentry.ts`.
- **Performance:** transaction tracing (`tracesSampleRate`), expo-router
  navigation instrumentation (screen-load transactions, time-to-initial-display),
  and app-hang detection.
- **Profiling:** `profilesSampleRate`, sampled as a fraction of traced transactions.
- **Session Replay:** intentionally **off**. The App Store "Data Not Used to
  Track You" label (see `docs/app-store-submission.md`) does not cover session
  replay; enabling it requires a label change plus an ATT prompt. Do not turn
  this on without updating that doc first.

## 2. Dashboard: release health

Sentry's **Releases** page reports crash-free sessions / crash-free users per
release. Release identifier format (set in `sentry.ts` at `Sentry.init`):

```
release = "<applicationId>@<version>+<build>"   # e.g. com.myteamnetwork.teammeet@1.0.1+42
dist    = "<build>"                              # native build number, matches source maps
```

- `applicationId` / `version` / `build` come from `expo-application` at
  runtime, so a release only shows up once a build with that version+build
  combo has actually run in the field.
- **Crash-free sessions** = % of app sessions with zero unhandled crash.
  Watch this per release after each TestFlight/production rollout, not just
  in aggregate — a regression in one release can be masked by good history
  on older releases if you only look at the "all time" number.
- OTA (EAS Update) pushes update the JS bundle but not the release identifier
  (`version`/`build` are native). Multiple OTA pushes to the same native
  build show up under the same release — use the OTA source-map step (§4) so
  stack traces still symbolicate correctly for JS shipped after the native
  build.

## 3. Alert rules (one-time manual setup in Sentry UI)

Not configured as code — set these up once under **Project Settings → Alerts**:

1. **Crash-free sessions drop** — alert when crash-free sessions for the
   latest release drops below a threshold (start at 99%) over a rolling
   window (e.g. 1 hour after a release has enough volume). Use a
   release-scoped metric alert, not project-wide, so a bad release doesn't
   get diluted by old healthy releases.
2. **New issue spike** — alert on a new issue type first seen, filtered to
   `environment:production` (matches the `environment` tag set in
   `sentry.ts`) so `__DEV__` noise doesn't page anyone.
3. **Regression alerts** — Sentry's built-in "issue regressed" alert
   (a previously resolved issue reappears). Keep default sensitivity unless
   it's noisy.
4. **Performance regression** (optional, once trace volume is high enough) —
   alert on p95 transaction duration or TTID regression for key screens.

**Notification channel:** no Slack/PagerDuty integration exists in this repo
today (checked — no webhook, no alerting doc references either). The closest
existing convention is the web app's `ADMIN_EMAIL`-based email alerting
(`docs/Incident_Response_Runbook.md` §5.3). Until a team channel is wired up,
point these Sentry alert rules at **email** to the on-call/admin address used
there, or update this line once a Slack workspace/webhook is chosen.

## 4. Quota: sample rates

Tracing and profiling both consume Sentry quota (transactions and profile
hours are billed separately from errors). Current targets:

- `tracesSampleRate`: **0.2** in production (20% of transactions traced)
- `profilesSampleRate`: **0.1** (10% of _traced_ transactions are profiled —
  effectively 2% of all sessions)

Tune both in `apps/mobile/src/lib/analytics/sentry.ts`. If quota alerts fire
in Sentry (Settings → Subscription → Usage), lower `tracesSampleRate` first —
profiling volume falls proportionally since it samples from the traced set.
Consider a lower `__DEV__`/preview sample rate if internal dogfood builds
start crowding out production trace volume.

## 5. OTA (EAS Update) source maps

Native builds upload source maps automatically via the
`@sentry/react-native/expo` config plugin in `app.config.ts` (reads
`SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` from EAS secrets at
build time). **This does not cover OTA pushes.** Any JS shipped via
`eas update` needs its own source-map upload or stack traces from that OTA
bundle won't symbolicate — they'll show minified frames pointing at the
wrong release.

After every `eas update`:

```bash
cd apps/mobile
eas update --branch <branch> --message "<message>"
npx sentry-expo-upload-sourcemaps dist
```

Run the upload against the same `dist/` output the update was built from, and
make sure `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` are present in
the shell environment (same EAS secrets used by the build plugin — pull them
locally or run this step in CI where they're already set).

## 6. Consent caveat

Telemetry is opt-in-gated per `src/lib/analytics/policy.ts` (Apple Guideline
5.1.4 minors handling):

| Age bracket | Tracking level                          | Sentry behavior                         |
| ----------- | --------------------------------------- | --------------------------------------- |
| `under_13`  | `none`                                  | No Sentry at all — `setEnabled(false)`  |
| `13_17`     | `page_view_only`                        | Screen views only, no behavioral events |
| `18_plus`   | `full`                                  | Full tracking, incl. traces/profiles    |
| unknown     | `page_view_only` (conservative default) | Screen views only                       |

`captureException` / `captureMessage` are no-ops until `telemetryEnabled` is
true (`src/lib/analytics/sentry.ts`). **Crash-free session and performance
metrics only reflect opted-in users** — they are not a full picture of app
health across the whole install base. Do not treat a healthy dashboard as
proof there's no issue affecting minors or opted-out users; cross-check
support reports and app store reviews for those cohorts.
