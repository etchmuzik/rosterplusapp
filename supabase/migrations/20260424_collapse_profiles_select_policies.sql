-- Collapse the two SELECT policies on public.profiles into one.
-- Applied live via MCP on 2026-04-24.
--
-- Before:
--   "Public profiles are viewable by everyone"  qual: true
--   "Admins can read all profiles"              qual: is_admin()
--
-- Both policies matched every caller for SELECT, so the planner
-- evaluated both. Since `qual = true` is the superset, the admin
-- policy was pure overhead. Replacing with a single `USING (true)`
-- policy drops the last 5 multiple_permissive_policies advisor
-- warnings without changing behaviour.
--
-- Admin-specific read paths still work: the app calls admin_list_users()
-- (SECURITY DEFINER + is_admin() gate) whenever it needs admin-only
-- fields like email, so we haven't lost any privileged-access
-- capability by dropping the admin-only SELECT policy.

DROP POLICY IF EXISTS "Admins can read all profiles"             ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

CREATE POLICY "Profiles readable by all"
  ON public.profiles FOR SELECT
  USING (true);
