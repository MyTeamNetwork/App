import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  getActiveAdminMembership,
  type ActiveAdminReason,
} from "@/lib/auth/require-active-admin";
import { checkOrgReadOnly } from "@/lib/subscription/read-only-guard";
import type { ServerSupabase } from "@/lib/supabase/types";
import { normalizeRole, type OrgRole } from "@teammeet/core";
import type { UserRole } from "@/types/database";

/**
 * One typed org-context resolution path.
 *
 * Composes the two PROVEN preamble helpers — `getActiveAdminMembership`
 * (membership + role + status) and `checkOrgReadOnly` (grace-period freeze) —
 * into a single discriminated result, so a migrated route replaces its
 * hand-rolled "getUser → membership query → readOnly guard" trio with one call.
 *
 * Design constraints (see U10 in the audit-findings plan):
 * - No NEW auth queries. This is pure composition of existing, tested helpers.
 * - Authz outcomes are TYPED DENIALS, never thrown. Only an unexpected DB error
 *   in the membership lookup surfaces as `not_found`-adjacent handling; the
 *   caught-error path is modeled explicitly as the `error` denial reason.
 * - The Supabase client is INJECTED so this is Server-Component-callable and
 *   unit-testable. NOTE: `checkOrgReadOnly` builds its OWN server-scoped client
 *   internally (it uses the `get_subscription_status` SECURITY DEFINER RPC so
 *   non-admins can read status). That is intentional and NOT refactored here —
 *   the injected client governs only the membership lookup.
 * - Read-only is resolved ALWAYS by default (mutations need it, and the guard
 *   fails closed) but a `{ skipReadOnly: true }` option lets pure reads skip the
 *   RPC round-trip.
 */

/** A resolved, authorized org context. `isReadOnly` gates mutations. */
export interface OrgContext {
  orgId: string;
  userId: string;
  /** Normalized role of the caller in this org. */
  role: OrgRole;
  /** Membership status — always `"active"` for a resolved context. */
  status: "active";
  /**
   * Whether the org is frozen (grace period / read-only). `true` when
   * `skipReadOnly` was set is impossible — skipping yields `false` and the
   * caller must not treat a skipped read as a mutation gate. Fails closed to
   * `true` if the subscription-status check errors.
   */
  isReadOnly: boolean;
}

/**
 * Typed denial reasons. These map onto HTTP responses at the route boundary
 * (see `./errors`), never onto thrown exceptions.
 *
 * - `not_member`  — caller holds no membership row in this org.
 * - `not_admin`   — caller is a member but not an admin (admin variant only).
 * - `inactive`    — membership exists but status is not `active` (revoked/pending).
 * - `not_found`   — the org id did not resolve to a membership context; used as
 *   the neutral "nothing to see here" denial (indistinguishable from
 *   not_member at the HTTP layer by design — see errors.ts).
 * - `error`       — the membership lookup itself failed (DB/network). Fail closed.
 */
export type OrgDenialReason =
  | "not_member"
  | "not_admin"
  | "inactive"
  | "not_found"
  | "error";

export type OrgContextResult =
  | { ok: true; ctx: OrgContext }
  | { ok: false; denial: OrgDenialReason };

/** Which membership bar the caller must clear. */
export type OrgAccessLevel = "admin" | "member";

export interface ResolveOrgContextOptions {
  /**
   * Skip the read-only (grace-period) RPC for pure reads. When set, the
   * returned `isReadOnly` is `false` and MUST NOT be used to authorize a
   * mutation — callers doing writes must leave this unset (the default).
   */
  skipReadOnly?: boolean;
}

/**
 * Result of the membership lookup, decoupled from `getActiveAdminMembership`'s
 * admin-only shape so the resolver can also answer the member variant. `role`
 * is present only on the success path.
 */
export type MembershipLookup =
  | { ok: true; role: OrgRole }
  | { ok: false; reason: MembershipDenial };

type MembershipDenial = "not_member" | "not_admin" | "inactive" | "error";

/**
 * Injected dependencies. Defaulted to the real helpers; overridden in tests
 * (DI seam, mirroring `consumeMobileHandoff`). `lookupMembership` returns the
 * caller's role for a given access level; `checkReadOnly` mirrors
 * `checkOrgReadOnly`'s `{ isReadOnly }` contract.
 */
export interface ResolveOrgContextDeps {
  lookupMembership: (
    client: SupabaseClient<Database>,
    userId: string,
    orgId: string,
    level: OrgAccessLevel
  ) => Promise<MembershipLookup>;
  // Receives the request-scoped client so bearer-authenticated (mobile)
  // requests check subscription status as themselves. Without it the default
  // helper builds an anonymous cookie client, the authenticated-only RPC
  // errors, and the fail-closed path freezes every active org (see #335).
  checkReadOnly: (
    orgId: string,
    client: SupabaseClient<Database>
  ) => Promise<{ isReadOnly: boolean }>;
}

