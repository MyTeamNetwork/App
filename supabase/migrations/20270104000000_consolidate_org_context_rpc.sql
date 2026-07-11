-- Consolidate the organization, membership, and subscription records needed by
-- getOrgContext() into a render-specific slug RPC. Rendering can now load the
-- complete context in one database round trip while retaining the current
-- user's membership self-healing step from the preceding migration.
-- The existing public/middleware get_org_context_by_slug contract is left
-- unchanged so its response shape and subscription visibility remain stable.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_render_org_context_by_slug(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_org record;
  v_user_id uuid;
  v_role text;
  v_status text;
  v_language_override text;
  v_sub record;
  v_sub_found boolean := false;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NOT NULL THEN
    PERFORM public.sync_current_user_organization_memberships();
  END IF;

  SELECT
    id,
    name,
    slug,
    logo_url,
    base_color,
    primary_color,
    secondary_color,
    nav_config,
    stripe_connect_account_id,
    org_type,
    donation_embed_url,
    created_at,
    feed_post_roles,
    job_post_roles,
    discussion_post_roles,
    media_upload_roles,
    timezone,
    hide_donor_names,
    captcha_provider,
    default_language
  INTO v_org
  FROM public.organizations
  WHERE slug = p_slug;

  IF v_org IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT uor.role, uor.status, u.language_override
    INTO v_role, v_status, v_language_override
    FROM public.user_organization_roles uor
    JOIN public.users u ON u.id = uor.user_id
    WHERE uor.organization_id = v_org.id
      AND uor.user_id = v_user_id;
  END IF;

  -- Match get_subscription_status visibility without repeating its membership
  -- query: the current user's role and status are already loaded above.
  IF v_status = 'active'
    AND v_role = ANY (ARRAY['admin', 'active_member', 'alumni', 'parent'])
  THEN
    SELECT
      status,
      grace_period_ends_at,
      current_period_end,
      alumni_bucket,
      parents_bucket
    INTO v_sub
    FROM public.organization_subscriptions
    WHERE organization_id = v_org.id
    LIMIT 1;
    v_sub_found := FOUND;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'organization', to_jsonb(v_org),
    'membership', CASE WHEN v_role IS NOT NULL THEN jsonb_build_object(
      'role', v_role,
      'status', v_status,
      'language_override', v_language_override
    ) ELSE NULL END,
    'subscription', CASE WHEN v_sub_found THEN to_jsonb(v_sub) ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_render_org_context_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_render_org_context_by_slug(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_render_org_context_by_slug(text) TO anon;

COMMIT;
