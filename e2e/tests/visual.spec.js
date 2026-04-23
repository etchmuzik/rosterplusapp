// Visual regression suite. Catches real layout breakage that Lighthouse
// can't see — a hero card that shifted, a button that ended up invisible,
// overflow that appeared after a CSS change.
//
// How this works:
//   1. On first run (or when baseline is missing), Playwright writes a
//      reference PNG under tests/visual.spec.js-snapshots/.
//   2. On every subsequent run, it pixel-diffs the fresh render against
//      the reference. maxDiffPixelRatio in playwright.config.js allows
//      1% pixel drift before we fail.
//
// Updating baselines intentionally (e.g. after a real design change):
//   npx playwright test --update-snapshots --config=e2e/playwright.config.js visual
//
// Viewports covered:
//   - Desktop (1280×800)  — the default from playwright.config
//   - Mobile  (375×812)   — overridden per-test where we care
//
// What's intentionally NOT in the baseline:
//   - Dynamic live-data sections (artist count, marquee, featured card).
//     We mask those with page.locator(...).mask() so they don't flap when
//     the roster changes.
//   - Animations and transitions (disabled via expect.toHaveScreenshot's
//     animations:'disabled' in config).
//   - Auth-gated pages — they redirect or hang on /auth.html which isn't
//     stable without a logged-in fixture. Public pages only for now.

const { test, expect } = require('@playwright/test');

/**
 * Pages we screenshot. Each one needs to be fully deterministic — no
 * randomised hero cards, no "X minutes ago" live timestamps. If a page
 * can't be made deterministic we skip it here and cover it with a
 * functional spec instead.
 */
const PUBLIC_PAGES = [
  { path: '/',                  name: 'homepage' },
  { path: '/directory.html',    name: 'directory' },
  { path: '/auth.html',         name: 'auth' },
  { path: '/privacy.html',      name: 'privacy' },
  { path: '/terms.html',        name: 'terms' },
  { path: '/status.html',       name: 'status' },
  { path: '/404.html',          name: 'not-found' },
  { path: '/claim-profile.html', name: 'claim-profile' },
];

/**
 * Selectors that contain live or randomised data. We mask these so the
 * snapshot focuses on layout, not content flicker.
 *
 * Each entry is a CSS selector; Playwright paints it solid pink in the
 * screenshot, which means content changes inside never trigger a diff.
 */
const MASK_SELECTORS = [
  // Landing: live artist count in the eyebrow
  '#hero-artist-count',
  '#stat-artists',
  '#stat-bookings',
  // Landing: featured artist card is picked randomly from verified set
  '#lp-featured',
  // Landing: rolling marquee of names + the feature gallery tiles
  '#lp-marquee-inner',
  '#lp-feature-gallery',
  // Directory: populated from live DB, name order changes
  '#dir-grid',
  '.artist-card',
  // Status page: live "ran Nmin ago" timestamps
  '[data-cron-timestamp]',
  '#status-summary',
  '#cron-grid',
  // Anything with "ago" formatting in our UI
  '[data-relative-time]',
];

test.describe('Visual regression — desktop (1280×800)', () => {
  for (const page of PUBLIC_PAGES) {
    test(`${page.name} desktop @visual`, async ({ page: pw }) => {
      await pw.goto(page.path);
      await pw.waitForLoadState('networkidle');
      // Give async data fetches + icon hydration one extra tick to settle.
      // Without this, some pages snapshot mid-hydration and flap.
      await pw.waitForTimeout(300);

      const masks = MASK_SELECTORS.map(sel => pw.locator(sel));

      await expect(pw).toHaveScreenshot(`${page.name}-desktop.png`, {
        fullPage: true,
        mask: masks,
        // Mask colour doesn't matter for diffing — pink is just
        // visually obvious when a human eyeballs a failure diff.
        maskColor: '#ff00ff',
      });
    });
  }
});

test.describe('Visual regression — mobile (375×812)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  // Narrower set: only the pages where a mobile-specific layout matters.
  const MOBILE_PAGES = [
    { path: '/',                  name: 'homepage' },
    { path: '/auth.html',         name: 'auth' },
    { path: '/claim-profile.html', name: 'claim-profile' },
    { path: '/404.html',          name: 'not-found' },
  ];

  for (const page of MOBILE_PAGES) {
    test(`${page.name} mobile @visual`, async ({ page: pw }) => {
      await pw.goto(page.path);
      await pw.waitForLoadState('networkidle');
      await pw.waitForTimeout(300);

      const masks = MASK_SELECTORS.map(sel => pw.locator(sel));

      await expect(pw).toHaveScreenshot(`${page.name}-mobile.png`, {
        fullPage: true,
        mask: masks,
        maskColor: '#ff00ff',
      });
    });
  }
});
