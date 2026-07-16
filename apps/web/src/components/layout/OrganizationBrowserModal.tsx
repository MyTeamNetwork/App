"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import {
  formatDate,
  Pill,
  StatusPill,
  stripeDashboardUrl,
} from "./dev-panel-shared";

export interface Organization {
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

const ORGANIZATION_FILTERS: Array<{
  value: OrganizationFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "enterprise", label: "Enterprise" },
  { value: "paid", label: "Paid / billing" },
  { value: "no-plan", label: "No plan" },
];

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

export function OrganizationBrowserModal({
  isOpen,
  onClose,
  organizations,
}: {
  isOpen: boolean;
  onClose: () => void;
  organizations: Organization[];
}) {
  const [filter, setFilter] = useState<OrganizationFilter>("all");
  const [search, setSearch] = useState("");

  // Layout effect so the reset lands before paint — a reopened modal must not
  // flash the previous session's filter/search against fresh org data.
  useLayoutEffect(() => {
    if (isOpen) {
      setFilter("all");
      setSearch("");
    }
  }, [isOpen]);

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
                onClick={() => setFilter(option.value)}
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
                onChange={(event) => setSearch(event.target.value)}
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
                  onClick={() => setFilter(option.value)}
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
        {subscription?.stripe_subscription_id ? (
          <a
            href={stripeDashboardUrl("subscriptions", subscription.stripe_subscription_id)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--color-org-primary)] hover:underline"
          >
            Stripe record <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : subscription?.stripe_customer_id ? (
          <a
            href={stripeDashboardUrl("customers", subscription.stripe_customer_id)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--color-org-primary)] hover:underline"
          >
            Stripe customer <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}
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
