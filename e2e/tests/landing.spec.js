const { test, expect } = require('@playwright/test');

test.describe('Landing Page (index.html)', () => {
  let jsErrors = [];

  test.beforeEach(async ({ page }) => {
    jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));
    await page.goto('/index.html');
    await page.waitForLoadState('networkidle');
  });

  test('page loads without JavaScript errors @smoke', async ({ page }) => {
    const criticalErrors = jsErrors.filter(e =>
      !e.includes('favicon') && !e.includes('net::ERR_')
    );
    expect(criticalErrors, `JS errors: ${criticalErrors.join(', ')}`).toHaveLength(0);
  });

  test('navigation renders', async ({ page }) => {
    // The nav is injected into #nav-root as a fixed-position <nav class="nav">
    // Check that the nav element exists and contains the brand
    const nav = page.locator('nav.nav');
    await expect(nav).toBeAttached();

    const brand = page.locator('.nav-brand');
    await expect(brand).toBeAttached();

    // Verify nav content (ROSTR+ brand text)
    const brandText = await brand.textContent();
    expect(brandText).toContain('ROSTR');
  });

  test('"Start Booking" button links to auth.html', async ({ page }) => {
    const startBookingBtn = page.locator('a.btn-primary', { hasText: 'Start Booking' });
    await expect(startBookingBtn).toBeVisible();
    const href = await startBookingBtn.getAttribute('href');
    expect(href).toContain('auth.html');
  });

  test('"Browse Artists" button links to directory.html', async ({ page }) => {
    const browseBtn = page.locator('a', { hasText: 'Browse Artists' });
    await expect(browseBtn).toBeVisible();
    const href = await browseBtn.getAttribute('href');
    expect(href).toContain('directory.html');
  });

  test('all 6 feature icons render as SVGs', async ({ page }) => {
    // Wait for icons to be injected by JS
    for (let i = 1; i <= 6; i++) {
      const iconEl = page.locator(`#feat-icon-${i}`);
      await expect(iconEl).toBeAttached();
      // Icons may render as <svg> or <img> depending on UI.icon implementation
      const svgOrImg = iconEl.locator('svg, img');
      const count = await svgOrImg.count();
      expect(count, `Feature icon ${i} should have an svg or img`).toBeGreaterThan(0);
    }
  });

  test('features section has 6 feature cards', async ({ page }) => {
    const featureCards = page.locator('.feature-card');
    await expect(featureCards).toHaveCount(6);
  });
});
