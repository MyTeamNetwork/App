# Mobile Home Screen Redesign Implementation Plan

> **For Claude:** Tasks marked "Depends on: none" form Wave 1 and can run in
> parallel. Tasks with dependencies wait for their prerequisites to complete.
> REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** Redesign the mobile Home tab from a static dashboard into a 3-segment tabbed layout (Feed | Overview | Events) that matches the webapp's combined feed + sidebar experience.

**Architecture:** The Home screen (`apps/mobile/app/(app)/(drawer)/[orgSlug]/(tabs)/index.tsx`) becomes a container with a segmented control. Each segment is a separate component in `src/components/home/`. The Feed segment reuses the existing `useFeed` hook and `PostCard` components. The Overview segment extends `useOrgStats` with donation data. The Events segment reuses `useEvents` and `useAnnouncements`. The standalone Feed drawer entry and `socialFeedEnabled` feature flag are removed.

**Tech Stack:** React Native, Expo Router 6, Supabase, StyleSheet API, `@react-native-segmented-control/segmented-control`, `react-native-reanimated`, existing hooks (`useFeed`, `useOrgStats`, `useEvents`, `useAnnouncements`)

**UI Guidelines (from building-ui skill):**
- Use native `@react-native-segmented-control/segmented-control` — built-in haptics, dark mode adaptation, max 4 options
- Add Reanimated `FadeIn`/`FadeOut` animations for segment transitions
- Use `borderCurve: 'continuous'` on rounded corners (not capsule shapes)
- Use `contentInsetAdjustmentBehavior="automatic"` on ScrollViews/FlatLists
- Add `selectable` prop to Text elements displaying important data (stats, donation amounts)
- Use `fontVariant: ['tabular-nums']` for numeric counters
- Use flex `gap` over margin/padding where possible

---

### Task 0: Install Native Segmented Control
**Depends on:** none

**Step 1: Install the package**

```bash
cd apps/mobile && npx expo install @react-native-segmented-control/segmented-control
```

This package is compatible with Expo Go — no custom build needed.

**Step 2: Commit**

```bash
git add apps/mobile/package.json bun.lock
git commit -m "chore(mobile): add @react-native-segmented-control/segmented-control"
```

---

### Task 1: HomeSegmentedControl Wrapper
**Depends on:** Task 0

**Files:**
- Create: `apps/mobile/src/components/home/HomeSegmentedControl.tsx`

**Step 1: Write the component**

Wraps the native SegmentedControl with our segment type mapping. Avoids custom colors per building-ui guidelines — native styling adapts to dark mode automatically.

```tsx
import React, { useCallback } from "react";
import { View, StyleSheet } from "react-native";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import { SPACING } from "@/lib/design-tokens";

export type HomeSegment = "feed" | "overview" | "events";

const SEGMENT_VALUES = ["Feed", "Overview", "Events"];
const SEGMENT_KEYS: HomeSegment[] = ["feed", "overview", "events"];

interface HomeSegmentedControlProps {
  activeSegment: HomeSegment;
  onSegmentChange: (segment: HomeSegment) => void;
}

export function HomeSegmentedControl({
  activeSegment,
  onSegmentChange,
}: HomeSegmentedControlProps) {
  const selectedIndex = SEGMENT_KEYS.indexOf(activeSegment);

  const handleChange = useCallback(
    ({ nativeEvent }: { nativeEvent: { selectedSegmentIndex: number } }) => {
      const segment = SEGMENT_KEYS[nativeEvent.selectedSegmentIndex];
      if (segment) {
        onSegmentChange(segment);
      }
    },
    [onSegmentChange]
  );

  return (
    <View style={styles.container}>
      <SegmentedControl
        values={SEGMENT_VALUES}
        selectedIndex={selectedIndex}
        onChange={handleChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
});
```

**Step 2: Commit**

```bash
git add apps/mobile/src/components/home/HomeSegmentedControl.tsx
git commit -m "feat(mobile): add HomeSegmentedControl using native iOS control"
```

---

### Task 2: FeedComposerBar Component
**Depends on:** none

**Files:**
- Create: `apps/mobile/src/components/home/FeedComposerBar.tsx`

**Step 1: Write the component**

A pressable bar that looks like a text input showing "What's on your mind?" — taps navigate to the `feed/new` screen.

