-- Seed the initial 14 artists of the ROSTR+ roster.
-- Backfilled into the repo on 2026-04-24.
--
-- profile_id stays NULL until each artist signs up + we claim it.
-- status='active' → visible in public directory.
-- status='pending' → hidden from directory; only visible to admins
--                    (the "Artists are viewable by everyone" RLS
--                     policy doesn't filter by status, so the
--                     client-side directory query filters on status).

INSERT INTO public.artists (profile_id, stage_name, genre, cities_active, base_fee, currency, status, social_links, verified)
VALUES
  -- 5 active / publicly visible
  (NULL, 'Goomgum',   ARRAY['Afro House','Tribal'],    ARRAY['Dubai'],            NULL, 'AED', 'active',  '{"instagram":"https://instagram.com/goomgum"}'::jsonb,            true),
  (NULL, 'ENAI',      ARRAY['House','Electronic'],      ARRAY['Dubai','Cairo'],    NULL, 'AED', 'active',  '{}'::jsonb,                                                       true),
  (NULL, 'Eva Kim',   ARRAY['Open Format'],             ARRAY['Dubai','Hurghada'], NULL, 'AED', 'active',  '{}'::jsonb,                                                       true),
  (NULL, 'EPI',       ARRAY['Open Format'],             ARRAY['Dubai','Tashkent'], NULL, 'AED', 'active',  '{}'::jsonb,                                                       true),
  (NULL, 'Etch EG',   ARRAY['House','Electronic'],      ARRAY['Dubai','Cairo'],    NULL, 'AED', 'active',  '{}'::jsonb,                                                       true),

  -- 9 prospects / in-talks — hidden from public directory until approved
  (NULL, 'David Lindmer',   ARRAY['Melodic House'],     ARRAY['Berlin'],    NULL, 'EUR', 'pending', '{"instagram":"https://instagram.com/davidlindmer"}'::jsonb,       false),
  (NULL, 'Katrina Losa',    ARRAY['Tech House'],        ARRAY['Moscow'],    NULL, 'EUR', 'pending', '{"instagram":"https://instagram.com/katrinalosa"}'::jsonb,        false),
  (NULL, 'Aga',             ARRAY['Melodic Techno'],    ARRAY['Bali'],      NULL, 'USD', 'pending', '{"instagram":"https://instagram.com/aga_music"}'::jsonb,          false),
  (NULL, 'Highlite',        ARRAY['Progressive'],       ARRAY['Tel Aviv'],  NULL, 'USD', 'pending', '{"instagram":"https://instagram.com/highlite_dj"}'::jsonb,        false),
  (NULL, 'Miss Naira Rich', ARRAY['Open Format'],       ARRAY['Dubai'],     NULL, 'AED', 'pending', '{"instagram":"https://instagram.com/djmissnaiararich"}'::jsonb,   false),
  (NULL, 'Qtee',            ARRAY['Open Format'],       ARRAY['Dubai'],     NULL, 'AED', 'pending', '{"instagram":"https://instagram.com/qtee.music"}'::jsonb,         false),
  (NULL, 'Ona',             ARRAY['Open Format'],       ARRAY['Dubai'],     NULL, 'AED', 'pending', '{"instagram":"https://instagram.com/yourdjona"}'::jsonb,          false),
  (NULL, 'Bianca Blanco',   ARRAY['Open Format'],       ARRAY['Dubai','Lisbon'], 1500, 'EUR', 'pending', '{"instagram":"https://instagram.com/biancablancomusic"}'::jsonb, false),
  (NULL, 'Lorensiya',       ARRAY['Open Format'],       ARRAY['Moscow'],    NULL, 'EUR', 'pending', '{"instagram":"https://instagram.com/lorensiya"}'::jsonb,          false);
