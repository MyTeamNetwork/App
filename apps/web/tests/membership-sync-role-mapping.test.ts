/**
 * Membership sync RPC — role-mapping contract
 *
 * members.role is a free-text job-title field ("Role/Position"), not an
 * authorization signal. 20270109100000 removes the CASE branch that converted
 * a job title literally equal to "admin" into an active org-admin membership.
 * Admin may only be granted through the audited execute_member_role_change
 * RPC or the enterprise invite flow.
 *
 * Source-contract style (see org-context-rpc.test.ts): pins the migration
 * text so a future edit that reintroduces the escalation fails loudly.
 *
 * Run: node --import ./tests/register-ts-loader.mjs --test tests/membership-sync-role-mapping.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20270109100000_remove_admin_escalation_from_membership_sync.sql",
    import.meta.url
  ),
  "utf8"
).replace(/\s+/g, " ");

describe("remove_admin_escalation_from_membership_sync migration contract", () => {
  it("never maps the members.role job title to the admin role", () => {
    assert.doesNotMatch(migration, /'admin'::public\.user_role/i);
  });

  it("keeps the non-privileged mappings and default", () => {
    assert.match(migration, /'alumni'::public\.user_role/i);
    assert.match(migration, /'parent'::public\.user_role/i);
    assert.match(migration, /ELSE 'active_member'::public\.user_role/i);
  });

  it("stays INSERT-only so existing role rows are never overwritten", () => {
    assert.match(migration, /WHERE NOT EXISTS \( SELECT 1 FROM public\.user_organization_roles existing/i);
    assert.doesNotMatch(migration, /UPDATE public\.user_organization_roles/i);
  });

  it("locks down execution: SECURITY DEFINER, empty search_path, authenticated-only", () => {
    assert.match(migration, /SECURITY DEFINER/);
    assert.match(migration, /SET search_path = ''/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.sync_current_user_organization_memberships\(\) FROM public/i);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.sync_current_user_organization_memberships\(\) FROM anon/i);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.sync_current_user_organization_memberships\(\) TO authenticated/i);
  });
});
