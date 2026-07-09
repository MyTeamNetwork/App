import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
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
import { updateEventBodySchema } from "@/lib/schemas/events-mutation";
import { updateEvent } from "@/lib/events/update-event";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

/**
 * Injectable dependencies. Defaulted to the real implementations; overridden in
 * route tests so the handler can be exercised end-to-end without a live
 * Supabase.
 */
export interface UpdateEventRouteDeps {
  createAuthenticatedApiClient?: typeof createAuthenticatedApiClient;
  resolveAdminContext?: typeof resolveAdminContext;
  updateEvent?: typeof updateEvent;
}

/**
 * PATCH /api/events/[eventId] — update an event.
 *
 * Same boundary shape as `POST /api/events`: validate, resolve admin context
 * (request-scoped client for bearer sessions), block read-only orgs, then
 * delegate to `updateEvent`, which owns timezone conversion, its own admin
 * re-check, and recurring-series scope handling.
 */
export function createUpdateEventHandler(deps: UpdateEventRouteDeps = {}) {
  const createAuthenticatedApiClientFn =
    deps.createAuthenticatedApiClient ?? createAuthenticatedApiClient;
  const resolveAdminContextFn = deps.resolveAdminContext ?? resolveAdminContext;
  const updateEventFn = deps.updateEvent ?? updateEvent;

  return async function PATCH(request: Request, { params }: RouteParams) {
    try {
      const { eventId } = await params;

      const { supabase, user } = await createAuthenticatedApiClientFn(request);

      const rateLimit = await checkRateLimit(request, {
        userId: user?.id ?? null,
        feature: "update event",
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

      const body = await validateJson(request, updateEventBodySchema);

      const ctx = await resolveAdminContextFn(supabase, user.id, body.organization_id);
      if (!ctx.ok) {
        return withHeaders(denialResponse(ctx.denial), rateLimit.headers);
      }
      const readOnly = readOnlyGuard(ctx.ctx);
      if (readOnly) {
        return withHeaders(readOnly, rateLimit.headers);
      }

      const result = await updateEventFn({
        supabase,
        orgId: body.organization_id,
        actorUserId: user.id,
        eventId,
        data: body.updates,
        scope: body.scope ?? "this_only",
      });

      if (!result.ok) {
        if (result.status === 500) {
          console.error("[events PATCH] updateEvent failed", { eventId });
        }
        return respond(
          {
            error: result.error,
            ...(result.details ? { details: result.details } : {}),
          },
          result.status,
        );
      }

      return respond({ event: result.event });
    } catch (err) {
      if (err instanceof ValidationError) {
        return validationErrorResponse(err);
      }
      console.error("[events PATCH] unexpected error", err);
      return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
    }
  };
}

export const PATCH = createUpdateEventHandler();

/** Attach rate-limit headers onto a resolver-produced NextResponse without
 * re-serializing its body. */
function withHeaders(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}
