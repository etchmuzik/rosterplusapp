// Scheduled hourly by pg_cron. Finds artist profiles at 1h / 24h / 72h age
// milestones and fires the corresponding drip email via the send-email
// function. Tracks which emails have been sent per profile in
// profiles.onboarding_emails_sent (jsonb map) so we don't double-fire.
//
// Protected by CRON_SECRET shared-secret header — same pattern as
// send-booking-reminders. Returns a processed+sent count for cron_runs.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const SITE_URL = 'https://rosterplus.io';

interface ArtistRow {
  profile_id: string;
  artist_id: string;
  stage_name: string | null;
  email: string | null;
  display_name: string | null;
  created_at: string; // profile created_at
  onboarding_emails_sent: Record<string, string>;
  // artist fields used to decide which profile fields are missing
  base_fee: number | null;
  tech_rider: string | null;
  avatar_url: string | null;
  bio: string | null;
}

type DripKey = 'welcome_1h' | 'nudge_24h' | 'epk_72h';

// How old must the profile be before we fire each drip? We use inclusive
// lower bounds so the cron's hourly cadence always catches each window.
const DRIP_WINDOW_HOURS: Record<DripKey, number> = {
  welcome_1h: 1,
  nudge_24h: 24,
  epk_72h: 72,
};

const TYPE_BY_DRIP: Record<DripKey, string> = {
  welcome_1h: 'artist_welcome',
  nudge_24h: 'artist_profile_nudge_24h',
  epk_72h: 'artist_epk_share_72h',
};

function ageHours(isoCreatedAt: string): number {
  return (Date.now() - new Date(isoCreatedAt).getTime()) / (1000 * 60 * 60);
}

function pickDrip(a: ArtistRow): DripKey | null {
  const age = ageHours(a.created_at);
  const sent = a.onboarding_emails_sent || {};
  // Fire the highest-tier unsent drip the artist is eligible for. If they
  // skipped an earlier one (e.g. account created right before the 72h
  // threshold) we still only fire the one appropriate to their age — we
  // don't play catch-up and blast all three in one hour.
  const candidates: DripKey[] = ['epk_72h', 'nudge_24h', 'welcome_1h'];
  for (const drip of candidates) {
    if (age >= DRIP_WINDOW_HOURS[drip] && !sent[drip]) return drip;
  }
  return null;
}

function buildPayload(drip: DripKey, a: ArtistRow): { type: string; data: Record<string, string> } {
  const type = TYPE_BY_DRIP[drip];
  const name = a.stage_name || a.display_name || 'there';
  const profile_url = `${SITE_URL}/artist-profile-edit.html`;
  const epk_url = `${SITE_URL}/epk.html?id=${a.artist_id}`;

  if (drip === 'welcome_1h') {
    const complete = Boolean(a.bio && a.base_fee && a.tech_rider && a.avatar_url);
    return {
      type,
      data: {
        name,
        profile_url,
        profile_complete: String(complete),
      },
    };
  }

  if (drip === 'nudge_24h') {
    return {
      type,
      data: {
        name,
        profile_url,
        missing_bio:    String(!a.bio),
        missing_rate:   String(!a.base_fee),
        missing_rider:  String(!a.tech_rider),
        missing_avatar: String(!a.avatar_url),
      },
    };
  }

  // epk_72h
  return {
    type,
    data: { name, epk_url },
  };
}

async function sendDrip(to: string, type: string, data: Record<string, string>): Promise<boolean> {
  // Call send-email via HTTP so it shares the one template surface. Using
  // the service-role key as Bearer so verify_jwt accepts the request.
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, type, data }),
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

  // Shared-secret gate — same idiom as send-booking-reminders.
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

  // Pull every artist profile that's under 4 days old. Anything older has
  // already had the whole drip sequence fire (or is past the window — we
  // don't want to start the drip for ancient accounts that predate this
  // feature).
  const cutoff = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await sb
    .from('profiles')
    .select(`
      id, email, display_name, created_at, onboarding_emails_sent,
      artists(id, stage_name, base_fee, tech_rider, avatar_url)
    `)
    .eq('role', 'artist')
    .is('deleted_at', null)
    .gt('created_at', cutoff);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Shape the join into a flat ArtistRow. Supabase returns the artists
  // relation as an array — we take the first row (each profile has at
  // most one artist record).
  // deno-lint-ignore no-explicit-any
  const candidates: ArtistRow[] = (rows || []).map((r: any) => {
    const art = Array.isArray(r.artists) ? r.artists[0] : r.artists;
    return {
      profile_id:              r.id,
      artist_id:               art?.id ?? null,
      stage_name:              art?.stage_name ?? null,
      email:                   r.email,
      display_name:            r.display_name,
      created_at:              r.created_at,
      onboarding_emails_sent:  r.onboarding_emails_sent || {},
      base_fee:                art?.base_fee ?? null,
      tech_rider:              art?.tech_rider ?? null,
      avatar_url:              art?.avatar_url ?? null,
      bio:                     null, // bio lives on profiles — we skip the profile bio check; stage has its own
    };
  }).filter((r: ArtistRow) => r.email && r.artist_id);

  const results: Array<{ profile_id: string; drip: string; sent: boolean }> = [];
  let sentCount = 0;
  let failCount = 0;

  for (const a of candidates) {
    const drip = pickDrip(a);
    if (!drip) continue;

    const { type, data } = buildPayload(drip, a);
    const ok = await sendDrip(a.email!, type, data);
    results.push({ profile_id: a.profile_id, drip, sent: ok });

    if (ok) {
      sentCount++;
      // Record the send so the next cron run skips this drip. Other drips
      // remain pending in the map.
      const next = { ...a.onboarding_emails_sent, [drip]: new Date().toISOString() };
      await sb.from('profiles').update({ onboarding_emails_sent: next }).eq('id', a.profile_id);
    } else {
      failCount++;
    }
  }

  return new Response(JSON.stringify({
    success: true,
    scanned: candidates.length,
    sent: sentCount,
    failed: failCount,
    results,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
