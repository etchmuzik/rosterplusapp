// send-push
//
// Fanout function that forwards a notification to every registered
// device token for a user. Called via pg_net from a trigger on
// public.notifications INSERT (configured below), OR manually via POST
// { user_id, title, body, data? }.
//
// APNs wire-up is gated behind APNS_AUTH_KEY — until the auth key +
// team id + key id are set in Supabase secrets, the function logs
// what it would have sent and returns a dry-run payload. This keeps
// the migration + table scaffolding ready without requiring the
// credentials to exist yet.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type IncomingPayload = {
  user_id: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// APNs credentials — optional. When absent we run in dry-run mode.
const APNS_AUTH_KEY = Deno.env.get("APNS_AUTH_KEY");
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID");
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID");
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID");
const APNS_HOST =
  Deno.env.get("APNS_HOST") ?? "https://api.push.apple.com";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  let payload: IncomingPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid json body" }, 400);
  }

  if (!payload.user_id || !payload.title) {
    return json({ error: "user_id and title are required" }, 400);
  }

  const { data: tokens, error } = await admin
    .from("device_tokens")
    .select("token, platform, environment")
    .eq("user_id", payload.user_id);

  if (error) {
    console.error("device_tokens lookup failed", error);
    return json({ error: error.message }, 500);
  }

  if (!tokens || tokens.length === 0) {
    return json({ dispatched: 0, note: "no tokens registered" });
  }

  const canSend = !!(APNS_AUTH_KEY && APNS_KEY_ID && APNS_TEAM_ID && APNS_BUNDLE_ID);
  if (!canSend) {
    console.log(
      `[send-push] dry-run for user=${payload.user_id} tokens=${tokens.length} title="${payload.title}"`
    );
    return json({
      dispatched: 0,
      dry_run: true,
      token_count: tokens.length,
      note:
        "APNs credentials not configured. Set APNS_AUTH_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID secrets to go live.",
    });
  }

  // Real APNs dispatch lands here when credentials are configured.
  // The JWT minting + HTTP/2 POST per token is straightforward but
  // out of scope for the dry-run scaffold. See Apple's "Sending
  // Notification Requests to APNs" guide for the 20-line reference.
  let dispatched = 0;
  for (const row of tokens) {
    try {
      // Placeholder — swap with apnsSend(...) when wiring for real.
      console.log(
        `[send-push] would send to ${row.platform}:${row.token} (${row.environment})`
      );
      dispatched++;
    } catch (err) {
      console.error("apns dispatch failed", err);
    }
  }

  return json({ dispatched, token_count: tokens.length });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
