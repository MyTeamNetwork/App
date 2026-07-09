import test, { before } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import type {
  updateOrgSettings as UpdateOrgSettingsFn,
  getOrgIdBySlug as GetOrgIdBySlugFn,
  getOrgAuditMetadata as GetOrgAuditMetadataFn,
  deleteOrganization as DeleteOrganizationFn,
} from "../../../src/lib/organizations/settings.ts";
import {
  denialResponse,
  readOnlyGuard,
  readOnlyDenialResponse,
  unauthorizedResponse,
} from "../../../src/lib/organizations/errors.ts";
import type { OrgContext } from "../../../src/lib/organizations/context.ts";
import type { CaptureErrorParams } from "../../../src/lib/errors/server.ts";

/**
 * Real-logic tests for the org-settings service extracted in U11. These exercise
 * the production functions the migrated CRUD/settings routes delegate to — not a
 * simulateX() mirror — so they catch drift the route-level mirror tests cannot.
 *
 * `settings.ts` reaches the org-deletion cascade, which transitively loads the
 * Stripe singleton at module init; the repo convention is to seed dummy env then
 * dynamic-import so the graph evaluates with env present.
 */

const ORG_ID = "11111111-1111-1111-1111-111111111111";

let updateOrgSettings: typeof UpdateOrgSettingsFn;
let getOrgIdBySlug: typeof GetOrgIdBySlugFn;
let getOrgAuditMetadata: typeof GetOrgAuditMetadataFn;
let deleteOrganization: typeof DeleteOrganizationFn;
let internalError: (typeof import("../../../src/lib/api/response.ts"))["internalError"];
let setCaptureTransportForTesting: (typeof import("../../../src/lib/errors/sanitize.ts"))["setCaptureTransportForTesting"];

function seedStripeEnv() {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "sk_test_dummy";
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY =
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "pk_test_dummy";
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "anon_dummy";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "service_dummy";

  // settings.ts -> delete-organization.ts eagerly loads the Stripe singleton,
  // which validates the full price-ID env at module init. Mirror the dummy set
  // used by delete-organization-data.test.ts so the graph evaluates.
  const priceIds = {
    STRIPE_PRICE_BASE_MONTHLY: "price_base_monthly",
    STRIPE_PRICE_BASE_YEARLY: "price_base_yearly",
    STRIPE_PRICE_ALUMNI_0_250_MONTHLY: "price_alumni_0_250_monthly",
    STRIPE_PRICE_ALUMNI_0_250_YEARLY: "price_alumni_0_250_yearly",
    STRIPE_PRICE_ALUMNI_251_500_MONTHLY: "price_alumni_251_500_monthly",
    STRIPE_PRICE_ALUMNI_251_500_YEARLY: "price_alumni_251_500_yearly",
    STRIPE_PRICE_ALUMNI_501_1000_MONTHLY: "price_alumni_501_1000_monthly",
    STRIPE_PRICE_ALUMNI_501_1000_YEARLY: "price_alumni_501_1000_yearly",
    STRIPE_PRICE_ALUMNI_1001_2500_MONTHLY: "price_alumni_1001_2500_monthly",
    STRIPE_PRICE_ALUMNI_1001_2500_YEARLY: "price_alumni_1001_2500_yearly",
    STRIPE_PRICE_ALUMNI_2500_5000_MONTHLY: "price_alumni_2500_5000_monthly",
    STRIPE_PRICE_ALUMNI_2500_5000_YEARLY: "price_alumni_2500_5000_yearly",
  } as const;
  for (const [key, value] of Object.entries(priceIds)) {
    process.env[key] = process.env[key] ?? value;
  }
}

before(async () => {
  seedStripeEnv();
  const settings = await import("../../../src/lib/organizations/settings.ts");
  updateOrgSettings = settings.updateOrgSettings;
  getOrgIdBySlug = settings.getOrgIdBySlug;
  getOrgAuditMetadata = settings.getOrgAuditMetadata;
  deleteOrganization = settings.deleteOrganization;
  ({ internalError } = await import("../../../src/lib/api/response.ts"));
  ({ setCaptureTransportForTesting } = await import("../../../src/lib/errors/sanitize.ts"));
});

