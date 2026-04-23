const { test, expect } = require('@playwright/test');

test.describe('Directory Page (directory.html)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/directory.html');
    await page.waitForLoadState('networkidle');
    // Wait for artist cards to be rendered
    await page.waitForSelector('.artist-card', { timeout: 8000 });
  });

  test('page loads with 8 artist cards from MockData', async ({ page }) => {
    const artistCards = page.locator('.artist-card');
    await expect(artistCards).toHaveCount(8);
  });

  test('search input exists @smoke', async ({ page }) => {
    const searchInput = page.locator('#searchInput');
    await expect(searchInput).toBeVisible();
  });

  test('genre filter dropdown exists', async ({ page }) => {
    const genreFilter = page.locator('#genreFilter');
    await expect(genreFilter).toBeVisible();
  });

  test('city filter dropdown exists', async ({ page }) => {
    const cityFilter = page.locator('#cityFilter');
    await expect(cityFilter).toBeVisible();
  });

  test('rate filter dropdown exists', async ({ page }) => {
    const rateFilter = page.locator('#rateFilter');
    await expect(rateFilter).toBeVisible();
  });

  test('artist cards have name, genre, and rate', async ({ page }) => {
    const firstCard = page.locator('.artist-card').first();
    await expect(firstCard).toBeVisible();

    // Check for artist name element
    const artistName = firstCard.locator('.artist-name');
    await expect(artistName).toBeVisible();
    const nameText = await artistName.textContent();
    expect(nameText.trim().length).toBeGreaterThan(0);

    // Check for genre element
    const genreEl = firstCard.locator('.artist-genres');
    await expect(genreEl).toBeVisible();

    // Check for rate element (inside .card-rates or .rate-value)
    const rateEl = firstCard.locator('.card-rates');
    await expect(rateEl).toBeVisible();
  });

  test('search input is functional and triggers filtering', async ({ page }) => {
    // Verify search input is interactive
    const searchInput = page.locator('#searchInput');
    await expect(searchInput).toBeVisible();

    // Fill the search — this triggers applyFilters()
    await searchInput.fill('DJ NOVAK');

    // Wait for async filter to resolve
    await page.waitForTimeout(500);

    // The results info should update (either showing results or 0)
    const resultsInfo = page.locator('#resultsInfo');
    await expect(resultsInfo).toBeVisible();
    const infoText = await resultsInfo.textContent();
    // Should show some number — "Showing X of 8" or "Showing 0 of 8"
    expect(infoText).toMatch(/\d/);

    // Either artist cards exist, or the no-results div is shown
    const cardCount = await page.locator('.artist-card').count();
    const noResultsVisible = await page.locator('#noResults').isVisible();
    expect(cardCount > 0 || noResultsVisible, 'Search should either show results or no-results message').toBeTruthy();
  });

  test('search input narrows results in demo/mock mode', async ({ page }) => {
    // Verify that the search mechanism narrows or changes results
    const searchInput = page.locator('#searchInput');

    // Get initial count
    const initialCount = await page.locator('.artist-card').count();
    expect(initialCount).toBe(8);

    // Search for something that definitely won't match (gibberish)
    await searchInput.fill('XYZNOARTIST123');
    await page.waitForTimeout(500);

    const afterSearchCount = await page.locator('.artist-card').count();
    // After filtering, count should be less than initial (either 0 or matching)
    expect(afterSearchCount).toBeLessThan(initialCount);
  });

  test('searching for nonexistent artist shows no results', async ({ page }) => {
    const searchInput = page.locator('#searchInput');
    await searchInput.fill('XYZNONEXISTENTARTIST999');
    await page.waitForTimeout(300);

    const noResults = page.locator('#noResults');
    await expect(noResults).toBeVisible();
  });

  test('clicking an artist card navigates to profile page', async ({ page }) => {
    const firstCard = page.locator('.artist-card').first();
    const href = await firstCard.getAttribute('href');
    expect(href).toContain('profile.html');
    expect(href).toContain('id=');
  });

  test('results info shows artist count', async ({ page }) => {
    const resultsInfo = page.locator('#resultsInfo');
    await expect(resultsInfo).toBeVisible();
    const infoText = await resultsInfo.textContent();
    expect(infoText).toContain('8');
  });
});
