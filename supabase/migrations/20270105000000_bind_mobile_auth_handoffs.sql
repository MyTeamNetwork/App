-- Bind new mobile OAuth handoffs to a verifier held only by the initiating app.
-- Existing rows remain unbound and consumable by deployed clients during the
-- staggered rollout; new clients send a SHA-256 challenge when starting OAuth.

ALTER TABLE public.mobile_auth_handoffs
  ADD COLUMN IF NOT EXISTS challenge_hash text;

COMMENT ON COLUMN public.mobile_auth_handoffs.challenge_hash IS
  'Optional lowercase SHA-256 of the native handoff verifier; NULL marks a legacy unbound row.';

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'mobile_auth_handoffs_challenge_hash_check'
       AND conrelid = 'public.mobile_auth_handoffs'::regclass
  ) THEN
    ALTER TABLE public.mobile_auth_handoffs
      ADD CONSTRAINT mobile_auth_handoffs_challenge_hash_check
      CHECK (challenge_hash IS NULL OR challenge_hash ~ '^[0-9a-f]{64}$');
  END IF;
END
$migration$;

-- Changing the argument list creates an overload rather than replacing the old
-- function, so explicitly remove both signatures before recreating it.
DROP FUNCTION IF EXISTS public.consume_mobile_auth_handoff(text);
DROP FUNCTION IF EXISTS public.consume_mobile_auth_handoff(text, text);

CREATE FUNCTION public.consume_mobile_auth_handoff(
  p_code_hash text,
  p_challenge_hash text DEFAULT NULL
)
  RETURNS TABLE(user_id uuid, encrypted_access_token text, encrypted_refresh_token text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
  UPDATE public.mobile_auth_handoffs
     SET consumed_at = now()
   WHERE id = (
     SELECT id
       FROM public.mobile_auth_handoffs
      WHERE code_hash = p_code_hash
        AND (
          (challenge_hash IS NULL AND p_challenge_hash IS NULL)
          OR challenge_hash = p_challenge_hash
        )
        AND consumed_at IS NULL
        AND expires_at > now()
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
   RETURNING user_id, encrypted_access_token, encrypted_refresh_token;
$function$;

REVOKE EXECUTE ON FUNCTION public.consume_mobile_auth_handoff(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_mobile_auth_handoff(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_mobile_auth_handoff(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_mobile_auth_handoff(text, text) TO service_role;
