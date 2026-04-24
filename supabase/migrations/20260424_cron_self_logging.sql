-- Self-logging retrofit for the 6 silent cron jobs.
-- Applied live via MCP on 2026-04-24.
--
-- Problem: before this migration only send-booking-reminders and
-- admin-daily-digest wrote rows to cron_runs. The 6 others ran fine
-- (pg_cron kept executing them on schedule) but the /status.html
-- heatmap and admin Health tab both showed them as "never run"
-- because nothing recorded their invocation.
--
-- Solution: unschedule + re-schedule each silent job with a DO block
-- wrapper. The wrapper runs the original command, stamps a cron_runs
-- row via log_cron_run() on success, and logs status='error' with
-- SQLERRM on exceptions.
--
-- Design notes:
-- * Edge-function jobs (net.http_post) log 'ok' optimistically — pg_net
--   is async so we can't inspect the HTTP status here. Real HTTP errors
--   surface in Supabase function logs; only pg_net-layer failures log
--   as 'error' in cron_runs. This is a known trade-off we accept for
--   the sake of simplicity.
-- * prune-cron-runs inserts its own row FIRST, then deletes — so its
--   current run's row survives the prune.

-- ── Helper ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_cron_run(
  p_job         text,
  p_status      text,
  p_duration_ms integer DEFAULT NULL,
  p_error       text    DEFAULT NULL,
  p_meta        jsonb   DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.cron_runs(job, status, duration_ms, error, meta)
  VALUES (p_job, p_status, p_duration_ms, p_error, COALESCE(p_meta, '{}'::jsonb));
$$;

-- ── Reschedule each silent job ───────────────────────────────

-- Job: expire-stale-contracts  (daily @ 02:00 UTC)
SELECT cron.unschedule('expire-stale-contracts');
SELECT cron.schedule(
  'expire-stale-contracts',
  '0 2 * * *',
  $cmd$
    DO $$
    DECLARE
      v_started timestamptz := clock_timestamp();
      v_count   integer;
    BEGIN
      SELECT public.expire_stale_contracts() INTO v_count;
      PERFORM public.log_cron_run(
        'expire-stale-contracts', 'ok',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        NULL,
        jsonb_build_object('expired_count', v_count)
      );
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_run(
        'expire-stale-contracts', 'error',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        SQLERRM, '{}'::jsonb
      );
    END $$;
  $cmd$
);

-- Job: prune-client-errors  (daily @ 03:00)
SELECT cron.unschedule('prune-client-errors');
SELECT cron.schedule(
  'prune-client-errors',
  '0 3 * * *',
  $cmd$
    DO $$
    DECLARE
      v_started timestamptz := clock_timestamp();
      v_count   integer;
    BEGIN
      WITH d AS (DELETE FROM public.client_errors WHERE created_at < now() - interval '30 days' RETURNING 1)
      SELECT count(*) INTO v_count FROM d;
      PERFORM public.log_cron_run(
        'prune-client-errors', 'ok',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        NULL, jsonb_build_object('deleted_count', v_count)
      );
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_run(
        'prune-client-errors', 'error',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        SQLERRM, '{}'::jsonb
      );
    END $$;
  $cmd$
);

-- Job: prune-cron-runs  (weekly Sunday @ 04:00)
SELECT cron.unschedule('prune-cron-runs');
SELECT cron.schedule(
  'prune-cron-runs',
  '0 4 * * 0',
  $cmd$
    DO $$
    DECLARE
      v_started timestamptz := clock_timestamp();
      v_count   integer;
    BEGIN
      WITH d AS (DELETE FROM public.cron_runs WHERE ran_at < now() - interval '90 days' RETURNING 1)
      SELECT count(*) INTO v_count FROM d;
      PERFORM public.log_cron_run(
        'prune-cron-runs', 'ok',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        NULL, jsonb_build_object('deleted_count', v_count)
      );
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_run(
        'prune-cron-runs', 'error',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        SQLERRM, '{}'::jsonb
      );
    END $$;
  $cmd$
);

-- Job: prune-email-events  (daily @ 03:30)
SELECT cron.unschedule('prune-email-events');
SELECT cron.schedule(
  'prune-email-events',
  '30 3 * * *',
  $cmd$
    DO $$
    DECLARE
      v_started timestamptz := clock_timestamp();
      v_count   integer;
    BEGIN
      WITH d AS (DELETE FROM public.email_events WHERE created_at < now() - interval '90 days' RETURNING 1)
      SELECT count(*) INTO v_count FROM d;
      PERFORM public.log_cron_run(
        'prune-email-events', 'ok',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        NULL, jsonb_build_object('deleted_count', v_count)
      );
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_run(
        'prune-email-events', 'error',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        SQLERRM, '{}'::jsonb
      );
    END $$;
  $cmd$
);

-- Job: send-artist-onboarding-drip  (hourly @ :30)
SELECT cron.unschedule('send-artist-onboarding-drip');
SELECT cron.schedule(
  'send-artist-onboarding-drip',
  '30 * * * *',
  $cmd$
    DO $$
    DECLARE
      v_started timestamptz := clock_timestamp();
    BEGIN
      PERFORM net.http_post(
        url := 'https://vgjmfpryobsuboukbemr.supabase.co/functions/v1/send-artist-onboarding-drip',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', coalesce(current_setting('app.cron_secret', true), '')
        ),
        body := '{}'::jsonb
      );
      PERFORM public.log_cron_run(
        'send-artist-onboarding-drip', 'ok',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        NULL, '{}'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_run(
        'send-artist-onboarding-drip', 'error',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        SQLERRM, '{}'::jsonb
      );
    END $$;
  $cmd$
);

-- Job: send-review-prompts  (daily @ 10:00)
SELECT cron.unschedule('send-review-prompts');
SELECT cron.schedule(
  'send-review-prompts',
  '0 10 * * *',
  $cmd$
    DO $$
    DECLARE
      v_started timestamptz := clock_timestamp();
    BEGIN
      PERFORM net.http_post(
        url := 'https://vgjmfpryobsuboukbemr.supabase.co/functions/v1/send-review-prompts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', coalesce(current_setting('app.cron_secret', true), '')
        ),
        body := '{}'::jsonb
      );
      PERFORM public.log_cron_run(
        'send-review-prompts', 'ok',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        NULL, '{}'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_run(
        'send-review-prompts', 'error',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::integer,
        SQLERRM, '{}'::jsonb
      );
    END $$;
  $cmd$
);
