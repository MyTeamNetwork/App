import { NextResponse } from "next/server";
import { readOnlyResponse } from "@/lib/subscription/read-only-guard";
import type { OrgContext, OrgDenialReason } from "./context";

/**
 * Map typed org-context denials onto the HTTP responses the existing org routes
 * already emit, preserving their exact bodies so migrating a route to the
 * resolver is contract-preserving:
 *
 * - `not_member` / `not_found`  → 404 `{ "error": "Not found" }`
 *     Deliberately indistinguishable: revealing "you're not a member of THIS
 *     org" vs "no such org" leaks org existence to non-members. The census
 *     shows several routes 403 here; 404 is the safer, non-enumerable default
 *     for the resolver's neutral denial. `not_admin`/`inactive` keep their 403.
 * - `not_admin` / `inactive`    → 403 `{ "error": "Forbidden" }`
 * - `error`                     → 500 `{ "error": "Unable to verify permissions" }`
 *     Fail closed: a membership-lookup DB error must not read as a clean 403.
 *
 * Note on 401: the resolver operates on an ALREADY-authenticated `userId`.
 * The caller resolves the user first and returns its own 401
 * `{ "error": "Unauthorized" }` before ever calling the resolver, matching the
 * current route order (getUser → 401, then membership → 403). `unauthorizedResponse`
 * is provided for that step so the whole preamble uses one vocabulary.
 */

/** 401 for the pre-resolver "no authenticated user" step. */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Map a typed denial to its route response (matches existing org route bodies). */
export function denialResponse(denial: OrgDenialReason): NextResponse {
  switch (denial) {
    case "not_member":
    case "not_found":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "not_admin":
    case "inactive":
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    case "error":
      return NextResponse.json(
        { error: "Unable to verify permissions" },
        { status: 500 }
      );
  }
}

/**
 * 403 read-only response. Body matches `readOnlyResponse()` exactly
 * (`{ error, code: "ORG_READ_ONLY" }`) so read-only-aware clients keep working.
 */
export function readOnlyDenialResponse(): NextResponse {
  return NextResponse.json(readOnlyResponse(), { status: 403 });
}

/**
 * Guard a mutation against a resolved context's read-only state. Returns the
 * read-only 403 when frozen, otherwise `null` so the caller proceeds. Keeps the
 * "if (ctx.isReadOnly) return readOnly403" branch in one place.
 */
export function readOnlyGuard(ctx: OrgContext): NextResponse | null {
  return ctx.isReadOnly ? readOnlyDenialResponse() : null;
}