function stubWithOrg(overrides: Record<string, unknown> = {}) {
  const stub = createSupabaseStub();
  stub.seed("organizations", [
    {
      id: ORG_ID,
      name: "Old Name",
      slug: "old-slug",
      nav_config: null,
      feed_post_roles: ["admin"],
      job_post_roles: ["admin"],
      discussion_post_roles: ["admin"],
      media_upload_roles: ["admin"],
      linkedin_resync_enabled: false,
      require_invite_approval: false,
      hide_donor_names: false,
      timezone: "UTC",
      default_language: "en",
      ...overrides,
    },
  ]);
  return stub;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (stub: ReturnType<typeof createSupabaseStub>) => stub as any;

// ── updateOrgSettings ────────────────────────────────────────────────────────

test("updateOrgSettings echoes back only the fields the request touched", async () => {
  const stub = stubWithOrg();
  const result = await updateOrgSettings(asClient(stub), ORG_ID, { name: "New Name" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(Object.keys(result.view), ["name"]);
  assert.equal(result.view.name, "New Name");
  assert.equal(result.view.feed_post_roles, undefined);
});

test("updateOrgSettings returns the updated post-role arrays from the row", async () => {
  const stub = stubWithOrg();
  const result = await updateOrgSettings(asClient(stub), ORG_ID, {
    feed_post_roles: ["admin", "parent"],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.view.feed_post_roles, ["admin", "parent"]);
  const [row] = stub.getRows("organizations");
  assert.deepEqual(row.feed_post_roles, ["admin", "parent"]);
});

test("updateOrgSettings maps a DB error onto a db_error result", async () => {
  const stub = stubWithOrg();
  stub.simulateError("organizations", { message: "update failed" });
  const result = await updateOrgSettings(asClient(stub), ORG_ID, { name: "X" });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, "db_error");
  assert.equal(result.message, "update failed");
});

test("updateOrgSettings maps a missing org onto a not_found result", async () => {
  const stub = createSupabaseStub();
  const result = await updateOrgSettings(asClient(stub), ORG_ID, { name: "X" });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, "not_found");
});

// ── getOrgIdBySlug ───────────────────────────────────────────────────────────

test("getOrgIdBySlug returns the id for an existing slug", async () => {
  const stub = stubWithOrg({ slug: "team-x" });
  const result = await getOrgIdBySlug(asClient(stub), "team-x");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.id, ORG_ID);
});

test("getOrgIdBySlug returns not_found for an unknown slug", async () => {
  const stub = createSupabaseStub();
  const result = await getOrgIdBySlug(asClient(stub), "missing");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, "not_found");
});

test("getOrgIdBySlug maps a DB error onto db_error", async () => {
  const stub = stubWithOrg();
  stub.simulateError("organizations", { message: "boom" });
  const result = await getOrgIdBySlug(asClient(stub), "old-slug");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, "db_error");
  assert.equal(result.message, "boom");
});

// ── getOrgAuditMetadata ──────────────────────────────────────────────────────

test("getOrgAuditMetadata returns name and slug for the dev-admin audit log", async () => {
  const stub = stubWithOrg({ name: "Acme", slug: "acme" });
  const meta = await getOrgAuditMetadata(asClient(stub), ORG_ID);
  assert.deepEqual(meta, { name: "Acme", slug: "acme" });
});

// ── deleteOrganization ───────────────────────────────────────────────────────

function fakeStripe(overrides: Partial<{
  retrieve: (id: string) => Promise<{ status: string }>;
}> = {}) {
  const calls: string[] = [];
  const stripe = {
    subscriptions: {
      retrieve: async (id: string) => {
        calls.push(`retrieve:${id}`);
        return overrides.retrieve ? overrides.retrieve(id) : { status: "active" };
      },
      cancel: async (id: string) => {
        calls.push(`cancel:${id}`);
        return {};
      },
    },
  } as unknown as Stripe;
  return { stripe, calls };
}

/**
 * Minimal client recording the orchestration `deleteOrganization` drives:
 * - the subscription lookup (returns the seeded stripe_subscription_id),
 * - the cascade table deletes (delegated to deleteOrganizationData, which is
 *   exhaustively covered by delete-organization-data.test.ts — here we only
 *   assert the org row delete runs and can force a failure),
 * The full supabaseStub is avoided because the cascade touches tables outside
 * its fixed storage map; this fake tests exactly the logic this module owns.
 */
function fakeDeleteClient(opts: {
  stripeSubscriptionId?: string | null;
  orgDeleteError?: string;
} = {}) {
  const orgDeletes: string[] = [];
  const deleteShape = (table: string) => ({
    delete: () => ({
      eq: async (_col: string, orgId: string) => {
        if (table === "organizations") {
          orgDeletes.push(orgId);
          return { error: opts.orgDeleteError ? { message: opts.orgDeleteError } : null };
        }
        return { error: null };
      },
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from(table: string) {
      // organization_subscriptions is both read (the pre-delete lookup) and
      // deleted (inside the cascade), so it exposes select AND delete.
      if (table === "organization_subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  opts.stripeSubscriptionId !== undefined
                    ? { stripe_subscription_id: opts.stripeSubscriptionId }
                    : null,
                error: null,
              }),
            }),
          }),
          ...deleteShape(table),
        };
      }
      return deleteShape(table);
    },
  };
  return { client, orgDeletes };
}

test("deleteOrganization cancels an active Stripe subscription then deletes the org", async () => {
  const { client, orgDeletes } = fakeDeleteClient({ stripeSubscriptionId: "sub_123" });
  const { stripe, calls } = fakeStripe();

  await deleteOrganization(client, ORG_ID, stripe);

  assert.deepEqual(calls, ["retrieve:sub_123", "cancel:sub_123"]);
  assert.deepEqual(orgDeletes, [ORG_ID]);
});

test("deleteOrganization skips cancel when there is no stripe subscription", async () => {
  const { client, orgDeletes } = fakeDeleteClient({ stripeSubscriptionId: null });
  const { stripe, calls } = fakeStripe();

  await deleteOrganization(client, ORG_ID, stripe);

  assert.deepEqual(calls, []);
  assert.deepEqual(orgDeletes, [ORG_ID]);
});

test("deleteOrganization tolerates an already-missing remote subscription", async () => {
  const { client, orgDeletes } = fakeDeleteClient({ stripeSubscriptionId: "sub_gone" });
  const { stripe, calls } = fakeStripe({
    retrieve: async () => {
      throw new Error("No such subscription: sub_gone");
    },
  });

  await deleteOrganization(client, ORG_ID, stripe);

  assert.deepEqual(calls, ["retrieve:sub_gone"]);
  assert.deepEqual(orgDeletes, [ORG_ID]);
});

test("deleteOrganization rethrows a non-NotFound Stripe error before deleting", async () => {
  const { client, orgDeletes } = fakeDeleteClient({ stripeSubscriptionId: "sub_err" });
  const { stripe } = fakeStripe({
    retrieve: async () => {
      throw new Error("Stripe API is down");
    },
  });

  await assert.rejects(() => deleteOrganization(client, ORG_ID, stripe), /Stripe API is down/);
  assert.deepEqual(orgDeletes, []);
});

test("deleteOrganization throws when the org row delete fails", async () => {
  const { client } = fakeDeleteClient({
    stripeSubscriptionId: null,
    orgDeleteError: "org delete blocked",
  });
  const { stripe } = fakeStripe();

  await assert.rejects(() => deleteOrganization(client, ORG_ID, stripe), /org delete blocked/);
});

// ── error-path capture (proves R7 wiring the migrated routes rely on) ─────────

test("internalError with a caught error fires the capture transport (bounded)", async () => {
  const captured: CaptureErrorParams[] = [];
  setCaptureTransportForTesting(async (params) => {
    captured.push(params);
  });
  try {
    const err = new Error("simulated service failure with a long payload " + "x".repeat(2000));
    const res = internalError("An unexpected error occurred.", err, { orgId: ORG_ID });

    assert.equal(res.status, 500);
    await Promise.resolve();
    assert.equal(captured.length, 1);
    assert.equal(captured[0].meta?.orgId, ORG_ID);
    assert.ok((captured[0].message?.length ?? 0) <= 501);
  } finally {
    setCaptureTransportForTesting(null);
  }
});

// ── denial → HTTP mapping (the contract migrated CRUD/settings routes rely on) ─

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

test("denialResponse maps a non-member to 404 (anti-enumeration), not 403", async () => {
  const res = denialResponse("not_member");
  assert.equal(res.status, 404);
  assert.deepEqual(await bodyOf(res), { error: "Not found" });
});

test("denialResponse maps not_found to the same neutral 404", async () => {
  const res = denialResponse("not_found");
  assert.equal(res.status, 404);
  assert.deepEqual(await bodyOf(res), { error: "Not found" });
});

test("denialResponse keeps not_admin and inactive at 403 Forbidden", async () => {
  for (const denial of ["not_admin", "inactive"] as const) {
    const res = denialResponse(denial);
    assert.equal(res.status, 403);
    assert.deepEqual(await bodyOf(res), { error: "Forbidden" });
  }
});

test("denialResponse maps a lookup error to a fail-closed 500", async () => {
  const res = denialResponse("error");
  assert.equal(res.status, 500);
  assert.deepEqual(await bodyOf(res), { error: "Unable to verify permissions" });
});

test("readOnlyGuard returns a 403 ORG_READ_ONLY body only when frozen", async () => {
  const frozen: OrgContext = {
    orgId: ORG_ID,
    userId: "u",
    role: "admin",
    status: "active",
    isReadOnly: true,
  };
  const guarded = readOnlyGuard(frozen);
  assert.ok(guarded, "a frozen context is guarded");
  assert.equal(guarded!.status, 403);
  assert.deepEqual(await bodyOf(guarded!), {
    error: "Organization is in read-only mode. Please resubscribe to make changes.",
    code: "ORG_READ_ONLY",
  });

  const active: OrgContext = { ...frozen, isReadOnly: false };
  assert.equal(readOnlyGuard(active), null);
});

test("readOnlyDenialResponse and unauthorizedResponse keep their current bodies", async () => {
  const ro = readOnlyDenialResponse();
  assert.equal(ro.status, 403);
  assert.equal((await bodyOf(ro)).code, "ORG_READ_ONLY");

  const unauth = unauthorizedResponse();
  assert.equal(unauth.status, 401);
  assert.deepEqual(await bodyOf(unauth), { error: "Unauthorized" });
});
