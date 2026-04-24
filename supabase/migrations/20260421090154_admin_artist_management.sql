-- Admin artist-management helpers.
-- Backfilled into the repo on 2026-04-24.
--
-- Purpose: let a hardcoded allowlist of admin emails UPDATE artists.status
-- (promote pending -> active, deactivate, verify, etc.) without
-- unclaiming unrelated rows or building a full role system.
--
-- Why an email allowlist instead of a new role?
--   * Only 1-2 people need it for MVP.
--   * Avoids a full RBAC/permission system.
--   * Trigger from yesterday (profiles_lock_role) prevents clients from
--     self-promoting anyway.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND email IN (
        'h.saied@outlook.com',
        'beyondtech.eg@gmail.com'
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Admin UPDATE policy on artists. Stacks with the existing
-- 'Artists can update own listing' policy — a row is updatable if
-- EITHER the artist owns it OR the caller is admin.
DROP POLICY IF EXISTS "Admins can update any artist" ON public.artists;
CREATE POLICY "Admins can update any artist" ON public.artists
  FOR UPDATE USING (public.is_admin());

-- Admin INSERT policy — lets us seed more unclaimed artists from the UI
-- without needing service-role. profile_id must still be NULL (unclaimed)
-- so we can't hijack someone's real account.
DROP POLICY IF EXISTS "Admins can insert unclaimed artists" ON public.artists;
CREATE POLICY "Admins can insert unclaimed artists" ON public.artists
  FOR INSERT WITH CHECK (
    public.is_admin()
    AND profile_id IS NULL
  );

-- Admin DELETE on unclaimed artists. Claimed rows stay locked so we can
-- never accidentally nuke a real signed-up artist from the UI.
DROP POLICY IF EXISTS "Admins can delete unclaimed artists" ON public.artists;
CREATE POLICY "Admins can delete unclaimed artists" ON public.artists
  FOR DELETE USING (
    public.is_admin()
    AND profile_id IS NULL
  );