```tsx
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useAuth } from "@/hooks/useAuth";
import { NEUTRAL, SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

interface FeedComposerBarProps {
  onPress: () => void;
}

export function FeedComposerBar({ onPress }: FeedComposerBarProps) {
  const { user } = useAuth();
  const userMeta = (user?.user_metadata ?? {}) as { name?: string; avatar_url?: string };
  const avatarUrl = userMeta.avatar_url || "";
  const initial = (userMeta.name || user?.email || "?")[0].toUpperCase();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Create a new post"
    >
      {avatarUrl ? (
        <Image source={avatarUrl} style={styles.avatar} contentFit="cover" transition={200} />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarFallbackText}>{initial}</Text>
        </View>
      )}
      <Text style={styles.placeholder}>What's on your mind?</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    padding: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    gap: SPACING.sm,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  pressed: {
    opacity: 0.7,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: NEUTRAL.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.secondary,
    fontWeight: "600",
  },
  placeholder: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.placeholder,
    flex: 1,
  },
});
```

**Step 2: Commit**

```bash
git add apps/mobile/src/components/home/FeedComposerBar.tsx
git commit -m "feat(mobile): add FeedComposerBar component"
```

---

### Task 3: Extend useOrgStats with Total Donations
**Depends on:** none

**Files:**
- Modify: `apps/mobile/src/hooks/useOrgStats.ts`

**Step 1: Write a failing test**

Create test file:

```ts
// __tests__/hooks/useOrgStats.test.ts
import { OrgStats } from "@/hooks/useOrgStats";

describe("OrgStats type", () => {
  it("includes totalDonations field", () => {
    const stats: OrgStats = {
      activeMembers: 10,
      alumni: 5,
      upcomingEvents: 3,
      totalDonations: 1500,
    };
    expect(stats.totalDonations).toBe(1500);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/mobile && bun test -- __tests__/hooks/useOrgStats.test.ts
```
Expected: FAIL — `totalDonations` is not in `OrgStats`.

**Step 3: Add totalDonations to useOrgStats**

In `apps/mobile/src/hooks/useOrgStats.ts`:

1. Add `totalDonations: number` to `OrgStats` interface (line 8, after `upcomingEvents`)
2. Add `totalDonations: 0` to `DEFAULT_STATS` (line 22, after `upcomingEvents: 0`)
3. Add a 4th query to the `Promise.all` (after `eventsResult` on line 63):

```ts
supabase
  .from("organization_donation_stats")
  .select("total_amount_cents")
  .eq("organization_id", orgId)
  .single(),
```

4. Destructure as `donationResult` in the `Promise.all` result array
5. Add to `setStats` call: `totalDonations: (donationResult.data?.total_amount_cents ?? 0) / 100`

**Step 4: Run test to verify it passes**

```bash
cd apps/mobile && bun test -- __tests__/hooks/useOrgStats.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add apps/mobile/src/hooks/useOrgStats.ts apps/mobile/__tests__/hooks/useOrgStats.test.ts
git commit -m "feat(mobile): add totalDonations to useOrgStats hook"
```

---

### Task 4: FeedTab Component
**Depends on:** Task 2

**Files:**
- Create: `apps/mobile/src/components/home/FeedTab.tsx`

**Step 1: Write the component**

Wraps the existing feed FlatList with a composer bar at the top. Receives `useFeed` return values as props to avoid re-instantiating the hook.

