import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Pressable,
  Switch,
} from "react-native";
import { Bell, ChevronDown, Sun, Moon, Monitor } from "lucide-react-native";
import { useNotificationPreferences } from "@/hooks/useNotificationPreferences";
import { useAppColorScheme, type ColorSchemePreference } from "@/contexts/ColorSchemeContext";
import { type SettingsColors } from "./settingsColors";

interface Props {
  orgId: string;
  colors: SettingsColors;
}

const fontSize = { xs: 12, sm: 14, base: 16, lg: 18 };
const fontWeight = {
  normal: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
};

const APPEARANCE_OPTIONS: Array<{ value: ColorSchemePreference; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function SettingsNotificationsSection({ orgId, colors }: Props) {
  const { prefs, loading: prefsLoading, saving: prefsSaving, updatePrefs } = useNotificationPreferences(orgId);
  const { preference, setPreference } = useAppColorScheme();

  const [expanded, setExpanded] = useState(true);
  const [emailAddress, setEmailAddress] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);

  useEffect(() => {
    if (prefs) {
      setEmailAddress(prefs.email_address || "");
      setEmailEnabled(prefs.email_enabled);
      setPushEnabled(prefs.push_enabled);
    }
  }, [prefs]);

  const handleSaveNotifications = async () => {
    await updatePrefs({
      email_address: emailAddress.trim() || null,
      email_enabled: emailEnabled,
      push_enabled: pushEnabled,
    });
  };

  const styles = createStyles(colors);

  return (
    <>
      {/* Appearance section */}
      <View style={styles.section}>
        <View style={styles.appearanceHeader}>
          <Monitor size={20} color={colors.muted} />
          <Text style={styles.sectionTitle}>Appearance</Text>
        </View>
        <View style={styles.segmentedControl}>
          {APPEARANCE_OPTIONS.map(({ value, label, Icon }) => {
            const selected = preference === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${label} theme`}
                style={({ pressed }) => [
                  styles.segmentOption,
                  selected && styles.segmentOptionSelected,
                  pressed && !selected && { opacity: 0.6 },
                ]}
                onPress={() => setPreference(value)}
              >
                <Icon
                  size={16}
                  color={selected ? colors.primary : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.segmentOptionText,
                    selected && styles.segmentOptionTextSelected,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Notifications section */}
      <View style={styles.section}>
      <Pressable
        style={({ pressed }) => [styles.sectionHeader, pressed && { opacity: 0.7 }]}
        onPress={() => setExpanded((prev) => !prev)}
      >
        <View style={styles.sectionHeaderLeft}>
          <Bell size={20} color={colors.muted} />
          <Text style={styles.sectionTitle}>Notifications</Text>
        </View>
        <ChevronDown
          size={20}
          color={colors.mutedForeground}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {expanded && (
        <View style={styles.card}>
          {prefsLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Email Address</Text>
                <TextInput
                  style={styles.input}
                  value={emailAddress}
                  onChangeText={setEmailAddress}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.switchRow}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>Email Notifications</Text>
                  <Text style={styles.switchHint}>Receive updates via email</Text>
                </View>
                <Switch
                  value={emailEnabled}
                  onValueChange={setEmailEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={emailEnabled ? colors.primary : colors.card}
                />
              </View>

              <View style={styles.switchRow}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>Push Notifications</Text>
                  <Text style={styles.switchHint}>Announcements and events</Text>
                </View>
                <Switch
                  value={pushEnabled}
                  onValueChange={setPushEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={pushEnabled ? colors.primary : colors.card}
                />
              </View>

              <Pressable
                style={styles.button}
                onPress={handleSaveNotifications}
                disabled={prefsSaving}
              >
                {prefsSaving ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={styles.buttonText}>Save Preferences</Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      )}
      </View>
    </>
  );
}

const createStyles = (colors: SettingsColors) =>
  StyleSheet.create({
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
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      borderCurve: "continuous",
    },
    loadingContainer: {
      padding: 24,
      alignItems: "center",
    },
    fieldGroup: {
      marginBottom: 16,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
      marginBottom: 8,
    },
    input: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: fontSize.base,
      color: colors.foreground,
      marginBottom: 12,
    },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    switchInfo: {
      flex: 1,
    },
    switchLabel: {
      fontSize: fontSize.base,
      color: colors.foreground,
    },
    switchHint: {
      fontSize: 13,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    button: {
      backgroundColor: colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 16,
    },
    buttonText: {
      color: colors.primaryForeground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    appearanceHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 4,
    },
    segmentedControl: {
      flexDirection: "row",
      backgroundColor: colors.card,
      borderRadius: 10,
      padding: 4,
      gap: 4,
    },
    segmentOption: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 4,
      borderRadius: 8,
    },
    segmentOptionSelected: {
      backgroundColor: colors.background,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
    segmentOptionText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    segmentOptionTextSelected: {
      color: colors.primary,
      fontWeight: fontWeight.semibold,
    },
  });
