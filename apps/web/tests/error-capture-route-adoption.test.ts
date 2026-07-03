import { afterEach, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import { setCaptureTransportForTesting } from "@/lib/errors/sanitize";
import type { CaptureErrorParams } from "@/lib/errors/server";

/**
 * U8 — bounded non-org route adoption of the capture pipeline.
 *
 * Proves end-to-end that a converted route's catch block forwards its caught
 * error through the U7 sanitization boundary (`setCaptureTransportForTesting`
 * seam) — no module mocking, which the node:test runner does not support.
 *
 * Driving vehicle: the account-deletion cron (`api/cron/account-deletion`).
 * With CRON_SECRET set the auth gate passes; with the Supabase service env
 * absent, `createServiceClient()` throws inside the try, exercising the outer
 * catch we instrumented. The HTTP response contract (500 + the route's exact
 * body) must stay identical.
 */

const CRON_SECRET = "test-cron-secret-u8";

let cronGet: (request: Request) => Promise<Response>;

before(async () => {
  process.env.CRON_SECRET = CRON_SECRET;
  // Ensure the service client construction fails deterministically inside the
  // try block (missing env → getSupabaseServiceEnv throws) so we land in catch.
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  ({ GET: cronGet } = await import(
    "@/app/api/cron/account-deletion/route"
  ));
});

function installRecorder(): CaptureErrorParams[] {
  const captured: CaptureErrorParams[] = [];
  setCaptureTransportForTesting(async (params) => {
    captured.push(params);
  });
  return captured;
}

function authedCronRequest(): Request {
  return new Request("https://example.com/api/cron/account-deletion", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

afterEach(() => {
  setCaptureTransportForTesting(null);
  mock.restoreAll();
});

describe("account-deletion cron capture adoption", () => {
  it("forwards a forced failure into the capture pipeline without changing the 500 contract", async () => {
    // Console noise from the route's own console.error is expected here.
    mock.method(console, "error", () => {});
    const captured = installRecorder();

    const res = await cronGet(authedCronRequest());

    // Contract unchanged: same status + same hand-rolled body as before U8.
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), {
      error: "Failed to process account deletions",
    });

    // The caught error reached the sanitization boundary exactly once, tagged
    // with the route's module and bounded.
    assert.equal(captured.length, 1);
    assert.equal(captured[0].meta?.module, "api:cron/account-deletion");
    assert.ok(captured[0].message.length <= 500);
    assert.ok(!captured[0].message.includes("\n"));
  });

  it("does not capture when the cron auth gate rejects (pre-try short-circuit)", async () => {
    const captured = installRecorder();

    const res = await cronGet(
      new Request("https://example.com/api/cron/account-deletion", {
        headers: { authorization: "Bearer wrong" },
      }),
    );

    assert.equal(res.status, 401);
    assert.equal(captured.length, 0);
  });
});
