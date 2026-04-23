// Smoke tests for the custom 404 page. Checks branding, breadcrumb logic,
// and the suggestion grid. The error-logger RPC call is fire-and-forget
// so we don't assert on network traffic.

const { test, expect } = require('@playwright/test');

test.describe('404 page (not-found)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a path that doesn't exist — Netlify/Hostinger fall through
    // to 404.html. In local-dev we visit directly.
    await page.goto('/404.html');
    await page.waitForLoadState('networkidle');
  });

  test('page renders "This stage is empty" headline', async ({ page }) => {
    await expect(page.locator('h1')).toContainText(/stage is empty/i);
  });

  test('Error 404 eyebrow is shown', async ({ page }) => {
    await expect(page.getByText(/Error 404/i)).toBeVisible();
  });

  test('primary "Go home" CTA points to /', async ({ page }) => {
    const goHome = page.locator('a.btn-primary', { hasText: /Go home/i });
    await expect(goHome).toBeVisible();
    const href = await goHome.getAttribute('href');
    expect(href).toBe('/');
  });

  test('suggestion grid has 4 links (dashboard, bookings, messages, settings)', async ({ page }) => {
    const suggestions = page.locator('.eyebrow:has-text("Try instead") + ul a');
    await expect(suggestions).toHaveCount(4);
  });

  test('attempted-path breadcrumb stays hidden when served as /404.html', async ({ page }) => {
    // When the user lands directly on /404.html we shouldn't show a
    // breadcrumb — there is no "attempted" URL to explain.
    const breadcrumb = page.locator('#attempted-path');
    await expect(breadcrumb).toBeHidden();
  });
});
