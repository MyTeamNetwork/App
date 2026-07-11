// Auth flows put single-use secrets in URLs (?token_hash=… on the reset page,
// ?code=… on OAuth callbacks, #access_token=… on implicit-flow redirects).
// Telemetry must never persist them.
const SENSITIVE_URL_PARAMS = [
  "token_hash",
  "token",
  "code",
  "access_token",
  "refresh_token",
] as const;

export function redactSensitiveUrlParams(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    for (const param of SENSITIVE_URL_PARAMS) {
      if (url.searchParams.has(param)) {
        url.searchParams.set(param, "redacted");
      }
    }
    if (url.hash.includes("access_token") || url.hash.includes("refresh_token")) {
      url.hash = "redacted";
    }
    return url.toString();
  } catch {
    // Relative or malformed URLs carry no host context worth parsing; the
    // only callers pass absolute location/referrer values.
    return rawUrl;
  }
}
