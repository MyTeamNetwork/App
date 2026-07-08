import { createServiceClient } from "@/lib/supabase/service";
import { fetchMediaForEntities } from "@/lib/media/fetch";
import type { MediaAttachment } from "@/lib/media/fetch";
import {
  getBlockedUserIds,
  blockedIdsInFilter,
} from "@/lib/moderation/blocked-users";
import type { ServerSupabase } from "@/lib/supabase/types";
import type { PollMetadata } from "@/components/feed/types";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const ALL_VOTES_LIMIT = 5000;

export interface LoadFeedPageParams {
  /** RLS-scoped client used for feed_posts/feed_likes/feed_poll_votes queries. */
  supabase: ServerSupabase;
  orgId: string;
  /** Null when no authenticated viewer context (block filter and likes/votes skipped). */
  viewerId: string | null;
  /** Raw/unclamped input — the loader owns clamping. */
  page?: string | number | null;
  /** Defaults to 25; caller may override up to its own cap. */
  limit?: number;
}

export interface LoadFeedPageResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  posts: any[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Clamps a raw page input to a positive integer, defaulting to 1 for
 * missing/NaN/non-positive values. Mirrors the API route's original
 * `Math.max(1, parseInt(pageParam || "1", 10))` clamp, applied uniformly
 * so callers can pass either a raw query-string value or a number.
 */
function clampPage(page: LoadFeedPageParams["page"]): number {
  const parsed = typeof page === "number" ? page : parseInt(page || "1", 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, parsed);
}

/**
 * Clamps a raw limit input to [1, 100], defaulting to 25 when missing/NaN.
 */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, limit));
}

/**
 * Loads one page of an org's feed_posts, augmented with liked_by_user, media,
 * and poll data — the shared assembly logic behind both the SSR org home page
 * and GET /api/feed. Always applies the mutual-block filter (Apple Guideline
 * 1.2) when a viewer is present, so blocked authors' posts never surface in
 * either surface.
 *
 * Fatal errors (the posts query itself failing) throw a plain Error and let
 * the caller decide how to present that (SSR error boundary vs. JSON 500).
 * Non-fatal sub-fetch errors (likes, poll votes) are logged and degrade to
 * empty results rather than failing the whole page.
 */
export async function loadFeedPage(
  params: LoadFeedPageParams,
): Promise<LoadFeedPageResult> {
  const { supabase, orgId, viewerId } = params;
  const page = clampPage(params.page);
  const limit = clampLimit(params.limit);
  const offset = (page - 1) * limit;

  // Hide posts authored by users in a mutual block with the viewer (Apple 1.2).
  const blockedFilter = viewerId
    ? blockedIdsInFilter(await getBlockedUserIds(supabase, viewerId))
    : null;

  let postsQuery = supabase
    .from("feed_posts")
    .select(
      `
      *,
      author:users!feed_posts_author_id_fkey(name)
    `,
      { count: "exact", head: false },
    )
    .eq("organization_id", orgId)
    .is("deleted_at", null);

  if (blockedFilter) {
    postsQuery = postsQuery.not("author_id", "in", blockedFilter);
  }

  const { data: posts, error, count } = await postsQuery
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error("Failed to load feed posts");
  }

  const postIds = (posts || []).map((p) => p.id);
  const pollPostIds = (posts || [])
    .filter((p) => (p as Record<string, unknown>).post_type === "poll")
    .map((p) => p.id);

  let userLikedPostIds: Set<string> = new Set();
  let mediaMap = new Map<string, MediaAttachment[]>();
  const userVoteMap = new Map<string, number>();
  const voteCountsMap = new Map<string, number[]>();
  const totalVotesMap = new Map<string, number>();

  if (postIds.length > 0) {
    const [likesResult, media, userVotesResult, allVotesResult] = await Promise.all([
      viewerId
        ? supabase
            .from("feed_likes")
            .select("post_id")
            .eq("user_id", viewerId)
            .in("post_id", postIds)
        : Promise.resolve({ data: [] as { post_id: string }[], error: null }),
      fetchMediaForEntities(createServiceClient(), "feed_post", postIds, orgId),
      pollPostIds.length > 0 && viewerId
        ? supabase
            .from("feed_poll_votes")
            .select("post_id, option_index")
            .eq("user_id", viewerId)
            .in("post_id", pollPostIds)
        : Promise.resolve({ data: [] as { post_id: string; option_index: number }[], error: null }),
      pollPostIds.length > 0
        ? supabase
            .from("feed_poll_votes")
            .select("post_id, option_index")
            .in("post_id", pollPostIds)
            .limit(ALL_VOTES_LIMIT)
        : Promise.resolve({ data: [] as { post_id: string; option_index: number }[], error: null }),
    ]);

    if (likesResult.error) {
      console.error("[loadFeedPage] likes fetch failed", {
        orgId,
        error: likesResult.error.message,
      });
    }
    userLikedPostIds = new Set((likesResult.data || []).map((l) => l.post_id));

    mediaMap = media;

    if (userVotesResult.error) {
      console.error("[loadFeedPage] poll user-votes fetch failed", {
        orgId,
        error: userVotesResult.error.message,
      });
    }
    if (allVotesResult.error) {
      console.error("[loadFeedPage] poll all-votes fetch failed", {
        orgId,
        error: allVotesResult.error.message,
      });
    }

    for (const v of userVotesResult.data || []) {
      userVoteMap.set(v.post_id, v.option_index);
    }

    for (const v of allVotesResult.data || []) {
      if (!voteCountsMap.has(v.post_id)) {
        const postForMeta = (posts || []).find((p) => p.id === v.post_id);
        const meta = (postForMeta as Record<string, unknown> | undefined)?.metadata as
          | PollMetadata
          | null
          | undefined;
        voteCountsMap.set(v.post_id, new Array(meta?.options.length || 0).fill(0));
        totalVotesMap.set(v.post_id, 0);
      }
      const counts = voteCountsMap.get(v.post_id)!;
      if (v.option_index < counts.length) {
        counts[v.option_index]++;
      }
      totalVotesMap.set(v.post_id, (totalVotesMap.get(v.post_id) || 0) + 1);
    }
  }

  const augmentedPosts = (posts || []).map((post) => {
    const postType = (post as Record<string, unknown>).post_type;
    const meta = (post as Record<string, unknown>).metadata as PollMetadata | null;
    return {
      ...post,
      liked_by_user: userLikedPostIds.has(post.id),
      media: mediaMap.get(post.id) ?? [],
      ...(postType === "poll"
        ? {
            poll_meta: meta,
            user_vote: userVoteMap.get(post.id) ?? null,
            vote_counts:
              voteCountsMap.get(post.id) ?? new Array(meta?.options.length ?? 0).fill(0),
            total_votes: totalVotesMap.get(post.id) ?? 0,
          }
        : {}),
    };
  });

  const total = count || 0;
  const totalPages = Math.ceil(total / limit);

  return {
    posts: augmentedPosts,
    pagination: { page, limit, total, totalPages },
  };
}
