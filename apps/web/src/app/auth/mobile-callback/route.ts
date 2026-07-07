/**
 * Mobile OAuth mid-flight callback — same handler as /auth/callback, on a path
 * that is NOT registered as a universal link / app link. See
 * buildMobileAuthCallbackUrl in @/lib/auth/mobile-oauth for why the mobile
 * OAuth flow must not share /auth/callback with email magic links.
 */
export { GET } from "../callback/route";
