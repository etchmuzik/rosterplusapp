/*
 * signup
 *
 * Custom signup flow that bypasses Supabase's built-in SMTP entirely.
 * See the function body for the full rationale — summary: we create
 * the user pre-confirmed via the admin API and send a branded welcome
 * email via Resend, since the dashboard SMTP isn't wired up.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const FROM_EMAIL = 'ROSTER+ <book@rosterplus.io>';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const lastAttempt = new Map<string, number>();
const RATE_LIMIT_MS = 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function welcomeEmailHTML(displayName: string, role: string): string {
  const firstName = (displayName || '').split(/\s+/)[0] || 'there';
  const isArtist = role === 'artist';
  // Land on the dashboard with #setup so the page auto-scrolls to the
  // onboarding checklist (dashboard.html listens for that hash and moves
  // focus to #completion-mount).
  const cta = isArtist
    ? 'https://rosterplus.io/artist-dashboard.html#setup'
    : 'https://rosterplus.io/dashboard.html#setup';
  const ctaLabel = isArtist ? 'Finish your artist setup' : 'Finish your promoter setup';
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#08090b;color:#fff;padding:40px;border-radius:12px">
    <h1 style="color:#f3f5f8;font-size:28px;margin-bottom:8px;letter-spacing:-0.03em">Welcome to ROSTR+, ${escapeHtml(firstName)}.</h1>
    <p style="color:rgba(255,255,255,0.58);line-height:1.6">Your account is ready. You're set up as ${escapeHtml(isArtist ? 'an artist' : 'a promoter')} on ROSTR+ \u2014 the GCC's nightlife booking platform.</p>
    <p style="color:rgba(255,255,255,0.58);line-height:1.6;margin-top:16px">Take two minutes to complete your profile \u2014 we'll walk you through it:</p>
    <a href="${cta}" style="display:inline-block;background:#f3f5f8;color:#08090b;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:20px;font-size:15px">${ctaLabel}</a>
    <p style="color:rgba(255,255,255,0.34);font-size:13px;margin-top:32px;line-height:1.7">
      ${isArtist ?
        'You\u2019ll add your stage name, genres, base fee, and link a social profile. Promoters see these when booking.' :
        'You\u2019ll add your name, company, and city so artists know who they\u2019re dealing with when you reach out.'}
    </p>
    <p style="color:rgba(255,255,255,0.2);font-size:11px;margin-top:40px">ROSTER+ \u2014 The GCC Booking Platform<br>rosterplus.io</p>
  </div>`;
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'": '&#39;' }[c]!));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'misconfigured' }, 500);

  let payload: { email?: string; password?: string; role?: string; display_name?: string };
  try { payload = await req.json(); } catch (_) { return json({ error: 'invalid_body' }, 400); }

  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  const role = String(payload.role || 'promoter');
  const displayName = String(payload.display_name || '').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400);
  if (!password || password.length < 8) return json({ error: 'weak_password' }, 400);
  if (!['promoter', 'artist'].includes(role)) return json({ error: 'invalid_role' }, 400);
  if (displayName && displayName.length > 80) return json({ error: 'name_too_long' }, 400);

  const now = Date.now();
  const prior = lastAttempt.get(email);
  if (prior && (now - prior) < RATE_LIMIT_MS) {
    return json({ error: 'rate_limited', retry_after_ms: RATE_LIMIT_MS - (now - prior) }, 429);
  }
  lastAttempt.set(email, now);

  const supaAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    const { data, error } = await supaAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { display_name: displayName || email.split('@')[0], role },
    });

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) return json({ error: 'email_taken' }, 409);
      if (msg.includes('password')) return json({ error: 'weak_password' }, 400);
      return json({ error: 'signup_failed', detail: error.message }, 500);
    }

    if (RESEND_API_KEY) {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL, to: email, subject: `Welcome to ROSTR+`,
          html: welcomeEmailHTML(displayName, role),
        }),
      }).catch(() => {});
    }

    return json({ success: true, user_id: data.user?.id });
  } catch (err) {
    return json({ error: 'internal', detail: String(err) }, 500);
  }
});
