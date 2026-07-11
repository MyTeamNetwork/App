-- Restore admin moderation and the un-delete guard on feed_comments UPDATE.
--
-- 20270104100000_enforce_feed_parent_organization.sql rebuilt the UPDATE
-- policy to bind comments to the parent post's organization, but dropped two
-- protections that 20260224000000_rls_perf_media_feed_consolidation.sql had
-- established:
--   1. Admin moderation: the USING branch lost has_active_role(...,'admin'),
--      so org admins could no longer soft-delete another member's comment.
--   2. Un-delete guard: USING lost `deleted_at IS NULL`, so an author could
--      UPDATE a soft-deleted comment and set deleted_at back to NULL —
--      reintroducing the exact un-delete bug 20260224000000 closed.
--
-- This policy restores both while keeping the parent-post organization match
-- from 20270104100000. Deliberate deviation: the EXISTS check here does NOT
-- require post.deleted_at IS NULL — moderation of a comment must remain
-- possible after its parent post is itself soft-deleted. (The INSERT policy
-- keeps that condition: nobody may comment on a deleted post.)

DROP POLICY IF EXISTS "feed_comments_update" ON public.feed_comments;
CREATE POLICY "feed_comments_update" ON public.feed_comments
  FOR UPDATE
  USING (
    deleted_at IS NULL
    AND (
      author_id = (SELECT auth.uid())
      OR has_active_role(feed_comments.organization_id, array['admin'])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.feed_posts AS post
      WHERE post.id = feed_comments.post_id
        AND post.organization_id = feed_comments.organization_id
    )
    AND (
      -- Author: can edit (keep alive) or soft-delete their own comment
      author_id = (SELECT auth.uid())
      -- Admin: can only soft-delete (not edit the body)
      OR (
        has_active_role(feed_comments.organization_id, array['admin'])
        AND deleted_at IS NOT NULL
      )
    )
  );
