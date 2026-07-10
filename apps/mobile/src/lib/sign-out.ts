import { Platform } from "react-native";
import { captureException, reset as resetAnalytics } from "@/lib/analytics";
import { signOutCleanup } from "@/lib/lifecycle";
import { authStorage, authStorageKey, supabase } from "@/lib/supabase";

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isMissingSession(error: Error): boolean {
  return error.name === "AuthSessionMissingError";
}

async function purgePersistedSession(): Promise<void> {
  if (!authStorage) return;

  try {
    await authStorage.removeItem(authStorageKey);
  } catch (error) {
    const storageError = asError(error);
    captureException(storageError, { context: "signOut.localStorage" });
    throw storageError;
  }

  const auxiliaryResults = await Promise.allSettled([
    authStorage.removeItem(`${authStorageKey}-code-verifier`),
    authStorage.removeItem(`${authStorageKey}-user`),
  ]);
  for (const result of auxiliaryResults) {
    if (result.status === "rejected") {
      captureException(asError(result.reason), {
        context: "signOut.localStorage.auxiliary",
      });
    }
  }
}

export async function signOut(): Promise<void> {
  resetAnalytics();

  let userId: string | null = null;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    userId = session?.user.id ?? null;
  } catch (error) {
    captureException(asError(error), { context: "signOut.getSession" });
  }
  try {
    await signOutCleanup({ userId });
  } catch (error) {
    captureException(asError(error), { context: "signOut.cleanup" });
  }

  const managesAutoRefresh = Platform.OS !== "web";
  if (managesAutoRefresh) {
    try {
      await supabase.auth.stopAutoRefresh();
    } catch (error) {
      captureException(asError(error), { context: "signOut.stopAutoRefresh" });
    }
  }

  try {
    let globalError: Error | null = null;
    try {
      const result = await supabase.auth.signOut();
      globalError = result.error;
    } catch (error) {
      globalError = asError(error);
    }

    if (!globalError) return;
    if (!isMissingSession(globalError)) {
      captureException(globalError, { context: "signOut.global" });
    }

    await purgePersistedSession();

    // The primary token is already gone, so auth-js skips its network call and
    // uses this local sign-out only to publish SIGNED_OUT to subscribers.
    let localError: Error | null = null;
    try {
      const result = await supabase.auth.signOut({ scope: "local" });
      localError = result.error;
    } catch (error) {
      localError = asError(error);
    }
    if (localError && !isMissingSession(localError)) {
      captureException(localError, { context: "signOut.local" });
      throw localError;
    }
  } finally {
    if (managesAutoRefresh) {
      try {
        await supabase.auth.startAutoRefresh();
      } catch (error) {
        captureException(asError(error), { context: "signOut.startAutoRefresh" });
      }
    }
  }
}
