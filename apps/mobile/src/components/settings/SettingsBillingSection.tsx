import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Alert,
  Modal,
} from "react-native";
import { CreditCard, ChevronDown, Check, ExternalLink } from "lucide-react-native";
import { useSubscription } from "@/hooks/useSubscription";
import { StripeWebView } from "@/components/StripeWebView";
import { formatMonthDayYearSafe } from "@/lib/date-format";
import { fetchWithAuth } from "@/lib/web-api";
import { captureException } from "@/lib/analytics";
import type { AlumniBucket } from "@teammeet/types";
import { type SettingsColors } from "./settingsColors";

interface Props {
  orgId: string;
  orgSlug: string;
  isAdmin: boolean;
  colors: SettingsColors;
}

const ALUMNI_LIMITS: Record<AlumniBucket, number | null> = {
  none: 0,
  "0-250": 250,
  "251-500": 500,
  "501-1000": 1000,
  "1001-2500": 2500,
  "2500-5000": 5000,
  "5000+": null,
};

const BUCKET_OPTIONS: { value: AlumniBucket; label: string }[] = [
  { value: "0-250", label: "0–250 alumni" },
  { value: "251-500", label: "251–500 alumni" },
  { value: "501-1000", label: "501–1,000 alumni" },
  { value: "1001-2500", label: "1,001–2,500 alumni" },
  { value: "2500-5000", label: "2,500–5,000 alumni" },
  { value: "5000+", label: "5,000+ (contact us)" },
];

function formatDate(dateString: string | null): string {
  return formatMonthDayYearSafe(dateString, "N/A");
}

function formatBucket(bucket: string): string {
  if (bucket === "none") return "Base Plan";
  return `Alumni ${bucket}`;
}

function formatStatus(status: string, colors: SettingsColors): { label: string; color: string } {
  switch (status) {
    case "active":
      return { label: "Active", color: colors.success };
    case "trialing":
      return { label: "Trial", color: colors.primary };
    case "past_due":
      return { label: "Past Due", color: colors.warning };
    case "canceled":
    case "canceling":
      return {
        label: status === "canceling" ? "Canceling" : "Canceled",
        color: colors.error,
      };
    default:
      return { label: status, color: colors.mutedForeground };
  }
}

