import { describe, it } from "node:test";
import assert from "node:assert";
import type Stripe from "stripe";
import { cancelSubscription, resumeSubscription } from "@/lib/organizations/subscriptions";
import { createSupabaseStub } from "../../utils/supabaseStub";

/**
 * Characterization tests for the org subscription cancel/resume service layer
 * (U13, billing — money-critical, tests-first).
 *
 * They drive the REAL extracted service functions through the shared Supabase
 * stub and a minimal injected Stripe double, exercising the same
 * `organization_subscriptions` reads/writes and `stripe.subscriptions.update`
 * calls the production routes use. Each test locks a status-code / body / Stripe
 * side-effect the pre-extraction routes emitted.
 *
 * Scope note: UUID param validation, the 401, and the resolver's admin denial
 * (404 non-member / 403 non-admin) live in the ROUTE layer. These routes
 * intentionally SKIP the read-only gate (resume/reconcile must work during a
 * grace-period freeze); that decision is asserted at the route level, not here.
 */

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const STRIPE_SUB_ID = "sub_test123";

type ServiceClient = Parameters<typeof cancelSubscription>[0];

/** A minimal Stripe double that records `subscriptions.update` calls and returns
 * a canned updated subscription (or throws when `updateThrows` is set). */
function stripeStub(opts: {
  updateThrows?: Error;
  updatedStatus?: string;
  periodEndEpoch?: number;
} = {}) {
  const calls: Array<{ id: string; params: Stripe.SubscriptionUpdateParams }> = [];
  const stripe = {
    subscriptions: {
      update: async (id: string, params: Stripe.SubscriptionUpdateParams) => {
        calls.push({ id, params });
        if (opts.updateThrows) throw opts.updateThrows;
        return {
          id,
          status: opts.updatedStatus ?? "active",
          items: {
            data: [
              {
                current_period_end:
                  opts.periodEndEpoch ?? Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000),
              },
            ],
          },
        } as unknown as Stripe.Response<Stripe.Subscription>;
      },
    },
  } as unknown as Stripe;
  return { stripe, calls };
}

function seed(row: Record<string, unknown> | null) {
  const stub = createSupabaseStub();
  if (row) {
    stub.seed("organization_subscriptions", [{ organization_id: ORG_ID, ...row }]);
  }
  return stub;
}

describe("cancelSubscription service", () => {
  it("schedules cancel-at-period-end in Stripe and flips the row to canceling", async () => {
    const stub = seed({
      stripe_subscription_id: STRIPE_SUB_ID,
      status: "active",
      current_period_end: "2026-01-01T00:00:00.000Z",
    });
    const { stripe, calls } = stripeStub({
      periodEndEpoch: Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000),
    });

    const result = await cancelSubscription(stub as unknown as ServiceClient, stripe, ORG_ID);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.status, "canceling");
    // Period end was synced forward from Stripe, not left at the stale local value.
    assert.strictEqual(result.currentPeriodEnd, "2026-09-01T00:00:00.000Z");

    // Never an immediate cancel — always schedule at period end.
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].id, STRIPE_SUB_ID);
    assert.strictEqual(calls[0].params.cancel_at_period_end, true);

    const persisted = stub.getRows("organization_subscriptions")[0];
    assert.strictEqual(persisted.status, "canceling");
    assert.strictEqual(persisted.current_period_end, "2026-09-01T00:00:00.000Z");
  });

  it("still marks canceling when there is no Stripe subscription id (never calls Stripe)", async () => {
    const stub = seed({
      stripe_subscription_id: null,
      status: "active",
      current_period_end: "2026-01-01T00:00:00.000Z",
    });
    const { stripe, calls } = stripeStub();

    const result = await cancelSubscription(stub as unknown as ServiceClient, stripe, ORG_ID);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.status, "canceling");
    // No Stripe id → local period end preserved as-is.
    assert.strictEqual(result.currentPeriodEnd, "2026-01-01T00:00:00.000Z");
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(stub.getRows("organization_subscriptions")[0].status, "canceling");
  });

  it("returns 404 when no subscription row exists", async () => {
    const stub = seed(null);
    const { stripe } = stripeStub();

    const result = await cancelSubscription(stub as unknown as ServiceClient, stripe, ORG_ID);

    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.strictEqual(result.status, 404);
    assert.strictEqual(result.error, "Subscription not found");
  });

  it("maps a Stripe failure to a 400 with the raw message and does NOT persist", async () => {
    const stub = seed({
      stripe_subscription_id: STRIPE_SUB_ID,
      status: "active",
      current_period_end: "2026-01-01T00:00:00.000Z",
    });
    const { stripe } = stripeStub({ updateThrows: new Error("card_declined") });

    const result = await cancelSubscription(stub as unknown as ServiceClient, stripe, ORG_ID);

    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "card_declined");
    // The row must not have been flipped to canceling if Stripe rejected.
    assert.strictEqual(stub.getRows("organization_subscriptions")[0].status, "active");
  });
});

describe("resumeSubscription service", () => {
  it("clears cancel-at-period-end in Stripe and flips the row back to active", async () => {
    const stub = seed({ stripe_subscription_id: STRIPE_SUB_ID, status: "canceling" });
    const { stripe, calls } = stripeStub({ updatedStatus: "active" });

    const result = await resumeSubscription(stub as unknown as ServiceClient, stripe, ORG_ID);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.status, "active");

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].params.cancel_at_period_end, false);
    assert.strictEqual(stub.getRows("organization_subscriptions")[0].status, "active");
  });

  it("returns 404 when no subscription row exists", async () => {
    const stub = seed(null);
    const { stripe } = stripeStub();

    const result = await resumeSubscription(stub as unknown as ServiceClient, stripe, ORG_ID);

    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.strictEqual(result.status, 404);
  });

  it("rejects with 400 when the subscription is not in the canceling state", async () => {
    const stub = seed({ stripe_subscription_id: STRIPE_SUB_ID, status: "active" });
    const { stripe, calls } = stripeStub();

    const result = await resumeSubscription(stub as unknown as ServiceClient, stripe, ORG_ID);

    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Subscription is not scheduled for cancellation");
    // Guard fires before any Stripe call.
    assert.strictEqual(calls.length, 0);
  });

  it("rejects with 400 when canceling but missing a Stripe subscription id", async () => {
    const stub = seed({ stripe_subscription_id: null, status: "canceling" });
    const { stripe, calls } = stripeStub();

    const result = await resumeSubscription(stub as unknown as ServiceClient, stripe, ORG_ID);

    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "No Stripe subscription to resume");
    assert.strictEqual(calls.length, 0);
  });

  it("persists the real Stripe status when it is not literally 'active'", async () => {
    const stub = seed({ stripe_subscription_id: STRIPE_SUB_ID, status: "canceling" });
    const { stripe } = stripeStub({ updatedStatus: "trialing" });

    const result = await resumeSubscription(stub as unknown as ServiceClient, stripe, ORG_ID);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // Response body is a fixed "active" (route contract), but the persisted row
    // reflects the true Stripe status.
    assert.strictEqual(result.status, "active");
    assert.strictEqual(stub.getRows("organization_subscriptions")[0].status, "trialing");
  });

  it("maps a Stripe failure to a 400 with the raw message", async () => {
    const stub = seed({ stripe_subscription_id: STRIPE_SUB_ID, status: "canceling" });
    const { stripe } = stripeStub({ updateThrows: new Error("stripe_down") });

    const result = await resumeSubscription(stub as unknown as ServiceClient, stripe, ORG_ID);

    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "stripe_down");
  });
});
