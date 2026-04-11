import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";
import * as sentry from "@/lib/analytics/sentry";
import { useRequestTracker } from "@/hooks/useRequestTracker";
import type { ParentFormValues, ParentRecord } from "@/lib/parents";
import { buildParentPayload } from "@/lib/parents";

const STALE_TIME_MS = 30_000;
const DEFAULT_LIMIT = 200;

async function parseApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || "Request failed");
  }
  return data as T;
}

interface ParentsListResponse {
  parents: ParentRecord[];
  total?: number | null;
  limit?: number | null;
  offset?: number | null;
}

export async function fetchParentsDirectory(
  fetchPage: (offset: number, limit: number) => Promise<ParentsListResponse>,
  options?: {
    limit?: number;
    isCurrentRequest?: () => boolean;
  }
): Promise<ParentRecord[] | null> {
  const pageSize = options?.limit ?? DEFAULT_LIMIT;
  const isCurrentRequest = options?.isCurrentRequest ?? (() => true);
  const allParents: ParentRecord[] = [];
  let offset = 0;
  let total: number | null = null;

  while (true) {
    const data = await fetchPage(offset, pageSize);

    if (!isCurrentRequest()) {
      return null;
    }

    const pageParents = data.parents ?? [];
    const pageLimit = data.limit ?? pageSize;
    const pageOffset = data.offset ?? offset;
    const nextOffset = pageOffset + pageParents.length;

    allParents.push(...pageParents);
    total = typeof data.total === "number" ? data.total : total;

    if (pageParents.length === 0) {
      break;
    }

    if (total !== null) {
      if (nextOffset >= total) {
        break;
      }
    } else if (pageParents.length < pageLimit) {
      break;
    }

    offset = nextOffset;
  }

  return allParents;
}

export async function fetchParentDetail(orgId: string, parentId: string): Promise<ParentRecord> {
  const response = await fetchWithAuth(`/api/organizations/${orgId}/parents/${parentId}`, {
    method: "GET",
  });
  const data = await parseApiResponse<{ parent: ParentRecord }>(response);
  return data.parent;
}

interface UseParentsReturn {
  parents: ParentRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
  createParent: (values: ParentFormValues) => Promise<{ success: boolean; parent?: ParentRecord; error?: string }>;
  updateParent: (parentId: string, values: ParentFormValues) => Promise<{ success: boolean; parent?: ParentRecord; error?: string }>;
  deleteParent: (parentId: string) => Promise<{ success: boolean; error?: string }>;
}

export function useParents(orgId: string | null, enabled: boolean): UseParentsReturn {
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef(0);
  const { beginRequest, invalidateRequests, isCurrentRequest } = useRequestTracker();
  const [parents, setParents] = useState<ParentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    lastFetchTimeRef.current = 0;
    invalidateRequests();
  }, [orgId, enabled, invalidateRequests]);

  const fetchParents = useCallback(async () => {
    const requestId = beginRequest();

    if (!orgId || !enabled) {
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setParents([]);
        setLoading(false);
        setError(null);
      }
      return;
    }

    try {
      setLoading(true);
      const allParents = await fetchParentsDirectory(
        async (offset, limit) => {
          const response = await fetchWithAuth(
            `/api/organizations/${orgId}/parents?limit=${limit}&offset=${offset}`,
            { method: "GET" }
          );
          return parseApiResponse<ParentsListResponse>(response);
        },
        { limit: DEFAULT_LIMIT, isCurrentRequest: () => isCurrentRequest(requestId) }
      );

      if (allParents === null) {
        return;
      }

      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setParents(allParents);
        setError(null);
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      sentry.captureException(e as Error, { context: "useParents.fetchParents", orgId });
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setError((e as Error).message);
        setParents([]);
      }
    } finally {
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setLoading(false);
      }
    }
  }, [orgId, enabled, beginRequest, isCurrentRequest]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchParents();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchParents]);

  useEffect(() => {
    if (!orgId || !enabled) return;

    const channel = supabase
      .channel(`parents:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "parents",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchParents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, enabled, fetchParents]);

  const createParent = useCallback(
    async (values: ParentFormValues) => {
      if (!orgId) return { success: false, error: "Organization not loaded" };

      try {
        const response = await fetchWithAuth(`/api/organizations/${orgId}/parents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildParentPayload(values)),
        });

        const data = await parseApiResponse<{ parent: ParentRecord }>(response);
        if (isMountedRef.current) {
          setParents((prev) =>
            [...prev, data.parent].sort((a, b) =>
              `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
            )
          );
        }
        return { success: true, parent: data.parent };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useParents.createParent", orgId });
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  const updateParent = useCallback(
    async (parentId: string, values: ParentFormValues) => {
      if (!orgId) return { success: false, error: "Organization not loaded" };

      try {
        const response = await fetchWithAuth(`/api/organizations/${orgId}/parents/${parentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildParentPayload(values)),
        });

        const data = await parseApiResponse<{ parent: ParentRecord }>(response);
        if (isMountedRef.current) {
          setParents((prev) =>
            prev.map((parent) => (parent.id === parentId ? data.parent : parent))
          );
        }
        return { success: true, parent: data.parent };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useParents.updateParent", orgId, parentId });
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  const deleteParent = useCallback(
    async (parentId: string) => {
      if (!orgId) return { success: false, error: "Organization not loaded" };

      try {
        const response = await fetchWithAuth(`/api/organizations/${orgId}/parents/${parentId}`, {
          method: "DELETE",
        });

        await parseApiResponse<{ success: boolean }>(response);
        if (isMountedRef.current) {
          setParents((prev) => prev.filter((parent) => parent.id !== parentId));
        }
        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useParents.deleteParent", orgId, parentId });
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchParents();
    }
  }, [fetchParents]);

  return {
    parents,
    loading,
    error,
    refetch: fetchParents,
    refetchIfStale,
    createParent,
    updateParent,
    deleteParent,
  };
}
