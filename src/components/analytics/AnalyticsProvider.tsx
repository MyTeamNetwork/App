"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { extractFeature } from "@/lib/analytics/client";
import {
  trackBehavioralEvent,
  getAnalyticsSessionMetadata,
  getConsentState,
  setConsentState,
} from "@/lib/analytics/events";
import { useOrgAnalytics } from "./OrgAnalyticsContext";

interface AnalyticsProviderProps {
  children: ReactNode;
}

/** Non-org route prefixes that should never be treated as org slugs. */
const NON_ORG_PREFIXES = ["app", "auth", "settings", "privacy", "terms", "api"];

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  const pathname = usePathname();
  const orgAnalytics = useOrgAnalytics();
  const [authReady, setAuthReady] = useState(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  const currentRouteKeyRef = useRef<string | null>(null);
  const trackedRouteKeyRef = useRef<string | null>(null);
  const trackedRouteRef = useRef<string | null>(null);
  const trackedRouteStartRef = useRef<number | null>(null);
  const trackedRouteOrgIdRef = useRef<string | null>(null);
  const lastAppOpenSessionRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active) return;
      setAuthUserId(user?.id ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setAuthUserId(session?.user?.id ?? null);
      setAuthReady(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncRoute() {
      const segments = pathname.replace(/^\//, "").split("/");
      const maybeSlug = segments[0];
      const isOrgRoute = !!maybeSlug && !NON_ORG_PREFIXES.includes(maybeSlug);
      const orgId = isOrgRoute ? orgAnalytics?.orgId ?? null : null;
      const routeKey = `${orgId ?? "non-org"}:${pathname}`;
      const routeChanged = currentRouteKeyRef.current !== routeKey;

      if (
        routeChanged &&
        trackedRouteRef.current &&
        trackedRouteStartRef.current &&
        trackedRouteOrgIdRef.current
      ) {
        const durationMs = Date.now() - trackedRouteStartRef.current;
        const previousRoute = trackedRouteRef.current;
        const previousFeature = extractFeature(previousRoute);
        const dwellBucket =
          durationMs <= 5000 ? "0-5s" :
          durationMs <= 15000 ? "6-15s" :
          durationMs <= 30000 ? "16-30s" :
          durationMs <= 60000 ? "31-60s" :
          durationMs <= 180000 ? "61-180s" :
          "180s+";

        trackBehavioralEvent("page_dwell_bucket", {
          screen: previousFeature,
          feature: previousFeature,
          dwell_bucket: dwellBucket,
        }, trackedRouteOrgIdRef.current);

        trackedRouteKeyRef.current = null;
        trackedRouteRef.current = null;
        trackedRouteStartRef.current = null;
        trackedRouteOrgIdRef.current = null;
      }

      currentRouteKeyRef.current = routeKey;

      if (!isOrgRoute || !orgId) {
        return;
      }

      let consentState = getConsentState(orgId);

      if (consentState === "unknown") {
        if (!authReady || !authUserId) {
          return;
        }

        const supabase = createClient();

        const { data } = await supabase
          .from("analytics_consent")
          .select("consent_state")
          .eq("org_id", orgId)
          .maybeSingle();

        consentState = data?.consent_state ?? "unknown";
        setConsentState(orgId, consentState);
      }

      if (cancelled) return;

      if (consentState !== "opted_in") {
        return;
      }

      if (trackedRouteKeyRef.current === routeKey) {
        return;
      }

      const { session_id } = getAnalyticsSessionMetadata();
      if (session_id && lastAppOpenSessionRef.current !== session_id) {
        lastAppOpenSessionRef.current = session_id;
        trackBehavioralEvent("app_open", {}, orgId);
      }

      const feature = extractFeature(pathname);
      trackBehavioralEvent("route_view", {
        screen: feature,
        feature,
      }, orgId);

      trackedRouteKeyRef.current = routeKey;
      trackedRouteRef.current = pathname;
      trackedRouteStartRef.current = Date.now();
      trackedRouteOrgIdRef.current = orgId;
    }

    syncRoute();

    return () => {
      cancelled = true;
    };
  }, [authReady, authUserId, orgAnalytics, pathname]);

  return <>{children}</>;
}
