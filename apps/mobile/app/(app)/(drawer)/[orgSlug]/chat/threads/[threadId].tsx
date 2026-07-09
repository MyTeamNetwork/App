import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, ArrowUp, Lock } from "lucide-react-native";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase, createPostgresChangesChannel } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useBlockedUsers } from "@/contexts/BlockedUsersContext";
import { ReportBlockSheet } from "@/components/moderation/ReportBlockSheet";
import { Avatar } from "@/components/ui/Avatar";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import { AVATAR_SIZES } from "@/lib/design-tokens";
import { APP_CHROME } from "@/lib/chrome";
import {
  formatChatDaySeparator,
  formatTimestamp,
  isDifferentLocalDay,
} from "@/lib/date-format";
import type { Tables } from "@teammeet/types";

const PAGE_SIZE = 50;

const CHAT_COLORS = {
  background: "#ffffff",
  card: "#ffffff",
  border: "#e2e8f0",
  title: "#0f172a",
  subtitle: "#64748b",
  muted: "#94a3b8",
  accent: "#059669",
  pending: "#f59e0b",
  bubble: "#f1f5f9",
  lockedBg: "#f8fafc",
};

type DiscussionThread = Tables<"discussion_threads">;
type DiscussionReply = Tables<"discussion_replies">;

type ThreadWithAuthor = DiscussionThread & {
  author?: { id: string; name: string | null; avatar_url: string | null } | null;
};

type ReplyWithAuthor = DiscussionReply & {
  author?: { id: string; name: string | null; avatar_url: string | null } | null;
  isFirstInRun?: boolean;
  showDaySeparator?: boolean;
};

function isKnownAuthorId(authorId: string | null): authorId is string {
  return typeof authorId === "string" && authorId.length > 0;
}

function isBlockedAuthor(authorId: string | null, blockedUserIds: Set<string>): boolean {
  return isKnownAuthorId(authorId) && blockedUserIds.has(authorId);
}

