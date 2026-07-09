import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runApiRateLimitCleanup } from "../../../src/app/api/cron/api-rate-limit-cleanup/route.ts";

function createCleanupClient(responses: Array<number | { message: string }>) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      async rpc(fn: "purge_expired_api_rate_limit_buckets") {
        calls.push(fn);
        const response = responses.shift() ?? 0;
        if (typeof response === "object") {
          return { data: null, error: response };
        }
        return { data: response, error: null };
      },
    },
  };
}

describe("api-rate-limit-cleanup cron helper", () => {
  it("drains full batches until a partial batch is returned", async () => {
    const { client, calls } = createCleanupClient([500, 500, 120]);

    const result = await runApiRateLimitCleanup(client);

    assert.deepEqual(result, {
      ok: true,
      deletedCount: 1_120,
      batches: 3,
      capped: false,
    });
    assert.deepEqual(calls, [
      "purge_expired_api_rate_limit_buckets",
      "purge_expired_api_rate_limit_buckets",
      "purge_expired_api_rate_limit_buckets",
    ]);
  });

  it("stops at the per-run cap when every batch is full", async () => {
    const { client, calls } = createCleanupClient(Array.from({ length: 20 }, () => 500));

    const result = await runApiRateLimitCleanup(client);

    assert.deepEqual(result, {
      ok: true,
      deletedCount: 5_000,
      batches: 10,
      capped: true,
    });
    assert.equal(calls.length, 10);
  });

  it("returns an error result without continuing after an RPC failure", async () => {
    const { client, calls } = createCleanupClient([500, { message: "function not found" }, 500]);

    const result = await runApiRateLimitCleanup(client);

    assert.deepEqual(result, {
      ok: false,
      error: "Purge failed",
      details: "function not found",
    });
    assert.equal(calls.length, 2);
  });

  it("counts a null RPC result as zero deleted rows", async () => {
    const calls: string[] = [];
    const result = await runApiRateLimitCleanup({
      async rpc(fn: "purge_expired_api_rate_limit_buckets") {
        calls.push(fn);
        return { data: null, error: null };
      },
    });

    assert.deepEqual(result, {
      ok: true,
      deletedCount: 0,
      batches: 1,
      capped: false,
    });
    assert.equal(calls.length, 1);
  });
});
