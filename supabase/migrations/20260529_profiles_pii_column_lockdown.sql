-- 20260529_profiles_pii_column_lockdown.sql
-- 🔴 PRE-LAUNCH SECURITY FIX — close the profiles email/phone PII leak.
--
-- Finding (2026-05-29 pre-launch audit): the "Profiles readable by all"
-- RLS policy is USING(true), and the anon role holds a TABLE-WIDE SELECT
-- grant on profiles (Supabase's default GRANT to anon/authenticated, which
-- relies entirely on RLS to constrain). Verified via
-- `SET ROLE anon; SELECT count(email) FROM profiles` → returned all 16
-- emails. An anonymous, logged-out visitor (or a scraper with the public
-- anon key) can harvest every user's email address. Contradicts the
-- privacy policy ("private fields surface only to confirmed booking
-- partners"); a UAE-PDPL / GDPR concern.
--
-- Why a column-level REVOKE alone does NOT work: in Postgres a table-wide
-- `GRANT SELECT ON profiles` implies SELECT on every column, so a
-- `REVOKE SELECT (email)` is a no-op while the table grant exists. The
-- correct pattern is: REVOKE the table-wide SELECT from anon, then GRANT
-- SELECT back on ONLY the columns the public directory legitimately needs.
-- RLS still applies on top (rows visible per the USING(true) policy); we're
-- narrowing the COLUMN set, not the row set.
--
-- Public-safe columns (what the directory / EPK / Linktree render for
-- logged-out visitors): id, display_name, avatar_url, city, bio, role,
-- created_at, notification_prefs (the last is non-sensitive defaults).
-- Excluded from anon: email, phone, company (company is arguably public
-- but promoters' company isn't shown on public artist surfaces; keep it
-- out of anon to be conservative — it's only read by authenticated flows).
--
-- authenticated keeps its table-wide SELECT (booking-partner +
-- own-row reads still need email/phone). Tightening authenticated to
-- own-row+partners-only is the documented follow-up (smaller blast
-- radius — requires an account).
--
-- Server-side code (SECURITY DEFINER funcs, edge functions on the
-- service-role key) is unaffected — they bypass these grants entirely.

-- 1. Drop the over-broad table-wide SELECT for anon.
REVOKE SELECT ON public.profiles FROM anon;

-- 2. Grant SELECT back on only the public-safe columns.
GRANT SELECT (
  id,
  display_name,
  avatar_url,
  city,
  bio,
  role,
  created_at,
  notification_prefs
) ON public.profiles TO anon;

-- 3. While here: anon has no business with write privileges on profiles
--    (account creation runs through the signup edge function on the
--    service-role key, never a direct anon INSERT). RLS already blocks
--    cross-row writes, but removing the grants is defense-in-depth and
--    shrinks the surface. authenticated retains its own-row write policy.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.profiles FROM anon;

COMMENT ON COLUMN public.profiles.email IS
  'PII. anon SELECT removed 2026-05-29 (pre-launch leak fix — table-wide '
  'SELECT revoked from anon, column re-granted excluding email/phone). '
  'Readable by authenticated (booking partners + own row) and SECURITY '
  'DEFINER funcs only.';
COMMENT ON COLUMN public.profiles.phone IS
  'PII. anon SELECT removed 2026-05-29 (pre-launch leak fix). Same access '
  'rules as email.';
