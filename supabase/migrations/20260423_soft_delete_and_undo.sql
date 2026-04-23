-- Soft-delete columns on artists/bookings/profiles + admin undo RPC.
-- Applied live via Supabase MCP on 2026-04-23.

ALTER TABLE public.artists  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_artists_alive  ON public.artists  (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_alive ON public.bookings (id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.admin_undo_last_action(
  p_target_type text,
  p_target_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row       public.admin_audit_log%ROWTYPE;
  v_before    jsonb;
  v_after     jsonb;
  v_undo_meta jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_row
    FROM public.admin_audit_log
   WHERE target_type = p_target_type
     AND target_id   = p_target_id
     AND action NOT LIKE '%.undo'
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'no undoable action found for this target';
  END IF;
  v_before := COALESCE(v_row.before_value, '{}'::jsonb);
  v_after  := COALESCE(v_row.after_value,  '{}'::jsonb);
  IF p_target_type = 'artist' THEN
    IF v_before ? 'status'     THEN UPDATE public.artists SET status = v_before->>'status' WHERE id = p_target_id; END IF;
    IF v_before ? 'verified'   THEN UPDATE public.artists SET verified = (v_before->>'verified')::boolean WHERE id = p_target_id; END IF;
    IF v_before ? 'profile_id' THEN UPDATE public.artists SET profile_id = NULLIF(v_before->>'profile_id','')::uuid WHERE id = p_target_id; END IF;
  ELSIF p_target_type = 'booking' THEN
    IF v_before ? 'status' THEN UPDATE public.bookings SET status = v_before->>'status', updated_at = now() WHERE id = p_target_id; END IF;
  ELSIF p_target_type = 'user' THEN
    IF v_before ? 'role' THEN UPDATE public.profiles SET role = v_before->>'role' WHERE id = p_target_id; END IF;
  ELSE
    RAISE EXCEPTION 'unsupported target_type %', p_target_type;
  END IF;
  v_undo_meta := jsonb_build_object('undoes_audit_id', v_row.id, 'undoes_action', v_row.action);
  INSERT INTO public.admin_audit_log(
    actor_id, actor_email, action, target_type, target_id,
    before_value, after_value, meta
  )
  VALUES (
    auth.uid(), public._current_email(),
    v_row.action || '.undo',
    p_target_type, p_target_id,
    v_after, v_before, v_undo_meta
  );
  RETURN jsonb_build_object('undone_action', v_row.action, 'undone_at', v_row.created_at, 'restored', v_before);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_undo_last_action(text, uuid) TO authenticated;
