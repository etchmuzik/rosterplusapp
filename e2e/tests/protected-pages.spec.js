const { test, expect } = require('@playwright/test');

// Helper to inject demo user so auth guard passes
async function loginAsDemo(page) {
  await page.addInitScript(() => {
    const demoUser = {
      id: 'demo-test-user',
      email: 'test@rostr.com',
      display_name: 'Test Promoter',
      role: 'promoter'
    };
    localStorage.setItem('rostr_demo_user', JSON.stringify(demoUser));
  });
}

const PROTECTED_PAGES = [
  {
    name: 'Dashboard',
    url: '/dashboard.html',
    // dashboard uses <nav-root> custom element
    navSelector: 'nav-root, #nav-root',
    contentSelector: '.main-content',
  },
  {
    name: 'Bookings',
    url: '/bookings.html',
    navSelector: '#nav-root',
    contentSelector: '.page-shell',
  },
  {
    name: 'Messages',
    url: '/messages.html',
    navSelector: '#nav-root',
    contentSelector: '.page-shell',
  },
  {
    name: 'Contracts',
    url: '/contracts.html',
    navSelector: '#nav-root',
    contentSelector: '.contracts-container',
  },
  {
    name: 'Payments',
    url: '/payments.html',
    navSelector: 'nav-root, #nav-root',
    contentSelector: '.main-content',
  },
];

for (const pg of PROTECTED_PAGES) {
  test.describe(`${pg.name} page (${pg.url})`, () => {
    let jsErrors = [];

    test.beforeEach(async ({ page }) => {
      jsErrors = [];
      page.on('pageerror', (err) => jsErrors.push(err.message));
      await loginAsDemo(page);
      await page.goto(pg.url);
      await page.waitForLoadState('networkidle');
    });

    test(`${pg.name}: page loads and does not redirect to auth @smoke`, async ({ page }) => {
      // Verify we are NOT on the auth page
      const currentUrl = page.url();
      expect(currentUrl).not.toContain('auth.html');

      const body = await page.locator('body').innerHTML();
      expect(body.length, `${pg.name} body should have content`).toBeGreaterThan(100);
    });

    test(`${pg.name}: main content container exists`, async ({ page }) => {
      const container = page.locator(pg.contentSelector).first();
      await expect(container, `${pg.name} should have ${pg.contentSelector}`).toBeAttached();
    });

    test(`${pg.name}: no critical JavaScript errors`, async ({ page }) => {
      const criticalErrors = jsErrors.filter(e =>
        !e.includes('favicon') &&
        !e.includes('net::ERR_') &&
        !e.includes('NetworkError') &&
        !e.includes('supabase') &&
        !e.includes('Failed to fetch') &&
        !e.includes('ERR_NAME_NOT_RESOLVED')
      );
      expect(
        criticalErrors,
        `${pg.name} JS errors: ${criticalErrors.join(' | ')}`
      ).toHaveLength(0);
    });

    test(`${pg.name}: nav renders with ROSTR+ brand`, async ({ page }) => {
      // Nav injects a <nav class="nav"> into the nav-root container
      const nav = page.locator('nav.nav');
      await expect(nav).toBeAttached();

      const brand = page.locator('.nav-brand');
      await expect(brand).toBeAttached();
      const brandText = await brand.textContent();
      expect(brandText).toContain('ROSTR');
    });
  });
}
