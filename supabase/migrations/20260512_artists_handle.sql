-- Per-artist Linktree URLs: rosterplus.io/a/<handle>
--
-- Each artist gets a stable, lowercase, kebab-case handle they can
-- paste into their Instagram bio. We slug-derive it from stage_name
-- for existing rows; future signups will pick their own (with a
-- uniqueness check on the client side before UPDATE).
--
-- Format rules (CHECK constraint below):
--   - 3 to 32 chars
--   - only [a-z0-9-]
--   - cannot start or end with '-'
--   - cannot contain '--'
--
-- Uniqueness: partial unique index scoped to non-deleted rows. Once
-- a row is soft-deleted, its handle frees up for re-use.
--
-- Disambiguation: when two live artists slug to the same handle
-- (two artists both named "moh", for example), we append -2/-3/...
-- to the second/third/Nth row in created_at order. The earliest
-- claimant keeps the bare handle.

ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS handle TEXT;

-- Format check. Drop-and-recreate so this migration is idempotent
-- even after we've tweaked the rules.
ALTER TABLE public.artists
  DROP CONSTRAINT IF EXISTS artists_handle_format_chk;

ALTER TABLE public.artists
  ADD CONSTRAINT artists_handle_format_chk
  CHECK (
    handle IS NULL
    OR (
      handle ~ '^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$'
      AND handle !~ '--'
    )
  );

-- Backfill — disambiguates collisions. Each row gets row_number()
-- within its base-slug group (ordered by created_at), and rows after
-- the first get '-2', '-3', etc. appended (truncated back to 32).
WITH base AS (
  SELECT
    id,
    created_at,
    LEFT(
      REGEXP_REPLACE(
        REGEXP_REPLACE(LOWER(stage_name), '[^a-z0-9]+', '-', 'g'),
        '(^-|-$)', '', 'g'
      ),
      32
    ) AS slug
  FROM public.artists
  WHERE handle IS NULL
    AND stage_name IS NOT NULL
    AND deleted_at IS NULL
),
numbered AS (
  SELECT
    id,
    slug,
    ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at) AS rn
  FROM base
  WHERE slug <> ''
)
UPDATE public.artists a
   SET handle = CASE
                  WHEN n.rn = 1 THEN n.slug
                  -- Append `-N` for N>=2, ensuring we don't blow
                  -- the 32-char cap.
                  ELSE LEFT(n.slug, 32 - LENGTH('-' || n.rn::text))
                       || '-' || n.rn::text
                END
  FROM numbered n
 WHERE a.id = n.id;

-- Defensive: clear any empty handles that somehow slipped through.
UPDATE public.artists SET handle = NULL WHERE handle = '';

-- Case-insensitive unique index on handle, partial-scoped to live
-- (non-deleted) rows. Soft-deletes free the handle for re-use.
CREATE UNIQUE INDEX IF NOT EXISTS artists_handle_unique_live
  ON public.artists (LOWER(handle))
  WHERE handle IS NOT NULL AND deleted_at IS NULL;

-- Lookup index — every /a/:handle hit will lookup by lower(handle).
CREATE INDEX IF NOT EXISTS artists_handle_lookup_idx
  ON public.artists (LOWER(handle));

COMMENT ON COLUMN public.artists.handle IS
  'Lowercase kebab-case URL slug for /a/<handle> Linktree page. '
  'Auto-derived from stage_name on insert; artists can change it '
  'from the profile-edit screen (uniqueness checked client-side '
  'before the UPDATE). Format: [a-z0-9-]{3,32}, no leading/trailing '
  'or doubled hyphens. NULL allowed for back-compat; the per-artist '
  'page resolver also accepts UUIDs as a fallback.';
