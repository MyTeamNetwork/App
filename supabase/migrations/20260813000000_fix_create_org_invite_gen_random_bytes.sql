-- Fix create_org_invite: schema-qualify gen_random_bytes calls.
--
-- Background: 20260811000000_fix_function_search_path_mutable.sql recreated
-- public.create_org_invite with `SET search_path = ''` but left bare
-- gen_random_bytes(...) calls in the body. With an empty search_path the
-- unqualified name doesn't resolve (pgcrypto lives in `extensions`), causing
-- `function gen_random_bytes(integer) does not exist` at runtime.
--
-- A public.gen_random_bytes(integer) wrapper already exists (created in
-- 20260416120000_fix_invite_random_bytes.sql), so we just qualify both call
-- sites as public.gen_random_bytes(...). Definition is otherwise identical to
-- the 20260811 version (same signature, SECURITY DEFINER, search_path = '').

CREATE OR REPLACE FUNCTION public.create_org_invite(
  p_organization_id uuid,
  p_role            text DEFAULT 'active_member',
  p_uses            int  DEFAULT NULL,
  p_expires_at      timestamptz DEFAULT NULL,
  p_require_approval boolean DEFAULT NULL
)
RETURNS public.organization_invites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code   text;
  v_token  text;
  v_result public.organization_invites;
BEGIN
  -- Verify caller is admin of the organization
  IF NOT public.is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Only organization admins can create invites';
  END IF;

  -- Validate role
  IF p_role NOT IN ('admin', 'active_member', 'alumni', 'parent') THEN
    RAISE EXCEPTION 'Invalid role. Must be admin, active_member, alumni, or parent';
  END IF;

  -- Respect alumni quota for alumni invites
  IF p_role = 'alumni' THEN
    PERFORM public.assert_alumni_quota(p_organization_id);
  END IF;

  -- Generate secure random code (8 chars, alphanumeric)
  v_code := upper(substr(
    replace(replace(replace(
      encode(public.gen_random_bytes(6), 'base64'),
      '/', ''), '+', ''), '=', ''),
    1, 8
  ));

  -- Generate secure token (URL-safe base64, 32 chars)
  v_token := replace(replace(replace(
    encode(public.gen_random_bytes(24), 'base64'),
    '/', '_'), '+', '-'), '=', '');

  INSERT INTO public.organization_invites (
    organization_id,
    code,
    token,
    role,
    uses_remaining,
    expires_at,
    created_by_user_id,
    require_approval
  ) VALUES (
    p_organization_id,
    v_code,
    v_token,
    p_role,
    p_uses,
    p_expires_at,
    auth.uid(),
    p_require_approval
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;
