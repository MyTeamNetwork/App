import test from "node:test";
import assert from "node:assert/strict";
import { createEvent } from "@/lib/events/create-event";

type Row = Record<string, unknown>;

/**
 * Minimal Supabase-shaped stub for createEvent tests.
 *
 * `membership` seeds the single organization_members row consulted by
 * requireEventAdmin (role/status gate). `orgTimezone` seeds the
 * organizations.timezone lookup used to interpret start/end wall-clock
 * input in the org's local time. `insertResult` controls what the final
 * events insert resolves to.
 */
function makeSupabaseStub(options: {
  membership?: { role: string; status: string } | null;
  membershipError?: { code?: string; message: string } | null;
  orgTimezone?: string | null;
  orgLookupError?: { code?: string; message: string } | null;
  insertResult?: { data: Row | null; error: Row | null };
}) {
  const {
    membership = { role: "admin", status: "active" },
    membershipError = null,
    orgTimezone = "America/New_York",
    orgLookupError = null,
    insertResult = { data: { id: "event-1", title: "Test Event" }, error: null },
  } = options;

  return {
    from(table: string) {
      if (table === "organization_members") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: membership, error: membershipError });
          },
        };
      }

      if (table === "organizations") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({
              data: orgLookupError ? null : { timezone: orgTimezone },
              error: orgLookupError,
            });
          },
        };
      }

      if (table === "events") {
        return {
          insert() {
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve(insertResult);
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table in stub: ${table}`);
    },
  };
}

const baseInput = {
  title: "Organic Chemistry",
  start_date: "2026-04-07",
  start_time: "09:00",
  end_date: "2026-04-07",
  end_time: "10:15",
  location: "Room 101",
  event_type: "class" as const,
  is_philanthropy: false,
};

test("createEvent maps unsupported event_type enum insert failures to a structured error", async () => {
  const supabase = makeSupabaseStub({
    insertResult: {
      data: null,
      error: {
        code: "22P02",
        message: 'invalid input value for enum event_type: "class"',
        details: null,
        hint: null,
      },
    },
  });

  const result = await createEvent({
    supabase,
    serviceSupabase: supabase,
    orgId: "org-1",
    userId: "user-1",
    orgSlug: "upenn-sprint-football",
    input: baseInput,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);

  if (!result.ok) {
    assert.equal(result.code, "event_type_unavailable");
    assert.match(result.error, /does not support the selected event type/i);
    assert.equal(result.internalError?.code, "22P02");
    assert.match(String(result.internalError?.message), /enum event_type/i);
  }
});

test("createEvent rejects non-admin actors before touching the database", async () => {
  const supabase = makeSupabaseStub({
    membership: { role: "active_member", status: "active" },
  });

  const result = await createEvent({
    supabase,
    serviceSupabase: supabase,
    orgId: "org-1",
    userId: "user-1",
    orgSlug: "upenn-sprint-football",
    input: baseInput,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  if (!result.ok) {
    assert.match(result.error, /only admins can create events/i);
  }
});

test("createEvent rejects when the actor has no active membership", async () => {
  const supabase = makeSupabaseStub({ membership: null });

  const result = await createEvent({
    supabase,
    serviceSupabase: supabase,
    orgId: "org-1",
    userId: "user-1",
    orgSlug: "upenn-sprint-football",
    input: baseInput,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test("createEvent converts 3pm America/Los_Angeles wall-clock input to the correct UTC instant", async () => {
  let recordedStartDate: string | undefined;
  let recordedEndDate: string | undefined;
  const recordingSupabase = {
    from(table: string) {
      if (table === "organization_members") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() {
            return Promise.resolve({ data: { role: "admin", status: "active" }, error: null });
          },
        };
      }
      if (table === "organizations") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() {
            return Promise.resolve({ data: { timezone: "America/Los_Angeles" }, error: null });
          },
        };
      }
      if (table === "events") {
        return {
          insert(payload: Row) {
            recordedStartDate = payload.start_date as string;
            recordedEndDate = payload.end_date as string;
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({ data: { id: "event-2", title: "Test Event" }, error: null });
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table in stub: ${table}`);
    },
  };

  const result = await createEvent({
    supabase: recordingSupabase,
    serviceSupabase: recordingSupabase,
    orgId: "org-1",
    userId: "user-1",
    orgSlug: "upenn-sprint-football",
    input: {
      ...baseInput,
      start_date: "2026-07-15",
      start_time: "15:00",
      end_date: "2026-07-15",
      end_time: "16:00",
    },
  });

  assert.equal(result.ok, true);

  // July 15 2026 is during PDT (UTC-7): 15:00 local -> 22:00 UTC.
  assert.equal(recordedStartDate, "2026-07-15T22:00:00.000Z");
  assert.equal(recordedEndDate, "2026-07-15T23:00:00.000Z");
});

