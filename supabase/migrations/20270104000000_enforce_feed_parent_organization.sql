-- Enforce that feed interactions belong to the referenced post's organization.

DROP POLICY IF EXISTS "feed_comments_insert" ON public.feed_comments;
CREATE POLICY "feed_comments_insert" ON public.feed_comments
  FOR INSERT WITH CHECK (
    author_id = (SELECT auth.uid())
    AND has_active_role(
      feed_comments.organization_id,
      array['admin','active_member','alumni','parent']
    )
    AND EXISTS (
      SELECT 1
      FROM public.feed_posts AS post
      WHERE post.id = feed_comments.post_id
        AND post.organization_id = feed_comments.organization_id
        AND post.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "feed_comments_update" ON public.feed_comments;
CREATE POLICY "feed_comments_update" ON public.feed_comments
  FOR UPDATE USING (
    author_id = (SELECT auth.uid())
  )
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND has_active_role(
      feed_comments.organization_id,
      array['admin','active_member','alumni','parent']
    )
    AND EXISTS (
      SELECT 1
      FROM public.feed_posts AS post
      WHERE post.id = feed_comments.post_id
        AND post.organization_id = feed_comments.organization_id
        AND post.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "feed_likes_insert" ON public.feed_likes;
CREATE POLICY "feed_likes_insert" ON public.feed_likes
  FOR INSERT WITH CHECK (
    user_id = (SELECT auth.uid())
    AND has_active_role(
      feed_likes.organization_id,
      array['admin','active_member','alumni','parent']
    )
    AND EXISTS (
      SELECT 1
      FROM public.feed_posts AS post
      WHERE post.id = feed_likes.post_id
        AND post.organization_id = feed_likes.organization_id
        AND post.deleted_at IS NULL
    )
  );
