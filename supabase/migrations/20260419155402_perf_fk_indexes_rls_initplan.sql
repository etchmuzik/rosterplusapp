-- Perf cleanup: FK indexes + RLS initplan rewrites + policy dedupe.
-- Backfilled into the repo on 2026-04-24.
--
-- Addresses Supabase advisor warnings:
--   - unindexed_foreign_keys (11 FKs)
--   - auth_rls_initplan (23 policies re-evaluating auth.uid() per row)
--   - multiple_permissive_policies (invitations SELECT overlap)
--
-- Technique for initplan: wrap auth.uid() as (select auth.uid()) so the
-- planner evaluates it once per query instead of per row. Same for the
-- public.current_role() helper.
--
-- Note: the 2026-04-24 consolidate_overlapping_rls_policies migration
-- later replaces some of these bookings policies with merged versions
-- that fold in the admin check. This file captures the intermediate
-- state that was live until then.

-- ── 1. Foreign-key indexes ──
CREATE INDEX IF NOT EXISTS idx_artists_profile_id      ON public.artists(profile_id);
CREATE INDEX IF NOT EXISTS idx_bookings_promoter_id    ON public.bookings(promoter_id);
CREATE INDEX IF NOT EXISTS idx_bookings_artist_id      ON public.bookings(artist_id);
CREATE INDEX IF NOT EXISTS idx_bookings_venue_id       ON public.bookings(venue_id);
CREATE INDEX IF NOT EXISTS idx_contracts_booking_id    ON public.contracts(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id     ON public.payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id      ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_id    ON public.messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_booking_id     ON public.messages(booking_id);
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by  ON public.invitations(invited_by);
CREATE INDEX IF NOT EXISTS idx_venues_created_by       ON public.venues(created_by);

-- Also index artists.status for the directory query (WHERE status='active')
CREATE INDEX IF NOT EXISTS idx_artists_status ON public.artists(status);

-- ── 2. RLS initplan rewrites ──
-- profiles
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING ((SELECT auth.uid()) = id);

-- artists
DROP POLICY IF EXISTS "Artists can insert own listing" ON public.artists;
CREATE POLICY "Artists can insert own listing" ON public.artists
  FOR INSERT WITH CHECK (profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Artists can update own listing" ON public.artists;
CREATE POLICY "Artists can update own listing" ON public.artists
  FOR UPDATE USING (profile_id = (SELECT auth.uid()));

-- venues
DROP POLICY IF EXISTS "Authenticated users can create venues" ON public.venues;
CREATE POLICY "Authenticated users can create venues" ON public.venues
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Venue creators can update" ON public.venues;
CREATE POLICY "Venue creators can update" ON public.venues
  FOR UPDATE USING (created_by = (SELECT auth.uid()));

-- bookings
DROP POLICY IF EXISTS "Users can view own bookings" ON public.bookings;
CREATE POLICY "Users can view own bookings" ON public.bookings
  FOR SELECT USING (
    promoter_id = (SELECT auth.uid())
    OR artist_id IN (SELECT id FROM public.artists WHERE profile_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Promoters can create bookings" ON public.bookings;
CREATE POLICY "Promoters can create bookings" ON public.bookings
  FOR INSERT WITH CHECK (
    promoter_id = (SELECT auth.uid())
    AND (SELECT public.current_role()) = 'promoter'
  );

DROP POLICY IF EXISTS "Involved parties can update bookings" ON public.bookings;
CREATE POLICY "Involved parties can update bookings" ON public.bookings
  FOR UPDATE USING (
    promoter_id = (SELECT auth.uid())
    OR artist_id IN (SELECT id FROM public.artists WHERE profile_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Promoters can delete draft bookings" ON public.bookings;
CREATE POLICY "Promoters can delete draft bookings" ON public.bookings
  FOR DELETE USING (
    promoter_id = (SELECT auth.uid())
    AND status IN ('inquiry', 'pending', 'cancelled')
  );

-- contracts
DROP POLICY IF EXISTS "Users can view own contracts" ON public.contracts;
CREATE POLICY "Users can view own contracts" ON public.contracts
  FOR SELECT USING (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE promoter_id = (SELECT auth.uid())
         OR artist_id IN (SELECT a.id FROM public.artists a WHERE a.profile_id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Users can create contracts for own bookings" ON public.contracts;
CREATE POLICY "Users can create contracts for own bookings" ON public.contracts
  FOR INSERT WITH CHECK (
    booking_id IN (SELECT id FROM public.bookings WHERE promoter_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Parties can sign contracts" ON public.contracts;
CREATE POLICY "Parties can sign contracts" ON public.contracts
  FOR UPDATE USING (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE promoter_id = (SELECT auth.uid())
         OR artist_id IN (SELECT a.id FROM public.artists a WHERE a.profile_id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Promoters can delete draft contracts" ON public.contracts;
CREATE POLICY "Promoters can delete draft contracts" ON public.contracts
  FOR DELETE USING (
    status = 'draft'
    AND booking_id IN (SELECT id FROM public.bookings WHERE promoter_id = (SELECT auth.uid()))
  );

-- payments
DROP POLICY IF EXISTS "Users can view own payments" ON public.payments;
CREATE POLICY "Users can view own payments" ON public.payments
  FOR SELECT USING (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE promoter_id = (SELECT auth.uid())
         OR artist_id IN (SELECT a.id FROM public.artists a WHERE a.profile_id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Promoters can create payments" ON public.payments;
CREATE POLICY "Promoters can create payments" ON public.payments
  FOR INSERT WITH CHECK (
    booking_id IN (SELECT id FROM public.bookings WHERE promoter_id = (SELECT auth.uid()))
    AND (SELECT public.current_role()) = 'promoter'
  );

DROP POLICY IF EXISTS "Promoters can update own payments" ON public.payments;
CREATE POLICY "Promoters can update own payments" ON public.payments
  FOR UPDATE USING (
    booking_id IN (SELECT id FROM public.bookings WHERE promoter_id = (SELECT auth.uid()))
  );

-- messages
DROP POLICY IF EXISTS "Users can view own messages" ON public.messages;
CREATE POLICY "Users can view own messages" ON public.messages
  FOR SELECT USING (
    sender_id = (SELECT auth.uid())
    OR receiver_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
CREATE POLICY "Users can send messages" ON public.messages
  FOR INSERT WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND (
      booking_id IS NULL
      OR booking_id IN (
        SELECT id FROM public.bookings
        WHERE promoter_id = (SELECT auth.uid())
           OR artist_id IN (SELECT a.id FROM public.artists a WHERE a.profile_id = (SELECT auth.uid()))
      )
    )
  );

DROP POLICY IF EXISTS "Users can mark own messages as read" ON public.messages;
CREATE POLICY "Users can mark own messages as read" ON public.messages
  FOR UPDATE USING (receiver_id = (SELECT auth.uid()));

-- invitations
DROP POLICY IF EXISTS "Users can insert invitations" ON public.invitations;
CREATE POLICY "Users can insert invitations" ON public.invitations
  FOR INSERT WITH CHECK (invited_by = (SELECT auth.uid()));

-- ── 3. Invitations: dedupe overlapping SELECT policies ──
-- "Anyone can view invitation by token" is the broader policy (qual=true).
-- "Users can view their own invitations" was redundant because auth'd users
-- were already covered by the broader one. Keep the token one, drop the
-- narrower one.
DROP POLICY IF EXISTS "Users can view their own invitations" ON public.invitations;
