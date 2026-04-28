// Edge-rendered artist profile meta for link-preview bots.
//
// Why this exists: the app is static HTML + client-side JS. When
// WhatsApp / Instagram / Slack / Twitter / Facebook crawl a
// /profile.html?id=X link, they read the server response BEFORE any
// JS runs — so every artist profile renders the same generic
// og:title / og:image. Result: shared links look identical regardless
// of which artist.
//
// This function fixes that. URL pattern: /functions/v1/profile-share?id=<uuid>
// Response: a tiny HTML document with the specific artist's name,
// bio, and avatar in the meta tags, followed by a <meta refresh>
// to the real /profile.html. Link-preview bots read the meta and
// stop; real browsers pass through to the SPA within 0.3s.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE_URL = 'https://rosterplus.io';

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'": '&#39;' }[c]!));
}

function page(opts: {
  title: string;
  description: string;
  image: string;
  canonical: string;
  redirectTo: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(opts.canonical)}">

<meta property="og:type" content="profile">
<meta property="og:site_name" content="ROSTR+ GCC">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:image" content="${esc(opts.image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(opts.canonical)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(opts.title)}">
<meta name="twitter:description" content="${esc(opts.description)}">
<meta name="twitter:image" content="${esc(opts.image)}">

<meta http-equiv="refresh" content="0; url=${esc(opts.redirectTo)}">
<script>setTimeout(function(){ location.replace(${JSON.stringify(opts.redirectTo)}); }, 50);</script>
</head>
<body style="background:#08090b;color:#fff;font-family:sans-serif;text-align:center;padding:40px">
<p style="color:rgba(255,255,255,0.6)">Loading <a href="${esc(opts.redirectTo)}" style="color:#f3f5f8">${esc(opts.title)}</a>…</p>
</body>
</html>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get('id') || '';

  // Fallback: no id → generic
  if (!id) {
    return new Response(page({
      title: 'Artist profile — ROSTR+ GCC',
      description: 'Browse verified GCC artists on ROSTR+.',
      image: `${SITE_URL}/icons/og-default.png`,
      canonical: `${SITE_URL}/directory.html`,
      redirectTo: `${SITE_URL}/directory.html`,
    }), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from('artists')
    .select('id, stage_name, genre, cities_active, verified, profiles(display_name, avatar_url, bio, city)')
    .eq('id', id)
    .maybeSingle();

  const redirectTo = `${SITE_URL}/profile.html?id=${encodeURIComponent(id)}`;

  if (error || !data) {
    return new Response(page({
      title: 'Artist not found — ROSTR+ GCC',
      description: 'This artist profile doesn’t exist or has been removed.',
      image: `${SITE_URL}/icons/og-default.png`,
      canonical: redirectTo,
      redirectTo,
    }), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
  }

  const name  = data.stage_name || data.profiles?.display_name || 'Artist';
  const genre = Array.isArray(data.genre) ? data.genre[0] : (data.genre || '');
  const city  = (Array.isArray(data.cities_active) ? data.cities_active[0] : '') || data.profiles?.city || '';
  const bio   = String(data.profiles?.bio || '').trim();
  const img   = data.profiles?.avatar_url || `${SITE_URL}/icons/og-default.png`;

  const title = `${name} — ROSTR+ GCC`;
  // Prefer the real bio. Fall back to a generated line. Truncate at 160
  // chars (standard meta-description convention).
  const descFallback = [genre, city].filter(Boolean).join(' — ') + (data.verified ? ' · Verified on ROSTR+.' : ' · Book on ROSTR+.');
  const descRaw = bio || descFallback;
  const desc = descRaw.length > 160 ? descRaw.slice(0, 157) + '…' : descRaw;

  return new Response(page({
    title,
    description: desc,
    image: img,
    canonical: redirectTo,
    redirectTo,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 5-minute cache at the CDN, 1-minute at the browser. Link-preview
      // bots typically respect cache-control.
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
});
