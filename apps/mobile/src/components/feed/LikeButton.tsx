import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Heart } from "lucide-react-native";
import { NEUTRAL, SEMANTIC, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

interface LikeButtonProps {
  liked: boolean;
  count: number;
  onPress: () => void;
}

export function LikeButton({ liked, count, onPress }: LikeButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.container}
      accessibilityLabel={liked ? "Unlike post" : "Like post"}
      accessibilityState={{ selected: liked }}
      accessibilityRole="button"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Heart
        size={18}
        color={liked ? SEMANTIC.error : NEUTRAL.muted}
        fill={liked ? SEMANTIC.error : "none"}
      />
      <Text style={[styles.count, liked && styles.countLiked]}>
        {count}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
  },
  count: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.muted,
  },
  countLiked: {
    color: SEMANTIC.error,
  },
});
