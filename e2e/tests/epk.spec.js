// epk.spec.js
//
// Guards the regression we fixed in commit ecc1e83 (2026-04-28):
// `/epk.html` was reading `?artist=<id>` while five producers (artist
// dashboard share button, the send-artist-onboarding-drip welcome
// email, the iOS share sheet, the in-dashboard EPK link card, and
// the README) emit `?id=<id>`. Mismatch → page bounced to
// `/directory.html` instead of rendering the EPK.
//
// The fix made the reader accept both shapes. This suite locks that
// behaviour in:
//
//   1. /epk.html?id=<uuid>      → renders the EPK
//   2. /epk.html?artist=<uuid>  → renders the EPK (back-compat)
//   3. /epk.html (no params)    → redirects to /directory.html
//
// Why we mock Supabase instead of hitting it: the test must be
// hermetic. We don't want a CI run to depend on a specific row
// existing in production, and we don't want CI to send anonymous
// PostgREST traffic to the live project on every push. page.route()
// intercepts the request the supabase-js client makes when the page
// calls DB.getArtistEPK(...) and returns a canned artist payload.

const { test, expect } = require('@playwright/test');

const FAKE_ARTIST_ID = '00000000-0000-0000-0000-000000000001';
const FAKE_STAGE_NAME = 'TEST DJ ROSTR';

// Shape mirrors what app.js DB.getArtistEPK normalises to: a flat
// public.artists row plus an inlined `profiles(...)` join. PostgREST
// returns this as a JSON array (the `.single()` call upstream slices
// off `[0]` itself).
const fakeArtistRow = {
  id: FAKE_ARTIST_ID,
  stage_name: FAKE_STAGE_NAME,
  genre: ['Tech House'],
  subgenres: [],
  cities_active: ['Dubai'],
  base_fee: 28000,
  rate_max: 56000,
  currency: 'AED',
  status: 'active',
  total_bookings: 12,
  social_links: {},
  press_quotes: [],
  past_performances: [],
  tech_rider: [],
  epk_gallery: [],
  blocked_dates: [],
  available_from: null,
  available_to: null,
  profiles: {
    display_name: FAKE_STAGE_NAME,
    avatar_url: null,
    city: 'Dubai',
    bio: 'Hermetic test fixture — see e2e/tests/epk.spec.js.',
  },
};

// Intercepts every Supabase request issued by supabase-js so the test
// is hermetic:
//
//   1. /auth/v1/token, /auth/v1/user, /auth/v1/session — return an
//      empty session so Auth.init() resolves immediately on the
//      "no session" branch instead of waiting for its 6 s safety
//      timeout (the playwright default per-test timeout is 15 s, but
//      we want headroom for the redirect assertion below).
//   2. /rest/v1/artists?... — return a canned artist row so
//      DB.getArtistEPK() resolves with success and renderEPK() runs.
//
// .single() in supabase-js sends `Accept: application/vnd.pgrst.object+json`
// which makes PostgREST return an object instead of an array.
// Returning the object form keeps things simple either way.
async function mockSupabase(page) {
  // Auth — pretend the user is signed-out. supabase-js polls a few of
  // these on init; reply 200 with no session so Auth.init resolves on
  // the empty-session branch.
  await page.route(/supabase\.co\/auth\/v1\//, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { session: null }, session: null, user: null }),
    });
  });
  // PostgREST artist read
  await page.route(/supabase\.co\/rest\/v1\/artists/, async (route) => {
    const headers = route.request().headers();
    const wantsObject = (headers['accept'] || '').includes('vnd.pgrst.object');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(wantsObject ? fakeArtistRow : [fakeArtistRow]),
    });
  });
}

test.describe('EPK page (epk.html) — public read', () => {
  test('?id=<uuid> renders the artist stage name @smoke', async ({ page }) => {
    await mockSupabase(page);
    await page.goto(`/epk.html?id=${FAKE_ARTIST_ID}`);
    // Wait for the renderer to swap the "Loading EPK..." placeholder
    // for actual content. The .epk-name element is the canonical hero
    // heading inside renderEPK().
    const heroName = page.locator('.epk-name');
    await expect(heroName).toBeVisible({ timeout: 5000 });
    await expect(heroName).toHaveText(FAKE_STAGE_NAME);
  });

  test('?artist=<uuid> back-compat shape also renders @smoke', async ({ page }) => {
    await mockSupabase(page);
    await page.goto(`/epk.html?artist=${FAKE_ARTIST_ID}`);
    const heroName = page.locator('.epk-name');
    await expect(heroName).toBeVisible({ timeout: 5000 });
    await expect(heroName).toHaveText(FAKE_STAGE_NAME);
  });

  test('no query param redirects to /directory.html @smoke', async ({ page }) => {
    // Need the Supabase auth mock so Auth.ready() resolves on the
    // signed-out branch — without it the page sits on "Loading EPK..."
    // until the 6 s safety timeout. We don't mock /rest/v1/artists
    // because the no-param branch never issues an artist fetch.
    await mockSupabase(page);
    await page.goto(`/epk.html`);
    // The page client-side-redirects via window.location.href.
    await page.waitForURL(/\/directory\.html(\?|$)/, { timeout: 8000 });
    expect(page.url()).toContain('/directory.html');
  });

  test('canonical URL on a rendered EPK uses ?id= shape @smoke', async ({ page }) => {
    // The self-built share-bar / OG / canonical URL was previously
    // emitting ?artist=, which split the link surface area. After the
    // fix it emits ?id= so newly-shared links match the rest of the
    // platform. This catches any future drift.
    await mockSupabase(page);
    await page.goto(`/epk.html?id=${FAKE_ARTIST_ID}`);
    await expect(page.locator('.epk-name')).toBeVisible({ timeout: 5000 });
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toContain(`?id=${FAKE_ARTIST_ID}`);
    expect(canonical).not.toContain('?artist=');
  });
});
