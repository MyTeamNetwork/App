-- Align chat RLS with parent role access enabled in app navigation/chat_groups.
-- This keeps chat behavior consistent for active parent users who are group members.

-- chat_group_members: allow parent role to read membership rows for groups they belong to.
DROP POLICY IF EXISTS chat_group_members_select ON public.chat_group_members;
CREATE POLICY chat_group_members_select ON public.chat_group_members
  FOR SELECT USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni', 'parent'])
    AND (
      (
        removed_at IS NULL
        AND is_chat_group_member(chat_group_id) = TRUE
      )
      OR (
        has_active_role(organization_id, array['admin'])
        OR is_chat_group_moderator(chat_group_id) = TRUE
        OR is_chat_group_creator(chat_group_id) = TRUE
      )
    )
  );

-- chat_messages: allow parent role for read/send when they are in the chat group.
DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages;
CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT USING (
    deleted_at IS NULL
    AND has_active_role(organization_id, array['admin', 'active_member', 'alumni', 'parent'])
    AND (
      has_active_role(organization_id, array['admin'])
      OR (
        is_chat_group_member(chat_group_id)
        AND (
          status = 'approved'
          OR author_id = auth.uid()
          OR is_chat_group_moderator(chat_group_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS chat_messages_insert ON public.chat_messages;
CREATE POLICY chat_messages_insert ON public.chat_messages
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni', 'parent'])
    AND author_id = auth.uid()
    AND (
      has_active_role(organization_id, array['admin'])
      OR is_chat_group_member(chat_group_id)
    )
  );

-- chat polls/forms: allow parent role to vote/respond as group members.
DROP POLICY IF EXISTS chat_poll_votes_select ON public.chat_poll_votes;
CREATE POLICY chat_poll_votes_select ON public.chat_poll_votes
  FOR SELECT USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni', 'parent'])
    AND is_chat_group_member(chat_group_id) = TRUE
  );

DROP POLICY IF EXISTS chat_poll_votes_insert ON public.chat_poll_votes;
CREATE POLICY chat_poll_votes_insert ON public.chat_poll_votes
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni', 'parent'])
    AND is_chat_group_member(chat_group_id) = TRUE
    AND user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS chat_form_responses_select ON public.chat_form_responses;
CREATE POLICY chat_form_responses_select ON public.chat_form_responses
  FOR SELECT USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni', 'parent'])
    AND is_chat_group_member(chat_group_id) = TRUE
  );

DROP POLICY IF EXISTS chat_form_responses_insert ON public.chat_form_responses;
CREATE POLICY chat_form_responses_insert ON public.chat_form_responses
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni', 'parent'])
    AND is_chat_group_member(chat_group_id) = TRUE
    AND user_id = (SELECT auth.uid())
  );

NOTIFY pgrst, 'reload schema';
