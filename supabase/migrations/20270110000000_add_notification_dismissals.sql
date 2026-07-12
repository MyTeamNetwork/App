-- Allow each user to clear notifications from their own inbox without
-- deleting the organization-level notification for everyone else.

ALTER TABLE public.notification_reads
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

CREATE INDEX IF NOT EXISTS notification_reads_dismissed_idx
  ON public.notification_reads (user_id, dismissed_at)
  WHERE dismissed_at IS NOT NULL;

GRANT UPDATE ON TABLE public.notification_reads TO authenticated;

DROP POLICY IF EXISTS "notification_reads_update_own" ON public.notification_reads;
CREATE POLICY "notification_reads_update_own"
  ON public.notification_reads
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
