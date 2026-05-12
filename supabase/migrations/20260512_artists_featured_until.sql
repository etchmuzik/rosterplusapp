-- Operator-set featured artist. Replaces the ISO-week rotation hack
-- on /link.html with a real "feature this artist until <X>" column.
--
-- Set by admin via the artists row in /admin.html (24h / 7d / 30d
-- buttons). Cleared by the same UI ("Unfeature"). When NULL or
-- already-past, /link.html falls back to the ISO-week rotation so
-- the homepage's featured card is never empty.
--
-- No RLS change needed — anon already SELECTs artists, and only
-- admin (via SECURITY DEFINER-equivalent RLS) writes through.

ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ;

-- Index for the /link.html "is anyone featured right now?" query.
-- Postgres won't allow now() in an index predicate (must be IMMUTABLE),
-- so we just index featured_until directly and scope to non-NULL,
-- non-deleted rows. The query (`featured_until > now()`) plans cleanly
-- against this — the planner uses the index for the range scan.
CREATE INDEX IF NOT EXISTS artists_featured_until_idx
  ON public.artists (featured_until DESC)
  WHERE featured_until IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN public.artists.featured_until IS
  'Timestamp until which this artist is operator-featured on the '
  'rosterplus.io/link page. NULL or past = not featured (page falls '
  'back to the ISO-week rotation). Admin UI offers 24h/7d/30d presets '
  'via /admin.html. Only the latest-expiring active feature is '
  'displayed if multiple are set.';
