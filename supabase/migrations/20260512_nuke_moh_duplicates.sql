-- Full nuke of the two "moh" duplicate accounts per operator request
-- (2026-05-12).
--
-- Targets:
--   ahmed@hotmail.com  (artist handle "moh",   profile da22fb53…)
--   royal_1@xmal.com   (artist handle "moh-2", profile 069a323e…)
--
-- Pre-check confirmed: 0 bookings, 0 contracts, 0 payments, 0 messages,
-- 0 reviews, 0 device_tokens, 0 notifications, 0 invitations,
-- 0 booking_events, 0 admin_audit. royal_1 had 38 client_errors rows
-- (the sseError noise we investigated 2026-05-11) which had to go
-- first to satisfy the FK.
--
-- Delete order — child tables first, parent last:
--   1. public.artists                — clears artists.profile_id FK
--   2. public.client_errors          — clears client_errors.user_id FK
--   3. public.profiles               — clears profiles.id → auth.users FK
--   4. auth.users                    — root user row (cascades to
--                                      identities, sessions, refresh_tokens
--                                      via Supabase auth schema's own FKs)
--
-- Transactional via apply_migration: any failure rolls all four back.
-- Idempotent: re-running deletes zero rows.

DELETE FROM public.artists
 WHERE profile_id IN (
   'da22fb53-b5f8-47fc-97f5-5c32e1c4f730'::uuid,
   '069a323e-56f0-4073-a96f-83dedc044cfe'::uuid
 );

DELETE FROM public.client_errors
 WHERE user_id IN (
   'da22fb53-b5f8-47fc-97f5-5c32e1c4f730'::uuid,
   '069a323e-56f0-4073-a96f-83dedc044cfe'::uuid
 );

DELETE FROM public.profiles
 WHERE id IN (
   'da22fb53-b5f8-47fc-97f5-5c32e1c4f730'::uuid,
   '069a323e-56f0-4073-a96f-83dedc044cfe'::uuid
 );

DELETE FROM auth.users
 WHERE id IN (
   'da22fb53-b5f8-47fc-97f5-5c32e1c4f730'::uuid,
   '069a323e-56f0-4073-a96f-83dedc044cfe'::uuid
 );
