import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PURGE_BATCH_SIZE = 500;
const MAX_PURGE_ROWS_PER_RUN = 5_000;

/**
 * purge_expired_api_rate_limit_buckets is not yet in the generated Database
 * types (they are regenerated once the migration is applied), so this narrows
 * the service client structurally to exactly the RPC below. Drop the cast after
 * the next types regeneration.
 */
type BucketCleanupClient = {
  rpc(
    fn: "purge_expired_api_rate_limit_buckets",
  ): PromiseLike<{ data: number | null; error: { message: string } | null }>;
};

export async function runApiRateLimitCleanup(supabase: BucketCleanupClient) {
  let deletedCount = 0;
  let batches = 0;

  while (deletedCount < MAX_PURGE_ROWS_PER_RUN) {
    const { data, error } = await supabase.rpc("purge_expired_api_rate_limit_buckets");

    if (error) {
      return {
        ok: false as const,
        error: "Purge failed",
        details: error.message,
      };
    }

    const batchDeleted = Math.max(0, Number(data ?? 0));
    deletedCount += batchDeleted;
    batches += 1;

    if (batchDeleted < PURGE_BATCH_SIZE) {
      break;
    }
  }

  return {
    ok: true as const,
    deletedCount,
    batches,
    capped: deletedCount >= MAX_PURGE_ROWS_PER_RUN,
  };
}

/**
 * Daily cron job to clean up expired API rate-limit buckets (older than 24
 * hours — far past any active fixed window). Runs at 3:30am UTC daily.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient() as unknown as BucketCleanupClient;
    const result = await runApiRateLimitCleanup(supabase);

    if (!result.ok) {
      console.error("[cron/api-rate-limit-cleanup] purge failed:", result.details);
      return NextResponse.json(
        { error: result.error, details: result.details },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      deletedCount: result.deletedCount,
      batches: result.batches,
      capped: result.capped,
    });
  } catch (err) {
    console.error("[cron/api-rate-limit-cleanup] Error:", err);
    return NextResponse.json(
      { error: "Failed to clean up rate limit buckets" },
      { status: 500 },
    );
  }
}
