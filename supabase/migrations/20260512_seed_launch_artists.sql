-- Pre-launch seed: bring the public artist roster up to the six names
-- the operator wants visible on the homepage / directory at go-live.
--
-- Roster (post-migration, all status=active, verified=true, unclaimed):
--   ETCH      (renamed from "Etch EG")
--   EPI       (already present, untouched)
--   HIGHLITE  (promoted from status=pending; renamed from "Highlite")
--   IMEN      (new)
--   ASHKAN K  (new)
--   ANTURAGE  (new)
--
-- All inserts are idempotent: ON CONFLICT (stage_name) DO NOTHING relies
-- on the optional unique constraint we add at the top. If the constraint
-- already exists (re-run), the IF NOT EXISTS guard makes this safe.
--
-- Renames + promotions use UPDATE ... WHERE stage_name = '<old>' so a
-- re-run after the rename happened is a no-op (zero rows updated).

-- ── 0. Ensure unique-by-stage_name so ON CONFLICT works ───────────
--
-- The artists table didn't have a stage_name uniqueness constraint
-- before this migration. Two duplicate "moh" rows exist (different
-- profile_ids). For seeded/unclaimed scout rows we want exactly one
-- per stage_name. Use a partial unique index scoped to unclaimed
-- (profile_id IS NULL) so it doesn't conflict with the existing
-- claimed duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS artists_stage_name_unclaimed_unique
  ON public.artists (stage_name)
  WHERE profile_id IS NULL AND deleted_at IS NULL;

-- ── 1. Rename "Etch EG" → "ETCH" ──────────────────────────────────
-- The audit found Etch EG as an unclaimed seeded row (verified, active,
-- Dubai + Cairo, House/Electronic). The operator wants the canonical
-- stage name to be ETCH. Same artist, no other changes.
UPDATE public.artists
   SET stage_name = 'ETCH',
       updated_at = now()
 WHERE stage_name = 'Etch EG'
   AND profile_id IS NULL;

-- ── 2. Promote "Highlite" → active+verified, rename to "HIGHLITE" ─
-- Was status=pending (hidden from public directory) since the initial
-- 14-artist seed. Operator confirmed promotion + uppercase rename.
UPDATE public.artists
   SET stage_name = 'HIGHLITE',
       status     = 'active',
       verified   = true,
       updated_at = now()
 WHERE stage_name = 'Highlite'
   AND profile_id IS NULL;

-- ── 3. Insert IMEN / ASHKAN K / ANTURAGE ──────────────────────────
-- Match the shape of the EPI row in 20260419151629_seed_initial_14_artists.sql:
--   profile_id NULL (unclaimed), verified=true, status=active, currency=AED,
--   social_links={}, base_fee NULL (on request).
-- Genre/cities default: ['House','Electronic'] + ['Dubai'] per operator's
-- "House / Electronic — Dubai" answer in the planning round.
--
-- ON CONFLICT (stage_name) DO NOTHING via the partial unique index above
-- means re-running this migration is a no-op.
INSERT INTO public.artists
  (profile_id, stage_name, genre, cities_active, base_fee, currency, status, social_links, verified)
VALUES
  (NULL, 'IMEN',     ARRAY['House','Electronic'], ARRAY['Dubai'], NULL, 'AED', 'active', '{}'::jsonb, true),
  (NULL, 'ASHKAN K', ARRAY['House','Electronic'], ARRAY['Dubai'], NULL, 'AED', 'active', '{}'::jsonb, true),
  (NULL, 'ANTURAGE', ARRAY['House','Electronic'], ARRAY['Dubai'], NULL, 'AED', 'active', '{}'::jsonb, true)
ON CONFLICT (stage_name) WHERE profile_id IS NULL AND deleted_at IS NULL DO NOTHING;
