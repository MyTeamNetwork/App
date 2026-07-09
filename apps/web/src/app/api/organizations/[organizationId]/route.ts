import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { ORG_NAV_ITEMS } from "@/lib/navigation/nav-items";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  optionalSafeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import {
  parseOrgId,
  resolveAdminContext,
  denialResponse,
  readOnlyGuard,
  unauthorizedResponse,
  updateOrgSettings,
  getOrgAuditMetadata,
  deleteOrganization,
  type OrgSettingsUpdate,
} from "@/lib/organizations";
import { internalError } from "@/lib/api/response";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { OrgRole } from "@teammeet/core";
import {
  canDevAdminPerform,
  logDevAdminAction,
  extractRequestContext,
} from "@/lib/auth/dev-admin";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

const ALLOWED_ROLES = ["admin", "active_member", "alumni", "parent"] as const;
const navEntrySchema = z
  .object({
    label: optionalSafeString(80),
    hidden: z.boolean().optional(),
    hiddenForRoles: z.array(z.enum(ALLOWED_ROLES)).optional(),
    editRoles: z.array(z.enum(ALLOWED_ROLES)).optional(),
    order: z.number().int().min(0).max(100).optional(),
  })
  .strict();

const patchSchema = z
  .object({
    navConfig: z.record(z.string(), navEntrySchema).optional(),
    nav_config: z.record(z.string(), navEntrySchema).optional(),
    name: z.string().max(100).optional(),
    feed_post_roles: z.array(z.enum(ALLOWED_ROLES)).min(1).optional(),
    job_post_roles: z.array(z.enum(ALLOWED_ROLES)).min(1).optional(),
    discussion_post_roles: z.array(z.enum(ALLOWED_ROLES)).min(1).optional(),
    media_upload_roles: z.array(z.enum(ALLOWED_ROLES)).min(1).optional(),
    linkedin_resync_enabled: z.boolean().optional(),
    require_invite_approval: z.boolean().optional(),
    hide_donor_names: z.boolean().optional(),
    timezone: z.string().max(100).refine(
      (tz) => { try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; } },
      { message: "Invalid IANA timezone" },
    ).optional(),
    default_language: z.enum(["en", "es", "fr", "ar", "zh", "pt", "it"]).optional(),
  })
  .strict();
const ALLOWED_NAV_PATHS = new Set([...ORG_NAV_ITEMS.map((item) => item.href), "dashboard"]);

function sanitizeNavConfig(payload: unknown): NavConfig {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const config: NavConfig = {};
  for (const [href, value] of Object.entries(payload as Record<string, unknown>)) {
    // Accept "dashboard" as a valid key (Dashboard item has empty href in ORG_NAV_ITEMS)
    if (!ALLOWED_NAV_PATHS.has(href) || typeof value !== "object" || value === null || Array.isArray(value)) continue;

    const entry = value as { label?: unknown; hidden?: unknown; hiddenForRoles?: unknown; editRoles?: unknown; order?: unknown };
    const clean: { label?: string; hidden?: boolean; hiddenForRoles?: OrgRole[]; editRoles?: OrgRole[]; order?: number } = {};

    if (typeof entry.label === "string" && entry.label.trim()) {
      clean.label = entry.label.trim();
    }
    if (entry.hidden === true) {
      clean.hidden = true;
    }
    if (Array.isArray(entry.hiddenForRoles)) {
      const roles = entry.hiddenForRoles.filter((role): role is OrgRole => ALLOWED_ROLES.includes(role as OrgRole));
      if (roles.length) {
        clean.hiddenForRoles = Array.from(new Set(roles));
      }
    }
    if (Array.isArray(entry.editRoles)) {
      const roles = entry.editRoles.filter((role): role is OrgRole => ALLOWED_ROLES.includes(role as OrgRole));
      if (roles.length) {
        clean.editRoles = Array.from(new Set([...roles, "admin"] as OrgRole[]));
      }
    }
    if (typeof entry.order === "number" && Number.isInteger(entry.order) && entry.order >= 0) {
      clean.order = entry.order;
    }

    if (Object.keys(clean).length > 0) {
      config[href] = clean;
    }
  }

  return config;
}

/** Assemble the settings-update payload from a validated PATCH body. Only
 * fields the request provided are included; post-role arrays always force
 * "admin" so an admin can never lock themselves out of a surface. */
