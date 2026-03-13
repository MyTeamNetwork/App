"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import {
  getLinkedInIntegrationDisabledMessage,
  LINKEDIN_INTEGRATION_DISABLED_CODE,
} from "@/lib/linkedin/config";
import { Card } from "@/components/ui";
import {
  LinkedInSettingsPanel,
  type LinkedInConnection,
} from "@/components/settings/LinkedInSettingsPanel";

interface LinkedInStatusResponse {
  linkedin_url: string | null;
  connection: LinkedInConnection | null;
  integration?: {
    oauthAvailable: boolean;
    reason: "not_configured" | null;
  };
}

export default function LinkedInSettingsPage() {
  return (
    <Suspense fallback={<LinkedInSettingsLoading />}>
      <LinkedInSettingsContent />
    </Suspense>
  );
}

function LinkedInSettingsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-bold text-foreground">LinkedIn</h1>
        <p className="text-muted-foreground">
          Manage your LinkedIn profile URL and connection.
        </p>
      </div>
      <Card className="p-5 text-muted-foreground text-sm">Loading…</Card>
    </div>
  );
}

function LinkedInSettingsContent() {
  const [linkedInUrl, setLinkedInUrl] = useState("");
  const [connection, setConnection] = useState<LinkedInConnection | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [oauthAvailable, setOauthAvailable] = useState(true);
  const [oauthSuccess, setOauthSuccess] = useState<string | null>(null);
  const [oauthWarning, setOauthWarning] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Read OAuth callback query params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedinParam = params.get("linkedin");
    const warningMessage = params.get("warning_message");
    const errorParam = params.get("error");
    const errorMessage = params.get("error_message");

    if (warningMessage) {
      setOauthWarning(warningMessage);
    } else if (linkedinParam === "connected") {
      setOauthSuccess("Your LinkedIn account has been connected successfully.");
    } else if (errorParam) {
      const fallbackMessage = errorParam === LINKEDIN_INTEGRATION_DISABLED_CODE
        ? getLinkedInIntegrationDisabledMessage()
        : "An error occurred connecting your LinkedIn account.";
      if (errorParam === LINKEDIN_INTEGRATION_DISABLED_CODE) {
        setOauthAvailable(false);
      }
      setOauthError(errorMessage || fallbackMessage);
    }

    // Clean stale query params from URL
    if (linkedinParam || warningMessage || errorParam) {
      const url = new URL(window.location.href);
      url.searchParams.delete("linkedin");
      url.searchParams.delete("warning");
      url.searchParams.delete("warning_message");
      url.searchParams.delete("error");
      url.searchParams.delete("error_message");
      window.history.replaceState({}, "", url.pathname);
    }
  }, []);

  // Auto-dismiss OAuth feedback after 8 seconds
  useEffect(() => {
    if (!oauthSuccess) return;
    const timer = setTimeout(() => setOauthSuccess(null), 8000);
    return () => clearTimeout(timer);
  }, [oauthSuccess]);

  useEffect(() => {
    if (!oauthError) return;
    const timer = setTimeout(() => setOauthError(null), 8000);
    return () => clearTimeout(timer);
  }, [oauthError]);

  useEffect(() => {
    if (!oauthWarning) return;
    const timer = setTimeout(() => setOauthWarning(null), 8000);
    return () => clearTimeout(timer);
  }, [oauthWarning]);

  const refreshStatus = useCallback(async () => {
    setConnectionLoading(true);
    setStatusError(null);
    try {
      const res = await fetch("/api/user/linkedin/status");
      if (res.status === 401) {
        return;
      }
      if (!res.ok) {
        setStatusError("Unable to load your LinkedIn settings right now.");
        return;
      }
      const data = await res.json() as LinkedInStatusResponse;
      setLinkedInUrl(data.linkedin_url ?? "");
      setConnection(data.connection ?? null);
      setOauthAvailable(data.integration?.oauthAvailable ?? true);
    } catch {
      setStatusError("Unable to load your LinkedIn settings right now.");
    } finally {
      setConnectionLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const isConnected = connection?.status === "connected";

  const handleUrlSave = useCallback(async (url: string) => {
    const res = await fetch("/api/user/linkedin/url", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkedin_url: url }),
    });

    if (res.status === 404) {
      throw new Error("This feature is not yet available");
    }
    if (res.status === 401) {
      throw new Error("You need to sign in again");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Failed to save URL");
    }

    setLinkedInUrl(url);
  }, []);

  const handleConnect = useCallback(async () => {
    try {
      const res = await fetch("/api/user/linkedin/connect", {
        method: "POST",
      });

      if (res.status === 404) {
        setOauthError("LinkedIn integration is not yet available.");
        return;
      }
      if (res.status === 401) {
        setOauthError("You need to sign in again.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 503 || data.code === LINKEDIN_INTEGRATION_DISABLED_CODE) {
          setOauthAvailable(false);
        }
        setOauthError(data.error ?? "Failed to start LinkedIn connection.");
        return;
      }

      const data = await res.json();
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    } catch {
      setOauthError("Unable to reach the server. Please try again.");
    }
  }, []);

  const handleSync = useCallback(async () => {
    const res = await fetch("/api/user/linkedin/sync", {
      method: "POST",
    });

    if (res.status === 404) {
      throw new Error("This feature is not yet available");
    }
    if (res.status === 401) {
      throw new Error("You need to sign in again");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      await refreshStatus();
      throw new Error(data.error ?? "Failed to sync");
    }

    const data = await res.json();
    await refreshStatus();

    return { message: data.message ?? "LinkedIn profile synced" };
  }, [refreshStatus]);

  const handleDisconnect = useCallback(async () => {
    const res = await fetch("/api/user/linkedin/disconnect", {
      method: "POST",
    });

    if (res.status === 404) {
      throw new Error("This feature is not yet available");
    }
    if (res.status === 401) {
      throw new Error("You need to sign in again");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Failed to disconnect");
    }

    setConnection(null);
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-bold text-foreground">LinkedIn</h1>
        <p className="text-muted-foreground">
          Manage your LinkedIn profile URL and connection.
        </p>
      </div>

      {oauthSuccess && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-700 dark:text-green-300">
          {oauthSuccess}
        </div>
      )}
      {oauthError && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {oauthError}
        </div>
      )}
      {oauthWarning && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          {oauthWarning}
        </div>
      )}
      {statusError && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {statusError}
        </div>
      )}

      <LinkedInSettingsPanel
        linkedInUrl={linkedInUrl}
        onLinkedInUrlSave={handleUrlSave}
        connection={connection}
        isConnected={isConnected}
        connectionLoading={connectionLoading}
        oauthAvailable={oauthAvailable}
        onConnect={handleConnect}
        onSync={handleSync}
        onDisconnect={handleDisconnect}
      />
    </div>
  );
}
