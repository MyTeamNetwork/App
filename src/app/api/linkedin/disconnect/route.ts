import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { disconnectLinkedIn } from "@/lib/linkedin/oauth";

export const dynamic = "force-dynamic";

/**
 * POST /api/linkedin/disconnect
 *
 * Disconnects a user's LinkedIn account by removing the connection record.
 * LinkedIn OIDC doesn't support token revocation.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to disconnect your LinkedIn account." },
        { status: 401 }
      );
    }

    const serviceClient = createServiceClient();
    const result = await disconnectLinkedIn(serviceClient, user.id);

    if (!result.success) {
      return NextResponse.json(
        { error: "Disconnect failed", message: result.error || "Failed to disconnect LinkedIn." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "LinkedIn disconnected successfully.",
    });
  } catch (error) {
    console.error("[linkedin-disconnect] Error disconnecting:", error);
    return NextResponse.json(
      { error: "Internal error", message: "An error occurred while disconnecting your LinkedIn account." },
      { status: 500 }
    );
  }
}
