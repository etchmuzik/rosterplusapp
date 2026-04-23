-- Admins can read all bookings + all profiles regardless of involvement.
-- Combined with existing "Users can view own..." policies via OR semantics:
-- union of both gives admins full visibility, non-admins see only their
-- own rows.
--
-- Applied live via Supabase MCP on 2026-04-23.

DROP POLICY IF EXISTS "Admins can read all bookings" ON public.bookings;
CREATE POLICY "Admins can read all bookings"
  ON public.bookings FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());
