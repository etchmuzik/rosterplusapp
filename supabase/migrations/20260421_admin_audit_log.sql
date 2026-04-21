-- ═══════════════════════════════════════════════════════════
-- Admin audit log
--
-- Append-only record of sensitive administrative actions. Rows are
-- written by two surfaces:
--   1. AFTER triggers on the artists table, capturing status /
--      verified / profile_id changes with before+after values.
--   2. SECURITY DEFINER RPC log_admin_action(), called from the
--      client for actions that don't map cleanly to a single row
--      change (CSV bulk import, etc).
--
-- RLS: only admins (is_admin() = true) can SELECT. No INSERT policy
-- exposed to clients — writes go through the trigger or the RPC.
-- No UPDATE / DELETE — log is append-only from the user's side.
--
-- Applied live via Supabase MCP on 2026-04-21.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id           bigserial PRIMARY KEY,
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email  text,
  action       text NOT NULL,
  target_type  text,
  target_id    uuid,
  before_value jsonb,
  after_value  jsonb,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx
  ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx
  ON public.admin_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx
  ON public.admin_audit_log (target_type, target_id, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read audit log" ON public.admin_audit_log;
CREATE POLICY "Admins read audit log" ON public.admin_audit_log
  FOR SELECT USING (public.is_admin());

CREATE OR REPLACE FUNCTION public._current_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT email FROM auth.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action       text,
  p_target_type  text DEFAULT NULL,
  p_target_id    uuid DEFAULT NULL,
  p_meta         jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.admin_audit_log(actor_id, actor_email, action, target_type, target_id, meta)
  VALUES (auth.uid(), public._current_email(), p_action, p_target_type, p_target_id, COALESCE(p_meta, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_admin_action(text, text, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_artist_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb := '{}'::jsonb;
  v_after  jsonb := '{}'::jsonb;
  v_action text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF COALESCE(OLD.status,'') IS DISTINCT FROM COALESCE(NEW.status,'') THEN
    v_before := v_before || jsonb_build_object('status', OLD.status);
    v_after  := v_after  || jsonb_build_object('status', NEW.status);
  END IF;
  IF COALESCE(OLD.verified,false) IS DISTINCT FROM COALESCE(NEW.verified,false) THEN
    v_before := v_before || jsonb_build_object('verified', OLD.verified);
    v_after  := v_after  || jsonb_build_object('verified', NEW.verified);
  END IF;
  IF OLD.profile_id IS DISTINCT FROM NEW.profile_id THEN
    v_before := v_before || jsonb_build_object('profile_id', OLD.profile_id);
    v_after  := v_after  || jsonb_build_object('profile_id', NEW.profile_id);
  END IF;
  IF v_after = '{}'::jsonb THEN
    RETURN NEW;
  END IF;
  v_action := CASE
    WHEN v_after ? 'verified' AND (v_after->>'verified')::boolean THEN 'artist.verify'
    WHEN v_after ? 'verified' THEN 'artist.unverify'
    WHEN v_after ? 'status'   THEN 'artist.status_change'
    WHEN v_after ? 'profile_id' AND NEW.profile_id IS NOT NULL THEN 'artist.claim'
    WHEN v_after ? 'profile_id' THEN 'artist.unclaim'
    ELSE 'artist.update'
  END;
  INSERT INTO public.admin_audit_log(
    actor_id, actor_email, action, target_type, target_id, before_value, after_value, meta
  )
  VALUES (
    auth.uid(), public._current_email(), v_action, 'artist', NEW.id,
    v_before, v_after, jsonb_build_object('stage_name', NEW.stage_name)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_artist ON public.artists;
CREATE TRIGGER trg_audit_artist
  AFTER UPDATE OF status, verified, profile_id ON public.artists
  FOR EACH ROW EXECUTE FUNCTION public.audit_artist_change();

CREATE OR REPLACE FUNCTION public.audit_artist_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.admin_audit_log(
    actor_id, actor_email, action, target_type, target_id, after_value, meta
  )
  VALUES (
    auth.uid(), public._current_email(), 'artist.create', 'artist', NEW.id,
    jsonb_build_object('stage_name', NEW.stage_name, 'status', NEW.status, 'verified', NEW.verified),
    jsonb_build_object('stage_name', NEW.stage_name)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_artist_insert ON public.artists;
CREATE TRIGGER trg_audit_artist_insert
  AFTER INSERT ON public.artists
  FOR EACH ROW EXECUTE FUNCTION public.audit_artist_insert();