const fontSize = { xs: 12, sm: 14, base: 16, lg: 18 };
const fontWeight = {
  normal: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

export function SettingsBillingSection({ orgId, orgSlug, isAdmin, colors }: Props) {
  const { subscription, loading: subLoading, error: subError, refetch: refetchSubscription } = useSubscription(orgId);

  const [expanded, setExpanded] = useState(true);
  const [billingPortalUrl, setBillingPortalUrl] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<AlumniBucket>("0-250");
  const [selectedInterval, setSelectedInterval] = useState<"month" | "year">("month");
  const [planUpdating, setPlanUpdating] = useState(false);
  const [showBucketPicker, setShowBucketPicker] = useState(false);

  useEffect(() => {
    if (subscription?.bucket) {
      setSelectedBucket(subscription.bucket);
    }
  }, [subscription?.bucket]);

  if (!isAdmin) return null;

  const statusInfo = subscription ? formatStatus(subscription.status, colors) : null;

  const handleManageBilling = async () => {
    if (!orgId) return;

    setBillingLoading(true);
    try {
      const response = await fetchWithAuth("/api/stripe/billing-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.error || "Failed to open billing portal");
        return;
      }

      if (data.url) {
        setBillingPortalUrl(data.url);
      }
    } catch (e) {
      Alert.alert("Error", "Failed to open billing portal");
      captureException(e as Error, { screen: "Settings", context: "billingPortal", orgId });
    } finally {
      setBillingLoading(false);
    }
  };

  const handleCloseBillingPortal = () => {
    setBillingPortalUrl(null);
    refetchSubscription();
  };

  const handleUpdatePlan = async () => {
    if (!orgId) return;

    const targetLimit = ALUMNI_LIMITS[selectedBucket];
    if (subscription && targetLimit !== null && subscription.alumniCount > targetLimit) {
      Alert.alert("Error", "You have more alumni than this plan allows. Choose a larger plan.");
      return;
    }

    setPlanUpdating(true);
    try {
      const endpoint = !subscription?.stripeSubscriptionId
        ? `/api/organizations/${orgId}/start-checkout`
        : `/api/organizations/${orgId}/subscription`;

      const response = await fetchWithAuth(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alumniBucket: selectedBucket, interval: selectedInterval }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to update subscription");
      }

      if (data.url) {
        setBillingPortalUrl(data.url);
      } else {
        Alert.alert("Success", "Subscription updated.");
        refetchSubscription();
      }
    } catch (e) {
      Alert.alert("Error", (e as Error).message);
    } finally {
      setPlanUpdating(false);
    }
  };

  const styles = createStyles(colors);

  return (
    <>
      <View style={styles.section}>
        <Pressable
          style={({ pressed }) => [styles.sectionHeader, pressed && { opacity: 0.7 }]}
          onPress={() => setExpanded((prev) => !prev)}
        >
          <View style={styles.sectionHeaderLeft}>
            <CreditCard size={20} color={colors.muted} />
            <Text style={styles.sectionTitle}>Billing</Text>
          </View>
          <ChevronDown
            size={20}
            color={colors.mutedForeground}
            style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
          />
        </Pressable>

        {expanded && (
          <View style={styles.card}>
            {subLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.loadingText}>Loading subscription...</Text>
              </View>
            ) : subError ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{subError}</Text>
                <Pressable onPress={refetchSubscription} style={styles.retryButton}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </Pressable>
              </View>
            ) : subscription ? (
              <>
                <View style={styles.subscriptionCard}>
                  <View style={styles.subscriptionRow}>
                    <Text style={styles.subscriptionLabel}>Current Plan</Text>
                    <Text style={styles.subscriptionValue}>{formatBucket(subscription.bucket)}</Text>
                  </View>
                  <View style={styles.subscriptionRow}>
                    <Text style={styles.subscriptionLabel}>Status</Text>
                    <View style={[styles.statusBadgeLarge, { backgroundColor: statusInfo?.color + "20" }]}>
                      <View style={[styles.statusDot, { backgroundColor: statusInfo?.color }]} />
                      <Text style={[styles.statusTextLarge, { color: statusInfo?.color }]}>
                        {statusInfo?.label}
                      </Text>
                    </View>
                  </View>
                  {subscription.currentPeriodEnd && (
                    <View style={styles.subscriptionRow}>
                      <Text style={styles.subscriptionLabel}>Next Billing</Text>
                      <Text style={styles.subscriptionValue}>{formatDate(subscription.currentPeriodEnd)}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.divider} />

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Change Plan</Text>
                  <Pressable style={styles.pickerButton} onPress={() => setShowBucketPicker(true)}>
                    <Text style={styles.pickerButtonText}>
                      {BUCKET_OPTIONS.find((o) => o.value === selectedBucket)?.label || selectedBucket}
                    </Text>
                    <ChevronDown size={16} color={colors.mutedForeground} />
                  </Pressable>

                  <View style={styles.intervalRow}>
                    <Pressable
                      style={[styles.intervalButton, selectedInterval === "month" && styles.intervalButtonActive]}
                      onPress={() => setSelectedInterval("month")}
                    >
                      <Text
                        style={[
                          styles.intervalButtonText,
                          selectedInterval === "month" && styles.intervalButtonTextActive,
                        ]}
                      >
                        Monthly
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.intervalButton, selectedInterval === "year" && styles.intervalButtonActive]}
                      onPress={() => setSelectedInterval("year")}
                    >
                      <Text
                        style={[
                          styles.intervalButtonText,
                          selectedInterval === "year" && styles.intervalButtonTextActive,
                        ]}
                      >
                        Yearly (save ~17%)
                      </Text>
                    </Pressable>
                  </View>

                  <Pressable
                    style={[
                      styles.button,
                      (planUpdating || selectedBucket === subscription.bucket) && styles.buttonDisabled,
                    ]}
                    onPress={handleUpdatePlan}
                    disabled={planUpdating || selectedBucket === subscription.bucket}
                  >
                    {planUpdating ? (
                      <ActivityIndicator size="small" color={colors.primaryForeground} />
                    ) : (
                      <Text style={styles.buttonText}>Update Plan</Text>
                    )}
                  </Pressable>
                </View>

                <View style={styles.divider} />

                <Pressable
                  style={styles.billingButton}
                  onPress={handleManageBilling}
                  disabled={billingLoading || !subscription.stripeCustomerId}
                >
                  {billingLoading ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <>
                      <CreditCard size={18} color={colors.primaryForeground} />
                      <Text style={styles.billingButtonText}>Manage Billing</Text>
                      <ExternalLink size={16} color={colors.primaryForeground} />
                    </>
                  )}
                </Pressable>
              </>
            ) : (
              <View style={styles.noSubscription}>
                <Text style={styles.noSubscriptionText}>No active subscription found.</Text>
                <Text style={styles.noSubscriptionHint}>Set up billing from the web app.</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {billingPortalUrl && (
        <StripeWebView
          visible={!!billingPortalUrl}
          url={billingPortalUrl}
          onClose={handleCloseBillingPortal}
          title="Billing Portal"
          successUrls={[`/${orgSlug}`]}
          cancelUrls={[`/${orgSlug}`]}
        />
      )}

      <Modal visible={showBucketPicker} transparent animationType="slide">
        <Pressable style={styles.pickerOverlay} onPress={() => setShowBucketPicker(false)}>
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Select Alumni Plan</Text>
            {BUCKET_OPTIONS.map((option) => {
              const limit = ALUMNI_LIMITS[option.value];
              const disabled = subscription && limit !== null && subscription.alumniCount > limit;
              return (
                <Pressable
                  key={option.value}
                  style={[styles.pickerOption, disabled && styles.pickerOptionDisabled]}
                  onPress={() => {
                    if (!disabled) {
                      setSelectedBucket(option.value);
                      setShowBucketPicker(false);
                    }
                  }}
                  disabled={disabled ?? false}
                >
                  <Text style={[styles.pickerOptionText, disabled && styles.pickerOptionTextDisabled]}>
                    {option.label}
                  </Text>
                  {selectedBucket === option.value && <Check size={18} color={colors.primary} />}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
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
      gap: 8,
    },
    loadingText: {
      fontSize: fontSize.sm,
      color: colors.muted,
    },
    errorContainer: {
      padding: 16,
      alignItems: "center",
      gap: 12,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: colors.error,
      textAlign: "center",
    },
    retryButton: {
      backgroundColor: colors.primary,
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 6,
    },
    retryButtonText: {
      color: colors.primaryForeground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 16,
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
    button: {
      backgroundColor: colors.primary,
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
      color: colors.primaryForeground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    subscriptionCard: {
      gap: 12,
    },
    subscriptionRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    subscriptionLabel: {
      fontSize: fontSize.sm,
      color: colors.muted,
    },
    subscriptionValue: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    statusBadgeLarge: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 12,
      gap: 6,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    statusTextLarge: {
      fontSize: 13,
      fontWeight: fontWeight.semibold,
    },
    pickerButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      marginBottom: 12,
    },
    pickerButtonText: {
      fontSize: fontSize.base,
      color: colors.foreground,
    },
    intervalRow: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 12,
    },
    intervalButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    intervalButtonActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + "10",
    },
    intervalButtonText: {
      fontSize: fontSize.sm,
      color: colors.muted,
    },
    intervalButtonTextActive: {
      color: colors.primary,
      fontWeight: fontWeight.semibold,
    },
    billingButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
      paddingVertical: 12,
      borderRadius: 8,
      gap: 8,
    },
    billingButtonText: {
      color: colors.primaryForeground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    noSubscription: {
      padding: 24,
      alignItems: "center",
      gap: 8,
    },
    noSubscriptionText: {
      fontSize: 15,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
      textAlign: "center",
    },
    noSubscriptionHint: {
      fontSize: fontSize.sm,
      color: colors.muted,
      textAlign: "center",
    },
    pickerOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    pickerContent: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      paddingBottom: 40,
    },
    pickerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      marginBottom: 16,
      textAlign: "center",
    },
    pickerOption: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    pickerOptionDisabled: {
      opacity: 0.5,
    },
    pickerOptionText: {
      fontSize: fontSize.base,
      color: colors.foreground,
    },
    pickerOptionTextDisabled: {
      color: colors.muted,
    },
  });
