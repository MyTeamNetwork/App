import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateJson, ValidationError, validationErrorResponse, baseSchemas } from "@/lib/security/validation";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bulkDeleteSchema = z.object({
  orgId: baseSchemas.uuid,
  mediaIds: z.array(baseSchemas.uuid).min(1).max(100),
});

/**
 * POST /api/media/bulk-delete
 * Soft-delete multiple media items. Auth: admin or uploader of ALL items.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    limitPerIp: 20,
    limitPerUser: 10,
    userId: user?.id ?? null,
    feature: "media-bulk-delete",
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
  }

  let body: z.infer<typeof bulkDeleteSchema>;
  try {
    body = await validateJson(req, bulkDeleteSchema);
  } catch (error) {
    if (error instanceof ValidationError) return validationErrorResponse(error);
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: rateLimit.headers });
  }

  const { orgId, mediaIds } = body;

  // Check org membership
  const membership = await getOrgMembership(supabase, user.id, orgId);
  if (!membership) {
    return NextResponse.json(
      { error: "Not a member of this organization" },
      { status: 403, headers: rateLimit.headers },
    );
  }

  const isAdmin = membership.role === "admin";

  // Read-only check
  const { isReadOnly } = await checkOrgReadOnly(orgId);
  if (isReadOnly) {
    return NextResponse.json(readOnlyResponse(), { status: 403, headers: rateLimit.headers });
  }

  const serviceClient = createServiceClient();
  const now = new Date().toISOString();

  // If not admin, verify user uploaded ALL requested items
  if (!isAdmin) {
    const { data: items, error: fetchError } = await serviceClient
      .from("media_items")
      .select("id, uploaded_by")
      .in("id", mediaIds)
      .eq("organization_id", orgId)
      .is("deleted_at", null);

    if (fetchError) {
      return NextResponse.json({ error: "Failed to verify ownership" }, { status: 500, headers: rateLimit.headers });
    }

    const allOwned = (items || []).length === mediaIds.length &&
      (items || []).every((item) => item.uploaded_by === user.id);

    if (!allOwned) {
      return NextResponse.json(
        { error: "You can only bulk-delete your own media" },
        { status: 403, headers: rateLimit.headers },
      );
    }
  }

  const { error: clearCoverError } = await serviceClient
    .from("media_albums")
    .update({ cover_media_id: null, updated_at: now })
    .eq("organization_id", orgId)
    .in("cover_media_id", mediaIds)
    .is("deleted_at", null);

  if (clearCoverError) {
    console.error("[media/bulk-delete] Failed to clear album covers:", clearCoverError);
    return NextResponse.json(
      { error: "Failed to clear album covers" },
      { status: 500, headers: rateLimit.headers },
    );
  }

  // Soft delete
  const { data, error: deleteError } = await serviceClient
    .from("media_items")
    .update({ deleted_at: now })
    .eq("organization_id", orgId)
    .in("id", mediaIds)
    .is("deleted_at", null)
    .select("id");

  if (deleteError) {
    console.error("[media/bulk-delete] Soft delete failed:", deleteError);
    return NextResponse.json(
      { error: "Failed to delete media items" },
      { status: 500, headers: rateLimit.headers },
    );
  }

  const deletedIds = (data ?? []).map((r) => r.id as string);

  return NextResponse.json({ deleted: deletedIds.length, deletedIds }, { headers: rateLimit.headers });
}