export default function ThreadDetailScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const resolvedThreadId = Array.isArray(threadId) ? threadId[0] : threadId;
  const { orgId, orgSlug } = useOrg();
  const { user } = useAuth();
  const { blockedUserIds } = useBlockedUsers();
  const blockedRef = useRef<Set<string>>(blockedUserIds);
  blockedRef.current = blockedUserIds;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(), []);
  const listRef = useRef<FlatList<ReplyWithAuthor>>(null);
  const isMountedRef = useRef(true);
  const skipAutoScrollRef = useRef(false);

  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [thread, setThread] = useState<ThreadWithAuthor | null>(null);
  const [replies, setReplies] = useState<ReplyWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [reportTarget, setReportTarget] = useState<
    | { kind: "thread"; id: string; authorId: string }
    | { kind: "reply"; id: string; authorId: string }
    | null
  >(null);

  const currentUserId = user?.id ?? null;

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  const loadThreadDetails = useCallback(async () => {
    if (!orgId || !resolvedThreadId || !currentUserId) return;

    setLoading(true);
    try {
      const { data, error: threadError } = await supabase
        .from("discussion_threads")
        .select("*, author:users!discussion_threads_author_id_fkey(id, name, avatar_url)")
        .eq("id", resolvedThreadId)
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .single();

      if (threadError) throw threadError;

      if (isMountedRef.current) {
        const threadData = data as ThreadWithAuthor;
        const blocked = blockedRef.current;
        if (threadData && isBlockedAuthor(threadData.author_id, blocked)) {
          setThread(null);
          setReplies([]);
          setHasMoreOlder(false);
          setError("Thread not found.");
          return;
        }
        setThread(threadData);
        setError(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId, resolvedThreadId, currentUserId]);

  const loadReplies = useCallback(async () => {
    if (!resolvedThreadId) return;

    const { data, error: repliesError } = await supabase
      .from("discussion_replies")
      .select("*, author:users!discussion_replies_author_id_fkey(id, name, avatar_url)")
      .eq("thread_id", resolvedThreadId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (repliesError) {
      if (isMountedRef.current) setError(repliesError.message);
      return;
    }

    if (data && isMountedRef.current) {
      setHasMoreOlder(data.length === PAGE_SIZE);
      const chronological = [...data].reverse() as ReplyWithAuthor[];
      const blocked = blockedRef.current;
      setReplies(chronological.filter((r) => !isBlockedAuthor(r.author_id, blocked)));
      setTimeout(scrollToBottom, 100);
    }
  }, [resolvedThreadId, scrollToBottom]);

  const loadOlderReplies = useCallback(async () => {
    if (!hasMoreOlder || loadingOlder || replies.length === 0 || !resolvedThreadId) return;
    const oldestReply = replies[0];
    if (!oldestReply?.created_at) return;

    setLoadingOlder(true);
    try {
      const { data, error: repliesError } = await supabase
        .from("discussion_replies")
        .select("*, author:users!discussion_replies_author_id_fkey(id, name, avatar_url)")
        .eq("thread_id", resolvedThreadId)
        .is("deleted_at", null)
        .lt("created_at", oldestReply.created_at)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (repliesError) {
        if (isMountedRef.current) setError(repliesError.message);
        return;
      }

      if (data && isMountedRef.current) {
        setHasMoreOlder(data.length === PAGE_SIZE);
        const chronological = [...data].reverse() as ReplyWithAuthor[];
        const blocked = blockedRef.current;
        const filtered = chronological.filter((r) => !isBlockedAuthor(r.author_id, blocked));
        if (filtered.length > 0) {
          skipAutoScrollRef.current = true;
          setReplies((prev) => [...filtered, ...prev]);
        }
      }
    } finally {
      if (isMountedRef.current) setLoadingOlder(false);
    }
  }, [hasMoreOlder, loadingOlder, replies, resolvedThreadId]);

  useEffect(() => {
    isMountedRef.current = true;
    loadThreadDetails();
    return () => {
      isMountedRef.current = false;
    };
  }, [loadThreadDetails]);

  useEffect(() => {
    if (!thread?.id) return;
    loadReplies();
  }, [thread?.id, loadReplies]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Realtime subscription for thread state and new replies
  useEffect(() => {
    if (!resolvedThreadId) return;

    const threadChannel = createPostgresChangesChannel(`discussion_thread:${resolvedThreadId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "discussion_threads",
          filter: `id=eq.${resolvedThreadId}`,
        },
        (payload: RealtimePostgresChangesPayload<DiscussionThread>) => {
          if (!isMountedRef.current) return;

          if (payload.eventType === "DELETE") {
            setThread(null);
            setError("Thread not found.");
            return;
          }

          const updatedThread = payload.new as DiscussionThread;
          if (updatedThread.deleted_at) {
            setThread(null);
            setError("Thread not found.");
            return;
          }

          setThread((prev) =>
            prev
              ? {
                  ...prev,
                  ...updatedThread,
                }
              : (updatedThread as ThreadWithAuthor)
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(threadChannel);
    };
  }, [resolvedThreadId]);

  useEffect(() => {
    if (!resolvedThreadId) return;

    const channel = createPostgresChangesChannel(`discussion_replies:${resolvedThreadId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "discussion_replies",
          filter: `thread_id=eq.${resolvedThreadId}`,
        },
        async (payload: RealtimePostgresChangesPayload<DiscussionReply>) => {
          if (payload.eventType === "INSERT") {
            const newReply = payload.new as DiscussionReply;
            if (isBlockedAuthor(newReply.author_id, blockedRef.current)) return;
            const { data: replyWithAuthor } = await supabase
              .from("discussion_replies")
              .select("*, author:users!discussion_replies_author_id_fkey(id, name, avatar_url)")
              .eq("id", newReply.id)
              .single();

            if (replyWithAuthor && isMountedRef.current) {
              setReplies((prev) => {
                if (prev.some((reply) => reply.id === newReply.id)) {
                  return prev;
                }

                const hasTempVersion = prev.some(
                  (reply) =>
                    reply.id.startsWith("temp-") &&
                    reply.author_id === newReply.author_id &&
                    reply.body === newReply.body
                );

                if (hasTempVersion) {
                  return prev.map((reply) =>
                    reply.id.startsWith("temp-") &&
                    reply.author_id === newReply.author_id &&
                    reply.body === newReply.body
                      ? (replyWithAuthor as ReplyWithAuthor)
                      : reply
                  );
                }

                return [...prev, replyWithAuthor as ReplyWithAuthor];
              });
              setTimeout(scrollToBottom, 80);
            }
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as DiscussionReply;
            if (!isMountedRef.current) return;
            if (updated.deleted_at) {
              setReplies((prev) => prev.filter((r) => r.id !== updated.id));
              return;
            }
            if (isBlockedAuthor(updated.author_id, blockedRef.current)) {
              setReplies((prev) => prev.filter((r) => r.id !== updated.id));
              return;
            }
            setReplies((prev) =>
              prev.map((r) =>
                r.id === updated.id ? { ...r, ...updated, author: r.author } : r
              )
            );
          } else if (payload.eventType === "DELETE") {
            const deleted = payload.old as { id: string };
            if (isMountedRef.current) {
              setReplies((prev) => prev.filter((r) => r.id !== deleted.id));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [resolvedThreadId, scrollToBottom]);

  useEffect(() => {
    setReplies((prev) => prev.filter((r) => !isBlockedAuthor(r.author_id, blockedUserIds)));
    setThread((prev) => (prev && isBlockedAuthor(prev.author_id, blockedUserIds) ? null : prev));
  }, [blockedUserIds]);

  const groupedReplies = useMemo(() => {
    return replies.map((reply, index) => {
      const prev = replies[index - 1];
      const sameAuthor = prev?.author_id === reply.author_id;
      const within5Min = prev
        ? new Date(reply.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000
        : false;
      return {
        ...reply,
        isFirstInRun: !sameAuthor || !within5Min,
        showDaySeparator: isDifferentLocalDay(prev?.created_at, reply.created_at),
      };
    });
  }, [replies]);

  useEffect(() => {
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false;
      return;
    }
    setTimeout(scrollToBottom, 80);
  }, [groupedReplies.length, scrollToBottom]);

  const handleSendReply = useCallback(async () => {
    if (!replyBody.trim() || sending || !thread || thread.is_locked || !orgId || !currentUserId) {
      return;
    }

    setSending(true);
    const body = replyBody.trim();
    setReplyBody("");

    const tempId = `temp-${Date.now()}`;
    const optimisticReply: ReplyWithAuthor = {
      id: tempId,
      thread_id: thread.id,
      organization_id: orgId,
      author_id: currentUserId,
      body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      mentioned_user_ids: [],
      author: user ? { id: user.id, name: user.email || "Unknown", avatar_url: null } : undefined,
    };

    setReplies((prev) => [...prev, optimisticReply]);
    setTimeout(scrollToBottom, 60);

    const { data, error } = await supabase
      .from("discussion_replies")
      .insert({
        thread_id: thread.id,
        organization_id: orgId,
        author_id: currentUserId,
        body,
      })
      .select("*, author:users!discussion_replies_author_id_fkey(id, name, avatar_url)")
      .single();

    if (error) {
      setReplies((prev) => prev.filter((r) => r.id !== tempId));
      setReplyBody(body);
      await loadReplies();
    } else if (data) {
      setReplies((prev) => prev.map((r) => (r.id === tempId ? (data as ReplyWithAuthor) : r)));
    }

    setSending(false);
  }, [replyBody, sending, thread, orgId, currentUserId, user, scrollToBottom, loadReplies]);

  const renderReply = useCallback(
    ({ item }: { item: ReplyWithAuthor }) => {
      const authorId = item.author_id;
      const isOwn = authorId === currentUserId;
      const canReport = !isOwn && isKnownAuthorId(authorId);
      const authorName = item.author?.name || "Unknown";
      const isFirstInRun = item.isFirstInRun ?? false;

      const bubbleRadius = isFirstInRun
        ? isOwn
          ? {
              borderTopLeftRadius: 14,
              borderTopRightRadius: 4,
              borderBottomLeftRadius: 14,
              borderBottomRightRadius: 14,
            }
          : {
              borderTopLeftRadius: 4,
              borderTopRightRadius: 14,
              borderBottomLeftRadius: 14,
              borderBottomRightRadius: 14,
            }
        : {
            borderTopLeftRadius: 14,
            borderTopRightRadius: 14,
            borderBottomLeftRadius: 14,
            borderBottomRightRadius: 14,
          };

      return (
        <>
          {item.showDaySeparator && (
            <View style={styles.daySeparator}>
              <Text style={styles.daySeparatorText}>
                {formatChatDaySeparator(item.created_at)}
              </Text>
            </View>
          )}
          <View style={[styles.messageRow, isOwn && styles.messageRowOwn]}>
            {!isOwn && (
              <View style={styles.messageColumn}>
                {isFirstInRun ? (
                  <Avatar size="xs" name={authorName} />
                ) : (
                  <View style={styles.avatarSpacer} />
                )}
              </View>
            )}

            <View style={[styles.messageBody, isOwn && styles.messageBodyOwn]}>
              {isFirstInRun && !isOwn && (
                <View style={styles.messageMetaRow}>
                  <Text style={styles.messageAuthor} numberOfLines={1}>
                    {authorName}
                  </Text>
                  <Text style={styles.messageTime}>{formatTimestamp(item.created_at)}</Text>
                </View>
              )}
              {isFirstInRun && isOwn && (
                <Text style={styles.messageTime}>{formatTimestamp(item.created_at)}</Text>
              )}

              <Pressable
                onLongPress={
                  canReport
                    ? () =>
                        setReportTarget({
                          kind: "reply",
                          id: item.id,
                          authorId,
                        })
                    : undefined
                }
                delayLongPress={350}
                style={({ pressed }) => [
                  styles.messageBubble,
                  bubbleRadius,
                  isOwn ? styles.messageBubbleOwn : styles.messageBubbleOther,
                  pressed && !isOwn && { opacity: 0.8 },
                ]}
                accessibilityRole={isOwn ? undefined : "button"}
                accessibilityHint={isOwn ? undefined : "Long-press to report or block"}
              >
                <Text style={[styles.messageText, isOwn && styles.messageTextOwn]}>{item.body}</Text>
              </Pressable>
            </View>
          </View>
        </>
      );
    },
    [currentUserId, styles]
  );

  const renderOpCard = useCallback(() => {
    if (!thread) return null;

    const authorName = thread.author?.name || "Unknown";
    const authorId = thread.author_id;
    const isOwn = authorId === currentUserId;
    const canReport = !isOwn && isKnownAuthorId(authorId);

    return (
      <Pressable
        onLongPress={
          canReport
            ? () =>
                setReportTarget({
                  kind: "thread",
                  id: thread.id,
                  authorId,
                })
            : undefined
        }
        delayLongPress={350}
        style={({ pressed }) => [styles.opCard, pressed && !isOwn && { opacity: 0.85 }]}
        accessibilityRole={isOwn ? undefined : "button"}
        accessibilityHint={isOwn ? undefined : "Long-press to report or block"}
      >
        <View style={styles.opMeta}>
          <Avatar size="sm" name={authorName} />
          <Text style={styles.opAuthor}>{authorName}</Text>
          <Text style={styles.opMetaSeparator}>·</Text>
          <Text style={styles.opTime}>{formatRelativeTime(thread.created_at)}</Text>
        </View>
        <Text style={styles.opTitle}>{thread.title}</Text>
        <Text style={styles.opBody}>{thread.body}</Text>
      </Pressable>
    );
  }, [thread, currentUserId, styles]);

  const renderListHeader = useCallback(() => {
    return (
      <View>
        {renderOpCard()}
        {hasMoreOlder && (
          <Pressable
            onPress={loadOlderReplies}
            disabled={loadingOlder}
            style={({ pressed }) => [
              styles.loadEarlierButton,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Load earlier replies"
          >
            {loadingOlder ? (
              <ActivityIndicator size="small" color={CHAT_COLORS.accent} />
            ) : (
              <Text style={styles.loadEarlierText}>Load earlier replies</Text>
            )}
          </Pressable>
        )}
      </View>
    );
  }, [renderOpCard, hasMoreOlder, loadingOlder, loadOlderReplies, styles]);

  if (loading && !thread) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={CHAT_COLORS.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !thread) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Unable to load thread</Text>
          <Text style={styles.errorText}>{error || "Thread not found."}</Text>
          <Pressable
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      {/* Custom gradient header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={() => router.back()} style={styles.backButtonHeader}>
              <ArrowLeft size={20} color={APP_CHROME.headerTitle} />
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {thread.title}
              </Text>
              <Text style={styles.headerMeta}>
                {replies.length} {replies.length === 1 ? "reply" : "replies"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <KeyboardAvoidingView
        style={styles.container}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={groupedReplies}
          keyExtractor={(item) => item.id}
          renderItem={renderReply}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No replies yet. Start the discussion!</Text>
            </View>
          }
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
        />

        {!thread.is_locked ? (
          <View
            style={[
              styles.composerContainer,
              { paddingBottom: keyboardVisible ? 0 : insets.bottom },
            ]}
          >
            <View style={styles.composer}>
              <TextInput
                value={replyBody}
                onChangeText={setReplyBody}
                placeholder="Reply to this thread..."
                style={styles.input}
                editable={!sending}
                returnKeyType="send"
                onSubmitEditing={handleSendReply}
                multiline
              />
              <Pressable
                onPress={handleSendReply}
                disabled={!replyBody.trim() || sending}
                style={({ pressed }) => [
                  styles.sendButton,
                  (!replyBody.trim() || sending) && styles.sendButtonDisabled,
                  pressed && styles.sendButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send reply"
              >
                <ArrowUp
                  size={20}
                  color={!replyBody.trim() || sending ? CHAT_COLORS.muted : "#ffffff"}
                />
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.lockedBanner}>
            <Lock size={16} color={CHAT_COLORS.muted} />
            <Text style={styles.lockedText}>This thread is locked</Text>
          </View>
        )}
      </KeyboardAvoidingView>

      <ReportBlockSheet
        visible={!!reportTarget}
        onClose={() => setReportTarget(null)}
        orgId={orgId}
        targetType="chat_message"
        targetId={reportTarget?.id ?? ""}
        reportedUserId={reportTarget?.authorId ?? null}
      />
    </View>
  );
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: CHAT_COLORS.background,
    },
    headerGradient: {
      paddingBottom: spacing.md,
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    backButtonHeader: {
      padding: spacing.xs,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      fontSize: fontSize.xs,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.lg,
      gap: spacing.sm,
    },
    errorTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: CHAT_COLORS.title,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.subtitle,
      textAlign: "center",
    },
    backButton: {
      backgroundColor: CHAT_COLORS.accent,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
    },
    backButtonText: {
      color: "#ffffff",
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
      gap: spacing.xs,
    },
    opCard: {
      backgroundColor: CHAT_COLORS.lockedBg,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: CHAT_COLORS.border,
      padding: spacing.md,
      marginBottom: spacing.md,
      gap: spacing.sm,
    },
    opMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    opAuthor: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: CHAT_COLORS.title,
    },
    opMetaSeparator: {
      color: CHAT_COLORS.muted,
    },
    opTime: {
      fontSize: fontSize.xs,
      color: CHAT_COLORS.muted,
    },
    opTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: CHAT_COLORS.title,
      lineHeight: 22,
    },
    opBody: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.subtitle,
      lineHeight: 22,
    },
    loadEarlierButton: {
      alignSelf: "center",
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.sm,
    },
    loadEarlierText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: CHAT_COLORS.accent,
    },
    daySeparator: {
      alignItems: "center",
      paddingVertical: spacing.sm,
    },
    daySeparatorText: {
      fontSize: fontSize.xs,
      color: CHAT_COLORS.muted,
      fontWeight: fontWeight.medium,
    },
    messageRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.xs,
    },
    messageRowOwn: {
      flexDirection: "row-reverse",
    },
    messageColumn: {
      width: AVATAR_SIZES.xs,
      alignItems: "center",
    },
    avatarSpacer: {
      width: AVATAR_SIZES.xs,
    },
    messageBody: {
      flex: 1,
      gap: 4,
    },
    messageBodyOwn: {
      alignItems: "flex-end",
    },
    messageMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    messageAuthor: {
      fontSize: fontSize.xs,
      color: CHAT_COLORS.muted,
      maxWidth: 120,
    },
    messageTime: {
      fontSize: fontSize.xs,
      color: CHAT_COLORS.muted,
    },
    messageBubble: {
      paddingVertical: 10,
      paddingHorizontal: spacing.sm,
      maxWidth: "85%",
    },
    messageBubbleOwn: {
      backgroundColor: CHAT_COLORS.accent,
    },
    messageBubbleOther: {
      backgroundColor: CHAT_COLORS.bubble,
      borderWidth: 1,
      borderColor: CHAT_COLORS.border,
    },
    messageText: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.title,
      lineHeight: 20,
    },
    messageTextOwn: {
      color: "#ffffff",
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: spacing.lg,
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.subtitle,
      textAlign: "center",
    },
    composerContainer: {
      backgroundColor: CHAT_COLORS.card,
      borderTopWidth: 1,
      borderTopColor: CHAT_COLORS.border,
    },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    input: {
      flex: 1,
      backgroundColor: CHAT_COLORS.bubble,
      borderRadius: 999,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      fontSize: fontSize.sm,
      color: CHAT_COLORS.title,
      maxHeight: 120,
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: CHAT_COLORS.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    sendButtonPressed: {
      opacity: 0.8,
    },
    sendButtonDisabled: {
      opacity: 0.5,
    },
    lockedBanner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      backgroundColor: CHAT_COLORS.lockedBg,
      borderTopWidth: 1,
      borderTopColor: CHAT_COLORS.border,
    },
    lockedText: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.muted,
      fontWeight: fontWeight.medium,
    },
  });
