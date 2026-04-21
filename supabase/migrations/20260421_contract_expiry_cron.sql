-- ═══════════════════════════════════════════════════════════
-- Contract expiry automation
--
-- Applied live via Supabase MCP on 2026-04-21.
-- File kept in the repo so future re-bootstraps stay in sync.
-- ═══════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

CREATE OR REPLACE FUNCTION public.expire_stale_contracts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE public.contracts
       SET status = 'expired'
     WHERE expires_at IS NOT NULL
       AND expires_at < NOW()
       AND status NOT IN ('signed', 'expired', 'cancelled')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM expired;
  RETURN v_count;
END;
$$;

-- Drop any prior schedule with this name so re-running the migration
-- doesn't stack duplicate jobs.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'expire-stale-contracts';

-- Run every day at 02:00 UTC (≈ 06:00 Dubai).
SELECT cron.schedule(
  'expire-stale-contracts',
  '0 2 * * *',
  $$SELECT public.expire_stale_contracts();$$
);
