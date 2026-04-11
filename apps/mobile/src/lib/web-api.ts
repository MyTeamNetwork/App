import { supabase } from "@/lib/supabase";

const WEB_API_URL = (
  process.env.EXPO_PUBLIC_WEB_URL?.trim() || "https://www.myteamnetwork.com"
).replace(/\/+$/, "");

export function getWebAppUrl() {
  return WEB_API_URL;
}

export function getWebPath(orgSlug: string, path?: string): string {
  const normalizedOrgSlug = orgSlug.trim().replace(/^\/+|\/+$/g, "");
  const normalizedPath = path?.trim().replace(/^\/+|\/+$/g, "");

  if (!normalizedOrgSlug) {
    return WEB_API_URL;
  }

  return normalizedPath
    ? `${WEB_API_URL}/${normalizedOrgSlug}/${normalizedPath}`
    : `${WEB_API_URL}/${normalizedOrgSlug}`;
}

export async function fetchWithAuth(path: string, options: RequestInit) {
  let { data: sessionData } = await supabase.auth.getSession();

  // If the access token is expired or expiring within 30 s, refresh it.
  if (sessionData.session) {
    const expiresAt = sessionData.session.expires_at ?? 0;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (expiresAt - nowSeconds < 30) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed.session) {
        sessionData = refreshed;
      }
    }
  }

  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    throw new Error("Not authenticated");
  }

  const headers = {
    ...(options.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${accessToken}`,
  };

  return fetch(`${WEB_API_URL}${path}`, {
    ...options,
    headers,
  });
}
