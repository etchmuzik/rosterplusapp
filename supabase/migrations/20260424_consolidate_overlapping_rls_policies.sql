-- Consolidate overlapping permissive RLS policies flagged by the
-- 2026-04-24 Supabase performance advisor. Each (table, action) pair
-- had two separate policies evaluated in OR on every row; merging to
-- a single policy per pair keeps the same behaviour with half the
-- planner work.
--
-- Applied live via MCP on 2026-04-24. Dropped the first 9 of 14
-- multiple_permissive_policies advisor warnings — the remaining 5 on
-- public.profiles are handled by the follow-up
-- 20260424_collapse_profiles_select_policies.sql migration.

-- ── bookings.SELECT: admin OR owner ──
DROP POLICY IF EXISTS "Admins can read all bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can view own bookings"  ON public.bookings;

CREATE POLICY "Bookings read access"
  ON public.bookings FOR SELECT
  USING (
    public.is_admin()
    OR promoter_id = (SELECT auth.uid())
    OR artist_id IN (
      SELECT id FROM public.artists WHERE profile_id = (SELECT auth.uid())
    )
  );

-- ── bookings.UPDATE: admin OR involved party ──
DROP POLICY IF EXISTS "Admins can update any booking"        ON public.bookings;
DROP POLICY IF EXISTS "Involved parties can update bookings" ON public.bookings;

CREATE POLICY "Bookings update access"
  ON public.bookings FOR UPDATE
  USING (
    public.is_admin()
    OR promoter_id = (SELECT auth.uid())
    OR artist_id IN (
      SELECT id FROM public.artists WHERE profile_id = (SELECT auth.uid())
    )
  );

-- ── reviews.SELECT: admin OR non-hidden ──
DROP POLICY IF EXISTS "Admins can read all reviews"       ON public.reviews;
DROP POLICY IF EXISTS "Anyone can read non-hidden reviews" ON public.reviews;

CREATE POLICY "Reviews read access"
  ON public.reviews FOR SELECT
  USING (public.is_admin() OR hidden_at IS NULL);

-- ── reviews.UPDATE: admin OR own ──
DROP POLICY IF EXISTS "Admins can update all reviews" ON public.reviews;
DROP POLICY IF EXISTS "Reviewers update own"          ON public.reviews;

CREATE POLICY "Reviews update access"
  ON public.reviews FOR UPDATE
  USING (public.is_admin() OR reviewer_id = (SELECT auth.uid()))
  WITH CHECK (public.is_admin() OR reviewer_id = (SELECT auth.uid()));
