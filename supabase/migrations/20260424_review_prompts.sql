-- Post-event review prompt cron.
-- Applied live via MCP on 2026-04-24. Cron job 8.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS review_prompt_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.review_prompt_sent_at IS
  'Timestamp when the post-event review-prompt email was sent to both parties. Null = not yet sent.';

CREATE INDEX IF NOT EXISTS idx_bookings_review_prompt_pending
  ON public.bookings (event_date)
  WHERE review_prompt_sent_at IS NULL
    AND status IN ('confirmed', 'contracted', 'completed');

-- pg_cron job 8 — daily at 10:00 UTC (14:00 GCC, post-lunch inbox window).
-- Each booking's 3-day anniversary only hits this filter once, so the
-- daily cadence is idempotent. Prevents multiple-prompts-per-booking
-- via review_prompt_sent_at guard on the edge function side.
SELECT cron.schedule(
  'send-review-prompts',
  '0 10 * * *',
  $$
    SELECT net.http_post(
      url := 'https://vgjmfpryobsuboukbemr.supabase.co/functions/v1/send-review-prompts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', coalesce(current_setting('app.cron_secret', true), '')
      ),
      body := '{}'::jsonb
    );
  $$
);
