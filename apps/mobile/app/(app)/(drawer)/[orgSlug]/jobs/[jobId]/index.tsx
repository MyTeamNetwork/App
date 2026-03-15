import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  ExternalLink,
  Mail,
  MapPin,
  MoreHorizontal,
} from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useJobs } from "@/hooks/useJobs";
import { useOrgRole } from "@/hooks/useOrgRole";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import type { JobPostingWithPoster } from "@/types/jobs";

const LOCATION_TYPE_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  remote: { label: "Remote", bg: SEMANTIC.infoLight, color: SEMANTIC.infoDark },
  onsite: { label: "On-site", bg: SEMANTIC.warningLight, color: SEMANTIC.warningDark },
  hybrid: { label: "Hybrid", bg: SEMANTIC.successLight, color: SEMANTIC.successDark },
};

const EXPERIENCE_LEVEL_LABELS: Record<string, string> = {
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

export default function JobDetailScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { orgId, orgSlug } = useOrg();
  const router = useRouter();
  const { user } = useAuth();
  const { permissions } = useOrgRole();
  const { jobs, deleteJob } = useJobs(orgId);

  const [isDeleting, setIsDeleting] = useState(false);

  const styles = useMemo(() => createStyles(), []);

  const job: JobPostingWithPoster | undefined = useMemo(
    () => jobs.find((j) => j.id === jobId),
    [jobs, jobId]
  );

  const isOwner = user != null && job != null && job.posted_by === user.id;
  const canManage = isOwner || permissions.canUseAdminActions;

  const handleApply = useCallback(() => {
    if (!job) return;
    if (job.application_url) {
      Linking.openURL(job.application_url);
    } else if (job.contact_email) {
      Linking.openURL(`mailto:${job.contact_email}`);
    }
  }, [job]);

  const handleEdit = useCallback(() => {
    router.push(`/(app)/(drawer)/${orgSlug}/jobs/${jobId}/edit`);
  }, [router, orgSlug, jobId]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      "Delete Job Posting",
      "Are you sure you want to delete this job posting? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (!jobId) return;
            setIsDeleting(true);
            try {
              await deleteJob(jobId);
              router.back();
            } catch (e) {
              Alert.alert("Error", (e as Error).message || "Failed to delete job posting.");
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  }, [jobId, deleteJob, router]);

  const overflowItems: OverflowMenuItem[] = useMemo(() => {
    if (!canManage) return [];
    return [
      {
        id: "edit",
        label: "Edit Job",
        icon: <Briefcase size={20} color={NEUTRAL.foreground} />,
        onPress: handleEdit,
      },
      {
        id: "delete",
        label: "Delete Job",
        icon: <MoreHorizontal size={20} color={SEMANTIC.error} />,
        onPress: handleDelete,
        destructive: true,
      },
    ];
  }, [canManage, handleEdit, handleDelete]);

  const canApply =
    job != null && (job.application_url != null || job.contact_email != null);

  if (job == null) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.navHeader}>
              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}
              >
                <ArrowLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>Job Details</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.centered}>
          <ActivityIndicator color={SEMANTIC.success} />
        </View>
      </View>
    );
  }

  const locationConfig = job.location_type ? LOCATION_TYPE_CONFIG[job.location_type] : null;
  const experienceLabel = job.experience_level
    ? EXPERIENCE_LEVEL_LABELS[job.experience_level]
    : null;
  const posterName = job.poster?.name ?? "Unknown";
  const relativeDate = formatRelativeDate(job.created_at);

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.navHeader}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}
            >
              <ArrowLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Job Details
            </Text>
            {overflowItems.length > 0 && (
              <OverflowMenu
                items={overflowItems}
                accessibilityLabel="Job options"
                iconColor={APP_CHROME.headerTitle}
              />
            )}
            {overflowItems.length === 0 && <View style={styles.headerSpacer} />}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Title & Company */}
        <View style={styles.titleSection}>
          <Text style={styles.jobTitle}>{job.title}</Text>
          <View style={styles.companyRow}>
            <Building2 size={16} color={NEUTRAL.muted} />
            <Text style={styles.companyText}>{job.company}</Text>
          </View>
          {job.location != null && (
            <View style={styles.locationRow}>
              <MapPin size={16} color={NEUTRAL.muted} />
              <Text style={styles.locationText}>{job.location}</Text>
            </View>
          )}
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

        {/* Description */}
        {job.description != null && job.description.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About the Role</Text>
            <Text style={styles.descriptionText} selectable>
              {job.description}
            </Text>
          </View>
        )}

        {/* Contact Info */}
        {(job.application_url != null || job.contact_email != null) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How to Apply</Text>
            {job.application_url != null && (
              <Pressable
                onPress={() => Linking.openURL(job.application_url!)}
                style={({ pressed }) => [styles.contactRow, pressed && { opacity: 0.7 }]}
              >
                <ExternalLink size={16} color={SEMANTIC.info} />
                <Text style={styles.contactLink} numberOfLines={1}>
                  {job.application_url}
                </Text>
              </Pressable>
            )}
            {job.contact_email != null && (
              <Pressable
                onPress={() => Linking.openURL(`mailto:${job.contact_email}`)}
                style={({ pressed }) => [styles.contactRow, pressed && { opacity: 0.7 }]}
              >
                <Mail size={16} color={SEMANTIC.info} />
                <Text style={styles.contactLink}>{job.contact_email}</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Posted By */}
        <View style={styles.footerSection}>
          <Text style={styles.footerText}>
            Posted by {posterName} · {relativeDate}
          </Text>
          {job.expires_at != null && (
            <Text style={styles.footerText}>
              Expires {new Date(job.expires_at).toLocaleDateString()}
            </Text>
          )}
        </View>
      </ScrollView>

      {/* Apply Button */}
      {canApply && (
        <View style={styles.applyContainer}>
          <SafeAreaView edges={["bottom"]} style={styles.applyInner}>
            <Pressable
              onPress={handleApply}
              style={({ pressed }) => [styles.applyButton, pressed && styles.applyButtonPressed]}
              accessibilityRole="button"
              accessibilityLabel="Apply for this job"
            >
              <Text style={styles.applyButtonText}>Apply Now</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      )}

      {isDeleting && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={SEMANTIC.success} />
        </View>
      )}
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    headerGradient: {
      paddingBottom: SPACING.xs,
    },
    headerSafeArea: {},
    navHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    backButton: {
      padding: SPACING.xs,
      marginLeft: -SPACING.xs,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
      flex: 1,
    },
    headerSpacer: {
      width: 36,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
      gap: SPACING.md,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
    },
    titleSection: {
      gap: SPACING.xs,
    },
    jobTitle: {
      ...TYPOGRAPHY.headlineLarge,
      color: NEUTRAL.foreground,
    },
    companyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.xs,
    },
    companyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.secondary,
    },
    locationRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.xs,
    },
    locationText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.muted,
    },
    badgeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.xs,
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
    section: {
      backgroundColor: NEUTRAL.background,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      gap: SPACING.sm,
      ...SHADOWS.sm,
    },
    sectionTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: NEUTRAL.foreground,
    },
    descriptionText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.secondary,
      lineHeight: 24,
    },
    contactRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
    },
    contactLink: {
      ...TYPOGRAPHY.bodyMedium,
      color: SEMANTIC.info,
      flex: 1,
    },
    footerSection: {
      gap: SPACING.xxs,
      paddingTop: SPACING.sm,
    },
    footerText: {
      ...TYPOGRAPHY.caption,
      color: NEUTRAL.muted,
    },
    applyContainer: {
      borderTopWidth: 1,
      borderTopColor: NEUTRAL.border,
      backgroundColor: NEUTRAL.surface,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.sm,
    },
    applyInner: {},
    applyButton: {
      backgroundColor: SEMANTIC.success,
      borderRadius: RADIUS.lg,
      paddingVertical: SPACING.md,
      alignItems: "center",
    },
    applyButtonPressed: {
      opacity: 0.9,
    },
    applyButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
      fontWeight: "600",
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(255, 255, 255, 0.8)",
      justifyContent: "center",
      alignItems: "center",
    },
  });
