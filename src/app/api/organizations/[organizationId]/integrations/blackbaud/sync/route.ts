import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgRole } from "@/lib/auth/roles";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getBlackbaudSubscriptionKey } from "@/lib/blackbaud/oauth";
import { refreshTokenWithFallback } from "@/lib/blackbaud/token-refresh";
import { createBlackbaudClient } from "@/lib/blackbaud/client";
import { runSync } from "@/lib/blackbaud/sync";
import { getAlumniCapacitySnapshot } from "@/lib/alumni/capacity";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OrgIntegrationRow = Database["public"]["Tables"]["org_integrations"]["Row"];
type BlackbaudIntegration = Pick<
  OrgIntegrationRow,
  "id" | "access_token_enc" | "refresh_token_enc" | "token_expires_at" | "last_synced_at"
>;
type BlackbaudIntegrationWithTokens = BlackbaudIntegration & {
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ organizationId: string }> }
) {
  const { organizationId } = await params;
  // #region agent log
  console.error("[bb-sync-debug] entry", { organizationId });
  // #endregion

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "blackbaud-sync",
    limitPerIp: 5,
    limitPerUser: 3,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: rateLimit.headers }
    );
  }

  // Verify org admin explicitly (uses orgId, not orgSlug)
  try {
    await requireOrgRole({ orgId: organizationId, allowedRoles: ["admin"] });
  } catch {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403, headers: rateLimit.headers }
    );
  }

  const serviceSupabase = createServiceClient();

  try {
    const { data: integration } = await serviceSupabase
      .from("org_integrations")
      .select(
        "id, status, access_token_enc, refresh_token_enc, token_expires_at, last_synced_at"
      )
      .eq("organization_id", organizationId)
      .eq("provider", "blackbaud")
      .eq("status", "active")
      .maybeSingle();

    if (!integration) {
      return NextResponse.json(
        { error: "No active Blackbaud connection for this organization" },
        { status: 404, headers: rateLimit.headers }
      );
    }

    // #region agent log
    console.error("[bb-sync-debug] integration found", { id: integration.id, status: integration.status });
    // #endregion

    const activeIntegration = integration as BlackbaudIntegration;
    if (
      !activeIntegration.access_token_enc ||
      !activeIntegration.refresh_token_enc ||
      !activeIntegration.token_expires_at
    ) {
      return NextResponse.json(
        { error: "Blackbaud connection is missing token data" },
        { status: 502, headers: rateLimit.headers }
      );
    }
    const hydratedIntegration: BlackbaudIntegrationWithTokens = {
      ...activeIntegration,
      access_token_enc: activeIntegration.access_token_enc,
      refresh_token_enc: activeIntegration.refresh_token_enc,
      token_expires_at: activeIntegration.token_expires_at,
    };

    // Get valid access token (refresh if needed)
    let accessToken: string;
    try {
      accessToken = await refreshTokenWithFallback(hydratedIntegration, serviceSupabase);
      // #region agent log
      console.error("[bb-sync-debug] token OK", { tokenLen: accessToken.length });
      // #endregion
    } catch (tokenErr) {
      // #region agent log
      console.error("[bb-sync-debug] token FAILED", { error: tokenErr instanceof Error ? tokenErr.message : String(tokenErr) });
      // #endregion
      return NextResponse.json(
        { error: "Failed to refresh Blackbaud access token" },
        { status: 502, headers: rateLimit.headers }
      );
    }

    let capacity: { alumniLimit: number | null; currentAlumniCount: number };
    try {
      capacity = await getAlumniCapacitySnapshot(organizationId, serviceSupabase);
      // #region agent log
      console.error("[bb-sync-debug] capacity OK", { alumniLimit: capacity.alumniLimit, currentAlumniCount: capacity.currentAlumniCount });
      // #endregion
    } catch (capErr) {
      // #region agent log
      console.error("[bb-sync-debug] capacity FAILED", { error: capErr instanceof Error ? capErr.message : String(capErr) });
      // #endregion
      return NextResponse.json(
        { error: "Failed to check alumni capacity", detail: capErr instanceof Error ? capErr.message : String(capErr) },
        { status: 500, headers: rateLimit.headers }
      );
    }

    const client = createBlackbaudClient({
      accessToken,
      subscriptionKey: getBlackbaudSubscriptionKey(),
    });

    const result = await runSync({
      client,
      supabase: serviceSupabase,
      integrationId: activeIntegration.id,
      organizationId,
      alumniLimit: capacity.alumniLimit,
      currentAlumniCount: capacity.currentAlumniCount,
      syncType: "manual",
      lastSyncedAt: activeIntegration.last_synced_at,
    });

    // #region agent log
    console.error("[bb-sync-debug] runSync result", { ok: result.ok, created: result.created, updated: result.updated, unchanged: result.unchanged, skipped: result.skipped, error: result.error });
    // #endregion

    return NextResponse.json(
      { result },
      { status: result.ok ? 200 : 500, headers: rateLimit.headers }
    );
  } catch (outerErr) {
    // #region agent log
    console.error("[bb-sync-debug] UNHANDLED ERROR", { error: outerErr instanceof Error ? outerErr.message : String(outerErr), stack: outerErr instanceof Error ? outerErr.stack : undefined });
    // #endregion
    return NextResponse.json(
      { error: "Sync failed unexpectedly", detail: outerErr instanceof Error ? outerErr.message : String(outerErr) },
      { status: 500, headers: rateLimit.headers }
    );
  }
}
