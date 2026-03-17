import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Pressable,
  Alert,
  Clipboard,
} from "react-native";
import {
  Link as LinkIcon,
  ChevronDown,
  Plus,
  X,
  Copy,
  Check,
  QrCode,
  Trash2,
} from "lucide-react-native";
import QRCode from "react-native-qrcode-svg";
import {
  useInvites,
  getInviteLink,
  isInviteValid,
  isInviteExpired,
  isInviteRevoked,
  isInviteExhausted,
  type Invite,
} from "@/hooks/useInvites";
import { useSubscription } from "@/hooks/useSubscription";
import { getRoleLabel } from "@/hooks/useMemberships";
import { formatMonthDayYearSafe } from "@/lib/date-format";
import { getWebAppUrl } from "@/lib/web-api";
import { type SettingsColors } from "./settingsColors";

interface Props {
  orgId: string;
  isAdmin: boolean;
  colors: SettingsColors;
}

function formatDate(dateString: string | null): string {
  return formatMonthDayYearSafe(dateString, "N/A");
}

function formatBucket(bucket: string): string {
  if (bucket === "none") return "Base Plan";
  return `Alumni ${bucket}`;
}

const fontSize = { xs: 12, sm: 14, base: 16, lg: 18 };
const fontWeight = {
  normal: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

export function SettingsInvitesSection({ orgId, isAdmin, colors }: Props) {
  const { invites, loading: invitesLoading, createInvite, revokeInvite, deleteInvite } = useInvites(orgId);
  const { subscription } = useSubscription(orgId);

  const [expanded, setExpanded] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteRole, setInviteRole] = useState<"active_member" | "admin" | "alumni">("active_member");
  const [inviteUses, setInviteUses] = useState("");
  const [inviteCreating, setInviteCreating] = useState(false);
  const [showQRCode, setShowQRCode] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  if (!isAdmin) return null;

  const validInviteCount = invites.filter(isInviteValid).length;

  const handleCreateInvite = async () => {
    if (
      inviteRole === "alumni" &&
      subscription &&
      subscription.alumniLimit !== null &&
      subscription.alumniCount >= subscription.alumniLimit
    ) {
      Alert.alert("Alumni Limit Reached", "Upgrade your plan to invite more alumni.");
      return;
    }

    setInviteCreating(true);
    const result = await createInvite({
      role: inviteRole,
      usesRemaining: inviteUses ? parseInt(inviteUses) : null,
      expiresAt: null,
    });

    if (result.success) {
      setShowInviteForm(false);
      setInviteRole("active_member");
      setInviteUses("");
    } else {
      Alert.alert("Error", result.error || "Failed to create invite");
    }
    setInviteCreating(false);
  };

  const copyInviteLink = (invite: Invite) => {
    const link = getInviteLink(invite, getWebAppUrl());
    Clipboard.setString(link);
    setCopiedInviteId(invite.id);
    setTimeout(() => setCopiedInviteId(null), 2000);
  };

  const styles = createStyles(colors);

  return (
    <View style={styles.section}>
      <Pressable
        style={({ pressed }) => [styles.sectionHeader, pressed && { opacity: 0.7 }]}
        onPress={() => setExpanded((prev) => !prev)}
      >
        <View style={styles.sectionHeaderLeft}>
          <LinkIcon size={20} color={colors.muted} />
          <Text style={styles.sectionTitle}>Invites</Text>
          {validInviteCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{validInviteCount}</Text>
            </View>
          )}
        </View>
        <ChevronDown
          size={20}
          color={colors.mutedForeground}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {expanded && (
        <View style={styles.card}>
          {subscription && (
            <View style={styles.quotaContainer}>
              <View style={styles.quotaRow}>
                <Text style={styles.quotaLabel}>Alumni Plan</Text>
                <Text style={styles.quotaValue}>{formatBucket(subscription.bucket)}</Text>
              </View>
              <View style={styles.quotaRow}>
                <Text style={styles.quotaLabel}>Alumni Used</Text>
                <Text style={styles.quotaValue}>
                  {subscription.alumniCount} / {subscription.alumniLimit ?? "Unlimited"}
                </Text>
              </View>
              <View style={styles.quotaRow}>
                <Text style={styles.quotaLabel}>Remaining</Text>
                <Text style={styles.quotaValue}>
                  {subscription.alumniLimit === null
                    ? "Unlimited"
                    : Math.max(subscription.alumniLimit - subscription.alumniCount, 0)}
                </Text>
              </View>
            </View>
          )}

          <View style={styles.divider} />

          {!showInviteForm && (
            <Pressable style={styles.createButton} onPress={() => setShowInviteForm(true)}>
              <Plus size={18} color={colors.primary} />
              <Text style={styles.createButtonText}>Create Invite</Text>
            </Pressable>
          )}

          {showInviteForm && (
            <View style={styles.inviteForm}>
              <Text style={styles.fieldLabel}>Role</Text>
              <View style={styles.roleButtons}>
                {(["active_member", "alumni", "admin"] as const).map((role) => (
                  <Pressable
                    key={role}
                    style={[styles.roleButton, inviteRole === role && styles.roleButtonActive]}
                    onPress={() => setInviteRole(role)}
                  >
                    <Text style={[styles.roleButtonText, inviteRole === role && styles.roleButtonTextActive]}>
                      {getRoleLabel(role)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Max Uses (optional)</Text>
              <TextInput
                style={styles.input}
                value={inviteUses}
                onChangeText={setInviteUses}
                placeholder="Unlimited"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
              />

              <View style={styles.formActions}>
                <Pressable
                  style={styles.cancelButton}
                  onPress={() => {
                    setShowInviteForm(false);
                    setInviteRole("active_member");
                    setInviteUses("");
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.button} onPress={handleCreateInvite} disabled={inviteCreating}>
                  {inviteCreating ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Text style={styles.buttonText}>Create</Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          {invitesLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : invites.length > 0 ? (
            <View style={styles.invitesList}>
              {invites.map((invite) => {
                const valid = isInviteValid(invite);
                const expired = isInviteExpired(invite.expires_at);
                const revoked = isInviteRevoked(invite.revoked_at);
                const exhausted = isInviteExhausted(invite.uses_remaining);

                return (
                  <View key={invite.id} style={[styles.inviteItem, !valid && styles.inviteItemInvalid]}>
                    <View style={styles.inviteHeader}>
                      <Text style={styles.inviteCode}>{invite.code}</Text>
                      <View
                        style={[
                          styles.roleBadge,
                          {
                            backgroundColor:
                              invite.role === "admin"
                                ? colors.warning + "20"
                                : invite.role === "alumni"
                                ? colors.muted + "20"
                                : colors.primary + "20",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.roleBadgeText,
                            {
                              color:
                                invite.role === "admin"
                                  ? colors.warning
                                  : invite.role === "alumni"
                                  ? colors.foreground
                                  : colors.primary,
                            },
                          ]}
                        >
                          {getRoleLabel(invite.role || "active_member")}
                        </Text>
                      </View>
                      {expired && (
                        <View style={[styles.statusBadge, { backgroundColor: colors.error + "20" }]}>
                          <Text style={[styles.statusBadgeText, { color: colors.error }]}>Expired</Text>
                        </View>
                      )}
                      {revoked && (
                        <View style={[styles.statusBadge, { backgroundColor: colors.error + "20" }]}>
                          <Text style={[styles.statusBadgeText, { color: colors.error }]}>Revoked</Text>
                        </View>
                      )}
                      {exhausted && (
                        <View style={[styles.statusBadge, { backgroundColor: colors.error + "20" }]}>
                          <Text style={[styles.statusBadgeText, { color: colors.error }]}>No uses left</Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.inviteMeta}>
                      {invite.uses_remaining !== null ? `${invite.uses_remaining} uses left` : "Unlimited uses"}
                      {invite.expires_at && ` • Expires ${formatDate(invite.expires_at)}`}
                    </Text>

                    <View style={styles.inviteActions}>
                      <Pressable style={styles.inviteAction} onPress={() => copyInviteLink(invite)}>
                        {copiedInviteId === invite.id ? (
                          <Check size={16} color={colors.success} />
                        ) : (
                          <Copy size={16} color={colors.primary} />
                        )}
                        <Text style={styles.inviteActionText}>
                          {copiedInviteId === invite.id ? "Copied!" : "Copy Link"}
                        </Text>
                      </Pressable>

                      <Pressable
                        style={styles.inviteAction}
                        onPress={() => setShowQRCode(showQRCode === invite.id ? null : invite.id)}
                      >
                        <QrCode size={16} color={colors.primary} />
                        <Text style={styles.inviteActionText}>QR</Text>
                      </Pressable>

                      {valid && (
                        <Pressable
                          style={styles.inviteAction}
                          onPress={() => {
                            Alert.alert("Revoke Invite", "This invite will no longer be valid.", [
                              { text: "Cancel", style: "cancel" },
                              { text: "Revoke", style: "destructive", onPress: () => revokeInvite(invite.id) },
                            ]);
                          }}
                        >
                          <X size={16} color={colors.warning} />
                          <Text style={[styles.inviteActionText, { color: colors.warning }]}>Revoke</Text>
                        </Pressable>
                      )}

                      <Pressable
                        style={styles.inviteAction}
                        onPress={() => {
                          Alert.alert("Delete Invite", "This will permanently delete the invite.", [
                            { text: "Cancel", style: "cancel" },
                            { text: "Delete", style: "destructive", onPress: () => deleteInvite(invite.id) },
                          ]);
                        }}
                      >
                        <Trash2 size={16} color={colors.error} />
                      </Pressable>
                    </View>

                    {showQRCode === invite.id && (
                      <View style={styles.qrContainer}>
                        <QRCode
                          value={getInviteLink(invite, getWebAppUrl())}
                          size={180}
                          backgroundColor={colors.card}
                          color={colors.foreground}
                        />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyText}>No invites yet. Create one to let people join.</Text>
          )}
        </View>
      )}
    </View>
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
    badge: {
      backgroundColor: colors.warning,
      borderRadius: 10,
      minWidth: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 6,
    },
    badgeText: {
      color: "#fff",
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
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
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 16,
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
    button: {
      flex: 1,
      backgroundColor: colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonText: {
      color: colors.primaryForeground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    quotaContainer: {
      gap: 8,
    },
    quotaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    quotaLabel: {
      fontSize: fontSize.sm,
      color: colors.muted,
    },
    quotaValue: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    createButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.primary,
      borderStyle: "dashed",
    },
    createButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.primary,
    },
    inviteForm: {
      marginTop: 16,
    },
    roleButtons: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 16,
    },
    roleButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    roleButtonActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + "10",
    },
    roleButtonText: {
      fontSize: fontSize.sm,
      color: colors.muted,
    },
    roleButtonTextActive: {
      color: colors.primary,
      fontWeight: fontWeight.semibold,
    },
    formActions: {
      flexDirection: "row",
      gap: 12,
      marginTop: 8,
    },
    cancelButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    cancelButtonText: {
      fontSize: fontSize.base,
      color: colors.muted,
    },
    invitesList: {
      marginTop: 16,
      gap: 12,
    },
    inviteItem: {
      backgroundColor: colors.background,
      padding: 12,
      borderRadius: 8,
    },
    inviteItemInvalid: {
      opacity: 0.6,
    },
    inviteHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    inviteCode: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      fontFamily: "monospace",
      color: colors.foreground,
    },
    roleBadge: {
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: 4,
    },
    roleBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
    },
    statusBadge: {
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: 4,
    },
    statusBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
    inviteMeta: {
      fontSize: 13,
      color: colors.mutedForeground,
      marginTop: 8,
    },
    inviteActions: {
      flexDirection: "row",
      gap: 16,
      marginTop: 12,
    },
    inviteAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    inviteActionText: {
      fontSize: fontSize.sm,
      color: colors.primary,
    },
    qrContainer: {
      alignItems: "center",
      paddingTop: 16,
      marginTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      textAlign: "center",
      paddingVertical: 24,
    },
  });
