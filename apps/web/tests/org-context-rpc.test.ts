import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadOrgContextFromRpc } from "../src/lib/auth/org-context-rpc.ts";

const ACTIVE_ORG_PAYLOAD = {
  found: true,
  organization: {
    id: "org-1",
    name: "Example Org",
    slug: "example",
  },
  membership: {
    role: "active_member",
    status: "active",
  },
  subscription: {
    status: "active",
    grace_period_ends_at: null,
    current_period_end: "2027-01-01T00:00:00.000Z",
    alumni_bucket: "0_250",
    parents_bucket: "0_250",
  },
};

test("loads organization, membership, and subscription in one RPC call", async () => {
  let resolveUser!: (userId: string) => void;
  const userId = new Promise<string>((resolve) => {
    resolveUser = resolve;
  });
  const getUserId = mock.fn(async () => userId);
  const rpc = mock.fn(async (functionName: string, args: { p_slug: string }) => {
    assert.equal(functionName, "get_render_org_context_by_slug");
    assert.deepEqual(args, { p_slug: "example" });
    return { data: ACTIVE_ORG_PAYLOAD, error: null };
  });

  const resultPromise = loadOrgContextFromRpc({
    orgSlug: "example",
    getUserId,
    rpc,
  });
  assert.equal(rpc.mock.callCount(), 1, "RPC starts before user validation finishes");
  resolveUser("user-1");
  const result = await resultPromise;

  assert.equal(getUserId.mock.callCount(), 1);
  assert.equal(rpc.mock.callCount(), 1);
  assert.equal(result.organization?.id, "org-1");
  assert.equal(result.userId, "user-1");
  assert.equal(result.role, "active_member");
  assert.equal(result.isActiveMember, true);
  assert.equal(result.subscription?.status, "active");
  assert.equal(result.hasAlumniAccess, true);
  assert.equal(result.hasParentsAccess, true);
});

test("returns an empty context when the RPC reports an unknown slug", async () => {
  const result = await loadOrgContextFromRpc({
    orgSlug: "missing",
    getUserId: async () => "user-1",
    rpc: async () => ({ data: { found: false }, error: null }),
  });

  assert.equal(result.organization, null);
  assert.equal(result.userId, "user-1");
  assert.equal(result.role, null);
  assert.equal(result.subscription, null);
  assert.equal(result.hasAlumniAccess, false);
  assert.equal(result.hasParentsAccess, false);
});

test("keeps role flags disabled for a non-active membership", async () => {
  const result = await loadOrgContextFromRpc({
    orgSlug: "example",
    getUserId: async () => "user-1",
    rpc: async () => ({
      data: {
        ...ACTIVE_ORG_PAYLOAD,
        membership: { role: "admin", status: "pending" },
      },
      error: null,
    }),
  });

  assert.equal(result.status, "pending");
  assert.equal(result.role, null);
  assert.equal(result.isAdmin, false);
});

test("ignores RPC membership when remote user validation fails", async () => {
  const result = await loadOrgContextFromRpc({
    orgSlug: "example",
    getUserId: async () => null,
    rpc: async () => ({
      data: {
        ...ACTIVE_ORG_PAYLOAD,
        membership: { role: "admin", status: "active" },
      },
      error: null,
    }),
  });

  assert.equal(result.userId, null);
  assert.equal(result.status, null);
  assert.equal(result.role, null);
  assert.equal(result.isAdmin, false);
  assert.equal(result.subscription, null);
  assert.equal(result.hasAlumniAccess, false);
  assert.equal(result.hasParentsAccess, false);
});

test("rejects malformed successful RPC payloads", async () => {
  await assert.rejects(
    () =>
      loadOrgContextFromRpc({
        orgSlug: "example",
        getUserId: async () => "user-1",
        rpc: async () => ({
          data: { found: true, organization: {} },
          error: null,
        }),
      }),
    /invalid organization payload/i
  );
});

test("propagates consolidated RPC errors", async () => {
  const rpcError = new Error("database unavailable");
  await assert.rejects(
    () =>
      loadOrgContextFromRpc({
        orgSlug: "example",
        getUserId: async () => "user-1",
        rpc: async () => ({ data: null, error: rpcError }),
      }),
    rpcError
  );
});

test("handles absent membership and subscription without granting access", async () => {
  const result = await loadOrgContextFromRpc({
    orgSlug: "example",
    getUserId: async () => "user-1",
    rpc: async () => ({
      data: {
        ...ACTIVE_ORG_PAYLOAD,
        membership: null,
        subscription: null,
      },
      error: null,
    }),
  });

  assert.equal(result.status, null);
  assert.equal(result.role, null);
  assert.equal(result.subscription, null);
  assert.equal(result.hasAlumniAccess, false);
  assert.equal(result.hasParentsAccess, false);
});

test("migration preserves subscription row detection and membership visibility", () => {
  const migration = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "../../supabase/migrations/20270104000000_consolidate_org_context_rpc.sql"
    ),
    "utf8"
  );

  assert.match(migration, /v_sub_found := FOUND;/);
  assert.match(migration, /PERFORM public\.sync_current_user_organization_memberships\(\);/);
  assert.match(migration, /v_status = 'active'/);
  assert.match(migration, /v_role = ANY/);
  assert.match(migration, /CASE WHEN v_sub_found THEN to_jsonb\(v_sub\)/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.get_render_org_context_by_slug\(text\) FROM PUBLIC;/
  );
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.get_org_context_by_slug/);
});

test("authenticated org context RPC permits membership self-healing writes", () => {
  const migration = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "../../supabase/migrations/20270106000000_fix_render_org_context_volatility.sql"
    ),
    "utf8"
  );

  assert.match(
    migration,
    /ALTER FUNCTION public\.get_render_org_context_by_slug\(text\) VOLATILE;/
  );
});
