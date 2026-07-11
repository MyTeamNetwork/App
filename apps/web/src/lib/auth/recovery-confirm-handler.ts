import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sanitizeRecoveryNextParam } from "@/lib/auth/redirect";
import { buildErrorRedirect } from "@/lib/auth/callback-flow";

const INVALID_LINK_MESSAGE =
  "This reset link is invalid or has expired. Please request a new password reset.";

// GoTrue token hashes are hex digests; stay permissive on charset but reject
// anything that could break out of a URL parameter.
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9._-]{1,255}$/;

/**
 * Recovery links land here from the email (recovery template appends
 * `&token_hash={{ .TokenHash }}&type=recovery`).
 *
 * The single-use token is deliberately NOT verified on this GET — email
 * security scanners (Proofpoint URL Defense, Outlook Safe Links) prefetch
 * links and would consume the token before the user's browser arrives.
 * The token is forwarded to the reset-password page instead, which calls
 * `verifyOtp` only when the user submits their new password.
 *
 * Only `type=recovery` is accepted: no other email flow links here (magic
 * link emails are code-only), and non-email tooling that mints admin links
 * (e.g. the Playwright bootstrap) verifies directly against GoTrue.
 */
export function createRecoveryConfirmHandler() {
  return async function GET(request: NextRequest) {
    const requestUrl = new URL(request.url);
    const tokenHash = requestUrl.searchParams.get("token_hash");
    const type = requestUrl.searchParams.get("type");
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin;
    const nextPath = sanitizeRecoveryNextParam(requestUrl.searchParams.get("next"));

    if (!tokenHash || type !== "recovery" || !TOKEN_HASH_PATTERN.test(tokenHash)) {
      return NextResponse.redirect(
        buildErrorRedirect(siteUrl, INVALID_LINK_MESSAGE, null, null)
      );
    }

    const redirectUrl = new URL(nextPath, siteUrl);
    redirectUrl.searchParams.set("token_hash", tokenHash);

    return NextResponse.redirect(redirectUrl);
  };
}
