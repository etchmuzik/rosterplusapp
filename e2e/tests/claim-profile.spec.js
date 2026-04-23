// Smoke tests for the artist-claim flow. Verifies the page renders its
// step strip, welcome card, and search form correctly — doesn't test the
// actual RPC (that needs a seeded unclaimed artist + auth, better suited
// to a staged integration run).

const { test, expect } = require('@playwright/test');

test.describe('Claim Profile page (claim-profile.html)', () => {
  let jsErrors = [];

  test.beforeEach(async ({ page }) => {
    jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));
    await page.goto('/claim-profile.html');
    await page.waitForLoadState('networkidle');
  });

  test('page loads without JavaScript errors @smoke', async ({ page }) => {
    const criticalErrors = jsErrors.filter(e =>
      !e.includes('favicon') && !e.includes('net::ERR_')
    );
    expect(criticalErrors, `JS errors: ${criticalErrors.join(', ')}`).toHaveLength(0);
  });

  test('step strip shows 3 pips with correct labels', async ({ page }) => {
    const pips = page.locator('.step-pip');
    await expect(pips).toHaveCount(3);
    // Second pip is active on this page (mid-flow)
    const active = page.locator('.step-pip.active');
    await expect(active).toHaveCount(1);
    await expect(active).toContainText('Profile');
  });

  test('welcome card with value props is visible', async ({ page }) => {
    const welcome = page.locator('.claim-card').first();
    await expect(welcome).toContainText('Welcome, artist');
    const bullets = welcome.locator('.value-list li');
    await expect(bullets).toHaveCount(3);
  });

  test('search input is autofocused and has helpful placeholder', async ({ page }) => {
    const input = page.locator('#search-input');
    await expect(input).toBeVisible();
    const placeholder = await input.getAttribute('placeholder');
    expect(placeholder).toMatch(/ENAI|Goomgum|Etch/);
  });

  test('create-new-profile fallback link exists', async ({ page }) => {
    const createLink = page.locator('a[href*="artist-profile-edit.html?setup=1"]').last();
    await expect(createLink).toBeVisible();
    await expect(createLink).toContainText(/Create new profile/i);
  });

  test('divider separator between search and create-new is visible', async ({ page }) => {
    const divider = page.locator('.divider');
    await expect(divider).toBeVisible();
    await expect(divider).toContainText(/not on the list/i);
  });
});
