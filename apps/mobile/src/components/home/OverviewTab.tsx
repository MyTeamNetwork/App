import React, { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  StyleSheet,
} from "react-native";
import {
  Users,
  GraduationCap,
  Calendar,
  DollarSign,
} from "lucide-react-native";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { OrgStats } from "@/hooks/useOrgStats";

interface StatCardConfig {
  label: string;
  value: string;
  icon: React.ReactNode;
  path: string;
}

interface OverviewTabProps {
  orgSlug: string;
  stats: OrgStats;
  refreshing: boolean;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
}

export function OverviewTab({
  orgSlug,
  stats,
  refreshing,
  onRefresh,
  onNavigate,
}: OverviewTabProps) {
  const statCards = useMemo<StatCardConfig[]>(
    () => [
      {
        label: "Active Members",
        value: String(stats.activeMembers),
        icon: <Users size={22} color={SEMANTIC.info} />,
        path: `/(app)/${orgSlug}/(tabs)/members`,
      },
      {
        label: "Alumni",
        value: String(stats.alumni),
        icon: <GraduationCap size={22} color={SEMANTIC.warning} />,
        path: `/(app)/${orgSlug}/(tabs)/alumni`,
      },
      {
        label: "Upcoming Events",
        value: String(stats.upcomingEvents),
        icon: <Calendar size={22} color={SEMANTIC.success} />,
        path: `/(app)/${orgSlug}/(tabs)/events`,
      },
      {
        label: "Total Donations",
        value: `$${stats.totalDonations.toLocaleString()}`,
        icon: <DollarSign size={22} color={SEMANTIC.success} />,
        path: `/(app)/${orgSlug}/donations`,
      },
    ],
    [stats, orgSlug]
  );

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.statsGrid}>
        {statCards.map((card) => (
          <Pressable
            key={card.label}
            onPress={() => onNavigate(card.path)}
            style={({ pressed }) => [
              styles.statCard,
              pressed && styles.statCardPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${card.label}: ${card.value}`}
          >
            <View style={styles.statIconWrapper}>{card.icon}</View>
            <Text style={styles.statValue}>{card.value}</Text>
            <Text style={styles.statLabel}>{card.label}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
  },
  statCard: {
    flex: 1,
    flexBasis: "45%",
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    padding: SPACING.md,
    gap: SPACING.xs,
    ...SHADOWS.sm,
  },
  statCardPressed: {
    opacity: 0.7,
  },
  statIconWrapper: {
    marginBottom: SPACING.xs,
  },
  statValue: {
    ...TYPOGRAPHY.headlineMedium,
    color: NEUTRAL.foreground,
  },
  statLabel: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
  },
});
