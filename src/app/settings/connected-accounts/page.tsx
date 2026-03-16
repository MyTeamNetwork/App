"use client";

import { Suspense } from "react";
import { Card } from "@/components/ui";
import { LinkedInSettingsPanel } from "@/components/settings/LinkedInSettingsPanel";
import { useLinkedIn } from "@/hooks/useLinkedIn";

export default function ConnectedAccountsPage() {
  return (
    <Suspense fallback={<ConnectedAccountsLoading />}>
      <ConnectedAccountsContent />
    </Suspense>
  );
}

function ConnectedAccountsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-bold text-foreground">Connected Accounts</h1>
        <p className="text-muted-foreground">
          Manage your LinkedIn connection and other linked accounts.
        </p>
      </div>
      <Card className="p-5 text-muted-foreground text-sm">Loading…</Card>
    </div>
  );
}

function ConnectedAccountsContent() {
  const linkedIn = useLinkedIn();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-bold text-foreground">Connected Accounts</h1>
        <p className="text-muted-foreground">
          Manage your LinkedIn connection and other linked accounts.
        </p>
      </div>

      <LinkedInSettingsPanel
        linkedInUrl={linkedIn.linkedInUrl}
        onLinkedInUrlSave={linkedIn.onLinkedInUrlSave}
        connection={linkedIn.connection}
        isConnected={linkedIn.isConnected}
        connectionLoading={linkedIn.connectionLoading}
        oauthAvailable={linkedIn.oauthAvailable}
        onConnect={linkedIn.onConnect}
        onSync={linkedIn.onSync}
        onDisconnect={linkedIn.onDisconnect}
      />

      <Card className="p-5 space-y-3">
        <p className="font-medium text-foreground">Google Calendar Sync</p>
        <p className="text-sm text-muted-foreground">
          Google Calendar sync is managed per-organization from the Calendar settings
          within each org you belong to.
        </p>
      </Card>
    </div>
  );
}
