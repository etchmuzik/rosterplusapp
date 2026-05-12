-- 2026-05-13: video_links column on artists.
--
-- Multi-platform video / mix embed support. Stored as a jsonb array so
-- one artist can showcase a SoundCloud mix, a YouTube highlight reel,
-- and a Mixcloud set side-by-side. Each entry: { platform, url, title? }.
--
-- platform enum (client-side validated): 'youtube' | 'soundcloud'
-- | 'mixcloud' | 'vimeo' | 'instagram'.
--
-- Applied via Supabase MCP `apply_migration('artists_video_links', ...)`
-- 2026-05-13. Mirrored here for version control + parity with the
-- rest of the migrations folder.

ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS video_links jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.artists.video_links IS
  'Array of { platform: text, url: text, title?: text }. Rendered on /profile.html and /epk.html as oEmbed iframes when the platform is known, plain links otherwise. Validated client-side; client passes through DB.updateArtistProfile allowlist.';
