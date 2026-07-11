-- Self-heal org membership rows for the currently authenticated user.
--
-- Mobile and web both use public.user_organization_roles as the org access
-- source of truth. Imported directory rows can predate auth signup, and older
-- duplicate-account paths left some users with active members/alumni/parents
-- rows but no role row on the account they actually log in with. This RPC
-- reconciles those rows by verified auth email each time a client refreshes.

CREATE OR REPLACE FUNCTION public.sync_current_user_organization_memberships()
RETURNS TABLE (
  out_organization_id uuid,
  out_slug text,
  out_role public.user_role,
  out_status public.membership_status,
  out_source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT email INTO v_email
  FROM auth.users
  WHERE id = v_user_id
    AND email_confirmed_at IS NOT NULL;

  IF v_email IS NULL OR btrim(v_email) = '' THEN
    RETURN;
  END IF;

  INSERT INTO public.users (id, email, name, avatar_url)
  SELECT
    au.id,
    au.email,
    COALESCE(au.raw_user_meta_data->>'name', au.raw_user_meta_data->>'full_name'),
    au.raw_user_meta_data->>'avatar_url'
  FROM auth.users au
  WHERE au.id = v_user_id
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, public.users.name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url);

  WITH candidate_roles AS (
    SELECT DISTINCT ON (organization_id)
      organization_id,
      CASE
        WHEN lower(coalesce(role, '')) = 'admin' THEN 'admin'::public.user_role
        WHEN lower(coalesce(role, '')) = 'alumni' THEN 'alumni'::public.user_role
        WHEN lower(coalesce(role, '')) = 'parent' THEN 'parent'::public.user_role
        ELSE 'active_member'::public.user_role
      END AS role,
      'members'::text AS source,
      1 AS priority
    FROM public.members
    WHERE deleted_at IS NULL
      AND status = 'active'::public.member_status
      AND email IS NOT NULL
      AND lower(email) = lower(v_email)

    UNION ALL

    SELECT DISTINCT ON (a.organization_id)
      a.organization_id,
      'alumni'::public.user_role AS role,
      'alumni'::text AS source,
      2 AS priority
    FROM public.alumni a
    LEFT JOIN public.alumni_external_ids aei ON aei.alumni_id = a.id
    WHERE a.deleted_at IS NULL
      AND (
        (a.email IS NOT NULL AND lower(a.email) = lower(v_email))
        OR (
          a.email IS NULL
          AND aei.external_data IS NOT NULL
          AND aei.external_data->>'email' IS NOT NULL
          AND lower(aei.external_data->>'email') = lower(v_email)
        )
      )

    UNION ALL

    SELECT DISTINCT ON (organization_id)
      organization_id,
      'parent'::public.user_role AS role,
      'parents'::text AS source,
      3 AS priority
    FROM public.parents
    WHERE deleted_at IS NULL
      AND email IS NOT NULL
      AND lower(email) = lower(v_email)
  ),
  ranked_roles AS (
    SELECT DISTINCT ON (organization_id)
      organization_id,
      role,
      source
    FROM candidate_roles
    ORDER BY organization_id, priority
  )
  INSERT INTO public.user_organization_roles (
    user_id,
    organization_id,
    role,
    status
  )
  SELECT
    v_user_id,
    rr.organization_id,
    rr.role,
    'active'::public.membership_status
  FROM ranked_roles rr
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.user_organization_roles existing
    WHERE existing.user_id = v_user_id
      AND existing.organization_id = rr.organization_id
  );

  RETURN QUERY
  SELECT
    uor.organization_id,
    o.slug,
    uor.role,
    uor.status,
    'active'::text AS source
  FROM public.user_organization_roles uor
  JOIN public.organizations o ON o.id = uor.organization_id
  WHERE uor.user_id = v_user_id
    AND uor.status = 'active'::public.membership_status
  ORDER BY o.name;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_current_user_organization_memberships() FROM public;
GRANT EXECUTE ON FUNCTION public.sync_current_user_organization_memberships() TO authenticated;
