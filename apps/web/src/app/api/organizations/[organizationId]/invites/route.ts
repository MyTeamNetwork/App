import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError } from "@/lib/security/validation";
import {
  parseOrgId,
  resolveAdminContext,
  denialResponse,
  readOnlyGuard,
  unauthorizedResponse,
} from "@/lib/organizations";
import { createInvite } from "@/lib/organizations/invites";
import { orgInviteCreateSchema } from "@/lib/schemas/invite";

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
    feature: "org invite create",
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

  const ctx = await resolveAdminContext(supabase, user.id, parsed.orgId);
  if (!ctx.ok) {
    return withHeaders(denialResponse(ctx.denial), rateLimit.headers);
  }
  const readOnly = readOnlyGuard(ctx.ctx);
  if (readOnly) {
    return withHeaders(readOnly, rateLimit.headers);
  }

  let body: z.infer<typeof orgInviteCreateSchema>;
  try {
    body = await validateJson(req, orgInviteCreateSchema, { maxBodyBytes: 4_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const serviceSupabase = createServiceClient();

  const result = await createInvite(supabase, serviceSupabase, {
    organizationId: parsed.orgId,
    role: body.role,
    uses: body.uses ?? null,
    expiresAt: body.expiresAt ?? null,
    requireApproval: body.requireApproval ?? null,
  });

  if (!result.ok) {
    return respond({ error: result.error }, result.status);
  }

  if (result.slug) {
    revalidatePath(`/${result.slug}/settings/invites`);
    revalidatePath(`/${result.slug}/settings/approvals`);
  }

  return respond({ invite: result.invite });
}

/** Attach rate-limit headers onto a resolver-produced NextResponse (whose body
 * already matches the current route contract) without re-serializing it. */
function withHeaders(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}
