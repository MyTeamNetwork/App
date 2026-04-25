import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import type { MentorshipPair } from "@teammeet/types";

export function MyProposalsSection({
  pairs,
  userLabel,
}: {
  pairs: MentorshipPair[];
  userLabel: (id: string) => string;
}) {
  const styles = useThemedStyles(createStyles);

  if (pairs.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.emptyTitle}>No proposals yet</Text>
        <Text style={styles.emptySubtitle}>
          When you request a mentor, your pending proposals will show up here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {pairs.map((pair) => {
        const status = pair.status as string;
        const statusStyle =
          status === "proposed"
            ? styles.statusProposed
            : status === "accepted" || status === "active"
              ? styles.statusActive
              : status === "declined"
                ? styles.statusDeclined
                : styles.statusOther;
        return (
          <View key={pair.id} style={styles.card}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Mentor</Text>
                <Text style={styles.name}>{userLabel(pair.mentor_user_id)}</Text>
              </View>
              <View style={[styles.statusBadge, statusStyle]}>
                <Text style={[styles.statusText, statusStyle]}>{status}</Text>
              </View>
            </View>
            <Text style={styles.helperText}>
              {status === "proposed"
                ? "Awaiting admin review."
                : status === "accepted" || status === "active"
                  ? "You can now log activity and schedule meetings."
                  : status === "declined"
                    ? (pair as { declined_reason?: string | null }).declined_reason ||
                      "This request was declined."
                    : `Status: ${status}`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    list: {
      gap: SPACING.md,
    },
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: SPACING.sm,
    },
    label: {
      fontSize: 12,
      color: n.muted,
      textTransform: "uppercase",
    },
    name: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
    },
    statusBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: 4,
      borderRadius: 999,
    },
    statusText: {
      fontSize: 12,
      fontWeight: "600",
      textTransform: "capitalize",
    },
    statusProposed: {
      color: s.warning,
      backgroundColor: `${s.warning}1f`,
    },
    statusActive: {
      color: s.success,
      backgroundColor: `${s.success}1f`,
    },
    statusDeclined: {
      color: s.error,
      backgroundColor: `${s.error}14`,
    },
    statusOther: {
      color: n.muted,
      backgroundColor: n.divider,
    },
    helperText: {
      fontSize: 13,
      color: n.muted,
      lineHeight: 18,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
    },
    emptySubtitle: {
      fontSize: 14,
      color: n.muted,
    },
  });
