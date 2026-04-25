import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { Sliders } from "lucide-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useMentorship } from "@/hooks/useMentorship";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import {
  ActiveMemberMentorshipSummary,
  AdminProposalsList,
  MentorDirectorySection,
  MenteePreferencesSheet,
  MentorshipAdminPanel,
  MentorshipPairCard,
  MentorshipTabsBar,
  MyProposalsSection,
  type MentorshipTabId,
} from "@/components/mentorship";
import type { MentorshipPair } from "@teammeet/types";

export default function MentorshipIndexScreen() {
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { user } = useAuth();
  const { role, isAdmin, isActiveMember, isAlumni, isLoading: roleLoading } = useOrgRole();
  const navigation = useNavigation();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);

  const {
    pairs,
    visibleFilteredPairs,
    mentorDirectory,
    mentorIndustries,
    mentorYears,
    currentUserMentorProfile,
    logsByPair,
    userLabel,
    myMentorName,
    myLastLogDate,
    loading,
    refreshing,
    error,
    refetch,
    refetchIfStale,
    archivePair,
  } = useMentorship(orgId, user?.id, role, isAdmin);

  const [activeTab, setActiveTab] = useState<MentorshipTabId>("pairs");
  const [showPreferences, setShowPreferences] = useState(false);

  const myProposals: MentorshipPair[] = useMemo(() => {
    if (!user?.id) return [];
    if (isActiveMember) {
      return pairs.filter(
        (p) =>
          p.mentee_user_id === user.id &&
          ["proposed", "declined"].includes(p.status as string)
      );
    }
    if (isAlumni) {
      return pairs.filter(
        (p) =>
          p.mentor_user_id === user.id &&
          ["proposed", "declined"].includes(p.status as string)
      );
    }
    return [];
  }, [pairs, user?.id, isActiveMember, isAlumni]);

  const proposedToMeCount = useMemo(() => {
    if (!user?.id) return 0;
    if (isActiveMember) {
      return pairs.filter(
        (p) => p.mentee_user_id === user.id && p.status === "proposed"
      ).length;
    }
    if (isAlumni) {
      return pairs.filter(
        (p) => p.mentor_user_id === user.id && p.status === "proposed"
      ).length;
    }
    return 0;
  }, [pairs, user?.id, isActiveMember, isAlumni]);

  const adminProposalCount = useMemo(
    () => (isAdmin ? pairs.filter((p) => p.status === "proposed").length : 0),
    [pairs, isAdmin]
  );

  const pendingMentorIds = useMemo(() => {
    if (!user?.id || !isActiveMember) return new Set<string>();
    return new Set(
      pairs
        .filter(
          (p) =>
            p.mentee_user_id === user.id &&
            ["proposed", "accepted", "active", "paused"].includes(p.status as string)
        )
        .map((p) => p.mentor_user_id)
    );
  }, [pairs, user?.id, isActiveMember]);

  const tabs = useMemo(() => {
    const list: Array<{ id: MentorshipTabId; label: string; badge?: number }> = [
      { id: "pairs", label: "Pairs", badge: visibleFilteredPairs.length || undefined },
      { id: "directory", label: "Directory" },
    ];
    if (isActiveMember || isAlumni) {
      list.push({
        id: "proposals",
        label: "Proposals",
        badge: proposedToMeCount || undefined,
      });
    }
    if (isAdmin) {
      list.push({
        id: "matches",
        label: "Matches",
        badge: adminProposalCount || undefined,
      });
    }
    return list;
  }, [
    visibleFilteredPairs.length,
    isActiveMember,
    isAlumni,
    isAdmin,
    proposedToMeCount,
    adminProposalCount,
  ]);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available
    }
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
    }, [refetchIfStale])
  );

  const showLoading = (loading || roleLoading) && pairs.length === 0;

  const headerContent = (
    <LinearGradient
      colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
      style={styles.headerGradient}
    >
      <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
        <View style={styles.headerContent}>
          <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
            {orgLogoUrl ? (
              <Image
                source={orgLogoUrl}
                style={styles.orgLogo}
                contentFit="contain"
                transition={200}
              />
            ) : (
              <View style={styles.orgAvatar}>
                <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
              </View>
            )}
          </Pressable>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Mentorship</Text>
            <Text style={styles.headerMeta}>
              {showLoading
                ? "Loading…"
                : isAdmin
                  ? `${pairs.length} ${pairs.length === 1 ? "pair" : "pairs"}`
                  : isActiveMember
                    ? myMentorName
                      ? `Paired with ${myMentorName}`
                      : "Find a mentor"
                    : "Help current members"}
            </Text>
          </View>
          {isActiveMember ? (
            <Pressable
              onPress={() => setShowPreferences(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.headerIconButton}
            >
              <Sliders size={18} color={APP_CHROME.headerTitle} />
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );

  if (showLoading) {
    return (
      <View style={styles.container}>
        {headerContent}
        <View style={styles.contentSheet}>
          <View style={styles.stateContainer}>
            <ActivityIndicator color={styles.loadingColor.color} />
            <Text style={styles.stateText}>Loading mentorship…</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {headerContent}
      <View style={styles.contentSheet}>
        <MentorshipTabsBar
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
        />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refetch}
              tintColor={styles.loadingColor.color}
            />
          }
          keyboardShouldPersistTaps="handled"
        >
          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                onPress={refetch}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && styles.retryButtonPressed,
                ]}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {activeTab === "pairs" ? (
            <>
              {isActiveMember ? (
                <ActiveMemberMentorshipSummary
                  myMentorName={myMentorName}
                  myLastLogDate={myLastLogDate}
                />
              ) : null}

              {isAdmin && orgId ? (
                <MentorshipAdminPanel orgId={orgId} onRefresh={refetch} />
              ) : null}

              {visibleFilteredPairs.length === 0 ? (
                <View style={styles.card}>
                  <Text style={styles.emptyTitle}>No mentorship pairs yet</Text>
                  <Text style={styles.emptySubtitle}>
                    {isActiveMember
                      ? "Browse the directory to request a mentor."
                      : isAlumni
                        ? "Members will appear here once paired with you."
                        : "Pairs will show up here as proposals are accepted."}
                  </Text>
                  {isActiveMember ? (
                    <Pressable
                      onPress={() => setActiveTab("directory")}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <Text style={styles.primaryButtonText}>Browse mentors</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <View style={styles.list}>
                  {visibleFilteredPairs.map((pair) => (
                    <Pressable
                      key={pair.id}
                      onPress={() =>
                        router.push(`/${orgSlug}/mentorship/${pair.id}`)
                      }
                    >
                      <MentorshipPairCard
                        pair={pair}
                        mentorLabel={userLabel(pair.mentor_user_id)}
                        menteeLabel={userLabel(pair.mentee_user_id)}
                        logs={logsByPair[pair.id] || []}
                        isAdmin={isAdmin}
                        canLogActivity={isAdmin || isActiveMember}
                        orgId={orgId || ""}
                        userId={user?.id ?? null}
                        userLabel={userLabel}
                        onRefresh={refetch}
                        onArchive={archivePair}
                      />
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          ) : null}

          {activeTab === "directory" && orgId ? (
            <MentorDirectorySection
              mentors={mentorDirectory}
              industries={mentorIndustries}
              years={mentorYears}
              showRegistration={isAlumni}
              currentUserProfile={currentUserMentorProfile}
              onRefresh={refetch}
              canRequest={isActiveMember}
              orgId={orgId}
              pendingMentorIds={pendingMentorIds}
            />
          ) : null}

          {activeTab === "proposals" ? (
            <MyProposalsSection pairs={myProposals} userLabel={userLabel} />
          ) : null}

          {activeTab === "matches" && isAdmin && orgId ? (
            <AdminProposalsList orgId={orgId} onChanged={refetch} />
          ) : null}
        </ScrollView>
      </View>

      {orgId ? (
        <MenteePreferencesSheet
          visible={showPreferences}
          orgId={orgId}
          onClose={() => setShowPreferences(false)}
          onSaved={refetch}
        />
      ) : null}
    </View>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
    },
    orgLogo: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    orgAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: APP_CHROME.avatarBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      fontSize: 16,
      fontWeight: "700",
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      fontSize: 12,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    headerIconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.08)",
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xl,
      gap: SPACING.lg,
    },
    list: {
      gap: SPACING.md,
    },
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
    },
    emptySubtitle: {
      fontSize: 14,
      color: n.muted,
    },
    primaryButton: {
      alignSelf: "flex-start",
      backgroundColor: s.success,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
    },
    primaryButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
    },
    buttonPressed: {
      opacity: 0.85,
    },
    stateContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: SPACING.sm,
    },
    stateText: {
      fontSize: 16,
      color: n.muted,
    },
    loadingColor: {
      color: s.success,
    },
    errorCard: {
      backgroundColor: `${s.error}14`,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      gap: SPACING.sm,
      borderWidth: 1,
      borderColor: `${s.error}55`,
    },
    errorText: {
      fontSize: 14,
      color: s.error,
    },
    retryButton: {
      alignSelf: "flex-start",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs + 2,
      borderRadius: RADIUS.md,
      backgroundColor: s.error,
    },
    retryButtonPressed: {
      opacity: 0.85,
    },
    retryButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
    },
  });
