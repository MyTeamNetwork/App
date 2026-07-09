import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { resolveAdminContext } from "@/lib/organizations/context";
import {
  denialResponse,
  readOnlyGuard,
  unauthorizedResponse,
} from "@/lib/organizations/errors";
import { createEventBodySchema } from "@/lib/schemas/events-mutation";
import { createEvent } from "@/lib/events/create-event";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Injectable dependencies. Defaulted to the real implementations; overridden in
 * route tests so the handler can be exercised end-to-end without a live
 * Supabase. Mirrors the DI seam used by the AI pending-action confirm handler.
 */
export interface CreateEventRouteDeps {
  createAuthenticatedApiClient?: typeof createAuthenticatedApiClient;
  createServiceClient?: typeof createServiceClient;
  resolveAdminContext?: typeof resolveAdminContext;
  createEvent?: typeof createEvent;
}

/**
 * POST /api/events — create an event.
 *
 * Bearer-token (mobile) or cookie (web) authenticated. This route is a thin
 * boundary: validate the body, resolve the caller's admin context against the
 * target org (request-scoped client so bearer sessions read subscription status
 * as themselves), block writes when the org is read-only, then delegate to
 * `createEvent`, which owns org-timezone conversion and its own admin re-check.
 */
export function createCreateEventHandler(deps: CreateEventRouteDeps = {}) {
  const createAuthenticatedApiClientFn =
    deps.createAuthenticatedApiClient ?? createAuthenticatedApiClient;
  const createServiceClientFn = deps.createServiceClient ?? createServiceClient;
  const resolveAdminContextFn = deps.resolveAdminContext ?? resolveAdminContext;
  const createEventFn = deps.createEvent ?? createEvent;

  return async function POST(request: Request) {
    try {
      const { supabase, user } = await createAuthenticatedApiClientFn(request);

      const rateLimit = await checkRateLimit(request, {
        userId: user?.id ?? null,
        feature: "create event",
        limitPerIp: 60,
        limitPerUser: 40,
      });
      if (!rateLimit.ok) {
        return buildRateLimitResponse(rateLimit);
      }

      const respond = (payload: unknown, status = 200) =>
        NextResponse.json(payload, { status, headers: rateLimit.headers });

      if (!user) {
        return withHeaders(unauthorizedResponse(), rateLimit.headers);
      }

      const body = await validateJson(request, createEventBodySchema);
      const { organization_id: orgId, ...input } = body;

      const ctx = await resolveAdminContextFn(supabase, user.id, orgId);
      if (!ctx.ok) {
        return withHeaders(denialResponse(ctx.denial), rateLimit.headers);
      }
      const readOnly = readOnlyGuard(ctx.ctx);
      if (readOnly) {
        return withHeaders(readOnly, rateLimit.headers);
      }

      const result = await createEventFn({
        supabase,
        serviceSupabase: createServiceClientFn(),
        orgId,
        userId: user.id,
        input,
      });

      if (!result.ok) {
        if (result.status === 500) {
          console.error("[events POST] createEvent failed", {
            orgId,
            code: result.code ?? null,
            internalErrorCode: result.internalError?.code ?? null,
          });
        }
        // event_type_unavailable is a client-actionable "this env lacks the
        // migration" signal — surface it as 422 rather than a generic 500.
        const status = result.code === "event_type_unavailable" ? 422 : result.status;
        return respond(
          {
            error: result.error,
            ...(result.code ? { code: result.code } : {}),
            ...(result.details ? { details: result.details } : {}),
          },
          status,
        );
      }

      return respond({ event: result.event }, 200);
    } catch (err) {
      if (err instanceof ValidationError) {
        return validationErrorResponse(err);
      }
      console.error("[events POST] unexpected error", err);
      return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
    }
  };
}

export const POST = createCreateEventHandler();

/** Attach rate-limit headers onto a resolver-produced NextResponse without
 * re-serializing its body (which already matches the route contract). */
function withHeaders(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}
