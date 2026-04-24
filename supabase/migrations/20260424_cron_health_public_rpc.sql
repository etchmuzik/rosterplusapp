-- Public cron health summary — anonymized version of cron_health_summary
-- for /status.html. Applied live via MCP on 2026-04-24.
--
-- Differences from the admin RPC:
--   - No is_admin() gate — anon + authenticated both granted EXECUTE
--   - No error strings in the output (could leak stack traces / customer
--     data / internal URLs to the public)
--   - No duration_ms (useless noise for end users; operators get it from
--     the admin surface)
--   - last_10 carries only {status, ran_at} per run

CREATE OR REPLACE FUNCTION public.cron_health_public()
RETURNS TABLE (
  job          text,
  last_ran_at  timestamptz,
  last_status  text,
  runs_24h     bigint,
  failures_24h bigint,
  runs_7d      bigint,
  failures_7d  bigint,
  last_10      jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT job, status, ran_at,
      row_number() OVER (PARTITION BY job ORDER BY ran_at DESC) AS rn
    FROM public.cron_runs
  ),
  last10 AS (
    SELECT job,
           jsonb_agg(
             jsonb_build_object('status', status, 'ran_at', ran_at)
             ORDER BY ran_at DESC
           ) AS arr
    FROM ranked WHERE rn <= 10
    GROUP BY job
  ),
  windowed AS (
    SELECT
      job,
      MAX(ran_at) AS last_ran_at,
      COUNT(*) FILTER (WHERE ran_at >= now() - interval '24 hours') AS runs_24h,
      COUNT(*) FILTER (WHERE ran_at >= now() - interval '24 hours' AND status = 'error') AS failures_24h,
      COUNT(*) FILTER (WHERE ran_at >= now() - interval '7 days')   AS runs_7d,
      COUNT(*) FILTER (WHERE ran_at >= now() - interval '7 days'   AND status = 'error') AS failures_7d
    FROM public.cron_runs
    GROUP BY job
  ),
  last_status AS (
    SELECT DISTINCT ON (job) job, status
    FROM public.cron_runs
    ORDER BY job, ran_at DESC
  )
  SELECT
    w.job, w.last_ran_at, ls.status AS last_status,
    w.runs_24h, w.failures_24h, w.runs_7d, w.failures_7d,
    COALESCE(l.arr, '[]'::jsonb) AS last_10
  FROM windowed w
  LEFT JOIN last_status ls ON ls.job = w.job
  LEFT JOIN last10 l       ON l.job  = w.job
  ORDER BY w.last_ran_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.cron_health_public() TO anon, authenticated;
