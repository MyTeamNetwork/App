-- =====================================================
-- Migration: Invite Security Hardening
-- Date: 2027-01-03
-- Purpose: Fix three invite-system security defects:
--   1. redeem_parent_invite had no server-side brute-force protection for
--      the deliberately short (8-char, typeable) parent invite codes.
--   2. redeem_enterprise_invite / complete_enterprise_invite_redemption
--      checked the 12-admin cap without an advisory lock, so two concurrent
--      redemptions against two DIFFERENT invites for the same enterprise
--      could both pass the count check and exceed the cap. The per-row
--      `FOR UPDATE` lock only serializes redeemers of the SAME invite.
--   3. (App-code fix, see accept/route.ts) The parent invite accept route
--      returned distinguishable responses for "email already registered"
--      vs. success, leaking account existence to anyone holding a valid
--      invite code.
-- =====================================================

-- =====================================================
-- Part 1: Brute-force protection for redeem_parent_invite
-- =====================================================
-- The 8-char uppercase code format (4 random bytes, 32 bits) is a deliberate
-- product decision: parents type codes by hand on /app/join. The 32-bit space
-- is defended by the durable attempt limiter below rather than longer codes.
-- Durable, windowed attempt counter keyed by (auth user, IP). Both are
-- available to the RPC: auth.uid() from the JWT and inet_client_addr()
-- from the connection (Supabase's pooled connections still expose the
-- originating client address for direct Postgres connections; as a
-- fallback when it's NULL we key on user alone so authenticated abuse is
-- still capped even if the network layer hides the IP).
CREATE TABLE IF NOT EXISTS public.parent_invite_redemption_attempts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_key     TEXT        NOT NULL,
  window_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count   INTEGER     NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS parent_invite_redemption_attempts_key_idx
  ON public.parent_invite_redemption_attempts(attempt_key);

ALTER TABLE public.parent_invite_redemption_attempts ENABLE ROW LEVEL SECURITY;

-- No client-facing policies: this table is only ever touched by the
-- SECURITY DEFINER redeem_parent_invite function, so RLS defaults to
-- deny-all for authenticated/anon roles (defense in depth).

-- =====================================================
-- Part 3: Recreate redeem_parent_invite
-- =====================================================
-- Carries forward the full body from 20260701000003 (latest definer as of
-- this migration: ambiguous-parent-match handling) unchanged, except for
-- the new brute-force gate inserted immediately after authentication and
-- before the code lookup. Nothing else in the function body changed.
CREATE OR REPLACE FUNCTION public.redeem_parent_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite                  record;
  v_org                     record;
  v_existing                record;
  v_user_id                 uuid;
  v_user_email              text;
  v_claimed                 record;
  v_parent                  record;
  v_parent_match_count      integer;
  v_parent_match_id         uuid;
  v_ambiguous_parent_error  constant text := 'Multiple parent records match this account. Please contact your organization admin.';
  v_attempt_key             text;
  v_attempt_window          constant interval := interval '15 minutes';
  v_attempt_limit           constant integer := 10;
  v_attempt_count           integer;
