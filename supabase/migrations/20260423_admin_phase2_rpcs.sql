-- ═══════════════════════════════════════════════════════════
-- Admin Phase 2: user management, booking moderation, broadcast, stats
--
-- Five SECURITY DEFINER RPCs, each admin-gated at function level.
-- Non-admins get raised 'forbidden' exceptions.
--
-- Applied live via Supabase MCP on 2026-04-23.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id uuid,
  email text,
  display_name text,
  role text,
  city text,
  onboarding_complete boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT
      p.id, p.email, p.display_name, p.role, p.city,
      p.onboarding_complete, p.created_at, u.last_sign_in_at
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY p.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  p_user_id uuid,
  p_role    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_role text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_role NOT IN ('promoter', 'artist') THEN
    RAISE EXCEPTION 'invalid role %', p_role;
  END IF;
  SELECT role INTO v_old_role FROM public.profiles WHERE id = p_user_id;
  UPDATE public.profiles SET role = p_role WHERE id = p_user_id;
  INSERT INTO public.admin_audit_log(
    actor_id, actor_email, action, target_type, target_id,
    before_value, after_value, meta
  )
  VALUES (
    auth.uid(), public._current_email(),
    'user.role_change', 'user', p_user_id,
    jsonb_build_object('role', v_old_role),
    jsonb_build_object('role', p_role),
    '{}'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_force_cancel_booking(
  p_booking_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT status INTO v_old_status FROM public.bookings WHERE id = p_booking_id;
  IF v_old_status IS NULL THEN RAISE EXCEPTION 'booking not found'; END IF;
  UPDATE public.bookings
    SET status = 'cancelled', updated_at = now()
  WHERE id = p_booking_id;
  INSERT INTO public.admin_audit_log(
    actor_id, actor_email, action, target_type, target_id,
    before_value, after_value, meta
  )
  VALUES (
    auth.uid(), public._current_email(),
    'booking.force_cancel', 'booking', p_booking_id,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', 'cancelled'),
    jsonb_build_object('reason', COALESCE(p_reason, ''))
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_force_cancel_booking(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_broadcast_notification(
  p_title       text,
  p_body        text,
  p_href        text,
  p_filter_role text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_title IS NULL OR length(p_title) = 0 THEN
    RAISE EXCEPTION 'title required';
  END IF;
  IF p_filter_role IS NOT NULL AND p_filter_role NOT IN ('promoter','artist') THEN
    RAISE EXCEPTION 'invalid role filter %', p_filter_role;
  END IF;
  WITH inserted AS (
    INSERT INTO public.notifications(user_id, type, title, body, href)
    SELECT
      p.id, 'broadcast',
      LEFT(p_title, 200),
      LEFT(COALESCE(p_body, ''), 1000),
      p_href
    FROM public.profiles p
    WHERE p_filter_role IS NULL OR p.role = p_filter_role
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM inserted;
  INSERT INTO public.admin_audit_log(
    actor_id, actor_email, action, target_type, after_value, meta
  )
  VALUES (
    auth.uid(), public._current_email(),
    'broadcast.sent', 'broadcast',
    jsonb_build_object('recipients', v_count),
    jsonb_build_object('title', LEFT(p_title, 200), 'role_filter', p_filter_role)
  );
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_broadcast_notification(text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'users_total',        (SELECT count(*) FROM public.profiles),
    'users_promoters',    (SELECT count(*) FROM public.profiles WHERE role = 'promoter'),
    'users_artists',      (SELECT count(*) FROM public.profiles WHERE role = 'artist'),
    'artists_total',      (SELECT count(*) FROM public.artists),
    'artists_verified',   (SELECT count(*) FROM public.artists WHERE verified = true),
    'artists_unclaimed',  (SELECT count(*) FROM public.artists WHERE profile_id IS NULL),
    'bookings_total',     (SELECT count(*) FROM public.bookings),
    'bookings_confirmed', (SELECT count(*) FROM public.bookings WHERE status IN ('confirmed','contracted','completed')),
    'bookings_this_month',(SELECT count(*) FROM public.bookings WHERE event_date >= date_trunc('month', now())),
    'gmv_all_time',       (SELECT COALESCE(SUM(fee), 0) FROM public.bookings WHERE status IN ('confirmed','contracted','completed')),
    'gmv_this_month',     (SELECT COALESCE(SUM(fee), 0) FROM public.bookings WHERE status IN ('confirmed','contracted','completed') AND event_date >= date_trunc('month', now())),
    'errors_24h',         (SELECT count(*) FROM public.client_errors WHERE created_at >= now() - interval '24 hours')
  ) INTO v_out;
  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_stats() TO authenticated;