function buildUpdatePayload(
  parsedBody: z.infer<typeof patchSchema>,
  navConfig: NavConfig,
  sanitizedName: string | undefined
): OrgSettingsUpdate {
  const update: OrgSettingsUpdate = {};

  if (parsedBody.navConfig !== undefined || parsedBody.nav_config !== undefined) {
    update.nav_config = navConfig;
  }
  if (sanitizedName !== undefined) {
    update.name = sanitizedName;
  }
  if (parsedBody.feed_post_roles !== undefined) {
    update.feed_post_roles = Array.from(new Set(["admin", ...parsedBody.feed_post_roles]));
  }
  if (parsedBody.job_post_roles !== undefined) {
    update.job_post_roles = Array.from(new Set(["admin", ...parsedBody.job_post_roles]));
  }
  if (parsedBody.discussion_post_roles !== undefined) {
    update.discussion_post_roles = Array.from(new Set(["admin", ...parsedBody.discussion_post_roles]));
  }
  if (parsedBody.media_upload_roles !== undefined) {
    update.media_upload_roles = Array.from(new Set(["admin", ...parsedBody.media_upload_roles]));
  }
  if (parsedBody.linkedin_resync_enabled !== undefined) {
    update.linkedin_resync_enabled = parsedBody.linkedin_resync_enabled;
  }
  if (parsedBody.require_invite_approval !== undefined) {
    update.require_invite_approval = parsedBody.require_invite_approval;
  }
  if (parsedBody.hide_donor_names !== undefined) {
    update.hide_donor_names = parsedBody.hide_donor_names;
  }
  if (parsedBody.timezone !== undefined) {
    update.timezone = parsedBody.timezone;
  }
  if (parsedBody.default_language !== undefined) {
    update.default_language = parsedBody.default_language;
  }

  return update;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const { organizationId } = await params;
    const parsed = parseOrgId(organizationId);
    if (!parsed.ok) {
      return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
    }

    const parsedBody = await validateJson(req, patchSchema);
    const navConfigInput = parsedBody.navConfig ?? parsedBody.nav_config ?? {};
    const navConfig = sanitizeNavConfig(navConfigInput);
    const nameInput = parsedBody.name;

    let sanitizedName: string | undefined;
    if (nameInput !== undefined) {
      const trimmedName = nameInput.trim();
      if (!trimmedName) {
        return NextResponse.json({ error: "Organization name cannot be empty" }, { status: 400 });
      }
      if (trimmedName.length > 100) {
        return NextResponse.json({ error: "Organization name must be under 100 characters" }, { status: 400 });
      }
      sanitizedName = trimmedName;
    }

    const { supabase, user } = await createAuthenticatedApiClient(req);

    const rateLimit = await checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "organization settings",
      limitPerIp: 40,
      limitPerUser: 25,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (!user) {
      return withHeaders(unauthorizedResponse(), rateLimit.headers);
    }

    const ctx = await resolveAdminContext(supabase, user.id, parsed.orgId);
    if (!ctx.ok) {
      return withHeaders(denialResponse(ctx.denial), rateLimit.headers);
    }
    const readOnly = readOnlyGuard(ctx.ctx);
    if (readOnly) {
      return withHeaders(readOnly, rateLimit.headers);
    }

    const updatePayload = buildUpdatePayload(parsedBody, navConfig, sanitizedName);
    if (Object.keys(updatePayload).length === 0) {
      return respond({ error: "No valid fields to update" }, 400);
    }

    const serviceSupabase = createServiceClient();
    const result = await updateOrgSettings(serviceSupabase, parsed.orgId, updatePayload);

    if (!result.ok) {
      if (result.kind === "db_error") {
        return respond({ error: result.message }, 400);
      }
      return respond({ error: "Organization not found" }, 404);
    }

    return respond(result.view);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const parsed = parseOrgId(organizationId);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);

  const rateLimit = await checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "organization deletion",
    limitPerIp: 10,
    limitPerUser: 5,
    windowMs: 60_000 * 5,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return withHeaders(unauthorizedResponse(), rateLimit.headers);
  }

  // Dev-admins may delete an org they are not a member of, so the platform-level
  // bypass is evaluated first; only if it does NOT apply does a membership
  // denial (404 for non-members, 403 for non-admins) short-circuit the request.
  const isDevAdminAllowed = canDevAdminPerform(user, "delete_org");
  if (!isDevAdminAllowed) {
    const ctx = await resolveAdminContext(supabase, user.id, parsed.orgId, { skipReadOnly: true });
    if (!ctx.ok) {
      return withHeaders(denialResponse(ctx.denial), rateLimit.headers);
    }
  }

  const serviceSupabase = createServiceClient();

  if (isDevAdminAllowed) {
    const meta = await getOrgAuditMetadata(serviceSupabase, parsed.orgId);
    logDevAdminAction({
      adminUserId: user.id,
      adminEmail: user.email ?? "",
      action: "delete_org",
      targetType: "organization",
      targetId: parsed.orgId,
      targetSlug: meta.slug ?? undefined,
      ...extractRequestContext(req),
      metadata: { orgName: meta.name },
    });
  }

  try {
    await deleteOrganization(serviceSupabase, parsed.orgId, stripe);
    return respond({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete organization";
    // Capture the failure (fire-and-forget) while preserving the historical
    // 400 + raw-message body the settings UI already renders.
    internalError(message, error, { orgId: parsed.orgId, userId: user.id });
    return respond({ error: message }, 400);
  }
}

/** Attach rate-limit headers onto a resolver-produced NextResponse (whose body
 * already matches the current route contract) without re-serializing it. */
function withHeaders(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}
