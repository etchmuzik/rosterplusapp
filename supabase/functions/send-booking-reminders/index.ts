// Scheduled hourly by pg_cron. Finds bookings 24h out that haven't been
// reminded yet, emails both sides, and marks reminder_sent_at so we don't
// double-fire. Guarded by a shared-secret header so random callers can't
// blast every booking with a reminder on demand.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const FROM_EMAIL = 'ROSTER+ <book@rosterplus.io>';
const SITE_URL = 'https://rosterplus.io';

// Mono shell shared with the send-email function. If that shell ever
// changes, mirror the change here so both transactional surfaces stay
// visually consistent.
const SHELL = (content: string) => `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#08090b;color:#fff;padding:40px;border-radius:12px">${content}<p style="color:rgba(255,255,255,0.2);font-size:11px;margin-top:40px">ROSTER+ \u2014 The GCC Booking Platform<br>rosterplus.io</p></div>`;
const btn = (href: string, label: string) => `<a href="${href}" style="display:inline-block;background:#f3f5f8;color:#08090b;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:20px;font-size:15px">${label}</a>`;

interface ReminderRow {
  id: string;
  event_name: string;
  event_date: string;
  event_time: string | null;
  venue_name: string | null;
  fee: number | null;
  currency: string | null;
  promoter_id: string;
  artist_id: string;
  promoter: { display_name: string | null; email: string | null; company: string | null } | null;
  artists: { stage_name: string | null; profiles: { display_name: string | null; email: string | null } | null } | null;
}

function fmtFee(fee: number | null, currency: string | null): string {
  if (!fee) return 'On request';
  return `${currency || 'AED'} ${Number(fee).toLocaleString()}`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

function renderEmail(opts: {
  recipientRole: 'promoter' | 'artist';
  counterpartyName: string;
  eventName: string;
  eventDate: string;
  eventTime: string;
  venue: string;
  fee: string;
  bookingUrl: string;
}): { subject: string; html: string } {
  const whenLine = opts.eventTime ? `${fmtDate(opts.eventDate)} at ${opts.eventTime}` : fmtDate(opts.eventDate);
  const heading = opts.recipientRole === 'artist'
    ? `You\u2019re on stage tomorrow`
    : `Your event with ${opts.counterpartyName} is tomorrow`;
  const intro = opts.recipientRole === 'artist'
    ? `Quick reminder \u2014 you have a booking with <strong>${opts.counterpartyName}</strong> coming up in 24 hours. Everything set? The details below are what the promoter sees too.`
    : `Quick reminder \u2014 <strong>${opts.counterpartyName}</strong> is scheduled for your event in 24 hours. Check the details below and reach out through ROSTR+ if anything has shifted.`;
  return {
    subject: `Reminder \u2014 ${opts.eventName} is tomorrow`,
    html: SHELL(`
      <h1 style="color:#f3f5f8;font-size:24px;margin-bottom:8px;letter-spacing:-0.02em">${heading}</h1>
      <p style="color:rgba(255,255,255,0.58);line-height:1.6">${intro}</p>
      <div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:24px;margin:24px 0">
        <p><strong>Event:</strong> ${opts.eventName}</p>
        <p><strong>When:</strong> ${whenLine}</p>
        <p><strong>Venue:</strong> ${opts.venue}</p>
        <p><strong>Fee:</strong> ${opts.fee}</p>
      </div>
      ${btn(opts.bookingUrl, 'Open booking')}
      <p style="color:rgba(255,255,255,0.34);font-size:13px;margin-top:24px;line-height:1.6">Need to reach the other side? Use the booking thread on ROSTR+ so everything stays in one place.</p>
    `),
  };
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

serve(async (req) => {
  // CORS preflight (for manual trigger during testing)
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
      },
    });
  }

  // Shared-secret gate \u2014 cron passes CRON_SECRET via x-cron-secret.
  // Without this guard anyone could hit the URL and spam reminders.
  if (CRON_SECRET) {
    const got = req.headers.get('x-cron-secret') || '';
    if (got !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
  }

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Pick up bookings whose event_date lands on tomorrow (UTC). Cron fires
  // hourly; reminder_sent_at guard ensures we only email once per booking.
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);

  const { data: rows, error } = await sb
    .from('bookings')
    .select(`
      id, event_name, event_date, event_time, venue_name, fee, currency,
      promoter_id, artist_id,
      promoter:profiles!promoter_id(display_name, email, company),
      artists(stage_name, profiles(display_name, email))
    `)
    .eq('event_date', tomorrowISO)
    .in('status', ['confirmed', 'contracted'])
    .is('reminder_sent_at', null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const results: Array<{ id: string; sent: number; failed: number }> = [];
  const reminders = (rows || []) as unknown as ReminderRow[];

  for (const b of reminders) {
    const artistName = b.artists?.stage_name || b.artists?.profiles?.display_name || 'the artist';
    const promoterName = b.promoter?.company || b.promoter?.display_name || 'the promoter';
    const eventName = b.event_name || 'Performance';
    const venue = b.venue_name || '\u2014';
    const eventTime = b.event_time ? b.event_time.slice(0, 5) : '';
    const fee = fmtFee(b.fee, b.currency);
    const bookingUrl = `${SITE_URL}/booking-detail.html?id=${b.id}`;

    let sent = 0;
    let failed = 0;

    const artistEmail = b.artists?.profiles?.email;
    if (artistEmail) {
      const mail = renderEmail({ recipientRole: 'artist', counterpartyName: promoterName, eventName, eventDate: b.event_date, eventTime, venue, fee, bookingUrl });
      if (await sendEmail(artistEmail, mail.subject, mail.html)) sent++; else failed++;
    }
    const promoterEmail = b.promoter?.email;
    if (promoterEmail) {
      const mail = renderEmail({ recipientRole: 'promoter', counterpartyName: artistName, eventName, eventDate: b.event_date, eventTime, venue, fee, bookingUrl });
      if (await sendEmail(promoterEmail, mail.subject, mail.html)) sent++; else failed++;
    }

    // Mark sent even if one side bounced \u2014 re-trying would just spam
    // the working side. If both failed we still mark: same rationale plus
    // "email not reaching us" is a user problem, not a cron problem.
    await sb.from('bookings').update({ reminder_sent_at: new Date().toISOString() }).eq('id', b.id);
    results.push({ id: b.id, sent, failed });
  }

  return new Response(JSON.stringify({ success: true, processed: reminders.length, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
