-- ═══════════════════════════════════════════════════════════
-- ROSTR+ GCC — Supabase Database Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ═══════════════════════════════════════════════════════════

-- 1. Profiles table (extends Supabase auth.users)
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

-- 2. Artists table (extended profile for artists)
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

-- 3. Venues table
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

-- 4. Bookings table
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID REFERENCES public.profiles(id),
  artist_id UUID REFERENCES public.artists(id),
  venue_id UUID REFERENCES public.venues(id),
  event_name TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_time TIME,
  set_duration INTEGER, -- minutes
  status TEXT DEFAULT 'inquiry' CHECK (status IN ('inquiry', 'pending', 'confirmed', 'contracted', 'completed', 'cancelled')),
  fee NUMERIC(10,2),
  currency TEXT DEFAULT 'AED',
  notes TEXT,
  rider_confirmed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Contracts table
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

-- 6. Payments table
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

-- 7. Messages table
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES public.profiles(id),
  receiver_id UUID REFERENCES public.profiles(id),
  booking_id UUID REFERENCES public.bookings(id),
  content TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- Row Level Security (RLS) Policies
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all, update their own
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Artists: public read, own update
CREATE POLICY "Artists are viewable by everyone" ON public.artists
  FOR SELECT USING (true);

CREATE POLICY "Artists can update own listing" ON public.artists
  FOR UPDATE USING (profile_id = auth.uid());

CREATE POLICY "Artists can insert own listing" ON public.artists
  FOR INSERT WITH CHECK (profile_id = auth.uid());

-- Venues: public read, creator update
CREATE POLICY "Venues are viewable by everyone" ON public.venues
  FOR SELECT USING (true);

CREATE POLICY "Venue creators can update" ON public.venues
  FOR UPDATE USING (created_by = auth.uid());

CREATE POLICY "Authenticated users can create venues" ON public.venues
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Bookings: involved parties only
CREATE POLICY "Users can view own bookings" ON public.bookings
  FOR SELECT USING (
    promoter_id = auth.uid() OR
    artist_id IN (SELECT id FROM public.artists WHERE profile_id = auth.uid())
  );

CREATE POLICY "Promoters can create bookings" ON public.bookings
  FOR INSERT WITH CHECK (promoter_id = auth.uid());

CREATE POLICY "Involved parties can update bookings" ON public.bookings
  FOR UPDATE USING (
    promoter_id = auth.uid() OR
    artist_id IN (SELECT id FROM public.artists WHERE profile_id = auth.uid())
  );

-- Contracts: linked to bookings
CREATE POLICY "Users can view own contracts" ON public.contracts
  FOR SELECT USING (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE promoter_id = auth.uid() OR
            artist_id IN (SELECT a.id FROM public.artists a WHERE a.profile_id = auth.uid())
    )
  );

CREATE POLICY "Users can create contracts for own bookings" ON public.contracts
  FOR INSERT WITH CHECK (
    booking_id IN (SELECT id FROM public.bookings WHERE promoter_id = auth.uid())
  );

-- Payments: linked to bookings
CREATE POLICY "Users can view own payments" ON public.payments
  FOR SELECT USING (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE promoter_id = auth.uid() OR
            artist_id IN (SELECT a.id FROM public.artists a WHERE a.profile_id = auth.uid())
    )
  );

-- Messages: sender or receiver
CREATE POLICY "Users can view own messages" ON public.messages
  FOR SELECT USING (sender_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY "Users can send messages" ON public.messages
  FOR INSERT WITH CHECK (sender_id = auth.uid());

CREATE POLICY "Users can mark own messages as read" ON public.messages
  FOR UPDATE USING (receiver_id = auth.uid());

-- ═══════════════════════════════════════════════════════════
-- Auto-create profile on signup (trigger)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'promoter')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop if exists and recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════════════
-- Done! Your ROSTR+ database is ready.
-- ═══════════════════════════════════════════════════════════
