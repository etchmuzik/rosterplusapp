-- Error-spike alerting infrastructure.
-- 2026-05-17.
--
-- error_spike_alerts: per-message cooldown tracker. The
-- error-spike-alert edge function checks this table to skip messages
-- it already emailed about in the last COOLDOWN_MINUTES (60).
--
-- Cron schedule: every 5 min the function pulls client_errors in a
-- 15-min sliding window, groups by message, and emails admins for any
-- bucket >= HIT_THRESHOLD (5) that isn't in cooldown.

-- ── Cooldown table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.error_spike_alerts (
  message_key   text PRIMARY KEY,
  last_sent_at  timestamptz NOT NULL DEFAULT now(),
  hit_count     integer NOT NULL DEFAULT 0
);

ALTER TABLE public.error_spike_alerts ENABLE ROW LEVEL SECURITY;
-- No client-side access; only the service role (edge function) writes.
-- No policies needed; RLS-on with no policies = locked.

-- Used by the edge function to drop ancient cooldown rows so the table
-- doesn't grow unbounded.
CREATE INDEX IF NOT EXISTS error_spike_alerts_last_sent_idx
  ON public.error_spike_alerts (last_sent_at);

-- ── Cron schedule ───────────────────────────────────────────
-- Idempotent: drop the prior schedule (if any) and re-create. Matches
-- the send-booking-reminders pattern — passes x-cron-secret via
-- the postgres setting app.cron_secret.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'error-spike-alert';
SELECT cron.schedule(
  'error-spike-alert',
  '*/5 * * * *',
  $$
    DO $body$
    DECLARE
      v_started timestamptz := clock_timestamp();
    BEGIN
      PERFORM net.http_post(
        url := 'https://vgjmfpryobsuboukbemr.supabase.co/functions/v1/error-spike-alert',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', coalesce(current_setting('app.cron_secret', true), '')
        ),
        body := '{}'::jsonb
      );
      PERFORM public.log_cron_run(
        'error-spike-alert', 'ok',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        NULL, '{}'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_run(
        'error-spike-alert', 'error',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        SQLERRM, '{}'::jsonb
      );
    END $body$;
  $$
);
