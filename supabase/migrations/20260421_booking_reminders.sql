-- ═══════════════════════════════════════════════════════════
-- Booking reminder automation (T-24h)
--
-- Applied live via Supabase MCP on 2026-04-21.
-- File kept in the repo so future re-bootstraps stay in sync.
-- ═══════════════════════════════════════════════════════════

-- pg_net lets pg_cron hit our edge function over HTTPS.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Track when a T-24h reminder has been dispatched for this booking.
-- NULL means not-yet-sent; set once by the edge function so we don't
-- double-fire if cron runs multiple times within the same window.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz NULL;

-- Partial index — cron scans only unsent, event-dated rows, which is
-- a tiny slice of the table.
CREATE INDEX IF NOT EXISTS bookings_pending_reminder_idx
  ON public.bookings (event_date)
  WHERE reminder_sent_at IS NULL
    AND status IN ('confirmed', 'contracted');

-- ─── pg_cron schedule ───
-- Fires every hour on the hour. The edge function itself filters to
-- event_date = CURRENT_DATE + 1 (UTC) and guards via reminder_sent_at,
-- so running hourly is safe and idempotent.
--
-- x-cron-secret header: set app.cron_secret via
--   ALTER DATABASE postgres SET app.cron_secret = '<random-hex>';
-- and the matching CRON_SECRET env var on the edge function. If both
-- are left unset the function accepts any caller (fine for early dev,
-- tighten before opening the URL publicly).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'send-booking-reminders';

SELECT cron.schedule(
  'send-booking-reminders',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://vgjmfpryobsuboukbemr.supabase.co/functions/v1/send-booking-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', coalesce(current_setting('app.cron_secret', true), '')
      ),
      body := '{}'::jsonb
    );
  $$
);
