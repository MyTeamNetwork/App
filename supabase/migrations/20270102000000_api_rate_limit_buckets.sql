-- Durable fixed-window rate limiting for API routes (F4a)
--
-- Postgres-backed store so rate limits hold across serverless instances.
-- Mirrors the pattern in 20260211030000_analytics_rate_limiting.sql
-- (fixed windows + atomic INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit),
-- with deliberately stricter grants: EXECUTE is service_role-only — the web
-- tier calls this exclusively through the service-role client, never from
-- browser-facing roles.

-- =============================================================================
-- Table: api_rate_limit_buckets — one row per bucket key per fixed window
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.api_rate_limit_buckets (
  id BIGSERIAL PRIMARY KEY,
  bucket_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upsert target: one row per bucket per window (prevents concurrency duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_rate_limit_buckets_key_window
  ON public.api_rate_limit_buckets (bucket_key, window_start);

-- Supports cron cleanup by window_start
CREATE INDEX IF NOT EXISTS idx_api_rate_limit_buckets_window_start
  ON public.api_rate_limit_buckets (window_start);

-- RLS enabled with zero policies: nothing reaches this table through
-- PostgREST except the service role (bypasses RLS) and the SECURITY DEFINER
-- function below.
ALTER TABLE public.api_rate_limit_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.api_rate_limit_buckets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.api_rate_limit_buckets_id_seq FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- Function: check_api_rate_limit
--
-- Evaluates ALL requested scopes for one request in a single call.
--   p_scopes:    jsonb array of {"key": text, "limit": int}
--   p_window_ms: fixed window size in milliseconds (shared by all scopes)
--
-- Returns a jsonb array, one entry per scope, in input order:
--   {"key": text, "allowed": bool, "limit": int, "remaining": int, "reset_at_ms": bigint}
--
-- Every scope is counted even when an earlier scope is already exhausted —
-- this matches the in-memory limiter's semantics, where each applicable
-- bucket is consumed per request.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_api_rate_limit(
  p_scopes JSONB,
  p_window_ms INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window_index BIGINT;
  v_window_start TIMESTAMPTZ;
  v_reset_at_ms BIGINT;
  v_results JSONB := '[]'::jsonb;
  v_scope JSONB;
  v_key TEXT;
  v_limit INT;
  v_count INT;
  v_allowed BOOLEAN;
BEGIN
  IF p_scopes IS NULL OR jsonb_typeof(p_scopes) <> 'array' THEN
    RAISE EXCEPTION 'p_scopes must be a jsonb array';
  END IF;
  IF p_window_ms IS NULL OR p_window_ms <= 0 THEN
    RAISE EXCEPTION 'p_window_ms must be > 0';
  END IF;

  -- Fixed windows floored to the window size (epoch milliseconds)
  v_window_index := floor(EXTRACT(EPOCH FROM now()) * 1000 / p_window_ms)::bigint;
  v_window_start := to_timestamp((v_window_index * p_window_ms) / 1000.0);
  v_reset_at_ms := (v_window_index + 1) * p_window_ms;

  FOR v_scope IN SELECT value FROM jsonb_array_elements(p_scopes) LOOP
    v_key := v_scope->>'key';
    v_limit := (v_scope->>'limit')::int;

    IF v_key IS NULL OR length(v_key) = 0 THEN
      RAISE EXCEPTION 'each scope requires a non-empty "key"';
    END IF;

    IF v_limit IS NULL OR v_limit <= 0 THEN
      -- Fail closed on nonsensical limits rather than admitting traffic.
      v_allowed := FALSE;
      v_limit := COALESCE(v_limit, 0);
      v_count := v_limit;
    ELSE
      -- Atomic upsert+increment with limit enforcement: the WHERE clause makes
      -- the increment and the limit check a single statement, so concurrent
      -- requests across instances can never push count past the limit.
      WITH upsert AS (
        INSERT INTO public.api_rate_limit_buckets (bucket_key, window_start, count)
        VALUES (v_key, v_window_start, 1)
        ON CONFLICT (bucket_key, window_start)
        DO UPDATE
          SET count = api_rate_limit_buckets.count + 1
          WHERE api_rate_limit_buckets.count < v_limit
        RETURNING api_rate_limit_buckets.count AS new_count
      )
      SELECT new_count INTO v_count FROM upsert;

      v_allowed := FOUND;
      IF NOT v_allowed THEN
        v_count := v_limit;
      END IF;
    END IF;

    v_results := v_results || jsonb_build_object(
      'key', v_key,
      'allowed', v_allowed,
      'limit', v_limit,
      'remaining', GREATEST(v_limit - COALESCE(v_count, v_limit), 0),
      'reset_at_ms', v_reset_at_ms
    );
  END LOOP;

  RETURN v_results;
END;
$$;

-- Stricter than the analytics precedent: service_role ONLY.
REVOKE EXECUTE ON FUNCTION public.check_api_rate_limit(JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_api_rate_limit(JSONB, INTEGER) TO service_role;

-- =============================================================================
-- Function: purge_expired_api_rate_limit_buckets
--
-- Deletes old buckets in bounded batches so the daily cleanup cron never runs
-- one large table-wide delete transaction after missed schedules or high-cardinality
-- traffic. The app route owns the per-run cap; this RPC owns one indexed batch.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.purge_expired_api_rate_limit_buckets()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted_count INTEGER := 0;
BEGIN
  WITH expired AS (
    SELECT id
    FROM public.api_rate_limit_buckets
    WHERE window_start < now() - interval '24 hours'
    ORDER BY window_start, id
    LIMIT 500
  ),
  deleted AS (
    DELETE FROM public.api_rate_limit_buckets buckets
    USING expired
    WHERE buckets.id = expired.id
    RETURNING buckets.id
  )
  SELECT count(*)::integer INTO v_deleted_count FROM deleted;

  RETURN COALESCE(v_deleted_count, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_api_rate_limit_buckets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_api_rate_limit_buckets() TO service_role;
