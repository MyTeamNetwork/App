const ALLOWED_URL_SCHEMES = new Set(["http", "https", "mailto"]);

/**
 * Allowlist-based URL sanitizer for react-markdown's urlTransform.
 *
 * Applies to both href and src. Rejects anything that isn't a relative/anchor
 * URL or an http(s)/mailto absolute URL — this blocks javascript:, data:,
 * vbscript:, file:, and protocol-relative (//host/... or \\host/...) exfiltration vectors.
 *
 * Deliberately avoids `new URL(...)`: resolving against a base would turn
 * protocol-relative URLs like `//attacker.com/x` into `https://attacker.com/x`,
 * silently letting them through.
 */
export function safeUrl(url: string): string {
  let start = 0;
  let end = url.length;
  while (start < end && url.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && url.charCodeAt(end - 1) <= 0x20) end -= 1;
  const normalizedUrl = url.slice(start, end).trim();

  if (normalizedUrl.startsWith("//") || normalizedUrl.startsWith("\\")) {
    return "";
  }

  const colon = normalizedUrl.indexOf(":");
  if (colon === -1) {
    return normalizedUrl;
  }

  const beforeColon = normalizedUrl.slice(0, colon);
  if (beforeColon.includes("/") || beforeColon.includes("?") || beforeColon.includes("#")) {
    return normalizedUrl;
  }

  const scheme = beforeColon.toLowerCase();
  return ALLOWED_URL_SCHEMES.has(scheme) ? normalizedUrl : "";
}
