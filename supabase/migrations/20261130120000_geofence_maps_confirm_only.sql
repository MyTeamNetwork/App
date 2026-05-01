-- Geofence for self check-in: trust "venue confirmed in Maps" flow (no device GPS / haversine).
-- Admin check-in stays unrestricted at the venue (no geofence on check_in_event_attendee).

DROP FUNCTION IF EXISTS public.check_in_event_attendee(uuid, boolean, double precision, double precision);
DROP FUNCTION IF EXISTS public.check_in_event_attendee(uuid, boolean);

CREATE OR REPLACE FUNCTION public.check_in_event_attendee(
  p_rsvp_id uuid,
  p_undo boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rsvp record;
  v_caller_id uuid := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT
    er.*,
    e.organization_id AS event_org_id
  INTO v_rsvp
  FROM public.event_rsvps er
  JOIN public.events e ON e.id = er.event_id
  WHERE er.id = p_rsvp_id;

  IF v_rsvp IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RSVP not found');
  END IF;

  IF NOT public.is_org_admin(v_rsvp.event_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only admins can check in attendees');
  END IF;

  IF p_undo THEN
    UPDATE public.event_rsvps
    SET checked_in_at = NULL, checked_in_by = NULL
    WHERE id = p_rsvp_id;
  ELSE
    IF v_rsvp.checked_in_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Already checked in');
    END IF;
    UPDATE public.event_rsvps
    SET checked_in_at = now(), checked_in_by = v_caller_id
    WHERE id = p_rsvp_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_in_event_attendee(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.check_in_event_attendee(uuid, boolean) IS
  'Admin check-in/undo; geofence applies only to self_check_in_event.';

DROP FUNCTION IF EXISTS public.self_check_in_event(uuid, double precision, double precision);

CREATE OR REPLACE FUNCTION public.self_check_in_event(
  p_event_id uuid,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_venue_confirmed boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.geofence_enabled,
    e.location AS ev_location
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  IF NOT public.has_active_role(
    v_event.organization_id,
    ARRAY['admin', 'active_member', 'alumni', 'parent']::text[]
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a member of this organization');
  END IF;

  IF COALESCE(v_event.geofence_enabled, false) THEN
    IF length(trim(coalesce(v_event.ev_location, ''))) < 1 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'This event needs a location before self check-in with venue verification.'
      );
    END IF;
    IF NOT COALESCE(p_venue_confirmed, false) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Open the venue in Apple Maps, then confirm you’re there before checking in.'
      );
    END IF;
  END IF;

  PERFORM set_config('app.allow_self_event_check_in', '1', true);

  INSERT INTO public.event_rsvps (
    event_id,
    user_id,
    organization_id,
    status,
    checked_in_at,
    checked_in_by
  )
  VALUES (
    p_event_id,
    v_uid,
    v_event.organization_id,
    'attending',
    now(),
    v_uid
  )
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET
    status = 'attending',
    checked_in_at = EXCLUDED.checked_in_at,
    checked_in_by = EXCLUDED.checked_in_by,
    updated_at = now();

  PERFORM set_config('app.allow_self_event_check_in', '0', true);

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.allow_self_event_check_in', '0', true);
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.self_check_in_event(uuid, double precision, double precision, boolean) TO authenticated;

COMMENT ON FUNCTION public.self_check_in_event(uuid, double precision, double precision, boolean) IS
  'Member scans event QR; optional geofence requires non-empty location and p_venue_confirmed (Maps flow). p_lat/p_lng ignored.';