test("createEvent rejects a nonexistent local time in a DST spring-forward gap", async () => {
  const supabase = makeSupabaseStub({ orgTimezone: "Europe/London" });

  // 2026-03-29 01:30 Europe/London does not exist: UK clocks spring forward
  // from 01:00 to 02:00 on that date. end_time is chosen well clear of the
  // gap (and clear of any US DST transition, which already happened Mar 8)
  // so the schema's own naive end>start refine does not interfere with
  // isolating the localToUtcIso rejection under test.
  const result = await createEvent({
    supabase,
    serviceSupabase: supabase,
    orgId: "org-1",
    userId: "user-1",
    orgSlug: "upenn-sprint-football",
    input: {
      ...baseInput,
      start_date: "2026-03-29",
      start_time: "01:30",
      end_date: "2026-03-29",
      end_time: "05:00",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  if (!result.ok) {
    assert.match(result.error, /nonexistent local time/i);
  }
});

test("createEvent surfaces a 500 when the organization timezone lookup fails", async () => {
  const supabase = makeSupabaseStub({
    orgLookupError: { code: "500", message: "connection error" },
  });

  const result = await createEvent({
    supabase,
    serviceSupabase: supabase,
    orgId: "org-1",
    userId: "user-1",
    orgSlug: "upenn-sprint-football",
    input: baseInput,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  if (!result.ok) {
    assert.match(result.error, /timezone/i);
  }
});

test("createEvent persists mobile extras and derives is_philanthropy when omitted", async () => {
  let recordedInsert: Row | undefined;
  const recordingSupabase = {
    from(table: string) {
      if (table === "organization_members") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() {
            return Promise.resolve({ data: { role: "admin", status: "active" }, error: null });
          },
        };
      }
      if (table === "organizations") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() {
            return Promise.resolve({ data: { timezone: "America/New_York" }, error: null });
          },
        };
      }
      if (table === "events") {
        return {
          insert(payload: Row) {
            recordedInsert = payload;
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({ data: { id: "event-mobile", title: "Community Cleanup" }, error: null });
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table in stub: ${table}`);
    },
  };

  // No is_philanthropy on the input; event_type is philanthropy so it derives true.
  const result = await createEvent({
    supabase: recordingSupabase,
    serviceSupabase: recordingSupabase,
    orgId: "org-1",
    userId: "user-1",
    orgSlug: "upenn-sprint-football",
    input: {
      title: "Community Cleanup",
      start_date: "2026-05-01",
      start_time: "08:00",
      end_date: "2026-05-01",
      end_time: "12:00",
      location: "River Park",
      event_type: "philanthropy",
      geofence_enabled: true,
      geofence_radius_m: 150,
      latitude: 40.7128,
      longitude: -74.006,
      audience: "members",
      target_user_ids: ["22222222-2222-4222-8222-222222222222"],
      check_in_mode: "qr",
    },
  });

  assert.equal(result.ok, true);
  assert.ok(recordedInsert, "events insert should have been called");
  const insert = recordedInsert as Row;
  // Derived from event_type since is_philanthropy was omitted.
  assert.equal(insert.is_philanthropy, true);
  // Extras persisted verbatim.
  assert.equal(insert.geofence_enabled, true);
  assert.equal(insert.geofence_radius_m, 150);
  assert.equal(insert.latitude, 40.7128);
  assert.equal(insert.longitude, -74.006);
  assert.equal(insert.audience, "members");
  assert.deepEqual(insert.target_user_ids, ["22222222-2222-4222-8222-222222222222"]);
  assert.equal(insert.check_in_mode, "qr");
});

test("createEvent omits unset extras so DB defaults apply", async () => {
  let recordedInsert: Row | undefined;
  const recordingSupabase = {
    from(table: string) {
      if (table === "organization_members") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({ data: { role: "admin", status: "active" }, error: null }); },
        };
      }
      if (table === "organizations") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({ data: { timezone: "America/New_York" }, error: null }); },
        };
      }
      if (table === "events") {
        return {
          insert(payload: Row) {
            recordedInsert = payload;
            return { select() { return { single() { return Promise.resolve({ data: { id: "e", title: "t" }, error: null }); } }; } };
          },
        };
      }
      throw new Error(`Unexpected table in stub: ${table}`);
    },
  };

  const result = await createEvent({
    supabase: recordingSupabase,
    serviceSupabase: recordingSupabase,
    orgId: "org-1",
    userId: "user-1",
    orgSlug: "x",
    input: { ...baseInput, is_philanthropy: false },
  });

  assert.equal(result.ok, true);
  const insert = recordedInsert as Row;
  // No extras provided → keys absent so DB defaults (audience 'both', check_in_mode 'rsvp') apply.
  assert.equal("audience" in insert, false);
  assert.equal("check_in_mode" in insert, false);
  assert.equal("geofence_enabled" in insert, false);
});
