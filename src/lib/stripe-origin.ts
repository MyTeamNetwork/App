/**
 * Safe origin resolver for Stripe redirect URLs.
 *
 * Trims whitespace/newlines from NEXT_PUBLIC_SITE_URL and validates it
 * is a well-formed URL before handing it to Stripe. Falls back to the
 * server-controlled req.url origin so checkout never breaks due to a
 * misconfigured env var.
 */
export function getStripeOrigin(reqUrl: string): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (envUrl) {
    try {
      return new URL(envUrl).origin;
    } catch {
      try {
        return new URL(`https://${envUrl}`).origin;
      } catch {
        // completely invalid — fall through to reqUrl
      }
    }
  }
  return new URL(reqUrl).origin;
}
