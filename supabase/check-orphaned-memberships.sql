-- =====================================================
-- Diagnostic Script: Check Orphaned Memberships
-- Purpose: Find users who would see "You are in no orgs" on the mobile app
--          despite belonging to an organization.
--
-- Background: The mobile org list (apps/mobile/src/hooks/useOrganizations.ts)
-- is driven entirely by rows in public.user_organization_roles keyed on the
-- logged-in auth user's id. A user who authenticates but has ZERO rows there
-- sees no organizations — even if a members/alumni record says they belong.
--
-- Two failure modes produce this, both observed in production:
--   A) Stranded on a duplicate account — the members/alumni row's email belongs
--      to one account, but its user_id (and the org role) point at a DIFFERENT
--      account. The person logs in with the email account and sees nothing.
--      (This was g.demarrais@fdu.edu: coach/admin role sat on a duplicate
--       Google account while he logged in with his email/password account.)
--   B) Org role never created — an active members/alumni record exists and
--      correctly points at the user's own account, but no user_organization_roles
--      row was ever inserted (half-completed org creation / signup).
--
-- Usage: Run in Supabase SQL Editor. Each section returns the affected rows;
--        empty results = healthy. The automated guard lives at
--        apps/web/scripts/check-orphaned-memberships.js.
-- =====================================================

-- Class A: member/alumni email belongs to a DIFFERENT account than the row's
-- user_id, AND that email-owner account has NO org role anywhere -> the person
-- logs in with the email account and sees "no orgs".
--
-- The "email owner has no role" guard is essential: an unclaimed import row
-- (user_id NULL) whose email coincides with an already-provisioned account is
-- NOT a bug (that account sees its org fine), and must not be flagged.
SELECT '=== CLASS A: STRANDED ON WRONG ACCOUNT ===' AS section;

SELECT 'members' AS source, m.id AS record_id, m.email, m.organization_id,
       o.name AS org_name, m.user_id AS record_user_id,
       u.id AS email_owner_user_id, m.status
FROM public.members m
JOIN public.users u ON lower(u.email) = lower(m.email)
LEFT JOIN public.organizations o ON o.id = m.organization_id
WHERE m.user_id IS DISTINCT FROM u.id
  AND NOT EXISTS (SELECT 1 FROM public.user_organization_roles r WHERE r.user_id = u.id)
UNION ALL
SELECT 'alumni', a.id, a.email, a.organization_id, o.name, a.user_id, u.id, NULL
FROM public.alumni a
JOIN public.users u ON lower(u.email) = lower(a.email)
LEFT JOIN public.organizations o ON o.id = a.organization_id
WHERE a.user_id IS DISTINCT FROM u.id
  AND NOT EXISTS (SELECT 1 FROM public.user_organization_roles r WHERE r.user_id = u.id);

-- Class B: user has an ACTIVE members record for their own email but zero org
-- roles anywhere -> "no orgs" despite belonging. (Only public.members carries a
-- status; alumni has no status column, so it is covered by Class A only.)
SELECT '=== CLASS B: ACTIVE MEMBER, ZERO ORG ROLES ===' AS section;

SELECT DISTINCT u.id AS user_id, u.email, u.name, m.organization_id,
       o.name AS org_name, m.role, m.status
FROM public.users u
JOIN public.members m ON lower(m.email) = lower(u.email) AND m.status = 'active'
LEFT JOIN public.organizations o ON o.id = m.organization_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_organization_roles r WHERE r.user_id = u.id
);

-- Class C: duplicate auth accounts sharing an email (root cause of Class A).
SELECT '=== CLASS C: DUPLICATE ACCOUNTS (SAME EMAIL) ===' AS section;

SELECT lower(email) AS email, count(*) AS account_count,
       array_agg(id::text ORDER BY created_at) AS user_ids
FROM public.users
GROUP BY lower(email)
HAVING count(*) > 1;

-- Summary
SELECT '=== SUMMARY ===' AS section;
SELECT
  (SELECT count(*) FROM public.members m JOIN public.users u ON lower(u.email)=lower(m.email)
     WHERE m.user_id IS DISTINCT FROM u.id
       AND NOT EXISTS (SELECT 1 FROM public.user_organization_roles r WHERE r.user_id=u.id))
  + (SELECT count(*) FROM public.alumni a JOIN public.users u ON lower(u.email)=lower(a.email)
     WHERE a.user_id IS DISTINCT FROM u.id
       AND NOT EXISTS (SELECT 1 FROM public.user_organization_roles r WHERE r.user_id=u.id)) AS class_a_stranded,
  (SELECT count(DISTINCT u.id) FROM public.users u
     JOIN public.members m ON lower(m.email)=lower(u.email) AND m.status='active'
     WHERE NOT EXISTS (SELECT 1 FROM public.user_organization_roles r WHERE r.user_id=u.id)) AS class_b_no_role,
  (SELECT count(*) FROM (SELECT 1 FROM public.users GROUP BY lower(email) HAVING count(*)>1) d) AS class_c_duplicate_emails;
