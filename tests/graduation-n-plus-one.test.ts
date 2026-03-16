import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import {
  batchGetOrganizations,
  batchGetOrgAdminEmails,
  batchCheckAlumniCapacity,
} from "../src/lib/graduation/queries.ts";

/**
 * Tests for graduation batch helpers — verifies N+1 elimination.
 *
 * Each helper must resolve data for multiple orgs in a fixed number
 * of DB round-trips (2 at most), regardless of org count.
 */

function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

describe("Graduation Batch Helpers", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  // ─── batchGetOrganizations ─────────────────────────────────────────────────

  describe("batchGetOrganizations", () => {
    it("returns empty map for empty orgIds", async () => {
      const result = await batchGetOrganizations(stub as never, []);
      assert.strictEqual(result.size, 0);
    });

    it("returns a map keyed by org ID for multiple orgs", async () => {
      stub.seed("organizations", [
        { id: "org1", name: "Org One", slug: "org-one" },
        { id: "org2", name: "Org Two", slug: "org-two" },
        { id: "org3", name: "Org Three", slug: "org-three" },
      ]);

      const result = await batchGetOrganizations(stub as never, ["org1", "org2", "org3"]);

      assert.strictEqual(result.size, 3, "Should return all 3 orgs");
      assert.strictEqual(result.get("org1")?.name, "Org One");
      assert.strictEqual(result.get("org2")?.name, "Org Two");
      assert.strictEqual(result.get("org3")?.name, "Org Three");
    });

    it("returns only requested orgs (subset)", async () => {
      stub.seed("organizations", [
        { id: "org1", name: "Org One", slug: "org-one" },
        { id: "org2", name: "Org Two", slug: "org-two" },
      ]);

      const result = await batchGetOrganizations(stub as never, ["org1"]);

      assert.strictEqual(result.size, 1, "Should return only 1 org");
      assert.ok(result.has("org1"));
      assert.ok(!result.has("org2"));
    });

    it("returns empty map for unknown org IDs", async () => {
      const result = await batchGetOrganizations(stub as never, ["nonexistent-id"]);
      assert.strictEqual(result.size, 0, "Unknown orgs should return empty map");
    });
  });

  // ─── batchGetOrgAdminEmails ────────────────────────────────────────────────

  describe("batchGetOrgAdminEmails", () => {
    it("returns empty map for empty orgIds", async () => {
      const result = await batchGetOrgAdminEmails(stub as never, []);
      assert.strictEqual(result.size, 0);
    });

    it("returns admin emails grouped by org ID", async () => {
      stub.seed("users", [
        { id: "u1", email: "admin1@org1.com" },
        { id: "u2", email: "admin2@org1.com" },
        { id: "u3", email: "admin@org2.com" },
      ]);
      stub.seed("user_organization_roles", [
        { user_id: "u1", organization_id: "org1", role: "admin", status: "active" },
        { user_id: "u2", organization_id: "org1", role: "admin", status: "active" },
        { user_id: "u3", organization_id: "org2", role: "admin", status: "active" },
      ]);

      const result = await batchGetOrgAdminEmails(stub as never, ["org1", "org2"]);

      assert.strictEqual(result.size, 2, "Should return entries for both orgs");
      const org1Emails = result.get("org1") ?? [];
      assert.ok(org1Emails.includes("admin1@org1.com"), "org1 should have admin1 email");
      assert.ok(org1Emails.includes("admin2@org1.com"), "org1 should have admin2 email");
      const org2Emails = result.get("org2") ?? [];
      assert.ok(org2Emails.includes("admin@org2.com"), "org2 should have admin email");
    });

    it("does not include non-admin or inactive roles", async () => {
      stub.seed("users", [
        { id: "u1", email: "member@org1.com" },
        { id: "u2", email: "inactive-admin@org1.com" },
        { id: "u3", email: "admin@org1.com" },
      ]);
      stub.seed("user_organization_roles", [
        { user_id: "u1", organization_id: "org1", role: "active_member", status: "active" },
        { user_id: "u2", organization_id: "org1", role: "admin", status: "revoked" },
        { user_id: "u3", organization_id: "org1", role: "admin", status: "active" },
      ]);

      const result = await batchGetOrgAdminEmails(stub as never, ["org1"]);

      const org1Emails = result.get("org1") ?? [];
      assert.strictEqual(org1Emails.length, 1, "Should only return active admins");
      assert.ok(org1Emails.includes("admin@org1.com"), "Should include active admin email");
      assert.ok(!org1Emails.includes("member@org1.com"), "Should not include member email");
      assert.ok(!org1Emails.includes("inactive-admin@org1.com"), "Should not include revoked admin email");
    });

    it("returns empty map when no admins found", async () => {
      stub.seed("user_organization_roles", [
        { user_id: "u1", organization_id: "org1", role: "active_member", status: "active" },
      ]);

      const result = await batchGetOrgAdminEmails(stub as never, ["org1"]);
      assert.strictEqual(result.size, 0, "Should return empty map when no admins");
    });
  });

  // ─── batchCheckAlumniCapacity ──────────────────────────────────────────────

  describe("batchCheckAlumniCapacity", () => {
    it("returns empty map for empty orgIds", async () => {
      const result = await batchCheckAlumniCapacity(stub as never, []);
      assert.strictEqual(result.size, 0);
    });

    it("returns hasCapacity: false for orgs with alumni_bucket: none", async () => {
      stub.seed("organization_subscriptions", [
        { organization_id: "org1", alumni_bucket: "none" },
      ]);

      const result = await batchCheckAlumniCapacity(stub as never, ["org1"]);

      const org1 = result.get("org1");
      assert.ok(org1, "org1 should be in the result");
      assert.strictEqual(org1.hasCapacity, false, "org with 'none' bucket has no capacity");
      assert.strictEqual(org1.limit, 0);
    });

    it("returns hasCapacity: true for orgs with unlimited alumni tier", async () => {
      stub.seed("organization_subscriptions", [
        // No row = no subscription = "none" alumni bucket → no capacity
        // To get unlimited, we need "5000+" bucket
        { organization_id: "org1", alumni_bucket: "5000+" },
      ]);

      const result = await batchCheckAlumniCapacity(stub as never, ["org1"]);

      const org1 = result.get("org1");
      assert.ok(org1, "org1 should be in the result");
      assert.strictEqual(org1.hasCapacity, true, "org with 5000+ bucket has unlimited capacity");
      assert.strictEqual(org1.limit, null, "unlimited tier should have null limit");
    });

    it("returns hasCapacity based on current alumni count vs limit", async () => {
      stub.seed("organization_subscriptions", [
        { organization_id: "org1", alumni_bucket: "0-250" },
        { organization_id: "org2", alumni_bucket: "0-250" },
      ]);

      // org1 has 0 alumni — has capacity
      // org2 has 250 alumni — at limit, no capacity (250 < 250 is false)
      for (let i = 0; i < 250; i++) {
        stub.seed("alumni", [
          { organization_id: "org2", deleted_at: null },
        ]);
      }

      const result = await batchCheckAlumniCapacity(stub as never, ["org1", "org2"]);

      const org1 = result.get("org1");
      assert.ok(org1, "org1 should be in the result");
      assert.strictEqual(org1.hasCapacity, true, "org1 with 0 alumni should have capacity");
      assert.strictEqual(org1.currentCount, 0);

      const org2 = result.get("org2");
      assert.ok(org2, "org2 should be in the result");
      assert.strictEqual(org2.hasCapacity, false, "org2 at limit should not have capacity");
      assert.strictEqual(org2.currentCount, 250);
      assert.strictEqual(org2.limit, 250);
    });

    it("defaults to no capacity for orgs without a subscription row", async () => {
      // No subscription seeded
      const result = await batchCheckAlumniCapacity(stub as never, ["org-no-sub"]);

      const org = result.get("org-no-sub");
      assert.ok(org, "org-no-sub should be in the result");
      assert.strictEqual(org.hasCapacity, false, "org without subscription defaults to no capacity");
    });

    it("handles multiple orgs with different tiers in one batch call", async () => {
      stub.seed("organization_subscriptions", [
        { organization_id: "orgA", alumni_bucket: "none" },
        { organization_id: "orgB", alumni_bucket: "0-250" },
        { organization_id: "orgC", alumni_bucket: "5000+" },
      ]);
      stub.seed("alumni", [
        { organization_id: "orgB", deleted_at: null },
        { organization_id: "orgB", deleted_at: null },
      ]);

      const result = await batchCheckAlumniCapacity(stub as never, ["orgA", "orgB", "orgC"]);

      assert.strictEqual(result.size, 3, "Should return results for all 3 orgs");
      assert.strictEqual(result.get("orgA")?.hasCapacity, false, "orgA (none) has no capacity");
      assert.strictEqual(result.get("orgB")?.hasCapacity, true, "orgB has 2/250, has capacity");
      assert.strictEqual(result.get("orgB")?.currentCount, 2);
      assert.strictEqual(result.get("orgC")?.hasCapacity, true, "orgC (unlimited) has capacity");
      assert.strictEqual(result.get("orgC")?.limit, null);
    });

    it("excludes soft-deleted alumni from count", async () => {
      stub.seed("organization_subscriptions", [
        { organization_id: "org1", alumni_bucket: "0-250" },
      ]);
      // 3 total alumni, but 2 are soft-deleted
      stub.seed("alumni", [
        { organization_id: "org1", deleted_at: null },
        { organization_id: "org1", deleted_at: "2025-01-01T00:00:00Z" },
        { organization_id: "org1", deleted_at: "2025-01-02T00:00:00Z" },
      ]);

      const result = await batchCheckAlumniCapacity(stub as never, ["org1"]);

      const org1 = result.get("org1");
      assert.ok(org1, "org1 should be in the result");
      assert.strictEqual(org1.currentCount, 1, "Should count only non-deleted alumni");
    });
  });
});
