import { z } from "zod";
import { safeToolCount, safeToolQuery } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import type { ToolModule } from "./types";

const getEngagementMetricsSchema = z
  .object({
    window_days: z.number().int().min(1).max(365).optional(),
  })
  .strict();

type Args = z.infer<typeof getEngagementMetricsSchema>;

function countOrNull(result: Awaited<ReturnType<typeof safeToolCount>>): number | null {
  return result.ok ? result.count : null;
}

function collectIds(rows: unknown, column: string, ids: Set<string>): void {
  if (!Array.isArray(rows)) return;

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = (row as Record<string, unknown>)[column];
    if (typeof id === "string" && id.length > 0) {
      ids.add(id);
    }
  }
}

export const getEngagementMetricsModule: ToolModule<Args> = {
  name: "get_engagement_metrics",
  argsSchema: getEngagementMetricsSchema,
  async execute(args, { ctx, sb, logContext }) {
    try {
      const windowDays = args.window_days ?? 30;
      const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();

      const eventsHeldPromise = safeToolCount(logContext, () =>
        sb
          .from("events")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId)
          .is("deleted_at", null)
          .gte("start_date", cutoff)
          .lte("start_date", now)
      );

      const eventRsvpsPromise = safeToolCount(logContext, () =>
        sb
          .from("event_rsvps")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId)
          .gte("created_at", cutoff)
      );

      const announcementsPublishedPromise = safeToolCount(logContext, () =>
        sb
          .from("announcements")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId)
          .gte("created_at", cutoff)
          .is("deleted_at", null)
      );

      const discussionThreadsCreatedPromise = safeToolCount(logContext, () =>
        sb
          .from("discussion_threads")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId)
          .gte("created_at", cutoff)
          .is("deleted_at", null)
      );

      const discussionRepliesPromise = safeToolCount(logContext, () =>
        sb
          .from("discussion_replies")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId)
          .gte("created_at", cutoff)
          .is("deleted_at", null)
      );

      const feedPostsPromise = safeToolCount(logContext, () =>
        sb
          .from("feed_posts")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId)
          .gte("created_at", cutoff)
          .is("deleted_at", null)
      );

      const feedCommentsPromise = safeToolCount(logContext, () =>
        sb
          .from("feed_comments")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId)
          .gte("created_at", cutoff)
          .is("deleted_at", null)
      );

      const chatMessagesPromise = safeToolCount(logContext, () =>
        sb
          .from("chat_messages")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId)
          .gte("created_at", cutoff)
          .is("deleted_at", null)
      );

      const authorPromises = [
        safeToolQuery(logContext, () =>
          sb
            .from("announcements")
            .select("created_by_user_id")
            .eq("organization_id", ctx.orgId)
            .gte("created_at", cutoff)
            .is("deleted_at", null)
        ),
        safeToolQuery(logContext, () =>
          sb
            .from("discussion_threads")
            .select("author_id")
            .eq("organization_id", ctx.orgId)
            .gte("created_at", cutoff)
            .is("deleted_at", null)
        ),
        safeToolQuery(logContext, () =>
          sb
            .from("discussion_replies")
            .select("author_id")
            .eq("organization_id", ctx.orgId)
            .gte("created_at", cutoff)
            .is("deleted_at", null)
        ),
        safeToolQuery(logContext, () =>
          sb
            .from("feed_posts")
            .select("author_id")
            .eq("organization_id", ctx.orgId)
            .gte("created_at", cutoff)
            .is("deleted_at", null)
        ),
        safeToolQuery(logContext, () =>
          sb
            .from("feed_comments")
            .select("author_id")
            .eq("organization_id", ctx.orgId)
            .gte("created_at", cutoff)
            .is("deleted_at", null)
        ),
        safeToolQuery(logContext, () =>
          sb
            .from("chat_messages")
            .select("author_id")
            .eq("organization_id", ctx.orgId)
            .gte("created_at", cutoff)
            .is("deleted_at", null)
        ),
      ] as const;

      const [
        eventsHeld,
        eventRsvps,
        announcementsPublished,
        discussionThreadsCreated,
        discussionReplies,
        feedPosts,
        feedComments,
        chatMessages,
        authorResults,
      ] = await Promise.all([
        eventsHeldPromise,
        eventRsvpsPromise,
        announcementsPublishedPromise,
        discussionThreadsCreatedPromise,
        discussionRepliesPromise,
        feedPostsPromise,
        feedCommentsPromise,
        chatMessagesPromise,
        Promise.all(authorPromises),
      ]);

      const successfulAuthorResults = authorResults.filter(
        (result) => result.kind === "ok"
      );
      const contributorIds = new Set<string>();
      const authorColumns = [
        "created_by_user_id",
        "author_id",
        "author_id",
        "author_id",
        "author_id",
        "author_id",
      ] as const;

      authorResults.forEach((result, index) => {
        if (result.kind !== "ok") return;
        collectIds(result.data, authorColumns[index] ?? "author_id", contributorIds);
      });

      return {
        kind: "ok",
        data: {
          window_days: windowDays,
          events_held: countOrNull(eventsHeld),
          event_rsvps: countOrNull(eventRsvps),
          announcements_published: countOrNull(announcementsPublished),
          discussion_threads_created: countOrNull(discussionThreadsCreated),
          discussion_replies: countOrNull(discussionReplies),
          feed_posts: countOrNull(feedPosts),
          feed_comments: countOrNull(feedComments),
          chat_messages: countOrNull(chatMessages),
          active_contributors:
            successfulAuthorResults.length === 0 ? null : contributorIds.size,
        },
      };
    } catch {
      return toolError("Query failed");
    }
  },
};
