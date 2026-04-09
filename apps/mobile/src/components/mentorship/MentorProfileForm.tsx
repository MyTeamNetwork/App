import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  Switch,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import type { MentorProfileRecord } from "@/types/mentorship";

export function MentorProfileForm({
  currentUserProfile,
  onCancel,
  onSaved,
}: {
  currentUserProfile: MentorProfileRecord | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const { user } = useAuth();
  const { orgId } = useOrg();
  const [bio, setBio] = useState(currentUserProfile?.bio ?? "");
  const [expertiseAreas, setExpertiseAreas] = useState(
    currentUserProfile?.expertise_areas.join(", ") ?? ""
  );
  const [contactEmail, setContactEmail] = useState(currentUserProfile?.contact_email ?? "");
  const [contactLinkedin, setContactLinkedin] = useState(
    currentUserProfile?.contact_linkedin ?? ""
  );
  const [contactPhone, setContactPhone] = useState(currentUserProfile?.contact_phone ?? "");
  const [isActive, setIsActive] = useState(currentUserProfile?.is_active ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!user?.id || !orgId) {
      setError("You must be signed in to update your mentor profile.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const payload = {
      organization_id: orgId,
      user_id: user.id,
      bio: bio.trim() || null,
      expertise_areas: expertiseAreas
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      contact_email: contactEmail.trim() || null,
      contact_linkedin: contactLinkedin.trim() || null,
      contact_phone: contactPhone.trim() || null,
      is_active: isActive,
    };

    const query = currentUserProfile
      ? supabase
          .from("mentor_profiles")
          .update(payload)
          .eq("id", currentUserProfile.id)
          .eq("user_id", user.id)
      : supabase.from("mentor_profiles").insert(payload);

    const { error: saveError } = await query;

    if (saveError) {
      setError(saveError.message);
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    onSaved();
  };

  return (
    <View style={styles.profileFormCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {currentUserProfile ? "Edit mentor profile" : "Become a mentor"}
        </Text>
        <Text style={styles.sectionSubtitle}>
          Share what you can help with so current members know how to reach you.
        </Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Bio</Text>
        <TextInput
          value={bio}
          onChangeText={setBio}
          placeholder="Tell members about your background and what you can help with."
          placeholderTextColor={styles.placeholderColor.color}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.textArea]}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Areas of expertise</Text>
        <TextInput
          value={expertiseAreas}
          onChangeText={setExpertiseAreas}
          placeholder="Career advice, interview prep, industry insights"
          placeholderTextColor={styles.placeholderColor.color}
          style={styles.input}
        />
        <Text style={styles.helperText}>Separate multiple areas with commas.</Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Email</Text>
        <TextInput
          value={contactEmail}
          onChangeText={setContactEmail}
          placeholder="your.email@example.com"
          placeholderTextColor={styles.placeholderColor.color}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>LinkedIn URL</Text>
        <TextInput
          value={contactLinkedin}
          onChangeText={setContactLinkedin}
          placeholder="https://linkedin.com/in/yourprofile"
          placeholderTextColor={styles.placeholderColor.color}
          autoCapitalize="none"
          style={styles.input}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Phone</Text>
        <TextInput
          value={contactPhone}
          onChangeText={setContactPhone}
          placeholder="+1 (555) 123-4567"
          placeholderTextColor={styles.placeholderColor.color}
          keyboardType="phone-pad"
          style={styles.input}
        />
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Visible in directory</Text>
        <Switch
          value={isActive}
          onValueChange={setIsActive}
          trackColor={{
            false: styles.trackOff.color,
            true: styles.trackOn.color,
          }}
          thumbColor={
            isActive ? styles.thumbOn.color : styles.thumbOff.color
          }
        />
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [
            styles.ghostButton,
            pressed && styles.ghostButtonPressed,
          ]}
        >
          <Text style={styles.ghostButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={isSaving}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
            isSaving && styles.buttonDisabled,
          ]}
        >
          {isSaving ? (
            <ActivityIndicator color={styles.primaryButtonText.color} />
          ) : (
            <Text style={styles.primaryButtonText}>
              {currentUserProfile ? "Save profile" : "Register as mentor"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    profileFormCard: {
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.divider,
      padding: SPACING.md,
      gap: SPACING.md,
    },
    sectionHeader: {
      gap: SPACING.xs,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: n.foreground,
    },
    sectionSubtitle: {
      fontSize: 14,
      color: n.muted,
    },
    errorText: {
      fontSize: 14,
      color: s.error,
    },
    fieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      fontSize: 14,
      fontWeight: "500",
      color: n.secondary,
    },
    helperText: {
      fontSize: 12,
      color: n.muted,
    },
    placeholderColor: {
      color: n.muted,
    },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      fontSize: 16,
      color: n.foreground,
      backgroundColor: n.background,
    },
    textArea: {
      minHeight: 90,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    toggleLabel: {
      fontSize: 14,
      color: n.foreground,
    },
    trackOff: {
      color: n.border,
    },
    trackOn: {
      color: s.success,
    },
    thumbOn: {
      color: s.success,
    },
    thumbOff: {
      color: n.surface,
    },
    buttonRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: SPACING.sm,
      flexWrap: "wrap",
    },
    ghostButton: {
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    ghostButtonPressed: {
      opacity: 0.85,
    },
    ghostButtonText: {
      fontSize: 16,
      fontWeight: "500",
      color: n.foreground,
    },
    primaryButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      color: n.surface,
      fontSize: 16,
      fontWeight: "600",
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });
