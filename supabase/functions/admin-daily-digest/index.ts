// Daily admin digest — one email per admin, 09:00 Dubai time (05:00 UTC).
// Rolls up the last 24h of activity: new signups, bookings, errors, and
// any failed cron runs. Cheaper than opening the dashboard.
//
// Scheduled via pg_cron in the matching migration (20260423_daily_digest_cron.sql).
// The cron uses pg_net to POST here; we don't gate with a secret because the
// body is same-VPC and a spammy external caller would just get stats they
// can see on /status.html anyway. Future: add x-cron-secret if abuse shows up.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = 'ROSTER+ <book@rosterplus.io>';

// Email allowlist — mirrors the SQL is_admin() function. If that list
// changes, update both.
const ADMIN_EMAILS = ['beyondtech.eg@gmail.com', 'h.saied@outlook.com'];

function log(level: 'info'|'warn'|'error', event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, fn: 'admin-daily-digest', ...data }));
}

const SHELL = (content: string) => `<div style="font-family:sans-serif;max-width:680px;margin:0 auto;background:#08090b;color:#fff;padding:40px;border-radius:12px">${content}<p style="color:rgba(255,255,255,0.2);font-size:11px;margin-top:40px">ROSTER+ — The GCC Booking Platform<br>rosterplus.io</p></div>`;

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '0';
  return String(n);
}

