import { describe, it } from "node:test";
import assert from "node:assert";
import { createInvite, createBulkInvite } from "@/lib/organizations/invites";
import { orgInviteCreateSchema, orgBulkInviteSchema } from "@/lib/schemas/invite";
import { createSupabaseStub } from "../../utils/supabaseStub";

/**
 * Characterization tests for the org invite service layer (U12).
 *
 * These REPLACE the former `simulateCreateInvite()` mirror that duplicated route
 * logic inside the test file and could not catch route drift. They drive the
 * REAL extracted service functions (`createInvite`, `createBulkInvite`) through
 * the shared Supabase stub, exercising the same `create_org_invite` RPC the
 * production routes use.
 *
 * Scope note: UUID param validation, the 401 (no authenticated user), the
 * resolver's admin denial (mapped to a neutral 404 for non-members, 403 for
 * non-admins), and the read-only gate now live in the ROUTE layer, delegating
 * to the shared resolver + `denialResponse`/`readOnlyGuard` mappers whose
 * denial→HTTP contract is locked in settings-service.test.ts and
 * organizations-context.test.ts. This file locks the SERVICE behavior — RPC
 * success/failure mapping, quota-error forwarding, and the no-email bulk
 * fallback.
 *
 * These tests assume RESEND_API_KEY is unset (the default in CI), so the bulk
 * path takes its "no mail provider → everyone skipped" branch and never sends.
 */

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const SLUG = "acme-alumni";

/** Build a stub whose `create_org_invite` RPC returns a canned invite row and
 * seeds the org slug the service looks up for revalidation. */
function client(inviteRow: Record<string, unknown> | null, rpcError?: string) {
  const stub = createSupabaseStub();
  stub.seed("organizations", [{ id: ORG_ID, slug: SLUG, name: "Acme Alumni" }]);
  stub.registerRpc("create_org_invite", async () => {
    if (rpcError !== undefined) {
      throw new Error(rpcError);
    }
    return inviteRow;
  });
  return stub;
}

type AuthClient = Parameters<typeof createInvite>[0];
type ServiceClient = Parameters<typeof createInvite>[1];

describe("orgInviteCreateSchema validation", () => {
  it("accepts alumni invite payload", () => {
    const result = orgInviteCreateSchema.safeParse({
      role: "alumni",
      uses: 5,
      expiresAt: "2026-03-27T00:00:00.000Z",
    });
    assert.strictEqual(result.success, true);
  });

  it("accepts parent invite payload with unlimited uses", () => {
    const result = orgInviteCreateSchema.safeParse({
      role: "parent",
      uses: null,
      expiresAt: "2026-03-27T00:00:00.000Z",
    });
    assert.strictEqual(result.success, true);
  });

  it("accepts null uses and null expiry", () => {
    const result = orgInviteCreateSchema.safeParse({
      role: "active_member",
      uses: null,
      expiresAt: null,
    });
    assert.strictEqual(result.success, true);
  });

  it("rejects invalid role", () => {
    const result = orgInviteCreateSchema.safeParse({ role: "superadmin" });
    assert.strictEqual(result.success, false);
  });
});

describe("createInvite service", () => {
  it("returns the invite row + slug on RPC success", async () => {
    const inviteRow = { id: "invite-1", code: "ABC12345", role: "alumni" };
    const stub = client(inviteRow);

    const result = await createInvite(
      stub as unknown as AuthClient,
      stub as unknown as ServiceClient,
      { organizationId: ORG_ID, role: "alumni", uses: 1 }
    );

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.deepStrictEqual(result.invite, inviteRow);
    assert.strictEqual(result.slug, SLUG);
  });

  it("returns a reusable parent invite payload on success", async () => {
    const inviteRow = {
      id: "invite-parent-1",
      code: "PARENT01",
      role: "parent",
      uses_remaining: null,
    };
    const stub = client(inviteRow);

    const result = await createInvite(
      stub as unknown as AuthClient,
      stub as unknown as ServiceClient,
      { organizationId: ORG_ID, role: "parent", uses: null }
    );

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.deepStrictEqual(result.invite, inviteRow);
  });

  it("forwards the alumni quota RPC error verbatim as a 400", async () => {
    const quotaMsg =
      "Alumni quota reached for this plan. Upgrade your subscription to add more alumni.";
    const stub = client(null, quotaMsg);

    const result = await createInvite(
      stub as unknown as AuthClient,
      stub as unknown as ServiceClient,
      { organizationId: ORG_ID, role: "alumni" }
    );

    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, quotaMsg);
  });

  it("falls back to a generic 400 when the RPC returns no invite", async () => {
    const stub = client(null);

    const result = await createInvite(
      stub as unknown as AuthClient,
      stub as unknown as ServiceClient,
      { organizationId: ORG_ID, role: "alumni" }
    );

    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Failed to create invite");
  });
});

describe("orgBulkInviteSchema validation", () => {
  it("accepts a valid bulk payload", () => {
    const result = orgBulkInviteSchema.safeParse({
      emails: ["alice@example.com", "bob@example.com"],
      role: "active_member",
    });
    assert.ok(result.success);
  });
});

describe("createBulkInvite service (no mail provider)", () => {
  it("creates one reusable invite and marks every recipient skipped", async () => {
    const inviteRow = { id: "bulk-1", code: "BULK0001", token: "tok-1" };
    const stub = client(inviteRow);
    const emails = ["a@example.com", "b@example.com", "c@example.com"];

    const result = await createBulkInvite(
      stub as unknown as AuthClient,
      stub as unknown as ServiceClient,
      {
        organizationId: ORG_ID,
        emails,
        role: "active_member",
        origin: "https://app.example.com",
      }
    );

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.body.emailsDelivered, false);
    assert.strictEqual(result.body.invite.id, "bulk-1");
    assert.strictEqual(result.body.invite.code, "BULK0001");
    // A token is present, so buildInviteLink prefers it over the code.
    assert.ok(result.body.invite.link.includes("token=tok-1"));
    assert.deepStrictEqual(result.body.summary, {
      success: 0,
      failed: 0,
      skipped: emails.length,
      total: emails.length,
    });
    assert.strictEqual(result.body.results.length, emails.length);
    assert.ok(result.body.results.every((r) => r.status === "skipped"));
    assert.strictEqual(result.body.slug, SLUG);
  });

  it("maps an RPC failure to a 500 (the bulk route's historical status)", async () => {
    const stub = client(null, "boom");
    const result = await createBulkInvite(
      stub as unknown as AuthClient,
      stub as unknown as ServiceClient,
      {
        organizationId: ORG_ID,
        emails: ["a@example.com"],
        role: "active_member",
        origin: "https://app.example.com",
      }
    );

    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.error, "boom");
  });
});
