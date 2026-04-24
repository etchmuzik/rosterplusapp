# SEO Foundation

Last touched: **2026-04-23**.

## What's live

### Schema.org markup
- **Homepage** (`/index.html`): `Organization` + `WebSite` `@graph` — gives Google a knowledge-graph entity and unlocks sitelinks search box for branded "rostr" queries
- **Profile** (`/profile.html`): `MusicGroup` with `name`, `description`, `image`, `genre`, `address.addressLocality`, `sameAs` (Instagram/SoundCloud/Spotify/YouTube/TikTok when present), and `aggregateRating` once a profile accumulates reviews — this is what powers star-rating rich snippets in SERPs
- **EPK** (`/epk.html`): existing `MusicGroup` block

### Meta + OG
Every public page has:
- Unique `<title>` + `<meta name="description">`
- `og:type / og:title / og:description / og:image / og:url` for link previews (WhatsApp, Slack, iMessage, Instagram DMs)
- `twitter:card="summary_large_image"`
- `<link rel="canonical">` pointing at the clean URL

Profile pages dynamically rewrite all of the above once the artist data loads, and the share flow routes through the `profile-share` edge function so link-preview bots get rendered OG tags before any JS runs.

### Sitemap
`/sitemap.xml` covers:
- All 6 marketing surfaces (homepage, directory, auth, privacy, terms, status)
- Every `verified=true` artist's `/profile.html?id=…` URL

### Robots
`/robots.txt` allows the public paths, disallows `/admin.html`, `/dashboard.html`, `/bookings.html`, `/contracts.html`, `/payments.html`, `/messages.html`, `/settings.html`, and `/claim-profile.html` (noindex'd too).

## Regenerate sitemap when artist set changes

```bash
bash scripts/generate-sitemap.sh
# Optional: fail CI if sitemap is stale
bash scripts/generate-sitemap.sh --check
```

The script reads the Supabase anon key from `assets/js/app.js` (public by design; RLS protects data), pulls every `verified=true` artist, and writes a fresh `sitemap.xml` with correct `<lastmod>` dates derived from each row's `updated_at`.

**Run cadence:** on every deploy, and any time an admin verifies a new artist. Could be automated by a post-verify hook in the admin console — on the TODO list.

## Verifying rich results

Google Search Console → URL Inspection → paste a profile URL. Look for:
- "Enhancements" section reports `Products` or `Review snippets` with 0 errors
- Under "Live test", "Structured data" tab shows `MusicGroup` and `AggregateRating` detected

Rich Results Test (no auth required): https://search.google.com/test/rich-results?url=https%3A%2F%2Frosterplus.io%2Fprofile.html%3Fid%3D49f85dd9-6f67-42db-b657-c75f91326c49

Schema.org validator: https://validator.schema.org/

## Search Console submission (one-time setup)

The `<meta name="google-site-verification">` placeholder is already wired into `index.html`. You just need to swap in the real token:

1. Go to https://search.google.com/search-console/welcome
2. Pick "URL prefix" method, enter `https://rosterplus.io`
3. Pick "HTML tag" verification → Google shows you a token like `abc123xyz...`
4. In `index.html`, find the line:
   ```html
   <meta name="google-site-verification" content="GOOGLE_SITE_VERIFICATION_TOKEN">
   ```
   Replace `GOOGLE_SITE_VERIFICATION_TOKEN` with the real token value.
5. Commit + deploy (`git commit` + `npm run deploy`)
6. Back in Search Console, click **Verify**
7. Once verified: **Sitemaps** → submit `https://rosterplus.io/sitemap.xml`

Bing Webmaster Tools picks up Google's verification automatically — submit the same sitemap URL at https://www.bing.com/webmasters after step 6.

## Lighthouse CI

CI fires Lighthouse on every pull request against the live-ish local server. Config lives in `.lighthouserc.json`.

Thresholds today:
- **Accessibility ≥ 0.90** — hard fail (error)
- **SEO ≥ 0.95** — hard fail (error)
- **Performance ≥ 0.85** — warn only (perf varies in CI runners)
- **Best Practices ≥ 0.90** — warn only

URLs audited: homepage, directory, auth. Profile pages skipped in CI because they need live data.

Adjust thresholds in `.lighthouserc.json` as the product matures.

## Open tasks

- [ ] Submit sitemap to Google Search Console + Bing Webmaster Tools (one-off)
- [ ] Automate sitemap regen as a deploy hook (`scripts/deploy.sh` → call `generate-sitemap.sh` before FTP upload)
- [ ] Add `Event` schema to booking detail pages for promoters (post-event, public view only)
- [ ] Add `BreadcrumbList` markup to directory → profile navigation
- [ ] International: switch to localized subdomains (`ae.rosterplus.io`, `sa.rosterplus.io`) once we have city-specific inventory justifying it
- [ ] Lighthouse SEO audit on every page in CI with score threshold of 95+

## Why JSON-LD, not microdata

Google documents JSON-LD as the preferred format — it doesn't pollute HTML, it's trivially templated, and it can carry more relationship data. All our structured data ships as `<script type="application/ld+json">` blocks.
