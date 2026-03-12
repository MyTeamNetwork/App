-- Grant execute permission on redeem_parent_invite to authenticated users.
-- This was missing from all prior parent invite migrations.
-- Pattern mirrors redeem_org_invite and other user-facing invite RPCs.
GRANT EXECUTE ON FUNCTION public.redeem_parent_invite(text) TO authenticated;
