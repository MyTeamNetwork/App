"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Search, Wrench, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import DevEnterpriseModal from "./DevEnterpriseModal";

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

interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  member_count: number;
  enterprise_id: string | null;
  enterprise_name: string | null;
  enterprise_slug: string | null;
  stripe_connect_account_id: string | null;
  subscription: {
    status: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    current_period_end: string | null;
  } | null;
}

type OrganizationFilter = "all" | "enterprise" | "paid" | "no-plan";
type ActionResult = { kind: "success" | "error"; message: string } | null;

const ORGANIZATION_FILTERS: Array<{
  value: OrganizationFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "enterprise", label: "Enterprise" },
  { value: "paid", label: "Paid / billing" },
  { value: "no-plan", label: "No plan" },
];

function formatDate(value: string | null): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatBillingStatus(status: string | null): string {
  if (!status) return "No plan";

  const labels: Record<string, string> = {
    active: "Active",
    trialing: "Trial",
    pending: "Pending",
    past_due: "Past due",
    unpaid: "Unpaid",
    canceling: "Ends soon",
    canceled: "Canceled",
  };

  return labels[status] ?? status.replaceAll("_", " ");
}

function billingStatusClasses(status: string | null): string {
  switch (status) {
    case "active":
    case "trialing":
      return "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "past_due":
    case "unpaid":
      return "border-red-400/20 bg-red-500/10 text-red-700 dark:text-red-300";
    case "pending":
    case "canceling":
      return "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

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

function shortId(value: string): string {
  if (value.length <= 22) return value;
  return `${value.slice(0, 12)}…${value.slice(-6)}`;
}

function hasBillingRecord(org: Organization): boolean {
  return org.subscription !== null;
}

function isEnterpriseOrganization(org: Organization): boolean {
  return Boolean(org.enterprise_id || org.enterprise_name);
}

function matchesOrganizationFilter(org: Organization, filter: OrganizationFilter): boolean {
  switch (filter) {
    case "enterprise":
      return isEnterpriseOrganization(org);
    case "paid":
      return hasBillingRecord(org);
    case "no-plan":
      return !hasBillingRecord(org);
    default:
      return true;
  }
}

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}

function StatusPill({ status }: { status: string | null }) {
  return <Pill className={billingStatusClasses(status)}>{formatBillingStatus(status)}</Pill>;
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
  const [organizationFilter, setOrganizationFilter] = useState<OrganizationFilter>("all");
  const [organizationSearch, setOrganizationSearch] = useState("");
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
      setOrganizationFilter("all");
      setOrganizationSearch("");
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
                      href={`https://dashboard.stripe.com/customers/${stripeCustomerId}`}
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
                      href={`https://dashboard.stripe.com/subscriptions/${stripeSubscriptionId}`}
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
        filter={organizationFilter}
        onFilterChange={setOrganizationFilter}
        search={organizationSearch}
        onSearchChange={setOrganizationSearch}
      />
    </div>
  );
}

