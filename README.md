# ROSTR+ GCC

**Artist booking platform for the Gulf.** Live at [rosterplus.io](https://rosterplus.io).

Promoters discover artists, send booking requests, sign contracts, and log payments. Artists receive requests, manage availability, share a live EPK, and get paid. Everything in one place — replacing WhatsApp threads + PDF contracts + spreadsheet payment logs.

---

## What's on the platform today

- **27 public/protected pages** — auth, dashboard, directory, booking wizard, contracts, payments, messages, EPK, admin console, public status page, 404 + offline fallbacks
- **5 Supabase edge functions** — `signup` (custom SMTP bypass), `send-email` (11 transactional templates), `send-booking-reminders` (24h-before cron), `send-artist-onboarding-drip` (1h/24h/72h cron), `send-review-prompts` (post-event cron)
- **8 pg_cron jobs** all self-logging to `cron_runs` — visible on both `/status.html` (anonymised) and `/admin.html` Health tab (full detail)
- **Mutual review system** — artists and promoters rate each other 3 days post-event. Drives `AggregateRating` JSON-LD which unlocks star-rating rich snippets in Google
- **Impersonation audit trail** — when admin "log in as user" is used, every mutation is tagged with the admin's email in `admin_audit_log`
- **Offline-capable PWA** — stale-while-revalidate service worker; dashboards work on bad wifi; branded `/offline.html` fallback
- **Accessibility** — skip-link, focus-trap in modals, `role=radiogroup` star picker, global ESC-to-close, aria-labels on every icon button
- **Visual regression suite** — Playwright screenshots on 8 pages × 2 viewports, diffed on every PR
- **Lighthouse CI** — hard gates on accessibility ≥0.90 and SEO ≥0.95

## Tech stack

- **Frontend**: static HTML / CSS / vanilla JS. No build step, no framework. Served from Hostinger
- **Backend**: Supabase — Postgres 17, Auth, Edge Functions (Deno), `pg_cron`, `pg_net`
- **Email**: Resend via the `send-email` edge function; unified visual shell + plain-text fallback
- **Hosting**: Hostinger shared hosting, deployed via lftp. HTTPS + HSTS + strict CSP
- **Monitoring**: `public.client_errors` table (JS runtime errors), `public.cron_runs` table (scheduled job health), optional Sentry via `assets/js/error-logger.js`
- **Analytics**: Plausible (cookieless)
- **CI**: GitHub Actions — syntax check, HTML well-formed check, Playwright smoke tests, visual regression, Lighthouse

## Pages (27)

| Path | Role | Notes |
|---|---|---|
| `/` (`index.html`) | Public | Landing — hero, social-proof, feature grid, reach map, pricing, closing CTA |
| `/directory.html` | Public | Browse + filter artists by city, genre, availability |
| `/profile.html?id=…` | Public | Public artist profile with reviews, `MusicGroup` + `AggregateRating` JSON-LD |
| `/epk.html?id=…` | Public | Electronic Press Kit with WhatsApp-native share button |
| `/auth.html` | Public | Sign in / sign up. Connection-error banner if SDK fails to load |
| `/claim-profile.html` | Post-auth | New artist claims an existing unclaimed profile, or starts fresh |
| `/dashboard.html` | Promoter | Stats, upcoming gigs, inbox, pipeline, suggestions |
| `/artist-dashboard.html` | Artist | 7-tab sidebar: overview, requests, upcoming, calendar, contracts, earnings, payouts |
| `/booking.html` | Promoter | 3-step booking wizard with conflict warning |
| `/bookings.html` | Promoter | Table of all bookings, filters, CSV export, kebab actions |
| `/booking-detail.html?id=…` | Both | Timeline, facts, record-payment, post-event review card |
| `/contracts.html` | Promoter | List, create, sign, download |
| `/contract.html?id=…` | Both | Single contract view with e-sign flow |
| `/payments.html` | Promoter | Payment list, stats, manual record flow |
| `/invoice.html?id=…` | Both | Print-ready invoice |
| `/messages.html` | Both | Real-time chat with quick-replies |
| `/calendar.html` | Artist | Month view with availability blocks |
| `/analytics.html` | Promoter | Booking trends, spend breakdown |
| `/artist-profile-edit.html` | Artist | Edit bio, rate, rider, gallery, socials |
| `/settings.html` | Both | Account, security, notifications, danger zone |
| `/admin.html` | Admin only | 9-tab console (Roster / Users / Bookings / Import / Broadcast / Audit / Emails / Errors / Health) |
| `/status.html` | Public | Uptime + per-job heatmap. Anonymised cron status |
| `/invite.html?token=…` | Public | Accept an invitation link |
| `/privacy.html`, `/terms.html` | Public | Legal |
| `/404.html` | Public | Custom 404 with attempted-path breadcrumb; auto-logs to `client_errors` |
| `/offline.html` | Public | Service-worker fallback for never-visited pages when offline |

## Repository layout

```
rostr-platform/
├── *.html                          # 27 page files
├── assets/
│   ├── css/system.css              # Design system (all tokens + components)
│   └── js/
│       ├── app.js                  # Core (Auth, DB, UI, Storage, Realtime, Emails)
│       └── error-logger.js         # Global error capture → client_errors table
├── icons/                          # PWA icons + og-default.png
├── sw.js                           # Service worker (SWR cache, offline fallback)
├── manifest.json                   # PWA manifest
├── sitemap.xml                     # Auto-generated by scripts/generate-sitemap.sh
├── robots.txt                      # Disallows admin/protected paths
├── .htaccess                       # Hostinger config: HTTPS + CSP + cache rules
│
├── supabase/
│   ├── functions/
│   │   ├── signup/                 # Custom signup (bypasses Supabase SMTP)
│   │   ├── send-email/             # 11 transactional templates, unified shell
│   │   ├── send-booking-reminders/ # 24h-before-event cron email
│   │   ├── send-artist-onboarding-drip/   # 1h / 24h / 72h artist drip
│   │   └── send-review-prompts/    # Post-event review prompt (3 days after)
│   └── migrations/                 # Schema history (mirrored from live via MCP)
│
├── scripts/
│   ├── deploy.sh                   # lftp + stamp-sw + stamp-app + ?v= stamp HTML
│   └── generate-sitemap.sh         # Rebuilds sitemap.xml from verified artists
│
├── docs/
│   ├── BACKUP_RESTORE.md           # pg_dump + restore drill runbook
│   └── SEO.md                      # Schema.org setup + Search Console steps
│
├── e2e/
│   ├── playwright.config.js        # Snapshot tolerances, viewport config
│   └── tests/                      # 10 spec files (smoke + visual regression)
│
├── .github/workflows/
│   ├── ci.yml                      # Syntax + HTML + smoke + visual + Lighthouse
│   └── visual-baseline.yml         # Manual: regenerate visual baselines on Linux CI
│
├── DEPLOY.md                       # Deploy runbook
└── README.md                       # This file
```

## Database (Supabase)

| Table | Purpose |
|---|---|
| `profiles` | User accounts. `role`, `display_name`, `onboarding_complete`, `onboarding_emails_sent` (jsonb drip tracker), `deleted_at` |
| `artists` | Extended artist data — `stage_name`, `genre`, `base_fee`, `tech_rider`, `epk_gallery`, `verified`, `blocked_dates` |
| `bookings` | `promoter_id`, `artist_id`, `venue_name`, `event_date`, `fee`, `status`, `reminder_sent_at`, `review_prompt_sent_at`, `deleted_at` |
| `contracts` | Booking contract with `audit_log` jsonb (who signed, when, what UA) |
| `payments` | `booking_id`, `amount`, `currency`, `status`, `payout_reference` |
| `messages` | Real-time chat, RLS-gated per conversation |
| `reviews` | Mutual ratings. `UNIQUE(booking_id, reviewer_id)` — upsert on edit |
| `notifications` | In-app bell notifications |
| `invitations` | Token-based invite flow |
| `venues` | Venue directory |
| `email_events` | Resend webhook ingestion (sent, opened, clicked, bounced) |
| `client_errors` | Runtime JS errors captured by `error-logger.js` |
| `cron_runs` | Every cron invocation — drives `/status.html` and admin Health tab |
| `admin_audit_log` | Every admin mutation + every user mutation during an impersonation session |
| `admin_rate_counter` | Per-(admin, action, minute) rate-limit counter |

All tables have RLS. Admin helpers gate on `public.is_admin()` which checks email against a static allowlist.

### Key RPCs

- `create_review(booking_id, rating, comment)` — SECURITY DEFINER, enforces party-to-booking + past event + reviewable status
- `review_stats_for_user(user_id)` → `{review_count, avg_rating}`
- `cron_health_summary()` — admin-gated per-job aggregates
- `cron_health_public()` — anonymised version for `/status.html`
- `log_impersonation_event(admin_email, action, target_type, target_id, meta)` — stamps audit log during impersonation
- `log_cron_run(job, status, duration_ms, error, meta)` — used by every `cron.schedule` wrapper
- `check_availability(artist_id, event_date, event_time)` — booking-conflict guard

## Cron jobs (all self-logging)

| Job | Schedule (UTC) | Purpose |
|---|---|---|
| `send-booking-reminders` | `0 * * * *` hourly | Emails both sides 24h before event |
| `send-artist-onboarding-drip` | `30 * * * *` hourly | Fires welcome / nudge / EPK-share at 1h / 24h / 72h age milestones |
| `send-review-prompts` | `0 10 * * *` daily | Prompts both parties for a rating 3 days after the event |
| `admin-daily-digest` | `0 5 * * *` daily | Summary email to admins |
| `expire-stale-contracts` | `0 2 * * *` daily | Marks unsigned contracts as expired after N days |
| `prune-client-errors` | `0 3 * * *` daily | Drops client_errors > 30 days |
| `prune-email-events` | `30 3 * * *` daily | Drops email_events > 90 days |
| `prune-cron-runs` | `0 4 * * 0` weekly | Drops cron_runs > 90 days |

## Performance

- **JS + CSS**: `defer` on all scripts, `preconnect` to jsdelivr + Supabase, long-cache (`max-age=31536000, immutable`) on `/assets/**`
- **Cache bust**: `scripts/deploy.sh` appends `?v=<git-sha>` to every `<link>` + `<script>` reference on deploy → fresh URLs each release, browsers treat old as stale automatically
- **Service worker**: stale-while-revalidate, `ignoreSearch: true` so SW precache matches versioned URLs, `CACHE_NAME` rotates per deploy
- **Offline**: branded `/offline.html` for never-visited pages; previously-cached pages load from SW
- **Lazy loading**: `loading="lazy" decoding="async"` on below-the-fold image galleries

## Security

- **CSP**: strict allowlist — `jsdelivr` for SDK, `plausible.io` for analytics, Supabase origins for API + WS, `fontshare` / `googleapis` for fonts. No inline scripts beyond a hard-coded bootstrap
- **HSTS**: `max-age=31536000; includeSubDomains; preload`
- **RLS** on every table; mutations go through SECURITY DEFINER RPCs where they need to touch other users' rows
- **XSS**: `esc()` helper on all user-controlled innerHTML
- **Admin rate-limiting**: per-(admin, action, minute-bucket) counters enforced in RPCs
- **Open redirects**: auth `?redirect=` param validated against same-origin allowlist
- **Role escalation**: signup edge function rejects anything other than `promoter` / `artist`; admin role granted by static email allowlist
- **Service worker** never caches Supabase API responses — personalised data can't leak cross-user on shared devices
- **File uploads**: 10MB cap + content-type validation
- **Audit log**: every admin mutation + every impersonated mutation written to `admin_audit_log`

## Accessibility

- Skip-to-content link as first tab-stop on every page
- Global `:focus-visible` outline
- All icon-only buttons have `aria-label`; decorative SVGs are `aria-hidden`
- All `.modal-overlay` elements carry `role="dialog"` + `aria-modal="true"` + focus-trap
- Global ESC-to-close on any visible overlay
- Review star picker uses `role="radiogroup"` / `role="radio"` + `aria-checked`
- Live status regions (`role="status" aria-live="polite"`) announce rating selections without focus moves
- Respects `prefers-reduced-motion`

## SEO

- Unique `<title>` + `<meta description>` per page
- OG / Twitter cards on every public page. Profile shares route through the `profile-share` edge function so link-preview bots get rendered OG tags before JS runs
- Sitemap auto-generated from verified artists (`scripts/generate-sitemap.sh`)
- Schema.org:
  - `Organization` + `WebSite` with `SearchAction` on homepage (unlocks sitelinks search box)
  - `MusicGroup` + `AggregateRating` on profile (unlocks star-rating rich snippets)
  - `sameAs` pulled from `artist.social_links` (Instagram, SoundCloud, Spotify, YouTube, TikTok)
- Search Console verification tag wired into `index.html` (placeholder; see `docs/SEO.md` for swap-in steps)

## Deploy

See [`DEPLOY.md`](./DEPLOY.md) for the full flow. Short version:

```bash
# One-time per machine
brew install lftp
cp .env.deploy.example .env.deploy  # fill in FTP_PASSWORD
npm install                         # Playwright for smoke tests

# Everyday
git commit -m "feat: …" && git push
npm run deploy
```

The deploy script:
1. Runs pre-flight checks (JS syntax, HTML well-formedness, Playwright smoke)
2. Stamps `sw.js` `CACHE_NAME` with the git sha
3. Stamps `app.js` top line with `window.ROSTR_VERSION`
4. Rewrites every `<link>` / `<script>` in every HTML file with `?v=<sha>`
5. lftp-uploads the diff to Hostinger
6. Restores all stamped files locally so git stays clean

## Testing

```bash
npm run test:smoke            # @smoke-tagged functional tests (~30s)
npm run test:visual           # Visual regression against committed baselines
npm run test:visual:update    # Regenerate baselines after an intentional design change
```

CI runs all three on every PR plus Lighthouse. Baseline regeneration happens on Linux Chromium via a manual workflow dispatch on GitHub Actions (`Visual Baseline Refresh`).

## Design system

Built around the [taste-skill](https://github.com/Leonxlnx/taste-skill) principles. All design tokens live in `assets/css/system.css` as CSS custom properties.

- **Typography**: Chillax (display) + Satoshi (body) + JetBrains Mono (code/labels)
- **Palette**: Charcoal base `#08090b`, gold accent (`--gold: #c9a84c`), mono accent treatments (`--accent-soft`, `--accent-dim-*`)
- **Glass**: `backdrop-filter: blur(14px)`, border-rgba(255,255,255,0.08), inset 1px highlight
- **Radius**: 8 / 12 / 16 / 24px scale
- **Easing**: `cubic-bezier(0.16, 1, 0.3, 1)`
- **Shadow**: tinted to bg hue (never pure black)

## Docs

- [`DEPLOY.md`](./DEPLOY.md) — deploy flow, emergency rollback, CI
- [`docs/BACKUP_RESTORE.md`](./docs/BACKUP_RESTORE.md) — pg_dump + quarterly restore drill runbook
- [`docs/SEO.md`](./docs/SEO.md) — Schema.org setup, Search Console submission, Lighthouse thresholds
- [`e2e/README.md`](./e2e/README.md) — Playwright + visual regression

## License

Proprietary. Beyond Concierge Events Co. LLC.
