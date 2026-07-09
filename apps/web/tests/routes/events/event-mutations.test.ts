import test from "node:test";
import assert from "node:assert/strict";
import { createCreateEventHandler } from "@/app/api/events/route";
import { createUpdateEventHandler } from "@/app/api/events/[eventId]/route";
import type { OrgContextResult } from "@/lib/organizations/context";
import type { CreateEventResult } from "@/lib/events/create-event";
import type { UpdateEventResult } from "@/lib/events/update-event";

/**
 * Route-level tests for the mobile-facing event mutation API.
 *
 * These exercise the REAL handlers through their DI seam: the auth client,
 * org-context resolver, and the create/update lib functions are all injected
 * so the boundary behavior (validation → resolve context → read-only gate →
 * delegate → error mapping) is verified without a live Supabase.
 */

const AUTHED_USER = { id: "user-1" } as const;

const validCreateBody = {
  organization_id: "11111111-1111-4111-8111-111111111111",
  title: "Team Practice",
  description: "Weekly practice",
  start_date: "2026-04-07",
  start_time: "09:00",
  end_date: "2026-04-07",
  end_time: "10:15",
  location: "Field A",
  event_type: "practice" as const,
  is_philanthropy: false,
};

function jsonRequest(body: unknown): Request {
  return new Request("https://example.com/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

function okContext(): OrgContextResult {
  return {
    ok: true,
    ctx: { orgId: validCreateBody.organization_id, userId: AUTHED_USER.id, role: "admin", status: "active", isReadOnly: false },
  };
}

function readOnlyContext(): OrgContextResult {
  return {
    ok: true,
    ctx: { orgId: validCreateBody.organization_id, userId: AUTHED_USER.id, role: "admin", status: "active", isReadOnly: true },
  };
}

const authClientStub = () =>
  Promise.resolve({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: AUTHED_USER as any,
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serviceClientStub = () => ({}) as any;

test("POST /api/events creates an event on the happy path", async () => {
  let received: unknown;
  const POST = createCreateEventHandler({
    createAuthenticatedApiClient: authClientStub,
    createServiceClient: serviceClientStub,
    resolveAdminContext: () => Promise.resolve(okContext()),
    createEvent: (req) => {
      received = req;
      return Promise.resolve({
        ok: true,
        status: 201,
        event: { id: "event-1", title: "Team Practice" },
        eventUrl: "",
      } satisfies CreateEventResult);
    },
  });

  const res = await POST(jsonRequest(validCreateBody));
  assert.equal(res.status, 200);
  const payload = (await res.json()) as { event: { id: string; title: string } };
  assert.deepEqual(payload.event, { id: "event-1", title: "Team Practice" });

  // organization_id is stripped from the delegated input; orgId is passed separately.
  const call = received as { orgId: string; userId: string; input: Record<string, unknown> };
  assert.equal(call.orgId, validCreateBody.organization_id);
  assert.equal(call.userId, AUTHED_USER.id);
  assert.equal(call.input.title, "Team Practice");
  assert.ok(!("organization_id" in call.input));
});

test("POST /api/events returns 403 for a non-admin caller", async () => {
  let createCalled = false;
  const POST = createCreateEventHandler({
    createAuthenticatedApiClient: authClientStub,
    createServiceClient: serviceClientStub,
    resolveAdminContext: () => Promise.resolve({ ok: false, denial: "not_admin" }),
    createEvent: () => {
      createCalled = true;
      return Promise.resolve({ ok: false, status: 500, error: "unreached" } satisfies CreateEventResult);
    },
  });

  const res = await POST(jsonRequest(validCreateBody));
  assert.equal(res.status, 403);
  const payload = (await res.json()) as { error: string };
  assert.equal(payload.error, "Forbidden");
  assert.equal(createCalled, false, "createEvent must not run after an authz denial");
});

test("POST /api/events returns 403 read-only when the org is frozen", async () => {
  let createCalled = false;
  const POST = createCreateEventHandler({
    createAuthenticatedApiClient: authClientStub,
    createServiceClient: serviceClientStub,
    resolveAdminContext: () => Promise.resolve(readOnlyContext()),
    createEvent: () => {
      createCalled = true;
      return Promise.resolve({ ok: false, status: 500, error: "unreached" } satisfies CreateEventResult);
    },
  });

  const res = await POST(jsonRequest(validCreateBody));
  assert.equal(res.status, 403);
  const payload = (await res.json()) as { error: string; code?: string };
  assert.equal(payload.code, "ORG_READ_ONLY");
  assert.equal(createCalled, false, "createEvent must not run when the org is read-only");
});

test("POST /api/events returns 400 on an invalid body", async () => {
  let resolveCalled = false;
  const POST = createCreateEventHandler({
    createAuthenticatedApiClient: authClientStub,
    createServiceClient: serviceClientStub,
    resolveAdminContext: () => {
      resolveCalled = true;
      return Promise.resolve(okContext());
    },
    createEvent: () =>
      Promise.resolve({ ok: false, status: 500, error: "unreached" } satisfies CreateEventResult),
  });

  const { organization_id, ...noOrg } = validCreateBody;
  void organization_id;
  const res = await POST(jsonRequest(noOrg));
  assert.equal(res.status, 400);
  assert.equal(resolveCalled, false, "validation must fail before context resolution");
});

test("POST /api/events maps event_type_unavailable to 422 with the code", async () => {
  const POST = createCreateEventHandler({
    createAuthenticatedApiClient: authClientStub,
    createServiceClient: serviceClientStub,
    resolveAdminContext: () => Promise.resolve(okContext()),
    createEvent: () =>
      Promise.resolve({
        ok: false,
        status: 500,
        code: "event_type_unavailable",
        error: "This environment does not support the selected event type yet.",
      } satisfies CreateEventResult),
  });

  const res = await POST(jsonRequest(validCreateBody));
  assert.equal(res.status, 422);
  const payload = (await res.json()) as { error: string; code?: string };
  assert.equal(payload.code, "event_type_unavailable");
});

test("POST /api/events returns 401 when unauthenticated", async () => {
  const POST = createCreateEventHandler({
    createAuthenticatedApiClient: () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Promise.resolve({ supabase: {} as any, user: null }),
    createServiceClient: serviceClientStub,
    resolveAdminContext: () => Promise.resolve(okContext()),
    createEvent: () =>
      Promise.resolve({ ok: false, status: 500, error: "unreached" } satisfies CreateEventResult),
  });

  const res = await POST(jsonRequest(validCreateBody));
  assert.equal(res.status, 401);
});

// ---- PATCH /api/events/[eventId] ----

const validUpdateBody = {
  organization_id: validCreateBody.organization_id,
  scope: "this_only" as const,
  updates: {
    title: "Updated Practice",
    description: "Moved to Field B",
    start_date: "2026-04-08",
    start_time: "10:00",
    end_date: "2026-04-08",
    end_time: "11:00",
    location: "Field B",
    event_type: "practice" as const,
    is_philanthropy: false,
  },
};

function patchRequest(body: unknown): Request {
  return new Request("https://example.com/api/events/event-1", {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

const patchParams = { params: Promise.resolve({ eventId: "event-1" }) };

test("PATCH /api/events/[eventId] updates an event on the happy path", async () => {
  let received: unknown;
  const PATCH = createUpdateEventHandler({
    createAuthenticatedApiClient: authClientStub,
    resolveAdminContext: () => Promise.resolve(okContext()),
    updateEvent: (input) => {
      received = input;
      return Promise.resolve({
        ok: true,
        event: { id: "event-1", title: "Updated Practice" },
        affectedEventIds: ["event-1"],
        syncWarnings: [],
      } satisfies UpdateEventResult);
    },
  });

  const res = await PATCH(patchRequest(validUpdateBody), patchParams);
  assert.equal(res.status, 200);
  const payload = (await res.json()) as { event: { id: string; title: string } };
  assert.equal(payload.event.title, "Updated Practice");

  const call = received as { eventId: string; orgId: string; scope: string; data: { title: string } };
  assert.equal(call.eventId, "event-1");
  assert.equal(call.orgId, validCreateBody.organization_id);
  assert.equal(call.scope, "this_only");
  assert.equal(call.data.title, "Updated Practice");
});

test("PATCH /api/events/[eventId] defaults scope to this_only when omitted", async () => {
  let received: { scope?: string } | undefined;
  const PATCH = createUpdateEventHandler({
    createAuthenticatedApiClient: authClientStub,
    resolveAdminContext: () => Promise.resolve(okContext()),
    updateEvent: (input) => {
      received = input;
      return Promise.resolve({
        ok: true,
        event: { id: "event-1", title: "Updated Practice" },
        affectedEventIds: ["event-1"],
        syncWarnings: [],
      } satisfies UpdateEventResult);
    },
  });

  const { scope, ...noScope } = validUpdateBody;
  void scope;
  const res = await PATCH(patchRequest(noScope), patchParams);
  assert.equal(res.status, 200);
  assert.equal(received?.scope, "this_only");
});

test("PATCH /api/events/[eventId] returns 403 for a non-admin caller", async () => {
  let updateCalled = false;
  const PATCH = createUpdateEventHandler({
    createAuthenticatedApiClient: authClientStub,
    resolveAdminContext: () => Promise.resolve({ ok: false, denial: "not_admin" }),
    updateEvent: () => {
      updateCalled = true;
      return Promise.resolve({ ok: false, status: 500, error: "unreached" } satisfies UpdateEventResult);
    },
  });

  const res = await PATCH(patchRequest(validUpdateBody), patchParams);
  assert.equal(res.status, 403);
  assert.equal(updateCalled, false);
});

test("PATCH /api/events/[eventId] returns 403 read-only when the org is frozen", async () => {
  let updateCalled = false;
  const PATCH = createUpdateEventHandler({
    createAuthenticatedApiClient: authClientStub,
    resolveAdminContext: () => Promise.resolve(readOnlyContext()),
    updateEvent: () => {
      updateCalled = true;
      return Promise.resolve({ ok: false, status: 500, error: "unreached" } satisfies UpdateEventResult);
    },
  });

  const res = await PATCH(patchRequest(validUpdateBody), patchParams);
  assert.equal(res.status, 403);
  const payload = (await res.json()) as { code?: string };
  assert.equal(payload.code, "ORG_READ_ONLY");
  assert.equal(updateCalled, false);
});

test("PATCH /api/events/[eventId] surfaces a 404 not-found from the lib", async () => {
  const PATCH = createUpdateEventHandler({
    createAuthenticatedApiClient: authClientStub,
    resolveAdminContext: () => Promise.resolve(okContext()),
    updateEvent: () =>
      Promise.resolve({ ok: false, status: 404, error: "Event not found" } satisfies UpdateEventResult),
  });

  const res = await PATCH(patchRequest(validUpdateBody), patchParams);
  assert.equal(res.status, 404);
  const payload = (await res.json()) as { error: string };
  assert.equal(payload.error, "Event not found");
});

// ---- Mobile full payload (extras + omitted is_philanthropy) ----

test("POST /api/events forwards mobile extras and omitted is_philanthropy to createEvent", async () => {
  let received: { input: Record<string, unknown> } | undefined;
  const POST = createCreateEventHandler({
    createAuthenticatedApiClient: authClientStub,
    createServiceClient: serviceClientStub,
    resolveAdminContext: () => Promise.resolve(okContext()),
    createEvent: (req) => {
      received = req as unknown as { input: Record<string, unknown> };
      return Promise.resolve({
        ok: true,
        status: 201,
        event: { id: "event-9", title: "Community Cleanup" },
        eventUrl: "",
      } satisfies CreateEventResult);
    },
  });

  // Full mobile payload: geofence + coordinates + audience + target_user_ids +
  // check_in_mode, and NO is_philanthropy (mobile omits it).
  const mobilePayload = {
    organization_id: "11111111-1111-4111-8111-111111111111",
    title: "Community Cleanup",
    start_date: "2026-05-01",
    start_time: "08:00",
    end_date: "2026-05-01",
    end_time: "12:00",
    location: "River Park",
    event_type: "philanthropy" as const,
    geofence_enabled: true,
    geofence_radius_m: 150,
    latitude: 40.7128,
    longitude: -74.006,
    audience: "both" as const,
    target_user_ids: ["22222222-2222-4222-8222-222222222222"],
    check_in_mode: "qr" as const,
  };

  const res = await POST(jsonRequest(mobilePayload));
  assert.equal(res.status, 200);

  const input = received!.input;
  // is_philanthropy is absent in the wire payload; the lib derives it.
  assert.equal("is_philanthropy" in input, false);
  // All mobile extras survive validation and reach the lib.
  assert.equal(input.geofence_enabled, true);
  assert.equal(input.geofence_radius_m, 150);
  assert.equal(input.latitude, 40.7128);
  assert.equal(input.longitude, -74.006);
  assert.equal(input.audience, "both");
  assert.deepEqual(input.target_user_ids, ["22222222-2222-4222-8222-222222222222"]);
  assert.equal(input.check_in_mode, "qr");
});

test("PATCH /api/events/[eventId] forwards partial updates with extras", async () => {
  let received: { data: Record<string, unknown> } | undefined;
  const PATCH = createUpdateEventHandler({
    createAuthenticatedApiClient: authClientStub,
    resolveAdminContext: () => Promise.resolve(okContext()),
    updateEvent: (input) => {
      received = input as unknown as { data: Record<string, unknown> };
      return Promise.resolve({
        ok: true,
        event: { id: "event-1", title: "unchanged" },
        affectedEventIds: ["event-1"],
        syncWarnings: [],
      } satisfies UpdateEventResult);
    },
  });

  // Partial PATCH: only check_in_mode + audience, no date/time, no title.
  const body = {
    organization_id: "11111111-1111-4111-8111-111111111111",
    updates: { check_in_mode: "rsvp" as const, audience: "members" as const },
  };
  const res = await PATCH(patchRequest(body), patchParams);
  assert.equal(res.status, 200);
  assert.equal(received!.data.check_in_mode, "rsvp");
  assert.equal(received!.data.audience, "members");
  assert.equal("title" in received!.data, false);
});
