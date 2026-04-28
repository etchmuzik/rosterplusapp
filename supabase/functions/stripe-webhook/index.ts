/*
 * stripe-webhook
 *
 * Stub that will eventually receive Stripe checkout.session.completed
 * and payment_intent.succeeded events. Right now it's INERT — it
 * refuses to process anything unless STRIPE_WEBHOOK_SECRET is set,
 * so a missing env var is the fail-safe that keeps us from accepting
 * random POSTs as real payments.
 *
 * To activate:
 *   1. Create a Stripe account, add a restricted key with Write on Payment Intents
 *   2. Register this endpoint in Stripe dashboard:
 *      https://vgjmfpryobsuboukbemr.supabase.co/functions/v1/stripe-webhook
 *      Subscribe to: checkout.session.completed, payment_intent.succeeded,
 *      charge.refunded, payment_intent.payment_failed
 *   3. Paste the Stripe signing secret into Supabase Edge Function secrets
 *      as STRIPE_WEBHOOK_SECRET
 *   4. Paste the restricted API key as STRIPE_API_KEY
 *   5. Once both secrets are present this function starts processing
 *      events and inserting/updating the corresponding payments rows.
 *
 * verify_jwt=false because Stripe doesn't send an Authorization header
 * — it signs the raw body with STRIPE_WEBHOOK_SECRET instead, which
 * we verify before trusting any of its claims.
 */

const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Fail-safe: if we haven't actually configured Stripe yet, log every
  // hit but don't pretend to succeed. Returns 503 so if some webhook is
  // misrouted we see it in the monitoring.
  if (!STRIPE_WEBHOOK_SECRET) {
    console.warn('[stripe-webhook] Received hit but STRIPE_WEBHOOK_SECRET is unset — Stripe integration not yet activated.');
    return json({
      error: 'stripe_not_configured',
      message: 'This endpoint is reserved for Stripe integration. Set STRIPE_WEBHOOK_SECRET in Supabase edge function secrets to activate.',
    }, 503);
  }

  // ------------------------------------------------------------------
  // When STRIPE_WEBHOOK_SECRET is eventually set, the code below takes
  // over. It's stubbed here so the wiring exists — we're just not
  // trusting any events until signature verification is plumbed in.
  // ------------------------------------------------------------------

  const sig = req.headers.get('stripe-signature');
  if (!sig) return json({ error: 'missing_signature' }, 400);

  // TODO when activating:
  //   - read raw body
  //   - verify with stripe.webhooks.constructEventAsync(body, sig, secret)
  //   - switch on event.type:
  //       checkout.session.completed   -> insert payment row, status=processing
  //       payment_intent.succeeded     -> update payment row, status=completed
  //       charge.refunded              -> update payment row, status=refunded
  //       payment_intent.payment_failed -> update payment row, status=failed
  //   - use the service role Supabase client to write to payments table
  //   - idempotency: use event.id as the transaction_id to dedupe

  return json({ received: true, note: 'Stub accepted signature but no event handlers are active yet.' });
});
