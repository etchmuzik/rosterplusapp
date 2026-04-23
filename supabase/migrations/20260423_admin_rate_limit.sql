-- Admin RPC rate-limiting. Per-admin, per-action sliding-hour window.
-- If thresholds are exceeded, the RPC raises 'rate_limited' before
-- doing any work. Protects against leaked-token mass-abuse (bulk
-- broadcast, mass-suspend, mass-force-cancel).
--
-- Applied live via Supabase MCP on 2026-04-23.

CREATE TABLE IF NOT EXISTS public.admin_rate_counter (
  admin_id     uuid        NOT NULL,
  action       text        NOT NULL,
  bucket_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (admin_id, action, bucket_start)
);
CREATE INDEX IF NOT EXISTS idx_admin_rate_counter_bucket
  ON public.admin_rate_counter (bucket_start DESC);

ALTER TABLE public.admin_rate_counter ENABLE ROW LEVEL SECURITY;
-- No policies — reads/writes only via SECURITY DEFINER helpers below.

-- JWT-based helper: infers admin from auth.uid(). Used by SQL RPCs.
CREATE OR REPLACE FUNCTION public._admin_rl_hit(p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me       uuid := auth.uid();
  v_bucket   timestamptz := date_trunc('minute', now());
  v_hour_sum int;
  v_limit    int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_limit := CASE p_action
    WHEN 'broadcast'    THEN 3
    WHEN 'force_cancel' THEN 10
    WHEN 'role_change'  THEN 20
    WHEN 'suspend'      THEN 20
    WHEN 'unsuspend'    THEN 20
    WHEN 'impersonate'  THEN 30
    ELSE                     60
  END;
  DELETE FROM public.admin_rate_counter
   WHERE bucket_start < now() - interval '2 hours';
  SELECT COALESCE(SUM(count), 0) INTO v_hour_sum
    FROM public.admin_rate_counter
   WHERE admin_id = v_me
     AND action = p_action
     AND bucket_start > now() - interval '1 hour';
  IF v_hour_sum >= v_limit THEN
    RAISE EXCEPTION 'rate_limited: % calls/hour exceeded for %', v_limit, p_action;
  END IF;
  INSERT INTO public.admin_rate_counter(admin_id, action, bucket_start, count)
    VALUES (v_me, p_action, v_bucket, 1)
  ON CONFLICT (admin_id, action, bucket_start)
    DO UPDATE SET count = admin_rate_counter.count + 1;
END;
$$;

-- Explicit-admin helper: called from edge functions that run with the
-- service role (so auth.uid() is null). Same logic, admin id passed in.
CREATE OR REPLACE FUNCTION public._admin_rl_hit_for(
  p_admin_id uuid,
  p_action   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket   timestamptz := date_trunc('minute', now());
  v_hour_sum int;
  v_limit    int;
BEGIN
  IF p_admin_id IS NULL THEN RAISE EXCEPTION 'admin_id required'; END IF;
  v_limit := CASE p_action
    WHEN 'broadcast'    THEN 3
    WHEN 'force_cancel' THEN 10
    WHEN 'role_change'  THEN 20
    WHEN 'suspend'      THEN 20
    WHEN 'unsuspend'    THEN 20
    WHEN 'impersonate'  THEN 30
    ELSE                     60
  END;
  DELETE FROM public.admin_rate_counter
   WHERE bucket_start < now() - interval '2 hours';
  SELECT COALESCE(SUM(count), 0) INTO v_hour_sum
    FROM public.admin_rate_counter
   WHERE admin_id = p_admin_id
     AND action = p_action
     AND bucket_start > now() - interval '1 hour';
  IF v_hour_sum >= v_limit THEN
    RAISE EXCEPTION 'rate_limited: % calls/hour exceeded for %', v_limit, p_action;
  END IF;
  INSERT INTO public.admin_rate_counter(admin_id, action, bucket_start, count)
    VALUES (p_admin_id, p_action, v_bucket, 1)
  ON CONFLICT (admin_id, action, bucket_start)
    DO UPDATE SET count = admin_rate_counter.count + 1;
END;
$$;

-- Patch the existing RPCs so they hit the rate limiter BEFORE doing
-- any real work. (All three definitions are CREATE OR REPLACE so this
-- migration is idempotent.)
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
  PERFORM public._admin_rl_hit('broadcast');
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
  PERFORM public._admin_rl_hit('force_cancel');
  SELECT status INTO v_old_status FROM public.bookings WHERE id = p_booking_id;
  IF v_old_status IS NULL THEN RAISE EXCEPTION 'booking not found'; END IF;
  UPDATE public.bookings SET status = 'cancelled', updated_at = now() WHERE id = p_booking_id;
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
  PERFORM public._admin_rl_hit('role_change');
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
