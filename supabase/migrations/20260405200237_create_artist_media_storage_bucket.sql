-- Storage bucket for artist avatars / EPK gallery.
-- Backfilled into the repo on 2026-04-24.
--
-- Public read, authenticated write. 10 MB cap. Allowed types:
-- JPEG, PNG, WebP, GIF, PDF.
-- The storage_tighten_artist_media migration (2026-04-19) later
-- strengthens the ownership rules — path-prefix-based ownership so
-- user A can't overwrite user B's files.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'artist-media',
  'artist-media',
  true,
  10485760,  -- 10MB limit
  ARRAY['image/jpeg','image/png','image/webp','image/gif','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read
CREATE POLICY "Public read artist media" ON storage.objects
  FOR SELECT USING (bucket_id = 'artist-media');

-- Allow authenticated users to upload
CREATE POLICY "Authenticated upload artist media" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'artist-media' AND auth.uid() IS NOT NULL
  );

-- Allow owners to update/delete their files
CREATE POLICY "Owners can update their media" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'artist-media' AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can delete their media" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'artist-media' AND auth.uid()::text = (storage.foldername(name))[1]
  );
