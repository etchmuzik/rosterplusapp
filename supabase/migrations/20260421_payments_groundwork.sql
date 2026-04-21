-- ═══════════════════════════════════════════════════════════
-- Payments groundwork — applied live via Supabase MCP on 2026-04-21.
-- File kept in the repo so future re-bootstraps stay in sync.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider             TEXT DEFAULT 'manual'
    CHECK (provider IN ('manual', 'stripe', 'tap', 'bank')),
  ADD COLUMN IF NOT EXISTS promoter_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS artist_confirmed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_reference     TEXT,
  ADD COLUMN IF NOT EXISTS notes                TEXT;

CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START 1000;

CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  n BIGINT;
BEGIN
  n := nextval('public.invoice_number_seq');
  RETURN 'ROS-' || LPAD(n::TEXT, 6, '0');
END;
$$;

DROP POLICY IF EXISTS "Artists can confirm payment received" ON public.payments;
CREATE POLICY "Artists can confirm payment received" ON public.payments
  FOR UPDATE USING (
    booking_id IN (
      SELECT b.id FROM public.bookings b
      WHERE b.artist_id IN (
        SELECT a.id FROM public.artists a WHERE a.profile_id = (SELECT auth.uid())
      )
    )
  );

CREATE INDEX IF NOT EXISTS idx_payments_artist_confirmed
  ON public.payments(artist_confirmed_at) WHERE artist_confirmed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_promoter_recorded
  ON public.payments(promoter_recorded_at) WHERE promoter_recorded_at IS NOT NULL;
