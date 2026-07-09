import { z } from "zod";
import { baseSchemas, safeString, optionalSafeString } from "@/lib/security/validation";
import {
  dateStringSchema,
  eventTypeSchema,
  optionalDateStringSchema,
  optionalTimeStringSchema,
  timeStringSchema,
} from "./common";

/**
 * Boundary schemas for the mobile-facing event mutation API routes
 * (`POST /api/events`, `PATCH /api/events/[eventId]`).
 *
 * The core event fields mirror `assistantPreparedEventSchema` (same wall-clock
 * date/time contract: `start_date` "YYYY-MM-DD", `start_time` "HH:mm", optional
 * `end_date`/`end_time`, `event_type`) so `createEvent`/`updateEvent` interpret
 * them identically. Two deliberate divergences serve the mobile client:
 *
 * - `is_philanthropy` is OPTIONAL here (mobile omits it); the lib derives it
 *   from `event_type` when absent.
 * - The mobile-only persisted columns (`geofence_*`, `latitude`/`longitude`,
 *   `audience`, `target_user_ids`, `check_in_mode`) are accepted as OPTIONAL
 *   pass-through fields so QR check-in, geofencing, and audience targeting keep
 *   working. All are optional with DB defaults intact, so the AI-assistant
 *   caller (which passes only `AssistantPreparedEvent`) is unaffected.
 */

/** Update scope mirrors `UpdateEventScope` from `@/lib/events/update-event`. */
export const updateEventScopeSchema = z.enum(["this_only", "this_and_future"]);

/** Audience mirrors the DB check constraint on `public.events.audience`. */
export const eventAudienceSchema = z.enum(["members", "alumni", "both"]);

/** Check-in mode mirrors the `event_check_in_mode` enum. */
export const eventCheckInModeSchema = z.enum(["qr", "rsvp"]);

/**
 * Optional, persisted event fields beyond the core AssistantPreparedEvent set.
 * These map 1:1 onto real `public.events` columns and stay optional so DB
 * defaults apply when a caller omits them.
 */
export const eventMutationExtrasSchema = z.object({
  geofence_enabled: z.boolean().optional(),
  geofence_radius_m: z.number().finite().nonnegative().optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  audience: eventAudienceSchema.optional(),
  target_user_ids: z.array(baseSchemas.uuid).max(2000).optional(),
  check_in_mode: eventCheckInModeSchema.optional(),
});

export type EventMutationExtras = z.infer<typeof eventMutationExtrasSchema>;

/**
 * Core event fields as a plain object (unlike `assistantPreparedEventSchema`,
 * which wraps a `.refine` and so can't be `.extend()`ed or `.partial()`ed).
 * `is_philanthropy` is optional; the lib derives it when omitted.
 */
const coreEventFields = {
  title: safeString(200),
  description: optionalSafeString(5000),
  start_date: dateStringSchema,
  start_time: timeStringSchema,
  end_date: optionalDateStringSchema,
  end_time: optionalTimeStringSchema,
  location: optionalSafeString(500),
  event_type: eventTypeSchema,
  is_philanthropy: z.boolean().optional(),
} as const;

/** end > start when both halves of the end are provided. Shared by create and
 * the update variant (only enforced when the update supplies all four parts). */
function endAfterStart(data: {
  start_date?: string;
  start_time?: string;
  end_date?: string;
  end_time?: string;
}): boolean {
  if (data.start_date && data.start_time && data.end_date && data.end_time) {
    return new Date(`${data.end_date}T${data.end_time}`) > new Date(`${data.start_date}T${data.start_time}`);
  }
  return true;
}

export const createEventBodySchema = z
  .object({
    organization_id: baseSchemas.uuid,
    ...coreEventFields,
    ...eventMutationExtrasSchema.shape,
  })
  .refine(endAfterStart, {
    message: "End date/time must be after start date/time",
    path: ["end_date"],
  });

export type CreateEventBody = z.infer<typeof createEventBodySchema>;

/**
 * PATCH updates: every core field optional (PATCH semantics), extras optional.
 * The lib merges these over the existing row before validating and writing.
 */
export const eventUpdatesSchema = z
  .object({
    title: safeString(200).optional(),
    description: optionalSafeString(5000),
    start_date: dateStringSchema.optional(),
    start_time: timeStringSchema.optional(),
    end_date: optionalDateStringSchema,
    end_time: optionalTimeStringSchema,
    location: optionalSafeString(500),
    event_type: eventTypeSchema.optional(),
    is_philanthropy: z.boolean().optional(),
    ...eventMutationExtrasSchema.shape,
  })
  .refine(endAfterStart, {
    message: "End date/time must be after start date/time",
    path: ["end_date"],
  });

export type EventUpdates = z.infer<typeof eventUpdatesSchema>;

export const updateEventBodySchema = z.object({
  organization_id: baseSchemas.uuid,
  scope: updateEventScopeSchema.optional(),
  updates: eventUpdatesSchema,
});

export type UpdateEventBody = z.infer<typeof updateEventBodySchema>;
