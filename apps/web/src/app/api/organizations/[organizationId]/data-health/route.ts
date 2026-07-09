import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  parseOrgId,
  resolveAdminContext,
  denialResponse,
  unauthorizedResponse,
} from "@/lib/organizations";
import { internalError } from "@/lib/api/response";
import { getOrgDataHealth } from "@/lib/health/org-data-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

/**
 * Admin-only consolidated data-health report for an org: RAG index
 * coverage/audience tagging and enrichment tagging health. (The people-graph is
 * served from Postgres, so there is no separate store to drift-check.)
 *
 * Migrated onto the org-context resolver (U11): the bespoke `getOrgMemberRole`
 * admin gate converges on `resolveAdminContext`, so a non-member now receives
 * the neutral 404 (anti-enumeration) rather than a 403.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;

  const parsed = parseOrgId(organizationId);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "org data health",
    limitPerIp: 30,
    limitPerUser: 20,
  });
  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return withHeaders(unauthorizedResponse(), rateLimit.headers);
  }

  // Read-only report — skip the grace-period RPC round-trip.
  const ctx = await resolveAdminContext(supabase, user.id, organizationId, { skipReadOnly: true });
  if (!ctx.ok) {
    return withHeaders(denialResponse(ctx.denial), rateLimit.headers);
  }

  try {
    const serviceSupabase = createServiceClient();
    const report = await getOrgDataHealth(serviceSupabase, organizationId);
    return respond(report);
  } catch (error) {
    return withHeaders(
      internalError("Failed to build data-health report.", error, {
        orgId: organizationId,
        userId: user.id,
      }),
      rateLimit.headers
    );
  }
}

/** Attach rate-limit headers onto a resolver/helper-produced NextResponse. */
function withHeaders(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}
