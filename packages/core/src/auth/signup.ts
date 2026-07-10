/**
 * Interprets the user returned by `supabase.auth.signUp` for email/password
 * signups when email confirmations are enabled.
 *
 * GoTrue's anti-enumeration behavior returns a "success" response for an
 * already-registered email, but the user object is obfuscated with an empty
 * `identities` array — and for an already-confirmed account NO confirmation
 * email is sent. Callers must detect this and direct the person to sign in
 * or reset their password instead of showing a "check your email" message
 * for an email that will never arrive.
 *
 * A genuinely new signup returns the user with one identity; when email
 * confirmations are disabled, existing emails fail with an explicit error
 * instead, so `identities` is never an empty array for a real new account.
 */
export function isExistingAccountSignup(
  user: { identities?: unknown[] | null } | null | undefined,
): boolean {
  return Boolean(user && Array.isArray(user.identities) && user.identities.length === 0);
}
