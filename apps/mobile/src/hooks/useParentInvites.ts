import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";
import * as sentry from "@/lib/analytics/sentry";
import type { ParentInviteRecord } from "@/lib/parents";

async function parseApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || "Request failed");
  }
  return data as T;
}

interface UseParentInvitesReturn {
  invites: ParentInviteRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createInvite: (expiresAt?: string | null) => Promise<{ success: boolean; invite?: ParentInviteRecord; error?: string }>;
  revokeInvite: (inviteId: string) => Promise<{ success: boolean; error?: string }>;
  deleteInvite: (inviteId: string) => Promise<{ success: boolean; error?: string }>;
}

export function useParentInvites(orgId: string | null, enabled: boolean): UseParentInvitesReturn {
  const isMountedRef = useRef(true);
  const [invites, setInvites] = useState<ParentInviteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    if (!orgId || !enabled) {
      if (isMountedRef.current) {
        setInvites([]);
        setLoading(false);
        setError(null);
      }
      return;
    }

    try {
      setLoading(true);
      const response = await fetchWithAuth(`/api/organizations/${orgId}/parents/invite`, {
        method: "GET",
      });
      const data = await parseApiResponse<{ invites: ParentInviteRecord[] }>(response);

      if (isMountedRef.current) {
        setInvites(data.invites ?? []);
        setError(null);
      }
    } catch (e) {
      sentry.captureException(e as Error, { context: "useParentInvites.fetchInvites", orgId });
      if (isMountedRef.current) {
        setError((e as Error).message);
        setInvites([]);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId, enabled]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchInvites();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchInvites]);

  useEffect(() => {
    if (!orgId || !enabled) return;

    const channel = supabase
      .channel(`parent-invites:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "parent_invites",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchInvites();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, enabled, fetchInvites]);

  const createInvite = useCallback(
    async (expiresAt?: string | null) => {
      if (!orgId) return { success: false, error: "Organization not loaded" };

      try {
        const response = await fetchWithAuth(`/api/organizations/${orgId}/parents/invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(expiresAt ? { expires_at: expiresAt } : {}),
        });

        const data = await parseApiResponse<{ invite: ParentInviteRecord }>(response);
        if (isMountedRef.current) {
          setInvites((prev) => {
            const next = [data.invite, ...prev.filter((invite) => invite.id !== data.invite.id)];
            return next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          });
        }
        return { success: true, invite: data.invite };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useParentInvites.createInvite", orgId });
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  const revokeInvite = useCallback(
    async (inviteId: string) => {
      if (!orgId) return { success: false, error: "Organization not loaded" };

      try {
        const response = await fetchWithAuth(`/api/organizations/${orgId}/parents/invite/${inviteId}`, {
          method: "PATCH",
        });
        await parseApiResponse<{ success: boolean }>(response);
        if (isMountedRef.current) {
          setInvites((prev) =>
            prev.map((invite) =>
              invite.id === inviteId ? { ...invite, status: "revoked" } : invite
            )
          );
        }
        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useParentInvites.revokeInvite", orgId, inviteId });
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  const deleteInvite = useCallback(
    async (inviteId: string) => {
      if (!orgId) return { success: false, error: "Organization not loaded" };

      try {
        const response = await fetchWithAuth(`/api/organizations/${orgId}/parents/invite/${inviteId}`, {
          method: "DELETE",
        });
        await parseApiResponse<{ success: boolean }>(response);
        if (isMountedRef.current) {
          setInvites((prev) => prev.filter((invite) => invite.id !== inviteId));
        }
        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useParentInvites.deleteInvite", orgId, inviteId });
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  return {
    invites,
    loading,
    error,
    refetch: fetchInvites,
    createInvite,
    revokeInvite,
    deleteInvite,
  };
}
