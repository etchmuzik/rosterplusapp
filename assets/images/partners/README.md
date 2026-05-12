# Partner logos

Operator-managed PNGs for the homepage social-proof strip
(`index.html` → `.lp-social-proof-logos`). All files share one rule:

**White artwork on a transparent background.** No solid backgrounds,
no off-white tint — the strip sits on the dark page surface and the
CSS treats every logo with the same `opacity: 0.6 → 1.0 on hover`
treatment. A logo with a baked-in background defeats that.

## File slots

The homepage references these paths verbatim. Drop a file at the
exact slug below and the page picks it up — no code change needed.

| Slug | Brand | Status |
|---|---|---|
| `cavo.png` | CAVO | ✅ confirmed in chat 2026-05-12 |
| `armani-hotel-dubai.png` | Armani Hotel Dubai | ✅ confirmed in chat 2026-05-12 |
| `venture-lifestyle.png` | Venture Lifestyle | ✅ confirmed in chat 2026-05-12 |
| `space-sharm.png` | Space Sharm El Sheikh | ✅ confirmed in chat 2026-05-12 |
| `white-dubai.png` | WHITE Dubai | ⏳ chat-render came through unreadable (white-on-white) — drop the real PNG here |
| `partner-6.png` | TBD | ⏳ same as above |

When you drop a logo at a slug, edit `index.html` near `<!-- ═══ SOCIAL
PROOF ═══ -->` and update the brand name in the matching `<img alt="…">`
attribute if it differs from this README.

## Image specs

- **Format**: PNG with alpha channel.
- **Height** (intrinsic): ~80–120px. The CSS scales every logo to
  `height: 32px` (`max-width: 140px`) so retina-bright is enough; no
  need to ship 4× monsters.
- **Color**: pure white (`#ffffff`). Anti-aliased edges are fine.
  Don't ship grey-tinted PNGs — they'll look dirty against the rest
  of the row.
- **Padding inside the PNG**: trim tight. CSS spacing handles the
  gaps between logos.

## Why this folder is operator-managed

These are third-party trademarks. The repo doesn't claim rights to
them — we just display them as social proof when we have a
booking relationship that justifies it. If a partnership lapses,
delete the PNG and remove the matching `<img>` line from `index.html`.