BEGIN
  v_user_id := auth.uid();

  -- Must be authenticated
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be logged in to redeem an invite');
  END IF;

  -- Brute-force protection: windowed attempt counter keyed by user + IP.
  -- Falls back to user-only if the network layer doesn't expose an IP.
  -- Single UPSERT-increment keeps this race-safe under concurrent calls:
  -- the unique index on attempt_key + ON CONFLICT makes the check-and-
  -- increment atomic without an explicit advisory lock.
  v_attempt_key := v_user_id::text || ':' || coalesce(inet_client_addr()::text, 'no-ip');

  INSERT INTO public.parent_invite_redemption_attempts (attempt_key, window_start, attempt_count, updated_at)
  VALUES (v_attempt_key, now(), 1, now())
  ON CONFLICT (attempt_key) DO UPDATE
  SET attempt_count = CASE
        WHEN public.parent_invite_redemption_attempts.window_start < now() - v_attempt_window
          THEN 1
        ELSE public.parent_invite_redemption_attempts.attempt_count + 1
      END,
      window_start = CASE
        WHEN public.parent_invite_redemption_attempts.window_start < now() - v_attempt_window
          THEN now()
        ELSE public.parent_invite_redemption_attempts.window_start
      END,
      updated_at = now()
  RETURNING attempt_count INTO v_attempt_count;

  IF v_attempt_count > v_attempt_limit THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Too many invite redemption attempts. Please wait a few minutes and try again.'
    );
  END IF;

  -- Look up the user's email from auth.users
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = v_user_id;

  -- Find invite by code (case-insensitive, trimmed)
  SELECT * INTO v_invite
  FROM public.parent_invites
  WHERE upper(code) = upper(trim(p_code))
    AND status = 'pending';

  IF v_invite IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid invite code');
  END IF;

  -- Check if invite has expired
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invite has expired');
  END IF;

  -- Get the organization
  SELECT * INTO v_org
  FROM public.organizations
  WHERE id = v_invite.organization_id;

  IF v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization not found');
  END IF;

  -- Check if user already has a membership in this org
  SELECT * INTO v_existing
  FROM public.user_organization_roles
  WHERE user_id = v_user_id
    AND organization_id = v_invite.organization_id;

  IF v_existing IS NOT NULL THEN
    IF v_existing.status = 'revoked' THEN
      -- Resolve an existing parent row before claiming the invite so ambiguous
      -- duplicates fail closed without consuming the invite or reactivating the user.
      SELECT count(*)::integer, min(id)
      INTO v_parent_match_count, v_parent_match_id
      FROM (
        SELECT id
        FROM public.parents
        WHERE organization_id = v_invite.organization_id
          AND user_id = v_user_id
          AND deleted_at IS NULL
        LIMIT 2
      ) matched_parents;

      IF v_parent_match_count > 1 THEN
        RETURN jsonb_build_object('success', false, 'error', v_ambiguous_parent_error);
      END IF;

      IF v_parent_match_count = 1 THEN
        SELECT * INTO v_parent
        FROM public.parents
        WHERE id = v_parent_match_id;
      END IF;

      IF v_parent IS NULL AND v_user_email IS NOT NULL THEN
        SELECT count(*)::integer, min(id)
        INTO v_parent_match_count, v_parent_match_id
        FROM (
          SELECT id
          FROM public.parents
          WHERE organization_id = v_invite.organization_id
            AND lower(email) = lower(v_user_email)
            AND deleted_at IS NULL
          LIMIT 2
        ) matched_parents;

        IF v_parent_match_count > 1 THEN
          RETURN jsonb_build_object('success', false, 'error', v_ambiguous_parent_error);
        END IF;

        IF v_parent_match_count = 1 THEN
          SELECT * INTO v_parent
          FROM public.parents
          WHERE id = v_parent_match_id;
        END IF;
      END IF;

      -- Atomically claim the invite after ambiguity checks pass.
      UPDATE public.parent_invites
      SET status = 'accepted', accepted_at = now()
      WHERE id = v_invite.id AND status = 'pending'
      RETURNING * INTO v_claimed;

      IF v_claimed IS NULL THEN
        -- Another concurrent request already claimed this invite
        RETURN jsonb_build_object('success', false, 'error', 'This invite has already been used');
      END IF;

      -- Reactivate revoked user with parent role only after the invite is secured.
      UPDATE public.user_organization_roles
      SET status = 'active', role = 'parent'::public.user_role
      WHERE user_id = v_user_id
        AND organization_id = v_invite.organization_id;

      IF v_parent IS NOT NULL AND v_parent.user_id IS DISTINCT FROM v_user_id THEN
        -- Link existing record to this auth user.
        UPDATE public.parents
        SET user_id = v_user_id, updated_at = now()
        WHERE id = v_parent.id;
      END IF;

      IF v_parent IS NULL THEN
        -- Create new parent record using auth user's email and metadata.
        INSERT INTO public.parents (organization_id, user_id, email, first_name, last_name)
        VALUES (
          v_invite.organization_id,
          v_user_id,
          v_user_email,
          coalesce(
            (SELECT raw_user_meta_data ->> 'first_name' FROM auth.users WHERE id = v_user_id),
            split_part(coalesce(v_user_email, ''), '@', 1)
          ),
          coalesce(
            (SELECT raw_user_meta_data ->> 'last_name' FROM auth.users WHERE id = v_user_id),
            ''
          )
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'organization_id', v_invite.organization_id,
        'slug', v_org.slug,
        'name', v_org.name,
        'role', 'parent',
        'pending_approval', false
      );
    END IF;

    -- Already active member (any role)
    RETURN jsonb_build_object(
      'success', true,
      'organization_id', v_invite.organization_id,
      'slug', v_org.slug,
      'name', v_org.name,
      'already_member', true,
      'status', v_existing.status
    );
  END IF;

  -- Resolve an existing parent row before claiming the invite so ambiguous
  -- duplicates fail closed without consuming the invite.
  SELECT count(*)::integer, min(id)
  INTO v_parent_match_count, v_parent_match_id
  FROM (
    SELECT id
    FROM public.parents
    WHERE organization_id = v_invite.organization_id
      AND user_id = v_user_id
      AND deleted_at IS NULL
    LIMIT 2
  ) matched_parents;

  IF v_parent_match_count > 1 THEN
    RETURN jsonb_build_object('success', false, 'error', v_ambiguous_parent_error);
  END IF;

  IF v_parent_match_count = 1 THEN
    SELECT * INTO v_parent
    FROM public.parents
    WHERE id = v_parent_match_id;
  END IF;

  IF v_parent IS NULL AND v_user_email IS NOT NULL THEN
    SELECT count(*)::integer, min(id)
    INTO v_parent_match_count, v_parent_match_id
    FROM (
      SELECT id
      FROM public.parents
      WHERE organization_id = v_invite.organization_id
        AND lower(email) = lower(v_user_email)
        AND deleted_at IS NULL
      LIMIT 2
    ) matched_parents;

    IF v_parent_match_count > 1 THEN
      RETURN jsonb_build_object('success', false, 'error', v_ambiguous_parent_error);
    END IF;

    IF v_parent_match_count = 1 THEN
      SELECT * INTO v_parent
      FROM public.parents
      WHERE id = v_parent_match_id;
    END IF;
  END IF;

  -- Atomically claim the invite after ambiguity checks pass.
  UPDATE public.parent_invites
  SET status = 'accepted', accepted_at = now()
  WHERE id = v_invite.id AND status = 'pending'
  RETURNING * INTO v_claimed;

  IF v_claimed IS NULL THEN
    -- Another request claimed it first
    RETURN jsonb_build_object('success', false, 'error', 'This invite has already been used');
  END IF;

  IF v_parent IS NOT NULL AND v_parent.user_id IS DISTINCT FROM v_user_id THEN
    -- Link existing record to this auth user.
    UPDATE public.parents
    SET user_id = v_user_id, updated_at = now()
    WHERE id = v_parent.id;
  END IF;

  IF v_parent IS NULL THEN
    -- Create new parent record using auth user's email and metadata.
    INSERT INTO public.parents (organization_id, user_id, email, first_name, last_name)
    VALUES (
      v_invite.organization_id,
      v_user_id,
      v_user_email,
      coalesce(
        (SELECT raw_user_meta_data ->> 'first_name' FROM auth.users WHERE id = v_user_id),
        split_part(coalesce(v_user_email, ''), '@', 1)
      ),
      coalesce(
        (SELECT raw_user_meta_data ->> 'last_name' FROM auth.users WHERE id = v_user_id),
        ''
      )
    );
  END IF;

  -- Grant org membership with parent role, active status.
  INSERT INTO public.user_organization_roles (user_id, organization_id, role, status)
  VALUES (v_user_id, v_invite.organization_id, 'parent'::public.user_role, 'active');

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_invite.organization_id,
    'slug', v_org.slug,
    'name', v_org.name,
    'role', 'parent',
    'pending_approval', false
  );
