import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  checkRateLimit,
  resetRateLimitStore,
  setRateLimitRpcClient,
  type RateLimitRpcClient,
} from "../src/lib/security/rate-limit.ts";

/**
 * Fake durable store: a shared Map standing in for the api_rate_limit_buckets
 * table, keyed by `${bucketKey}|${windowIndex}`. Each fake client mimics the
 * SQL upsert semantics of check_api_rate_limit:
 *   INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 WHERE count < limit
 * i.e. an atomic read-check-increment per scope, fixed window floored to the
 * window size.
 */
type FakeDb = Map<string, number>;

function createFakeDb(): FakeDb {
  return new Map();
}

function createFakeRpcClient(
  db: FakeDb,
  options: { delayMs?: () => number; onCall?: (args: unknown) => void } = {},
): RateLimitRpcClient {
  return {
    async rpc(_fn, args) {
      options.onCall?.(args);
      // Simulate the network hop so parallel callers interleave like real
      // requests would. The read-check-increment below stays synchronous —
      // that is the atomicity the SQL statement guarantees.
      const delay = options.delayMs?.() ?? 0;
      await new Promise((resolve) => setTimeout(resolve, delay));

      const windowIndex = Math.floor(Date.now() / args.p_window_ms);
      const resetAtMs = (windowIndex + 1) * args.p_window_ms;

      const data = args.p_scopes.map(({ key, limit }) => {
        const bucket = `${key}|${windowIndex}`;
        const current = db.get(bucket) ?? 0;
        if (current >= limit) {
          return { key, allowed: false, limit, remaining: 0, reset_at_ms: resetAtMs };
        }
        const next = current + 1;
        db.set(bucket, next);
        return {
          key,
          allowed: true,
          limit,
          remaining: Math.max(limit - next, 0),
          reset_at_ms: resetAtMs,
        };
      });

      return { data, error: null };
    },
  };
}

function createNeverResolvingRpcClient(options: { onCall?: () => void } = {}): RateLimitRpcClient {
  return {
    rpc() {
      options.onCall?.();
      return new Promise(() => {});
    },
  };
}

function createDeferredRpcClient(options: { onCall?: () => void } = {}): {
  client: RateLimitRpcClient;
  resolve: (value: { data: unknown; error: { message: string } | null }) => void;
} {
  let resolve!: (value: { data: unknown; error: { message: string } | null }) => void;
  const promise = new Promise<{ data: unknown; error: { message: string } | null }>((res) => {
    resolve = res;
  });
  return {
    client: {
      rpc() {
        options.onCall?.();
        return promise;
      },
    },
    resolve,
  };
}

function makeRequest(ip: string, path = "/api/test") {
  return new Request(`https://example.com${path}`, {
    headers: { "x-forwarded-for": ip },
  });
}

function withSilencedConsoleError<T>(fn: (calls: unknown[][]) => Promise<T>): Promise<T> {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  return fn(calls).finally(() => {
    console.error = original;
  });
}

test("durable store: allows under the limit with decrementing remaining", async () => {
  resetRateLimitStore();
  setRateLimitRpcClient(createFakeRpcClient(createFakeDb()));

  const limit = 5;
  for (let i = 1; i <= limit; i += 1) {
    const result = await checkRateLimit(makeRequest("10.0.0.1"), { limitPerIp: limit });
    assert.strictEqual(result.ok, true, `request ${i} should be allowed`);
    assert.strictEqual(result.remaining, limit - i, `remaining after request ${i}`);
    assert.strictEqual(result.headers["X-RateLimit-Limit"], String(limit));
    assert.strictEqual(result.headers["X-RateLimit-Remaining"], String(limit - i));
  }
});

test("durable store: blocks over the limit with retryAfterSeconds and Retry-After header", async () => {
  resetRateLimitStore();
  setRateLimitRpcClient(createFakeRpcClient(createFakeDb()));

  const limit = 3;
  const windowMs = 60_000;
  for (let i = 0; i < limit; i += 1) {
    const result = await checkRateLimit(makeRequest("10.0.0.2"), { limitPerIp: limit, windowMs });
    assert.strictEqual(result.ok, true);
  }

  const blocked = await checkRateLimit(makeRequest("10.0.0.2"), {
    limitPerIp: limit,
    windowMs,
    feature: "the test endpoint",
  });
  assert.strictEqual(blocked.ok, false, "request over the limit should be blocked");
  assert.strictEqual(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSeconds >= 1, "retryAfterSeconds should be at least 1");
  assert.ok(
    blocked.retryAfterSeconds <= Math.ceil(windowMs / 1000),
    "retryAfterSeconds should not exceed the window",
  );
  assert.strictEqual(blocked.headers["Retry-After"], String(blocked.retryAfterSeconds));
  assert.match(blocked.reason, /the test endpoint/);
  assert.ok(blocked.resetAt > Date.now(), "resetAt should be in the future");
});

