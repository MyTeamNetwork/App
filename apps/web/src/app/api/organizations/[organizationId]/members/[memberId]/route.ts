import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";
import {
  parseOrgId,
  resolveAdminContext,
  denialResponse,
  readOnlyGuard,
  unauthorizedResponse,
} from "@/lib/organizations";
import { patchMember } from "@/lib/organizations/members";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; memberId: string }>;
}

const patchSchema = z
  .object({
    role: z.enum(["admin", "active_member", "alumni", "parent"]).optional(),
    status: z.enum(["active", "revoked", "pending"]).optional(),
  })
  .refine((d) => d.role !== undefined || d.status !== undefined, {
    message: "At least one of role or status is required",
  });

export async function PATCH(req: Request, { params }: RouteParams) {
  const { organizationId, memberId: userId } = await params;

  const parsed = parseOrgId(organizationId);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const userIdParsed = baseSchemas.uuid.safeParse(userId);
  if (!userIdParsed.success) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "member role update",
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

  let body: z.infer<typeof patchSchema>;
  try {
    body = await validateJson(req, patchSchema, { maxBodyBytes: 1_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const serviceSupabase = createServiceClient();

  const result = await patchMember(serviceSupabase, {
    organizationId: parsed.orgId,
    actorUserId: user.id,
    targetUserId: userId,
    role: body.role,
    status: body.status,
  });

  if (!result.ok) {
    return respond({ error: result.error }, result.status);
  }

  // Invalidate router cache so navigating to other pages shows fresh data.
  if (result.slug) {
    const slug = result.slug;
    revalidatePath(`/${slug}`);
    revalidatePath(`/${slug}/members`, "layout");
    revalidatePath(`/${slug}/parents`, "layout");
    revalidatePath(`/${slug}/settings/invites`);
  }

  return respond({ success: true });
}

/** Attach rate-limit headers onto a resolver-produced NextResponse (whose body
 * already matches the current route contract) without re-serializing it. */
function withHeaders(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}
