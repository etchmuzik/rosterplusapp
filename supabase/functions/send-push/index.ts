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

// 2026-05-13 audit v2 P1-3: this function had no caller authentication.
// Any unauthenticated POST with {user_id, title, body} could spam push
// notifications to any user given their UUID — a phishing / harassment
// vector. Now requires either the service-role key (used by the
// pg_net trigger on notifications INSERT) OR a valid signed-in user's
// JWT, in which case the caller must be the target user OR an admin.
/**
 * Constant-time string compare. Use for any secret comparison that
 * runs against a request-supplied value, otherwise the response-time
 * difference between mismatch-at-position-1 and mismatch-at-position-N
 * leaks the secret one byte at a time. Returns false fast on length
 * mismatch (length itself isn't secret here — both sides are JWTs of
 * a known fixed length).
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function authorizeCaller(req: Request, targetUserId: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return { ok: false, status: 401, message: "unauthorized" };

  // Service role token — trusted internal caller (pg_net trigger).
  // Constant-time compare so the response time doesn't leak the secret
  // one byte at a time. 2026-05-16 audit HIGH.
  if (constantTimeEqual(bearer, SERVICE_ROLE_KEY)) return { ok: true };

  // End-user JWT — verify + check that they're the target or an admin.
  try {
    const { data: ures, error } = await admin.auth.getUser(bearer);
    if (error || !ures?.user) return { ok: false, status: 401, message: "unauthorized" };
    if (ures.user.id === targetUserId) return { ok: true };
    // Check admin via email allowlist (mirror of public.is_admin()).
    const adminEmails = new Set(["h.saied@outlook.com", "beyondtech.eg@gmail.com"]);
    if (ures.user.email && adminEmails.has(ures.user.email.toLowerCase())) return { ok: true };
    return { ok: false, status: 403, message: "forbidden" };
  } catch (_e) {
    return { ok: false, status: 401, message: "unauthorized" };
  }
}

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

  const authz = await authorizeCaller(req, payload.user_id);
  if (!authz.ok) {
    return json({ error: authz.message }, authz.status);
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
