import React, { useMemo, useState } from "react";
import { View, Text, ActivityIndicator, Switch, Pressable } from "react-native";
import { Users, ChevronDown } from "lucide-react-native";
import { useNetworkingConsent } from "@/hooks/useNetworkingConsent";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { buildSettingsColors } from "./settingsColors";
import { useBaseStyles, fontSize } from "./settingsShared";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface Props {
  orgId: string;
}

// Mirrors web's NetworkingConsentToggle at /[orgSlug]/connections — same
// copy, same GET/PATCH contract, same optimistic-update-with-rollback behavior.
export function SettingsNetworkingSection({ orgId }: Props) {
  const { optedIn, loading, saving, error, noProfile, setOptedIn } = useNetworkingConsent(orgId);
  const { neutral, semantic } = useAppColorScheme();
  const colors = useMemo(() => buildSettingsColors(neutral, semantic), [neutral, semantic]);
  const baseStyles = useBaseStyles();

  const [expanded, setExpanded] = useState(true);

  const styles = useThemedStyles((n, _s) => ({
    switchRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingVertical: 12,
    },
    switchInfo: {
      flex: 1,
      paddingRight: 12,
    },
    switchLabel: {
      fontSize: fontSize.base,
      color: n.foreground,
    },
    switchHint: {
      fontSize: 13,
      color: n.placeholder,
      marginTop: 2,
    },
    noticeText: {
      fontSize: 13,
      color: colors.primary,
      marginTop: 8,
    },
    errorText: {
      fontSize: 13,
      color: colors.error,
      marginTop: 8,
    },
  }));

  const handleToggle = async (next: boolean) => {
    await setOptedIn(next);
  };

  return (
    <View style={baseStyles.section}>
      <Pressable
        style={({ pressed }) => [baseStyles.sectionHeader, pressed && { opacity: 0.7 }]}
        onPress={() => setExpanded((prev) => !prev)}
      >
        <View style={baseStyles.sectionHeaderLeft}>
          <Users size={20} color={colors.muted} />
          <Text style={baseStyles.sectionTitle}>Networking</Text>
        </View>
        <ChevronDown
          size={20}
          color={colors.mutedForeground}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {expanded && (
        <View style={baseStyles.card}>
          {loading ? (
            <View style={baseStyles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <>
              <View style={styles.switchRow}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>
                    {optedIn ? "You're open to networking" : "Open to networking"}
                  </Text>
                  <Text style={styles.switchHint}>
                    {optedIn
                      ? "Others in your network can see you in suggestions and message you."
                      : "Turn this on to appear in others' suggestions and let them reach out."}
                  </Text>
                </View>
                <Switch
                  value={optedIn}
                  onValueChange={handleToggle}
                  disabled={saving}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={optedIn ? colors.primary : colors.card}
                />
              </View>
              {noProfile ? (
                <Text style={styles.noticeText}>Complete your profile before turning this on.</Text>
              ) : null}
              {error ? <Text style={styles.errorText}>Couldn&apos;t update your setting. Try again.</Text> : null}
            </>
          )}
        </View>
      )}
    </View>
  );
}
