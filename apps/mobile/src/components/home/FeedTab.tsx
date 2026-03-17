import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { PenSquare, ChevronRight } from "lucide-react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { PostCard } from "@/components/feed/PostCard";
import { NewPostsBanner } from "@/components/feed/NewPostsBanner";
import { FeedComposerBar } from "./FeedComposerBar";
import { EventCardCompact } from "@/components/cards/EventCard";
import { AnnouncementCardCompact } from "@/components/cards/AnnouncementCard";
import type { FeedPost } from "@/types/feed";
import type { EventCardEvent } from "@/components/cards/EventCard";
import type { AnnouncementCardAnnouncement } from "@/components/cards/AnnouncementCard";

interface FeedTabProps {
  posts: FeedPost[];
  pendingPosts: FeedPost[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onLoadMore: () => void;
  onAcceptPending: () => void;
  onPostPress: (postId: string) => void;
  onLikeToggle: (postId: string) => void;
  onCreatePost: () => void;
  upcomingEvents?: EventCardEvent[];
  pinnedAnnouncement?: AnnouncementCardAnnouncement | null;
  onEventPress?: (eventId: string) => void;
  onAnnouncementPress?: (announcementId: string) => void;
  userAvatarUrl?: string | null;
  userName?: string | null;
}

export function FeedTab({
  posts,
  pendingPosts,
  loading,
  loadingMore,
  hasMore,
  refreshing,
  onRefresh,
  onLoadMore,
  onAcceptPending,
  onPostPress,
  onLikeToggle,
  onCreatePost,
  upcomingEvents,
  pinnedAnnouncement,
  onEventPress,
  onAnnouncementPress,
  userAvatarUrl,
  userName,
}: FeedTabProps) {
  const renderItem = useCallback(
    ({ item }: { item: FeedPost }) => (
      <PostCard post={item} onPress={onPostPress} onLikeToggle={onLikeToggle} />
    ),
    [onPostPress, onLikeToggle]
  );

  const keyExtractor = useCallback((item: FeedPost) => item.id, []);

  const ListHeaderComponent = useMemo(
    () => (
      <View>
        {upcomingEvents && upcomingEvents.length > 0 && (
          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>Coming Up</Text>
              <Pressable
                onPress={() => onEventPress?.(upcomingEvents[0].id)}
                style={styles.seeAllButton}
                accessibilityRole="button"
                accessibilityLabel="See all events"
              >
                <Text style={styles.seeAllText}>See all</Text>
                <ChevronRight size={14} color={SEMANTIC.info} />
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.eventStripContent}
            >
              {upcomingEvents.map((event) => (
                <EventCardCompact
                  key={event.id}
                  event={event}
                  onPress={() => onEventPress?.(event.id)}
                  style={styles.eventCard}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {pinnedAnnouncement != null && (
          <View style={styles.pinnedWrapper}>
            <AnnouncementCardCompact
              announcement={pinnedAnnouncement}
              onPress={() => onAnnouncementPress?.(pinnedAnnouncement.id)}
              style={styles.pinnedCard}
            />
          </View>
        )}

        <View style={styles.composerWrapper}>
          <FeedComposerBar
            onPress={onCreatePost}
            userAvatarUrl={userAvatarUrl}
            userName={userName}
          />
        </View>
      </View>
    ),
    [
      upcomingEvents,
      pinnedAnnouncement,
      onEventPress,
      onAnnouncementPress,
      onCreatePost,
      userAvatarUrl,
      userName,
    ]
  );

  const ListFooterComponent = useMemo(
    () =>
      loadingMore ? (
        <ActivityIndicator size="small" color={SEMANTIC.info} style={styles.loadingMore} />
      ) : null,
    [loadingMore]
  );

  const ListEmptyComponent = useMemo(
    () =>
      !loading ? (
        <View style={styles.emptyState}>
          <PenSquare size={40} color={NEUTRAL.disabled} />
          <Text style={styles.emptyTitle}>No Posts Yet</Text>
          <Text style={styles.emptyBody}>
            Be the first to share something with the team.
          </Text>
          <Pressable
            onPress={onCreatePost}
            style={({ pressed }) => [
              styles.emptyButton,
              pressed && styles.emptyButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Create the first post"
          >
            <Text style={styles.emptyButtonText}>Create a Post</Text>
          </Pressable>
        </View>
      ) : null,
    [loading, onCreatePost]
  );

  if (loading && posts.length === 0) {
    return (
      <View style={styles.skeletonContainer}>
        {ListHeaderComponent}
        {[1, 2, 3].map((i) => (
          <View key={i} style={styles.skeletonCard} />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={posts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        onEndReached={hasMore ? onLoadMore : undefined}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={SEMANTIC.success}
          />
        }
        contentContainerStyle={styles.listContent}
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        windowSize={7}
        removeClippedSubviews={true}
      />
      {pendingPosts.length > 0 && (
        <Animated.View entering={FadeInUp.springify()} exiting={FadeOutUp.springify()}>
          <NewPostsBanner count={pendingPosts.length} onPress={onAcceptPending} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingBottom: SPACING.xl,
  },
  sectionBlock: {
    paddingTop: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
  },
  sectionLabel: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.muted,
  },
  seeAllButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xxs,
  },
  seeAllText: {
    ...TYPOGRAPHY.labelMedium,
    color: SEMANTIC.info,
  },
  eventStripContent: {
    paddingHorizontal: SPACING.md,
  },
  eventCard: {
    width: 260,
    marginRight: SPACING.sm,
  },
  pinnedWrapper: {
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  pinnedCard: {
    borderLeftWidth: 3,
    borderLeftColor: SEMANTIC.warning,
  },
  composerWrapper: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  loadingMore: {
    paddingVertical: SPACING.lg,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: SPACING.xxxl,
    paddingHorizontal: SPACING.xl,
    gap: SPACING.sm,
  },
  emptyTitle: {
    ...TYPOGRAPHY.headlineSmall,
    color: NEUTRAL.foreground,
    marginTop: SPACING.sm,
  },
  emptyBody: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.muted,
    textAlign: "center",
  },
  emptyButton: {
    marginTop: SPACING.md,
    backgroundColor: SEMANTIC.info,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.lg,
  },
  emptyButtonPressed: {
    opacity: 0.7,
  },
  emptyButtonText: {
    ...TYPOGRAPHY.labelLarge,
    color: NEUTRAL.surface,
  },
  skeletonContainer: {
    flex: 1,
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  skeletonCard: {
    height: 120,
    backgroundColor: NEUTRAL.divider,
    borderRadius: RADIUS.lg,
  },
});
