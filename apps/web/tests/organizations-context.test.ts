import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database.ts";
import {
  resolveOrgContext,
  resolveAdminContext,
  resolveMemberContext,
  type MembershipLookup,
  type OrgAccessLevel,
  type ResolveOrgContextDeps,
} from "../src/lib/organizations/context.ts";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

// The injected client is never touched by the stubbed deps below — the DI seam
// replaces the query surface entirely. A bare object satisfies the type.
const fakeClient = {} as SupabaseClient<Database>;

/**
 * Build a deps object whose membership lookup returns a fixed result and whose
 * read-only check records that it ran. `readOnly` defaults to false.
 */
function makeDeps(opts: {
  membership: MembershipLookup;
  readOnly?: boolean;
  readOnlyThrows?: boolean;
}): { deps: ResolveOrgContextDeps; readOnlyCalls: () => number } {
  let calls = 0;
  const deps: ResolveOrgContextDeps = {
    lookupMembership: async () => opts.membership,
    checkReadOnly: async () => {
      calls += 1;
      if (opts.readOnlyThrows) {
        throw new Error("subscription service unavailable");
      }
      return { isReadOnly: opts.readOnly ?? false };
    },
  };
  return { deps, readOnlyCalls: () => calls };
}

describe("resolveOrgContext — read-only uses the request client", () => {
  it("passes the resolver's request client through to checkReadOnly", async () => {
    // Regression for the bearer-auth false-ORG_READ_ONLY bug (#335): the
    // read-only check must run as the authenticated caller, so it receives the
    // same request-scoped client the resolver was called with — not a fresh
    // anonymous cookie client built inside the default helper.
    const requestClient = { marker: "request-scoped" } as unknown as SupabaseClient<Database>;
    let received: unknown = null;
    const deps: ResolveOrgContextDeps = {
      lookupMembership: async () => ({ ok: true, role: "admin" }),
      checkReadOnly: async (_orgId, client) => {
        received = client;
        return { isReadOnly: false };
      },
    };

    const result = await resolveOrgContext(requestClient, USER_ID, ORG_ID, "admin", {}, deps);

    assert.ok(result.ok);
    assert.strictEqual(received, requestClient);
  });
});

describe("resolveOrgContext — happy paths", () => {
  it("active admin resolves to a full context, isReadOnly false", async () => {
    const { deps, readOnlyCalls } = makeDeps({
      membership: { ok: true, role: "admin" },
      readOnly: false,
    });

    const result = await resolveOrgContext(fakeClient, USER_ID, ORG_ID, "admin", {}, deps);

    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.deepEqual(result.ctx, {
      orgId: ORG_ID,
      userId: USER_ID,
      role: "admin",
      status: "active",
      isReadOnly: false,
    });
    assert.equal(readOnlyCalls(), 1);
  });

  it("member variant accepts a non-admin active role (ok where admin variant denies)", async () => {
    // Same underlying membership (active alumni) resolved at the member level.
    const { deps } = makeDeps({ membership: { ok: true, role: "alumni" } });

    const result = await resolveMemberContext(fakeClient, USER_ID, ORG_ID, {}, deps);

    assert.ok(result.ok);
    assert.equal(result.ctx.role, "alumni");
    assert.equal(result.ctx.status, "active");
  });
});

describe("resolveOrgContext — typed denials", () => {
  it("non-member → not_member (surfaced as not_member denial)", async () => {
    const { deps } = makeDeps({ membership: { ok: false, reason: "not_member" } });
    const result = await resolveAdminContext(fakeClient, USER_ID, ORG_ID, {}, deps);
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.denial, "not_member");
  });

  it("inactive membership → inactive denial", async () => {
    const { deps } = makeDeps({ membership: { ok: false, reason: "inactive" } });
    const result = await resolveAdminContext(fakeClient, USER_ID, ORG_ID, {}, deps);
    assert.ok(!result.ok);
    assert.equal(result.denial, "inactive");
  });

  it("member-not-admin → not_admin from admin variant", async () => {
    const { deps } = makeDeps({ membership: { ok: false, reason: "not_admin" } });
    const result = await resolveAdminContext(fakeClient, USER_ID, ORG_ID, {}, deps);
    assert.ok(!result.ok);
    assert.equal(result.denial, "not_admin");
  });

  it("membership lookup error → error denial (does not throw)", async () => {
    const { deps, readOnlyCalls } = makeDeps({ membership: { ok: false, reason: "error" } });
    const result = await resolveAdminContext(fakeClient, USER_ID, ORG_ID, {}, deps);
    assert.ok(!result.ok);
    assert.equal(result.denial, "error");
    // Denied before read-only is ever consulted.
    assert.equal(readOnlyCalls(), 0);
  });
});

