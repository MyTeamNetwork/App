import test from "node:test";
import assert from "node:assert/strict";
import { updateEvent } from "@/lib/events/update-event";

type Row = Record<string, unknown>;

/**
 * Stub for updateEvent (this_only scope). Captures the `.update()` payload so
 * we can assert exactly which columns a partial PATCH writes.
 */
function makeSupabaseStub(options: {
  membership?: { role: string; status: string } | null;
  orgTimezone?: string | null;
  updateResult?: { data: Row | null; error: Row | null };
  onUpdate?: (payload: Row) => void;
}) {
  const {
    membership = { role: "admin", status: "active" },
    orgTimezone = "America/New_York",
    updateResult = { data: { id: "event-1", title: "Existing" }, error: null },
    onUpdate,
  } = options;

  return {
    from(table: string) {
      if (table === "organization_members") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({ data: membership, error: null }); },
        };
      }
      if (table === "organizations") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({ data: { timezone: orgTimezone }, error: null }); },
        };
      }
      if (table === "events") {
        return {
          update(payload: Row) {
            onUpdate?.(payload);
            return {
              eq() { return this; },
              is() { return this; },
              select() { return this; },
              single() { return Promise.resolve(updateResult); },
            };
          },
        };
      }
      throw new Error(`Unexpected table in stub: ${table}`);
    },
  };
}

test("updateEvent writes only the columns a partial PATCH supplies", async () => {
  let recorded: Row | undefined;
  const supabase = makeSupabaseStub({ onUpdate: (p) => { recorded = p; } });

  const result = await updateEvent({
    supabase,
    orgId: "org-1",
    actorUserId: "user-1",
    eventId: "event-1",
    scope: "this_only",
    data: { check_in_mode: "rsvp", audience: "members" },
  });

  assert.equal(result.ok, true);
  const update = recorded as Row;
  assert.equal(update.check_in_mode, "rsvp");
  assert.equal(update.audience, "members");
  // Untouched columns are absent (no clobbering existing values).
  assert.equal("title" in update, false);
  assert.equal("start_date" in update, false);
  assert.equal("event_type" in update, false);
  assert.equal("is_philanthropy" in update, false);
  // updated_at always bumped.
  assert.ok(typeof update.updated_at === "string");
});

test("updateEvent converts start/end times when both halves are provided", async () => {
  let recorded: Row | undefined;
  const supabase = makeSupabaseStub({ orgTimezone: "America/Los_Angeles", onUpdate: (p) => { recorded = p; } });

  const result = await updateEvent({
    supabase,
    orgId: "org-1",
    actorUserId: "user-1",
    eventId: "event-1",
    scope: "this_only",
    data: { start_date: "2026-07-15", start_time: "15:00", end_date: "2026-07-15", end_time: "16:00" },
  });

  assert.equal(result.ok, true);
  const update = recorded as Row;
  // 15:00 PDT (UTC-7) -> 22:00 UTC.
  assert.equal(update.start_date, "2026-07-15T22:00:00.000Z");
  assert.equal(update.end_date, "2026-07-15T23:00:00.000Z");
});

test("updateEvent rejects a start_date without a start_time (unpaired wall-clock)", async () => {
  const supabase = makeSupabaseStub({});

  const result = await updateEvent({
    supabase,
    orgId: "org-1",
    actorUserId: "user-1",
    eventId: "event-1",
    scope: "this_only",
    data: { start_date: "2026-07-15" },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.match(result.error, /start_date and start_time/i);
  }
});

test("updateEvent derives is_philanthropy when event_type changes to philanthropy", async () => {
  let recorded: Row | undefined;
  const supabase = makeSupabaseStub({ onUpdate: (p) => { recorded = p; } });

  const result = await updateEvent({
    supabase,
    orgId: "org-1",
    actorUserId: "user-1",
    eventId: "event-1",
    scope: "this_only",
    data: { event_type: "philanthropy" },
  });

  assert.equal(result.ok, true);
  const update = recorded as Row;
  assert.equal(update.event_type, "philanthropy");
  assert.equal(update.is_philanthropy, true);
});

test("updateEvent rejects a non-admin actor", async () => {
  const supabase = makeSupabaseStub({ membership: { role: "active_member", status: "active" } });

  const result = await updateEvent({
    supabase,
    orgId: "org-1",
    actorUserId: "user-1",
    eventId: "event-1",
    scope: "this_only",
    data: { title: "New title" },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 403);
});

test("updateEvent returns 404 when the event does not exist", async () => {
  const supabase = makeSupabaseStub({ updateResult: { data: null, error: null } });

  const result = await updateEvent({
    supabase,
    orgId: "org-1",
    actorUserId: "user-1",
    eventId: "missing",
    scope: "this_only",
    data: { title: "New title" },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});
