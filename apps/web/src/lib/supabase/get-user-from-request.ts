import { NextRequest } from "next/server";
import { createClient } from "./server";
import { createServiceClient } from "./service";
import type { User } from "@supabase/supabase-js";

/**
 * Extract authenticated user from cookies (web) or Bearer token (mobile).
 * Routes that need mobile support use this instead of createClient().auth.getUser().
 */
export async function getUserFromRequest(
  request: NextRequest
): Promise<{ user: User | null; supabase: Awaited<ReturnType<typeof createClient>> }> {
  const supabase = await createClient();

  // Try cookie-based auth first (web clients)
  const { data: cookieAuth } = await supabase.auth.getUser();
  if (cookieAuth.user) {
    return { user: cookieAuth.user, supabase };
  }

  // Fall back to Bearer token (mobile clients)
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

  if (token) {
    const { data: tokenAuth } = await supabase.auth.getUser(token);
    if (tokenAuth.user) {
      // For Bearer token auth, use service client. We've already validated the user via the token,
      // so we can safely use admin access for subsequent queries. Routes must still validate
      // user permissions (e.g., org membership, role) before returning data.
      const serviceSupabase = createServiceClient();
      return { user: tokenAuth.user, supabase: serviceSupabase as any };
    }
  }

  return { user: null, supabase };
}
