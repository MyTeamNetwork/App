import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { sendEmail } from "@/lib/notifications";
import { resolveOrgSender } from "@/lib/notifications/sender";
import { buildInviteLink } from "@/lib/invites/buildInviteLink";

/**
 * Service layer for the org invite routes (U12).
 *
 * Routes resolve auth/rate-limit/read-only themselves, then hand these functions
 * the authenticated client (needed so `auth.uid()` is bound inside the
 * `create_org_invite` SECURITY DEFINER RPC), a service-role client (slug lookup
 * + org metadata under RLS-restricted reads), and validated params. Mirrors
 * `settings.ts`: injected clients, typed params, discriminated results.
 *
 * The `create_org_invite` RPC is where the alumni/parent quota enforcement
 * lives; its raw error message is forwarded to the client verbatim (matching the
 * pre-extraction route so quota-reached UX is unchanged).
 */

type MemberInviteRole = "admin" | "active_member" | "alumni" | "parent";

/** The invite row shape the RPC returns (fields the routes actually read). */
export interface CreatedInvite {
  id: string;
  code: string;
  token?: string | null;
  [key: string]: unknown;
}

/** Params for a single-invite create, mirroring the route's validated body. */
export interface CreateInviteParams {
  organizationId: string;
  role: MemberInviteRole;
  uses?: number | null;
  expiresAt?: string | null;
  requireApproval?: boolean | null;
}

/**
 * Discriminated result. On success the caller returns `{ invite }` and
 * revalidates the returned `slug`. On failure the caller maps `{ status, error }`
 * onto its response — status codes copied verbatim (RPC failure → 400).
 */
export type CreateInviteResult =
  | { ok: true; invite: CreatedInvite; slug: string | null }
  | { ok: false; status: number; error: string };

/** Create a single org invite via the quota-aware RPC, then look up the slug. */
export async function createInvite(
  authClient: SupabaseClient<Database>,
  serviceClient: SupabaseClient<Database>,
  params: CreateInviteParams
): Promise<CreateInviteResult> {
  // Authenticated client so auth.uid() is available inside the RPC.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite, error: rpcError } = await (authClient as any).rpc("create_org_invite", {
    p_organization_id: params.organizationId,
    p_role: params.role,
    p_uses: params.uses ?? null,
    p_expires_at: params.expiresAt ?? null,
    p_require_approval: params.requireApproval ?? null,
  });

  if (rpcError || !invite) {
    console.error("[org/invites POST] RPC error:", rpcError);
    return { ok: false, status: 400, error: rpcError?.message || "Failed to create invite" };
  }

  const { data: orgSlugRow } = await serviceClient
    .from("organizations")
    .select("slug")
    .eq("id", params.organizationId)
    .maybeSingle();

  return {
    ok: true,
    invite: invite as CreatedInvite,
    slug: (orgSlugRow as { slug: string | null } | null)?.slug ?? null,
  };
}

interface BulkEmailResult {
  email: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
}

/** Params for a bulk invite create + email fan-out. */
export interface CreateBulkInviteParams {
  organizationId: string;
  /** Already-deduped, lowercased emails (the Zod schema transforms them). */
  emails: string[];
  role: MemberInviteRole;
  expiresAt?: string | null;
  requireApproval?: boolean | null;
  /** Request origin, for building the invite link. */
  origin: string;
}

/** The bulk response body, shaped exactly as the route returns it. */
export interface BulkInviteResponse {
  emailsDelivered: boolean;
  invite: { id: string; code: string; token?: string | null; link: string };
  summary: { success: number; failed: number; skipped: number; total: number };
  results: BulkEmailResult[];
  /** Slug for cache revalidation; not part of the HTTP body. */
  slug: string | null;
}

export type CreateBulkInviteResult =
  | { ok: true; body: BulkInviteResponse }
  | { ok: false; status: number; error: string };

const BULK_EMAIL_CONCURRENCY = 10;

