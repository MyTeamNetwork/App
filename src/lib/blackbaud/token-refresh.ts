import { decryptToken, encryptToken, isTokenExpired, refreshAccessToken } from "./oauth";

interface TokenRefreshIntegration {
  id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: string;
}

/**
 * Returns a valid access token for the given integration,
 * refreshing via Blackbaud OAuth if expired.
 *
 * Handles concurrent refresh races:
 * - CAS update on token_expires_at prevents overwrite
 * - Blackbaud invalid_grant (consumed refresh token) treated as lost race
 * - Lost race → re-read winner's token from DB
 */
export async function refreshTokenWithFallback(
  integration: TokenRefreshIntegration,
  supabase: any
): Promise<string> {
  const tokenExpiresAt = new Date(integration.token_expires_at);

  if (!isTokenExpired(tokenExpiresAt)) {
    return decryptToken(integration.access_token_enc);
  }

  const refreshToken = decryptToken(integration.refresh_token_enc);

  let newTokens: { access_token: string; refresh_token: string; expires_in: number } | null = null;
  try {
    newTokens = await refreshAccessToken(refreshToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/invalid_grant/i.test(message)) {
      newTokens = null;
    } else {
      throw err;
    }
  }

  if (newTokens) {
    const { count } = (await (supabase as any)
      .from("org_integrations")
      .update({
        access_token_enc: encryptToken(newTokens.access_token),
        refresh_token_enc: encryptToken(newTokens.refresh_token),
        token_expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration.id)
      .eq("token_expires_at", integration.token_expires_at)
      .select("id", { count: "exact", head: true })) as { count: number };

    if (count > 0) {
      return newTokens.access_token;
    }
  }

  const { data: refreshed, error: reReadError } = (await (supabase as any)
    .from("org_integrations")
    .select("access_token_enc")
    .eq("id", integration.id)
    .single()) as { data: { access_token_enc: string } | null; error: any };

  if (reReadError || !refreshed) {
    throw new Error(
      `Token refresh failed: could not re-read token for integration ${integration.id}` +
        (reReadError ? `: ${reReadError.message}` : "")
    );
  }

  return decryptToken(refreshed.access_token_enc);
}
