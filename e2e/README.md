# E2E + Visual Regression

Playwright suite. Two kinds of tests:

1. **Smoke tests** (`@smoke` tag) — functional assertions on key pages. Run on every CI push + PR.
2. **Visual regression** (`@visual` tag) — pixel-diff screenshots of public pages. Runs on every PR.

## Running locally

```bash
# Install Playwright + Chromium (one-time)
npm install
npx playwright install chromium

# Start the static server (separate terminal)
npm run serve

# Run everything
npm run test:e2e

# Just smoke
npm run test:smoke

# Just visual regression (requires baselines)
npm run test:visual
```

## Visual regression baselines

Screenshots are stored under `tests/visual.spec.js-snapshots/`. Each file has a platform suffix (e.g. `homepage-desktop-chromium-linux.png`) because font rendering + antialiasing differs between macOS and Linux.

### First-time baseline creation

**The source of truth for baselines is CI (Linux Chromium).** To seed them:

1. Trigger the `baseline-visual-snapshots` workflow on GitHub Actions via "Run workflow" button (manual dispatch).
2. It runs `playwright test --grep @visual --update-snapshots` and commits the generated PNGs back to main.
3. After that first run, every PR pixel-diffs against the committed baselines.

### When a real design change lands

If a PR intentionally changes the landing hero / navigation / any visual element and the visual regression fails, that's expected. To update the baselines:

```bash
npm run test:visual:update
git add e2e/tests/visual.spec.js-snapshots/
git commit -m "chore(visual): update snapshots for redesigned hero"
```

**Never update baselines without eyeballing the diff first** — the whole point is that a random CSS regression trips the suite. If you blindly accept new baselines, the suite becomes a rubber stamp.

### What's masked from snapshots

See `MASK_SELECTORS` in `tests/visual.spec.js`. We mask live-data areas (artist count, featured card, cron timestamps) so they don't flap when the roster or cron runs change. Static layout, typography, colours, borders — those DO get diffed.

## Tolerance

`playwright.config.js` sets:
- `maxDiffPixelRatio: 0.01` — up to 1% of pixels may differ before we fail
- `threshold: 0.2` — per-pixel colour distance before that pixel counts as "different"

This is loose enough to absorb font-hinting noise and tight enough to catch a shifted card or invisible button.
