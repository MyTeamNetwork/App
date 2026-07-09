import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { Database } from "@/types/database";
import type { NavConfig } from "@/lib/navigation/nav-items";
import { deleteOrganizationData } from "@/lib/subscription/delete-organization";

/**
 * Service layer for the org CRUD + settings routes (U11).
 *
 * Routes resolve auth/rate-limit/read-only themselves (via `lib/organizations`
 * context + `lib/api/response`), then hand an ALREADY-AUTHORIZED, service-role
 * client and validated params to these functions. Following the `lib/mentorship`
 * shape: injected client, typed params, errors thrown with context, response
 * shaping owned here so the route stays thin.
 *
 * Every write uses the service-role client the route passes in — authorization
 * was already enforced upstream by the resolver, so these functions never
 * re-check membership.
 */

/** Columns the org-settings PATCH may write. Optional = "leave unchanged". */
export interface OrgSettingsUpdate {
  nav_config?: NavConfig;
  name?: string;
  feed_post_roles?: string[];
  job_post_roles?: string[];
  discussion_post_roles?: string[];
  media_upload_roles?: string[];
  linkedin_resync_enabled?: boolean;
  require_invite_approval?: boolean;
  hide_donor_names?: boolean;
  timezone?: string;
  default_language?: string;
}

/** The subset of org columns the PATCH response echoes back to the client. */
export interface OrgSettingsView {
  navConfig?: NavConfig;
  name?: string;
  feed_post_roles?: string[];
  job_post_roles?: string[];
  discussion_post_roles?: string[];
  media_upload_roles?: string[];
  linkedin_resync_enabled?: boolean;
  require_invite_approval?: boolean;
  hide_donor_names?: boolean;
  timezone?: string;
  default_language?: string;
}

const SETTINGS_SELECT =
  "id, name, nav_config, feed_post_roles, job_post_roles, discussion_post_roles, media_upload_roles, linkedin_resync_enabled, require_invite_approval, hide_donor_names, timezone, default_language";

interface UpdatedOrgRow {
  id: string;
  name: string;
  nav_config: NavConfig | null;
  feed_post_roles: string[];
  job_post_roles: string[];
  discussion_post_roles: string[];
  media_upload_roles: string[];
  linkedin_resync_enabled?: boolean;
  require_invite_approval?: boolean;
  hide_donor_names?: boolean;
  timezone?: string;
  default_language?: string;
}

/**
 * Discriminated result so the route can map each outcome onto the exact
 * status/body the current handler emits (400 on a DB error, 404 when the org
 * row is gone) without the service layer importing NextResponse.
 */
export type UpdateOrgSettingsResult =
  | { ok: true; view: OrgSettingsView }
  | { ok: false; kind: "db_error"; message: string }
  | { ok: false; kind: "not_found" };

/**
 * Apply an org-settings PATCH. `update` carries only the fields the request
 * provided; the returned `view` echoes only those same fields (mirroring the
 * route's field-by-field response shaping so the client contract is identical).
 *
 * The caller must pass a service-role client — the RLS-restricted columns
 * (post-role arrays, nav_config) are admin-only and the route already
 * authorized the caller as an active admin.
 */
export async function updateOrgSettings(
  serviceClient: SupabaseClient<Database>,
  orgId: string,
  update: OrgSettingsUpdate
): Promise<UpdateOrgSettingsResult> {
  const { data, error } = await serviceClient
    .from("organizations")
    .update(update as never)
    .eq("id", orgId)
    .select(SETTINGS_SELECT)
    .maybeSingle();

  if (error) {
    // PGRST116 ("no rows") from a zero-match update is not a failure — the org
    // simply does not exist. Everything else is a real DB error.
    if (error.code === "PGRST116") {
      return { ok: false, kind: "not_found" };
    }
    return { ok: false, kind: "db_error", message: error.message };
  }

  const row = data as UpdatedOrgRow | null;
  if (!row) {
    return { ok: false, kind: "not_found" };
  }

  return { ok: true, view: buildSettingsView(update, row) };
}

/**
 * Echo back only the fields the PATCH actually touched, sourced from the
 * updated row (except nav_config, which the route returns from its sanitized
 * input — preserved here to keep the response byte-compatible).
 */
