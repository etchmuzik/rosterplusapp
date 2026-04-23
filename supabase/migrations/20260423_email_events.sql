-- Resend webhook sink. See resend-webhook edge function for populator.
-- Applied live via Supabase MCP on 2026-04-23.

CREATE TABLE IF NOT EXISTS public.email_events (
  id          bigserial PRIMARY KEY,
  resend_id   text,
  type        text NOT NULL,
  to_email    text,
  from_email  text,
  subject     text,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_events_created ON public.email_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_events_type    ON public.email_events (type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_events_resend  ON public.email_events (resend_id);

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read email events" ON public.email_events;
CREATE POLICY "Admins read email events"
  ON public.email_events FOR SELECT
  USING (public.is_admin());

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'prune-email-events';
SELECT cron.schedule(
  'prune-email-events',
  '30 3 * * *',
  $$DELETE FROM public.email_events WHERE created_at < now() - interval '90 days';$$
);

CREATE OR REPLACE FUNCTION public.admin_email_stats(p_since_hours int DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
  v_since timestamptz := now() - (p_since_hours || ' hours')::interval;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'sent',       (SELECT count(*) FROM public.email_events WHERE type IN ('email.sent','email.delivered') AND created_at >= v_since),
    'delivered',  (SELECT count(*) FROM public.email_events WHERE type = 'email.delivered' AND created_at >= v_since),
    'bounced',    (SELECT count(*) FROM public.email_events WHERE type = 'email.bounced' AND created_at >= v_since),
    'complained', (SELECT count(*) FROM public.email_events WHERE type = 'email.complained' AND created_at >= v_since),
    'opened',     (SELECT count(*) FROM public.email_events WHERE type = 'email.opened' AND created_at >= v_since),
    'clicked',    (SELECT count(*) FROM public.email_events WHERE type = 'email.clicked' AND created_at >= v_since),
    'failed',     (SELECT count(*) FROM public.email_events WHERE type IN ('email.bounced','email.complained','email.delivery_delayed') AND created_at >= v_since),
    'since',      v_since
  ) INTO v_out;
  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_email_stats(int) TO authenticated;
