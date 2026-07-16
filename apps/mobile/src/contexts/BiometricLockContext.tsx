/**
 * BiometricLockContext (R5).
 *
 * Locks the app on cold start and on foreground-after-timeout when the user
 * has opted in. Renders a `<LockScreen />` overlay that prompts for biometric
 * (or device passcode fallback) and clears the lock on success.
 *
 * Scope decisions:
 * - Timeout is a constant (BIOMETRIC_LOCK_TIMEOUT_MS = 5 min). User-configurable
 *   timeout deferred until we add a `user_app_preferences` row.
 * - Biometrics guard local app access only. Supabase owns the one persisted
 *   login session and continues its normal foreground refresh lifecycle.
 * - A privacy overlay obscures app-switcher snapshots while opted in.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState, type AppStateStatus, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import {
  authenticate,
  BIOMETRIC_LOCK_TIMEOUT_MS,
  clearBiometricLock,
  clearLegacyBiometricCredentials,
  didAuthenticatedSessionEnd,
  enableBiometricLock,
  isBiometricEnabled,
  shouldLockOnAuthTransition,
  type AuthResult,
} from "@/lib/biometric";
import * as sentry from "@/lib/analytics/sentry";
import { LockScreen } from "@/components/biometric/LockScreen";
import { useAuth } from "@/contexts/AuthContext";

interface BiometricLockState {
  /** True while the lock overlay should cover the app. */
  isLocked: boolean;
  /** Current device-scoped lock preference. */
  isEnabled: boolean;
  /** True while initial enabled-flag lookup is pending — render nothing visible. */
  isResolving: boolean;
  /** Trigger a lock immediately (used after enabling from settings). */
  lock: () => void;
  /** Attempt to unlock — surfaces a system biometric prompt. */
  unlock: () => Promise<{ success: boolean; lockUnavailable?: boolean }>;
  /** Enable the persisted app-lock preference and update mounted state. */
  enableLock: () => Promise<AuthResult>;
  /** Clear the persisted preference and retired credentials, then update state. */
  disableLock: () => Promise<void>;
}

const BiometricLockContext = createContext<BiometricLockState | null>(null);

export function useBiometricLock(): BiometricLockState {
  const ctx = useContext(BiometricLockContext);
  if (!ctx) {
    throw new Error("useBiometricLock must be used within BiometricLockProvider");
  }
  return ctx;
}

