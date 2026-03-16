import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import {
  batchGetOrganizations,
} from "../src/lib/graduation/queries.ts";

// ---------------------------------------------------------------------------
// Task 5: batchGetOrganizations
// ---------------------------------------------------------------------------

describe("batchGetOrganizations", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("returns Map<string, OrgWithSlug> for all requested IDs", async () => {
    stub.seed("organizations", [
      { id: "org1", name: "Org One", slug: "org-one" },
      { id: "org2", name: "Org Two", slug: "org-two" },
    ]);

    const result = await batchGetOrganizations(stub as never, ["org1", "org2"]);

    assert.ok(result instanceof Map, "Should return a Map");
    assert.strictEqual(result.size, 2, "Should have 2 entries");

    const org1 = result.get("org1");
    assert.ok(org1, "org1 should be in the map");
    assert.strictEqual(org1.id, "org1");
    assert.strictEqual(org1.name, "Org One");
    assert.strictEqual(org1.slug, "org-one");

    const org2 = result.get("org2");
    assert.ok(org2, "org2 should be in the map");
    assert.strictEqual(org2.slug, "org-two");
  });

  it("missing org IDs are absent from the map", async () => {
    stub.seed("organizations", [
      { id: "org1", name: "Org One", slug: "org-one" },
    ]);

    const result = await batchGetOrganizations(stub as never, ["org1", "org-missing"]);

    assert.strictEqual(result.size, 1, "Only found org should be in map");
    assert.ok(result.has("org1"), "org1 should be present");
    assert.ok(!result.has("org-missing"), "org-missing should be absent");
  });

  it("empty orgIds returns empty map without DB call", async () => {
    stub.seed("organizations", [
      { id: "org1", name: "Org One", slug: "org-one" },
    ]);

    const result = await batchGetOrganizations(stub as never, []);

    assert.ok(result instanceof Map, "Should return a Map");
    assert.strictEqual(result.size, 0, "Empty input → empty map");
  });

  it("throws on Supabase query error", async () => {
    stub.simulateError("organizations", { message: "connection timeout" });

    await assert.rejects(
      () => batchGetOrganizations(stub as never, ["org1"]),
      (err: Error) => {
        assert.ok(err.message.includes("batch-fetch organizations"), "Error should mention batch-fetch organizations");
        return true;
      }
    );
  });
});
