-- The render-context RPC self-heals the authenticated user's organization
-- memberships before reading them. That helper can insert or update rows, so
-- PostgreSQL must allow the outer function to perform volatile operations.

BEGIN;

ALTER FUNCTION public.get_render_org_context_by_slug(text) VOLATILE;

COMMIT;
