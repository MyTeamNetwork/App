/**
 * Sentry error tracking wrapper
 */

import * as Sentry from "@sentry/react-native";
import * as Application from "expo-application";

let initialized = false;
let telemetryEnabled = false;

// Trace sampling. Dev captures everything for debugging; production samples down
// to protect the Sentry performance-event quota (transactions are billed).
const TRACES_SAMPLE_RATE = __DEV__ ? 1.0 : 0.2;
// Profiling is sampled relative to already-sampled traces (0.1 = 10% of traces),
// keeping Hermes profiling overhead and quota use low.
const PROFILES_SAMPLE_RATE = 0.1;

// Screen-load (navigation) instrumentation. Created at module scope so
// registerNavigationContainer() can hand it the root nav ref even for opt-out
// users where Sentry.init() never runs — the integration is inert without a
// client, so registration-before-init is safe.
const reactNavigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
});

// Transient connectivity failures are not actionable bugs. Drop them at
// every entry point: the explicit captureException wrapper, the Sentry
// SDK's auto-instrumentation, and the beforeSend safety net.
function isTransientNetworkError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name ?? "";
  if (name === "NetworkUnreachableError" || name === "AbortError") return true;
  const message =
    typeof error === "string"
      ? error
      : ((error as { message?: string }).message ?? "");
  return /network request failed|failed to fetch|the network connection was lost|the internet connection appears to be offline/i.test(
    message,
  );
}

const PII_KEYS = new Set([
  "email",
  "userEmail",
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "apiKey",
  "secret",
  "phone",
  "phoneNumber",
  "ssn",
  "creditCard",
  "cardNumber",
  "query",
  "firstName",
  "lastName",
  "name",
]);

function scrubPii(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (PII_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

// Strip PII from the fields error and transaction events share (user identifiers,
// extra, tags, breadcrumb data). Mutates in place to match the beforeSend hook
// contract, then returns the same event for chaining.
function scrubEventPii<T extends Sentry.Event>(event: T): T {
  if (event.user) {
    delete event.user.email;
    delete event.user.username;
    delete event.user.ip_address;
  }
  if (event.extra) event.extra = scrubPii(event.extra);
  if (event.tags) event.tags = scrubPii(event.tags) as typeof event.tags;
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((bc) =>
      bc.data ? { ...bc, data: scrubPii(bc.data) } : bc,
    );
  }
  return event;
}

export function init(dsn: string): void {
  if (initialized) return;
  // Tag events with the app version + build so errors are attributable to a
  // release and Release Health (crash-free sessions/users) works. Native build
  // number doubles as the Sentry `dist`, matching the source maps uploaded by
  // the @sentry/react-native/expo build plugin. Values are read synchronously
  // from the native app metadata (null in Expo Go / bare JS contexts).
  const version = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;
  Sentry.init({
    dsn,
    release:
      version && Application.applicationId
        ? `${Application.applicationId}@${version}+${build ?? "0"}`
        : undefined,
    dist: build ?? undefined,
    enableAutoSessionTracking: true,
    attachStacktrace: true,
    environment: __DEV__ ? "development" : "production",
    sendDefaultPii: false,
    // Performance monitoring: screen-load tracing + Hermes profiling + app-hang
    // detection. The navigation integration emits time-to-initial-display spans.
    integrations: [reactNavigationIntegration],
    tracesSampleRate: TRACES_SAMPLE_RATE,
    profilesSampleRate: PROFILES_SAMPLE_RATE,
    enableAppHangTracking: true,
    ignoreErrors: [
      "NetworkUnreachableError",
      /Network request failed/i,
      /Failed to fetch/i,
      /The network connection was lost/i,
      /The Internet connection appears to be offline/i,
    ],
    beforeSend(event, hint) {
      if (isTransientNetworkError(hint?.originalException)) return null;
      return scrubEventPii(event);
    },
    // Performance transactions carry the same user/extra/tags/breadcrumb fields,
    // so apply the identical PII scrub before they leave the device.
    beforeSendTransaction(event) {
      return scrubEventPii(event);
    },
  });
  initialized = true;
}

export function setEnabled(value: boolean): void {
  telemetryEnabled = value;
  if (!value) {
    Sentry.setUser(null);
  }
}

export function setUser(user: { id: string } | null): void {
  if (!initialized) return;
  if (!telemetryEnabled && user !== null) return;
  Sentry.setUser(user);
}

export function captureException(
  error: Error,
  context?: Record<string, unknown>
): void {
  if (!initialized || !telemetryEnabled) return;
  if (isTransientNetworkError(error)) return;
  Sentry.captureException(error, { extra: context });
}

export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = "info"
): void {
  if (!initialized || !telemetryEnabled) return;
  Sentry.captureMessage(message, level);
}

export function isInitialized(): boolean {
  return initialized;
}

// Hand the root navigation container ref to the screen-load instrumentation.
// Safe to call before Sentry.init() (opt-out users, or the effect firing before
// lazy init): the integration lives at module scope and no-ops without a client.
export function registerNavigationContainer(ref: unknown): void {
  reactNavigationIntegration.registerNavigationContainer(ref);
}

// Passthrough for Sentry.wrap so callers (the root layout) keep all direct
// @sentry/react-native imports inside this module. Adds a touch-event boundary
// and profiler that no-op until a client exists, so it is safe pre-init.
export const wrap = Sentry.wrap;
