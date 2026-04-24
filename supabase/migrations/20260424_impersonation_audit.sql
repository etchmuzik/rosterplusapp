-- Client-side impersonation audit.
-- Applied live via MCP on 2026-04-24.
--
-- Lets the browser stamp admin_audit_log from within an impersonation
-- session. The admin's email is passed in by the client (stashed in
-- localStorage at impersonate-start). SECURITY DEFINER allows writing
-- into the audit table without opening up INSERT to every authenticated
-- user. Rows carry meta.impersonating=true so the audit-log UI can
-- filter or highlight them.

CREATE OR REPLACE FUNCTION public.log_impersonation_event(
  p_admin_email text,
  p_action      text,
  p_target_type text DEFAULT NULL,
  p_target_id   uuid DEFAULT NULL,
  p_meta        jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me       uuid := auth.uid();
  v_my_email text;
  v_id       bigint;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT email INTO v_my_email FROM auth.users WHERE id = v_me;

  INSERT INTO public.admin_audit_log(
    actor_id, actor_email, action, target_type, target_id, meta
  ) VALUES (
    v_me,
    v_my_email,
    p_action,
    p_target_type,
    p_target_id,
    jsonb_build_object(
      'impersonating',    true,
      'admin_email',      p_admin_email,
      'impersonated_uid', v_me
    ) || COALESCE(p_meta, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_impersonation_event(text, text, text, uuid, jsonb) TO authenticated;
