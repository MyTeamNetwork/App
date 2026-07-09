import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { Database } from "@/types/database";
import { extractSubscriptionPeriodEndEpoch } from "@/lib/stripe/subscription-period";

/**
 * Service layer for the org subscription cancel/resume routes (U13).
 *
 * Routes resolve auth themselves (via `lib/organizations` context), then hand an
 * ALREADY-AUTHORIZED service-role client, the Stripe client, and the org id to
 * these functions. Mirrors `settings.ts`/`members.ts`: injected clients, typed
 * params, discriminated results, response shaping owned here.
 *
 * READ-ONLY NOTE: these routes intentionally do NOT apply the grace-period
 * read-only guard. A read-only freeze happens precisely when a subscription is
 * canceled/lapsed — the exact state from which an admin resumes or reconciles.
 * Gating these would trap an org in the freeze. So the routes resolve admin with
 * `{ skipReadOnly: true }`; this service assumes that decision was made upstream.
 *
 * Stripe is INJECTED so the branch that talks to Stripe is unit-testable without
 * network. The status-code mapping is copied verbatim from the pre-extraction
 * routes.
 */

type OrgSubUpdate =
  Database["public"]["Tables"]["organization_subscriptions"]["Update"];

/** The subscription columns the cancel path reads. */
interface CancelSubscriptionRow {
  stripe_subscription_id: string | null;
  status?: string | null;
  current_period_end?: string | null;
}

/** The subscription columns the resume path reads. */
interface ResumeSubscriptionRow {
  stripe_subscription_id: string | null;
  status?: string | null;
}

export type CancelSubscriptionResult =
  | { ok: true; status: "canceling"; currentPeriodEnd: string | null | undefined; message: string }
  | { ok: false; status: number; error: string };

/**
 * Schedule a subscription for cancellation at period end (never an immediate
 * cancel). When a Stripe subscription id is present, sets
 * `cancel_at_period_end: true` and syncs the period end back; then flips the
 * local row to `"canceling"`. Status codes copied verbatim:
 * - load failure → 500
 * - no subscription row → 404
 * - persist failure → 500
 * - Stripe throw → 400 with the raw message
 */
export async function cancelSubscription(
  serviceClient: SupabaseClient<Database>,
  stripe: Stripe,
  organizationId: string
): Promise<CancelSubscriptionResult> {
  const { data: subscription, error: loadError } = await serviceClient
    .from("organization_subscriptions")
    .select("stripe_subscription_id, status, current_period_end")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (loadError) {
    console.error("[cancel-subscription] Failed to load subscription", {
      organizationId,
      code: loadError.code,
      message: loadError.message,
    });
    return { ok: false, status: 500, error: "Unable to load subscription details" };
  }

  const sub = subscription as CancelSubscriptionRow | null;
  if (!sub) {
    return { ok: false, status: 404, error: "Subscription not found" };
  }

  try {
    let currentPeriodEnd = sub.current_period_end;

    if (sub.stripe_subscription_id) {
      const updatedSub = await stripe.subscriptions.update(sub.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
      const periodEnd = extractSubscriptionPeriodEndEpoch(updatedSub);
      if (periodEnd) {
        currentPeriodEnd = new Date(periodEnd * 1000).toISOString();
      }
    }

    const payload: OrgSubUpdate = {
      status: "canceling",
      current_period_end: currentPeriodEnd,
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await serviceClient
      .from("organization_subscriptions")
      .update(payload)
      .eq("organization_id", organizationId);

    if (updateError) {
      console.error("[cancel-subscription] Failed to update subscription", {
        organizationId,
        code: updateError.code,
        message: updateError.message,
      });
      return { ok: false, status: 500, error: "Unable to persist cancellation state" };
    }

    return {
      ok: true,
      status: "canceling",
      currentPeriodEnd,
      message: "Subscription will be cancelled at the end of the billing period",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to cancel subscription";
    return { ok: false, status: 400, error: message };
  }
}

export type ResumeSubscriptionResult =
  | { ok: true; status: "active"; message: string }
  | { ok: false; status: number; error: string };

/**
 * Resume a subscription that was scheduled for cancellation, by setting
 * `cancel_at_period_end: false` in Stripe and flipping the local row back to
 * active. Preconditions and status codes copied verbatim:
 * - load failure → 500
 * - no subscription row → 404
 * - status not `"canceling"` → 400
 * - no Stripe subscription id → 400
 * - persist failure → 500
 * - Stripe throw → 400 with the raw message
 */
export async function resumeSubscription(
  serviceClient: SupabaseClient<Database>,
  stripe: Stripe,
  organizationId: string
): Promise<ResumeSubscriptionResult> {
  const { data: subscription, error: loadError } = await serviceClient
    .from("organization_subscriptions")
    .select("stripe_subscription_id, status")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (loadError) {
    console.error("[resume-subscription] Failed to load subscription", {
      organizationId,
      code: loadError.code,
      message: loadError.message,
    });
    return { ok: false, status: 500, error: "Unable to load subscription details" };
  }

  const sub = subscription as ResumeSubscriptionRow | null;
  if (!sub) {
    return { ok: false, status: 404, error: "Subscription not found" };
  }

  if (sub.status !== "canceling") {
    return { ok: false, status: 400, error: "Subscription is not scheduled for cancellation" };
  }

  if (!sub.stripe_subscription_id) {
    return { ok: false, status: 400, error: "No Stripe subscription to resume" };
  }

  try {
    const updatedSub = await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: false,
    });

    const payload: OrgSubUpdate = {
      status: updatedSub.status || "active",
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await serviceClient
      .from("organization_subscriptions")
      .update(payload)
      .eq("organization_id", organizationId);

    if (updateError) {
      console.error("[resume-subscription] Failed to update subscription", {
        organizationId,
        code: updateError.code,
        message: updateError.message,
      });
      return { ok: false, status: 500, error: "Unable to persist subscription state" };
    }

    return {
      ok: true,
      status: "active",
      message: "Subscription resumed successfully",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resume subscription";
    return { ok: false, status: 400, error: message };
  }
}
