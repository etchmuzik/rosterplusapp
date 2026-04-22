-- ═══════════════════════════════════════════════════════════
-- Pre-launch hardening
--
-- Applied live via Supabase MCP on 2026-04-21. File kept in the
-- repo so future re-bootstraps stay in sync.
--
-- 1. Pin search_path on generate_invoice_number so SECURITY
--    DEFINER callers can't be hijacked by a rogue public schema
--    function with the same name. (SQL injection surface hardening.)
--
-- 2. Consolidate duplicate permissive RLS policies on artists +
--    payments so Postgres evaluates one policy per (role, action)
--    tuple instead of two. Supabase's advisor flagged both tables
--    as Multiple Permissive Policies. The merged OR-combined
--    policy is logically identical but evaluates once per query.
-- ═══════════════════════════════════════════════════════════

-- 1. generate_invoice_number search_path
ALTER FUNCTION public.generate_invoice_number() SET search_path = public;

-- 2a. artists INSERT — merge admin + artist paths
DROP POLICY IF EXISTS "Admins can insert unclaimed artists" ON public.artists;
DROP POLICY IF EXISTS "Artists can insert own listing"     ON public.artists;

CREATE POLICY "Insert artists"
  ON public.artists FOR INSERT
  WITH CHECK (
    profile_id = (SELECT auth.uid())
    OR (public.is_admin() AND profile_id IS NULL)
  );

-- 2b. artists UPDATE — merge admin + artist paths
DROP POLICY IF EXISTS "Admins can update any artist"       ON public.artists;
DROP POLICY IF EXISTS "Artists can update own listing"     ON public.artists;

CREATE POLICY "Update artists"
  ON public.artists FOR UPDATE
  USING (
    profile_id = (SELECT auth.uid())
    OR public.is_admin()
  );

-- 2c. payments UPDATE — merge promoter + artist-confirm paths
DROP POLICY IF EXISTS "Artists can confirm payment received" ON public.payments;
DROP POLICY IF EXISTS "Promoters can update own payments"    ON public.payments;

CREATE POLICY "Update payments"
  ON public.payments FOR UPDATE
  USING (
    booking_id IN (
      SELECT b.id FROM public.bookings b
       WHERE b.promoter_id = (SELECT auth.uid())
          OR b.artist_id IN (
            SELECT a.id FROM public.artists a
             WHERE a.profile_id = (SELECT auth.uid())
          )
    )
  );
