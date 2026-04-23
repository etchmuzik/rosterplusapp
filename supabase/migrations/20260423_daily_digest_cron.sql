-- Daily admin digest cron. Fires at 05:00 UTC = 09:00 Dubai. Posts to
-- the admin-daily-digest edge function which emails all admin
-- allowlisted addresses a rollup of the last 24h.
--
-- Applied live via Supabase MCP on 2026-04-23.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'admin-daily-digest';
SELECT cron.schedule(
  'admin-daily-digest',
  '0 5 * * *',
  $$
    SELECT net.http_post(
      url := 'https://vgjmfpryobsuboukbemr.supabase.co/functions/v1/admin-daily-digest',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb
    );
  $$
);
