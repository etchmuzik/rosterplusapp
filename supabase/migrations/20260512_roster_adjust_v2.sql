-- Second pre-launch roster adjustment (operator request, 2026-05-12).
--
-- Final verified-active roster after this migration:
--   ANTURAGE · ASHKAN K · BOREY · EPI · ETCH · Eva Kim · HIGHLITE ·
--   IMEN · Katrin Losa · LITH K · SARABI
--
-- Changes:
--   - Soft-delete Goomgum + ENAI (deleted_at = now()).
--     Soft-delete (not hard) so the rows survive for audit history
--     and the operator can restore by clearing deleted_at if needed.
--   - Promote + rename Katrina Losa → Katrin Losa (status: pending →
--     active, verified: false → true). Assumes same artist, just the
--     canonical spelling. Cities/genre preserved (Moscow / Tech House).
--   - Insert LITH K, Sarabi, Borey as new unclaimed scout rows
--     matching the EPI/IMEN shape (Dubai, House+Electronic, AED,
--     active+verified, profile_id NULL).
--
-- Idempotent: re-running is safe.
--   - Soft-delete UPDATEs are no-ops on already-deleted rows.
--   - Rename UPDATE is a no-op once the rename happened.
--   - INSERT uses the same partial unique index as the first seed
--     migration (artists_stage_name_unclaimed_unique).

-- ── 1. Soft-delete Goomgum ────────────────────────────────────────
UPDATE public.artists
   SET deleted_at = now(),
       updated_at = now()
 WHERE stage_name = 'Goomgum'
   AND deleted_at IS NULL;

-- ── 2. Soft-delete ENAI ───────────────────────────────────────────
UPDATE public.artists
   SET deleted_at = now(),
       updated_at = now()
 WHERE stage_name = 'ENAI'
   AND deleted_at IS NULL;

-- ── 3. Promote + rename Katrina Losa → Katrin Losa ────────────────
UPDATE public.artists
   SET stage_name = 'Katrin Losa',
       status     = 'active',
       verified   = true,
       updated_at = now()
 WHERE stage_name = 'Katrina Losa'
   AND profile_id IS NULL;

-- ── 4. Insert LITH K, Sarabi, Borey ───────────────────────────────
INSERT INTO public.artists
  (profile_id, stage_name, genre, cities_active, base_fee, currency, status, social_links, verified)
VALUES
  (NULL, 'LITH K', ARRAY['House','Electronic'], ARRAY['Dubai'], NULL, 'AED', 'active', '{}'::jsonb, true),
  (NULL, 'Sarabi', ARRAY['House','Electronic'], ARRAY['Dubai'], NULL, 'AED', 'active', '{}'::jsonb, true),
  (NULL, 'Borey',  ARRAY['House','Electronic'], ARRAY['Dubai'], NULL, 'AED', 'active', '{}'::jsonb, true)
ON CONFLICT (stage_name) WHERE profile_id IS NULL AND deleted_at IS NULL DO NOTHING;
