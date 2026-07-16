"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Wrench } from "lucide-react";
import DevEnterpriseModal from "./DevEnterpriseModal";
import { OrganizationBrowserModal, type Organization } from "./OrganizationBrowserModal";
import {
  formatBillingStatus,
  formatDate,
  Pill,
  shortId,
  StatusPill,
  stripeDashboardUrl,
} from "./dev-panel-shared";

interface DevPanelProps {
  organizationId: string;
  orgSlug: string;
  orgName: string;
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  gracePeriodEndsAt: string | null;
  userRole: string | null;
  memberCount?: number;
}

type ActionResult = { kind: "success" | "error"; message: string } | null;

function formatRole(role: string | null): string {
  if (!role) return "Developer admin";

  const labels: Record<string, string> = {
    admin: "Organization admin",
    active_member: "Member",
    member: "Member",
    alumni: "Alumni",
    viewer: "Alumni",
    parent: "Parent",
  };

  return labels[role] ?? role.replaceAll("_", " ");
}

export function DevPanel({
  organizationId,
  orgSlug,
  orgName,
  subscriptionStatus,
  stripeCustomerId,
  stripeSubscriptionId,
  currentPeriodEnd,
  gracePeriodEndsAt,
  userRole,
  memberCount,
}: DevPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ActionResult>(null);
  const [isSeedingMentors, setIsSeedingMentors] = useState(false);
  const [seedMentorsResult, setSeedMentorsResult] = useState<ActionResult>(null);
  const [showAllOrgs, setShowAllOrgs] = useState(false);
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(false);
  const [showEnterprises, setShowEnterprises] = useState(false);
  const [copyResult, setCopyResult] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const reloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
      }
    };
  }, []);

  const handleReconcile = async () => {
    setIsReconciling(true);
    setReconcileResult(null);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/reconcile-subscription`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setReconcileResult({
          kind: "error",
          message: data.error || "Billing sync could not be completed.",
        });
      } else {
        setReconcileResult({
          kind: "success",
          message: `Billing synced. Status: ${formatBillingStatus(data.status)}`,
        });
        reloadTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) window.location.reload();
        }, 1500);
      }
    } catch (err) {
      setReconcileResult({
        kind: "error",
        message: err instanceof Error ? err.message : "Billing sync failed.",
      });
    } finally {
      setIsReconciling(false);
    }
  };

  const handleSeedMentors = async () => {
    setIsSeedingMentors(true);
    setSeedMentorsResult(null);
    try {
      const res = await fetch("/api/dev-admin/seed-mentors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: organizationId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSeedMentorsResult({
          kind: "error",
          message: data.error || "Test mentors could not be created.",
        });
        return;
      }
      setSeedMentorsResult({
        kind: "success",
        message: `Created ${data.inserted ?? 0} test mentors; ${data.skipped ?? 0} already existed.`,
      });
    } catch (err) {
      setSeedMentorsResult({
        kind: "error",
        message: err instanceof Error ? err.message : "Test mentors could not be created.",
      });
    } finally {
      setIsSeedingMentors(false);
    }
  };

  const handleOpenBillingPortal = async () => {
    try {
      const res = await fetch("/api/stripe/billing-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        alert(data.error || "The billing portal could not be opened.");
        return;
      }
      window.open(data.url, "_blank");
    } catch (err) {
      alert(err instanceof Error ? err.message : "The billing portal could not be opened.");
    }
  };

  const fetchAllOrgs = async () => {
    setIsLoadingOrgs(true);
    try {
      const res = await fetch("/api/dev-admin/organizations");
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Organizations could not be loaded.");
        return;
      }
      setAllOrgs(data.organizations ?? []);
      setShowAllOrgs(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Organizations could not be loaded.");
    } finally {
      setIsLoadingOrgs(false);
    }
  };

  const copyOrganizationId = async () => {
    try {
      await navigator.clipboard.writeText(organizationId);
      setCopyResult("Organization ID copied");
    } catch {
      setCopyResult("Copy failed");
    }
  };

  const actionButtonClasses =
    "inline-flex items-center justify-center rounded-lg border border-border bg-muted px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-border disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="fixed bottom-4 left-4 z-50">
      <button
        type="button"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        aria-expanded={isExpanded}
        aria-controls="dev-panel-content"
        className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-org-primary)] px-3 py-2 text-sm font-medium text-[var(--color-org-primary-foreground)] shadow-lg transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--color-org-secondary)] focus:ring-offset-2"
      >
        <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
        Developer tools
        {isExpanded ? (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      {isExpanded && (
        <section
          id="dev-panel-content"
          aria-label="Developer tools"
          className="absolute bottom-14 left-0 w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl"
        >
          <header className="flex items-center justify-between border-b border-white/10 bg-[var(--color-org-primary)] px-4 py-3 text-[var(--color-org-primary-foreground)]">
            <div>
              <p className="text-sm font-semibold">Developer tools</p>
              <p className="mt-0.5 text-xs opacity-70">Only visible to developer admins</p>
            </div>
            <Pill className="border-white/20 bg-white/10 text-white">Internal</Pill>
          </header>

          <div className="max-h-[min(42rem,calc(100vh-6rem))] space-y-4 overflow-y-auto p-4">
            <section className="rounded-xl border border-border bg-muted/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Current organization
                  </p>
                  <p className="mt-1 truncate text-base font-semibold">{orgName}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">/{orgSlug}</p>
                </div>
                <Pill className="shrink-0 border-[var(--color-org-secondary)]/30 bg-[var(--color-org-secondary)]/10 text-[var(--color-org-secondary)]">
                  Current
                </Pill>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Your access</dt>
                  <dd className="mt-0.5 font-medium">{formatRole(userRole)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Members</dt>
                  <dd className="mt-0.5 font-medium">{memberCount ?? "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Organization ID</dt>
                  <dd className="mt-0.5 select-all break-all font-mono text-[11px] text-muted-foreground">
                    {organizationId}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Plan & billing
                  </p>
                  <p className="mt-1 text-sm font-semibold">
                    {formatBillingStatus(subscriptionStatus)}
                  </p>
                </div>
                <StatusPill status={subscriptionStatus} />
              </div>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Billing period ends</dt>
                  <dd className="text-right font-medium">{formatDate(currentPeriodEnd)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Access grace period ends</dt>
                  <dd className="text-right font-medium">{formatDate(gracePeriodEndsAt)}</dd>
                </div>
              </dl>
              {(stripeCustomerId || stripeSubscriptionId) && (
                <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
                  {stripeCustomerId && (
                    <a
                      href={stripeDashboardUrl("customers", stripeCustomerId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-3 text-[var(--color-org-primary)] hover:underline"
                    >
                      <span>Stripe customer</span>
                      <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                        {shortId(stripeCustomerId)}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </span>
                    </a>
                  )}
                  {stripeSubscriptionId && (
                    <a
                      href={stripeDashboardUrl("subscriptions", stripeSubscriptionId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-3 text-[var(--color-org-primary)] hover:underline"
                    >
                      <span>Stripe subscription</span>
                      <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                        {shortId(stripeSubscriptionId)}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </span>
                    </a>
                  )}
                </div>
              )}
            </section>

            <section>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Actions
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleReconcile}
                  disabled={isReconciling}
                  className={actionButtonClasses}
                >
                  {isReconciling ? "Syncing billing…" : "Sync billing"}
                </button>
                <button
                  type="button"
                  onClick={handleOpenBillingPortal}
                  disabled={!stripeCustomerId}
                  className={actionButtonClasses}
                >
                  Open billing portal
                </button>
                <button
                  type="button"
                  onClick={fetchAllOrgs}
                  disabled={isLoadingOrgs}
                  className={`${actionButtonClasses} border-[var(--color-org-secondary)]/30 bg-[var(--color-org-secondary)]/10`}
                >
                  {isLoadingOrgs ? "Loading organizations…" : "Browse organizations"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEnterprises(true)}
                  className={`${actionButtonClasses} border-[var(--color-org-primary)]/20 bg-[var(--color-org-primary)]/10`}
                >
                  Enterprise accounts
                </button>
                <button type="button" onClick={copyOrganizationId} className={actionButtonClasses}>
                  Copy organization ID
                </button>
                <button
                  type="button"
                  onClick={handleSeedMentors}
                  disabled={isSeedingMentors}
                  className={actionButtonClasses}
                >
                  {isSeedingMentors ? "Creating test mentors…" : "Create 5 test mentors"}
                </button>
              </div>
              {copyResult && <p className="mt-2 text-xs text-muted-foreground">{copyResult}</p>}
              {reconcileResult && (
                <p
                  className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
                    reconcileResult.kind === "error"
                      ? "border-red-400/20 bg-red-500/10 text-red-700 dark:text-red-300"
                      : "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  {reconcileResult.message}
                </p>
              )}
              {seedMentorsResult && (
                <p
                  className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
                    seedMentorsResult.kind === "error"
                      ? "border-red-400/20 bg-red-500/10 text-red-700 dark:text-red-300"
                      : "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  {seedMentorsResult.message}
                </p>
              )}
            </section>
          </div>
        </section>
      )}

      <DevEnterpriseModal isOpen={showEnterprises} onClose={() => setShowEnterprises(false)} />

      <OrganizationBrowserModal
        isOpen={showAllOrgs}
        onClose={() => setShowAllOrgs(false)}
        organizations={allOrgs}
      />
    </div>
  );
}
