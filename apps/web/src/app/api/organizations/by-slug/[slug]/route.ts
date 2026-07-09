import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgIdBySlug, unauthorizedResponse } from "@/lib/organizations";
import { internalError } from "@/lib/api/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/**
 * GET /api/organizations/by-slug/[slug]
 * 
 * Returns the organization ID for a given slug.
 * Used by CheckoutSuccessBanner to poll for org creation after checkout.
 * 
 * Security:
 * - Rate-limited to prevent enumeration attacks
 * - Returns only { id } to minimize data exposure
 * - Requires authentication
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { slug } = await params;
  
  // Validate slug format
  const slugParsed = baseSchemas.slug.safeParse(slug);
  if (!slugParsed.success) {
    return NextResponse.json({ error: "Invalid slug format" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Rate limit based on user (if authed) or IP
  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "org-by-slug",
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

  const result = await getOrgIdBySlug(supabase, slug);

  if (!result.ok) {
    if (result.kind === "db_error") {
      // 500 body adopts the shared shape; capture fires (fire-and-forget).
      return withHeaders(
        internalError("Failed to lookup organization", { message: result.message }),
        rateLimit.headers
      );
    }
    return respond({ error: "Organization not found" }, 404);
  }

  // Return only the ID to minimize data exposure
  return respond({ id: result.id });
}


/** Attach rate-limit headers onto a resolver/helper-produced NextResponse. */
function withHeaders(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}
