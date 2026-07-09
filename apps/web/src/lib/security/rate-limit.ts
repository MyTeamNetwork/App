/**
 * Rate limiter with a durable Postgres-backed fixed-window store.
 *
 * Primary path: a single `check_api_rate_limit` RPC per request evaluates
 * every applicable scope (ip/user/org) atomically in the database
 * (INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit), so limits hold
 * across serverless instances. See
 * supabase/migrations/20270102000000_api_rate_limit_buckets.sql.
 *
 * Fallback path: if the RPC is unavailable (missing service env, network
 * failure, migration not applied), the legacy in-memory Map takes over.
 * The fallback is per-instance only — burst protection, not distributed
 * enforcement — and every fallback is logged.
 *
 * NOTE — Database-level correctness:
 * For the enterprise invites system, database constraints (advisory locks,
 * CHECK constraints) remain the real enforcement layer regardless of which
 * store handles the rate limit.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

type RequestLike = Request | NextRequest;

type BucketState = {
  count: number;
  resetAt: number;
};

type ConsumeResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
  reason: string;
  headers: Record<string, string>;
};

type RateLimitConfig = {
  limitPerIp?: number;
  limitPerUser?: number;
  limitPerOrg?: number;
  windowMs?: number;
  pathOverride?: string;
  userId?: string | null;
  orgId?: string | null;
  feature?: string;
};

type RateLimitScope = "ip" | "user" | "org";

type ScopeCheck = {
  scope: RateLimitScope;
  key: string;
  limit: number;
};

type ScopeResult = ConsumeResult & { scope: RateLimitScope };

type RpcScopeResult = {
  key: string;
  allowed: boolean;
  remaining: number;
  reset_at_ms: number;
};

/**
 * Minimal structural contract for the durable store's RPC client. Matches
 * supabase-js `.rpc()` so the service-role client satisfies it via cast, and
 * tests can inject an in-memory fake through `setRateLimitRpcClient`.
 */
export type RateLimitRpcClient = {
  rpc(
    fn: "check_api_rate_limit",
    args: {
      p_scopes: Array<{ key: string; limit: number }>;
      p_window_ms: number;
    },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

declare global {
  // eslint-disable-next-line no-var
  var __rateLimitStore: Map<string, BucketState> | undefined;
}

const store = globalThis.__rateLimitStore ?? new Map<string, BucketState>();
globalThis.__rateLimitStore = store;
const DEFAULT_WINDOW_MS = 60_000; // 1 minute windows keep retry feedback tight
const DEFAULT_IP_LIMIT = 60; // 60 req/min/IP
const DEFAULT_USER_LIMIT = 45; // 45 req/min/user
const CLEANUP_THRESHOLD = 5_000;
const STORE_MAX_SIZE = 10_000;
const CLEANUP_SCAN_LIMIT = 1_000;
const RPC_TIMEOUT_MS = 150;
const RPC_CIRCUIT_FAILURE_THRESHOLD = 2;
const RPC_CIRCUIT_OPEN_MS = 300;

// How long to keep serving the in-memory fallback after a failed service-client
// construction before retrying. A cold-start env hiccup must not permanently
// downgrade an instance to non-distributed rate limiting.
const RPC_CLIENT_RETRY_MS = 60_000;

let injectedRpcClient: RateLimitRpcClient | null = null;
let defaultRpcClient: RateLimitRpcClient | null = null;
// Timestamp (ms) of the most recent failed default-client construction, or null
// if we have never failed. Cleared on success; a retry is attempted once
// RPC_CLIENT_RETRY_MS has elapsed since the failure.
let defaultRpcClientFailedAt: number | null = null;
let durableRpcFailureCount = 0;
let durableRpcCircuitOpenUntil = 0;

/**
 * Test seam: inject a fake RPC client for the durable store. Pass `null` to
 * restore the default service-role client resolution.
 */
export function setRateLimitRpcClient(client: RateLimitRpcClient | null) {
  injectedRpcClient = client;
}

/**
 * Clears the in-memory fallback store. Intentionally a no-op for the durable
 * Postgres store: tests exercise the DB path through an injected fake client
 * (whose state they own), and production rows are pruned by the
 * /api/cron/api-rate-limit-cleanup job.
 */
export function resetRateLimitStore() {
  store.clear();
  durableRpcFailureCount = 0;
  durableRpcCircuitOpenUntil = 0;
}

function getRpcClient(): RateLimitRpcClient | null {
  // An explicitly injected client always wins, so RATE_LIMIT_DISABLE_RPC never
  // defeats a test that opts into the durable path via setRateLimitRpcClient.
  if (injectedRpcClient) return injectedRpcClient;

  // Suite-wide kill-switch: skip the network RPC entirely and use the in-memory
  // path. Set in the test bootstrap so no suite makes live Supabase RPC calls
  // even when CI injects real service-role credentials.
  if (isRateLimitRpcDisabledForTests()) return null;

  if (defaultRpcClient) return defaultRpcClient;

  // A prior construction failed: keep serving the in-memory fallback until the
  // retry window elapses, then try again (a cold-start hiccup must not stick).
  if (
    defaultRpcClientFailedAt !== null &&
    Date.now() - defaultRpcClientFailedAt < RPC_CLIENT_RETRY_MS
  ) {
    return null;
  }

  try {
    // Cast: check_api_rate_limit is not yet in the generated Database types
    // (they are regenerated once the migration is applied). The structural
    // RateLimitRpcClient contract matches supabase-js `.rpc()`.
    defaultRpcClient = createServiceClient() as unknown as RateLimitRpcClient;
    defaultRpcClientFailedAt = null;
    return defaultRpcClient;
  } catch (err) {
    defaultRpcClientFailedAt = Date.now();
    // TODO(U7): route through captureException once error-capture wiring lands.
    console.error(
      "[rate-limit] service client unavailable; using in-memory fallback store",
      err,
    );
    return null;
  }
}

function isRateLimitRpcDisabledForTests(): boolean {
  return (
    process.env.RATE_LIMIT_DISABLE_RPC === "1" &&
    process.env.RATE_LIMIT_TEST_ENV === "1"
  );
}

class RateLimitRpcTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`check_api_rate_limit RPC timed out after ${timeoutMs}ms`);
    this.name = "RateLimitRpcTimeoutError";
  }
}

