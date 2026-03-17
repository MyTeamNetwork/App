import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ScrollView,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";

import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import { Calendar, MapPin, Users, ExternalLink, Plus } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useEvents, type Event } from "@/hooks/useEvents";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { SkeletonList } from "@/components/ui/Skeleton";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS, SHADOWS, RSVP_COLORS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatLongWeekdayDate, formatWeekdayShort } from "@/lib/date-format";
import { getRsvpLabel, formatEventDate, formatEventTime } from "@teammeet/core";

type ViewMode = "upcoming" | "past";

export default function EventsScreen() {
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { isAdmin, permissions } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  // Use orgId from context for data hook (eliminates redundant org fetch)
  const { events, loading, error, refetch, refetchIfStale } = useEvents(orgId);
  const [viewMode, setViewMode] = useState<ViewMode>("upcoming");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null); // null = show all
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.surface,
    },
    // Gradient header styles
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
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
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700" as const,
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
    headerRight: {
      width: 36,
      alignItems: "flex-end" as const,
    },
    headerSpacer: {
      width: 36,
    },
    // Content sheet
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    // Toggle styles (segmented control)
    toggleContainer: {
      flexDirection: "row" as const,
      marginHorizontal: SPACING.md,
      marginTop: SPACING.md,
      marginBottom: SPACING.sm,
      backgroundColor: n.surface,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      padding: 2,
    },
    toggleButton: {
      flex: 1,
      paddingVertical: SPACING.sm,
      alignItems: "center" as const,
      borderRadius: RADIUS.sm,
    },
    toggleActive: {
      backgroundColor: n.background,
    },
    toggleText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.muted,
    },
    toggleTextActive: {
      color: n.foreground,
      fontWeight: "600" as const,
    },
    // Date strip styles
    dateStrip: {
      maxHeight: 76,
      marginBottom: SPACING.xs,
    },
    dateStripContent: {
      paddingHorizontal: SPACING.md,
      gap: SPACING.xs,
    },
    dateItem: {
      alignItems: "center" as const,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: RADIUS.md,
      minWidth: 48,
    },
    dateItemSelected: {
      backgroundColor: s.success,
    },
    dateDayName: {
      ...TYPOGRAPHY.overline,
      fontSize: 10,
      color: n.muted,
      marginBottom: 2,
    },
    dateDay: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    dateTextSelected: {
      color: "#ffffff",
    },
    dateToday: {
      color: s.success,
      fontWeight: "700" as const,
    },
    eventDot: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: s.success,
      marginTop: 4,
    },
    // List content
    listContent: {
      padding: SPACING.md,
      paddingTop: SPACING.sm,
      paddingBottom: 40,
      flexGrow: 1,
    },
    // Event card styles
    eventCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      marginBottom: SPACING.md,
      ...SHADOWS.sm,
    },
    eventHeader: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      marginBottom: SPACING.sm,
    },
    eventTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      flex: 1,
    },
    rsvpBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.lg,
      backgroundColor: n.border,
      marginLeft: SPACING.sm,
    },
    rsvpGoing: {
      backgroundColor: RSVP_COLORS.going.background,
    },
    rsvpMaybe: {
      backgroundColor: RSVP_COLORS.maybe.background,
    },
    rsvpText: {
      ...TYPOGRAPHY.labelSmall,
      color: n.foreground,
    },
    eventDetails: {
      gap: 4,
    },
    detailRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
    },
    detailText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      flex: 1,
    },
    locationText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      flex: 1,
    },
    // RSVP button
    rsvpButton: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: 8,
      alignItems: "center" as const,
      marginTop: SPACING.sm,
    },
    rsvpButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: s.success,
    },
    // Empty state styles
    emptyState: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingVertical: 48,
      paddingHorizontal: SPACING.md,
    },
    emptyStateInline: {
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingVertical: 32,
      paddingHorizontal: SPACING.md,
    },
    emptyCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.lg,
      alignItems: "center" as const,
      width: "100%",
      ...SHADOWS.sm,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      marginTop: SPACING.md,
    },
    emptyTitleSmall: {
      ...TYPOGRAPHY.titleSmall,
      color: n.secondary,
      marginTop: SPACING.sm,
    },
    emptySubtitle: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      marginTop: SPACING.xs,
      textAlign: "center" as const,
    },
    emptySubtitleSmall: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      marginTop: SPACING.xs,
      textAlign: "center" as const,
    },
    // Error state styles
    errorContainer: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: SPACING.md,
    },
    errorCard: {
      backgroundColor: s.errorLight,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: s.error,
      padding: SPACING.lg,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: s.error,
      textAlign: "center" as const,
    },
    // Loading state
    centered: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      padding: 24,
      backgroundColor: n.background,
    },
    skeletonContainer: {
      padding: SPACING.md,
      paddingTop: SPACING.md,
    },
  }));

  // Safe drawer toggle - only dispatch if drawer is available
  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available (web preview / tests) - no-op
    }
  }, [navigation]);

  // Admin overflow menu items - only approved mobile-friendly actions
  const adminMenuItems: OverflowMenuItem[] = useMemo(() => {
    if (!permissions.canUseAdminActions) return [];

    return [
      {
        id: "create-event",
        label: "Create Event",
        icon: <Plus size={20} color={semantic.success} />,
        onPress: () => {
          router.push(`/(app)/${orgSlug}/events/new`);
        },
      },
      {
        id: "open-in-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={neutral.foreground} />,
        onPress: () => {
          // Open the events page in the web app for full admin capabilities
          const webUrl = `https://www.myteamnetwork.com/${orgSlug}/events`;
          Linking.openURL(webUrl);
        },
      },
    ];
  }, [permissions.canUseAdminActions, orgSlug, router, semantic.success, neutral.foreground]);

  // Refetch on tab focus if data is stale
  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
    }, [refetchIfStale])
  );

  const handleRefresh = useCallback(async () => {
    if (isRefetchingRef.current) return;
    setRefreshing(true);
    isRefetchingRef.current = true;
    try {
      await refetch();
    } finally {
      setRefreshing(false);
      isRefetchingRef.current = false;
    }
  }, [refetch]);

  // Memoize 'now' to prevent unnecessary re-renders
  const now = useMemo(() => new Date(), []);

  // Filter events by upcoming/past
  const filteredEvents = useMemo(() => {
    const currentTime = new Date();
    return events.filter((event) => {
      const eventDate = new Date(event.start_date);
      return viewMode === "upcoming" ? eventDate >= currentTime : eventDate < currentTime;
    });
  }, [events, viewMode]);

  // Get next 7 days for the date strip
  const weekDates = useMemo(() => {
    const dates: Date[] = [];
    const start = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      dates.push(date);
    }
    return dates;
  }, []);

  // Check if a date has events
  const dateHasEvents = (date: Date) => {
    return events.some((event) => {
      const eventDate = new Date(event.start_date);
      return eventDate.toDateString() === date.toDateString();
    });
  };

  // Filter events for selected date (or show all if no date selected)
  const displayedEvents = useMemo(() => {
    if (selectedDate === null) {
      return filteredEvents; // Show all upcoming/past events
    }
    const selectedDateStr = selectedDate.toDateString();
    return filteredEvents.filter((event) => {
      const eventDate = new Date(event.start_date);
      return eventDate.toDateString() === selectedDateStr;
    });
  }, [filteredEvents, selectedDate]);


  const renderEventCard = useCallback(
    ({ item }: { item: Event }) => (
      <Pressable
        style={({ pressed }) => [styles.eventCard, pressed && { opacity: 0.7 }]}
        onPress={() => router.push(`/(app)/${orgSlug}/events/${item.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${item.start_date ? new Date(item.start_date).toLocaleDateString() : "no date"}`}
      >
      <View style={styles.eventHeader}>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {item.title}
        </Text>
        {item.user_rsvp_status && (
          <View
            style={[
              styles.rsvpBadge,
              item.user_rsvp_status === "going" && styles.rsvpGoing,
              item.user_rsvp_status === "maybe" && styles.rsvpMaybe,
            ]}
          >
            <Text style={styles.rsvpText}>
              {getRsvpLabel(item.user_rsvp_status)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.eventDetails}>
        <View style={styles.detailRow}>
          <Calendar size={13} color={neutral.secondary} />
          <Text style={styles.detailText}>
            {formatEventDate(item.start_date)} at {formatEventTime(item.start_date)}
            {item.end_date && ` - ${formatEventTime(item.end_date)}`}
          </Text>
        </View>

        {item.location && (
          <View style={styles.detailRow}>
            <MapPin size={13} color={neutral.muted} />
            <Text style={styles.locationText} numberOfLines={1}>
              {item.location}
            </Text>
          </View>
        )}

        {item.rsvp_count !== undefined && (
          <View style={styles.detailRow}>
            <Users size={13} color={neutral.muted} />
            <Text style={styles.locationText}>{item.rsvp_count} attending</Text>
          </View>
        )}
      </View>

      {/* Only show RSVP button for upcoming events without an existing status */}
      {viewMode === "upcoming" && !item.user_rsvp_status && (
        <Pressable style={({ pressed }) => [styles.rsvpButton, pressed && { opacity: 0.7 }]}>
          <Text style={styles.rsvpButtonText}>RSVP</Text>
        </Pressable>
      )}
    </Pressable>
    ),
    [router, orgSlug, viewMode, styles, neutral]
  );

  const renderEmptyState = () => {
    // Different empty states for date-filtered vs all events
    if (selectedDate !== null && viewMode === "upcoming") {
      // Inline empty state for specific date with no events
      const dateStr = formatLongWeekdayDate(selectedDate);
      return (
        <View style={styles.emptyStateInline}>
          <Calendar size={32} color={neutral.muted} />
          <Text style={styles.emptyTitleSmall}>No events on {dateStr}</Text>
          <Text style={styles.emptySubtitleSmall}>Select "All" to see all upcoming events</Text>
        </View>
      );
    }

    // Full empty state for no events at all
    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyCard}>
          <Calendar size={40} color={neutral.muted} />
          <Text style={styles.emptyTitle}>
            {viewMode === "upcoming" ? "No upcoming events" : "No past events"}
          </Text>
          <Text style={styles.emptySubtitle}>
            {viewMode === "upcoming"
              ? "Check back later for new events"
              : "Past events will appear here"}
          </Text>
        </View>
      </View>
    );
  };

  // Header subtitle text based on active tab
  const headerSubtitle = useMemo(() => {
    const currentTime = new Date();
    if (viewMode === "upcoming") {
      const count = events.filter((event) => new Date(event.start_date) >= currentTime).length;
      return `${count} upcoming`;
    } else {
      const count = events.filter((event) => new Date(event.start_date) < currentTime).length;
      return count > 0 ? `${count} past` : "Past events";
    }
  }, [events, viewMode]);

  if (loading && events.length === 0) {
    return (
      <View style={styles.container}>
        {/* Custom Gradient Header */}
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              {/* Logo */}
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {orgLogoUrl ? (
                  <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "E"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Events</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <Animated.View
          entering={FadeIn}
          exiting={FadeOut}
          style={[styles.contentSheet, styles.skeletonContainer]}
        >
          <SkeletonList type="event" count={4} />
        </Animated.View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        {/* Custom Gradient Header */}
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              {/* Logo */}
              <Pressable
                onPress={handleDrawerToggle}
                style={styles.orgLogoButton}
                accessibilityRole="button"
                accessibilityLabel={`Open navigation for ${orgName ?? "organization"}`}
              >
                {orgLogoUrl ? (
                  <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "E"}</Text>
                  </View>
                )}
              </Pressable>

              {/* Text (left-aligned) */}
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Events</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.errorContainer}>
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>Error loading events: {error}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Custom Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            {/* Logo */}
            <Pressable
              onPress={handleDrawerToggle}
              style={styles.orgLogoButton}
              accessibilityRole="button"
              accessibilityLabel={`Open navigation for ${orgName ?? "organization"}`}
            >
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "E"}</Text>
                </View>
              )}
            </Pressable>

            {/* Text (left-aligned) */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Events</Text>
              <Text style={styles.headerMeta}>
                {headerSubtitle}
              </Text>
            </View>

            {/* Admin menu */}
            {adminMenuItems.length > 0 && (
              <OverflowMenu items={adminMenuItems} accessibilityLabel="Event options" />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        {/* Toggle */}
        <View style={styles.toggleContainer}>
          <Pressable
            style={({ pressed }) => [styles.toggleButton, viewMode === "upcoming" && styles.toggleActive, pressed && { opacity: 0.7 }]}
            onPress={() => setViewMode("upcoming")}
            accessibilityRole="tab"
            accessibilityState={{ selected: viewMode === "upcoming" }}
            accessibilityLabel="Show upcoming events"
          >
            <Text
              style={[styles.toggleText, viewMode === "upcoming" && styles.toggleTextActive]}
            >
              Upcoming
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.toggleButton, viewMode === "past" && styles.toggleActive, pressed && { opacity: 0.7 }]}
            onPress={() => setViewMode("past")}
            accessibilityRole="tab"
            accessibilityState={{ selected: viewMode === "past" }}
            accessibilityLabel="Show past events"
          >
            <Text style={[styles.toggleText, viewMode === "past" && styles.toggleTextActive]}>
              Past
            </Text>
          </Pressable>
        </View>

        {/* 7-Day Strip (only for upcoming view) */}
        {viewMode === "upcoming" && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.dateStrip}
            contentContainerStyle={styles.dateStripContent}
          >
            {/* All button */}
            <Pressable
              style={({ pressed }) => [styles.dateItem, selectedDate === null && styles.dateItemSelected, pressed && { opacity: 0.7 }]}
              onPress={() => setSelectedDate(null)}
              accessibilityRole="button"
              accessibilityLabel="Show all events"
              accessibilityState={{ selected: selectedDate === null }}
            >
              <Text
                style={[
                  styles.dateDayName,
                  selectedDate === null && styles.dateTextSelected,
                ]}
              >
                All
              </Text>
              <Text
                style={[
                  styles.dateDay,
                  selectedDate === null && styles.dateTextSelected,
                ]}
              >
                {filteredEvents.length}
              </Text>
            </Pressable>

            {weekDates.map((date, index) => {
              const isSelected = selectedDate?.toDateString() === date.toDateString();
              const hasEvents = dateHasEvents(date);
              const isToday = date.toDateString() === now.toDateString();

              return (
                <Pressable
                  key={index}
                  style={({ pressed }) => [styles.dateItem, isSelected && styles.dateItemSelected, pressed && { opacity: 0.7 }]}
                  onPress={() => setSelectedDate(date)}
                  accessibilityRole="button"
                  accessibilityLabel={date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      styles.dateDayName,
                      isSelected && styles.dateTextSelected,
                      isToday && !isSelected && styles.dateToday,
                    ]}
                  >
                    {formatWeekdayShort(date)}
                  </Text>
                  <Text
                    style={[
                      styles.dateDay,
                      isSelected && styles.dateTextSelected,
                      isToday && !isSelected && styles.dateToday,
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                  {hasEvents && <View style={styles.eventDot} />}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Events List */}
        <FlatList
          data={displayedEvents}
          renderItem={renderEventCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={semantic.success} />
          }
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          updateCellsBatchingPeriod={50}
        />
      </View>
    </View>
  );
}
