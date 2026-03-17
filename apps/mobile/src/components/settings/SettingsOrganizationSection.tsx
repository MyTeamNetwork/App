import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { Building2, ChevronDown } from "lucide-react-native";
import { SETTINGS_COLORS } from "./settingsColors";
import { baseStyles, fontSize, fontWeight, spacing } from "./settingsShared";

interface Props {
  org: { name: string; slug: string; logo_url: string | null; primary_color: string | null; secondary_color: string | null } | null;
  orgLoading: boolean;
  updateName: (name: string) => Promise<{ success: boolean; error?: string }>;
  isAdmin: boolean;
}

export function SettingsOrganizationSection({ org, orgLoading, updateName, isAdmin }: Props) {

  const [expanded, setExpanded] = useState(true);
  const [editedName, setEditedName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (org) {
      setEditedName(org.name);
    }
  }, [org]);

  if (!isAdmin) return null;

  const colors = SETTINGS_COLORS;

  const handleSaveName = async () => {
    if (!editedName.trim() || editedName === org?.name) return;
    setNameSaving(true);
    setNameError(null);
    const result = await updateName(editedName);
    if (!result.success) {
      setNameError(result.error || "Failed to update name");
    }
    setNameSaving(false);
  };

  return (
    <View style={baseStyles.section}>
      <Pressable
        style={({ pressed }) => [baseStyles.sectionHeader, pressed && { opacity: 0.7 }]}
        onPress={() => setExpanded((prev) => !prev)}
      >
        <View style={baseStyles.sectionHeaderLeft}>
          <Building2 size={20} color={colors.muted} />
          <Text style={baseStyles.sectionTitle}>Organization</Text>
        </View>
        <ChevronDown
          size={20}
          color={colors.mutedForeground}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {expanded && (
        <View style={baseStyles.card}>
          {orgLoading ? (
            <View style={baseStyles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Organization Name</Text>
                <TextInput
                  style={styles.input}
                  value={editedName}
                  onChangeText={setEditedName}
                  placeholder="Organization name"
                  placeholderTextColor={colors.mutedForeground}
                />
                {nameError && <Text style={styles.errorText}>{nameError}</Text>}
                <Pressable
                  style={[styles.button, editedName === org?.name && styles.buttonDisabled]}
                  onPress={handleSaveName}
                  disabled={nameSaving || editedName === org?.name}
                >
                  {nameSaving ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Text style={styles.buttonText}>Save Name</Text>
                  )}
                </Pressable>
              </View>

              <View style={baseStyles.divider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Branding</Text>
                <View style={[styles.brandingPreview, { backgroundColor: org?.primary_color || colors.primary }]}>
                  {org?.logo_url ? (
                    <Image source={org.logo_url} style={styles.logoPreview} contentFit="contain" transition={200} />
                  ) : (
                    <View style={styles.logoPlaceholder}>
                      <Building2 size={24} color="#fff" />
                    </View>
                  )}
                  <View>
                    <Text style={styles.brandingName}>{org?.name}</Text>
                    <Text style={styles.brandingSlug}>/{org?.slug}</Text>
                  </View>
                </View>
                <View style={styles.colorRow}>
                  <View style={styles.colorItem}>
                    <View style={[styles.colorSwatch, { backgroundColor: org?.primary_color || colors.primary }]} />
                    <Text style={styles.colorLabel}>Primary</Text>
                  </View>
                  <View style={styles.colorItem}>
                    <View style={[styles.colorSwatch, { backgroundColor: org?.secondary_color || colors.secondary }]} />
                    <Text style={styles.colorLabel}>Secondary</Text>
                  </View>
                </View>
                <Text style={styles.hintText}>
                  To change logo and colors, visit settings on the web.
                </Text>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const c = SETTINGS_COLORS;

const styles = StyleSheet.create({
    fieldGroup: {
      marginBottom: spacing.md,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: c.foreground,
      marginBottom: spacing.sm,
    },
    input: {
      backgroundColor: c.background,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
      fontSize: fontSize.base,
      color: c.foreground,
      marginBottom: 12,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: c.error,
      marginBottom: spacing.sm,
    },
    button: {
      backgroundColor: c.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: c.primaryForeground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    hintText: {
      fontSize: 13,
      color: c.mutedForeground,
      marginTop: spacing.sm,
    },
    brandingPreview: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: spacing.md,
      borderRadius: 12,
      marginBottom: 12,
    },
    logoPreview: {
      width: 48,
      height: 48,
      borderRadius: 12,
    },
    logoPlaceholder: {
      width: 48,
      height: 48,
      borderRadius: 12,
      backgroundColor: "rgba(255,255,255,0.2)",
      alignItems: "center",
      justifyContent: "center",
    },
    brandingName: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: "#fff",
    },
    brandingSlug: {
      fontSize: fontSize.sm,
      color: "rgba(255,255,255,0.8)",
    },
    colorRow: {
      flexDirection: "row",
      gap: 24,
    },
    colorItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    colorSwatch: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: c.border,
    },
    colorLabel: {
      fontSize: fontSize.sm,
      color: c.muted,
    },
  });
