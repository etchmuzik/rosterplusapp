const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 15000,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
  use: {
    baseURL: 'http://localhost:8090',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
    // Suppress console errors from being fatal
    ignoreHTTPSErrors: true,
  },
  // Snapshot / visual-regression config.
  //
  // maxDiffPixelRatio: 0.01 allows up to 1% of pixels to differ before we
  // fail. Catches real visual regressions (a broken layout, missing hero
  // card) but tolerates font-rendering nudges and antialiasing noise that
  // differs between macOS dev boxes and Linux CI runners.
  //
  // threshold: 0.2 is the per-pixel YIQ colour-distance cutoff before a
  // pixel counts as "different" (Playwright default). Looser than default
  // (0.3) would miss subtle regressions; tighter (0.1) would fail on
  // antialiasing. 0.2 is the sweet spot.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
      animations: 'disabled',
    },
  },
  // Pin the snapshot directory so baseline PNGs end up next to each spec
  // (e.g. tests/visual.spec.js-snapshots/homepage-desktop-chromium-linux.png).
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
  ],
});