describe("resolveOrgContext — read-only resolution", () => {
  it("post-grace org → isReadOnly true", async () => {
    const { deps } = makeDeps({
      membership: { ok: true, role: "admin" },
      readOnly: true,
    });
    const result = await resolveAdminContext(fakeClient, USER_ID, ORG_ID, {}, deps);
    assert.ok(result.ok);
    assert.equal(result.ctx.isReadOnly, true);
  });

  it("checkReadOnly throwing → isReadOnly true (fail closed)", async () => {
    const { deps } = makeDeps({
      membership: { ok: true, role: "admin" },
      readOnlyThrows: true,
    });
    const result = await resolveAdminContext(fakeClient, USER_ID, ORG_ID, {}, deps);
    assert.ok(result.ok);
    assert.equal(result.ctx.isReadOnly, true);
  });

  it("skipReadOnly → RPC not called, isReadOnly false", async () => {
    const { deps, readOnlyCalls } = makeDeps({
      membership: { ok: true, role: "active_member" },
      readOnly: true, // would be true IF consulted — proves it is skipped
    });
    const result = await resolveMemberContext(
      fakeClient,
      USER_ID,
      ORG_ID,
      { skipReadOnly: true },
      deps
    );
    assert.ok(result.ok);
    assert.equal(result.ctx.isReadOnly, false);
    assert.equal(readOnlyCalls(), 0);
  });
});

// ── Default membership lookup (member variant) against a stubbed client ───────
// Exercises the real `defaultLookupMembership` member-variant query path by
// injecting a minimal Supabase query-builder stub as the client, while keeping
// the default lookup dep. `org not found` maps to a not_member/not_found denial.

/**
 * Minimal chainable stub matching the `.from().select().eq().eq().maybeSingle()`
 * shape used by the member-variant lookup. Returns the provided row/error.
 */
function stubClient(row: unknown, error: unknown = null): SupabaseClient<Database> {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: row, error }),
  };
  return { from: () => builder } as unknown as SupabaseClient<Database>;
}

describe("default member lookup — via injected client", () => {
  it("active member row → ok with normalized role", async () => {
    const client = stubClient({ role: "member", status: "active" });
    const result = await resolveMemberContext(client, USER_ID, ORG_ID, { skipReadOnly: true });
    assert.ok(result.ok);
    assert.equal(result.ctx.role, "active_member"); // "member" normalized
  });

  it("org not found (no row) → not_member denial", async () => {
    const client = stubClient(null);
    const result = await resolveMemberContext(client, USER_ID, ORG_ID, { skipReadOnly: true });
    assert.ok(!result.ok);
    assert.equal(result.denial, "not_member");
  });

  it("inactive row → inactive denial", async () => {
    const client = stubClient({ role: "admin", status: "pending" });
    const result = await resolveMemberContext(client, USER_ID, ORG_ID, { skipReadOnly: true });
    assert.ok(!result.ok);
    assert.equal(result.denial, "inactive");
  });

  it("query error → error denial", async () => {
    const client = stubClient(null, { message: "boom" });
    const result = await resolveMemberContext(client, USER_ID, ORG_ID, { skipReadOnly: true });
    assert.ok(!result.ok);
    assert.equal(result.denial, "error");
  });
});

// Ensure the generic `level` param routes to the right variant.
describe("resolveOrgContext — level routing", () => {
  it("admin level uses admin membership rule", async () => {
    const levels: OrgAccessLevel[] = ["admin", "member"];
    for (const level of levels) {
      const { deps } = makeDeps({ membership: { ok: true, role: "admin" } });
      const result = await resolveOrgContext(fakeClient, USER_ID, ORG_ID, level, {}, deps);
      assert.ok(result.ok);
    }
  });
});
