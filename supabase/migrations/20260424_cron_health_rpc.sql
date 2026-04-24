-- Cron health summary RPC.
-- Applied live via MCP on 2026-04-24.
--
-- One row per scheduled job with the last-run status, 24h + 7d pass/fail
-- counts, and the last-10-runs array for a heatmap sparkline. Powers
-- the "Per-job health" panel on /admin.html → Health tab.
--
-- Gated on is_admin() so non-admins see an empty result even if someone
-- calls the RPC directly.

CREATE OR REPLACE FUNCTION public.cron_health_summary()
RETURNS TABLE (
  job           text,
  last_ran_at   timestamptz,
  last_status   text,
  last_error    text,
  runs_24h      bigint,
  failures_24h  bigint,
  runs_7d       bigint,
  failures_7d   bigint,
  last_10       jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT
      job,
      status,
      duration_ms,
      error,
      ran_at,
      row_number() OVER (PARTITION BY job ORDER BY ran_at DESC) AS rn
    FROM public.cron_runs
  ),
  last10 AS (
    SELECT job,
           jsonb_agg(
             jsonb_build_object(
               'status',      status,
               'ran_at',      ran_at,
               'duration_ms', duration_ms,
               'error',       error
             )
             ORDER BY ran_at DESC
           ) AS arr
    FROM ranked
    WHERE rn <= 10
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
    SELECT DISTINCT ON (job)
      job, status, error
    FROM public.cron_runs
    ORDER BY job, ran_at DESC
  )
  SELECT
    w.job,
    w.last_ran_at,
    ls.status        AS last_status,
    ls.error         AS last_error,
    w.runs_24h,
    w.failures_24h,
    w.runs_7d,
    w.failures_7d,
    COALESCE(l.arr, '[]'::jsonb) AS last_10
  FROM windowed w
  LEFT JOIN last_status ls ON ls.job = w.job
  LEFT JOIN last10 l       ON l.job  = w.job
  WHERE public.is_admin()
  ORDER BY w.last_ran_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.cron_health_summary() TO authenticated;
