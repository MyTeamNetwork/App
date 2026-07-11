import { z } from "zod";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import { isStageTimeoutError } from "@/lib/ai/timeout";
import type { ScheduleImageMimeType } from "@/lib/ai/schedule-extraction";

/**
 * Accept either a single string or an array of strings, normalizing to an
 * array. Tolerates glm-5.2 emitting a bare string where the schema expects a
 * list, without weakening the per-element validation.
 */
export const stringOrStringArray = z
  .union([z.string().trim().min(1), z.array(z.string().trim().min(1))])
  .transform((value) => (Array.isArray(value) ? value : [value]));

export type ToolQueryResult =
  | { kind: "ok"; data: unknown }
  | { kind: "tool_error"; error: string };

export async function safeToolQuery(
  logContext: AiLogContext,
  fn: () => Promise<{ data: unknown; error: unknown }>
): Promise<ToolQueryResult> {
  try {
    const { data, error } = await fn();
    if (error) {
      aiLog("warn", "ai-tools", "query failed", logContext, {
        error: getSafeErrorMessage(error),
      });
      return { kind: "tool_error", error: "Query failed" };
    }
    return { kind: "ok", data: data ?? [] };
  } catch (err) {
    if (isStageTimeoutError(err)) {
      throw err;
    }
    aiLog("warn", "ai-tools", "unexpected error", logContext, {
      error: getSafeErrorMessage(err),
    });
    return { kind: "tool_error", error: "Unexpected error" };
  }
}

export type ToolCountResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

export async function safeToolCount(
  logContext: AiLogContext,
  fn: () => Promise<{ count: number | null; error: unknown }>
): Promise<ToolCountResult> {
  try {
    const { count, error } = await fn();
    if (error || count === null) {
      if (error) {
        aiLog("warn", "ai-tools", "count query failed", logContext, {
          error: getSafeErrorMessage(error),
        });
      } else {
        aiLog("warn", "ai-tools", "count query failed", logContext, {
          error: "count_unavailable",
        });
      }
      return { ok: false, error: "Query failed" };
    }
    return { ok: true, count };
  } catch (err) {
    if (isStageTimeoutError(err)) {
      throw err;
    }
    aiLog("warn", "ai-tools", "unexpected count error", logContext, {
      error: getSafeErrorMessage(err),
    });
    return { ok: false, error: "Unexpected error" };
  }
}


export function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return "unknown_error";
}

const MAX_BODY_PREVIEW_CHARS = 500;

export function truncateBody(body: string | null | undefined): string | null {
  if (typeof body !== "string" || body.trim().length === 0) {
    return null;
  }
  return body.trim().slice(0, MAX_BODY_PREVIEW_CHARS);
}

// ---------------------------------------------------------------------------
// Field projection
// ---------------------------------------------------------------------------
//
// Lets the model request only the output keys it needs so heavy rows (LinkedIn
// summaries, jsonb skill arrays) don't flood the LLM context. Projection only
// ever NARROWS a row — it can drop keys but never add or repopulate one. This
// is the load-bearing security property: callers apply per-role redaction
// (e.g. nulling emails for non-admins) BEFORE projecting, so a requested field
// the row never had — or that redaction already nulled — stays absent/null.

/**
 * Return a new object containing only the `requested` keys that are present on
 * `row`. Pure: never mutates input, never adds a key the row lacks. A non-object
 * `row` is returned unchanged (defensive against `unknown` tool payloads).
 */
export function projectFields<T>(row: T, requested: readonly string[]): T {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return row;
  }
  const requestedKeys = new Set(requested);
  const source = row as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (requestedKeys.has(key)) {
      projected[key] = source[key];
    }
  }
  return projected as T;
}

// Output-key allowlists per tool live in the client-safe `output-fields.ts`
// (pure data, no server imports) so the tool SCHEMAS in `definitions.ts` can
// use them without pulling this module's `aiLog` → `errors/sanitize` →
// `node:async_hooks` chain into the client bundle. Re-exported here so existing
// server consumers of `shared.ts` keep their import path.
export {
  MEMBER_OUTPUT_FIELDS,
  MEMBER_LEAN_DEFAULT_FIELDS,
  EVENT_OUTPUT_FIELDS,
  MEMBER_PREFERENCE_OUTPUT_FIELDS,
  type MemberOutputField,
  type EventOutputField,
  type MemberPreferenceOutputField,
} from "./output-fields";

export interface MemberToolRow {
  id: string;
  user_id: string | null;
  status: string | null;
  role: string | null;
  created_at: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  // Enriched LinkedIn fields (optional — only selected by list_members).
  current_company?: string | null;
  industry?: string | null;
  headline?: string | null;
  summary?: string | null;
  skills?: unknown;
  certifications?: unknown;
  languages?: unknown;
}

export interface UserNameRow {
  id: string;
  name: string | null;
}

export function buildMemberName(firstName: string, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

export function isPlaceholderMemberName(firstName: string, lastName: string): boolean {
  const normalizedFirstName = firstName.trim();
  const normalizedLastName = lastName.trim();

  return (
    (normalizedFirstName.length === 0 && normalizedLastName.length === 0) ||
    (normalizedFirstName === "Member" && normalizedLastName.length === 0)
  );
}

export function isTrustworthyHumanName(value: string | null | undefined): value is string {
  const normalizedValue = value?.trim() ?? "";
  return normalizedValue.length > 0 && normalizedValue !== "Member" && !normalizedValue.includes("@");
}

const SCHEDULE_IMAGE_MIME_TYPES = new Set<ScheduleImageMimeType>([
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

/** True when the attachment is a schedule image accepted for AI extraction (PNG/JPEG). */
export function isScheduleImageAttachment(attachment?: {
  mimeType: string;
} | null): boolean {
  return Boolean(
    attachment && SCHEDULE_IMAGE_MIME_TYPES.has(attachment.mimeType as ScheduleImageMimeType)
  );
}

const CSV_ATTACHMENT_MIME_TYPES = new Set<string>([
  "text/csv",
  "application/vnd.ms-excel",
]);

/** True when the attachment is a CSV accepted for structured event import. */
export function isCsvAttachment(attachment?: {
  mimeType: string;
} | null): boolean {
  return Boolean(attachment && CSV_ATTACHMENT_MIME_TYPES.has(attachment.mimeType));
}

/**
 * Case-insensitive substring filter used by listing tools (member preferences,
 * available mentors). An absent needle matches everything.
 */
export function matchesFilter(values: string[], needle: string | undefined): boolean {
  if (!needle) return true;
  const lowered = needle.toLowerCase();
  return values.some((value) => value.toLowerCase().includes(lowered));
}