export function BiometricLockProvider({ children }: PropsWithChildren) {
  const { isLoading: isAuthLoading, session } = useAuth();
  const [storedEnabled, setStoredEnabled] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [isResolving, setIsResolving] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  // Backgrounded state drives the privacy overlay. We only setState when the
  // boolean actually flips (active <-> not-active), so the Face ID system
  // dialog's rapid inactive↔active churn doesn't re-render the entire
  // children tree mid-prompt — that re-render was the source of the lock
  // screen flicker on notification tap.
  const [isBackgrounded, setIsBackgrounded] = useState(AppState.currentState !== "active");
  const lastBackgroundedAtRef = useRef<number | null>(null);
  const previousUserIdRef = useRef<string | null>(null);
  // Read inside the AppState handler so the listener can stay stable across
  // enable/disable toggles. Avoids a race where re-subscribing drops the
  // backgrounded timestamp mid-toggle.
  const enabledRef = useRef(false);

  // Cold-start: migrate retired credentials and hydrate the device preference.
  // Applying the lock waits for auth resolution below so a signed-out launch
  // never receives an account-specific overlay.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await clearLegacyBiometricCredentials();
      } catch (error) {
        sentry.captureException(error as Error, {
          context: "BiometricLockContext.clearLegacyBiometricCredentials",
        });
      }
      const on = await isBiometricEnabled();
      if (cancelled) return;
      setStoredEnabled(on);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // AppState: lock when foregrounding after timeout, and track current state
  // so we can render a privacy overlay during inactive/background (the
  // moments iOS captures the app-switcher snapshot). Subscribed once with no
  // deps; reads `enabled` via a ref to stay stable across toggles.
  useEffect(() => {
    const handler = (next: AppStateStatus) => {
      const nextBackgrounded = next !== "active";
      // Only setState on a transition, not on every event. iOS fires
      // inactive→inactive duplicates around system prompts.
      setIsBackgrounded((prev) => (prev === nextBackgrounded ? prev : nextBackgrounded));
      if (!enabledRef.current) return;
      if (next === "background" || next === "inactive") {
        // Don't overwrite an existing timestamp — the system biometric
        // prompt cycles inactive→active→inactive and we want the original
        // background time, not the prompt's transient inactive.
        if (lastBackgroundedAtRef.current == null) {
          lastBackgroundedAtRef.current = Date.now();
        }
        return;
      }
      if (next === "active") {
        const since = lastBackgroundedAtRef.current;
        if (since != null && Date.now() - since >= BIOMETRIC_LOCK_TIMEOUT_MS) {
          setIsLocked(true);
        }
        lastBackgroundedAtRef.current = null;
      }
    };
    const sub = AppState.addEventListener("change", handler);
    return () => sub.remove();
  }, []);

  const showPrivacyOverlay = enabled && isBackgrounded;

  const lock = useCallback(() => setIsLocked(true), []);

  const setLockEnabled = useCallback((nextEnabled: boolean) => {
    enabledRef.current = nextEnabled;
    setEnabled(nextEnabled);
    if (!nextEnabled) {
      setIsLocked(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthLoading || storedEnabled === null) return;

    const currentUserId = session?.user.id ?? null;
    const previousUserId = previousUserIdRef.current;
    const sessionEnded = didAuthenticatedSessionEnd(previousUserId, currentUserId);
    const shouldLock = shouldLockOnAuthTransition({
      previousUserId,
      currentUserId,
      isEnabled: storedEnabled,
    });
    previousUserIdRef.current = currentUserId;

    if (currentUserId === null) {
      setLockEnabled(false);
      if (sessionEnded) {
        setStoredEnabled(false);
        // Retry once: a failed delete strands the persisted flag, so the next
        // signed-in launch would inherit the previous user's lock preference.
        void clearBiometricLock()
          .catch(() => clearBiometricLock())
          .catch((error) => {
            sentry.captureException(error as Error, {
              context: "BiometricLockContext.clearLockAfterSessionEnd",
            });
          });
      }
    } else {
      setLockEnabled(storedEnabled);
      if (shouldLock) setIsLocked(true);
    }
    setIsResolving(false);
  }, [isAuthLoading, session?.user.id, setLockEnabled, storedEnabled]);

  const enableLock = useCallback(async (): Promise<AuthResult> => {
    const result = await enableBiometricLock();
    if (result.success) {
      setStoredEnabled(true);
      setLockEnabled(true);
    }
    return result;
  }, [setLockEnabled]);

  const disableLock = useCallback(async (): Promise<void> => {
    try {
      await clearBiometricLock();
      setStoredEnabled(false);
      setLockEnabled(false);
    } catch (error) {
      const persistedEnabled = await isBiometricEnabled();
      setStoredEnabled(persistedEnabled);
      setLockEnabled(persistedEnabled);
      throw error;
    }
  }, [setLockEnabled]);

  const unlock = useCallback(async (): Promise<{
    success: boolean;
    lockUnavailable?: boolean;
  }> => {
    const result = await authenticate("Unlock TeamNetwork");
    if (result.success) {
      setIsLocked(false);
      return { success: true };
    }
    return { success: false, lockUnavailable: result.lockUnavailable };
  }, []);

  const value = useMemo(
    () => ({ isLocked, isEnabled: enabled, isResolving, lock, unlock, enableLock, disableLock }),
    [disableLock, enableLock, enabled, isLocked, isResolving, lock, unlock]
  );

  return (
    <BiometricLockContext.Provider value={value}>
      {/* While we don't yet know the enabled flag, render nothing — avoids a
          flash of unlocked content when biometric IS enabled. */}
      {isResolving ? <View style={{ flex: 1, backgroundColor: "#0f172a" }} /> : children}
      {showPrivacyOverlay && !isLocked && <PrivacyOverlay />}
      {isLocked && !isResolving && <LockScreen onUnlock={unlock} />}
    </BiometricLockContext.Provider>
  );
}

/**
 * Opaque overlay shown while the app is inactive/backgrounded so the iOS
 * app-switcher snapshot doesn't leak personal content. Only renders when
 * biometric is enabled — users who haven't opted in keep the default snapshot
 * behavior.
 */
function PrivacyOverlay() {
  return (
    <View style={privacyStyles.overlay} pointerEvents="none">
      <Image
        source={require("../../assets/brand-logo.png")}
        style={privacyStyles.logo}
        contentFit="contain"
        transition={0}
        cachePolicy="memory"
      />
    </View>
  );
}

const privacyStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9998,
    elevation: 9998,
  },
  logo: { width: 200, height: 60 },
});
