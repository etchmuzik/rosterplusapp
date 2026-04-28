// Resend webhook sink. Receives email lifecycle events (sent, delivered,
// bounced, complained, opened, clicked, delivery_delayed) and writes one
// row per event into public.email_events for the admin Emails tab.
//
// verify_jwt=false because Resend isn't a Supabase caller. Auth is via
// the Svix-signed webhook secret: we verify the signature before trust.
//
// Configure in Resend: Dashboard → Webhooks → Add Endpoint
//   URL: https://vgjmfpryobsuboukbemr.supabase.co/functions/v1/resend-webhook
//   Events: email.sent, email.delivered, email.bounced, email.complained,
//           email.opened, email.clicked, email.delivery_delayed
//   Copy the signing secret into RESEND_WEBHOOK_SECRET env var on the
//   Supabase project secrets page.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { Webhook } from 'https://esm.sh/svix@1.21.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET');

function log(level: 'info'|'warn'|'error', event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, fn: 'resend-webhook', ...data }));
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  const raw = await req.text();

  // Signature verification. Resend uses Svix-standard headers
  // (svix-id, svix-timestamp, svix-signature).
  if (WEBHOOK_SECRET) {
    try {
      const wh = new Webhook(WEBHOOK_SECRET);
      const headers = {
        'svix-id':        req.headers.get('svix-id') || '',
        'svix-timestamp': req.headers.get('svix-timestamp') || '',
        'svix-signature': req.headers.get('svix-signature') || '',
      };
      wh.verify(raw, headers);
    } catch (e) {
      log('warn', 'signature_invalid', { err: String(e) });
      return new Response(JSON.stringify({ error: 'bad_signature' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
  } else {
    // No secret configured — log loudly but accept during first-time
    // setup so the admin can see events flowing before hooking the secret.
    log('warn', 'webhook_secret_not_configured');
  }

  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch (_) {
    log('warn', 'invalid_json');
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Resend payload shape: { type: 'email.delivered', created_at, data: { email_id, from, to: [], subject, ... } }
  const eventType = String(body.type || 'unknown');
  const data = (body.data as Record<string, unknown>) || {};
  const resendId = String(data.email_id || data.id || '');
  const to = Array.isArray(data.to) ? String(data.to[0] || '') : String(data.to || '');
  const from = String(data.from || '');
  const subject = String(data.subject || '');

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { error } = await admin.from('email_events').insert({
    resend_id: resendId,
    type: eventType,
    to_email: to,
    from_email: from,
    subject,
    payload: body,
  });

  if (error) {
    log('error', 'insert_failed', { err: error.message, type: eventType });
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  log('info', 'stored', { type: eventType, to_domain: to.split('@')[1] || 'unknown' });
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
