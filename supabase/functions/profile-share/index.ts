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
  // Inputs — three param shapes are accepted:
  //   ?id=<uuid>          (profile.html, epk.html)
  //   ?artist=<uuid>      (booking.html legacy)
  //   ?handle=<kebab>     (per-artist Linktree at /a/<handle>)
  // .htaccess passes the original query string through verbatim,
  // so whichever shape the source URL used arrives here intact.
  const idParam     = url.searchParams.get('id') || '';
  const artistParam = url.searchParams.get('artist') || '';
  const handleParam = url.searchParams.get('handle') || '';

  // `path` query selects which canonical URL the rendered preview
  // refers back to. Recognised values:
  //   'profile'  → /profile.html?id=<uuid>          (default)
  //   'epk'      → /epk.html?id=<uuid>
  //   'booking'  → /booking.html?artist=<uuid>
  //   'link'     → /a/<handle>                       (per-artist Linktree)
  // Anything else falls through to 'profile'.
  const pathParam = (url.searchParams.get('path') || 'profile').toLowerCase();
  const isLink    = pathParam === 'link';
  const isEpk     = pathParam === 'epk';
  const isBooking = pathParam === 'booking';

  // Fallback: nothing to look up by → generic
  if (!idParam && !artistParam && !handleParam) {
    return new Response(page({
      title: 'Artist profile — ROSTR+ GCC',
      description: 'Browse verified GCC artists on ROSTR+.',
      image: `${SITE_URL}/icons/og-default.png`,
      canonical: `${SITE_URL}/directory.html`,
      redirectTo: `${SITE_URL}/directory.html`,
    }), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
  }

  // Resolve artist row. Lookup column depends on which param arrived:
  // handle is case-insensitive (matches DB.getArtistByHandle), id/
  // artist are exact UUID matches. We always filter out soft-deleted
  // rows so unfurl never returns ghosts.
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let query = sb
    .from('artists')
    .select('id, handle, stage_name, genre, cities_active, verified, profiles(display_name, avatar_url, bio, city)')
    .is('deleted_at', null);

  if (handleParam) {
    query = query.ilike('handle', handleParam);
  } else {
    query = query.eq('id', idParam || artistParam);
  }
  const { data, error } = await query.maybeSingle();

  // Compose canonical/redirect URL based on path.
  let redirectTo = `${SITE_URL}/directory.html`;
  if (data) {
    if (isLink) {
      // Prefer handle in the canonical; fall back to UUID if the row
      // doesn't have one yet (unclaimed rows pre-handle migration).
      const slug = data.handle || data.id;
      redirectTo = `${SITE_URL}/a/${encodeURIComponent(slug)}`;
    } else if (isEpk) {
      redirectTo = `${SITE_URL}/epk.html?id=${encodeURIComponent(data.id)}`;
    } else if (isBooking) {
      redirectTo = `${SITE_URL}/booking.html?artist=${encodeURIComponent(data.id)}`;
    } else {
      redirectTo = `${SITE_URL}/profile.html?id=${encodeURIComponent(data.id)}`;
    }
  } else if (handleParam) {
    // Handle didn't resolve — point the not-found preview at the
    // directory rather than a broken /a/<bad-handle> URL.
    redirectTo = `${SITE_URL}/directory.html`;
  }

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

  // Title prefix per path:
  //   booking → "Book {name}" (reads as an invitation)
  //   link    → "{name} · @{handle}" (Linktree-style intro)
  //   default → "{name}"
  const handleSuffix = (isLink && data?.handle) ? ` · @${data.handle}` : '';
  const title = isBooking
    ? `Book ${name} — ROSTR+ GCC`
    : `${name}${handleSuffix} — ROSTR+ GCC`;
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
