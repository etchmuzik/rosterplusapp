-- 20260518_profiles_notification_prefs.sql
-- Add notification_prefs to profiles so the settings-page toggles
-- (Email / Bookings / Messages / Contracts / Payouts) stop being
-- placebos. Before this migration: each toggle did only a CSS
-- class flip with no persistence and no dispatch-side enforcement.
--
-- Each key defaults to TRUE so existing users see no behavioural
-- change. Opt-out, not opt-in. Keys:
--   email      -- transactional / lifecycle emails routed via Resend
--   bookings   -- new request, accepted, declined, contract sent
--   messages   -- new inbound message in a thread
--   contracts  -- contract signed / countersigned
--   payouts    -- payment recorded, payout cleared (artist-only in UI
--                 but kept on the JSON for promoters too — promoter
--                 toggle is mapped to 'contracts' instead)
--
-- The 'master' email toggle and the per-kind toggles are AND'd at
-- dispatch time: e.g. send-booking-reminder runs only if BOTH
-- prefs.email AND prefs.bookings are true. send-push checks the
-- per-kind flag only (push is a separate channel from email).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT jsonb_build_object(
    'email',     true,
    'bookings',  true,
    'messages',  true,
    'contracts', true,
    'payouts',   true
  );

-- Backfill any rows that somehow ended up with the column NULL
-- (defensive — the DEFAULT above covers the normal path, but if a
-- prior insert raced the ADD COLUMN we don't want NULLs reaching
-- the front-end). Idempotent: applies only where the value is missing.
UPDATE public.profiles
   SET notification_prefs = jsonb_build_object(
         'email',     true,
         'bookings',  true,
         'messages',  true,
         'contracts', true,
         'payouts',   true
       )
 WHERE notification_prefs IS NULL;

-- No RLS changes needed: profiles already has SELECT/UPDATE policies
-- scoped to id = auth.uid(), which already covers this column.
-- Verified: \d+ profiles shows two policies (profiles_self_select,
-- profiles_self_update) gated on auth.uid() = id.

COMMENT ON COLUMN public.profiles.notification_prefs IS
  '5-key JSONB: email / bookings / messages / contracts / payouts. ' ||
  'All default true (opt-out model). Read by send-push, send-email, ' ||
  'send-booking-reminders, send-review-prompts before each dispatch. ' ||
  'Written by /settings.html.';
