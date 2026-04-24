// Scheduled daily by pg_cron. Finds bookings whose event was exactly 3
// days ago, emails both parties asking for a rating, and stamps
// review_prompt_sent_at so we never double-fire.
//
// Why 3 days:
//   - 1 day feels too soon — people are still travelling, winding down
//   - 3 days is the sweet spot: memory fresh, mental space clear
//   - 7+ days and the recall drops off a cliff
//
// Protected by CRON_SECRET shared-secret header. Same idiom as the
// booking-reminders and onboarding-drip cron functions.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const SITE_URL = 'https://rosterplus.io';

// How many days after the event do we prompt? 3 is the sweet spot.
const PROMPT_DAYS_AFTER = 3;

interface BookingRow {
  id: string;
  event_name: string;
  event_date: string;
  promoter_id: string;
  artist_id: string;
  promoter: {
    display_name: string | null;
    email: string | null;
    company: string | null;
  } | null;
  artists: {
    stage_name: string | null;
    profiles: {
      display_name: string | null;
      email: string | null;
    } | null;
  } | null;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch {
    return iso;
  }
}

async function sendPrompt(args: {
  to: string;
  role: 'promoter' | 'artist';
  event_name: string;
  event_date: string;
  counterparty_name: string;
  booking_url: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: args.to,
        type: 'review_prompt',
        data: {
          event_name:        args.event_name,
          event_date:        fmtDate(args.event_date),
          days_ago:          String(PROMPT_DAYS_AFTER),
          role:              args.role,
          counterparty_name: args.counterparty_name,
          booking_url:       args.booking_url,
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
      },
    });
  }

  if (CRON_SECRET) {
    const got = req.headers.get('x-cron-secret') || '';
    if (got !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Target window: bookings whose event_date was exactly
  // PROMPT_DAYS_AFTER days ago (UTC date). Using a single date rather
  // than a range means each booking gets prompted once; re-running the
  // cron on the same day is idempotent thanks to the sent-at guard.
  const target = new Date();
  target.setUTCDate(target.getUTCDate() - PROMPT_DAYS_AFTER);
  const targetISO = target.toISOString().slice(0, 10);

  const { data: rows, error } = await sb
    .from('bookings')
    .select(`
      id, event_name, event_date,
      promoter_id, artist_id,
      promoter:profiles!promoter_id(display_name, email, company),
      artists(stage_name, profiles(display_name, email))
    `)
    .eq('event_date', targetISO)
    .in('status', ['confirmed', 'contracted', 'completed'])
    .is('review_prompt_sent_at', null)
    .is('deleted_at', null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const bookings = (rows || []) as unknown as BookingRow[];
  const results: Array<{ id: string; sent: number; failed: number }> = [];
  let totalSent = 0;
  let totalFailed = 0;

  for (const b of bookings) {
    const artistName = b.artists?.stage_name || b.artists?.profiles?.display_name || 'the artist';
    const promoterName = b.promoter?.company || b.promoter?.display_name || 'the promoter';
    const bookingUrl = `${SITE_URL}/booking-detail.html?id=${b.id}`;

    let sent = 0;
    let failed = 0;

    // Artist side
    const artistEmail = b.artists?.profiles?.email;
    if (artistEmail) {
      const ok = await sendPrompt({
        to: artistEmail,
        role: 'artist',
        event_name: b.event_name,
        event_date: b.event_date,
        counterparty_name: promoterName,
        booking_url: bookingUrl,
      });
      if (ok) sent++; else failed++;
    }

    // Promoter side
    const promoterEmail = b.promoter?.email;
    if (promoterEmail) {
      const ok = await sendPrompt({
        to: promoterEmail,
        role: 'promoter',
        event_name: b.event_name,
        event_date: b.event_date,
        counterparty_name: artistName,
        booking_url: bookingUrl,
      });
      if (ok) sent++; else failed++;
    }

    // Stamp sent even if one side bounced — retrying spams the working
    // side. Same rationale as send-booking-reminders.
    await sb.from('bookings')
      .update({ review_prompt_sent_at: new Date().toISOString() })
      .eq('id', b.id);

    results.push({ id: b.id, sent, failed });
    totalSent += sent;
    totalFailed += failed;
  }

  return new Response(JSON.stringify({
    success: true,
    processed: bookings.length,
    sent: totalSent,
    failed: totalFailed,
    results,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
