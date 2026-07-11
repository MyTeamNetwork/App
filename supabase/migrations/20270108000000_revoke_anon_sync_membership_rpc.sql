-- Reconstructed from production. This migration was applied out-of-band on
-- 2026-07-11 (ledger version 20270108000000, name
-- "revoke_anon_sync_membership_rpc") but the file was never committed.
-- Verified against live grants: only authenticated + service_role hold
-- EXECUTE on the function.

REVOKE ALL ON FUNCTION public.sync_current_user_organization_memberships() FROM anon;
