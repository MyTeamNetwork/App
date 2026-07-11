-- Replace the members page's three capped profile queries and supporting role /
-- block lookups with one RLS-aware paginated directory RPC.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_members_org_directory_sort
  ON public.members (organization_id, lower(last_name), lower(first_name), id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parents_org_directory_sort
  ON public.parents (organization_id, lower(last_name), lower(first_name), id)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_org_member_directory(
  p_org_id uuid,
  p_status text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 48,
  p_excluded_emails text[] DEFAULT ARRAY[]::text[],
  p_viewer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_page_size integer := LEAST(GREATEST(COALESCE(p_page_size, 48), 1), 100);
  -- auth.uid() is authoritative for normal callers. The explicit viewer id is
  -- only needed when the trusted server-side service client serves a dev admin.
  v_viewer_id uuid := COALESCE(auth.uid(), p_viewer_id);
BEGIN
  RETURN (
    WITH blocked_user_ids AS MATERIALIZED (
      SELECT CASE
        WHEN ub.blocker_id = v_viewer_id THEN ub.blocked_id
        ELSE ub.blocker_id
      END AS user_id
      FROM public.user_blocks ub
      WHERE v_viewer_id IS NOT NULL
        AND ub.deleted_at IS NULL
        AND (ub.blocker_id = v_viewer_id OR ub.blocked_id = v_viewer_id)
    ),
    eligible_linked_members AS MATERIALIZED (
      SELECT
        'member'::text AS source,
        m.id AS profile_id,
        m.first_name,
        m.last_name,
        m.email,
        m.photo_url,
        m.role,
        m.status::text AS status,
        m.graduation_year,
        m.linkedin_url,
        m.user_id,
        m.current_company,
        m.current_city,
        uor.role::text AS org_role
      FROM public.members m
      JOIN public.user_organization_roles uor
        ON uor.organization_id = m.organization_id
       AND uor.user_id = m.user_id
       AND uor.status = 'active'::public.membership_status
       AND uor.role::text = ANY (
         ARRAY['admin'::text, 'active_member'::text, 'parent'::text]
       )
      WHERE m.organization_id = p_org_id
        AND m.deleted_at IS NULL
        AND m.user_id IS NOT NULL
        AND m.status::text = COALESCE(NULLIF(p_status, ''), 'active')
        AND (NULLIF(p_role, '') IS NULL OR m.role = p_role)
        AND NOT EXISTS (
          SELECT 1
          FROM blocked_user_ids blocked
          WHERE blocked.user_id = m.user_id
        )
    ),
    directory_rows AS MATERIALIZED (
      -- Account-linked member profiles with an active directory-eligible org role.
      SELECT *
      FROM eligible_linked_members

      UNION ALL

      -- Manually added member profiles have no account or org-role row.
      SELECT
        'member'::text AS source,
        m.id AS profile_id,
        m.first_name,
        m.last_name,
        m.email,
        m.photo_url,
        m.role,
        m.status::text AS status,
        m.graduation_year,
        m.linkedin_url,
        m.user_id,
        m.current_company,
        m.current_city,
        NULL::text AS org_role
      FROM public.members m
      WHERE m.organization_id = p_org_id
        AND m.deleted_at IS NULL
        AND m.user_id IS NULL
        AND m.status::text = COALESCE(NULLIF(p_status, ''), 'active')
        AND (NULLIF(p_role, '') IS NULL OR m.role = p_role)
        AND NOT (
          COALESCE(lower(m.email), '') = ANY (
            COALESCE(p_excluded_emails, ARRAY[]::text[])
          )
        )

      UNION ALL

      -- Parents occupy their own profile lane and only appear for the active,
      -- unfiltered member view. Prefer a matching member profile when present.
      SELECT
        'parent'::text AS source,
        p.id AS profile_id,
        p.first_name,
        p.last_name,
        p.email,
        p.photo_url,
        CASE
          WHEN p.student_name IS NOT NULL AND p.student_name <> ''
            THEN 'Parent of ' || p.student_name
          ELSE 'Parent'
        END AS role,
        'active'::text AS status,
        NULL::integer AS graduation_year,
        p.linkedin_url,
        p.user_id,
        NULL::text AS current_company,
        NULL::text AS current_city,
        parent_role.role::text AS org_role
      FROM public.parents p
      JOIN public.user_organization_roles parent_role
        ON parent_role.organization_id = p.organization_id
       AND parent_role.user_id = p.user_id
       AND parent_role.status = 'active'::public.membership_status
       AND parent_role.role = 'parent'::public.user_role
      WHERE p.organization_id = p_org_id
        AND p.deleted_at IS NULL
        AND p.user_id IS NOT NULL
        AND COALESCE(NULLIF(p_status, ''), 'active') = 'active'
        AND NULLIF(p_role, '') IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocked_user_ids blocked
          WHERE blocked.user_id = p.user_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM eligible_linked_members linked_member
          WHERE linked_member.user_id = p.user_id
        )
    ),
    counted_rows AS MATERIALIZED (
      SELECT directory_rows.*, COUNT(*) OVER () AS total_count
      FROM directory_rows
    ),
    paged_rows AS (
      SELECT *
      FROM counted_rows
      ORDER BY lower(last_name), lower(first_name), source, profile_id
      LIMIT v_page_size
      OFFSET (v_page::bigint - 1) * v_page_size
    ),
    available_roles AS (
      SELECT DISTINCT m.role
      FROM public.members m
      WHERE m.organization_id = p_org_id
        AND m.deleted_at IS NULL
        AND m.role IS NOT NULL
        AND m.role <> 'alumni'
    )
    SELECT jsonb_build_object(
      'rows', COALESCE(
        (
          SELECT jsonb_agg(
            to_jsonb(paged_rows) - 'total_count'
            ORDER BY lower(last_name), lower(first_name), source, profile_id
          )
          FROM paged_rows
        ),
        '[]'::jsonb
      ),
      'total', COALESCE((SELECT max(total_count) FROM counted_rows), 0),
      'roles', COALESCE(
        (SELECT jsonb_agg(role ORDER BY role) FROM available_roles),
        '[]'::jsonb
      ),
      'page', v_page,
      'page_size', v_page_size
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_member_directory(
  uuid, text, text, integer, integer, text[], uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_member_directory(
  uuid, text, text, integer, integer, text[], uuid
) TO authenticated, service_role;

COMMIT;
