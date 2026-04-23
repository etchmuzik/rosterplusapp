-- Onboarding drip tracking.
-- Applied live via MCP on 2026-04-23.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_emails_sent jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.onboarding_emails_sent IS
  'JSON map of drip-email key → sent-at timestamp. Guards against duplicate sends.';

-- pg_cron job — fires hourly at minute 30 so it doesn't collide with
-- send-booking-reminders (minute 0).
SELECT cron.schedule(
  'send-artist-onboarding-drip',
  '30 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://vgjmfpryobsuboukbemr.supabase.co/functions/v1/send-artist-onboarding-drip',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', coalesce(current_setting('app.cron_secret', true), '')
      ),
      body := '{}'::jsonb
    );
  $$
);