function statRow(label: string, value: string, accent = false): string {
  const valColor = accent ? '#f3f5f8' : 'rgba(255,255,255,0.8)';
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.08)">
    <span style="color:rgba(255,255,255,0.6);font-size:14px">${label}</span>
    <span style="color:${valColor};font-size:18px;font-weight:600;font-family:ui-monospace,monospace">${value}</span>
  </div>`;
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  log('info', 'invoked', { method: req.method });

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    log('error', 'misconfigured');
    return new Response(JSON.stringify({ error: 'misconfigured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Gather stats in parallel.
  const [
    { count: newUsers },
    { count: newArtists },
    { count: newBookings },
    { count: confirmedBookings },
    { count: errors24h },
    { data: cronRuns },
    { data: recentBookings },
    { data: recentErrors },
  ] = await Promise.all([
    sb.from('profiles').select('id', { count: 'exact', head: true }).gt('created_at', since24h),
    sb.from('artists').select('id', { count: 'exact', head: true }).gt('created_at', since24h),
    sb.from('bookings').select('id', { count: 'exact', head: true }).gt('created_at', since24h),
    sb.from('bookings').select('id', { count: 'exact', head: true }).gt('created_at', since24h).in('status', ['confirmed', 'contracted']),
    sb.from('client_errors').select('id', { count: 'exact', head: true }).gt('created_at', since24h),
    sb.from('cron_runs').select('job, status, ran_at').gt('ran_at', since24h).eq('status', 'error').limit(10),
    sb.from('bookings').select('id, event_name, event_date, status, fee, currency').gt('created_at', since24h).order('created_at', { ascending: false }).limit(5),
    sb.from('client_errors').select('message, url, created_at').gt('created_at', since24h).order('created_at', { ascending: false }).limit(5),
  ]);

  const failedCrons = cronRuns || [];
  const topBookings = recentBookings || [];
  const topErrors = recentErrors || [];

  const hasAnything = (newUsers || 0) + (newArtists || 0) + (newBookings || 0) + (errors24h || 0) + failedCrons.length > 0;

  // If it's a truly quiet day (zero activity) we still send a short
  // "nothing to report" message so the cadence is predictable — admins
  // can tell the cron fired. Skip sending only if the function itself
  // is misconfigured.
  const subject = hasAnything
    ? `ROSTR+ digest · ${newUsers || 0} signups, ${newBookings || 0} bookings, ${errors24h || 0} errors`
    : 'ROSTR+ digest · quiet day, all clear';

  const bookingsListHtml = topBookings.length
    ? topBookings.map(b => `<li style="padding:4px 0;color:rgba(255,255,255,0.7);font-size:13px">${(b.event_name || 'Event').replace(/[<>&]/g, '')} · ${b.event_date || '—'} · <span style="color:#8ae6b5">${b.status || '—'}</span>${b.fee ? ` · ${b.currency || 'AED'} ${Number(b.fee).toLocaleString()}` : ''}</li>`).join('')
    : '<li style="padding:4px 0;color:rgba(255,255,255,0.4);font-size:13px;font-style:italic">No new bookings in the last 24h.</li>';

  const errorsListHtml = topErrors.length
    ? topErrors.map(e => `<li style="padding:4px 0;color:rgba(255,255,255,0.7);font-size:13px">${String(e.message || '').replace(/[<>&]/g, '').slice(0, 120)} · <span style="color:rgba(255,255,255,0.4)">${new Date(e.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></li>`).join('')
    : '<li style="padding:4px 0;color:rgba(255,255,255,0.4);font-size:13px;font-style:italic">No client errors in the last 24h.</li>';

  const cronWarnHtml = failedCrons.length
    ? `<div style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.3);border-radius:8px;padding:12px 16px;margin:20px 0">
         <div style="color:#f3a0a0;font-weight:600;font-size:14px;margin-bottom:4px">⚠ ${failedCrons.length} cron failure${failedCrons.length === 1 ? '' : 's'} in the last 24h</div>
         <div style="font-family:ui-monospace,monospace;font-size:12px;color:rgba(255,255,255,0.6)">${failedCrons.map(c => `${c.job} @ ${new Date(c.ran_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`).join('<br>')}</div>
       </div>`
    : '';

  const html = SHELL(`
    <div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:6px">Admin Digest</div>
    <h1 style="color:#f3f5f8;font-size:24px;margin:0 0 8px;letter-spacing:-0.02em">Last 24 hours on ROSTR+</h1>
    <p style="color:rgba(255,255,255,0.55);line-height:1.5;font-size:14px;margin-bottom:24px">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · Dubai time</p>

    <div style="background:rgba(255,255,255,0.025);border-radius:8px;padding:4px 16px;margin-bottom:20px">
      ${statRow('New signups',          fmt(newUsers))}
      ${statRow('New artist rows',      fmt(newArtists))}
      ${statRow('New bookings',         fmt(newBookings), true)}
      ${statRow('└─ confirmed / contracted',  fmt(confirmedBookings))}
      ${statRow('Client errors',        fmt(errors24h), (errors24h || 0) > 10)}
    </div>

    ${cronWarnHtml}

    <h3 style="color:#f3f5f8;font-size:15px;margin:24px 0 8px">Latest bookings</h3>
    <ul style="list-style:none;padding:0;margin:0">${bookingsListHtml}</ul>

    <h3 style="color:#f3f5f8;font-size:15px;margin:24px 0 8px">Latest errors</h3>
    <ul style="list-style:none;padding:0;margin:0">${errorsListHtml}</ul>

    <a href="https://rosterplus.io/admin.html" style="display:inline-block;background:#f3f5f8;color:#08090b;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:24px;font-size:14px">Open admin console</a>
  `);

  // Send one email per admin. Failures on one don't stop the rest.
  const results: Array<{ to: string; ok: boolean; error?: string }> = [];
  for (const to of ADMIN_EMAILS) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
      });
      results.push({ to, ok: r.ok });
      log(r.ok ? 'info' : 'warn', r.ok ? 'sent' : 'send_failed', { to, status: r.status });
    } catch (e) {
      results.push({ to, ok: false, error: String(e) });
      log('warn', 'send_threw', { to, err: String(e) });
    }
  }

  // Record this run in cron_runs so the digest itself shows up on the
  // health endpoint + /status.html strip.
  try {
    await sb.from('cron_runs').insert({
      job: 'admin-daily-digest',
      status: results.every(r => r.ok) ? 'ok' : 'error',
      duration_ms: Date.now() - startedAt,
      error: results.filter(r => !r.ok).map(r => r.to).join(', ') || null,
      meta: {
        recipients: results.length,
        sent: results.filter(r => r.ok).length,
        new_users: newUsers || 0,
        new_bookings: newBookings || 0,
        errors_24h: errors24h || 0,
      },
    });
  } catch (_) { /* best-effort */ }

  return new Response(JSON.stringify({ success: true, results, duration_ms: Date.now() - startedAt }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
