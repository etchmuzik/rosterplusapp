-- ═══════════════════════════════════════════════════════════
-- Performance hardening (2026-04-19)
-- Resolves Supabase advisor warnings:
--   - unindexed_foreign_keys  (11 FKs)
--   - auth_rls_initplan       (23 policies re-evaluate auth.uid() per row)
--   - multiple_permissive_policies (invitations has overlapping SELECT)
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════

-- ── 1. FK indexes ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_artists_profile_id    ON public.artists(profile_id);
CREATE INDEX IF NOT EXISTS idx_bookings_promoter_id  ON public.bookings(promoter_id);
CREATE INDEX IF NOT EXISTS idx_bookings_artist_id    ON public.bookings(artist_id);
CREATE INDEX IF NOT EXISTS idx_bookings_venue_id     ON public.bookings(venue_id);
CREATE INDEX IF NOT EXISTS idx_contracts_booking_id  ON public.contracts(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id   ON public.payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id    ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_id  ON public.messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_booking_id   ON public.messages(booking_id);
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by ON public.invitations(invited_by);
CREATE INDEX IF NOT EXISTS idx_venues_created_by     ON public.venues(created_by);

-- ── 2. Rewrite RLS policies with (select auth.uid()) ──────
-- Postgres will cache the result once per query instead of once per row.

-- profiles
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING ((select auth.uid()) = id);

-- artists
DROP POLICY IF EXISTS "Artists can insert own listing" ON public.artists;
CREATE POLICY "Artists can insert own listing" ON public.artists
  FOR INSERT WITH CHECK (profile_id = (select auth.uid()));

DROP POLICY IF EXISTS "Artists can update own listing" ON public.artists;
CREATE POLICY "Artists can update own listing" ON public.artists
  FOR UPDATE USING (profile_id = (select auth.uid()));

-- venues
DROP POLICY IF EXISTS "Authenticated users can create venues" ON public.venues;
CREATE POLICY "Authenticated users can create venues" ON public.venues
  FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Venue creators can update" ON public.venues;
CREATE POLICY "Venue creators can update" ON public.venues
  FOR UPDATE USING (created_by = (select auth.uid()));

-- bookings
DROP POLICY IF EXISTS "Users can view own bookings" ON public.bookings;
CREATE POLICY "Users can view own bookings" ON public.bookings
  FOR SELECT USING (
    promoter_id = (select auth.uid())
    OR artist_id IN (SELECT id FROM public.artists WHERE profile_id = (select auth.uid()))
  );

DROP POLICY IF EXISTS "Promoters can create bookings" ON public.bookings;
CREATE POLICY "Promoters can create bookings" ON public.bookings
  FOR INSERT WITH CHECK (
    promoter_id = (select auth.uid())
    AND public.current_role() = 'promoter'
  );

DROP POLICY IF EXISTS "Involved parties can update bookings" ON public.bookings;
CREATE POLICY "Involved parties can update bookings" ON public.bookings
  FOR UPDATE USING (
    promoter_id = (select auth.uid())
    OR artist_id IN (SELECT id FROM public.artists WHERE profile_id = (select auth.uid()))
  );

DROP POLICY IF EXISTS "Promoters can delete draft bookings" ON public.bookings;
CREATE POLICY "Promoters can delete draft bookings" ON public.bookings
  FOR DELETE USING (
    promoter_id = (select auth.uid())
    AND status IN ('inquiry', 'pending', 'cancelled')
  );

-- contracts
DROP POLICY IF EXISTS "Users can view own contracts" ON public.contracts;
CREATE POLICY "Users can view own contracts" ON public.contracts
  FOR SELECT USING (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE promoter_id = (select auth.uid())
         OR artist_id IN (SELECT a.id FROM public.artists a WHERE a.profile_id = (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Users can create contracts for own bookings" ON public.contracts;
CREATE POLICY "Users can create contracts for own bookings" ON public.contracts
  FOR INSERT WITH CHECK (
    booking_id IN (SELECT id FROM public.bookings WHERE promoter_id = (select auth.uid()))
  );

DROP POLICY IF EXISTS "Parties can sign contracts" ON public.contracts;
CREATE POLICY "Parties can sign contracts" ON public.contracts
  FOR UPDATE USING (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE promoter_id = (select auth.uid())
         OR artist_id IN (SELECT a.id FROM public.artists a WHERE a.profile_id = (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Promoters can delete draft contracts" ON public.contracts;
CREATE POLICY "Promoters can delete draft contracts" ON public.contracts
  FOR DELETE USING (
    status = 'draft'
    AND booking_id IN (SELECT id FROM public.bookings WHERE promoter_id = (select auth.uid()))
  );

-- payments
DROP POLICY IF EXISTS "Users can view own payments" ON public.payments;
CREATE POLICY "Users can view own payments" ON public.payments
  FOR SELECT USING (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE promoter_id = (select auth.uid())
         OR artist_id IN (SELECT a.id FROM public.artists a WHERE a.profile_id = (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Promoters can create payments" ON public.payments;
CREATE POLICY "Promoters can create payments" ON public.payments
  FOR INSERT WITH CHECK (
    booking_id IN (SELECT id FROM public.bookings WHERE promoter_id = (select auth.uid()))
    AND public.current_role() = 'promoter'
  );

DROP POLICY IF EXISTS "Promoters can update own payments" ON public.payments;
CREATE POLICY "Promoters can update own payments" ON public.payments
  FOR UPDATE USING (
    booking_id IN (SELECT id FROM public.bookings WHERE promoter_id = (select auth.uid()))
  );

-- messages
DROP POLICY IF EXISTS "Users can view own messages" ON public.messages;
CREATE POLICY "Users can view own messages" ON public.messages
  FOR SELECT USING (sender_id = (select auth.uid()) OR receiver_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
CREATE POLICY "Users can send messages" ON public.messages
  FOR INSERT WITH CHECK (
    sender_id = (select auth.uid())
    AND (
      booking_id IS NULL
      OR booking_id IN (
        SELECT id FROM public.bookings
        WHERE promoter_id = (select auth.uid())
           OR artist_id IN (SELECT a.id FROM public.artists a WHERE a.profile_id = (select auth.uid()))
      )
    )
  );

DROP POLICY IF EXISTS "Users can mark own messages as read" ON public.messages;
CREATE POLICY "Users can mark own messages as read" ON public.messages
  FOR UPDATE USING (receiver_id = (select auth.uid()));

-- invitations
DROP POLICY IF EXISTS "Users can insert invitations" ON public.invitations;
CREATE POLICY "Users can insert invitations" ON public.invitations
  FOR INSERT WITH CHECK (invited_by = (select auth.uid()));

-- ── 3. Invitations: consolidate overlapping SELECT policies ──
-- Previously: "Anyone can view invitation by token" (qual = true) +
--             "Users can view their own invitations" (qual = invited_by = auth.uid())
-- The first is a strict superset of the second, so the second is dead weight.
-- Drop it; keep the token-based lookup as the single SELECT policy.
DROP POLICY IF EXISTS "Users can view their own invitations" ON public.invitations;