async function withRpcTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new RateLimitRpcTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isDurableRpcCircuitOpen(now: number): boolean {
  return durableRpcCircuitOpenUntil > now;
}

function recordDurableRpcSuccess() {
  durableRpcFailureCount = 0;
  durableRpcCircuitOpenUntil = 0;
}

function recordDurableRpcFailure(now: number) {
  durableRpcFailureCount += 1;
  if (durableRpcFailureCount >= RPC_CIRCUIT_FAILURE_THRESHOLD) {
    durableRpcCircuitOpenUntil = now + RPC_CIRCUIT_OPEN_MS;
  }
}

function cleanupExpired(now: number) {
  if (store.size < CLEANUP_THRESHOLD) return;
  let scanned = 0;
  for (const [key, state] of store) {
    if (state.resetAt <= now) {
      store.delete(key);
    }
    scanned += 1;
    if (scanned >= CLEANUP_SCAN_LIMIT) break;
  }
}

function enforceStoreLimit() {
  if (store.size <= STORE_MAX_SIZE) return;
  const overflow = store.size - STORE_MAX_SIZE;
  const targetEvictions = Math.max(overflow, Math.ceil(STORE_MAX_SIZE * 0.1));
  let evicted = 0;
  for (const key of store.keys()) {
    store.delete(key);
    evicted += 1;
    if (evicted >= targetEvictions) break;
  }
}

/**
 * Best-effort client IP from the standard proxy headers, in the same
 * precedence the rate limiter uses. Exported so unauthenticated endpoints can
 * attach the caller IP to structured failure logs without re-deriving it.
 */
export function deriveClientIp(request: RequestLike): string | null {
  const headers = request.headers;

  // Cloudflare (most reliable when using CF)
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  // Vercel/standard proxy
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  // True-Client-IP (some CDNs)
  const trueClientIp = headers.get("true-client-ip");
  if (trueClientIp) return trueClientIp.trim();

  // x-real-ip (nginx)
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  // NextRequest.ip fallback
  const maybeNextRequest = request as Request & { ip?: string | null };
  if (typeof maybeNextRequest.ip === "string" && maybeNextRequest.ip) {
    return maybeNextRequest.ip;
  }

  return null;
}

