/**
 * Device-scoped biometric app lock.
 *
 * Supabase owns the single persisted login session. Biometrics only unlock the
 * already-authenticated app; no access or refresh token is duplicated here.
 */

import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const BIOMETRIC_ENABLED_KEY = "teammeet.biometric_enabled.v1";
const LEGACY_BIOMETRIC_SESSION_KEY = "teammeet.biometric_session.v1";
const LEGACY_BIOMETRIC_MARKER_KEY = "teammeet.biometric_session_available.v1";

const LEGACY_BIOMETRIC_SESSION_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "com.myteamnetwork.teammeet.biometric-signin",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: true,
  authenticationPrompt: "Unlock TeamNetwork",
};

const LEGACY_BIOMETRIC_MARKER_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "com.myteamnetwork.teammeet.biometric-signin-meta",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** Default re-lock window — match plan default (5 min). */
export const BIOMETRIC_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export interface BiometricCapabilities {
  hasHardware: boolean;
  isEnrolled: boolean;
}

export function didAuthenticatedSessionEnd(
  previousUserId: string | null,
  currentUserId: string | null
): boolean {
  return previousUserId !== null && currentUserId === null;
}

export function shouldLockOnAuthTransition({
  previousUserId,
  currentUserId,
  isEnabled,
}: {
  previousUserId: string | null;
  currentUserId: string | null;
  isEnabled: boolean;
}): boolean {
  return isEnabled && currentUserId !== null && previousUserId !== currentUserId;
}

export function isBiometricLockToggleDisabled({
  busy,
  isEnrolled,
  isEnabled,
}: {
  busy: boolean;
  isEnrolled: boolean;
  isEnabled: boolean;
}): boolean {
  return busy || (!isEnrolled && !isEnabled);
}

export async function getBiometricCapabilities(): Promise<BiometricCapabilities> {
  try {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return { hasHardware, isEnrolled };
  } catch {
    return { hasHardware: false, isEnrolled: false };
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  try {
    const value = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
    return value === "1";
  } catch {
    return false;
  }
}

export type AuthResult =
  | { success: true }
  | { success: false; error: string; cancelled: boolean; lockUnavailable: boolean };

const CANCELLATION_ERRORS = new Set(["user_cancel", "system_cancel", "app_cancel"]);
const LOCK_UNAVAILABLE_ERRORS = new Set(["not_enrolled", "not_available", "passcode_not_set"]);

export async function authenticate(reason: string): Promise<AuthResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      biometricsSecurityLevel: "strong",
      // Match mainstream mobile apps: strong biometrics first, with the device
      // credential as the recovery path after biometric lockout or failure.
      disableDeviceFallback: false,
      cancelLabel: "Cancel",
    });
    if (result.success) return { success: true };
    const errorCode = (result as { error?: string }).error ?? "unknown";
    return {
      success: false,
      error: errorCode,
      cancelled: CANCELLATION_ERRORS.has(errorCode),
      lockUnavailable: LOCK_UNAVAILABLE_ERRORS.has(errorCode),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      cancelled: false,
      lockUnavailable: false,
    };
  }
}

export async function enableBiometricLock(): Promise<AuthResult> {
  const capabilities = await getBiometricCapabilities();
  if (!capabilities.hasHardware || !capabilities.isEnrolled) {
    return {
      success: false,
      error: "Biometric unlock is not available on this device.",
      cancelled: false,
      lockUnavailable: true,
    };
  }

  const result = await authenticate("Enable biometric unlock for TeamNetwork");
  if (!result.success) return result;

  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "1");
  return { success: true };
}

async function deleteSecureStoreEntries(
  entries: ReadonlyArray<readonly [string, SecureStore.SecureStoreOptions?]>
): Promise<void> {
  const results = await Promise.allSettled(
    entries.map(([key, options]) => SecureStore.deleteItemAsync(key, options))
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failure) throw failure.reason;
}

export async function clearLegacyBiometricCredentials(): Promise<void> {
  await deleteSecureStoreEntries([
    [LEGACY_BIOMETRIC_SESSION_KEY, LEGACY_BIOMETRIC_SESSION_OPTIONS],
    [LEGACY_BIOMETRIC_MARKER_KEY, LEGACY_BIOMETRIC_MARKER_OPTIONS],
  ]);
}

export async function clearBiometricLock(): Promise<void> {
  await deleteSecureStoreEntries([
    [BIOMETRIC_ENABLED_KEY],
    [LEGACY_BIOMETRIC_SESSION_KEY, LEGACY_BIOMETRIC_SESSION_OPTIONS],
    [LEGACY_BIOMETRIC_MARKER_KEY, LEGACY_BIOMETRIC_MARKER_OPTIONS],
  ]);
}
