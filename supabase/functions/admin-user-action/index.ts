// Admin-only edge function for user actions that require the Supabase
// admin API (not exposed to client): suspend, unsuspend, impersonate,
// resend welcome email. Rate-limited via _admin_rl_hit_for RPC.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function log(level: 'info'|'warn'|'error', event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, fn: 'admin-user-action', ...data }));
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    log('warn', 'no_bearer');
    return json({ error: 'unauthorized' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: authData, error: authErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authErr || !authData?.user) {
    log('warn', 'invalid_token');
    return json({ error: 'unauthorized' }, 401);
  }
  const actorId = authData.user.id;
  const actorEmail = authData.user.email || null;

  const allowlist = ['beyondtech.eg@gmail.com', 'h.saied@outlook.com'];
  if (!actorEmail || !allowlist.includes(actorEmail.toLowerCase())) {
    log('warn', 'not_admin', { actor_email: actorEmail });
    return json({ error: 'forbidden' }, 403);
  }

  let payload: { action?: string; user_id?: string; reason?: string };
  try { payload = await req.json(); } catch (_) { return json({ error: 'invalid_body' }, 400); }

  const action = String(payload.action || '').trim();
  const targetUserId = String(payload.user_id || '').trim();
  const reason = payload.reason ? String(payload.reason).slice(0, 500) : null;

  if (!action || !targetUserId) return json({ error: 'missing_args' }, 400);
  if (targetUserId === actorId) {
    log('warn', 'self_action', { action });
    return json({ error: 'cannot_action_self' }, 400);
  }

  log('info', 'invoked', { action, actor_email: actorEmail, target: targetUserId });

  // Rate limit BEFORE doing any real work. The action keys here must
  // match the ones in _admin_rl_hit_for's CASE branch.
  try {
    const { error: rlErr } = await admin.rpc('_admin_rl_hit_for', {
      p_admin_id: actorId,
      p_action: action === 'resend_welcome' ? 'resend_welcome' : action,
    });
    if (rlErr) {
      const msg = String(rlErr.message || '');
      if (msg.includes('rate_limited')) {
        log('warn', 'rate_limited', { action });
        return json({ error: 'rate_limited', detail: msg }, 429);
      }
      log('warn', 'rl_check_failed', { err: msg });
    }
  } catch (e) {
    log('warn', 'rl_threw', { err: String(e) });
  }

  async function audit(evt: string, before: Record<string, unknown>, after: Record<string, unknown>, meta: Record<string, unknown>) {
    try {
      await admin.from('admin_audit_log').insert({
        actor_id: actorId,
        actor_email: actorEmail,
        action: evt,
        target_type: 'user',
        target_id: targetUserId,
        before_value: before,
        after_value: after,
        meta,
      });
    } catch (e) {
      log('warn', 'audit_insert_failed', { err: String(e) });
    }
  }

  try {
    if (action === 'suspend') {
      const { data, error } = await admin.auth.admin.updateUserById(targetUserId, {
        ban_duration: '876000h',
      });
      if (error) {
        log('error', 'suspend_failed', { err: error.message });
        return json({ error: error.message }, 500);
      }
      await audit('user.suspend',
        { banned: false },
        { banned: true, banned_until: data.user?.banned_until || null },
        { reason: reason || '' }
      );
      log('info', 'suspended', { target: targetUserId });
      return json({ success: true, banned_until: data.user?.banned_until });
    }

    if (action === 'unsuspend') {
      const { data, error } = await admin.auth.admin.updateUserById(targetUserId, {
        ban_duration: 'none',
      });
      if (error) {
        log('error', 'unsuspend_failed', { err: error.message });
        return json({ error: error.message }, 500);
      }
      await audit('user.unsuspend',
        { banned: true },
        { banned: false },
        { reason: reason || '' }
      );
      log('info', 'unsuspended', { target: targetUserId });
      return json({ success: true });
    }

    if (action === 'impersonate') {
      const { data: target, error: tErr } = await admin.auth.admin.getUserById(targetUserId);
      if (tErr || !target?.user?.email) {
        log('error', 'impersonate_no_user');
        return json({ error: 'target_not_found' }, 404);
      }
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: target.user.email,
      });
      if (linkErr || !linkData?.properties?.action_link) {
        log('error', 'impersonate_link_failed', { err: linkErr?.message });
        return json({ error: linkErr?.message || 'link_failed' }, 500);
      }
      await audit('user.impersonate',
        {},
        { target_email: target.user.email },
        { reason: reason || '' }
      );
      log('info', 'impersonate_link_minted', { target: targetUserId });
      return json({ success: true, link: linkData.properties.action_link, target_email: target.user.email });
    }

    if (action === 'resend_welcome') {
      const { data: target } = await admin.auth.admin.getUserById(targetUserId);
      if (!target?.user?.email) return json({ error: 'target_not_found' }, 404);
      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
      if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY not configured' }, 500);
      const displayName = target.user.user_metadata?.display_name || target.user.email?.split('@')[0] || 'there';
      const role = target.user.user_metadata?.role || 'promoter';
      const cta = role === 'artist' ? 'https://rosterplus.io/artist-dashboard.html#setup' : 'https://rosterplus.io/dashboard.html#setup';
      const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#08090b;color:#fff;padding:40px;border-radius:12px">
        <h1 style="color:#f3f5f8;font-size:28px;margin-bottom:8px;letter-spacing:-0.03em">Welcome back to ROSTR+</h1>
        <p style="color:rgba(255,255,255,0.58);line-height:1.6">An admin re-sent this welcome because you might have missed it. Your account is ready — tap below to continue setup.</p>
        <a href="${cta}" style="display:inline-block;background:#f3f5f8;color:#08090b;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:20px;font-size:15px">Finish setting up</a>
      </div>`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'ROSTER+ <book@rosterplus.io>', to: target.user.email, subject: 'Welcome back to ROSTR+', html }),
      });
      await audit('user.resend_welcome', {}, { target_email: target.user.email }, {});
      log('info', 'welcome_resent', { target: targetUserId });
      return json({ success: true });
    }

    log('warn', 'unknown_action', { action });
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    log('error', 'unhandled', { err: String(e) });
    return json({ error: String(e) }, 500);
  }
});