function consume(key: string, limit: number, windowMs: number, now: number): ConsumeResult {
  cleanupExpired(now);
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    enforceStoreLimit();
    return {
      ok: true,
      limit,
      remaining: Math.max(limit - 1, 0),
      resetAt,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  // Refresh LRU position
  store.delete(key);
  store.set(key, current);

  if (current.count >= limit) {
    return {
      ok: false,
      limit,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  const nextCount = current.count + 1;
  store.set(key, { ...current, count: nextCount });
  enforceStoreLimit();

  return {
    ok: true,
    limit,
    remaining: Math.max(limit - nextCount, 0),
    resetAt: current.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

function parseRpcScopeResults(data: unknown): RpcScopeResult[] | null {
  if (!Array.isArray(data)) return null;
  const rows: RpcScopeResult[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (
      typeof row.key !== "string" ||
      typeof row.allowed !== "boolean" ||
      typeof row.remaining !== "number" ||
      typeof row.reset_at_ms !== "number"
    ) {
      return null;
    }
    rows.push({
      key: row.key,
      allowed: row.allowed,
      remaining: row.remaining,
      reset_at_ms: row.reset_at_ms,
    });
  }
  return rows;
}

/**
 * Evaluates all scopes against the durable Postgres store in one RPC round
 * trip. Returns `null` on any failure (logged, never thrown) so the caller
 * can fall back to the in-memory store.
 */
async function checkScopesDurably(
  scopes: ScopeCheck[],
  windowMs: number,
  now: number,
): Promise<ScopeResult[] | null> {
  const client = getRpcClient();
  if (!client) return null;
  if (isDurableRpcCircuitOpen(now)) return null;

  // Deliberately no bucket keys in logs below — they embed IPs and user ids.
  const logContext = { scopes: scopes.map((s) => s.scope), windowMs };

  try {
    const { data, error } = await withRpcTimeout(
      client.rpc("check_api_rate_limit", {
        p_scopes: scopes.map(({ key, limit }) => ({ key, limit })),
        p_window_ms: windowMs,
      }),
      RPC_TIMEOUT_MS,
    );

    if (error) {
      recordDurableRpcFailure(now);
      // TODO(U7): route through captureException once error-capture wiring lands.
      console.error(
        "[rate-limit] check_api_rate_limit RPC failed; using in-memory fallback store",
        { ...logContext, message: error.message },
      );
      return null;
    }

    const rows = parseRpcScopeResults(data);
    if (!rows) {
      recordDurableRpcFailure(now);
      // TODO(U7): route through captureException once error-capture wiring lands.
      console.error(
        "[rate-limit] check_api_rate_limit returned malformed payload; using in-memory fallback store",
        logContext,
      );
      return null;
    }

    const byKey = new Map(rows.map((row) => [row.key, row]));
    const results: ScopeResult[] = [];
    for (const scope of scopes) {
      const row = byKey.get(scope.key);
      if (!row) {
        recordDurableRpcFailure(now);
        // TODO(U7): route through captureException once error-capture wiring lands.
        console.error(
          "[rate-limit] check_api_rate_limit response missing a requested scope; using in-memory fallback store",
          logContext,
        );
        return null;
      }
      results.push({
        scope: scope.scope,
        ok: row.allowed,
        limit: scope.limit,
        remaining: Math.max(row.remaining, 0),
        resetAt: row.reset_at_ms,
        retryAfterSeconds: Math.max(1, Math.ceil((row.reset_at_ms - now) / 1000)),
      });
    }
    recordDurableRpcSuccess();
    return results;
  } catch (err) {
    recordDurableRpcFailure(now);
    // TODO(U7): route through captureException once error-capture wiring lands.
    console.error(
      "[rate-limit] check_api_rate_limit RPC threw; using in-memory fallback store",
      { ...logContext, err },
    );
    return null;
  }
}

export async function checkRateLimit(
  request: RequestLike,
  config: RateLimitConfig = {},
): Promise<RateLimitResult> {
  const now = Date.now();
  const path = config.pathOverride || new URL(request.url).pathname;
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
  const maxPerIp = config.limitPerIp ?? DEFAULT_IP_LIMIT;
  const maxPerUser = config.limitPerUser ?? DEFAULT_USER_LIMIT;
  const maxPerOrg = config.limitPerOrg ?? 0;
  const ip = deriveClientIp(request) || "unknown";
  const userId = config.userId?.trim() || null;
  const orgId = config.orgId?.trim() || null;
  const feature = config.feature || "this endpoint";

  const scopes: ScopeCheck[] = [];

  if (maxPerIp > 0) {
    scopes.push({ scope: "ip", key: `ip:${path}:${ip}`, limit: maxPerIp });
  }

  if (userId && maxPerUser > 0) {
    scopes.push({ scope: "user", key: `user:${path}:${userId}`, limit: maxPerUser });
  }

  if (orgId && maxPerOrg > 0) {
    scopes.push({ scope: "org", key: `org:${path}:${orgId}`, limit: maxPerOrg });
  }

  let results: ScopeResult[] | null = null;
  if (scopes.length > 0) {
    results = await checkScopesDurably(scopes, windowMs, now);
  }
  if (!results) {
    results = scopes.map((scope) => ({
      scope: scope.scope,
      ...consume(scope.key, scope.limit, windowMs, now),
    }));
  }

  const failure = results.find((result) => !result.ok);
  const limit = Math.min(...results.map((r) => r.limit));
  const remaining = Math.min(...results.map((r) => r.remaining));
  const resetAt = Math.min(...results.map((r) => r.resetAt));
  const retryAfterSeconds = Math.max(...results.map((r) => r.retryAfterSeconds));

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(Math.max(remaining, 0)),
    "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
  };

  if (failure) {
    headers["Retry-After"] = String(failure.retryAfterSeconds);
    return {
      ok: false,
      limit,
      remaining: 0,
      resetAt: failure.resetAt,
      retryAfterSeconds: failure.retryAfterSeconds,
      reason: `Too many requests to ${feature}. Please retry after ${failure.retryAfterSeconds}s.`,
      headers,
    };
  }

  return {
    ok: true,
    limit,
    remaining,
    resetAt,
    retryAfterSeconds,
    reason: "",
    headers,
  };
}

export function buildRateLimitResponse(result: RateLimitResult) {
  return NextResponse.json(
    {
      error: "Too many requests",
      message: result.reason,
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: result.headers,
    },
  );
}
