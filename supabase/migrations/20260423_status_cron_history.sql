-- Public-readable 7-day cron roll-up for /status.html.
-- Returns one row per (job, day) with total + error counts so the
-- status strip can render green / red / grey per day without
-- exposing the full cron_runs table.
--
-- Applied live via Supabase MCP on 2026-04-23.
CREATE OR REPLACE FUNCTION public.cron_history_7d(p_job text)
RETURNS TABLE (
  day         date,
  total_runs  bigint,
  error_runs  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH days AS (
    SELECT generate_series(
      date_trunc('day', now() - interval '6 days')::date,
      date_trunc('day', now())::date,
      interval '1 day'
    )::date AS day
  ),
  runs AS (
    SELECT
      date_trunc('day', ran_at)::date AS day,
      count(*)                          AS total,
      count(*) FILTER (WHERE status <> 'ok') AS errors
    FROM public.cron_runs
    WHERE job = p_job
      AND ran_at >= now() - interval '7 days'
    GROUP BY 1
  )
  SELECT
    d.day,
    COALESCE(r.total, 0)  AS total_runs,
    COALESCE(r.errors, 0) AS error_runs
  FROM days d
  LEFT JOIN runs r USING (day)
  ORDER BY d.day;
$$;
GRANT EXECUTE ON FUNCTION public.cron_history_7d(text) TO anon, authenticated;