/** Map the admin-helper's denial reasons onto our membership denial taxonomy. */
function adminReasonToDenial(reason: ActiveAdminReason): MembershipDenial {
  switch (reason) {
    case "missing":
      return "not_member";
    case "not_admin":
      return "not_admin";
    case "inactive":
      return "inactive";
    case "error":
      return "error";
  }
}

/**
 * Default membership lookup. Reuses `getActiveAdminMembership` for the admin
 * variant directly. For the member variant it runs the SAME single-row query
 * shape (own row is readable under RLS) and accepts ANY role as long as status
 * is active — no new query surface, just a role-agnostic acceptance rule.
 */
async function defaultLookupMembership(
  client: SupabaseClient<Database>,
  userId: string,
  orgId: string,
  level: OrgAccessLevel
): Promise<MembershipLookup> {
  if (level === "admin") {
    const result = await getActiveAdminMembership(client, userId, orgId);
    if (result.ok) return { ok: true, role: "admin" };
    return { ok: false, reason: adminReasonToDenial(result.reason) };
  }

  // Member variant: any active role. Mirrors getActiveAdminMembership's query
  // (a user may read their own (user_id, organization_id) row under RLS) but
  // gates on status only, returning the normalized role.
  const { data, error } = await client
    .from("user_organization_roles")
    .select("role, status")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) return { ok: false, reason: "error" };
  if (!data) return { ok: false, reason: "not_member" };
  if (data.status !== "active") return { ok: false, reason: "inactive" };

  const role = normalizeRole(data.role as UserRole | null);
  if (!role) return { ok: false, reason: "not_member" };

  return { ok: true, role };
}

const defaultDeps: ResolveOrgContextDeps = {
  lookupMembership: defaultLookupMembership,
  // Forward the request-scoped client to the real helper (its `client` arg is
  // typed `ServerSupabase`; resolver callers pass a `ServerSupabase` too, so
  // the runtime value is correct — the cast only bridges the branded type).
  checkReadOnly: (orgId, client) =>
    checkOrgReadOnly(orgId, client as unknown as ServerSupabase),
};

/** Membership denial → context denial. Both share names except `error`, which
 * we surface verbatim so the route layer can 500 rather than 403 on a real
 * lookup failure. */
function membershipDenialToContext(reason: MembershipDenial): OrgDenialReason {
  return reason;
}

/**
 * Resolve a typed org context for `userId` against `orgId` at the requested
 * access `level`. Composition only — see the module doc for constraints.
 *
 * On the happy path, resolves read-only status (unless `skipReadOnly`) and
 * returns the full `OrgContext`. Any authz shortfall returns a typed denial.
 * The read-only guard fails closed: if `checkReadOnly` reports/throws a
 * problem, `isReadOnly` resolves to `true`.
 */
export async function resolveOrgContext(
  client: SupabaseClient<Database>,
  userId: string,
  orgId: string,
  level: OrgAccessLevel,
  options: ResolveOrgContextOptions = {},
  deps: ResolveOrgContextDeps = defaultDeps
): Promise<OrgContextResult> {
  const membership = await deps.lookupMembership(client, userId, orgId, level);
  if (!membership.ok) {
    return { ok: false, denial: membershipDenialToContext(membership.reason) };
  }

  const isReadOnly = options.skipReadOnly
    ? false
    : await resolveReadOnly(deps, orgId, client);

  return {
    ok: true,
    ctx: {
      orgId,
      userId,
      role: membership.role,
      status: "active",
      isReadOnly,
    },
  };
}

/**
 * Fail-closed read-only resolution. `checkOrgReadOnly` already returns
 * `isReadOnly: true` on its own RPC errors, but we ALSO wrap the call so an
 * unexpected throw (e.g. the client factory failing) freezes writes rather than
 * silently allowing them. security > correctness: never open the gate on error.
 */
async function resolveReadOnly(
  deps: ResolveOrgContextDeps,
  orgId: string,
  client: SupabaseClient<Database>
): Promise<boolean> {
  try {
    const { isReadOnly } = await deps.checkReadOnly(orgId, client);
    return isReadOnly;
  } catch (err) {
    console.error(
      "[resolveOrgContext] read-only check threw, failing closed:",
      err instanceof Error ? err.message : String(err)
    );
    return true;
  }
}

/**
 * Admin-required convenience wrapper. Equivalent to
 * `resolveOrgContext(client, userId, orgId, "admin", options)`.
 */
export function resolveAdminContext(
  client: SupabaseClient<Database>,
  userId: string,
  orgId: string,
  options?: ResolveOrgContextOptions,
  deps?: ResolveOrgContextDeps
): Promise<OrgContextResult> {
  return resolveOrgContext(client, userId, orgId, "admin", options, deps ?? defaultDeps);
}

/**
 * Member-required convenience wrapper (any active role). Equivalent to
 * `resolveOrgContext(client, userId, orgId, "member", options)`.
 */
export function resolveMemberContext(
  client: SupabaseClient<Database>,
  userId: string,
  orgId: string,
  options?: ResolveOrgContextOptions,
  deps?: ResolveOrgContextDeps
): Promise<OrgContextResult> {
  return resolveOrgContext(client, userId, orgId, "member", options, deps ?? defaultDeps);
}
