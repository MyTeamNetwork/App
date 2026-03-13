import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncLinkedInProfile } from "@/lib/linkedin/oauth";

export const dynamic = "force-dynamic";

/**
 * POST /api/linkedin/sync
 *
 * Re-fetches the user's LinkedIn profile and updates the stored connection.
 * If the token is expired and can't be refreshed, returns an error
 * signaling the frontend to trigger a reconnect flow.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to sync your LinkedIn profile." },
        { status: 401 }
      );
    }

    const serviceClient = createServiceClient();
    const result = await syncLinkedInProfile(serviceClient, user.id);

    if (!result.success) {
      return NextResponse.json(
        { error: "Sync failed", message: result.error || "Failed to sync LinkedIn profile." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      profile: result.profile,
    });
  } catch (error) {
    console.error("[linkedin-sync] Error syncing profile:", error);
    return NextResponse.json(
      { error: "Internal error", message: "An error occurred while syncing your LinkedIn profile." },
      { status: 500 }
    );
  }
}
