import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import {
  parseOrgId,
  resolveAdminContext,
  denialResponse,
  readOnlyGuard,
  unauthorizedResponse,
} from "@/lib/organizations";
import { reinstateMember } from "@/lib/organizations/members";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; memberId: string }>;
}

/**
 * Reinstate a graduated alumni back to active member status.
 *
 * Preconditions (enforced in the `reinstateMember` service):
 * - User must be admin of the organization (resolver)
 * - Member must have a user_id (linked user account)
 * - Member must be currently graduated (graduated_at is set) OR role is "alumni"
 *
 * Actions:
 * 1. Clear members.graduated_at and graduation_warning_sent_at
 * 2. Update user_organization_roles role = "active_member", status = "pending"
 * 3. Soft-delete alumni record
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId, memberId } = await params;

  const parsed = parseOrgId(organizationId);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const memberIdParsed = baseSchemas.uuid.safeParse(memberId);
  if (!memberIdParsed.success) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "member reinstate",
    limitPerIp: 20,
    limitPerUser: 10,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return withHeaders(unauthorizedResponse(), rateLimit.headers);
  }

  const ctx = await resolveAdminContext(supabase, user.id, parsed.orgId);
  if (!ctx.ok) {
    return withHeaders(denialResponse(ctx.denial), rateLimit.headers);
  }
  const readOnly = readOnlyGuard(ctx.ctx);
  if (readOnly) {
    return withHeaders(readOnly, rateLimit.headers);
  }

  const serviceSupabase = createServiceClient();

  const result = await reinstateMember(serviceSupabase, {
    organizationId: parsed.orgId,
    memberId,
  });

  if (!result.ok) {
    return respond({ error: result.error }, result.status);
  }

  return respond({
    success: true,
    message: "Member reinstated successfully",
  });
}

/** Attach rate-limit headers onto a resolver-produced NextResponse (whose body
 * already matches the current route contract) without re-serializing it. */
function withHeaders(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}