```tsx
import React, { useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { PostCard } from "@/components/feed/PostCard";
import { NewPostsBanner } from "@/components/feed/NewPostsBanner";
import { FeedComposerBar } from "./FeedComposerBar";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { FeedPost, UseFeedReturn } from "@/types/feed";

interface FeedTabProps {
  feed: UseFeedReturn;
}

export function FeedTab({ feed }: FeedTabProps) {
  const router = useRouter();
  const { orgSlug } = useOrg();
  const { isAdmin, isActiveMember } = useOrgRole();
  const canCreatePost = isAdmin || isActiveMember;
  const flatListRef = useRef<FlatList>(null);
  const isRefetchingRef = useRef(false);

  const handlePostPress = useCallback(
    (postId: string) => {
      router.push(`/(app)/(drawer)/${orgSlug}/feed/${postId}`);
    },
    [router, orgSlug]
  );

  const handleCreatePost = useCallback(() => {
    router.push(`/(app)/(drawer)/${orgSlug}/feed/new`);
  }, [router, orgSlug]);

  const handleAcceptPending = useCallback(() => {
    feed.acceptPendingPosts();
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [feed]);

  const handleRefresh = useCallback(async () => {
    if (isRefetchingRef.current) return;
    isRefetchingRef.current = true;
    try {
      await feed.refetch();
    } finally {
      isRefetchingRef.current = false;
    }
  }, [feed]);

  const renderPost = useCallback(
    ({ item }: { item: FeedPost }) => (
      <PostCard post={item} onPress={handlePostPress} onLikeToggle={feed.toggleLike} />
    ),
    [handlePostPress, feed.toggleLike]
  );

  const ListHeader = canCreatePost ? (
    <FeedComposerBar onPress={handleCreatePost} />
  ) : null;

  return (
    <View style={styles.container}>
      {feed.pendingPosts.length > 0 && (
        <NewPostsBanner count={feed.pendingPosts.length} onPress={handleAcceptPending} />
      )}
      <FlatList
        ref={flatListRef}
        data={feed.posts}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.listContent}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={feed.loading && feed.posts.length > 0}
            onRefresh={handleRefresh}
            tintColor={SEMANTIC.success}
          />
        }
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          feed.loadingMore ? (
            <ActivityIndicator style={{ paddingVertical: SPACING.lg }} color={NEUTRAL.muted} />
          ) : null
        }
        ListEmptyComponent={
          feed.loading ? null : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No Posts Yet</Text>
              <Text style={styles.emptyText}>
                Start the conversation — share an update with your team.
              </Text>
              {canCreatePost && (
                <Pressable
                  onPress={handleCreatePost}
                  style={styles.emptyCreateButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.emptyCreateButtonText}>Create Post</Text>
                </Pressable>
              )}
            </View>
          )
        }
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        windowSize={7}
        removeClippedSubviews={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingBottom: 40,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 64,
  },
  emptyTitle: {
    ...TYPOGRAPHY.headlineMedium,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.sm,
  },
  emptyText: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.muted,
    textAlign: "center",
    marginBottom: SPACING.lg,
  },
  emptyCreateButton: {
    backgroundColor: NEUTRAL.foreground,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
  },
  emptyCreateButtonText: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.surface,
    fontWeight: "600",
  },
});
```

**Step 2: Commit**

```bash
git add apps/mobile/src/components/home/FeedTab.tsx
git commit -m "feat(mobile): add FeedTab component for Home screen"
```

---

### Task 5: OverviewTab Component
**Depends on:** Task 3

**Files:**
- Create: `apps/mobile/src/components/home/OverviewTab.tsx`

**Step 1: Write the component**

Displays stat cards (Members, Alumni, Events, Total Donations) in a 2x2 grid, plus a "Recent Donations" section below. Uses Reanimated `FadeIn` for staggered card entry, `selectable` on data text, `borderCurve: 'continuous'` on cards, and `boxShadow` instead of legacy shadows.