END;
$$;

-- =====================================================
-- Part 4: Advisory lock for enterprise admin-cap race
-- =====================================================
-- Both functions previously took `FOR UPDATE` only on the enterprise_invites
-- row being redeemed. That serializes two redeemers of the SAME invite, but
-- not two redeemers of two DIFFERENT admin invites for the same enterprise —
-- both can pass `count(*) < 12` before either commits. Add
-- pg_advisory_xact_lock(hashtext(enterprise_id::text)) — the exact same key
-- derivation used by create_enterprise_invite's lock (20261012000000) — so
-- invite creation and invite redemption serialize against each other and
-- against themselves for a given enterprise.
--
-- Both bodies below are carried forward verbatim from the latest definer as
-- of this migration, 20261010100000_enterprise_invite_grant_enterprise_role.sql
-- (confirmed unchanged by the intervening main-branch merge), with only the
-- advisory-lock statement added immediately before the admin-count check.

-- =====================================================
-- Part 4a: redeem_enterprise_invite (org-specific path)
-- =====================================================

CREATE OR REPLACE FUNCTION public.redeem_enterprise_invite(p_code_or_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite public.enterprise_invites;
  v_user_id uuid;
  v_org_name text;
  v_org_slug text;
  v_existing_status text;
  v_orgs jsonb;
  v_admin_count integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated';
  END IF;

  SELECT * INTO v_invite
  FROM public.enterprise_invites
  WHERE (code = upper(p_code_or_token) OR token = p_code_or_token)
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND (uses_remaining IS NULL OR uses_remaining > 0)
  FOR UPDATE;

  IF v_invite IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid, expired, or fully used invite code'
    );
  END IF;

  -- Enterprise-wide invite: return org picker
  IF v_invite.organization_id IS NULL THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'slug', o.slug,
      'description', o.description
    ) ORDER BY o.name)
    INTO v_orgs
    FROM public.organizations o
    WHERE o.enterprise_id = v_invite.enterprise_id
      AND NOT EXISTS (
        SELECT 1 FROM public.user_organization_roles ur
        WHERE ur.user_id = v_user_id
          AND ur.organization_id = o.id
          AND ur.status IN ('active', 'pending')
      );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'choose_org',
      'enterprise_id', v_invite.enterprise_id,
      'role', v_invite.role,
      'organizations', COALESCE(v_orgs, '[]'::jsonb),
      'invite_token', v_invite.token
    );
  END IF;

  -- Serialize concurrent redemptions per enterprise so the admin-cap check
  -- below is atomic with respect to OTHER invites' redemptions and to
  -- create_enterprise_invite. Same lock key as create_enterprise_invite.
  PERFORM pg_advisory_xact_lock(hashtext(v_invite.enterprise_id::text));

  -- Org-specific invite: enforce admin cap
  IF v_invite.role = 'admin' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.user_organization_roles uor
    JOIN public.organizations o ON o.id = uor.organization_id
    WHERE o.enterprise_id = v_invite.enterprise_id
      AND uor.role = 'admin'::public.user_role
      AND uor.status = 'active';

    IF v_admin_count >= 12 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Enterprise admin limit reached (maximum 12 admins across all organizations)'
      );
    END IF;
  END IF;

  -- Check existing membership
  SELECT status INTO v_existing_status
  FROM public.user_organization_roles
  WHERE user_id = v_user_id AND organization_id = v_invite.organization_id;

  IF v_existing_status = 'revoked' THEN
    UPDATE public.user_organization_roles
    SET status = 'active', role = v_invite.role::public.user_role
    WHERE user_id = v_user_id AND organization_id = v_invite.organization_id;
  ELSIF v_existing_status IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You already have a role in this organization'
    );
  ELSE
    IF v_invite.role = 'alumni' THEN
      PERFORM public.assert_alumni_quota(v_invite.organization_id);
    END IF;

    INSERT INTO public.user_organization_roles (
      user_id, organization_id, role, status
    ) VALUES (
      v_user_id, v_invite.organization_id,
      v_invite.role::public.user_role, 'active'
    );
  END IF;

  -- Grant enterprise org_admin role for admin invites so user can
  -- access the enterprise dashboard. Idempotent via ON CONFLICT.
  IF v_invite.role = 'admin' THEN
    INSERT INTO public.user_enterprise_roles (user_id, enterprise_id, role)
    VALUES (v_user_id, v_invite.enterprise_id, 'org_admin')
    ON CONFLICT (user_id, enterprise_id) DO NOTHING;
  END IF;

  SELECT name, slug INTO v_org_name, v_org_slug
  FROM public.organizations
  WHERE id = v_invite.organization_id;

  IF v_invite.uses_remaining IS NOT NULL THEN
    UPDATE public.enterprise_invites
    SET uses_remaining = uses_remaining - 1
    WHERE id = v_invite.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_invite.organization_id,
    'organization_name', v_org_name,
    'organization_slug', v_org_slug,
    'role', v_invite.role
  );
