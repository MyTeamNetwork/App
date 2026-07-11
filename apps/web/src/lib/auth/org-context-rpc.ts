import type { MembershipStatus, Organization, UserRole } from "@/types/database";
import { normalizeRole, roleFlags, type OrgRole } from "@teammeet/core";
import {
  getGracePeriodInfo,
  type GracePeriodInfo,
  type SubscriptionStatus,
} from "@/lib/subscription/grace-period";

type RpcMembership = {
  role?: unknown;
  status?: unknown;
};

type RpcSubscription = {
  status?: unknown;
  grace_period_ends_at?: unknown;
  current_period_end?: unknown;
  alumni_bucket?: unknown;
  parents_bucket?: unknown;
};

export type OrgContextResult = {
  organization: Organization | null;
  status: MembershipStatus | null;
  userId: string | null;
  role: OrgRole | null;
  isAdmin: boolean;
  isActiveMember: boolean;
  isAlumni: boolean;
  isParent: boolean;
  subscription: SubscriptionStatus | null;
  gracePeriod: GracePeriodInfo;
  hasAlumniAccess: boolean;
  hasParentsAccess: boolean;
};

type LoadOrgContextParams = {
  orgSlug: string;
  getUserId: () => Promise<string | null>;
  rpc: (
    functionName: "get_render_org_context_by_slug",
    args: { p_slug: string }
  ) => Promise<{ data: unknown; error: unknown }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function membershipStatus(value: unknown): MembershipStatus | null {
  return value === "active" || value === "pending" || value === "revoked" ? value : null;
}

/** Normalize a raw membership row into the role/status pair used by auth helpers. */
export function normalizeMembershipRow(data: RpcMembership | null): {
  role: OrgRole | null;
  status: MembershipStatus | null;
} {
  return {
    role: normalizeRole((data?.role as UserRole | null) ?? null),
    status: membershipStatus(data?.status),
  };
}

function emptyOrgContext(userId: string | null): OrgContextResult {
  return {
    organization: null,
    status: null,
    userId,
    subscription: null,
    gracePeriod: getGracePeriodInfo(null),
    hasAlumniAccess: false,
    hasParentsAccess: false,
    ...roleFlags(null),
  };
}

/**
 * Convert the JSON payload returned by get_render_org_context_by_slug into the
 * application context consumed by layouts and pages.
 */
export function resolveOrgContextPayload(
  payload: unknown,
  userId: string | null
): OrgContextResult {
  if (!isRecord(payload) || typeof payload.found !== "boolean") {
    throw new Error("get_render_org_context_by_slug returned an invalid payload");
  }

  if (!payload.found) {
    return emptyOrgContext(userId);
  }

  if (
    !isRecord(payload.organization) ||
    typeof payload.organization.id !== "string" ||
    typeof payload.organization.name !== "string" ||
    typeof payload.organization.slug !== "string"
  ) {
    throw new Error("get_render_org_context_by_slug returned an invalid organization payload");
  }

  const membership: RpcMembership | null =
    userId && isRecord(payload.membership) ? payload.membership : null;
  const subscriptionRow: RpcSubscription | null =
    userId && isRecord(payload.subscription) ? payload.subscription : null;

  const { role, status } = normalizeMembershipRow(membership);
  const subscriptionStatus = nullableString(subscriptionRow?.status);
  const alumniBucket = nullableString(subscriptionRow?.alumni_bucket);
  const parentsBucket = nullableString(subscriptionRow?.parents_bucket);
  const subscription: SubscriptionStatus | null = subscriptionRow
    ? {
        status: subscriptionStatus,
        gracePeriodEndsAt: nullableString(subscriptionRow.grace_period_ends_at),
        currentPeriodEnd: nullableString(subscriptionRow.current_period_end),
      }
    : null;
  const hasAlumniAccess =
    subscriptionStatus === "enterprise_managed" ||
    (alumniBucket !== null && alumniBucket !== "none");
  const hasParentsAccess =
    subscriptionStatus === "enterprise_managed" ||
    (parentsBucket !== null && parentsBucket !== "none");

  return {
    organization: payload.organization as unknown as Organization,
    status,
    userId,
    subscription,
    gracePeriod: getGracePeriodInfo(subscription),
    hasAlumniAccess,
    hasParentsAccess,
    ...(status === "active" ? roleFlags(role) : roleFlags(null)),
  };
}

/**
 * Load user identity and the consolidated org RPC concurrently. The RPC owns
 * organization, membership, and subscription lookup so request rendering does
 * not pay separate round trips for each record.
 */
export async function loadOrgContextFromRpc({
  orgSlug,
  getUserId,
  rpc,
}: LoadOrgContextParams): Promise<OrgContextResult> {
  const [userId, rpcResult] = await Promise.all([
    getUserId(),
    rpc("get_render_org_context_by_slug", { p_slug: orgSlug }),
  ]);
  if (rpcResult.error) throw rpcResult.error;
  return resolveOrgContextPayload(rpcResult.data, userId);
}
