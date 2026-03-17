import { StyleSheet } from "react-native";
import { formatMonthDayYearSafe } from "@/lib/date-format";
import { SETTINGS_COLORS } from "./settingsColors";

export { fontSize, fontWeight, spacing } from "@/lib/theme";

export function formatDate(dateString: string | null): string {
  return formatMonthDayYearSafe(dateString, "N/A");
}

export function formatBucket(bucket: string): string {
  if (bucket === "none") return "Base Plan";
  return `Alumni ${bucket}`;
}

export const baseStyles = StyleSheet.create({
  section: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: SETTINGS_COLORS.foreground,
  },
  card: {
    backgroundColor: SETTINGS_COLORS.card,
    borderRadius: 12,
    padding: 16,
    borderCurve: "continuous",
  } as any,
  divider: {
    height: 1,
    backgroundColor: SETTINGS_COLORS.border,
    marginVertical: 16,
  },
  loadingContainer: {
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
});
