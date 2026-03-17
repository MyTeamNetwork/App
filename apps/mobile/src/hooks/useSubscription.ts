import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";
import type { AlumniBucket } from "@teammeet/types";
import * as sentry from "@/lib/analytics/sentry";

export interface SubscriptionData {
  bucket: AlumniBucket;
  alumniLimit: number | null;
  alumniCount: number;
  remaining: number | null;
  status: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  currentPeriodEnd: string | null;
}

interface UseSubscriptionReturn {
  subscription: SubscriptionData | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useSubscription(organizationId: string | null): UseSubscriptionReturn {
  const isMountedRef = useRef(true);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscription = useCallback(async () => {
    if (!organizationId) {
      setSubscription(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetchWithAuth(
        `/api/organizations/${organizationId}/subscription`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch subscription (${response.status})`);
      }

      const data = await response.json();

      if (isMountedRef.current) {
        setSubscription(data);
        setError(null);
      }
    } catch (e) {
      sentry.captureException(e as Error, { context: "useSubscription.fetchSubscription" });
      if (isMountedRef.current) {
        setError((e as Error).message);
        setSubscription(null);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [organizationId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchSubscription();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchSubscription]);

  // Realtime subscription for organization_subscriptions changes
  useEffect(() => {
    if (!organizationId) return;

    const channel = supabase
      .channel(`subscription:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "organization_subscriptions",
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          fetchSubscription();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, fetchSubscription]);

  // Also listen to alumni count changes (user_organization_roles with alumni role)
  useEffect(() => {
    if (!organizationId) return;

    const channel = supabase
      .channel(`alumni-count:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_organization_roles",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          // Only refetch if role involves alumni (for quota updates)
          const newData = payload.new as { role?: string } | null;
          const oldData = payload.old as { role?: string } | null;
          if (newData?.role === "alumni" || oldData?.role === "alumni") {
            fetchSubscription();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, fetchSubscription]);

  return { subscription, loading, error, refetch: fetchSubscription };
}
