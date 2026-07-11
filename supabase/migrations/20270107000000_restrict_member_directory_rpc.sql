-- Supabase's default function privileges grant EXECUTE directly to anon, so
-- revoking PUBLIC alone does not restrict this authenticated directory RPC.

BEGIN;

REVOKE ALL ON FUNCTION public.get_org_member_directory(
  uuid, text, text, integer, integer, text[], uuid
) FROM anon;

COMMIT;
