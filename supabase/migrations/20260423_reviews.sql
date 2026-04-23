-- Reviews — post-event ratings between promoters and artists.
-- Mutual: one row per (booking, reviewer). Applied live via Supabase
-- MCP on 2026-04-23.

CREATE TABLE IF NOT EXISTS public.reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  reviewer_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating        integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       text,
  hidden_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_target     ON public.reviews (target_id) WHERE hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer   ON public.reviews (reviewer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_booking    ON public.reviews (booking_id);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read non-hidden reviews" ON public.reviews;
CREATE POLICY "Anyone can read non-hidden reviews"
  ON public.reviews FOR SELECT USING (hidden_at IS NULL);

DROP POLICY IF EXISTS "Reviewers update own" ON public.reviews;
CREATE POLICY "Reviewers update own"
  ON public.reviews FOR UPDATE
  USING (reviewer_id = (SELECT auth.uid()))
  WITH CHECK (reviewer_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Reviewers delete own" ON public.reviews;
CREATE POLICY "Reviewers delete own"
  ON public.reviews FOR DELETE
  USING (reviewer_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can read all reviews" ON public.reviews;
CREATE POLICY "Admins can read all reviews"
  ON public.reviews FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update all reviews" ON public.reviews;
CREATE POLICY "Admins can update all reviews"
  ON public.reviews FOR UPDATE USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.create_review(
  p_booking_id uuid,
  p_rating     integer,
  p_comment    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me        uuid := auth.uid();
  v_booking   record;
  v_artist    record;
  v_target    uuid;
  v_review_id uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_rating < 1 OR p_rating > 5 THEN RAISE EXCEPTION 'rating must be 1-5'; END IF;

  SELECT id, promoter_id, artist_id, status, event_date
    INTO v_booking
    FROM public.bookings
   WHERE id = p_booking_id;

  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.status NOT IN ('confirmed', 'contracted', 'completed') THEN
    RAISE EXCEPTION 'booking_not_reviewable';
  END IF;
  IF v_booking.event_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'event_not_yet_happened';
  END IF;

  SELECT profile_id AS user_id INTO v_artist
    FROM public.artists
   WHERE id = v_booking.artist_id;

  IF v_me = v_booking.promoter_id THEN
    v_target := v_artist.user_id;
  ELSIF v_me = v_artist.user_id THEN
    v_target := v_booking.promoter_id;
  ELSE
    RAISE EXCEPTION 'not_a_party_to_booking';
  END IF;

  IF v_target IS NULL THEN RAISE EXCEPTION 'target_missing'; END IF;

  INSERT INTO public.reviews(booking_id, reviewer_id, target_id, rating, comment)
    VALUES (p_booking_id, v_me, v_target, p_rating, NULLIF(trim(COALESCE(p_comment, '')), ''))
  ON CONFLICT (booking_id, reviewer_id)
    DO UPDATE SET
      rating = EXCLUDED.rating,
      comment = EXCLUDED.comment,
      created_at = now()
  RETURNING id INTO v_review_id;

  RETURN v_review_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_review(uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_stats_for_user(p_user_id uuid)
RETURNS TABLE (
  review_count bigint,
  avg_rating   numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*)                                      AS review_count,
    COALESCE(ROUND(AVG(rating)::numeric, 2), 0)   AS avg_rating
  FROM public.reviews
  WHERE target_id = p_user_id
    AND hidden_at IS NULL;
$$;
GRANT EXECUTE ON FUNCTION public.review_stats_for_user(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.reviews_for_user(p_user_id uuid, p_limit int DEFAULT 20)
RETURNS TABLE (
  id            uuid,
  rating        integer,
  comment       text,
  created_at    timestamptz,
  event_name    text,
  event_date    date,
  reviewer_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.rating,
    r.comment,
    r.created_at,
    b.event_name,
    b.event_date,
    COALESCE(p.display_name, p.company, '')
  FROM public.reviews r
  LEFT JOIN public.bookings b ON b.id = r.booking_id
  LEFT JOIN public.profiles p ON p.id = r.reviewer_id
  WHERE r.target_id = p_user_id
    AND r.hidden_at IS NULL
  ORDER BY r.created_at DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.reviews_for_user(uuid, int) TO anon, authenticated;
