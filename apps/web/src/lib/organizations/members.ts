import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  executeMemberRoleChange,
  type MemberRoleChangeClient,
  type MemberRole,
  type MemberStatus,
} from "@/lib/members/role-change";
import { reinstateToActiveMember } from "@/lib/graduation/queries";

/**
 * Service layer for the members mutation routes (U12).
 *
 * Routes resolve auth/rate-limit/read-only themselves (via `lib/organizations`
 * context + `lib/api/response`), then hand an ALREADY-AUTHORIZED service-role
 * client and validated params to these functions. Mirrors `settings.ts`:
 * injected client, typed params, discriminated results, response shaping owned
 * here so the route stays thin.
 *
 * These functions never re-check membership — authorization was enforced
 * upstream by the resolver. The role-change path DOES re-verify the actor is an
 * admin inside `executeMemberRoleChange` (its own last-admin/quota guards depend
 * on it); that duplicate check is preserved exactly, not removed.
 */

/** Params for a member role/status PATCH, mirroring the route's parsed body. */
export interface PatchMemberParams {
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
  role?: MemberRole;
  status?: MemberStatus;
}

/**
 * Discriminated result. On success the caller revalidates the returned `slug`'s
 * paths (a Next.js route concern kept out of the service). On failure the caller
 * maps `{ status, error }` straight onto its response — the status codes here are
 * byte-identical to the pre-extraction route.
 */
export type PatchMemberResult =
  | { ok: true; slug: string | null }
  | { ok: false; status: number; error: string };

/**
 * Apply a member role/status change through the shared `executeMemberRoleChange`
 * engine, then look up the org slug for cache revalidation.
 *
 * The status-code mapping is copied verbatim from the route that owned it:
 * - invalid → 404 for `target_not_found`, else 400 (e.g. `no_change`)
 * - error → 403 actor_not_admin, 404 target_not_found, 409 stale_member_role,
 *   400 for the last-admin / upgrade-required guard family, 500 otherwise
 * - executed → success, with slug for revalidation
 */
export async function patchMember(
  serviceClient: SupabaseClient<Database>,
  params: PatchMemberParams
): Promise<PatchMemberResult> {
  const result = await executeMemberRoleChange(
    serviceClient as unknown as MemberRoleChangeClient,
    {
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      targetUserId: params.targetUserId,
      role: params.role,
      status: params.status,
      source: "manual",
    }
  );

  if (result.state === "invalid") {
    return {
      ok: false,
      status: result.reason === "target_not_found" ? 404 : 400,
      error: result.reason,
    };
  }

  if (result.state === "error") {
    if (result.reason === "actor_not_admin") {
      return { ok: false, status: 403, error: "Forbidden" };
    }
    if (result.reason === "target_not_found") {
      return { ok: false, status: 404, error: "target_not_found" };
    }
    if (result.reason === "stale_member_role") {
      return { ok: false, status: 409, error: result.message };
    }
    if (
      result.reason === "last_admin_self_demotion" ||
      result.reason === "last_admin_target_demotion" ||
      result.reason === "alumni_upgrade_required" ||
      result.reason === "parent_upgrade_required"
    ) {
      return { ok: false, status: 400, error: result.message };
    }
    console.error("[members PATCH] Role change error:", result);
    return { ok: false, status: 500, error: "Failed to update member" };
  }

  // maybeSingle, not single: the role change above already committed. If the
  // org row is gone (deleted mid-request), a missing slug must not throw and
  // undo a successful mutation — the `?? null` fallback handles the empty case.
  const { data: orgSlugRow } = await serviceClient
    .from("organizations")
    .select("slug")
    .eq("id", params.organizationId)
    .maybeSingle();

  return { ok: true, slug: (orgSlugRow as { slug: string | null } | null)?.slug ?? null };
}

/** Params for reinstating a graduated/alumni member to active. */
export interface ReinstateMemberParams {
  organizationId: string;
  memberId: string;
}

/**
 * Discriminated result for reinstate. `{ status, error }` maps straight onto the
 * response; the status codes match the pre-extraction route (404 member not
 * found, 400 precondition failures, 500 RPC failure).
 */
export type ReinstateMemberResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Reinstate a graduated alumni back to active member status. Preconditions and
 * status codes copied verbatim from the route:
 * - member row must exist (soft-delete-filtered) → else 404
 * - member must have a linked user account → else 400
 * - member must be alumni OR have `graduated_at` set → else 400
 * Reinstatement runs with status "pending" (manual admin action), matching the
 * route. Returns 500 on RPC failure.
 */
export async function reinstateMember(
  serviceClient: SupabaseClient<Database>,
  params: ReinstateMemberParams
): Promise<ReinstateMemberResult> {
  const { organizationId, memberId } = params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: member, error: memberError } = await (serviceClient.from("members") as any)
    .select("id, user_id, graduated_at")
    .eq("id", memberId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .single();

  if (memberError || !member) {
    return { ok: false, status: 404, error: "Member not found" };
  }

  if (!member.user_id) {
    return { ok: false, status: 400, error: "Member does not have a linked user account" };
  }

  const { data: currentRole } = await serviceClient
    .from("user_organization_roles")
    .select("role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", member.user_id)
    .maybeSingle();

  const isAlumni = (currentRole as { role?: string } | null)?.role === "alumni";
  const hasGraduated = !!member.graduated_at;

  if (!isAlumni && !hasGraduated) {
    return { ok: false, status: 400, error: "Member is not graduated or alumni" };
  }

  const result = await reinstateToActiveMember(
    serviceClient,
    memberId,
    member.user_id,
    organizationId,
    "pending"
  );

  if (!result.success) {
    return { ok: false, status: 500, error: result.error || "Failed to reinstate member" };
  }

  return { ok: true };
}
