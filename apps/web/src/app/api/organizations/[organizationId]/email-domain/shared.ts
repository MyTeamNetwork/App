import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  parseOrgId,
  resolveAdminContext,
  denialResponse,
  readOnlyDenialResponse,
  unauthorizedResponse,
} from "@/lib/organizations";
import { getDomain } from "@/lib/notifications/email-domains";
import { invalidateSenderCache } from "@/lib/notifications/sender";

/**
 * Shared plumbing for the org email-domain admin routes
 * (/api/organizations/[organizationId]/email-domain and .../verify).
 */

export interface EmailDomainRow {
  id: string;
  organization_id: string;
  domain: string;
  resend_domain_id: string | null;
  status: string;
  dns_records: unknown;
  sender_local_part: string;
  sender_display_name: string | null;
  last_checked_at: string | null;
  verified_at: string | null;
}

// organization_email_domains is not in generated Database types until
// `bun run gen:types` runs against the migrated database.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const emailDomainsTable = (client: ReturnType<typeof createServiceClient>): any =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client.from as (table: string) => any)("organization_email_domains");

export function serializeEmailDomain(row: EmailDomainRow) {
  return {
    domain: row.domain,
    status: row.status,
    dnsRecords: row.dns_records ?? [],
    senderLocalPart: row.sender_local_part,
    senderDisplayName: row.sender_display_name,
    senderPreview: `${row.sender_local_part}@${row.domain}`,
    verifiedAt: row.verified_at,
    lastCheckedAt: row.last_checked_at,
  };
}

/**
 * Pull the latest status + DNS records from Resend and persist them.
 * Returns the refreshed row; on any Resend failure, returns the row as-is.
 */
export async function refreshFromResend(
  service: ReturnType<typeof createServiceClient>,
  row: EmailDomainRow
): Promise<EmailDomainRow> {
  if (!row.resend_domain_id) return row;
  try {
    const snapshot = await getDomain(row.resend_domain_id, row.domain);
    const becameVerified = snapshot.status === "verified" && row.status !== "verified";
    const lostVerification = snapshot.status !== "verified" && row.status === "verified";
    const updates: Record<string, unknown> = {
      status: snapshot.status,
      dns_records: snapshot.records,
      last_checked_at: new Date().toISOString(),
    };
    if (becameVerified) updates.verified_at = new Date().toISOString();
    if (lostVerification) updates.verified_at = null;

    const { data, error } = await emailDomainsTable(service)
      .update(updates)
      .eq("id", row.id)
      .select("*")
      .maybeSingle();

    if (becameVerified || lostVerification) {
      invalidateSenderCache(row.organization_id);
    }
    if (error || !data) return { ...row, ...updates } as EmailDomainRow;
    return data as EmailDomainRow;
  } catch (err) {
    console.warn("[email-domain] Resend status refresh failed:", err);
    return row;
  }
}

export interface EmailDomainGuardSuccess {
  respond: (payload: unknown, status?: number) => NextResponse;
  service: ReturnType<typeof createServiceClient>;
  userId: string;
}

/**
 * Common route guard: uuid param → auth → rate limit → org admin →
 * optional read-only block. Returns a NextResponse on failure.
 */
export async function guardEmailDomainAdmin(
  req: Request,
  organizationId: string,
  options: { feature: string; limitPerIp: number; limitPerUser: number; blockReadOnly?: boolean }
): Promise<EmailDomainGuardSuccess | NextResponse> {
  const parsed = parseOrgId(organizationId);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: options.feature,
    limitPerIp: options.limitPerIp,
    limitPerUser: options.limitPerUser,
  });
  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return withHeaders(unauthorizedResponse(), rateLimit.headers);
  }

  // Resolve admin context (composes membership + role + read-only). Only fetch
  // the read-only signal when this route actually gates on it, to avoid the
  // extra RPC round-trip on the read paths (GET / verify).
  const ctx = await resolveAdminContext(supabase, user.id, organizationId, {
    skipReadOnly: !options.blockReadOnly,
  });
  if (!ctx.ok) {
    return withHeaders(denialResponse(ctx.denial), rateLimit.headers);
  }
  if (options.blockReadOnly && ctx.ctx.isReadOnly) {
    return withHeaders(readOnlyDenialResponse(), rateLimit.headers);
  }

  return { respond, service: createServiceClient(), userId: user.id };
}

/** Attach rate-limit headers onto a resolver-produced NextResponse without
 * re-serializing its already-contract-correct body. */
function withHeaders(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}
