-- ═══════════════════════════════════════════════════════════
-- Observability tables: client_errors + cron_runs
--
-- client_errors: every uncaught JS error / unhandled rejection /
--   manual logError() call from the browser. Anyone can INSERT
--   (including anon pre-login errors); only admins SELECT via RLS.
--   30-day retention via pg_cron so it can't balloon unbounded.
--
-- cron_runs: observability for pg_cron-triggered edge functions.
--   Each invocation writes a row with duration + status. Health
--   endpoint reads the latest row per job to answer "is the cron
--   still firing?".
--
-- Applied live via Supabase MCP on 2026-04-23.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.client_errors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  url        text,
  user_agent text,
  build      text,
  message    text,
  stack      text,
  context    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_errors_created
  ON public.client_errors (created_at DESC);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can log errors" ON public.client_errors;
CREATE POLICY "Anyone can log errors"
  ON public.client_errors
  FOR INSERT
  WITH CHECK (
    COALESCE(length(message), 0) <= 2000
    AND COALESCE(length(stack), 0) <= 8000
  );

DROP POLICY IF EXISTS "Admins read errors" ON public.client_errors;
CREATE POLICY "Admins read errors"
  ON public.client_errors
  FOR SELECT
  USING (public.is_admin());

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'prune-client-errors';
SELECT cron.schedule(
  'prune-client-errors',
  '0 3 * * *',
  $$DELETE FROM public.client_errors WHERE created_at < now() - interval '30 days';$$
);

-- ─── cron_runs ───
CREATE TABLE IF NOT EXISTS public.cron_runs (
  id          bigserial PRIMARY KEY,
  job         text NOT NULL,
  status      text NOT NULL,
  duration_ms int,
  error       text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ran_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_time
  ON public.cron_runs (job, ran_at DESC);

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read cron runs" ON public.cron_runs;
CREATE POLICY "Admins read cron runs"
  ON public.cron_runs
  FOR SELECT
  USING (public.is_admin());

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'prune-cron-runs';
SELECT cron.schedule(
  'prune-cron-runs',
  '0 4 * * 0',
  $$DELETE FROM public.cron_runs WHERE ran_at < now() - interval '90 days';$$
);
