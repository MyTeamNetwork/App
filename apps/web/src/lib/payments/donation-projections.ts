import type { OrganizationDonation, OrganizationDonationStat } from "@/types/database";

export const DONATION_DISPLAY_SELECT =
  "id, amount_cents, anonymous, created_at, donor_email, donor_name, purpose, status, visibility" as const;

export const DONATION_PUBLIC_SELECT =
  "id, amount_cents, anonymous, created_at, donor_name, purpose, status, visibility" as const;

export const DONATION_STATS_SELECT = "donation_count, total_amount_cents" as const;

export type DonationDisplayRow = Pick<
  OrganizationDonation,
  | "id"
  | "amount_cents"
  | "anonymous"
  | "created_at"
  | "donor_email"
  | "donor_name"
  | "purpose"
  | "status"
  | "visibility"
>;

export type DonationPublicRow = Omit<DonationDisplayRow, "donor_email">;

export type DonationStatsSummary = Pick<
  OrganizationDonationStat,
  "donation_count" | "total_amount_cents"
>;