```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable, StyleSheet } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { useRouter } from "expo-router";
import {
  Users,
  GraduationCap,
  CalendarClock,
  HandHeart,
} from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { OrgStats } from "@/hooks/useOrgStats";

interface OverviewTabProps {
  stats: OrgStats;
  refreshing: boolean;
  onRefresh: () => void;
}

interface RecentDonation {
  id: string;
  donor_name: string | null;
  anonymous: boolean;
  purpose: string | null;
  amount_cents: number;
  created_at: string;
}

export function OverviewTab({ stats, refreshing, onRefresh }: OverviewTabProps) {
  const router = useRouter();
  const { orgSlug, orgId } = useOrg();
  const [recentDonations, setRecentDonations] = useState<RecentDonation[]>([]);
  const isMountedRef = useRef(true);

  const fetchDonations = useCallback(async () => {
    if (!orgId) return;
    try {
      const { data } = await supabase
        .from("organization_donations")
        .select("id, donor_name, anonymous, purpose, amount_cents, created_at")
        .eq("organization_id", orgId)
        .eq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(5);
      if (isMountedRef.current && data) {
        setRecentDonations(data);
      }
    } catch {
      // Silently fail — donations are supplementary
    }
  }, [orgId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchDonations();
    return () => { isMountedRef.current = false; };
  }, [fetchDonations]);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };

  const statCards = [
    {
      label: "Active Members",
      value: stats.activeMembers,
      icon: Users,
      onPress: () => router.push(`/(app)/${orgSlug}/(tabs)/members`),
    },
    {
      label: "Alumni",
      value: stats.alumni,
      icon: GraduationCap,
      onPress: () => router.push(`/(app)/${orgSlug}/(tabs)/alumni`),
    },
    {
      label: "Upcoming Events",
      value: stats.upcomingEvents,
      icon: CalendarClock,
      onPress: () => router.push(`/(app)/${orgSlug}/(tabs)/events`),
    },
    {
      label: "Total Donations",
      value: formatCurrency(stats.totalDonations * 100),
      icon: HandHeart,
      onPress: () => router.push(`/(app)/(drawer)/${orgSlug}/donations`),
    },
  ];

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SEMANTIC.success} />
      }
    >
      <Text style={styles.sectionTitle}>Overview</Text>
      <View style={styles.grid}>
        {statCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <Animated.View
              key={card.label}
              entering={FadeInUp.delay(index * 50).duration(300)}
              style={styles.statCardWrapper}
            >
              <Pressable
                onPress={card.onPress}
                style={({ pressed }) => [styles.statCard, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={`${card.label}: ${card.value}`}
              >
                <View style={styles.iconContainer}>
                  <Icon size={20} color={SEMANTIC.success} />
                </View>
                <Text selectable style={styles.statValue}>
                  {typeof card.value === "number" ? card.value.toLocaleString() : card.value}
                </Text>
                <Text style={styles.statLabel}>{card.label}</Text>
              </Pressable>
            </Animated.View>
          );
        })}
      </View>

      {recentDonations.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Donations</Text>
            <Pressable
              onPress={() => router.push(`/(app)/(drawer)/${orgSlug}/donations`)}
              style={({ pressed }) => pressed && { opacity: 0.7 }}
            >
              <Text style={styles.seeAll}>See all</Text>
            </Pressable>
          </View>
          <View style={styles.donationsList}>
            {recentDonations.map((donation) => (
              <View key={donation.id} style={styles.donationRow}>
                <View style={styles.donationInfo}>
                  <Text style={styles.donorName} numberOfLines={1}>
                    {donation.anonymous ? "Anonymous" : donation.donor_name || "Unknown"}
                  </Text>
                  <Text style={styles.donationPurpose} numberOfLines={1}>
                    {donation.purpose || "General support"}
                  </Text>
                </View>
                <Text selectable style={styles.donationAmount}>
                  {formatCurrency(donation.amount_cents)}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: SPACING.md,
    paddingBottom: 40,
    gap: SPACING.md,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    ...TYPOGRAPHY.titleLarge,
    color: NEUTRAL.foreground,
  },
  seeAll: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.secondary,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
  },
  statCardWrapper: {
    width: "48%",
    flexGrow: 1,
  },
  statCard: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    padding: SPACING.md,
    gap: SPACING.xs,
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
    backgroundColor: NEUTRAL.background,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.xs,
  },
  statValue: {
    ...TYPOGRAPHY.headlineMedium,
    color: NEUTRAL.foreground,
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
  },
  donationsList: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    overflow: "hidden",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
  },
  donationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: NEUTRAL.border,
  },
  donationInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  donorName: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.foreground,
    fontWeight: "600",
  },
  donationPurpose: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
    marginTop: 2,
  },
  donationAmount: {
    ...TYPOGRAPHY.labelLarge,
    color: SEMANTIC.success,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
```

**Step 2: Commit**

```bash
git add apps/mobile/src/components/home/OverviewTab.tsx
git commit -m "feat(mobile): add OverviewTab component with stats and donations"
```

---

### Task 6: EventsTab Component
**Depends on:** none

**Files:**
- Create: `apps/mobile/src/components/home/EventsTab.tsx`

**Step 1: Write the component**

Shows Upcoming Events (next 5 using EventCard) and Recent Announcements (last 3 using AnnouncementCardCompact), each with "See all" links.

