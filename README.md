# ROSTER+ GCC

**Artist Booking Platform for the Gulf**

Live at [rosterplus.io](https://rosterplus.io)

---

## What is ROSTER+

ROSTER+ is a nightlife artist booking platform built for the GCC region (Dubai, Riyadh, Abu Dhabi, Doha, Kuwait, Bahrain, Oman). It connects promoters with DJs, live acts, and performers — handling discovery, booking, contracts, payments, and messaging in one place.

## Tech Stack

- **Frontend:** Static HTML/CSS/JS (no framework, no build step)
- **Backend:** Supabase (Auth, PostgreSQL, Storage, Realtime, Edge Functions)
- **Hosting:** Hostinger (static site hosting)
- **Email:** Resend (transactional emails via Supabase Edge Function)
- **Design:** Dark glassmorphic with Satoshi font, taste-skill compliant
- **PWA:** Installable on iOS and Android via manifest + service worker

## Pages (15 total)

| Page | Role | Description |
|------|------|-------------|
| `index.html` | Public | Landing page with hero, features, how-it-works |
| `auth.html` | Public | Sign in / Create account (promoter or artist) |
| `dashboard.html` | Promoter | Stats, bookings, calendar, analytics |
| `artist-dashboard.html` | Artist | Incoming requests, earnings, calendar, accept/reject |
| `directory.html` | Both | Browse artists with search + filters |
| `booking.html` | Promoter | Create booking (select artist, event details, review) |
| `bookings.html` | Promoter | Manage all bookings with filters |
| `messages.html` | Both | Real-time messaging |
| `contracts.html` | Promoter | View/create/sign/download contracts |
| `payments.html` | Promoter | Payment tracking with live stats |
| `profile.html` | Public | Public artist profile view |
| `artist-profile-edit.html` | Artist | Edit profile (bio, rates, photos, socials) |
| `epk.html` | Both | Electronic Press Kit (public view + artist edit) |
| `settings.html` | Both | Account settings, password, notifications |
| `admin.html` | Admin | Admin panel (role-gated) |

## Architecture

```
rostr-platform/
  assets/
    css/system.css          # Design system (all CSS variables + components)
    js/app.js               # Core app (Auth, DB, UI, Storage, Realtime, Emails)
  icons/                    # PWA icons (192px, 512px, SVG)
  supabase/
    functions/send-email/   # Edge function for transactional emails
  manifest.json             # PWA manifest
  sw.js                     # Service worker
  .htaccess                 # Security headers + HTTPS redirect
  *.html                    # 15 page files
```

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User accounts (name, role, avatar, company, phone) |
| `artists` | Extended artist data (genre, rates, social links, EPK) |
| `bookings` | Booking records (promoter, artist, venue, date, fee, status) |
| `contracts` | Performance contracts (booking, title, signatures) |
| `payments` | Payment tracking (booking, amount, method, status) |
| `messages` | Real-time messaging between users |
| `venues` | Venue directory |

## Security

- XSS protection via `esc()` function on all user data in innerHTML
- CSP, HSTS, X-Frame-Options, X-XSS-Protection headers
- Open redirect protection on auth redirects
- Role escalation blocked (signup only allows promoter/artist)
- File upload validation (type + 10MB limit)
- Supabase RLS on all tables

## Design System

Built with the [taste-skill](https://github.com/Leonxlnx/taste-skill) design principles:

- **Font:** Satoshi (body + display) + JetBrains Mono (code/labels)
- **Base:** Charcoal `#0c0c10` (no pure black)
- **Accent:** Gold `#c9a84c` (single accent, saturation < 80%)
- **Glass:** `backdrop-filter: blur(20px)`, `border-white/10`, inner shadow refraction
- **Shadows:** Tinted to background hue (no pure black shadows)
- **Easing:** `cubic-bezier(0.16, 1, 0.3, 1)`
- **Radius:** 10px / 14px / 20px / 2.5rem (premium rounding)

## Setup

1. Clone this repo
2. Create a Supabase project and run `supabase-schema.sql`
3. Update `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `assets/js/app.js`
4. Deploy the `send-email` edge function with your Resend API key
5. Upload all files to your web host's `public_html`
6. Point your domain and enable SSL

## License

Proprietary. Beyond Concierge Events Co. LLC.
