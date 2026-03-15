/**
 * JobCard Component
 * Card for displaying job postings with location/experience badges
 */

import React, { useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Briefcase, MapPin, Building2 } from "lucide-react-native";
import { NEUTRAL, SEMANTIC, RADIUS, SPACING, SHADOWS, ANIMATION } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { JobPostingWithPoster } from "@/types/jobs";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface JobCardProps {
  job: JobPostingWithPoster;
  onPress?: () => void;
  style?: ViewStyle;
}

// Location type badge config
const LOCATION_TYPE_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  remote: { label: "Remote", bg: SEMANTIC.infoLight, color: SEMANTIC.infoDark },
  onsite: { label: "On-site", bg: SEMANTIC.warningLight, color: SEMANTIC.warningDark },
  hybrid: { label: "Hybrid", bg: SEMANTIC.successLight, color: SEMANTIC.successDark },
};

// Experience level badge config
const EXPERIENCE_LEVEL_CONFIG: Record<string, string> = {
  entry: "Entry Level",
  mid: "Mid Level",
  senior: "Senior",
  executive: "Executive",
};

function formatRelativeDate(dateString: string): string {
  const now = Date.now();
  const date = new Date(dateString).getTime();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

export const JobCard = React.memo(function JobCard({
  job,
  onPress,
  style,
}: JobCardProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.98, ANIMATION.spring);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, ANIMATION.spring);
  }, [scale]);

  const locationConfig = job.location_type
    ? LOCATION_TYPE_CONFIG[job.location_type]
    : null;

  const experienceLabel = job.experience_level
    ? EXPERIENCE_LEVEL_CONFIG[job.experience_level]
    : null;

  const posterName = job.poster?.name ?? "Unknown";
  const relativeDate = formatRelativeDate(job.created_at);

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.container, animatedStyle, style]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Briefcase size={20} color={NEUTRAL.secondary} />
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={2}>
            {job.title}
          </Text>
          <View style={styles.companyRow}>
            <Building2 size={13} color={NEUTRAL.muted} />
            <Text style={styles.company} selectable numberOfLines={1}>
              {job.company}
            </Text>
          </View>
          {job.location != null && (
            <View style={styles.locationRow}>
              <MapPin size={13} color={NEUTRAL.muted} />
              <Text style={styles.locationText} numberOfLines={1}>
                {job.location}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Badges */}
      {(locationConfig != null || experienceLabel != null) && (
        <View style={styles.badgeRow}>
          {locationConfig != null && (
            <View style={[styles.badge, { backgroundColor: locationConfig.bg }]}>
              <Text style={[styles.badgeText, { color: locationConfig.color }]}>
                {locationConfig.label}
              </Text>
            </View>
          )}
          {experienceLabel != null && (
            <View style={[styles.badge, styles.badgeNeutral]}>
              <Text style={styles.badgeTextNeutral}>{experienceLabel}</Text>
            </View>
          )}
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Posted by {posterName} · {relativeDate}
        </Text>
      </View>
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    ...SHADOWS.sm,
    // @ts-ignore — iOS continuous corner curves
    borderCurve: "continuous",
  },
  header: {
    flexDirection: "row",
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  iconContainer: {
    width: 40,
    height: 40,
    backgroundColor: NEUTRAL.background,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: {
    flex: 1,
    gap: 3,
  },
  title: {
    ...TYPOGRAPHY.titleMedium,
    color: NEUTRAL.foreground,
  },
  companyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  company: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.secondary,
    flex: 1,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  locationText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
    flex: 1,
  },
  badgeRow: {
    flexDirection: "row",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    flexWrap: "wrap",
  },
  badge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs,
    borderRadius: RADIUS.full,
  },
  badgeText: {
    ...TYPOGRAPHY.labelSmall,
  },
  badgeNeutral: {
    backgroundColor: NEUTRAL.background,
  },
  badgeTextNeutral: {
    ...TYPOGRAPHY.labelSmall,
    color: NEUTRAL.secondary,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: NEUTRAL.divider,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  footerText: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
  },
});
