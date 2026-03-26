/** Serializable for Server → Client props (no Lucide components). */
export type FeedOverviewStatChipIconKey =
  | "users"
  | "graduation-cap"
  | "heart"
  | "calendar-clock"
  | "hand-heart";

export interface FeedOverviewStatChip {
  label: string;
  value: number | string;
  href: string;
  iconKey: FeedOverviewStatChipIconKey;
}
