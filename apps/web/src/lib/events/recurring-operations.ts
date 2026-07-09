/**
 * Authorization contract: these functions perform no internal authorization
 * check of their own — callers are responsible for verifying the actor may
 * perform the operation before invoking them.
 *
 *  - UI-driven callers (e.g. Server Components/Actions using the request's
 *    auth-bound Supabase client) are covered by row-level security policies
 *    on the `events` table, so RLS is the enforcement point.
 *  - Service-role callers (e.g. the AI assistant confirm handler, which uses
 *    a service-role client that bypasses RLS) MUST check authorization
 *    themselves before calling into this module. See ./permissions.ts
 *    (`requireEventAdmin`) and its use in ./create-event.ts, ./update-event.ts,
 *    and ./delete-event.ts for the expected pattern.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { expandRecurrence, type RecurrenceRule } from "./recurrence";

type EventInsert = Database["public"]["Tables"]["events"]["Insert"];
type EventUpdate = Database["public"]["Tables"]["events"]["Update"];
type EventType = Database["public"]["Enums"]["event_type"];
type CheckInMode = Database["public"]["Enums"]["event_check_in_mode"];

interface BaseEventData {
  organization_id: string;
  title: string;
  description?: string | null;
  start_date: string;       // ISO datetime
  end_date?: string | null;  // ISO datetime
  location?: string | null;
  event_type: EventType;
  is_philanthropy?: boolean;
  audience?: string | null;
  target_user_ids?: string[] | null;
  created_by_user_id?: string | null;
  check_in_mode?: CheckInMode;
}

/**
 * Create a recurring event series by pre-expanding all instances.
 * Returns the group ID and all created event IDs.
 */
export async function createRecurringEvents(
  supabase: SupabaseClient<Database>,
  baseEvent: BaseEventData,
  rule: RecurrenceRule,
): Promise<{ groupId: string; eventIds: string[]; error: string | null }> {
  const groupId = crypto.randomUUID();

  if (rule.occurrence_type === "weekly" && rule.day_of_week) {
    const invalid = rule.day_of_week.filter((d) => !Number.isInteger(d) || d < 0 || d > 6);
    if (invalid.length > 0) {
      return {
        groupId,
        eventIds: [],
        error: `Invalid day_of_week value(s): ${invalid.join(", ")}. Must be integers 0-6 (Sunday-Saturday).`,
      };
    }
  }

  if (rule.occurrence_type === "monthly" && rule.day_of_month !== undefined) {
    if (!Number.isInteger(rule.day_of_month) || rule.day_of_month < 1 || rule.day_of_month > 31) {
      return {
        groupId,
        eventIds: [],
        error: `Invalid day_of_month value: ${rule.day_of_month}. Must be an integer 1-31.`,
      };
    }
  }

  const instances = expandRecurrence(baseEvent.start_date, baseEvent.end_date ?? null, rule);

  if (instances.length === 0) {
    return { groupId, eventIds: [], error: "No instances generated from recurrence rule" };
  }

  // Build rows for bulk insert
  const rows: EventInsert[] = instances.map((inst) => ({
    organization_id: baseEvent.organization_id,
    title: baseEvent.title,
    description: baseEvent.description ?? null,
    start_date: inst.start_date,
    end_date: inst.end_date,
    location: baseEvent.location ?? null,
    event_type: baseEvent.event_type,
    is_philanthropy: baseEvent.is_philanthropy ?? false,
    audience: baseEvent.audience ?? null,
    target_user_ids: baseEvent.target_user_ids ?? null,
    created_by_user_id: baseEvent.created_by_user_id ?? null,
    check_in_mode: baseEvent.check_in_mode ?? "rsvp",
    recurrence_group_id: groupId,
    recurrence_index: inst.recurrence_index,
    recurrence_rule: inst.recurrence_index === 0 ? (rule as unknown as Database["public"]["Tables"]["events"]["Insert"]["recurrence_rule"]) : null,
  }));

  const { data, error } = await supabase
    .from("events")
    .insert(rows)
    .select();

  if (error) {
    return { groupId, eventIds: [], error: error.message };
  }

  const eventIds = (data ?? []).map((e) => e.id);
  return { groupId, eventIds, error: null };
}

/**
 * Update this event and all future events in the series.
 * "Future" means recurrence_index >= the given event's index AND start_date >= now.
 */
export async function updateFutureEvents(
  supabase: SupabaseClient<Database>,
  eventId: string,
  orgId: string,
  updates: Partial<Pick<EventUpdate, "title" | "description" | "location" | "event_type" | "is_philanthropy" | "check_in_mode">>,
): Promise<{ updatedIds: string[]; error: string | null }> {
  // First, get the event to find its group and index
  const { data: event, error: fetchError } = await supabase
    .from("events")
    .select("recurrence_group_id, recurrence_index")
    .eq("id", eventId)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .single();

  if (fetchError || !event?.recurrence_group_id) {
    return { updatedIds: [], error: fetchError?.message ?? "Event not found or not recurring" };
  }

  // Update all events in the series with index >= this event's index
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("events")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("recurrence_group_id", event.recurrence_group_id)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .gte("recurrence_index", event.recurrence_index)
    .gte("start_date", now)
    .select();

  if (updateError) {
    return { updatedIds: [], error: updateError.message };
  }

  return { updatedIds: (updated ?? []).map((e) => e.id), error: null };
}

export type DeleteEventScope = "this_only" | "this_and_future" | "all_in_series";

/**
 * Soft-delete events in a series by scope.
 */
export async function deleteEventsInSeries(
  supabase: SupabaseClient<Database>,
  eventId: string,
  orgId: string,
  scope: DeleteEventScope,
): Promise<{ deletedIds: string[]; error: string | null }> {
  const now = new Date().toISOString();

  if (scope === "this_only") {
    const { error } = await supabase
      .from("events")
      .update({ deleted_at: now })
      .eq("id", eventId)
      .eq("organization_id", orgId)
      .is("deleted_at", null);

    return { deletedIds: error ? [] : [eventId], error: error?.message ?? null };
  }

  // For series-wide operations, get the event's group info
  const { data: event, error: fetchError } = await supabase
    .from("events")
    .select("recurrence_group_id, recurrence_index")
    .eq("id", eventId)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .single();

  if (fetchError || !event?.recurrence_group_id) {
    return { deletedIds: [], error: fetchError?.message ?? "Event not found or not recurring" };
  }

  let query = supabase
    .from("events")
    .update({ deleted_at: now })
    .eq("recurrence_group_id", event.recurrence_group_id)
    .eq("organization_id", orgId)
    .is("deleted_at", null);

  if (scope === "this_and_future") {
    query = query.gte("recurrence_index", event.recurrence_index);
  }
  // "all_in_series" — no additional filter needed

  const { data: deleted, error: deleteError } = await query.select();

  return {
    deletedIds: (deleted ?? []).map((e) => e.id),
    error: deleteError?.message ?? null,
  };
}