/**
 * Create one reusable invite code (uses = number of recipients) then, when a
 * mail provider is configured, fan the invite link out to every recipient. All
 * status codes, body shapes, and the concurrency batching are copied verbatim
 * from the pre-extraction route:
 * - RPC failure → 500 (note: single-invite is 400; the bulk route was 500)
 * - no RESEND_API_KEY → emailsDelivered:false, everyone "skipped"
 * - otherwise fan out in batches of 10, summarizing sent/failed
 */
export async function createBulkInvite(
  authClient: SupabaseClient<Database>,
  serviceClient: SupabaseClient<Database>,
  params: CreateBulkInviteParams
): Promise<CreateBulkInviteResult> {
  const { organizationId, emails, role, expiresAt, requireApproval, origin } = params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite, error: rpcError } = await (authClient as any).rpc("create_org_invite", {
    p_organization_id: organizationId,
    p_role: role,
    p_uses: emails.length,
    p_expires_at: expiresAt ?? null,
    p_require_approval: requireApproval ?? null,
  });

  if (rpcError || !invite) {
    console.error("[org/invites/bulk POST] RPC error:", rpcError);
    return { ok: false, status: 500, error: rpcError?.message || "Failed to create invite" };
  }

  const inviteRow = invite as CreatedInvite;
  const inviteLink = buildInviteLink({
    kind: role === "parent" ? "parent" : "org",
    baseUrl: origin,
    orgId: organizationId,
    code: inviteRow.code,
    token: inviteRow.token ?? undefined,
  });

  const hasResend = !!process.env.RESEND_API_KEY;

  if (!hasResend) {
    const { data: orgSlugRow } = await serviceClient
      .from("organizations")
      .select("slug")
      .eq("id", organizationId)
      .maybeSingle();

    return {
      ok: true,
      body: {
        emailsDelivered: false,
        invite: {
          id: inviteRow.id,
          code: inviteRow.code,
          token: inviteRow.token,
          link: inviteLink,
        },
        summary: { success: 0, failed: 0, skipped: emails.length, total: emails.length },
        results: emails.map((email) => ({ email, status: "skipped" as const })),
        slug: (orgSlugRow as { slug: string | null } | null)?.slug ?? null,
      },
    };
  }

  const { data: orgRow } = await serviceClient
    .from("organizations")
    .select("slug, name")
    .eq("id", organizationId)
    .maybeSingle();

  const orgMeta = orgRow as { slug: string | null; name: string | null } | null;
  const orgName = orgMeta?.name || "your organization";
  const sender = await resolveOrgSender(serviceClient, organizationId);

  const emailTasks = emails.map((email) => async (): Promise<BulkEmailResult> => {
    try {
      const result = await sendEmail({
        to: email,
        subject: `You're invited to join ${orgName}`,
        body: `You've been invited to join ${orgName}.\n\nJoin using this link: ${inviteLink}\n\nOr use invite code: ${inviteRow.code}`,
        from: sender.from,
      });
      return result.success
        ? { email, status: "sent" }
        : { email, status: "failed", error: "Email delivery failed" };
    } catch (err) {
      return {
        email,
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  });

  const results: BulkEmailResult[] = [];
  for (let i = 0; i < emailTasks.length; i += BULK_EMAIL_CONCURRENCY) {
    const batch = emailTasks.slice(i, i + BULK_EMAIL_CONCURRENCY).map((task) => task());
    const batchResults = await Promise.allSettled(batch);
    for (const res of batchResults) {
      if (res.status === "fulfilled") {
        results.push(res.value);
      } else {
        results.push({ email: emails[results.length], status: "failed", error: "Unexpected error" });
      }
    }
  }

  const successCount = results.filter((r) => r.status === "sent").length;
  const failedCount = results.filter((r) => r.status === "failed").length;

  return {
    ok: true,
    body: {
      emailsDelivered: true,
      invite: {
        id: inviteRow.id,
        code: inviteRow.code,
        token: inviteRow.token,
        link: inviteLink,
      },
      summary: { success: successCount, failed: failedCount, skipped: 0, total: emails.length },
      results,
      slug: orgMeta?.slug ?? null,
    },
  };
}