```tsx
import React from "react";
import { View, Text, ScrollView, RefreshControl, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Calendar, ChevronRight, Megaphone } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { EventCard, type EventCardEvent } from "@/components/cards/EventCard";
import { AnnouncementCardCompact } from "@/components/cards/AnnouncementCard";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

interface EventsTabProps {
  events: EventCardEvent[];
  announcements: Array<{
    id: string;
    title: string;
    body: string | null;
    created_at: string;
    is_pinned?: boolean;
  }>;
  refreshing: boolean;
  onRefresh: () => void;
}

export function EventsTab({ events, announcements, refreshing, onRefresh }: EventsTabProps) {
  const router = useRouter();
  const { orgSlug } = useOrg();

  const upcomingEvents = events
    .filter((e) => new Date(e.start_date) >= new Date())
    .slice(0, 5);

  const recentAnnouncements = announcements.slice(0, 3);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SEMANTIC.success} />
      }
    >
      {/* Upcoming Events */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Upcoming Events</Text>
          <Pressable
            onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/events`)}
            style={({ pressed }) => [styles.seeAllButton, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.seeAllText}>See all</Text>
            <ChevronRight size={16} color={NEUTRAL.secondary} />
          </Pressable>
        </View>

        {upcomingEvents.length > 0 ? (
          <View style={styles.eventsList}>
            {upcomingEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                onPress={() => router.push(`/(app)/${orgSlug}/events/${event.id}`)}
                onRSVP={() => router.push(`/(app)/${orgSlug}/events/${event.id}`)}
                accentColor={SEMANTIC.success}
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Calendar size={24} color={NEUTRAL.muted} />
            <Text style={styles.emptyText}>No upcoming events</Text>
          </View>
        )}
      </View>

      {/* Recent Announcements */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Announcements</Text>
          <Pressable
            onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/announcements`)}
            style={({ pressed }) => [styles.seeAllButton, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.seeAllText}>See all</Text>
            <ChevronRight size={16} color={NEUTRAL.secondary} />
          </Pressable>
        </View>

        {recentAnnouncements.length > 0 ? (
          <View style={styles.announcementsList}>
            {recentAnnouncements.map((announcement) => (
              <AnnouncementCardCompact
                key={announcement.id}
                announcement={{
                  id: announcement.id,
                  title: announcement.title,
                  body: announcement.body,
                  created_at: announcement.created_at,
                  is_pinned: announcement.is_pinned ?? false,
                }}
                onPress={() =>
                  router.push(`/(app)/${orgSlug}/announcements/${announcement.id}`)
                }
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Megaphone size={24} color={NEUTRAL.muted} />
            <Text style={styles.emptyText}>No announcements</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: SPACING.md,
    paddingBottom: 40,
    gap: SPACING.lg,
  },
  section: {
    gap: SPACING.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    ...TYPOGRAPHY.titleLarge,
    color: NEUTRAL.foreground,
  },
  seeAllButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  seeAllText: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.secondary,
  },
  eventsList: {
    gap: SPACING.md,
  },
  announcementsList: {
    gap: SPACING.sm,
  },
  emptyCard: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    padding: SPACING.lg,
    alignItems: "center",
    gap: SPACING.sm,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  emptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
  },
});
```

**Step 2: Commit**

```bash
git add apps/mobile/src/components/home/EventsTab.tsx
git commit -m "feat(mobile): add EventsTab component with events and announcements"
```

---

### Task 7: Barrel Export for Home Components
**Depends on:** Task 1, Task 4, Task 5, Task 6

**Files:**
- Create: `apps/mobile/src/components/home/index.ts`

**Step 1: Create the barrel file**

```ts
export { HomeSegmentedControl } from "./HomeSegmentedControl";
export type { HomeSegment } from "./HomeSegmentedControl";
export { FeedComposerBar } from "./FeedComposerBar";
export { FeedTab } from "./FeedTab";
export { OverviewTab } from "./OverviewTab";
export { EventsTab } from "./EventsTab";
```

**Step 2: Commit**

```bash
git add apps/mobile/src/components/home/index.ts
git commit -m "chore(mobile): add barrel export for home components"
```

---

### Task 8: Rewrite Home Screen with Segmented Tabs
**Depends on:** Task 7

**Files:**
- Modify: `apps/mobile/app/(app)/(drawer)/[orgSlug]/(tabs)/index.tsx`

**Step 1: Rewrite the Home screen**

Replace the entire file. The new version:
- Keeps the gradient header with org logo + name
- Adds SegmentedControl below the header
- Conditionally renders FeedTab, OverviewTab, or EventsTab
- Hooks (`useFeed`, `useOrgStats`, `useEvents`, `useAnnouncements`) are all called at the top level so data prefetches regardless of active tab
- Pull-to-refresh is handled within each tab component

```tsx
import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useNavigation } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useFeed } from "@/hooks/useFeed";
import { useOrgStats } from "@/hooks/useOrgStats";
import { useEvents } from "@/hooks/useEvents";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import {
  HomeSegmentedControl,
  FeedTab,
  OverviewTab,
  EventsTab,
  type HomeSegment,
} from "@/components/home";
import type { EventCardEvent } from "@/components/cards/EventCard";

export default function HomeScreen() {
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { isAdmin } = useOrgRole();

  const [activeSegment, setActiveSegment] = useState<HomeSegment>("feed");
  const [refreshing, setRefreshing] = useState(false);

  // Data hooks — all called unconditionally so data prefetches
  const feed = useFeed(orgId);
  const { stats, refetch: refetchStats, refetchIfStale: refetchStatsIfStale } = useOrgStats(orgId);
  const { events, refetch: refetchEvents, refetchIfStale: refetchEventsIfStale } = useEvents(orgId);
  const {
    announcements,
    refetch: refetchAnnouncements,
    refetchIfStale: refetchAnnouncementsIfStale,
  } = useAnnouncements(orgId);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);

  // Refetch all stale data on tab focus
  useFocusEffect(
    useCallback(() => {
      feed.refetchIfStale();
      refetchStatsIfStale();
      refetchEventsIfStale();
      refetchAnnouncementsIfStale();
    }, [feed.refetchIfStale, refetchStatsIfStale, refetchEventsIfStale, refetchAnnouncementsIfStale])
  );

  // Shared refresh handler for Overview and Events tabs
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchStats(), refetchEvents(), refetchAnnouncements()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchStats, refetchEvents, refetchAnnouncements]);

  // Transform events to EventCard format
  const transformedEvents: EventCardEvent[] = useMemo(
    () =>
      events.map((event) => ({
        id: event.id,
        title: event.title,
        start_date: event.start_date,
        end_date: event.end_date,
        location: event.location,
        rsvp_count: (event as any).rsvp_count,
        user_rsvp_status: (event as any).user_rsvp_status,
      })),
    [events]
  );

  // Announcements mapped to the shape EventsTab expects
  const mappedAnnouncements = useMemo(
    () =>
      announcements.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        created_at: a.created_at,
        is_pinned: (a as any).is_pinned ?? false,
      })),
    [announcements]
  );

  // Loading state (only show on initial load when no data exists)
  if (feed.loading && feed.posts.length === 0 && !stats.activeMembers) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={SEMANTIC.success} />
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
              <Text style={styles.headerTitle} numberOfLines={1}>
                {orgName}
              </Text>
              <Text style={styles.headerMeta}>
                {stats.activeMembers} {stats.activeMembers === 1 ? "member" : "members"} ·{" "}
                {stats.upcomingEvents} {stats.upcomingEvents === 1 ? "event" : "events"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content */}
      <View style={styles.contentSheet}>
        <HomeSegmentedControl activeSegment={activeSegment} onSegmentChange={setActiveSegment} />

        {activeSegment === "feed" && (
          <Animated.View key="feed" entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.tabContent}>
            <FeedTab feed={feed} />
          </Animated.View>
        )}
        {activeSegment === "overview" && (
          <Animated.View key="overview" entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.tabContent}>
            <OverviewTab stats={stats} refreshing={refreshing} onRefresh={handleRefresh} />
          </Animated.View>
        )}
        {activeSegment === "events" && (
          <Animated.View key="events" entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.tabContent}>
            <EventsTab
              events={transformedEvents}
              announcements={mappedAnnouncements}
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          </Animated.View>
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
  tabContent: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: NEUTRAL.background,
  },
});
```

**Step 2: Run typecheck**

```bash
cd apps/mobile && bun run typecheck
```
Expected: No errors

**Step 3: Commit**

```bash
git add apps/mobile/app/(app)/(drawer)/[orgSlug]/(tabs)/index.tsx
git commit -m "feat(mobile): rewrite Home screen with Feed/Overview/Events segments"
```

---

### Task 9: Remove Feature Flag and Drawer Entry
**Depends on:** Task 8

**Files:**
- Modify: `apps/mobile/src/lib/featureFlags.ts`
- Modify: `apps/mobile/src/navigation/DrawerContent.tsx`
- Modify: `apps/mobile/app/(app)/(drawer)/[orgSlug]/feed/index.tsx`

**Step 1: Remove socialFeedEnabled from featureFlags.ts**

In `apps/mobile/src/lib/featureFlags.ts`:

1. Remove `socialFeedEnabled: boolean` from `FeatureFlags` interface (line 16)
2. Remove `socialFeedEnabled: false` from `defaultFeatureFlags` (line 30)
3. Remove `flags.socialFeedEnabled = true;` from `getFeatureFlags` dev block (line 51)

**Step 2: Remove Feed from drawer**

In `apps/mobile/src/navigation/DrawerContent.tsx`:

1. Remove the `Newspaper` import from lucide-react-native (line 25)
2. Remove the `isFeatureEnabled` import (line 35)
3. Remove the conditional block that adds "Feed" to communityItems (lines 125-131):

```ts
// DELETE THIS BLOCK:
if (isFeatureEnabled("socialFeedEnabled")) {
  communityItems.push({
    label: "Feed",
    icon: Newspaper,
    href: `/(app)/${slug}/feed`,
  });
}
```

**Step 3: Simplify feed/index.tsx**

In `apps/mobile/app/(app)/(drawer)/[orgSlug]/feed/index.tsx`:

Remove the `isFeatureEnabled` import and the early return block that checks `feedEnabled` (lines 26, 57, 133-140). The feed screen is still needed as a navigation target when users deep-link or navigate from notifications — it just doesn't need a feature gate anymore.

**Step 4: Run typecheck**

```bash
cd apps/mobile && bun run typecheck
```
Expected: No errors

**Step 5: Run tests**

```bash
cd apps/mobile && bun test
```
Expected: All pass

**Step 6: Commit**

```bash
git add apps/mobile/src/lib/featureFlags.ts apps/mobile/src/navigation/DrawerContent.tsx apps/mobile/app/(app)/(drawer)/[orgSlug]/feed/index.tsx
git commit -m "chore(mobile): remove socialFeedEnabled flag and Feed drawer entry"
```

---

### Task 10: Manual Verification
**Depends on:** Task 9

**Step 1: Start dev server**

```bash
cd apps/mobile && bun run ios
```

**Step 2: Verify Feed tab**

- Home opens with "Feed" segment active
- "What's on your mind?" composer bar visible at top
- Tapping composer navigates to feed/new screen
- Feed posts display with avatars, timestamps, body text
- Like button toggles (optimistic + persisted)
- Tapping a post navigates to post detail
- Infinite scroll loads more posts
- Pull-to-refresh works
- New posts from other users show banner

**Step 3: Verify Overview tab**

- Tap "Overview" segment
- 4 stat cards visible: Active Members, Alumni, Upcoming Events, Total Donations
- Values match webapp dashboard
- Tapping each card navigates to the right screen
- Recent Donations section shows last 5 donations
- Pull-to-refresh updates stats

**Step 4: Verify Events tab**

- Tap "Events" segment
- Upcoming Events section shows next 5 events
- Event cards display date, title, location, RSVP info
- Tapping an event navigates to event detail
- Announcements section shows last 3
- "See all" links navigate correctly
- Pull-to-refresh works

**Step 5: Verify drawer**

- Drawer no longer shows "Feed" entry
- All other drawer items still work
- "Community" section still shows "Jobs"

---

## Dependency Graph

```
Wave 1: [Task 0, Task 2, Task 3, Task 6]     ← depends_on: none (parallel)
Wave 2: [Task 1, Task 4, Task 5]             ← depends_on: Tasks 0, 2, 3
Wave 3: [Task 7]                              ← depends_on: Tasks 1, 4, 5, 6
Wave 4: [Task 8]                              ← depends_on: Task 7
Wave 5: [Task 9]                              ← depends_on: Task 8
Wave 6: [Task 10]                             ← depends_on: Task 9
```
