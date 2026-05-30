// Health endpoint for UptimeRobot and any other external pinger.
// Returns 200 + last cron run timestamps so a monitor can alert when
// the T-24h reminder cron goes dark.
//
// No auth gate — the endpoint is deliberately public so pingers don't
// need creds. The worst-case info leak is "our cron last ran at X"
// which is not sensitive.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

Deno.serve(async (_req) => {
  const startedAt = Date.now();

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'misconfigured' }, 500);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Fetch the most recent cron_runs row per known job. One query, sorted desc.
  const { data: runs, error } = await sb
    .from('cron_runs')
    .select('job, status, ran_at, duration_ms')
    .order('ran_at', { ascending: false })
    .limit(20);

  if (error) {
    return json({
      ok: false,
      error: error.message,
      latency_ms: Date.now() - startedAt,
    }, 500);
  }

  // Collapse to most recent per job.
  const latestByJob: Record<string, { status: string; ran_at: string; duration_ms: number | null }> = {};
  for (const r of (runs || [])) {
    if (!latestByJob[r.job]) latestByJob[r.job] = { status: r.status, ran_at: r.ran_at, duration_ms: r.duration_ms };
  }

  // ── Liveness probe ──────────────────────────────────────────────
  // We judge pg_cron health by a job that logs EVERY run regardless of
  // workload — not by send-booking-reminders, which short-circuits
  // silently when there are no bookings 24h out (so its cron_runs row
  // is legitimately absent during quiet periods). Watching it caused a
  // permanent false "ok:false" until the first booking.
  //
  // send-artist-onboarding-drip runs `30 * * * *` (hourly) and logs
  // unconditionally → if IT is stale, pg_cron itself is down, which is
  // what an external pinger actually wants to know. error-spike-alert
  // (every 5 min) is the secondary heartbeat. 2026-05-30 fix.
  const HEARTBEAT_JOB = 'send-artist-onboarding-drip';
  const STALE_MS = 2 * 60 * 60 * 1000; // >2h of silence from an hourly job = cron down
  const heartbeat = latestByJob[HEARTBEAT_JOB];
  const cronAlive = heartbeat
    ? (Date.now() - new Date(heartbeat.ran_at).getTime()) <= STALE_MS
    : false; // heartbeat job has never logged → cron not running

  // send-booking-reminders is reported informationally (last run, or
  // "idle — no bookings to remind") but does NOT gate health.
  const reminderRun = latestByJob['send-booking-reminders'];

  const warnings: string[] = [];
  if (!cronAlive) {
    warnings.push(`pg_cron heartbeat stale: ${HEARTBEAT_JOB} has not logged in over 2 hours`);
  }

  return json({
    ok: cronAlive,
    ts: new Date().toISOString(),
    build: 'edge',
    latency_ms: Date.now() - startedAt,
    cron_alive: cronAlive,
    heartbeat_job: HEARTBEAT_JOB,
    booking_reminders: reminderRun
      ? { last_run: reminderRun.ran_at, status: reminderRun.status }
      : { status: 'idle', note: 'no bookings within 24h to remind — job short-circuits silently' },
    crons: latestByJob,
    warnings,
  });
});
