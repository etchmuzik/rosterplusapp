-- In-app notification feed.
--
-- One row per notifiable event per recipient. Written by DB triggers on
-- bookings/contracts/payments/messages so every lifecycle transition
-- surfaces in the UI bell regardless of which client initiated the
-- change.
--
-- Applied live via Supabase MCP on 2026-04-21. File kept in the repo
-- so future re-bootstraps stay in sync.

CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  href        text,
  read        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  booking_id  uuid,
  contract_id uuid,
  payment_id  uuid
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, created_at DESC)
  WHERE read = false;

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE USING (user_id = (SELECT auth.uid()))
             WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users delete own notifications" ON public.notifications;
CREATE POLICY "Users delete own notifications" ON public.notifications
  FOR DELETE USING (user_id = (SELECT auth.uid()));

ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Helper: resolve an artist row's auth user id.
CREATE OR REPLACE FUNCTION public._artist_user_id(p_artist_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT profile_id FROM public.artists WHERE id = p_artist_id;
$$;

-- Booking lifecycle trigger
CREATE OR REPLACE FUNCTION public.notify_booking_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_artist_user uuid;
  v_event_name  text;
  v_href        text;
BEGIN
  v_artist_user := public._artist_user_id(NEW.artist_id);
  v_event_name  := COALESCE(NEW.event_name, NEW.venue_name, 'Event');
  v_href        := '/booking-detail.html?id=' || NEW.id::text;

  IF TG_OP = 'INSERT' THEN
    IF v_artist_user IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, body, href, booking_id)
      VALUES (v_artist_user, 'booking_request',
              'New booking request', v_event_name, v_href, NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status,'') <> COALESCE(NEW.status,'') THEN
    IF NEW.status = 'confirmed' AND OLD.status IN ('pending','inquiry') THEN
      INSERT INTO public.notifications(user_id, type, title, body, href, booking_id)
      VALUES (NEW.promoter_id, 'booking_accepted',
              'Booking accepted', v_event_name, v_href, NEW.id);
    ELSIF NEW.status = 'cancelled' AND OLD.status IN ('pending','inquiry')
          AND v_artist_user IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, body, href, booking_id)
      VALUES (NEW.promoter_id, 'booking_rejected',
              'Booking declined', v_event_name, v_href, NEW.id);
    ELSIF NEW.status = 'cancelled' AND OLD.status IN ('confirmed','contracted') THEN
      INSERT INTO public.notifications(user_id, type, title, body, href, booking_id)
      VALUES (NEW.promoter_id, 'booking_cancelled',
              'Booking cancelled', v_event_name, v_href, NEW.id);
      IF v_artist_user IS NOT NULL THEN
        INSERT INTO public.notifications(user_id, type, title, body, href, booking_id)
        VALUES (v_artist_user, 'booking_cancelled',
                'Booking cancelled', v_event_name, v_href, NEW.id);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_booking ON public.bookings;
CREATE TRIGGER trg_notify_booking
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_booking_event();

-- Contract lifecycle trigger
CREATE OR REPLACE FUNCTION public.notify_contract_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promoter_id uuid;
  v_artist_id   uuid;
  v_artist_user uuid;
  v_event_name  text;
  v_href        text;
BEGIN
  SELECT b.promoter_id, b.artist_id, COALESCE(b.event_name, b.venue_name, 'Event')
    INTO v_promoter_id, v_artist_id, v_event_name
    FROM public.bookings b WHERE b.id = NEW.booking_id;
  v_artist_user := public._artist_user_id(v_artist_id);
  v_href        := '/contract.html?id=' || NEW.id::text;

  IF TG_OP = 'INSERT' THEN
    IF v_artist_user IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, body, href, booking_id, contract_id)
      VALUES (v_artist_user, 'contract_sent',
              'Contract ready to sign', v_event_name, v_href, NEW.booking_id, NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'signed' AND COALESCE(OLD.status,'') <> 'signed' THEN
    IF v_promoter_id IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, body, href, booking_id, contract_id)
      VALUES (v_promoter_id, 'contract_signed',
              'Contract signed', v_event_name, v_href, NEW.booking_id, NEW.id);
    END IF;
    IF v_artist_user IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, body, href, booking_id, contract_id)
      VALUES (v_artist_user, 'contract_signed',
              'Contract signed', v_event_name, v_href, NEW.booking_id, NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_contract ON public.contracts;
CREATE TRIGGER trg_notify_contract
  AFTER INSERT OR UPDATE OF status ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.notify_contract_event();

-- Payment lifecycle trigger
CREATE OR REPLACE FUNCTION public.notify_payment_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promoter_id uuid;
  v_artist_id   uuid;
  v_artist_user uuid;
  v_event_name  text;
  v_href        text;
  v_amount      text;
BEGIN
  SELECT b.promoter_id, b.artist_id, COALESCE(b.event_name, b.venue_name, 'Event')
    INTO v_promoter_id, v_artist_id, v_event_name
    FROM public.bookings b WHERE b.id = NEW.booking_id;
  v_artist_user := public._artist_user_id(v_artist_id);
  v_href        := '/booking-detail.html?id=' || NEW.booking_id::text;
  v_amount      := COALESCE(NEW.currency, 'AED') || ' ' || NEW.amount::text;

  IF TG_OP = 'INSERT' THEN
    IF v_artist_user IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, body, href, booking_id, payment_id)
      VALUES (v_artist_user, 'payment_recorded',
              'Payment recorded', v_amount || ' \u2014 ' || v_event_name, v_href, NEW.booking_id, NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.artist_confirmed_at IS NULL AND NEW.artist_confirmed_at IS NOT NULL THEN
    IF v_promoter_id IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, body, href, booking_id, payment_id)
      VALUES (v_promoter_id, 'payment_confirmed',
              'Payment confirmed by artist', v_amount || ' \u2014 ' || v_event_name, v_href, NEW.booking_id, NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_payment ON public.payments;
CREATE TRIGGER trg_notify_payment
  AFTER INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.notify_payment_event();

-- Message trigger (new message arrives → notify recipient)
CREATE OR REPLACE FUNCTION public.notify_message_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_href   text;
  v_sender text;
BEGIN
  IF NEW.booking_id IS NOT NULL THEN
    v_href := '/messages.html?booking=' || NEW.booking_id::text;
  ELSE
    v_href := '/messages.html';
  END IF;
  SELECT p.display_name INTO v_sender FROM public.profiles p WHERE p.id = NEW.sender_id;
  INSERT INTO public.notifications(user_id, type, title, body, href, booking_id)
  VALUES (NEW.receiver_id, 'message',
          'New message' || CASE WHEN v_sender IS NOT NULL THEN ' from ' || v_sender ELSE '' END,
          LEFT(COALESCE(NEW.content, ''), 120),
          v_href, NEW.booking_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_message ON public.messages;
CREATE TRIGGER trg_notify_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_message_event();
