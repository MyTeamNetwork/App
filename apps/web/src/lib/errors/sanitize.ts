import { AsyncLocalStorage } from "node:async_hooks";
import { captureServerError, type CaptureErrorParams } from "./server";
import type { ErrorSeverity } from "@/lib/schemas/errors";

/**
 * Sanitization boundary for server-side error capture.
 *
 * Everything that flows from a chokepoint (API response helpers, aiLog) into
 * `captureServerError` passes through here first, so that:
 * - messages are bounded (~500 chars, newline-heavy payloads collapsed) —
 *   `notify.ts` emails the sample-event message verbatim and has no redaction
 *   layer, and AI errors can embed prompt/RAG content;
 * - `meta` only ever contains a known-safe allowlist of scalar identifiers,
 *   never a raw caught error or an arbitrary `extra` blob;
 * - the full stack still reaches the `error_events` row (bounded by the
 *   existing slice in `captureServerError`).
 *
 * Recursion guard: capture dispatched from inside the capture pipeline is
 * suppressed (console only). Two mechanisms:
 * - a module-level flag suppresses synchronous re-entrancy;
 * - `runWithoutCapture` opens an AsyncLocalStorage scope (used by the
 *   error-ingest route) in which all capture is suppressed, including across
 *   awaits, without affecting concurrent requests.
 * Nothing inside `lib/errors/*` may call `captureSanitized` — console only.
 */

const MAX_MESSAGE_LENGTH = 500;
const MAX_META_STRING_LENGTH = 200;

/**
 * Keys permitted in `error_events.meta` / `error_groups.sample_event.meta`
 * for server-side captures routed through this boundary. Extend only with
 * clearly-safe scalar identifiers — never free-form payload fields.
 */
const META_ALLOWLIST = [
  "requestId",
  "orgId",
  "threadId",
  "userId",
  "module",
  "errorName",
] as const;

type MetaKey = (typeof META_ALLOWLIST)[number];

export interface SanitizeOptions {
  /** Prefixed onto the error message (e.g. the aiLog message), then bounded. */
  messagePrefix?: string;
  /** Name used when the caught value is not an Error instance. */
  fallbackName?: string;
  route?: string;
  apiPath?: string;
  severity?: ErrorSeverity;
  /** Filtered through META_ALLOWLIST; non-scalar values are dropped. */
  context?: Record<string, unknown>;
}

/** Collapse newlines/whitespace runs and cap length — payloads embedded in
 * error messages (JSON bodies, prompts, RAG chunks) become one bounded line. */
export function boundMessage(raw: string): string {
  const collapsed = raw.replace(/\s*[\r\n]+\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim();
  if (collapsed.length <= MAX_MESSAGE_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}

function isMessageBearing(value: unknown): value is { message: string; name?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  );
}

function isSafeScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  );
}

function buildMeta(
  context: Record<string, unknown> | undefined,
  errorName: string
): Record<string, unknown> {
  const meta: Record<string, unknown> = {};

  if (context) {
    for (const key of META_ALLOWLIST) {
      const value = context[key as MetaKey];
      if (!isSafeScalar(value)) {
        continue;
      }
      meta[key] =
        typeof value === "string" && value.length > MAX_META_STRING_LENGTH
          ? value.slice(0, MAX_META_STRING_LENGTH)
          : value;
    }
  }

  meta.errorName = errorName;
  return meta;
}

/**
 * Turn an unknown caught value + optional context into bounded capture params.
 * Pure — safe to call anywhere; performs no I/O.
 */
export function sanitizeError(error: unknown, options: SanitizeOptions = {}): CaptureErrorParams {
  const { messagePrefix, fallbackName = "UnknownError", route, apiPath, severity, context } = options;

  let name: string;
  let rawMessage: string;
  let stack: string | undefined;

  if (error instanceof Error) {
    name = error.name || "Error";
    rawMessage = error.message;
    stack = error.stack;
  } else if (isMessageBearing(error)) {
    // e.g. Supabase PostgrestError — message-bearing but not an Error instance
    name = typeof error.name === "string" && error.name.length > 0 ? error.name : fallbackName;
    rawMessage = error.message;
  } else {
    name = fallbackName;
    rawMessage = typeof error === "string" ? error : String(error);
  }

  const combined = messagePrefix ? `${messagePrefix}: ${rawMessage}` : rawMessage;
  const userId =
    context && typeof context.userId === "string"
      ? context.userId.slice(0, MAX_META_STRING_LENGTH)
      : undefined;

  return {
    name,
    message: boundMessage(combined),
    // Full stack passes through; captureServerError bounds it for storage.
    stack,
    route,
    apiPath,
    severity,
    userId,
    meta: buildMeta(context, name),
  };
}

// ── Recursion guards ─────────────────────────────────────────────────────────

const noCaptureScope = new AsyncLocalStorage<boolean>();
let dispatching = false;

/**
 * Run `fn` in a scope where all `captureSanitized` calls are suppressed
 * (console only), including across awaits. Used by the error-ingest route so
 * the capture pipeline can never feed its own failures back into itself.
 */
export function runWithoutCapture<T>(fn: () => T): T {
  return noCaptureScope.run(true, fn);
}

type CaptureTransport = (params: CaptureErrorParams) => Promise<unknown>;

let transport: CaptureTransport = captureServerError;

/**
 * Test seam: replace the capture transport (module mocking is not enabled in
 * the node:test runner). Pass `null` to restore `captureServerError`.
 */
export function setCaptureTransportForTesting(fn: CaptureTransport | null): void {
  transport = fn ?? captureServerError;
}

/**
 * Fire-and-forget capture through the sanitization boundary.
 *
 * Never throws and never recurses: failures inside the capture path are
 * logged to the console only, and re-entrant or in-scope-suppressed calls are
 * dropped. Callers (response helpers, aiLog) can invoke this unconditionally
 * without affecting their own control flow.
 */
export function captureSanitized(error: unknown, options: SanitizeOptions = {}): void {
  if (noCaptureScope.getStore() === true) {
    console.error("[error-capture] suppressed (no-capture scope):", describeForConsole(error));
    return;
  }

  if (dispatching) {
    console.error("[error-capture] re-entrant capture suppressed:", describeForConsole(error));
    return;
  }

  dispatching = true;
  try {
    const params = sanitizeError(error, options);
    Promise.resolve(transport(params)).catch((captureErr) => {
      // Swallow: capture must never alter the caller's behavior.
      console.error("[error-capture] capture failed:", captureErr);
    });
  } catch (captureErr) {
    console.error("[error-capture] capture dispatch failed:", captureErr);
  } finally {
    dispatching = false;
  }
}

function describeForConsole(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${boundMessage(error.message)}`;
  }
  return boundMessage(typeof error === "string" ? error : String(error));
}
