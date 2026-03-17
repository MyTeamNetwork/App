import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  StyleSheet,
} from "react-native";
import { PenSquare } from "lucide-react-native";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { PostCard } from "@/components/feed/PostCard";
import { NewPostsBanner } from "@/components/feed/NewPostsBanner";
import { FeedComposerBar } from "./FeedComposerBar";
import type { FeedPost } from "@/types/feed";

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
      <View style={styles.composerWrapper}>
        <FeedComposerBar onPress={onCreatePost} />
      </View>
    ),
    [onCreatePost]
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={styles.listContent}
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        windowSize={7}
        removeClippedSubviews={true}
      />
      {pendingPosts.length > 0 && (
        <NewPostsBanner count={pendingPosts.length} onPress={onAcceptPending} />
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
