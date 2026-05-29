-- 20260529_recent_booking_activity.sql
-- Public, anonymized "recently booked" feed for the directory social-proof
-- ticker (activation quick-win #6).
--
-- Privacy model: bookings has per-party RLS, so anon/authenticated REST
-- callers can't SELECT the table. This SECURITY DEFINER function is the
-- privacy boundary — it reads bookings with owner privileges but returns
-- ONLY de-identified fields:
--   - artist stage name (already public on /directory, /a, /epk)
--   - first city of the artist (already public)
--   - a coarse relative-time bucket ("today" / "this week" / "this month")
--
-- It NEVER returns: promoter identity, fee, venue, event name, exact
-- timestamp, booking id, or anything that could identify the two parties
-- or the commercial terms. The coarse time bucket (not an exact date)
-- prevents correlating a ticker entry back to a specific known event.
--
-- Only confirmed/contracted/completed bookings surface — a pending
-- request is not proof and could be embarrassing if it falls through.
-- Soft-deleted bookings excluded.

CREATE OR REPLACE FUNCTION public.recent_booking_activity(p_limit integer DEFAULT 8)
RETURNS TABLE (
  artist_name text,
  city        text,
  when_bucket text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT
    COALESCE(a.stage_name, pr.display_name, 'An artist') AS artist_name,
    COALESCE((a.cities_active)[1], pr.city)              AS city,
    CASE
      WHEN b.created_at > now() - interval '1 day'  THEN 'today'
      WHEN b.created_at > now() - interval '7 days' THEN 'this week'
      ELSE 'this month'
    END AS when_bucket
  FROM public.bookings b
  JOIN public.artists  a  ON a.id = b.artist_id
  LEFT JOIN public.profiles pr ON pr.id = a.profile_id
  WHERE b.status IN ('confirmed', 'contracted', 'completed')
    AND b.deleted_at IS NULL
    AND b.created_at > now() - interval '30 days'
  ORDER BY b.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 20);
$$;

-- Anyone (incl. anonymous homepage/directory visitors) may call it —
-- that's the point. The function body is the safety boundary, not RLS.
GRANT EXECUTE ON FUNCTION public.recent_booking_activity(integer) TO anon, authenticated;

COMMENT ON FUNCTION public.recent_booking_activity(integer) IS
  'Anonymized recent-booking feed for the directory social-proof ticker. '
  'Returns artist name + city + coarse time bucket only — never promoter, '
  'fee, venue, or exact date. SECURITY DEFINER is the privacy boundary '
  '(bookings has per-party RLS). Confirmed/contracted/completed only, '
  'last 30 days. Added 2026-05-29 activation quick-win #6.';
