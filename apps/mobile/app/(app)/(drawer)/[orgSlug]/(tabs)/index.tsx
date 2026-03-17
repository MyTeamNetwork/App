import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useFocusEffect, useNavigation } from "expo-router";
import { RefreshCw } from "lucide-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useEvents } from "@/hooks/useEvents";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useMembers } from "@/hooks/useMembers";
import { useOrgStats } from "@/hooks/useOrgStats";
import { useFeed } from "@/hooks/useFeed";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { FeedTab } from "@/components/home/FeedTab";
import { OverviewTab } from "@/components/home/OverviewTab";
import { EventsTab } from "@/components/home/EventsTab";
import type { EventCardEvent } from "@/components/cards/EventCard";

type ActiveTab = "feed" | "overview" | "events";

const TAB_LABELS: { key: ActiveTab; label: string }[] = [
  { key: "feed", label: "Feed" },
  { key: "overview", label: "Overview" },
  { key: "events", label: "Events" },
];

export default function HomeScreen() {
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  useOrgRole(); // subscribes to role changes; triggers re-render on role updates
  const isMountedRef = useRef(true);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available in web preview / tests — no-op
    }
  }, [navigation]);

  const [activeTab, setActiveTab] = useState<ActiveTab>("feed");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRefetchingRef = useRef(false);

  const { events, refetch: refetchEvents, refetchIfStale: refetchEventsIfStale } = useEvents(orgId);
  const { announcements, refetch: refetchAnnouncements, refetchIfStale: refetchAnnouncementsIfStale } = useAnnouncements(orgId);
  const { members, refetch: refetchMembers, refetchIfStale: refetchMembersIfStale } = useMembers(orgId);
  const { stats, refetch: refetchStats, refetchIfStale: refetchStatsIfStale } = useOrgStats(orgId);
  const {
    posts,
    loading: feedLoading,
    loadingMore,
    hasMore,
    pendingPosts,
    loadMore,
    refetch: refetchFeed,
    refetchIfStale: refetchFeedIfStale,
    acceptPendingPosts,
    toggleLike,
  } = useFeed(orgId);

  const fetchData = useCallback(async () => {
    if (!orgId || !user) return;
    // Role validation is handled by useOrgRole() and RLS on all data hooks.
    // This function just transitions from loading → ready state.
    if (isMountedRef.current) {
      setError(null);
      setLoading(false);
    }
  }, [orgId, user]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchData();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchData]);

  const memberCount = members.length;

  useFocusEffect(
    useCallback(() => {
      refetchEventsIfStale();
      refetchAnnouncementsIfStale();
      refetchMembersIfStale();
      refetchStatsIfStale();
      refetchFeedIfStale();
    }, [refetchEventsIfStale, refetchAnnouncementsIfStale, refetchMembersIfStale, refetchStatsIfStale, refetchFeedIfStale])
  );

  const handleRefresh = async () => {
    if (isRefetchingRef.current) return;
    setRefreshing(true);
    isRefetchingRef.current = true;
    try {
      await Promise.all([
        refetchEvents(),
        refetchAnnouncements(),
        refetchMembers(),
        refetchStats(),
        refetchFeed(),
      ]);
    } finally {
      setRefreshing(false);
      isRefetchingRef.current = false;
    }
  };

  const handlePostPress = useCallback(
    (postId: string) => router.push(`/(app)/(drawer)/${orgSlug}/feed/${postId}`),
    [router, orgSlug]
  );

  const handleCreatePost = useCallback(
    () => router.push(`/(app)/(drawer)/${orgSlug}/feed/new`),
    [router, orgSlug]
  );

  const handleNavigate = useCallback(
    (path: string) => router.push(path as any),
    [router]
  );

  const { transformedEvents, recentAnnouncements, eventsCount } = useMemo(() => {
    const now = new Date();
    const upcoming = events.filter((e) => new Date(e.start_date) >= now);

    const transformed: EventCardEvent[] = upcoming.slice(0, 5).map((event) => ({
      id: event.id,
      title: event.title,
      start_date: event.start_date,
      end_date: event.end_date,
      location: event.location,
      rsvp_count: event.rsvp_count,
      user_rsvp_status: event.user_rsvp_status as EventCardEvent["user_rsvp_status"],
    }));

    const recent = announcements.slice(0, 3);

    return {
      transformedEvents: transformed,
      recentAnnouncements: recent,
      eventsCount: upcoming.length,
    };
  }, [events, announcements]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={SEMANTIC.success} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <View style={styles.errorCard}>
          <RefreshCw size={40} color={NEUTRAL.border} />
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            onPress={handleRefresh}
            accessibilityLabel="Retry loading"
            accessibilityRole="button"
          >
            <RefreshCw size={16} color={NEUTRAL.surface} />
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]}>
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
              <Text style={styles.headerTitle} numberOfLines={1}>
                {orgName}
              </Text>
              <Text style={styles.headerMeta}>
                {memberCount} {memberCount === 1 ? "member" : "members"} · {eventsCount} {eventsCount === 1 ? "event" : "events"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        {/* Segmented Control */}
        <View style={styles.segmentedControl}>
          {TAB_LABELS.map(({ key, label }) => (
            <Pressable
              key={key}
              style={[styles.segment, activeTab === key && styles.segmentActive]}
              onPress={() => setActiveTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === key }}
            >
              <Text style={[styles.segmentText, activeTab === key && styles.segmentTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Tab Content */}
        {activeTab === "feed" && (
          <FeedTab
            posts={posts}
            pendingPosts={pendingPosts}
            loading={feedLoading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            onLoadMore={loadMore}
            onAcceptPending={acceptPendingPosts}
            onPostPress={handlePostPress}
            onLikeToggle={toggleLike}
            onCreatePost={handleCreatePost}
          />
        )}

        {activeTab === "overview" && (
          <OverviewTab
            orgSlug={orgSlug}
            stats={stats}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            onNavigate={handleNavigate}
          />
        )}

        {activeTab === "events" && (
          <EventsTab
            orgSlug={orgSlug}
            events={transformedEvents}
            announcements={recentAnnouncements.map((a) => ({
              id: a.id,
              title: a.title,
              body: a.body,
              created_at: a.created_at,
              is_pinned: a.is_pinned,
            }))}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            onNavigate={handleNavigate}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: NEUTRAL.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
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
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700",
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      ...TYPOGRAPHY.caption,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
      backgroundColor: NEUTRAL.background,
    },
    // Segmented control
    segmentedControl: {
      flexDirection: "row",
      backgroundColor: NEUTRAL.background,
      borderRadius: RADIUS.lg,
      padding: SPACING.xxs,
      marginHorizontal: SPACING.md,
      marginTop: SPACING.sm,
      marginBottom: SPACING.sm,
    },
    segment: {
      flex: 1,
      paddingVertical: SPACING.sm,
      alignItems: "center",
      borderRadius: RADIUS.md,
    },
    segmentActive: {
      backgroundColor: SEMANTIC.success,
      ...SHADOWS.sm,
    },
    segmentText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.muted,
    },
    segmentTextActive: {
      color: NEUTRAL.surface,
      fontWeight: "600",
    },
    // Error state
    errorCard: {
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      padding: SPACING.xl,
      alignItems: "center",
      ...SHADOWS.sm,
    },
    errorTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: NEUTRAL.foreground,
      marginTop: SPACING.sm,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: NEUTRAL.muted,
      textAlign: "center",
      marginTop: SPACING.xs,
    },
    retryButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      marginTop: SPACING.md,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
      backgroundColor: SEMANTIC.success,
    },
    retryButtonPressed: {
      opacity: 0.8,
    },
    retryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.surface,
    },
  });
