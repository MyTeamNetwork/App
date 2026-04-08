import React, { useCallback } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { LinearTransition } from "react-native-reanimated";

import { useThemedStyles } from "@/hooks/useThemedStyles";
import { RADIUS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { CalendarFilterSource } from "@/hooks/useUnifiedCalendar";

interface ChipDef {
  source: CalendarFilterSource;
  label: string;
}

const CHIPS: readonly ChipDef[] = [
  { source: "all", label: "All" },
  { source: "event", label: "Team Events" },
  { source: "schedule", label: "My Schedule" },
] as const;

interface SourceFilterChipsProps {
  activeSource: CalendarFilterSource;
  onChange: (source: CalendarFilterSource) => void;
}

export function SourceFilterChips({
  activeSource,
  onChange,
}: SourceFilterChipsProps) {
  const styles = useThemedStyles((n, s) => ({
    container: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
    },
    scrollContent: {
      gap: SPACING.sm,
      paddingRight: SPACING.md,
    },
    chip: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    chipActive: {
      backgroundColor: s.success,
      borderColor: s.success,
    },
    chipPressed: {
      opacity: 0.7,
    },
    chipLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    chipLabelActive: {
      color: "#ffffff",
      fontWeight: "600" as const,
    },
  }));

  const handlePress = useCallback(
    (source: CalendarFilterSource) => {
      if (Platform.OS === "ios") {
        Haptics.selectionAsync();
      }
      onChange(source);
    },
    [onChange]
  );

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {CHIPS.map((chip) => {
          const isActive = activeSource === chip.source;
          return (
            <Animated.View key={chip.source} layout={LinearTransition.duration(180)}>
              <Pressable
                onPress={() => handlePress(chip.source)}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`Filter by ${chip.label}`}
                style={({ pressed }) => [
                  styles.chip,
                  isActive && styles.chipActive,
                  pressed && styles.chipPressed,
                ]}
              >
                <Text
                  style={[styles.chipLabel, isActive && styles.chipLabelActive]}
                >
                  {chip.label}
                </Text>
              </Pressable>
            </Animated.View>
          );
        })}
      </ScrollView>
    </View>
  );
}