function OrganizationBrowserModal({
  isOpen,
  onClose,
  organizations,
  filter,
  onFilterChange,
  search,
  onSearchChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  organizations: Organization[];
  filter: OrganizationFilter;
  onFilterChange: (filter: OrganizationFilter) => void;
  search: string;
  onSearchChange: (search: string) => void;
}) {
  const filteredOrganizations = useMemo(() => {
    const query = search.trim().toLowerCase();

    return organizations
      .filter((org) => matchesOrganizationFilter(org, filter))
      .filter((org) => {
        if (!query) return true;
        return (
          org.name.toLowerCase().includes(query) ||
          org.slug.toLowerCase().includes(query) ||
          org.enterprise_name?.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filter, organizations, search]);

  const counts: Record<OrganizationFilter, number> = {
    all: organizations.length,
    enterprise: organizations.filter(isEnterpriseOrganization).length,
    paid: organizations.filter(hasBillingRecord).length,
    "no-plan": organizations.filter((org) => !hasBillingRecord(org)).length,
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      ariaLabel="Organizations"
      size="2xl"
      noPadding
      hideCloseButton
      className="max-w-6xl overflow-hidden"
    >
      <div className="flex max-h-[calc(100vh-2rem)] flex-col">
        <header className="border-b border-border bg-muted/40 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Account review
              </p>
              <h2 className="mt-1 text-xl font-semibold">Organizations</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Find enterprise and paid organizations without digging through raw fields.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close organizations"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ORGANIZATION_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onFilterChange(option.value)}
                aria-pressed={filter === option.value}
                className={`rounded-xl border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                  filter === option.value
                    ? "border-[var(--color-org-primary)] bg-[var(--color-org-primary)]/10"
                    : "border-border bg-card hover:bg-muted"
                }`}
              >
                <span className="block text-xs text-muted-foreground">{option.label}</span>
                <span className="mt-1 block text-lg font-semibold">{counts[option.value]}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="relative block min-w-0 flex-1 lg:max-w-sm">
              <span className="sr-only">Search organizations</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search name, slug, or enterprise"
                className="input pl-9 text-sm"
              />
            </label>
            <div
              className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
              role="tablist"
              aria-label="Organization filters"
            >
              {ORGANIZATION_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={filter === option.value}
                  onClick={() => onFilterChange(option.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                    filter === option.value
                      ? "bg-[var(--color-org-primary)] text-[var(--color-org-primary-foreground)]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-6">
          {filteredOrganizations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No organizations match this view.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-[760px] w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Organization</th>
                    <th className="px-4 py-3 font-medium">Account type</th>
                    <th className="px-4 py-3 font-medium">Members</th>
                    <th className="px-4 py-3 font-medium">Billing</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 font-medium">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredOrganizations.map((org) => (
                    <OrganizationRow key={org.id} organization={org} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function OrganizationRow({ organization }: { organization: Organization }) {
  const isEnterprise = isEnterpriseOrganization(organization);
  const subscription = organization.subscription;

  return (
    <tr className="align-top transition-colors hover:bg-muted/30">
      <td className="px-4 py-3">
        <a
          href={`/${organization.slug}`}
          className="font-semibold text-[var(--color-org-primary)] hover:underline"
        >
          {organization.name}
        </a>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">/{organization.slug}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {isEnterprise && (
            <Pill className="border-[var(--color-org-primary)]/20 bg-[var(--color-org-primary)]/10 text-[var(--color-org-primary)]">
              Enterprise
            </Pill>
          )}
          {hasBillingRecord(organization) && (
            <Pill className="border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              Paid / billing
            </Pill>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-sm">
        {isEnterprise && organization.enterprise_slug ? (
          <a
            href={`/enterprise/${organization.enterprise_slug}`}
            className="text-[var(--color-org-primary)] hover:underline"
          >
            {organization.enterprise_name ?? "Enterprise account"}
          </a>
        ) : isEnterprise ? (
          <span>{organization.enterprise_name ?? "Enterprise account"}</span>
        ) : (
          <span className="text-muted-foreground">Independent</span>
        )}
      </td>
      <td className="px-4 py-3 font-medium">{organization.member_count.toLocaleString()}</td>
      <td className="px-4 py-3">
        <StatusPill status={subscription?.status ?? null} />
        {subscription?.current_period_end && (
          <p className="mt-1 text-xs text-muted-foreground">
            Through {formatDate(subscription.current_period_end)}
          </p>
        )}
        {subscription?.stripe_subscription_id && (
          <a
            href={`https://dashboard.stripe.com/subscriptions/${subscription.stripe_subscription_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--color-org-primary)] hover:underline"
          >
            Stripe record <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
        {formatDate(organization.created_at)}
      </td>
      <td className="px-4 py-3 text-right">
        <a
          href={`/${organization.slug}`}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium text-[var(--color-org-primary)] hover:bg-muted hover:underline"
        >
          Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </td>
    </tr>
  );
}