function buildSettingsView(update: OrgSettingsUpdate, row: UpdatedOrgRow): OrgSettingsView {
  const view: OrgSettingsView = {};
  if (update.nav_config !== undefined) view.navConfig = update.nav_config;
  if (update.name !== undefined) view.name = row.name;
  if (update.feed_post_roles !== undefined) view.feed_post_roles = row.feed_post_roles;
  if (update.job_post_roles !== undefined) view.job_post_roles = row.job_post_roles;
  if (update.discussion_post_roles !== undefined)
    view.discussion_post_roles = row.discussion_post_roles;
  if (update.media_upload_roles !== undefined)
    view.media_upload_roles = row.media_upload_roles;
  if (update.linkedin_resync_enabled !== undefined)
    view.linkedin_resync_enabled = row.linkedin_resync_enabled as boolean;
  if (update.require_invite_approval !== undefined)
    view.require_invite_approval = row.require_invite_approval as boolean;
  if (update.hide_donor_names !== undefined)
    view.hide_donor_names = row.hide_donor_names as boolean;
  if (update.timezone !== undefined) view.timezone = row.timezone as string;
  if (update.default_language !== undefined)
    view.default_language = row.default_language as string;
  return view;
}

/** Minimal org metadata used for dev-admin audit logging before a delete. */
export interface OrgAuditMetadata {
  name: string | null;
  slug: string | null;
}

/** Fetch the org name + slug for the dev-admin delete audit log. */
export async function getOrgAuditMetadata(
  serviceClient: SupabaseClient<Database>,
  orgId: string
): Promise<OrgAuditMetadata> {
  const { data } = await serviceClient
    .from("organizations")
    .select("name, slug")
    .eq("id", orgId)
    .maybeSingle();
  const row = data as { name: string | null; slug: string | null } | null;
  return { name: row?.name ?? null, slug: row?.slug ?? null };
}

/**
 * Cancel the org's Stripe subscription (if any), delete all related data, then
 * delete the org row. Throws with context on any hard failure; the route maps a
 * thrown error onto its 400 response (matching current behavior).
 *
 * A Stripe subscription that no longer exists remotely is treated as
 * already-canceled — deletion proceeds. The `stripe` dependency is injected so
 * this stays unit-testable and free of module-load side effects.
 */
export async function deleteOrganization(
  serviceClient: SupabaseClient<Database>,
  orgId: string,
  stripe: Stripe
): Promise<void> {
  const { data: subscription } = await serviceClient
    .from("organization_subscriptions")
    .select("stripe_subscription_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  const stripeSubscriptionId = (subscription as { stripe_subscription_id: string | null } | null)
    ?.stripe_subscription_id;

  if (stripeSubscriptionId) {
    await cancelStripeSubscription(stripe, stripeSubscriptionId);
  }

  await deleteOrganizationData(serviceClient, orgId);

  const { error: orgDeleteError } = await serviceClient
    .from("organizations")
    .delete()
    .eq("id", orgId);
  if (orgDeleteError) {
    throw new Error(orgDeleteError.message);
  }
}

/** Cancel a Stripe subscription, tolerating an already-missing remote sub. */
async function cancelStripeSubscription(stripe: Stripe, subscriptionId: string): Promise<void> {
  try {
    const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
    if (stripeSub.status !== "canceled") {
      await stripe.subscriptions.cancel(subscriptionId);
    }
  } catch (stripeError) {
    const isNotFound =
      stripeError instanceof Error &&
      (stripeError.message.includes("No such subscription") ||
        stripeError.message.includes("resource_missing"));
    if (!isNotFound) {
      throw stripeError;
    }
    // Remote subscription is gone — safe to continue with the org deletion.
  }
}

/**
 * Look up an org id by slug for the post-checkout polling path. Returns a
 * discriminated result so the route maps a DB error onto a 500 (with capture)
 * and a missing org onto a 404, exactly as today. Uses the caller's SSR client
 * (RLS applies — this is a member-agnostic lookup returning only the id).
 */
export type OrgBySlugResult =
  | { ok: true; id: string }
  | { ok: false; kind: "db_error"; message: string }
  | { ok: false; kind: "not_found" };

export async function getOrgIdBySlug(
  client: SupabaseClient<Database>,
  slug: string
): Promise<OrgBySlugResult> {
  const { data, error } = await client
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    return { ok: false, kind: "db_error", message: error.message };
  }
  if (!data) {
    return { ok: false, kind: "not_found" };
  }
  return { ok: true, id: (data as { id: string }).id };
}
