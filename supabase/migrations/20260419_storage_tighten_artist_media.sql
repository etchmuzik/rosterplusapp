-- ═══════════════════════════════════════════════════════════
-- Storage hardening: close the bucket-listing surface on `artist-media`.
--
-- Supabase advisor flag: public_bucket_allows_listing.
-- The broad SELECT policy on storage.objects let any client enumerate every
-- file in the bucket via the Storage list API. Nothing in this codebase uses
-- .list() — we only call getPublicUrl() and embed the result in <img>/<audio>.
--
-- Because `storage.buckets.public = true` for `artist-media`, direct object
-- URL reads continue working via Supabase's public object-serving path even
-- after this policy is dropped. INSERT / UPDATE / DELETE policies are left
-- intact (authenticated upload, owner-scoped modify/delete).
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Public read artist media" ON storage.objects;
