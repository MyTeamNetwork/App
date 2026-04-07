function normalizeOrigin(siteUrl: string): string {
  return siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
}

export function buildMobileRecoveryRedirectTo(
  siteUrl: string,
  innerRedirect = "/auth/login"
): string {
  const base = normalizeOrigin(siteUrl);
  const resetPage = `/auth/reset-password?redirect=${encodeURIComponent(innerRedirect)}`;
  return `${base}/auth/callback?redirect=${encodeURIComponent(resetPage)}`;
}
