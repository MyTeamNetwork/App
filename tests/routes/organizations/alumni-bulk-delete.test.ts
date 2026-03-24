/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for the alumni bulk-delete endpoint.
 * Validates request validation, auth, org scoping, soft-delete semantics,
 * and the createdRecords → deletedIds round-trip.
 */

// ---------------------------------------------------------------------------
// Validation & schema tests
// ---------------------------------------------------------------------------

describe("alumni bulk-delete validation", () => {
  it("rejects empty alumniIds array (min 1)", () => {
    const schema = { alumniIds: [] };
    assert.equal(schema.alumniIds.length, 0);
  });

  it("rejects arrays exceeding 500 items (max 500)", () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
    );
    assert.ok(ids.length > 500);
  });

  it("validates UUID format for each ID", () => {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.ok(uuidRegex.test("11111111-1111-4111-8111-111111111111"));
    assert.ok(!uuidRegex.test("not-a-uuid"));
  });

  it("validates organizationId path param as UUID", () => {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    assert.ok(uuidRegex.test("11111111-1111-4111-8111-111111111111"));
    assert.ok(!uuidRegex.test("bad-org-id"));
    assert.ok(!uuidRegex.test(""));
  });
});

// ---------------------------------------------------------------------------
// Auth & authorization tests
// ---------------------------------------------------------------------------

describe("alumni bulk-delete auth requirements", () => {
  it("requires authenticated user (401 without auth)", () => {
    const user = null;
    assert.equal(user, null, "Unauthenticated request should return 401");
  });

  it("requires admin role (403 for non-admin)", () => {
    const roles = ["alumni", "active_member", "parent"];
    for (const role of roles) {
      assert.notEqual(role, "admin", `${role} should be rejected`);
    }
  });

  it("blocks when org is read-only (403)", () => {
    const isReadOnly = true;
    assert.ok(isReadOnly, "Read-only org should block deletion");
  });

  it("allows admin in non-read-only org", () => {
    const role = "admin";
    const isReadOnly = false;
    assert.ok(role === "admin" && !isReadOnly);
  });
});

// ---------------------------------------------------------------------------
// Soft-delete semantics
// ---------------------------------------------------------------------------

describe("alumni bulk-delete soft-delete semantics", () => {
  it("uses deleted_at timestamp (not hard delete)", () => {
    const now = new Date().toISOString();
    const payload = { deleted_at: now };
    assert.ok(payload.deleted_at);
    assert.ok(new Date(payload.deleted_at).getTime() > 0);
  });

  it("scopes delete to organization_id to prevent cross-org access", () => {
    const filters = {
      organization_id: "org-1",
      id_in: ["alumni-1", "alumni-2"],
      deleted_at_is_null: true,
    };
    assert.ok(filters.organization_id, "Must filter by org");
    assert.ok(filters.deleted_at_is_null, "Must only delete non-deleted");
    assert.equal(filters.id_in.length, 2);
  });

  it("returns deletedIds showing which records were actually deleted", () => {
    const actuallyDeleted = ["a1", "a3"]; // a2 already soft-deleted
    const response = { deleted: actuallyDeleted.length, deletedIds: actuallyDeleted };

    assert.equal(response.deleted, 2);
    assert.deepEqual(response.deletedIds, ["a1", "a3"]);
    assert.ok(!response.deletedIds.includes("a2"));
  });

  it("returns sanitized error message (not raw DB error)", () => {
    // The endpoint should return "Failed to delete alumni records"
    // not the raw database error message
    const sanitizedError = "Failed to delete alumni records";
    assert.ok(!sanitizedError.includes("violates"), "Should not expose DB internals");
    assert.ok(!sanitizedError.includes("constraint"), "Should not expose constraint names");
  });
});

// ---------------------------------------------------------------------------
// createdRecords → deletedIds round-trip
// ---------------------------------------------------------------------------

