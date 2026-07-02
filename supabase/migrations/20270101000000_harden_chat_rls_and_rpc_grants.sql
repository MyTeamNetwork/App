-- Security hardening: lock down an over-granted SECURITY DEFINER RPC, add
-- WITH CHECK to two chat UPDATE policies with privilege-escalation paths,
-- and close the last auth.users FK that blocks GDPR account deletion.
--
-- 1. bulk_import_linkedin_alumni: SECURITY DEFINER with no authz check in its
--    body and never revoked from PUBLIC — any authenticated user could write
--    alumni rows into an arbitrary organization. Its only caller
--    (api/organizations/[organizationId]/alumni/import-linkedin) runs with the
--    service-role client behind an admin gate, so restricting to service_role
--    matches the lockdown already applied to bulk_import_alumni_rich
--    (20261015000000).
--
-- 2. chat_group_members_update / chat_messages_update: FOR UPDATE policies
--    without WITH CHECK reuse USING against the post-image, and the self/author
--    branch (user_id = auth.uid() / author_id = auth.uid()) passes both images.
--    A plain member could self-promote to group admin; a message author could
--    flip status to 'approved' (moderation bypass) or repoint their row at
--    another group in the same org. WITH CHECK below keeps the privileged
--    branches unchanged and pins the self/author branch. Verified app flows:
--    the only chat_messages UPDATE is moderation (moderator/admin branch); the
--    only chat_group_members UPDATEs are moderator/creator add/remove flows.
--
-- 3. knowledge_documents.created_by → auth.users(id) had no ON DELETE action,
--    so auth.admin.deleteUser() FK-violates for any user who authored a
--    knowledge doc. Same anonymize-on-delete policy as 20261212000000.
--    (ai_indexing_exclusions.excluded_by and enterprise_invites.created_by_user_id
--    were already fixed by 20261012000000 / 20261212000000.)
--
-- Idempotent: policies drop-then-create, FK drops IF EXISTS. Safe to re-run.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. bulk_import_linkedin_alumni: service_role only
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.bulk_import_linkedin_alumni(uuid, jsonb, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_import_linkedin_alumni(uuid, jsonb, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bulk_import_linkedin_alumni(uuid, jsonb, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_linkedin_alumni(uuid, jsonb, boolean) TO service_role;

-- ----------------------------------------------------------------------------
-- 2a. chat_group_members_update: block self-promotion and row repointing
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS chat_group_members_update ON public.chat_group_members;
CREATE POLICY chat_group_members_update ON public.chat_group_members
  FOR UPDATE USING (
    has_active_role(organization_id, ARRAY['admin'])
    OR is_chat_group_moderator(chat_group_id) = TRUE
    OR is_chat_group_creator(chat_group_id) = TRUE
    OR user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    has_active_role(organization_id, ARRAY['admin'])
    OR is_chat_group_moderator(chat_group_id) = TRUE
    OR is_chat_group_creator(chat_group_id) = TRUE
    OR (
      -- Self-service is limited to non-privileged rows in a group the user is
      -- already an active member of (blocks role escalation and repointing the
      -- row at another group; leave-group still passes — the pre-update row is
      -- still active in the statement snapshot is_chat_group_member reads).
      user_id = (SELECT auth.uid())
      AND role = 'member'::public.chat_group_role
      AND is_chat_group_member(chat_group_id) = TRUE
    )
  );

-- ----------------------------------------------------------------------------
-- 2b. chat_messages_update: block author moderation bypass
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS chat_messages_update ON public.chat_messages;
CREATE POLICY chat_messages_update ON public.chat_messages
  FOR UPDATE TO public
  USING (
    (deleted_at IS NULL)
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    AND (
      is_chat_group_moderator(chat_group_id)
      OR has_active_role(organization_id, ARRAY['admin'])
      OR (author_id = (SELECT auth.uid()))
    )
  )
  WITH CHECK (
    (deleted_at IS NULL)
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    AND (
      is_chat_group_moderator(chat_group_id)
      OR has_active_role(organization_id, ARRAY['admin'])
      OR (
        -- Authors may only produce rows still awaiting moderation, in a group
        -- they are an active member of (blocks self-approval and repointing a
        -- message at another group). Moderator approval flows use the
        -- privileged branches above.
        author_id = (SELECT auth.uid())
        AND status = 'pending'::public.chat_message_status
        AND is_chat_group_member(chat_group_id)
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 3. knowledge_documents.created_by: anonymize on user deletion
-- ----------------------------------------------------------------------------
ALTER TABLE public.knowledge_documents
  DROP CONSTRAINT IF EXISTS knowledge_documents_created_by_fkey,
  ADD CONSTRAINT knowledge_documents_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;
