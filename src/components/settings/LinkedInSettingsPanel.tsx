"use client";

import { useState, useEffect } from "react";
import { Badge, Button, Card, Input, Avatar } from "@/components/ui";
import { optionalLinkedInProfileUrlSchema } from "@/lib/alumni/linkedin-url";

export interface LinkedInConnection {
  status: "connected" | "disconnected" | "error";
  linkedInName: string | null;
  linkedInEmail: string | null;
  linkedInPhotoUrl: string | null;
  lastSyncAt: string | null;
  syncError: string | null;
}

export interface LinkedInSettingsPanelProps {
  linkedInUrl: string;
  onLinkedInUrlSave: (url: string) => Promise<void>;
  connection: LinkedInConnection | null;
  isConnected: boolean;
  connectionLoading: boolean;
  oauthAvailable: boolean;
  onConnect: () => void;
  onSync: () => Promise<{ message: string }>;
  onDisconnect: () => Promise<void>;
}

function LinkedInIcon() {
  return (
    <svg
      className="w-5 h-5 text-foreground"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) return "Never";
  return new Date(lastSyncAt).toLocaleString();
}

export function LinkedInSettingsPanel({
  linkedInUrl,
  onLinkedInUrlSave,
  connection,
  isConnected,
  connectionLoading,
  oauthAvailable,
  onConnect,
  onSync,
  onDisconnect,
}: LinkedInSettingsPanelProps) {
  const [urlValue, setUrlValue] = useState(linkedInUrl);
  const [urlSaving, setUrlSaving] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlSuccess, setUrlSuccess] = useState<string | null>(null);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Keep URL in sync with prop changes
  useEffect(() => {
    setUrlValue(linkedInUrl);
  }, [linkedInUrl]);

  // Auto-dismiss feedback after 5 seconds
  useEffect(() => {
    if (!urlSuccess) return;
    const timer = setTimeout(() => setUrlSuccess(null), 5000);
    return () => clearTimeout(timer);
  }, [urlSuccess]);

  useEffect(() => {
    if (!urlError) return;
    const timer = setTimeout(() => setUrlError(null), 5000);
    return () => clearTimeout(timer);
  }, [urlError]);

  useEffect(() => {
    if (!actionNotice) return;
    const timer = setTimeout(() => setActionNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [actionNotice]);

  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(timer);
  }, [actionError]);

  const handleUrlSave = async () => {
    setUrlError(null);
    setUrlSuccess(null);

    // Validate client-side
    const result = optionalLinkedInProfileUrlSchema.safeParse(urlValue);
    if (!result.success) {
      setUrlError(result.error.issues[0]?.message ?? "Invalid LinkedIn URL");
      return;
    }

    setUrlSaving(true);
    try {
      await onLinkedInUrlSave(result.data ?? "");
      setUrlSuccess("LinkedIn URL saved");
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "Failed to save URL");
    } finally {
      setUrlSaving(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const result = await onSync();
      setActionNotice(result.message);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect your LinkedIn account? Your manual profile URL will be kept.")) return;
    setIsDisconnecting(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await onDisconnect();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const canRetrySync = connection?.status === "error";

  // --- Loading skeleton ---
  if (connectionLoading) {
    return (
      <Card className="p-5">
        <div className="animate-pulse space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 bg-muted rounded" />
            <div className="h-5 bg-muted rounded w-48" />
          </div>
          <div className="h-4 bg-muted rounded w-2/3" />
          <div className="border-t border-border/60 pt-4 space-y-3">
            <div className="h-4 bg-muted rounded w-1/4" />
            <div className="h-9 bg-muted rounded w-full" />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="divide-y divide-border/60">
      {/* Section 1: Manual URL */}
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <LinkedInIcon />
          <p className="font-medium text-foreground">LinkedIn Profile URL</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Add your LinkedIn profile URL so others in your organization can find you.
        </p>
        <div className="max-w-md space-y-3">
          <Input
            label="Profile URL"
            type="url"
            placeholder="https://www.linkedin.com/in/yourname"
            value={urlValue}
            onChange={(e) => {
              setUrlValue(e.target.value);
              setUrlSuccess(null);
              setUrlError(null);
            }}
          />
          {urlError && (
            <p className="text-sm text-red-600 dark:text-red-400">{urlError}</p>
          )}
          {urlSuccess && (
            <p className="text-sm text-green-600 dark:text-green-400">{urlSuccess}</p>
          )}
          <Button
            size="sm"
            onClick={handleUrlSave}
            isLoading={urlSaving}
            disabled={urlSaving}
          >
            Save
          </Button>
        </div>
      </div>

      {/* Section 2: Connection status (connected) */}
      {isConnected && connection && (
        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <LinkedInIcon />
              <p className="font-medium text-foreground">Connected Account</p>
            </div>
            <Badge variant="success">Connected</Badge>
          </div>

          <div className="flex items-center gap-3">
            <Avatar
              src={connection.linkedInPhotoUrl}
              name={connection.linkedInName ?? undefined}
              size="md"
            />
            <div className="space-y-0.5 text-sm">
              {connection.linkedInName && (
                <p className="font-medium text-foreground">{connection.linkedInName}</p>
              )}
              {connection.linkedInEmail && (
                <p className="text-muted-foreground">{connection.linkedInEmail}</p>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Last synced: {formatLastSync(connection.lastSyncAt)}
          </p>

          {connection.syncError && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              {connection.syncError}
            </div>
          )}
        </div>
      )}

      {/* Section 3: Connect prompt (disconnected) */}
      {!isConnected && (
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <LinkedInIcon />
            <p className="font-medium text-foreground">LinkedIn Connection</p>
            {!oauthAvailable && <Badge variant="muted">Unavailable</Badge>}
          </div>

          {!oauthAvailable ? (
            <p className="text-sm text-muted-foreground">
              LinkedIn integration is not configured in this environment. You can still save your
              profile URL above to share it with your organization.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Connect your LinkedIn account to automatically sync your profile
                photo, name, and headline to your organization profile.
              </p>

              {connection?.status === "error" && (
                <div className="space-y-3">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    There was an error with your LinkedIn connection. Try syncing again first.
                    If it keeps failing, reconnect LinkedIn.
                  </p>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleSync}
                      isLoading={isSyncing}
                      disabled={isDisconnecting}
                    >
                      Sync Now
                    </Button>
                    <Button
                      size="sm"
                      onClick={onConnect}
                      disabled={isSyncing}
                    >
                      Reconnect LinkedIn
                    </Button>
                  </div>
                </div>
              )}

              {!canRetrySync && (
                <Button onClick={onConnect}>
                  Connect LinkedIn
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* Section 4: Actions (connected) */}
      {isConnected && (
        <div className="p-5 space-y-3">
          {actionNotice && (
            <div className="rounded-md bg-green-50 dark:bg-green-900/20 px-3 py-2 text-sm text-green-700 dark:text-green-300">
              {actionNotice}
            </div>
          )}
          {actionError && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {actionError}
            </div>
          )}
          {!oauthAvailable && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              LinkedIn integration is not configured in this environment. You can disconnect this
              account, but syncing is unavailable until configuration is restored.
            </div>
          )}
          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSync}
              isLoading={isSyncing}
              disabled={!oauthAvailable || isDisconnecting}
            >
              Sync Now
            </Button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isSyncing || isDisconnecting}
              className="text-sm text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
            >
              {isDisconnecting ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
