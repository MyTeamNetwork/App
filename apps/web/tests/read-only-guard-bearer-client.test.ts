/**
 * checkOrgReadOnly must use the caller-provided request-scoped client.
 *
 * Bearer-authenticated requests (mobile) carry no cookies; the default
 * cookie SSR client is anonymous for them, the get_subscription_status
 * RPC's EXECUTE grant is `authenticated`-only, and the guard's fail-closed
 * path then reports every active org as read-only. Passing the request
 * client is the fix — these tests lock that the injected client is what
 * actually performs the RPC, and that fail-closed behavior is preserved.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { checkOrgReadOnly } from "@/lib/subscription/read-only-guard";
import type { ServerSupabase } from "@/lib/supabase/types";

function makeRpcClient(result: { data: unknown; error: unknown }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    rpc(fn: string, args: unknown) {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  } as unknown as ServerSupabase;
  return { client, calls };
}

test("uses the injected client for the subscription RPC", async () => {
  const { client, calls } = makeRpcClient({
    data: [
      {
        status: "active",
        grace_period_ends_at: null,
        current_period_end: "2099-01-01T00:00:00Z",
      },
    ],
    error: null,
  });

  const result = await checkOrgReadOnly("org-1", client);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, "get_subscription_status");
  assert.deepEqual(calls[0].args, { p_org_id: "org-1" });
  assert.equal(result.isReadOnly, false);
  assert.equal(result.subscription?.status, "active");
});

test("still fails closed when the injected client's RPC errors", async () => {
  const { client } = makeRpcClient({
    data: null,
    error: { message: "permission denied for function get_subscription_status" },
  });

  const result = await checkOrgReadOnly("org-1", client);

  assert.equal(result.isReadOnly, true);
  assert.equal(result.subscription, null);
  assert.match(result.error ?? "", /permission denied/);
});
