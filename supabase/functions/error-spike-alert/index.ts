// Error-spike alert — runs every 5 min via pg_cron.
// Groups client_errors from the last 15 minutes by message. If any
// message hits the threshold (>= 5 occurrences), emails admins with a
// summary. Per-message rate-limit (60 min) prevents the same spike
// from emailing repeatedly while it's still trending.
//
// Companion to admin-daily-digest. This one wakes you up at 14:32 when
// a real bug starts hitting users; the digest is for the morning roll-up.
//
// CRON_SECRET-gated like the other cron-triggered functions. Caller is
// pg_cron via net.http_post with x-cron-secret header.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
// CRON_SECRET gate kept best-effort: if the project secret is set
// we enforce it, otherwise we let the call through and rely on the
// fact that the function URL itself is per-project + unlisted, like
// admin-daily-digest and send-booking-reminders. Setting the secret
// is the project owner's call.
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const FROM_EMAIL = 'ROSTER+ <book@rosterplus.io>';

// Mirrors the SQL is_admin() allowlist and admin-daily-digest.
const ADMIN_EMAILS = ['beyondtech.eg@gmail.com', 'h.saied@outlook.com'];

// Tuning. Conservative defaults — bump only if real signal gets noisy.
const WINDOW_MINUTES = 15;
const HIT_THRESHOLD = 5;
const COOLDOWN_MINUTES = 60;

function log(level: 'info'|'warn'|'error', event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, fn: 'error-spike-alert', ...data }));
}

const SHELL = (content: string) => `<div style="font-family:sans-serif;max-width:680px;margin:0 auto;background:#08090b;color:#fff;padding:40px;border-radius:12px">${content}<p style="color:rgba(255,255,255,0.2);font-size:11px;margin-top:40px">ROSTER+ — auto-alert from error-spike-alert<br>rosterplus.io</p></div>`;

function esc(s: string): string {
  return String(s == null ? '' : s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  log('info', 'invoked', { method: req.method });

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    log('error', 'misconfigured');
    return new Response(JSON.stringify({ error: 'misconfigured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  // Best-effort secret gate: only enforce if the project has CRON_SECRET set.
  if (CRON_SECRET) {
    const gotSecret = req.headers.get('x-cron-secret') || '';
    if (gotSecret !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const cooldownStart = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000).toISOString();

  // Pull all errors in the window + the cooldown table in parallel.
  const [{ data: recent, error: recentErr }, { data: alerted, error: alertedErr }] = await Promise.all([
    sb.from('client_errors').select('message, url, created_at').gt('created_at', windowStart),
    sb.from('error_spike_alerts').select('message_key, last_sent_at').gt('last_sent_at', cooldownStart),
  ]);

  if (recentErr) {
    log('error', 'recent_query_failed', { err: recentErr.message });
    return new Response(JSON.stringify({ error: 'query_failed', detail: recentErr.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  if (alertedErr) {
    // Table missing is recoverable — first run before migration. Log and continue.
    log('warn', 'cooldown_query_failed', { err: alertedErr.message });
  }

  // Group by truncated message — first 120 chars is enough to be unique-ish
  // without exploding the bucket count on long stack-y messages.
  const buckets = new Map<string, { count: number; firstUrl: string; latest: string }>();
  for (const r of (recent || [])) {
    const key = String(r.message || '').slice(0, 120);
    if (!key) continue;
    const b = buckets.get(key);
    if (b) {
      b.count++;
      if (r.created_at > b.latest) b.latest = r.created_at;
    } else {
      buckets.set(key, { count: 1, firstUrl: r.url || '', latest: r.created_at });
    }
  }

  // Filter to: above threshold AND not alerted in cooldown window.
  const cooldownSet = new Set((alerted || []).map(a => a.message_key));
  const spikes = [];
  for (const [key, b] of buckets.entries()) {
    if (b.count >= HIT_THRESHOLD && !cooldownSet.has(key)) {
      spikes.push({ message: key, count: b.count, url: b.firstUrl, latest: b.latest });
    }
  }
  spikes.sort((a, b) => b.count - a.count);

  if (spikes.length === 0) {
    log('info', 'no_spikes', { recent_count: (recent || []).length, buckets: buckets.size });
    return new Response(JSON.stringify({ success: true, spikes: 0, duration_ms: Date.now() - startedAt }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Render email body.
  const rows = spikes.map(s => `
    <div style="background:rgba(248,113,113,0.06);border:1px solid rgba(248,113,113,0.25);border-radius:8px;padding:14px 18px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <span style="color:#f3a0a0;font-weight:600;font-size:18px;font-family:ui-monospace,monospace">${s.count}×</span>
        <span style="color:rgba(255,255,255,0.4);font-size:11px">latest ${new Date(s.latest).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div style="color:#f3f5f8;font-family:ui-monospace,monospace;font-size:12px;line-height:1.4;word-break:break-word">${esc(s.message)}</div>
      ${s.url ? `<div style="color:rgba(255,255,255,0.4);font-size:11px;margin-top:6px;word-break:break-all">${esc(s.url)}</div>` : ''}
    </div>
  `).join('');

  const subject = `⚠ ROSTR+ error spike: ${spikes[0].count}× ${spikes[0].message.slice(0, 60)}${spikes.length > 1 ? ` (+${spikes.length - 1} more)` : ''}`;
  const html = SHELL(`
    <div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#f3a0a0;margin-bottom:6px">Error spike</div>
    <h1 style="color:#f3f5f8;font-size:22px;margin:0 0 8px;letter-spacing:-0.02em">${spikes.length} message${spikes.length === 1 ? '' : 's'} crossed ${HIT_THRESHOLD}× in the last ${WINDOW_MINUTES} minutes</h1>
    <p style="color:rgba(255,255,255,0.55);line-height:1.5;font-size:14px;margin-bottom:24px">Cooldown ${COOLDOWN_MINUTES} min per message · ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} Dubai</p>
    ${rows}
    <a href="https://rosterplus.io/admin.html#errors" style="display:inline-block;background:#f3f5f8;color:#08090b;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:16px;font-size:14px">Open admin console</a>
  `);

  // Fire emails + record cooldowns.
  const results: Array<{ to: string; ok: boolean }> = [];
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
      results.push({ to, ok: false });
      log('warn', 'send_threw', { to, err: String(e) });
    }
  }

  // Record cooldown rows so the same spike won't email again for COOLDOWN_MINUTES.
  // Per-message upsert keyed on message_key.
  try {
    const rows = spikes.map(s => ({ message_key: s.message, last_sent_at: new Date().toISOString(), hit_count: s.count }));
    await sb.from('error_spike_alerts').upsert(rows, { onConflict: 'message_key' });
  } catch (e) {
    log('warn', 'cooldown_upsert_failed', { err: String(e) });
  }

  // Record this run in cron_runs so it shows up on /status.html.
  try {
    await sb.from('cron_runs').insert({
      job: 'error-spike-alert',
      status: results.every(r => r.ok) ? 'ok' : 'error',
      duration_ms: Date.now() - startedAt,
      error: results.filter(r => !r.ok).map(r => r.to).join(', ') || null,
      meta: { spikes: spikes.length, top_count: spikes[0].count, recipients: results.length, sent: results.filter(r => r.ok).length },
    });
  } catch (_) { /* best-effort */ }

  return new Response(JSON.stringify({ success: true, spikes: spikes.length, results, duration_ms: Date.now() - startedAt }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