test("durable store: all applicable scopes evaluated in a single RPC call", async () => {
  resetRateLimitStore();
  const db = createFakeDb();
  const rpcCalls: Array<{ p_scopes: Array<{ key: string; limit: number }>; p_window_ms: number }> = [];
  setRateLimitRpcClient(
    createFakeRpcClient(db, {
      onCall: (args) => rpcCalls.push(args as (typeof rpcCalls)[number]),
    }),
  );

  const config = { limitPerIp: 100, limitPerUser: 2, userId: "user-1" };

  const first = await checkRateLimit(makeRequest("10.0.0.3"), config);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(rpcCalls.length, 1, "one request must produce exactly one RPC round trip");
  assert.deepStrictEqual(
    rpcCalls[0].p_scopes.map((s) => s.key),
    ["ip:/api/test:10.0.0.3", "user:/api/test:user-1"],
    "both scopes travel in the same call with derived keys",
  );

  await checkRateLimit(makeRequest("10.0.0.3"), config);
  const blocked = await checkRateLimit(makeRequest("10.0.0.3"), config);
  assert.strictEqual(blocked.ok, false, "exhausted user scope blocks even though ip scope is fine");
  assert.strictEqual(rpcCalls.length, 3);
});

test("distributed correctness: two adapter instances sharing the DB enforce the combined limit", async () => {
  const db = createFakeDb();
  const instanceA = createFakeRpcClient(db);
  const instanceB = createFakeRpcClient(db);
  const limit = 4;

  // Alternate between two separately-constructed clients (two serverless
  // instances) sharing one database. Clear the in-memory fallback before every
  // call to prove enforcement comes from the shared store, not the local Map.
  const instances = [instanceA, instanceB, instanceA, instanceB];
  for (let i = 0; i < limit; i += 1) {
    resetRateLimitStore();
    setRateLimitRpcClient(instances[i]);
    const result = await checkRateLimit(makeRequest("10.0.0.4"), { limitPerIp: limit });
    assert.strictEqual(result.ok, true, `request ${i + 1} across instances should be allowed`);
  }

  resetRateLimitStore();
  setRateLimitRpcClient(instanceB);
  const blocked = await checkRateLimit(makeRequest("10.0.0.4"), { limitPerIp: limit });
  assert.strictEqual(
    blocked.ok,
    false,
    "combined limit must hold across instances even with a cold local store",
  );
});

test("concurrency: parallel requests at the boundary admit at most the limit", async () => {
  resetRateLimitStore();
  const db = createFakeDb();
  setRateLimitRpcClient(
    createFakeRpcClient(db, { delayMs: () => Math.floor(Math.random() * 5) }),
  );

  const limit = 10;
  const attempts = 25;
  const results = await Promise.all(
    Array.from({ length: attempts }, () =>
      checkRateLimit(makeRequest("10.0.0.5"), { limitPerIp: limit }),
    ),
  );

  const admitted = results.filter((r) => r.ok).length;
  assert.strictEqual(admitted, limit, "exactly `limit` requests may pass at the boundary");
  assert.strictEqual(results.filter((r) => !r.ok).length, attempts - limit);
});

test("RPC error: falls back to the in-memory store, logs, and never throws", async () => {
  await withSilencedConsoleError(async (errorCalls) => {
    resetRateLimitStore();
    setRateLimitRpcClient({
      async rpc() {
        return { data: null, error: { message: 'relation "api_rate_limit_buckets" does not exist' } };
      },
    });

    const limit = 2;
    const first = await checkRateLimit(makeRequest("10.0.0.6"), { limitPerIp: limit });
    assert.strictEqual(first.ok, true, "fallback path must still serve a result");
    assert.strictEqual(first.remaining, limit - 1);

    await checkRateLimit(makeRequest("10.0.0.6"), { limitPerIp: limit });
    const blocked = await checkRateLimit(makeRequest("10.0.0.6"), { limitPerIp: limit });
    assert.strictEqual(blocked.ok, false, "in-memory fallback still enforces per-instance limits");

    assert.ok(errorCalls.length >= 1, "fallback must be logged with context");
  });
});