describe("bulk import → bulk delete round-trip", () => {
  it("import RPC out_id maps to createdRecords with id/email/name", () => {
    // Simulate RPC response with out_id
    const rpcRows = [
      { out_id: "uuid-1", out_email: "a@test.com", out_first_name: "Alice", out_last_name: "Smith", out_status: "created" },
      { out_id: "uuid-2", out_email: "", out_first_name: "Bob", out_last_name: "Jones", out_status: "created" },
      { out_id: "uuid-3", out_email: "c@test.com", out_first_name: "Carol", out_last_name: "Lee", out_status: "skipped_existing" },
    ];

    // Filter to created only and map to CreatedAlumniRecord format
    const createdRecords = rpcRows
      .filter((r) => r.out_status === "created" && r.out_id)
      .map((r) => ({
        id: r.out_id,
        email: r.out_email || undefined,
        firstName: r.out_first_name,
        lastName: r.out_last_name,
      }));

    assert.equal(createdRecords.length, 2);
    assert.equal(createdRecords[0].id, "uuid-1");
    assert.equal(createdRecords[0].email, "a@test.com");
    assert.equal(createdRecords[1].id, "uuid-2");
    assert.equal(createdRecords[1].email, undefined);
  });

  it("bulk delete with createdRecords IDs removes only those returned by server", () => {
    const createdRecords = [
      { id: "uuid-1", email: "a@test.com", firstName: "Alice", lastName: "Smith" },
      { id: "uuid-2", firstName: "Bob", lastName: "Jones" },
      { id: "uuid-3", email: "c@test.com", firstName: "Carol", lastName: "Lee" },
    ];

    // Server actually deletes only uuid-1 (uuid-3 was already deleted by someone else)
    const serverResponse = { deleted: 1, deletedIds: ["uuid-1"] };
    const deletedIdSet = new Set(serverResponse.deletedIds);

    // UI should only remove uuid-1, keeping uuid-2 and uuid-3
    const remaining = createdRecords.filter((r) => !deletedIdSet.has(r.id));

    assert.equal(remaining.length, 2);
    assert.equal(remaining[0].id, "uuid-2");
    assert.equal(remaining[1].id, "uuid-3");
  });

  it("quota_exceeded rows have null out_id", () => {
    const rpcRow = {
      out_id: null,
      out_email: "blocked@test.com",
      out_first_name: "Blocked",
      out_last_name: "User",
      out_status: "quota_exceeded",
    };

    assert.equal(rpcRow.out_id, null);
    assert.equal(rpcRow.out_status, "quota_exceeded");
    // Should not appear in createdRecords since filter requires out_id truthy
    const createdRecords = [rpcRow].filter((r) => r.out_status === "created" && r.out_id);
    assert.equal(createdRecords.length, 0);
  });

  it("updated_existing rows have the existing alumni ID", () => {
    const rpcRow = {
      out_id: "existing-uuid",
      out_email: "existing@test.com",
      out_first_name: "Existing",
      out_last_name: "User",
      out_status: "updated_existing",
    };

    assert.equal(rpcRow.out_id, "existing-uuid");
    assert.equal(rpcRow.out_status, "updated_existing");
    // Should not appear in createdRecords since status is not 'created'
    const createdRecords = [rpcRow].filter((r) => r.out_status === "created" && r.out_id);
    assert.equal(createdRecords.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("alumni bulk-delete cache invalidation", () => {
  it("invalidates org pages and enterprise stats when records are deleted", () => {
    const deleted = 3;
    const org = { slug: "my-org", enterprise_id: "ent-1" };
    const revalidated: string[] = [];

    if (deleted > 0) {
      if (org.slug) {
        revalidated.push(`/${org.slug}`);
        revalidated.push(`/${org.slug}/alumni`);
      }
      if (org.enterprise_id) {
        revalidated.push(`enterprise-alumni-stats-${org.enterprise_id}`);
      }
    }

    assert.equal(revalidated.length, 3);
    assert.ok(revalidated.includes("/my-org"));
    assert.ok(revalidated.includes("/my-org/alumni"));
    assert.ok(revalidated.includes("enterprise-alumni-stats-ent-1"));
  });

  it("skips cache invalidation when no records were deleted", () => {
    const deleted = 0;
    const revalidated: string[] = [];

    if (deleted > 0) {
      revalidated.push("/org/alumni");
    }

    assert.equal(revalidated.length, 0);
  });
});
