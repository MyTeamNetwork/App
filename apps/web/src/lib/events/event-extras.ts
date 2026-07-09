import type { EventMutationExtras } from "@/lib/schemas/events-mutation";

/**
 * Build the partial `events` insert/update payload for the optional persisted
 * extras (geofencing, coordinates, audience targeting, check-in mode).
 *
 * Only keys the caller actually supplied are included, so an omitted field
 * leaves the DB default intact on insert and the existing value untouched on
 * update. This keeps the AI-assistant caller (which never sends extras)
 * byte-for-byte unchanged.
 */
export function buildEventExtrasInsert(
  extras: EventMutationExtras,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (extras.geofence_enabled !== undefined) payload.geofence_enabled = extras.geofence_enabled;
  if (extras.geofence_radius_m !== undefined) payload.geofence_radius_m = extras.geofence_radius_m;
  if (extras.latitude !== undefined) payload.latitude = extras.latitude;
  if (extras.longitude !== undefined) payload.longitude = extras.longitude;
  if (extras.audience !== undefined) payload.audience = extras.audience;
  if (extras.target_user_ids !== undefined) payload.target_user_ids = extras.target_user_ids;
  if (extras.check_in_mode !== undefined) payload.check_in_mode = extras.check_in_mode;
  return payload;
}