test("RPC throw: falls back to the in-memory store and never throws", async () => {
  await withSilencedConsoleError(async (errorCalls) => {
    resetRateLimitStore();
    setRateLimitRpcClient({
      async rpc() {
        throw new Error("network unreachable");
      },
    });

    const result = await checkRateLimit(makeRequest("10.0.0.7"), { limitPerIp: 5 });
    assert.strictEqual(result.ok, true, "a throwing RPC must not surface to the caller");
    assert.ok(errorCalls.length >= 1, "the thrown error must be logged");
  });
});

test("malformed RPC payload: falls back to the in-memory store", async () => {
  await withSilencedConsoleError(async (errorCalls) => {
    resetRateLimitStore();
    setRateLimitRpcClient({
      async rpc() {
        return { data: [{ nonsense: true }], error: null };
      },
    });

    const result = await checkRateLimit(makeRequest("10.0.0.8"), { limitPerIp: 5 });
    assert.strictEqual(result.ok, true);
    assert.ok(errorCalls.length >= 1, "malformed payloads must be logged");
  });
});

test("RPC timeout: never-resolving durable calls fall back quickly", async () => {
  await withSilencedConsoleError(async (errorCalls) => {
    resetRateLimitStore();
    let rpcCalls = 0;
    setRateLimitRpcClient(createNeverResolvingRpcClient({ onCall: () => { rpcCalls += 1; } }));

    const startedAt = Date.now();
    const result = await Promise.race([
      checkRateLimit(makeRequest("10.0.0.20"), { limitPerIp: 2 }),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 1_000)),
    ]);

    assert.notStrictEqual(result, "hung", "rate limiter must not wait indefinitely on RPC");
    assert.strictEqual(typeof result, "object");
    assert.strictEqual(result.ok, true, "fallback path must still serve a result");
    assert.ok(Date.now() - startedAt < 1_000, "fallback should happen inside the test budget");
    assert.strictEqual(rpcCalls, 1);
    assert.ok(errorCalls.length >= 1, "timeouts must be logged");
  });
});

test("RPC timeout: late resolution after fallback is harmless", async () => {
  await withSilencedConsoleError(async () => {
    resetRateLimitStore();
    const deferred = createDeferredRpcClient();
    let rpcCalls = 0;
    setRateLimitRpcClient({
      rpc(fn, args) {
        rpcCalls += 1;
        if (rpcCalls === 1) {
          return deferred.client.rpc(fn, args);
        }
        return new Promise(() => {});
      },
    });

    const result = await checkRateLimit(makeRequest("10.0.0.21"), { limitPerIp: 2 });
    assert.strictEqual(result.ok, true, "timeout should fall back before the RPC resolves");
    assert.strictEqual(result.remaining, 1);

    deferred.resolve({
      data: [{ key: "ip:/api/test:10.0.0.21", allowed: false, remaining: 0, reset_at_ms: Date.now() + 60_000 }],
      error: null,
    });

    const fallbackSecond = await checkRateLimit(makeRequest("10.0.0.21"), { limitPerIp: 2 });
    assert.strictEqual(fallbackSecond.ok, true, "late durable resolution must not mutate fallback state");
    assert.strictEqual(fallbackSecond.remaining, 0);
    assert.strictEqual(rpcCalls, 2);
  });
});

