"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { formatDate, shortId, StatusPill, stripeDashboardUrl } from "./dev-panel-shared";

interface EnterpriseData {
  id: string;
  name: string;
  slug: string;
  billing_contact_email: string | null;
  created_at: string | null;
  subscription: {
    status: string;
    alumni_bucket_quantity: number;
    sub_org_quantity: number | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  } | null;
  counts: {
    total_alumni_count: number;
    sub_org_count: number;
    enterprise_managed_org_count: number;
  };
  admins: Array<{ user_id: string; role: string; email: string | null }>;
  sub_orgs: Array<{
    id: string;
    name: string;
    slug: string;
    relationship_type: string | null;
    subscription_status: string | null;
  }>;
}

interface DevEnterpriseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    owner: "Owner",
    billing_admin: "Billing admin",
    org_admin: "Organization admin",
  };

  return labels[role] ?? role.replaceAll("_", " ");
}

function relationshipLabel(value: string | null): string {
  if (!value) return "Not specified";

  const labels: Record<string, string> = {
    direct: "Direct",
    managed: "Managed",
    partner: "Partner",
  };

  return labels[value] ?? value.replaceAll("_", " ");
}

export default function DevEnterpriseModal({ isOpen, onClose }: DevEnterpriseModalProps) {
  const [enterprises, setEnterprises] = useState<EnterpriseData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/dev-admin/enterprises")
      .then((res) => {
        if (!res.ok) throw new Error(`Enterprise accounts could not be loaded (${res.status}).`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setEnterprises(data.enterprises ?? data ?? []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Enterprise accounts could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const billingCount = enterprises.filter((enterprise) => enterprise.subscription).length;
  const organizationCount = enterprises.reduce(
    (total, enterprise) => total + enterprise.counts.sub_org_count,
    0
  );

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      ariaLabel="Enterprise accounts"
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
              <h2 className="mt-1 text-xl font-semibold">Enterprise accounts</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Review billing, managed organizations, alumni reach, and account owners.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close enterprise accounts"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SummaryCard label="Enterprise accounts" value={enterprises.length} />
            <SummaryCard label="With billing" value={billingCount} />
            <SummaryCard label="Organizations managed" value={organizationCount} />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-b-[var(--color-org-primary)]" />
              <span className="sr-only">Loading enterprise accounts</span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {!loading && !error && enterprises.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No enterprise accounts found.
            </div>
          )}

          {!loading && !error && enterprises.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Account</th>
                    <th className="px-4 py-3 font-medium">Billing</th>
                    <th className="px-4 py-3 font-medium">Organizations</th>
                    <th className="px-4 py-3 font-medium">Alumni</th>
                    <th className="px-4 py-3 font-medium">Plan status</th>
                    <th className="px-4 py-3 font-medium">Stripe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {enterprises.map((enterprise) => (
                    <EnterpriseRow
                      key={enterprise.id}
                      enterprise={enterprise}
                      isExpanded={expandedId === enterprise.id}
                      onToggle={() =>
                        setExpandedId((current) =>
                          current === enterprise.id ? null : enterprise.id
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="flex justify-end border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-muted px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-border focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Close
          </button>
        </footer>
      </div>
    </Modal>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}

function EnterpriseRow({
  enterprise,
  isExpanded,
  onToggle,
}: {
  enterprise: EnterpriseData;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const subscription = enterprise.subscription;
  const counts = enterprise.counts;

  return (
    <>
      <tr className="align-top transition-colors hover:bg-muted/30">
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            className="flex items-start gap-2 text-left focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {isExpanded ? (
              <ChevronDown
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <ChevronRight
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <span>
              <span className="block font-semibold text-[var(--color-org-primary)]">
                {enterprise.name}
              </span>
              <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                /{enterprise.slug}
              </span>
            </span>
          </button>
        </td>
        <td className="px-4 py-3">
          {subscription ? (
            <div className="space-y-1 text-xs">
              <p>
                <span className="font-medium">Alumni capacity:</span>{" "}
                {subscription.alumni_bucket_quantity.toLocaleString()}
              </p>
              <p>
                <span className="font-medium">Organization seats:</span>{" "}
                {subscription.sub_org_quantity ?? "—"}
              </p>
            </div>
          ) : (
            <span className="text-muted-foreground">No billing record</span>
          )}
        </td>
        <td className="px-4 py-3">
          <p className="font-medium">{counts.sub_org_count.toLocaleString()}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {counts.enterprise_managed_org_count.toLocaleString()} managed here
          </p>
        </td>
        <td className="px-4 py-3 font-medium">{counts.total_alumni_count.toLocaleString()}</td>
        <td className="px-4 py-3">
          <StatusPill status={subscription?.status ?? null} />
        </td>
        <td className="px-4 py-3 text-xs">
          {subscription?.stripe_customer_id && (
            <a
              href={stripeDashboardUrl("customers", subscription.stripe_customer_id)}
              className="flex items-center gap-1 text-[var(--color-org-primary)] hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Customer · {shortId(subscription.stripe_customer_id)}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
          {subscription?.stripe_subscription_id && (
            <a
              href={stripeDashboardUrl("subscriptions", subscription.stripe_subscription_id)}
              className="mt-1 flex items-center gap-1 text-[var(--color-org-primary)] hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Subscription · {shortId(subscription.stripe_subscription_id)}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
          {!subscription?.stripe_customer_id && !subscription?.stripe_subscription_id && (
            <span className="text-muted-foreground">No Stripe links</span>
          )}
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={6} className="bg-muted/30 px-6 py-5">
            <ExpandedDetails enterprise={enterprise} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedDetails({ enterprise }: { enterprise: EnterpriseData }) {
  return (
    <div className="space-y-5">
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Billing contact</dt>
          <dd className="mt-1 font-medium">{enterprise.billing_contact_email ?? "Not set"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Created</dt>
          <dd className="mt-1 font-medium">{formatDate(enterprise.created_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Enterprise page</dt>
          <dd className="mt-1">
            <a
              href={`/enterprise/${enterprise.slug}`}
              className="inline-flex items-center gap-1 font-medium text-[var(--color-org-primary)] hover:underline"
            >
              Open account <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </dd>
        </div>
      </dl>

      <div>
        <h3 className="text-sm font-semibold">
          Organizations in this account ({enterprise.sub_orgs.length})
        </h3>
        {enterprise.sub_orgs.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No organizations are linked yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-xl border border-border">
            <table className="min-w-[620px] w-full text-xs">
              <thead className="bg-card text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Organization</th>
                  <th className="px-3 py-2 font-medium">Relationship</th>
                  <th className="px-3 py-2 font-medium">Billing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {enterprise.sub_orgs.map((organization) => (
                  <tr key={organization.id}>
                    <td className="px-3 py-2">
                      <a
                        href={`/${organization.slug}`}
                        className="font-medium text-[var(--color-org-primary)] hover:underline"
                      >
                        {organization.name}
                      </a>
                      <span className="ml-2 font-mono text-muted-foreground">
                        /{organization.slug}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {relationshipLabel(organization.relationship_type)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={organization.subscription_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold">Account owners ({enterprise.admins.length})</h3>
        {enterprise.admins.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No account owners are assigned.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {enterprise.admins.map((admin) => (
              <span
                key={admin.user_id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs"
              >
                <span className="font-medium">{admin.email ?? "Unknown email"}</span>
                <span className="text-muted-foreground">· {roleLabel(admin.role)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
