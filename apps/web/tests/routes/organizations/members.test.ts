import { describe, it } from "node:test";
import assert from "node:assert";
import { patchMember, reinstateMember } from "@/lib/organizations/members";
import { createSupabaseStub } from "../../utils/supabaseStub";

/**
 * Characterization tests for the members mutation service layer (U12).
 *
 * These REPLACE the former hand-rolled `simulatePatchMember()` mirror that
 * duplicated route logic inside the test file and could not catch route drift.
 * They drive the REAL extracted service functions (`patchMember`,
 * `reinstateMember`) through the shared Supabase stub, exercising the same
 * `executeMemberRoleChange` engine and `reinstate_alumni_to_active` RPC the
 * production routes use.
 *
 * Scope note: UUID param validation, the 401 (no authenticated user), the
 * resolver's admin denial (mapped to a neutral 404 for non-members, 403 for
 * non-admins), and the read-only gate now live in the ROUTE layer, delegating
 * to the shared resolver + `denialResponse`/`readOnlyGuard` mappers whose
 * denial→HTTP contract is locked in settings-service.test.ts and
 * organizations-context.test.ts. This file locks the SERVICE behavior —
 * role-change engine outcomes and their status/body mapping.
 */

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const MEMBER_ROW_ID = "55555555-5555-4555-8555-555555555555";

/** Build a stub whose `execute_member_role_change` RPC mirrors the Postgres
 * function: update the membership row, raise P0002 when the target is absent.
 * Matches tests/members/role-change.test.ts. */
function client() {
  const stub = createSupabaseStub();
  stub.registerRpc("execute_member_role_change", async (params: Record<string, unknown>) => {
    const orgId = params.p_organization_id as string;
    const targetUserId = params.p_target_user_id as string;
    const newRole = params.p_new_role as string;
    const newStatus = params.p_new_status as string;

    const existing = stub
      .getRows("user_organization_roles")
      .find((r) => r.organization_id === orgId && r.user_id === targetUserId);
    if (!existing) {
      const err = new Error("member_not_found") as Error & { code?: string };
      err.code = "P0002";
      throw err;
    }

    await stub
      .from("user_organization_roles")
      .update({ role: newRole, status: newStatus })
      .eq("organization_id", orgId)
      .eq("user_id", targetUserId);
    return "audit-id";
  });
  return stub;
}

type ServiceClient = Parameters<typeof patchMember>[0];

function seedActiveOrg(stub: ReturnType<typeof client>) {
  stub.seed("organizations", [{ id: ORG_ID, name: "Test Org", slug: "test-org" }]);
  stub.seed("organization_subscriptions", [
    { organization_id: ORG_ID, status: "active", alumni_bucket: "0-250", parents_bucket: "0-250" },
  ]);
}

function seedAdmin(stub: ReturnType<typeof client>, userId: string) {
  stub.seed("user_organization_roles", [
    { organization_id: ORG_ID, user_id: userId, role: "admin", status: "active" },
  ]);
}

// -- patchMember ---------------------------------------------------------------

describe("patchMember service", () => {
  it("returns ok + slug when an admin changes a member's role", async () => {
    const stub = client();
    seedActiveOrg(stub);
    seedAdmin(stub, ADMIN_ID);
    stub.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "active_member", status: "active" },
    ]);

    const result = await patchMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      actorUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
      role: "alumni",
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.ok && result.slug, "test-org");
    const row = stub
      .getRows("user_organization_roles")
      .find((r) => r.user_id === TARGET_ID);
    assert.strictEqual(row?.role, "alumni");
  });

  it("returns ok when an admin revokes a member's access", async () => {
    const stub = client();
    seedActiveOrg(stub);
    seedAdmin(stub, ADMIN_ID);
    stub.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "active_member", status: "active" },
    ]);

    const result = await patchMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      actorUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
      status: "revoked",
    });

    assert.strictEqual(result.ok, true);
  });

  it("maps a non-admin actor to 403 Forbidden (engine re-checks the actor)", async () => {
    const stub = client();
    seedActiveOrg(stub);
    stub.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: ADMIN_ID, role: "active_member", status: "active" },
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "active_member", status: "active" },
    ]);

    const result = await patchMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      actorUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
      role: "alumni",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ok === false && result.status, 403);
    assert.strictEqual(result.ok === false && result.error, "Forbidden");
  });

  it("maps a missing target membership to 404 target_not_found", async () => {
    const stub = client();
    seedActiveOrg(stub);
    seedAdmin(stub, ADMIN_ID);
    // No target row seeded.

    const result = await patchMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      actorUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
      role: "alumni",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ok === false && result.status, 404);
    assert.strictEqual(result.ok === false && result.error, "target_not_found");
  });

  it("maps a no-op change to 400 no_change", async () => {
    const stub = client();
    seedActiveOrg(stub);
    seedAdmin(stub, ADMIN_ID);
    stub.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "active_member", status: "active" },
    ]);

    const result = await patchMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      actorUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
      role: "active_member",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ok === false && result.status, 400);
    assert.strictEqual(result.ok === false && result.error, "no_change");
  });

  it("LOCKS current behavior: last-admin self-demotion is blocked with 400", async () => {
    // Characterization only -- whatever today's behavior is, it is locked here.
    const stub = client();
    seedActiveOrg(stub);
    seedAdmin(stub, ADMIN_ID); // sole admin
    const result = await patchMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      actorUserId: ADMIN_ID,
      targetUserId: ADMIN_ID,
      role: "active_member",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ok === false && result.status, 400);
    assert.strictEqual(
      result.ok === false && result.error,
      "You are the only admin in this organization."
    );
  });

  it("allows demoting an admin when another active admin remains", async () => {
    const stub = client();
    seedActiveOrg(stub);
    seedAdmin(stub, ADMIN_ID);
    stub.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: SECOND_ADMIN_ID, role: "admin", status: "active" },
    ]);

    const result = await patchMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      actorUserId: ADMIN_ID,
      targetUserId: SECOND_ADMIN_ID,
      role: "active_member",
    });

    assert.strictEqual(result.ok, true);
  });

  it("LOCKS current behavior: alumni promotion blocked when alumni bucket is 'none'", async () => {
    const stub = client();
    stub.seed("organizations", [{ id: ORG_ID, name: "Test Org", slug: "test-org" }]);
    stub.seed("organization_subscriptions", [
      { organization_id: ORG_ID, status: "active", alumni_bucket: "none", parents_bucket: "0-250" },
    ]);
    seedAdmin(stub, ADMIN_ID);
    stub.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "active_member", status: "active" },
    ]);

    const result = await patchMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      actorUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
      role: "alumni",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ok === false && result.status, 400);
    assert.strictEqual(result.ok === false && result.error, "Upgrade required for alumni role.");
  });
});

