import React, { useCallback } from "react";
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
import { useFocusEffect, useNavigation } from "expo-router";
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
  MenteeStatusToggle,
  MentorDirectorySection,
  MentorPairManager,
  MentorshipAdminPanel,
  MentorshipPairsList,
} from "@/components/mentorship";

export default function MentorshipScreen() {
  const { orgId, orgName, orgLogoUrl } = useOrg();
  const { user } = useAuth();
  const { role, isAdmin, isActiveMember, isAlumni, isLoading: roleLoading } = useOrgRole();
  const navigation = useNavigation();
  const styles = useThemedStyles(createStyles);

  const {
    visibleFilteredPairs,
    mentorDirectory,
    mentorIndustries,
    mentorYears,
    currentUserMentorProfile,
    logsByPair,
    userLabel,
    myMentorName,
    myLastLogDate,
    sectionOrder,
    showDirectory,
    loading,
    refreshing,
    error,
    pairs,
    refetch,
    refetchIfStale,
    archivePair,
  } = useMentorship(orgId, user?.id, role, isAdmin);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available
    }
  }, [navigation]);

  const showLoading = (loading || roleLoading) && pairs.length === 0;

  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
    }, [refetchIfStale])
  );

  const headerContent = (
    <LinearGradient
      colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
      style={styles.headerGradient}
    >
      <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
        <View style={styles.headerContent}>
          <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
            {orgLogoUrl ? (
              <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
            ) : (
              <View style={styles.orgAvatar}>
                <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
              </View>
            )}
          </Pressable>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Mentorship</Text>
            {!showLoading ? (
              <Text style={styles.headerMeta}>
                {visibleFilteredPairs.length} {visibleFilteredPairs.length === 1 ? "pair" : "pairs"}
              </Text>
            ) : null}
          </View>
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
            <Text style={styles.stateText}>Loading mentorship...</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {headerContent}
      <View style={styles.contentSheet}>
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

          {isActiveMember && orgId ? (
            <ActiveMemberMentorshipSummary
              myMentorName={myMentorName}
              myLastLogDate={myLastLogDate}
            />
          ) : null}

          {isActiveMember && orgId ? <MenteeStatusToggle orgId={orgId} /> : null}

          {isAdmin && orgId ? (
            <MentorshipAdminPanel orgId={orgId} onRefresh={refetch} />
          ) : null}

          {!isAdmin && isAlumni && orgId ? (
            <MentorPairManager orgId={orgId} onRefresh={refetch} />
          ) : null}

          {showDirectory && sectionOrder === "directory-first" ? (
            <MentorDirectorySection
              mentors={mentorDirectory}
              industries={mentorIndustries}
              years={mentorYears}
              showRegistration={isAlumni}
              currentUserProfile={currentUserMentorProfile}
              onRefresh={refetch}
            />
          ) : null}

          {orgId ? (
            <MentorshipPairsList
              pairs={visibleFilteredPairs}
              logsByPair={logsByPair}
              userLabel={userLabel}
              isAdmin={isAdmin}
              canLogActivity={isAdmin || isActiveMember}
              orgId={orgId}
              userId={user?.id ?? null}
              onRefresh={refetch}
              onArchive={archivePair}
            />
          ) : null}

          {showDirectory && sectionOrder === "pairs-first" ? (
            <MentorDirectorySection
              mentors={mentorDirectory}
              industries={mentorIndustries}
              years={mentorYears}
              showRegistration={isAlumni}
              currentUserProfile={currentUserMentorProfile}
              onRefresh={refetch}
            />
          ) : null}
        </ScrollView>
      </View>
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
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xl,
      gap: SPACING.lg,
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
