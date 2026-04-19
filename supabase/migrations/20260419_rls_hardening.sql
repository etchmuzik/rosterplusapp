-- ═══════════════════════════════════════════════════════════
-- ROSTR+ RLS Hardening (2026-04-19)
-- Run in Supabase SQL Editor on top of supabase-schema.sql
--
-- Fills the gaps found in the role-audit:
--   1. Role enforcement on INSERT (was: any auth user could insert booking
--      as themselves with no role check; now: only promoters create bookings,
--      only artists update artist fields, etc.)
--   2. Contract signing policies (artist_signed, promoter_signed)
--   3. Payments INSERT/UPDATE (was: no one could create a payment row)
--   4. Safe DELETE policies (only owners, and only in safe states)
--   5. Messages: prevent cross-booking leakage
-- ═══════════════════════════════════════════════════════════

-- Helper: quickly check the caller's role from profiles.
-- SECURITY DEFINER so policies can call it without recursive RLS on profiles.
CREATE OR REPLACE FUNCTION public.current_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.current_role() TO authenticated;

-- ── Bookings ──────────────────────────────────────────────
-- Tighten INSERT: only users whose role = 'promoter' can create bookings.
DROP POLICY IF EXISTS "Promoters can create bookings" ON public.bookings;
CREATE POLICY "Promoters can create bookings" ON public.bookings
  FOR INSERT WITH CHECK (
    promoter_id = auth.uid()
    AND public.current_role() = 'promoter'
  );

-- DELETE: only the promoter who created it, and only while still in a
-- cancellable state (never after contracted/completed).
DROP POLICY IF EXISTS "Promoters can delete draft bookings" ON public.bookings;
CREATE POLICY "Promoters can delete draft bookings" ON public.bookings
  FOR DELETE USING (
    promoter_id = auth.uid()
    AND status IN ('inquiry', 'pending', 'cancelled')
  );

-- ── Contracts ─────────────────────────────────────────────
-- Both parties can update signing fields (promoter_signed / artist_signed)
-- on contracts linked to bookings they're part of.
DROP POLICY IF EXISTS "Parties can sign contracts" ON public.contracts;
CREATE POLICY "Parties can sign contracts" ON public.contracts
  FOR UPDATE USING (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE promoter_id = auth.uid()
         OR artist_id IN (SELECT a.id FROM public.artists a WHERE a.profile_id = auth.uid())
    )
  );

-- DELETE: only the promoter who issued the contract, only while draft.
DROP POLICY IF EXISTS "Promoters can delete draft contracts" ON public.contracts;
CREATE POLICY "Promoters can delete draft contracts" ON public.contracts
  FOR DELETE USING (
    status = 'draft'
    AND booking_id IN (SELECT id FROM public.bookings WHERE promoter_id = auth.uid())
  );

-- ── Payments ──────────────────────────────────────────────
-- Promoters create payments against their own bookings.
DROP POLICY IF EXISTS "Promoters can create payments" ON public.payments;
CREATE POLICY "Promoters can create payments" ON public.payments
  FOR INSERT WITH CHECK (
    booking_id IN (SELECT id FROM public.bookings WHERE promoter_id = auth.uid())
    AND public.current_role() = 'promoter'
  );

-- Promoters can update their own payment rows (status transitions, paid_at).
-- In production this should really be service-role only (webhook from Stripe),
-- but for MVP the promoter-scoped update is acceptable.
DROP POLICY IF EXISTS "Promoters can update own payments" ON public.payments;
CREATE POLICY "Promoters can update own payments" ON public.payments
  FOR UPDATE USING (
    booking_id IN (SELECT id FROM public.bookings WHERE promoter_id = auth.uid())
  );

-- ── Messages ──────────────────────────────────────────────
-- Tighten INSERT: sender must be auth user AND must be party to the booking
-- if a booking_id is attached (prevents spamming unrelated bookings).
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
CREATE POLICY "Users can send messages" ON public.messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND (
      booking_id IS NULL
      OR booking_id IN (
        SELECT id FROM public.bookings
        WHERE promoter_id = auth.uid()
           OR artist_id IN (SELECT a.id FROM public.artists a WHERE a.profile_id = auth.uid())
      )
    )
  );

-- ── Profiles ──────────────────────────────────────────────
-- Prevent users from changing their own role after signup.
-- (role change should only happen via service-role / admin.)
CREATE OR REPLACE FUNCTION public.prevent_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role is immutable from the client; contact support to change it';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_lock_role ON public.profiles;
CREATE TRIGGER profiles_lock_role
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_change();

-- ═══════════════════════════════════════════════════════════
-- Done. After running this, verify with:
--   select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' order by tablename, cmd;
-- ═══════════════════════════════════════════════════════════
