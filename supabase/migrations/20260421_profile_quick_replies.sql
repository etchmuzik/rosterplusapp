-- Saved message templates per user. Array of short strings; the
-- template body IS the label (no separate name field needed yet).
-- UI falls back to role-appropriate starter suggestions when the
-- array is empty.
--
-- Applied live via Supabase MCP on 2026-04-21.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS quick_replies jsonb NOT NULL DEFAULT '[]'::jsonb;
