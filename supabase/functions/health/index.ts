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

  // Compute staleness for the main reminder job.
  const reminderRun = latestByJob['send-booking-reminders'];
  const reminderStale =
    reminderRun
      ? (Date.now() - new Date(reminderRun.ran_at).getTime()) > 2 * 60 * 60 * 1000 // >2h
      : true; // never ran

  return json({
    ok: !reminderStale,
    ts: new Date().toISOString(),
    build: 'edge',
    latency_ms: Date.now() - startedAt,
    crons: latestByJob,
    warnings: reminderStale ? ['send-booking-reminders has not run in the last 2 hours'] : [],
  });
});
