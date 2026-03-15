import React from "react";
import { Text, Pressable, StyleSheet } from "react-native";
import { SEMANTIC, SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

interface NewPostsBannerProps {
  count: number;
  onPress: () => void;
}

export function NewPostsBanner({ count, onPress }: NewPostsBannerProps) {
  if (count === 0) return null;

  const label = count === 1 ? "1 new post" : `${count} new posts`;

  return (
    <Pressable
      onPress={onPress}
      style={styles.banner}
      accessibilityRole="button"
      accessibilityLabel={`${label} — tap to refresh`}
    >
      <Text style={styles.text}>{label} — tap to refresh</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: SPACING.sm,
    left: SPACING.md,
    right: SPACING.md,
    backgroundColor: SEMANTIC.info,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.lg,
    alignItems: "center",
    zIndex: 10,
    ...SHADOWS.md,
  },
  text: {
    ...TYPOGRAPHY.labelMedium,
    color: "#ffffff",
    fontWeight: "600",
  },
});
