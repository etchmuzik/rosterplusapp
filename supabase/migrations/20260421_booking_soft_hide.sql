-- Each side of a booking can soft-hide it from their own list independently.
-- Hiding is one-way from the UI (we ship an "Unhide" toggle in the filter bar
-- so users can always recover) — it is NOT a mutual delete. The other party's
-- view is unaffected.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS hidden_by_promoter boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_by_artist   boolean NOT NULL DEFAULT false;

-- Partial indexes so the common "show non-hidden bookings" filter stays fast
-- on large lists. We only index the rows that are visible to each side.
CREATE INDEX IF NOT EXISTS bookings_promoter_active_idx
  ON public.bookings (promoter_id, event_date DESC)
  WHERE hidden_by_promoter = false;

CREATE INDEX IF NOT EXISTS bookings_artist_active_idx
  ON public.bookings (artist_id, event_date DESC)
  WHERE hidden_by_artist = false;
