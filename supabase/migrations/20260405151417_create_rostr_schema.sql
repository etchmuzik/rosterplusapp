-- Initial ROSTR+ schema (2026-04-05).
-- Backfilled into the repo on 2026-04-24 from the live project —
-- this migration was applied via the Supabase CLI before we
-- standardised on mirroring every change into supabase/migrations/.

-- Profiles table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'promoter' CHECK (role IN ('promoter', 'artist', 'admin')),
  avatar_url TEXT,
  phone TEXT,
  company TEXT,
  bio TEXT,
  city TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Artists table
CREATE TABLE IF NOT EXISTS public.artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  stage_name TEXT NOT NULL,
  genre TEXT[] DEFAULT '{}',
  subgenres TEXT[] DEFAULT '{}',
  base_fee NUMERIC(10,2),
  currency TEXT DEFAULT 'AED',
  rating NUMERIC(3,2) DEFAULT 0,
  total_bookings INTEGER DEFAULT 0,
  cities_active TEXT[] DEFAULT '{}',
  social_links JSONB DEFAULT '{}',
  tech_rider JSONB DEFAULT '{}',
  epk_url TEXT,
  verified BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Venues table
CREATE TABLE IF NOT EXISTS public.venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT DEFAULT 'UAE',
  capacity INTEGER,
  venue_type TEXT,
  address TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  amenities TEXT[] DEFAULT '{}',
  images TEXT[] DEFAULT '{}',
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bookings table
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID REFERENCES public.profiles(id),
  artist_id UUID REFERENCES public.artists(id),
  venue_id UUID REFERENCES public.venues(id),
  event_name TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_time TIME,
  set_duration INTEGER,
  status TEXT DEFAULT 'inquiry' CHECK (status IN ('inquiry', 'pending', 'confirmed', 'contracted', 'completed', 'cancelled')),
  fee NUMERIC(10,2),
  currency TEXT DEFAULT 'AED',
  notes TEXT,
  rider_confirmed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contracts table
CREATE TABLE IF NOT EXISTS public.contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'expired', 'cancelled')),
  promoter_signed BOOLEAN DEFAULT FALSE,
  artist_signed BOOLEAN DEFAULT FALSE,
  signed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments table
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES public.bookings(id),
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'AED',
  type TEXT CHECK (type IN ('deposit', 'milestone', 'final', 'refund')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
  payment_method TEXT,
  transaction_id TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES public.profiles(id),
  receiver_id UUID REFERENCES public.profiles(id),
  booking_id UUID REFERENCES public.bookings(id),
  content TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
