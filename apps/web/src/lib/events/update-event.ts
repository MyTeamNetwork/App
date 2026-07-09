import { type AssistantPreparedEvent } from "@/lib/schemas/events-ai";
import {
  eventUpdatesSchema,
  type EventMutationExtras,
} from "@/lib/schemas/events-mutation";
import { updateFutureEvents, type DeleteEventScope } from "./recurring-operations";
import { requireEventAdmin } from "./permissions";
import { buildEventExtrasInsert } from "./event-extras";
import { localToUtcIso, resolveOrgTimezone } from "@/lib/utils/timezone";

export type UpdateEventScope = Exclude<DeleteEventScope, "all_in_series">;

/**
 * Fields accepted by `updateEvent`. The AI-assistant caller passes a full
 * `AssistantPreparedEvent`; the mobile PATCH route passes any subset of the
 * same core fields plus optional persisted extras (PATCH semantics). Provided
 * fields are merged over the existing row; omitted fields are left untouched.
 */
export type UpdateEventFields =
  & Partial<Omit<AssistantPreparedEvent, "is_philanthropy">>
  & { is_philanthropy?: boolean }
  & Partial<EventMutationExtras>;

export type UpdateEventResult =
  | { ok: true; event: Record<string, unknown>; affectedEventIds: string[]; syncWarnings: string[] }
  | { ok: false; status: number; error: string; details?: string[] };

export async function updateEvent(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  orgId: string;
  actorUserId: string;
  eventId: string;
  data: UpdateEventFields;
  scope: UpdateEventScope;
}): Promise<UpdateEventResult> {
  const permission = await requireEventAdmin({
    supabase: input.supabase,
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    action: "edit",
  });
  if (!permission.ok) return permission;

  const parsedResult = eventUpdatesSchema.safeParse(input.data);
  if (!parsedResult.success) {
    return {
      ok: false,
      status: 400,
      error: "Validation failed",
      details: parsedResult.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`),
    };
  }
  const parsed = parsedResult.data;

  // start/end are wall-clock pairs: converting either requires BOTH halves, so
  // a partial update touching only one half of a pair is a client error.
  if ((parsed.start_date == null) !== (parsed.start_time == null)) {
    return { ok: false, status: 400, error: "start_date and start_time must be provided together" };
  }
  if ((parsed.end_date == null) !== (parsed.end_time == null)) {
    return { ok: false, status: 400, error: "end_date and end_time must be provided together" };
  }

  const { data: orgRow, error: orgError } = await input.supabase
    .from("organizations")
    .select("timezone")
    .eq("id", input.orgId)
    .maybeSingle();

  if (orgError) {
    return { ok: false, status: 500, error: "Failed to resolve organization timezone" };
  }

  const orgTimezone = resolveOrgTimezone(orgRow?.timezone);

  // Only convert the date/time columns the caller actually supplied. Omitted
  // pairs are left off the update object so the stored UTC instant is kept.
  const timeUpdate: { start_date?: string; end_date?: string | null } = {};
  try {
    if (parsed.start_date && parsed.start_time) {
      timeUpdate.start_date = localToUtcIso(parsed.start_date, parsed.start_time, orgTimezone);
    }
    if (parsed.end_date && parsed.end_time) {
      timeUpdate.end_date = localToUtcIso(parsed.end_date, parsed.end_time, orgTimezone);
    }
  } catch (err) {
    if (err instanceof RangeError) {
      return { ok: false, status: 400, error: err.message };
    }
    throw err;
  }

  // Derive is_philanthropy when omitted but event_type is being set to the
  // philanthropy type; otherwise leave it untouched unless explicitly provided.
  let derivedPhilanthropy: boolean | undefined = parsed.is_philanthropy;
  if (derivedPhilanthropy === undefined && parsed.event_type === "philanthropy") {
    derivedPhilanthropy = true;
  }

  const extras = buildEventExtrasInsert({
    geofence_enabled: parsed.geofence_enabled,
    geofence_radius_m: parsed.geofence_radius_m,
    latitude: parsed.latitude,
    longitude: parsed.longitude,
    audience: parsed.audience,
    target_user_ids: parsed.target_user_ids,
    check_in_mode: parsed.check_in_mode,
  });

  // Merge: only include columns the caller provided. An empty update object is
  // still valid (no-op fields) but always bumps updated_at.
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    ...timeUpdate,
    ...extras,
  };
  if (parsed.title !== undefined) update.title = parsed.title;
  if (parsed.description !== undefined) update.description = parsed.description ?? null;
  if (parsed.location !== undefined) update.location = parsed.location ?? null;
  if (parsed.event_type !== undefined) update.event_type = parsed.event_type;
  if (derivedPhilanthropy !== undefined) update.is_philanthropy = derivedPhilanthropy;

  if (input.scope === "this_and_future") {
    // Propagate only the series-shared fields the caller actually changed.
    const seriesUpdate: Parameters<typeof updateFutureEvents>[3] = {};
    if (parsed.title !== undefined) seriesUpdate.title = parsed.title;
    if (parsed.description !== undefined) seriesUpdate.description = parsed.description ?? null;
    if (parsed.location !== undefined) seriesUpdate.location = parsed.location ?? null;
    if (parsed.event_type !== undefined) seriesUpdate.event_type = parsed.event_type;
    if (derivedPhilanthropy !== undefined) seriesUpdate.is_philanthropy = derivedPhilanthropy;
    if (parsed.check_in_mode !== undefined) seriesUpdate.check_in_mode = parsed.check_in_mode;

    const { updatedIds, error } = await updateFutureEvents(input.supabase, input.eventId, input.orgId, seriesUpdate);
    if (error) return { ok: false, status: 409, error };
    const { data: event } = await input.supabase
      .from("events")
      .select("*")
      .eq("id", input.eventId)
      .eq("organization_id", input.orgId)
      .maybeSingle();
    return { ok: true, event: event ?? { id: input.eventId }, affectedEventIds: updatedIds, syncWarnings: [] };
  }

  const { data: event, error } = await input.supabase
    .from("events")
    .update(update)
    .eq("id", input.eventId)
    .eq("organization_id", input.orgId)
    .is("deleted_at", null)
    .select("*")
    .single();

  if (error) return { ok: false, status: 500, error: "Failed to update event" };
  if (!event) return { ok: false, status: 404, error: "Event not found" };
  return { ok: true, event, affectedEventIds: [input.eventId], syncWarnings: [] };
}
