import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { linkedInProfileUrlSchema, normalizeLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";
import {
  parseOrgId,
  resolveAdminContext,
  denialResponse,
  readOnlyGuard,
  unauthorizedResponse,
} from "@/lib/organizations";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas, validateJson, ValidationError } from "@/lib/security/validation";

const attachLinkedInSchema = z.object({
  alumniId: baseSchemas.uuid,
  linkedin_url: linkedInProfileUrlSchema,
  replace: z.boolean().optional().default(false),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const parsed = parseOrgId(organizationId);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "alumni linkedin attach",
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

  let body: z.infer<typeof attachLinkedInSchema>;
  try {
    body = await validateJson(req, attachLinkedInSchema, { maxBodyBytes: 10_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  // Admin-only alumni write, grace-period gated (isSelf never applied here).
  const ctx = await resolveAdminContext(supabase, user.id, parsed.orgId);
  if (!ctx.ok) {
    return withHeaders(denialResponse(ctx.denial), rateLimit.headers);
  }
  const readOnly = readOnlyGuard(ctx.ctx);
  if (readOnly) {
    return withHeaders(readOnly, rateLimit.headers);
  }

  const serviceSupabase = createServiceClient();

  const { data: alumni, error: alumniError } = await serviceSupabase
    .from("alumni")
    .select("id, linkedin_url")
    .eq("id", body.alumniId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (alumniError) {
    console.error("[alumni/linkedin-url POST] Failed to load alumni:", alumniError);
    return respond({ error: "Failed to load alumni" }, 500);
  }

  if (!alumni?.id) {
    return respond({ error: "Alumni not found" }, 404);
  }

  const incomingUrl = body.linkedin_url;
  const existingUrl = alumni.linkedin_url ? normalizeLinkedInProfileUrl(alumni.linkedin_url) : null;

  if (existingUrl && existingUrl === incomingUrl) {
    return respond({ success: true, unchanged: true });
  }

  if (existingUrl && !body.replace) {
    return respond(
      {
        error: "LinkedIn URL already exists for this alumni",
        code: "LINKEDIN_URL_EXISTS",
        existingUrl,
      },
      409,
    );
  }

  const { error: updateError } = await serviceSupabase
    .from("alumni")
    .update({
      linkedin_url: incomingUrl,
      // Enqueue enrichment so the new URL is actually scraped — matches the
      // CSV/bulk-import routes. The enrichment-process cron starts the Apify run.
      enrichment_status: "pending",
      enrichment_retry_count: 0,
      enrichment_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.alumniId)
    .eq("organization_id", organizationId);

  if (updateError) {
    console.error("[alumni/linkedin-url POST] Failed to update alumni:", updateError);
    return respond({ error: "Failed to update alumni" }, 500);
  }

  const { data: org } = await serviceSupabase
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .maybeSingle();

  if (org?.slug) {
    revalidatePath(`/${org.slug}/alumni`);
    revalidatePath(`/${org.slug}/alumni/${body.alumniId}`);
    revalidatePath(`/${org.slug}/alumni/${body.alumniId}/edit`);
  }

  return respond({ success: true, replaced: Boolean(existingUrl) });
}

/** Attach rate-limit headers onto a resolver-produced NextResponse (whose body
 * already matches the current route contract) without re-serializing it. */
function withHeaders(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}