END;
$$;

-- =====================================================
-- Part 4b: complete_enterprise_invite_redemption (enterprise-wide path)
-- =====================================================

CREATE OR REPLACE FUNCTION public.complete_enterprise_invite_redemption(
  p_token text,
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite public.enterprise_invites;
  v_user_id uuid;
  v_org_name text;
  v_org_slug text;
  v_existing_status text;
  v_admin_count integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated';
  END IF;

  SELECT * INTO v_invite
  FROM public.enterprise_invites
  WHERE token = p_token
    AND organization_id IS NULL
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND (uses_remaining IS NULL OR uses_remaining > 0)
  FOR UPDATE;

  IF v_invite IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid, expired, or fully used invite'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_organization_id
      AND enterprise_id = v_invite.enterprise_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organization does not belong to this enterprise'
    );
  END IF;

  -- Serialize concurrent redemptions per enterprise so the admin-cap check
  -- below is atomic with respect to OTHER invites' redemptions and to
  -- create_enterprise_invite. Same lock key as create_enterprise_invite.
  PERFORM pg_advisory_xact_lock(hashtext(v_invite.enterprise_id::text));

  IF v_invite.role = 'admin' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.user_organization_roles uor
    JOIN public.organizations o ON o.id = uor.organization_id
    WHERE o.enterprise_id = v_invite.enterprise_id
      AND uor.role = 'admin'::public.user_role
      AND uor.status = 'active';

    IF v_admin_count >= 12 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Enterprise admin limit reached (maximum 12 admins across all organizations)'
      );
    END IF;
  END IF;

  SELECT status INTO v_existing_status
  FROM public.user_organization_roles
  WHERE user_id = v_user_id AND organization_id = p_organization_id;

  IF v_existing_status = 'revoked' THEN
    UPDATE public.user_organization_roles
    SET status = 'active', role = v_invite.role::public.user_role
    WHERE user_id = v_user_id AND organization_id = p_organization_id;
  ELSIF v_existing_status IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You already have a role in this organization'
    );
  ELSE
    IF v_invite.role = 'alumni' THEN
      PERFORM public.assert_alumni_quota(p_organization_id);
    END IF;

    INSERT INTO public.user_organization_roles (
      user_id, organization_id, role, status
    ) VALUES (
      v_user_id, p_organization_id,
      v_invite.role::public.user_role, 'active'
    );
  END IF;

  -- Grant enterprise org_admin role for admin invites so user can
  -- access the enterprise dashboard. Idempotent via ON CONFLICT.
  IF v_invite.role = 'admin' THEN
    INSERT INTO public.user_enterprise_roles (user_id, enterprise_id, role)
    VALUES (v_user_id, v_invite.enterprise_id, 'org_admin')
    ON CONFLICT (user_id, enterprise_id) DO NOTHING;
  END IF;

  SELECT name, slug INTO v_org_name, v_org_slug
  FROM public.organizations
  WHERE id = p_organization_id;

  IF v_invite.uses_remaining IS NOT NULL THEN
    UPDATE public.enterprise_invites
    SET uses_remaining = uses_remaining - 1
    WHERE id = v_invite.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', p_organization_id,
    'organization_name', v_org_name,
    'organization_slug', v_org_slug,
    'role', v_invite.role
  );
END;
$$;
