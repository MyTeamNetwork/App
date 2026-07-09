import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/web-api";
import * as sentry from "@/lib/analytics/sentry";

interface UseNetworkingConsentReturn {
  optedIn: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  noProfile: boolean;
  refetch: () => Promise<void>;
  setOptedIn: (next: boolean) => Promise<{ success: boolean; error?: string; noProfile?: boolean }>;
}

// Per-organization "open to networking" consent — mirrors the web toggle at
// /[orgSlug]/connections (NetworkingConsentToggle). Reads/writes
// GET|PATCH /api/organizations/[organizationId]/connections/networking-consent.
export function useNetworkingConsent(orgId: string | null): UseNetworkingConsentReturn {
  const isMountedRef = useRef(true);
  const [optedIn, setOptedInState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noProfile, setNoProfile] = useState(false);

  const endpoint = orgId
    ? `/api/organizations/${encodeURIComponent(orgId)}/connections/networking-consent`
    : null;

  const refetch = useCallback(async () => {
    if (!endpoint) {
      if (isMountedRef.current) {
        setOptedInState(false);
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetchWithAuth(endpoint, { method: "GET" });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Failed to load networking setting.");
      }

      if (isMountedRef.current) {
        setOptedInState(Boolean(data?.open_to_networking));
      }
    } catch (e) {
      sentry.captureException(e as Error, {
        context: "useNetworkingConsent.refetch",
        orgId: orgId ?? undefined,
      });
      if (isMountedRef.current) {
        setError((e as Error).message);
        setOptedInState(false);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [endpoint, orgId]);

  useEffect(() => {
    isMountedRef.current = true;
    refetch();

    return () => {
      isMountedRef.current = false;
    };
  }, [refetch]);

  const setOptedIn = useCallback(
    async (next: boolean): Promise<{ success: boolean; error?: string; noProfile?: boolean }> => {
      if (!endpoint) {
        return { success: false, error: "Organization not loaded" };
      }

      const previous = optedIn;
      setOptedInState(next); // optimistic
      setSaving(true);
      setError(null);
      setNoProfile(false);

      try {
        const response = await fetchWithAuth(endpoint, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ open_to_networking: next }),
        });
        const data = await response.json().catch(() => null);

        if (response.status === 409) {
          if (isMountedRef.current) {
            setOptedInState(previous);
            setNoProfile(true);
          }
          return { success: false, noProfile: true };
        }

        if (!response.ok) {
          throw new Error(data?.error || "Failed to update networking setting.");
        }

        if (isMountedRef.current) {
          setOptedInState(Boolean(data?.open_to_networking ?? next));
        }

        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, {
          context: "useNetworkingConsent.setOptedIn",
          orgId: orgId ?? undefined,
        });
        if (isMountedRef.current) {
          setOptedInState(previous); // rollback
          setError((e as Error).message);
        }
        return { success: false, error: (e as Error).message };
      } finally {
        if (isMountedRef.current) {
          setSaving(false);
        }
      }
    },
    [endpoint, optedIn, orgId]
  );

  return {
    optedIn,
    loading,
    saving,
    error,
    noProfile,
    refetch,
    setOptedIn,
  };
}
