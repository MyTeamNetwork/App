import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { MembershipStatus } from "@/types/database";
import { normalizeRole, roleFlags, type OrgRole } from "@teammeet/core";
import { resolveCheck } from "@/lib/supabase/resolve-check";
import { loadOrgContextFromRpc, normalizeMembershipRow } from "@/lib/auth/org-context-rpc";
import type { OrgContextResult } from "@/lib/auth/org-context-rpc";

export type { OrgContextResult } from "@/lib/auth/org-context-rpc";

type OrgRoleResult = {
  role: OrgRole | null;
  status: MembershipStatus | null;
  userId: string | null;
};

/**
 * Cached wrapper for auth.getUser(). React.cache() deduplicates calls
 * within the same server request — layout + page calling this both
 * hit Supabase auth only once.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
});

const syncCurrentUserOrganizationMemberships = cache(async () => {
  const supabase = await createClient();
  const { error } = await (
    supabase as unknown as {
      rpc: (fn: "sync_current_user_organization_memberships") => Promise<{
        error: { message: string } | null;
      }>;
    }
  ).rpc("sync_current_user_organization_memberships");
  if (error) {
    console.error("[auth/roles] Failed to sync current user memberships:", error.message);
  }
});
export async function getOrgRole(params: {
  orgId: string;
  userId?: string;
}): Promise<OrgRoleResult> {
  let uid = params.userId ?? null;
  if (!uid) {
    const user = await getCurrentUser();
    if (!user) return { role: null, status: null, userId: null };
    uid = user.id;
    await syncCurrentUserOrganizationMemberships();
  }

  const supabase = await createClient();
  const data = resolveCheck(
    await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("organization_id", params.orgId)
      .eq("user_id", uid)
      .maybeSingle(),
    "getOrgRole"
  );

  const { role, status } = normalizeMembershipRow(data);
  return { role, status, userId: uid };
}

export async function requireOrgRole(params: {
  orgId: string;
  allowedRoles: OrgRole[];
  redirectTo?: string;
}): Promise<OrgRoleResult> {
  const membership = await getOrgRole({ orgId: params.orgId, userId: undefined });
  const allowed =
    membership.role &&
    membership.status === "active" &&
    params.allowedRoles.includes(membership.role);

  if (!allowed) {
    if (params.redirectTo) {
      redirect(params.redirectTo);
    }
    throw new Error("Forbidden");
  }

  return membership;
}

/**
 * Main org context loader — cached per orgSlug within a single request.
 *
 * React.cache() deduplicates layout + page calls. User validation and the
 * consolidated org-context RPC run concurrently, replacing separate
 * organization, membership, and subscription round trips.
 */
export const getOrgContext = cache(async (orgSlug: string): Promise<OrgContextResult> => {
  const supabase = await createClient();
  return loadOrgContextFromRpc({
    orgSlug,
    getUserId: async () => (await getCurrentUser())?.id ?? null,
    rpc: async (functionName, args) => supabase.rpc(functionName, args),
  });
});

export { normalizeRole, roleFlags };
