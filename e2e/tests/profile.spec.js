const { test, expect } = require('@playwright/test');

test.describe('Profile Page (profile.html?id=a1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/profile.html?id=a1');
    await page.waitForLoadState('networkidle');
    // Wait for profile to render (JS populates #profile-root)
    await page.waitForFunction(() => {
      const root = document.getElementById('profile-root');
      return root && root.innerHTML.length > 100;
    }, { timeout: 8000 });
  });

  test('page loads without crashing', async ({ page }) => {
    const profileRoot = page.locator('#profile-root');
    await expect(profileRoot).toBeAttached();
    const content = await profileRoot.innerHTML();
    expect(content.length).toBeGreaterThan(100);
  });

  test('shows "DJ NOVAK" as the artist name', async ({ page }) => {
    const artistName = page.locator('.artist-name').first();
    await expect(artistName).toBeAttached();
    const text = await artistName.textContent();
    expect(text).toContain('DJ NOVAK');
  });

  test('Book This Artist button exists and links to booking.html with artist id', async ({ page }) => {
    const bookBtn = page.locator('.book-button');
    await expect(bookBtn).toBeAttached();

    const href = await bookBtn.getAttribute('href');
    expect(href).toContain('booking.html');
    expect(href).toContain('artist=a1');

    // Button text contains "Book"
    const btnText = await bookBtn.textContent();
    expect(btnText.toLowerCase()).toContain('book');
  });

  test('profile contains artist bio or info', async ({ page }) => {
    const bodyText = await page.locator('#profile-root').textContent();
    expect(bodyText.length).toBeGreaterThan(50);
    // Profile should contain DJ NOVAK content from MockData
    expect(bodyText).toContain('DJ NOVAK');
  });
});
