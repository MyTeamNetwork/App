"use client";

export function formatDate(value: string | null): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function formatBillingStatus(status: string | null): string {
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

export function billingStatusClasses(status: string | null): string {
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

export function shortId(value: string): string {
  if (value.length <= 22) return value;
  return `${value.slice(0, 12)}…${value.slice(-6)}`;
}

export function stripeDashboardUrl(type: "customers" | "subscriptions", id: string): string {
  return `https://dashboard.stripe.com/${type}/${id}`;
}

export function Pill({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string | null }) {
  return <Pill className={billingStatusClasses(status)}>{formatBillingStatus(status)}</Pill>;
}
