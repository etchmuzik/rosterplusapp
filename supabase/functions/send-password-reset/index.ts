/*
 * send-password-reset
 *
 * Custom password-reset flow so we don't depend on Supabase's built-in SMTP
 * (which requires dashboard configuration we can't automate).
 *
 * Flow:
 *   1. User hits POST /auth-reset with { email }
 *   2. We generate a recovery link via Supabase Admin API
 *      (generateLink type=recovery)
 *   3. We email it through Resend using our existing branded template
 *
 * verify_jwt = false because this endpoint is called from the login form
 * before the user is authenticated. Rate-limited by Supabase's default
 * edge-function quotas.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const FROM_EMAIL = 'ROSTER+ <book@rosterplus.io>';
const SITE_URL = 'https://rosterplus.io';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function resetEmailHTML(resetUrl: string): string {
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#08090b;color:#fff;padding:40px;border-radius:12px">
    <h1 style="color:#f3f5f8;font-size:24px;margin-bottom:8px;letter-spacing:-0.02em">Reset your password</h1>
    <p style="color:rgba(255,255,255,0.58);line-height:1.6">Someone requested a password reset for your ROSTR+ account. If this was you, tap the button below. The link expires in 1 hour.</p>
    <a href="${resetUrl}" style="display:inline-block;background:#f3f5f8;color:#08090b;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:20px;font-size:15px">Reset password</a>
    <p style="color:rgba(255,255,255,0.34);font-size:13px;margin-top:24px;line-height:1.6">Didn't request this? Ignore this email — your password won't change. The link will simply expire.</p>
    <p style="color:rgba(255,255,255,0.2);font-size:11px;margin-top:32px">ROSTER+ — The GCC Booking Platform<br>rosterplus.io</p>
  </div>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let email: string;
  try {
    const body = await req.json();
    email = String(body.email || '').trim().toLowerCase();
  } catch (_) {
    return new Response(JSON.stringify({ error: 'invalid_body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'invalid_email' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Use the service role to mint a recovery link. Do NOT reveal whether
  // the account exists — always return 200 to prevent account enumeration.
  const supaAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const { data, error } = await supaAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${SITE_URL}/auth.html?mode=reset`,
      },
    });

    // If the user doesn't exist we still return 200 — silently skip sending
    // so attackers can't probe which emails are on file.
    if (error || !data?.properties?.action_link) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resetUrl = data.properties.action_link;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        subject: 'Reset your ROSTR+ password',
        html: resetEmailHTML(resetUrl),
      }),
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // Still return 200 so we don't leak failure modes to probers.
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
