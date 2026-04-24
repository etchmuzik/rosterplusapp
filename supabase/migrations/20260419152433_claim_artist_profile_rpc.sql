-- Artist profile claim flow.
-- Backfilled into the repo on 2026-04-24.
--
-- Context: artists are pre-seeded in public.artists with
-- profile_id = NULL (unclaimed) before they sign up. After signup,
-- an artist calls claim_artist_profile(artist_id) to link their
-- new auth.uid() to an unclaimed row, instead of creating a new row.
--
-- Safety: SECURITY DEFINER. Enforces that
--   (a) caller is authenticated,
--   (b) caller has role='artist' in profiles,
--   (c) target artist row has profile_id IS NULL (not already claimed),
--   (d) caller does not already own an artist row (prevents multi-claim).

CREATE OR REPLACE FUNCTION public.claim_artist_profile(target_artist_id UUID)
RETURNS public.artists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimant_role TEXT;
  existing_claim UUID;
  updated_row public.artists%ROWTYPE;
BEGIN
  -- 1. Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 2. Caller must be an artist
  SELECT role INTO claimant_role FROM public.profiles WHERE id = auth.uid();
  IF claimant_role IS DISTINCT FROM 'artist' THEN
    RAISE EXCEPTION 'only_artists_can_claim';
  END IF;

  -- 3. Caller must not already own an artist row
  SELECT id INTO existing_claim FROM public.artists WHERE profile_id = auth.uid() LIMIT 1;
  IF existing_claim IS NOT NULL THEN
    RAISE EXCEPTION 'already_has_artist_profile';
  END IF;

  -- 4. Target must exist and be unclaimed
  UPDATE public.artists
     SET profile_id = auth.uid(),
         updated_at = now()
   WHERE id = target_artist_id
     AND profile_id IS NULL
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'artist_not_found_or_already_claimed';
  END IF;

  RETURN updated_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_artist_profile(UUID) TO authenticated;
