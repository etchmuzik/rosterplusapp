-- Admins can update any booking — needed for Change Status and future
-- reassignment actions from the admin console + booking-detail page.
-- Combined with existing "Involved parties can update bookings" via OR.
--
-- Applied live via Supabase MCP on 2026-04-23.

DROP POLICY IF EXISTS "Admins can update any booking" ON public.bookings;
CREATE POLICY "Admins can update any booking"
  ON public.bookings FOR UPDATE
  USING (public.is_admin());
