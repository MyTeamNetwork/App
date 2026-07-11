import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENTS,
  isStrongPassword,
} from "@teammeet/validation";

// Password policy is shared across web and mobile via @teammeet/validation so
// the clients can never drift apart. Keep the web-facing API re-exported here.
export { PASSWORD_MIN_LENGTH, PASSWORD_REQUIREMENTS, isStrongPassword };

/**
 * Validates a new password and its confirmation.
 * Returns an error message string, or null if valid.
 */
export function validateNewPassword(
  password: string,
  confirmPassword: string
): string | null {
  if (!isStrongPassword(password)) {
    return PASSWORD_REQUIREMENTS;
  }
  if (password !== confirmPassword) {
    return "Passwords do not match";
  }
  return null;
}