// -- reinstateMember -----------------------------------------------------------

/** Register the reinstate RPC to mirror the Postgres function's success shape. */
function reinstateClient() {
  const stub = createSupabaseStub();
  stub.registerRpc("reinstate_alumni_to_active", () => ({ success: true }));
  return stub;
}

describe("reinstateMember service", () => {
  it("reinstates an alumni member with a linked account", async () => {
    const stub = reinstateClient();
    stub.seed("members", [
      { id: MEMBER_ROW_ID, organization_id: ORG_ID, user_id: TARGET_ID, graduated_at: null },
    ]);
    stub.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "alumni", status: "active" },
    ]);

    const result = await reinstateMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      memberId: MEMBER_ROW_ID,
    });

    assert.strictEqual(result.ok, true);
  });

  it("reinstates a graduated (non-alumni) member", async () => {
    const stub = reinstateClient();
    stub.seed("members", [
      {
        id: MEMBER_ROW_ID,
        organization_id: ORG_ID,
        user_id: TARGET_ID,
        graduated_at: "2025-06-01T00:00:00Z",
      },
    ]);
    stub.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "active_member", status: "active" },
    ]);

    const result = await reinstateMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      memberId: MEMBER_ROW_ID,
    });

    assert.strictEqual(result.ok, true);
  });

  it("returns 404 when the member row does not exist", async () => {
    const stub = reinstateClient();
    const result = await reinstateMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      memberId: MEMBER_ROW_ID,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ok === false && result.status, 404);
    assert.strictEqual(result.ok === false && result.error, "Member not found");
  });

  it("returns 400 when the member has no linked user account", async () => {
    const stub = reinstateClient();
    stub.seed("members", [
      { id: MEMBER_ROW_ID, organization_id: ORG_ID, user_id: null, graduated_at: "2025-06-01T00:00:00Z" },
    ]);

    const result = await reinstateMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      memberId: MEMBER_ROW_ID,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ok === false && result.status, 400);
    assert.strictEqual(
      result.ok === false && result.error,
      "Member does not have a linked user account"
    );
  });

  it("returns 400 when the member is neither graduated nor alumni", async () => {
    const stub = reinstateClient();
    stub.seed("members", [
      { id: MEMBER_ROW_ID, organization_id: ORG_ID, user_id: TARGET_ID, graduated_at: null },
    ]);
    stub.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "active_member", status: "active" },
    ]);

    const result = await reinstateMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      memberId: MEMBER_ROW_ID,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ok === false && result.status, 400);
    assert.strictEqual(result.ok === false && result.error, "Member is not graduated or alumni");
  });

  it("returns 500 when the reinstate RPC fails", async () => {
    const stub = createSupabaseStub();
    stub.registerRpc("reinstate_alumni_to_active", () => ({ success: false, error: "rpc boom" }));
    stub.seed("members", [
      { id: MEMBER_ROW_ID, organization_id: ORG_ID, user_id: TARGET_ID, graduated_at: "2025-06-01T00:00:00Z" },
    ]);
    stub.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: TARGET_ID, role: "alumni", status: "active" },
    ]);

    const result = await reinstateMember(stub as unknown as ServiceClient, {
      organizationId: ORG_ID,
      memberId: MEMBER_ROW_ID,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ok === false && result.status, 500);
    assert.strictEqual(result.ok === false && result.error, "rpc boom");
  });
});