test("RPC timeout: repeated failures open a short local circuit", async () => {
  await withSilencedConsoleError(async () => {
    resetRateLimitStore();
    let rpcCalls = 0;
    setRateLimitRpcClient(createNeverResolvingRpcClient({ onCall: () => { rpcCalls += 1; } }));

    await checkRateLimit(makeRequest("10.0.0.22"), { limitPerIp: 10 });
    await checkRateLimit(makeRequest("10.0.0.23"), { limitPerIp: 10 });
    assert.strictEqual(rpcCalls, 2, "the first two failures should attempt the RPC");

    const startedAt = Date.now();
    const result = await checkRateLimit(makeRequest("10.0.0.24"), { limitPerIp: 10 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(rpcCalls, 2, "open circuit must skip the durable RPC");
    assert.ok(Date.now() - startedAt < 50, "open circuit fallback should be immediate");
  });
});

test("RPC circuit: successful durable response after the open window resets failure state", async () => {
  await withSilencedConsoleError(async () => {
    resetRateLimitStore();
    let rpcCalls = 0;
    setRateLimitRpcClient(createNeverResolvingRpcClient({ onCall: () => { rpcCalls += 1; } }));
    await checkRateLimit(makeRequest("10.0.0.25"), { limitPerIp: 10 });
    await checkRateLimit(makeRequest("10.0.0.26"), { limitPerIp: 10 });
    await checkRateLimit(makeRequest("10.0.0.27"), { limitPerIp: 10 });
    assert.strictEqual(rpcCalls, 2, "third request should be short-circuited");

    await new Promise((resolve) => setTimeout(resolve, 325));

    const db = createFakeDb();
    let healthyRpcCalls = 0;
    setRateLimitRpcClient(createFakeRpcClient(db, { onCall: () => { healthyRpcCalls += 1; } }));

    const first = await checkRateLimit(makeRequest("10.0.0.28"), { limitPerIp: 1 });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(healthyRpcCalls, 1, "durable path should be retried after circuit window");

    resetRateLimitStore();
    const blocked = await checkRateLimit(makeRequest("10.0.0.28"), { limitPerIp: 1 });
    assert.strictEqual(blocked.ok, false, "healthy durable path should enforce across fallback resets");
    assert.strictEqual(healthyRpcCalls, 2);
  });
});

test("RPC timeout fallback enforces per-instance limits and 429 headers", async () => {
  await withSilencedConsoleError(async () => {
    resetRateLimitStore();
    setRateLimitRpcClient(createNeverResolvingRpcClient());

    const config = { limitPerIp: 1, feature: "the timeout test endpoint" };
    const first = await checkRateLimit(makeRequest("10.0.0.29"), config);
    assert.strictEqual(first.ok, true);

    const blocked = await checkRateLimit(makeRequest("10.0.0.29"), config);
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.headers["X-RateLimit-Limit"], "1");
    assert.strictEqual(blocked.headers["X-RateLimit-Remaining"], "0");
    assert.strictEqual(blocked.headers["Retry-After"], String(blocked.retryAfterSeconds));
    assert.match(blocked.reason, /timeout test endpoint/);
  });
});

test("window rollover: a new fixed window admits requests again", async () => {
  resetRateLimitStore();
  setRateLimitRpcClient(createFakeRpcClient(createFakeDb()));

  const windowMs = 250;
  const config = { limitPerIp: 1, windowMs };

  const first = await checkRateLimit(makeRequest("10.0.0.9"), config);
  assert.strictEqual(first.ok, true);

  const second = await checkRateLimit(makeRequest("10.0.0.9"), config);
  assert.strictEqual(second.ok, false, "same window must be exhausted");

  await new Promise((resolve) => setTimeout(resolve, windowMs + 25));

  const third = await checkRateLimit(makeRequest("10.0.0.9"), config);
  assert.strictEqual(third.ok, true, "next fixed window must admit requests again");
});

test("resetRateLimitStore clears only the in-memory fallback, not the durable store", async () => {
  await withSilencedConsoleError(async () => {
    // Fallback mode: reset actually clears state.
    resetRateLimitStore();
    setRateLimitRpcClient({
      async rpc() {
        return { data: null, error: { message: "unavailable" } };
      },
    });
    const limit = 1;
    const first = await checkRateLimit(makeRequest("10.0.0.10"), { limitPerIp: limit });
    assert.strictEqual(first.ok, true);
    const blocked = await checkRateLimit(makeRequest("10.0.0.10"), { limitPerIp: limit });
    assert.strictEqual(blocked.ok, false);
    resetRateLimitStore();
    const afterReset = await checkRateLimit(makeRequest("10.0.0.10"), { limitPerIp: limit });
    assert.strictEqual(afterReset.ok, true, "reset clears the in-memory fallback");
  });

  // Durable mode: reset is a no-op for the DB side.
  const db = createFakeDb();
  setRateLimitRpcClient(createFakeRpcClient(db));
  const durable = await checkRateLimit(makeRequest("10.0.0.11"), { limitPerIp: 1 });
  assert.strictEqual(durable.ok, true);
  resetRateLimitStore();
  const stillBlocked = await checkRateLimit(makeRequest("10.0.0.11"), { limitPerIp: 1 });
  assert.strictEqual(stillBlocked.ok, false, "durable buckets survive resetRateLimitStore");
});

test("kill-switch: RATE_LIMIT_DISABLE_RPC forces the in-memory path when no client is injected", async () => {
  // The test bootstrap (register-ts-loader.mjs) sets RATE_LIMIT_DISABLE_RPC=1
  // and RATE_LIMIT_TEST_ENV=1. Runtime code requires both signals, so this
  // kill switch cannot silently disable durable enforcement in production.
  // process-wide, so with no injected client checkRateLimit must never reach
  // the durable RPC. Proof: resetRateLimitStore() clears the enforcement
  // state — which is only true for the in-memory fallback (durable buckets
  // survive a reset, as the previous test asserts).
  assert.strictEqual(
    process.env.RATE_LIMIT_DISABLE_RPC,
    "1",
    "the test bootstrap must set the kill-switch",
  );
  assert.strictEqual(
    process.env.RATE_LIMIT_TEST_ENV,
    "1",
    "the test bootstrap must mark the process as test-only",
  );
  setRateLimitRpcClient(null); // clear any injection: default resolution + kill-switch
  resetRateLimitStore();

  const limit = 1;
  const first = await checkRateLimit(makeRequest("10.0.0.12"), { limitPerIp: limit });
  assert.strictEqual(first.ok, true);
  const blocked = await checkRateLimit(makeRequest("10.0.0.12"), { limitPerIp: limit });
  assert.strictEqual(blocked.ok, false, "in-memory path enforces the per-instance limit");

  resetRateLimitStore();
  const afterReset = await checkRateLimit(makeRequest("10.0.0.12"), { limitPerIp: limit });
  assert.strictEqual(
    afterReset.ok,
    true,
    "reset clears the bucket, proving the durable RPC path was never taken",
  );
});

test("kill-switch: an explicitly injected client overrides RATE_LIMIT_DISABLE_RPC", async () => {
  assert.strictEqual(process.env.RATE_LIMIT_DISABLE_RPC, "1");
  resetRateLimitStore();

  let rpcCalls = 0;
  const db = createFakeDb();
  setRateLimitRpcClient(createFakeRpcClient(db, { onCall: () => { rpcCalls += 1; } }));

  const durable = await checkRateLimit(makeRequest("10.0.0.13"), { limitPerIp: 1 });
  assert.strictEqual(durable.ok, true);
  assert.strictEqual(rpcCalls, 1, "injection must win over the kill-switch and hit the RPC");

  // Durable enforcement holds across a reset (in-memory reset does not touch
  // the shared fake DB), confirming the injected durable path really ran.
  resetRateLimitStore();
  const stillBlocked = await checkRateLimit(makeRequest("10.0.0.13"), { limitPerIp: 1 });
  assert.strictEqual(stillBlocked.ok, false, "durable bucket survives resetRateLimitStore");
  assert.strictEqual(rpcCalls, 2);

  setRateLimitRpcClient(null); // restore default resolution for later suites
});

test("kill-switch: production-visible env var alone is not enough to disable RPC", () => {
  const source = readFileSync(
    new URL("../src/lib/security/rate-limit.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /process\.env\.RATE_LIMIT_DISABLE_RPC === "1"/);
  assert.match(source, /process\.env\.RATE_LIMIT_TEST_ENV === "1"/);
  assert.doesNotMatch(source, /if \(process\.env\.RATE_LIMIT_DISABLE_RPC\) return null/);
});

test("kill-switch: non-enabled values do not disable an injected durable client", async () => {
  const previous = process.env.RATE_LIMIT_DISABLE_RPC;
  process.env.RATE_LIMIT_DISABLE_RPC = "0";
  try {
    resetRateLimitStore();
    let rpcCalls = 0;
    setRateLimitRpcClient(
      createFakeRpcClient(createFakeDb(), { onCall: () => { rpcCalls += 1; } }),
    );

    const result = await checkRateLimit(makeRequest("10.0.0.14"), { limitPerIp: 1 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(rpcCalls, 1, "RATE_LIMIT_DISABLE_RPC=0 must not disable durable RPC calls");
  } finally {
    if (previous === undefined) {
      delete process.env.RATE_LIMIT_DISABLE_RPC;
    } else {
      process.env.RATE_LIMIT_DISABLE_RPC = previous;
    }
    setRateLimitRpcClient(null);
  }
});
