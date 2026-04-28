/*
 * stripe-webhook
 *
 * Receives Stripe webhook events and updates the public.payments table.
 *
 * Auth model: Stripe doesn't send an Authorization header — it signs the
 * raw request body with STRIPE_WEBHOOK_SECRET. We verify the signature
 * via stripe.webhooks.constructEventAsync before trusting any field on
 * the event. Idempotency: every event carries a unique event.id which
 * we store as payments.transaction_id; replays are detected by primary
 * key conflict and short-circuited with 200.
 *
 * Activation steps:
 *   1. Create Stripe restricted key with Write on Payment Intents.
 *   2. Register endpoint:
 *      https://vgjmfpryobsuboukbemr.supabase.co/functions/v1/stripe-webhook
 *      Subscribe to: checkout.session.completed, payment_intent.succeeded,
 *                    charge.refunded, payment_intent.payment_failed.
 *   3. Paste signing secret as STRIPE_WEBHOOK_SECRET in Supabase secrets.
 *   4. Paste restricted API key as STRIPE_API_KEY in Supabase secrets.
 *   5. Until both secrets are present this function returns 503 — that's
 *      the fail-safe so a misrouted hit can't be mistaken for activation.
 *
 * verify_jwt=false because Stripe isn't a Supabase caller.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import Stripe from 'https://esm.sh/stripe@14.25.0?target=deno';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');
const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'stripe-signature, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function log(level: 'info'|'warn'|'error', event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, fn: 'stripe-webhook', ...data }));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Activation gate. Both secrets must be present — having only the
  // signing secret without the API key would mean we accept and write
  // payment events but can't reconcile them against Stripe's API later.
  if (!STRIPE_WEBHOOK_SECRET || !STRIPE_API_KEY) {
    log('warn', 'stripe_not_configured', { has_secret: !!STRIPE_WEBHOOK_SECRET, has_api_key: !!STRIPE_API_KEY });
    return json({
      error: 'stripe_not_configured',
      message: 'Set STRIPE_WEBHOOK_SECRET and STRIPE_API_KEY in Supabase edge function secrets to activate.',
    }, 503);
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) return json({ error: 'missing_signature' }, 400);

  const raw = await req.text();
  const stripe = new Stripe(STRIPE_API_KEY, { apiVersion: '2024-06-20' });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    log('warn', 'signature_invalid', { err: String(err) });
    return json({ error: 'bad_signature' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Idempotency: transaction_id carries event.id. A replay hits the
  // unique index and we short-circuit. Belt-and-braces: also check
  // before insert so we can return a clean 200 instead of swallowing
  // a constraint error.
  const { data: existing } = await admin
    .from('payments')
    .select('id')
    .eq('transaction_id', event.id)
    .maybeSingle();

  if (existing) {
    log('info', 'replay_ignored', { event_id: event.id, type: event.type });
    return json({ received: true, replay: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const bookingId = session.metadata?.booking_id;
        if (!bookingId) {
          log('warn', 'missing_booking_metadata', { event_id: event.id, session: session.id });
          // Acknowledge so Stripe doesn't retry — but flag loudly. The
          // misconfiguration is on the checkout-creation side.
          return json({ received: true, warning: 'missing_booking_id_metadata' });
        }
        const amount = (session.amount_total ?? 0) / 100;
        const { error } = await admin.from('payments').insert({
          booking_id: bookingId,
          amount,
          currency: (session.currency || 'aed').toUpperCase(),
          type: 'deposit',
          status: 'processing',
          payment_method: 'card',
          transaction_id: event.id,
          provider: 'stripe',
        });
        if (error) throw error;
        break;
      }

      case 'payment_intent.succeeded': {
        const intent = event.data.object as Stripe.PaymentIntent;
        const bookingId = intent.metadata?.booking_id;
        if (!bookingId) {
          log('warn', 'missing_booking_metadata', { event_id: event.id, intent: intent.id });
          return json({ received: true, warning: 'missing_booking_id_metadata' });
        }
        const amount = intent.amount_received / 100;
        // Update existing processing row if checkout.session.completed
        // landed first; otherwise insert. The .upsert isn't viable here
        // because there's no natural unique key per (booking_id, type).
        const { data: pending } = await admin
          .from('payments')
          .select('id')
          .eq('booking_id', bookingId)
          .eq('status', 'processing')
          .eq('provider', 'stripe')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (pending) {
          const { error } = await admin
            .from('payments')
            .update({
              status: 'completed',
              paid_at: new Date().toISOString(),
              transaction_id: event.id,
              amount,
            })
            .eq('id', pending.id);
          if (error) throw error;
        } else {
          const { error } = await admin.from('payments').insert({
            booking_id: bookingId,
            amount,
            currency: (intent.currency || 'aed').toUpperCase(),
            type: 'deposit',
            status: 'completed',
            payment_method: 'card',
            transaction_id: event.id,
            paid_at: new Date().toISOString(),
            provider: 'stripe',
          });
          if (error) throw error;
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const intent = event.data.object as Stripe.PaymentIntent;
        const bookingId = intent.metadata?.booking_id;
        if (!bookingId) {
          log('warn', 'missing_booking_metadata', { event_id: event.id });
          return json({ received: true, warning: 'missing_booking_id_metadata' });
        }
        const { error } = await admin
          .from('payments')
          .update({ status: 'failed', transaction_id: event.id })
          .eq('booking_id', bookingId)
          .eq('provider', 'stripe')
          .eq('status', 'processing');
        if (error) throw error;
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const intentId = typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id;
        // Refund refers back to the original payment_intent. We stored
        // its event.id in transaction_id on success; there's no direct
        // pointer here, so we widen by metadata.booking_id if Stripe
        // copied it onto the charge (they do when the PI carried it).
        const bookingId = charge.metadata?.booking_id;
        if (!bookingId) {
          log('warn', 'refund_without_booking_metadata', { event_id: event.id, intent: intentId });
          return json({ received: true, warning: 'missing_booking_id_metadata' });
        }
        const { error } = await admin
          .from('payments')
          .update({ status: 'refunded', transaction_id: event.id })
          .eq('booking_id', bookingId)
          .eq('provider', 'stripe')
          .eq('status', 'completed');
        if (error) throw error;
        break;
      }

      default:
        log('info', 'unhandled_event', { event_id: event.id, type: event.type });
    }
  } catch (err) {
    log('error', 'handler_failed', { event_id: event.id, type: event.type, err: String(err) });
    return json({ error: 'handler_failed', detail: String(err) }, 500);
  }

  log('info', 'event_processed', { event_id: event.id, type: event.type });
  return json({ received: true });
});
