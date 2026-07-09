import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20270102000000_api_rate_limit_buckets.sql",
    import.meta.url,
  ),
  "utf8",
);

const cleanupRoute = readFileSync(
  new URL(
    "../src/app/api/cron/api-rate-limit-cleanup/route.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("api_rate_limit_buckets migration contract", () => {
  it("enables RLS on the durable bucket table", () => {
    assert.match(
      migration,
      /ALTER TABLE public\.api_rate_limit_buckets ENABLE ROW LEVEL SECURITY/i,
    );
  });

  it("keeps bucket table and sequence unavailable to public-facing roles", () => {
    assert.match(
      migration,
      /REVOKE ALL ON TABLE public\.api_rate_limit_buckets FROM PUBLIC, anon, authenticated/i,
    );
    assert.match(
      migration,
      /REVOKE ALL ON SEQUENCE public\.api_rate_limit_buckets_id_seq FROM PUBLIC, anon, authenticated/i,
    );
  });

  it("keeps check_api_rate_limit service-role only", () => {
    assert.match(
      migration,
      /REVOKE EXECUTE ON FUNCTION public\.check_api_rate_limit\(JSONB, INTEGER\) FROM PUBLIC, anon, authenticated/i,
    );
    assert.match(
      migration,
      /GRANT EXECUTE ON FUNCTION public\.check_api_rate_limit\(JSONB, INTEGER\) TO service_role/i,
    );
  });

  it("defines a service-role-only bounded purge RPC with hardened search path", () => {
    assert.match(
      migration,
      /CREATE OR REPLACE FUNCTION public\.purge_expired_api_rate_limit_buckets\(\)/i,
    );
    assert.match(migration, /SECURITY DEFINER\s+SET search_path = ''/i);
    assert.match(
      migration,
      /REVOKE EXECUTE ON FUNCTION public\.purge_expired_api_rate_limit_buckets\(\) FROM PUBLIC, anon, authenticated/i,
    );
    assert.match(
      migration,
      /GRANT EXECUTE ON FUNCTION public\.purge_expired_api_rate_limit_buckets\(\) TO service_role/i,
    );
  });

  it("bounds cleanup work with an indexed limited selection before delete", () => {
    assert.match(
      migration,
      /SELECT id\s+FROM public\.api_rate_limit_buckets\s+WHERE window_start < now\(\) - interval '24 hours'\s+ORDER BY window_start, id\s+LIMIT 500/is,
    );
    assert.match(
      migration,
      /DELETE FROM public\.api_rate_limit_buckets buckets\s+USING expired\s+WHERE buckets\.id = expired\.id/is,
    );
  });

  it("cleanup route calls the purge RPC instead of direct table delete", () => {
    assert.match(cleanupRoute, /purge_expired_api_rate_limit_buckets/);
    assert.doesNotMatch(cleanupRoute, /\.from\("api_rate_limit_buckets"\)/);
    assert.doesNotMatch(cleanupRoute, /\.delete\(\{ count: "exact" \}\)/);
  });
});
