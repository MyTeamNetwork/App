import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  parseOrgId,
  resolveAdminContext,
  denialResponse,
  unauthorizedResponse,
} from "@/lib/organizations";
import { resumeSubscription } from "@/lib/organizations/subscriptions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

/**
 * Resume a subscription that was scheduled for cancellation.
 * This sets cancel_at_period_end back to false in Stripe.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const parsed = parseOrgId(organizationId);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "subscription resume",
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

  // Resume is the recovery path OUT of a grace-period freeze, so the read-only
  // gate is intentionally skipped (skipReadOnly). See subscriptions.ts.
  const ctx = await resolveAdminContext(supabase, user.id, parsed.orgId, { skipReadOnly: true });
  if (!ctx.ok) {
    return withHeaders(denialResponse(ctx.denial), rateLimit.headers);
  }

  const serviceSupabase = createServiceClient();
  const result = await resumeSubscription(serviceSupabase, stripe, parsed.orgId);

  if (!result.ok) {
    return respond({ error: result.error }, result.status);
  }

  return respond({
    status: result.status,
    message: result.message,
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
