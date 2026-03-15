import React, { useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Trash2 } from "lucide-react-native";
import { NEUTRAL, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatRelativeTime } from "@/lib/date-format";
import type { FeedComment } from "@/types/feed";

interface CommentItemProps {
  comment: FeedComment;
  isOwn: boolean;
  isAdmin: boolean;
  onDelete?: (commentId: string) => void;
}

export function CommentItem({ comment, isOwn, isAdmin, onDelete }: CommentItemProps) {
  const canDelete = (isOwn || isAdmin) && !!onDelete;
  const handleDelete = useCallback(() => {
    onDelete?.(comment.id);
  }, [onDelete, comment.id]);

  return (
    <View style={styles.container}>
      {comment.author?.avatar_url ? (
        <Image
          source={comment.author.avatar_url}
          style={styles.avatar}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarFallbackText}>
            {(comment.author?.full_name || "?")[0].toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.authorName} numberOfLines={1}>
            {comment.author?.full_name || "Unknown"}
          </Text>
          <Text style={styles.timestamp}>
            {formatRelativeTime(comment.created_at)}
          </Text>
          {canDelete && (
            <Pressable
              onPress={handleDelete}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Delete comment"
              accessibilityRole="button"
            >
              <Trash2 size={14} color={NEUTRAL.placeholder} />
            </Pressable>
          )}
        </View>
        <Text style={styles.body}>{comment.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: NEUTRAL.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    fontSize: 12,
    fontWeight: "600",
    color: NEUTRAL.secondary,
  },
  content: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginBottom: 2,
  },
  authorName: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.foreground,
    fontWeight: "600",
    flex: 1,
  },
  timestamp: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
  },
  body: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
  },
});
