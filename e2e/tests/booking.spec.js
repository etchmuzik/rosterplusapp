const { test, expect } = require('@playwright/test');

// Helper to inject a demo user into localStorage so protected pages don't redirect
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

test.describe('Booking Page (booking.html)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page);
    await page.goto('/booking.html');
    await page.waitForLoadState('networkidle');
    // Wait for artist grid to populate (section 2 is in DOM but not visible)
    await page.waitForFunction(() => {
      const grid = document.getElementById('artistGrid');
      return grid && grid.querySelectorAll('.artist-card').length > 0;
    }, { timeout: 10000 });
  });

  test('artist grid shows 8 artists in DOM', async ({ page }) => {
    const count = await page.evaluate(() =>
      document.getElementById('artistGrid').querySelectorAll('.artist-card').length
    );
    expect(count).toBe(8);
  });

  test('clicking an artist card gives it the "selected" class', async ({ page }) => {
    // Artist cards are in section 2 — use JS click since section may not be visible
    await page.evaluate(() => {
      const firstCard = document.querySelector('#artistGrid .artist-card');
      firstCard.click();
    });

    const isSelected = await page.evaluate(() => {
      const firstCard = document.querySelector('#artistGrid .artist-card');
      return firstCard.classList.contains('selected');
    });
    expect(isSelected).toBeTruthy();
  });

  test('clicking second artist deselects first', async ({ page }) => {
    await page.evaluate(() => {
      const cards = document.querySelectorAll('#artistGrid .artist-card');
      cards[0].click();
      cards[1].click();
    });

    const states = await page.evaluate(() => {
      const cards = document.querySelectorAll('#artistGrid .artist-card');
      return {
        firstSelected: cards[0].classList.contains('selected'),
        secondSelected: cards[1].classList.contains('selected')
      };
    });
    expect(states.firstSelected).toBeFalsy();
    expect(states.secondSelected).toBeTruthy();
  });

  test('step 1 is active on page load', async ({ page }) => {
    const step1 = page.locator('.step[data-step="1"]');
    await expect(step1).toHaveClass(/active/);
  });

  test('venue dropdown is populated', async ({ page }) => {
    const venueSelect = page.locator('#eventVenue');
    await expect(venueSelect).toBeVisible();

    const options = venueSelect.locator('option');
    const count = await options.count();
    // Should have placeholder + venues from MockData
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('venue dropdown contains "WHITE Dubai"', async ({ page }) => {
    const venueSelect = page.locator('#eventVenue');
    const options = venueSelect.locator('option');
    const optionTexts = await options.allTextContents();
    const hasWhiteDubai = optionTexts.some(t => t.includes('WHITE Dubai'));
    expect(hasWhiteDubai, 'Venue dropdown should contain WHITE Dubai').toBeTruthy();
  });

  test('Next button exists on step 1', async ({ page }) => {
    const nextBtn = page.locator('#nextBtn');
    await expect(nextBtn).toBeVisible();
  });

  test('step navigation 1 -> 2 -> 3 works with filled form', async ({ page }) => {
    // Fill step 1 form
    await page.locator('#eventName').fill('Test Event');
    await page.locator('#eventDate').fill('2026-12-31');
    await page.locator('#eventTime').fill('21:00');
    await page.locator('#eventVenue').selectOption({ index: 1 });
    await page.locator('#eventType').selectOption('nightclub');
    await page.locator('#expectedAttendance').fill('500');

    // Click Next -> step 2
    await page.locator('#nextBtn').click();

    const step2 = page.locator('.step[data-step="2"]');
    await expect(step2).toHaveClass(/active/);

    // Select an artist via JS (cards are visible in step 2 section now)
    await page.evaluate(() => {
      document.querySelector('#artistGrid .artist-card').click();
    });

    // Click Next -> step 3
    await page.locator('#nextBtn').click();

    const step3 = page.locator('.step[data-step="3"]');
    await expect(step3).toHaveClass(/active/);
  });

  test('review step shows selected artist name after full navigation', async ({ page }) => {
    // Fill step 1
    await page.locator('#eventName').fill('Rooftop Party');
    await page.locator('#eventDate').fill('2026-12-31');
    await page.locator('#eventTime').fill('22:00');
    await page.locator('#eventVenue').selectOption({ index: 1 });
    await page.locator('#eventType').selectOption('nightclub');
    await page.locator('#expectedAttendance').fill('300');
    await page.locator('#nextBtn').click();

    // Step 2 — select DJ NOVAK via JS evaluate
    await page.evaluate(() => {
      const cards = document.querySelectorAll('#artistGrid .artist-card');
      // Find DJ NOVAK card
      const novakCard = Array.from(cards).find(c =>
        c.querySelector('.artist-name')?.textContent?.includes('DJ NOVAK')
      );
      if (novakCard) novakCard.click();
    });

    await page.locator('#nextBtn').click();

    // Step 3 review — check artist name shown
    const reviewArtistName = page.locator('#reviewArtistName');
    await expect(reviewArtistName).toBeVisible();
    const artistText = await reviewArtistName.textContent();
    expect(artistText).toContain('DJ NOVAK');
  });

  test('review step shows event name', async ({ page }) => {
    await page.locator('#eventName').fill('Sunset Bash');
    await page.locator('#eventDate').fill('2026-11-15');
    await page.locator('#eventTime').fill('20:00');
    await page.locator('#eventVenue').selectOption({ index: 1 });
    await page.locator('#eventType').selectOption('corporate');
    await page.locator('#expectedAttendance').fill('200');
    await page.locator('#nextBtn').click();

    await page.evaluate(() => {
      document.querySelector('#artistGrid .artist-card').click();
    });
    await page.locator('#nextBtn').click();

    const reviewEventName = page.locator('#reviewEventName');
    await expect(reviewEventName).toBeVisible();
    const eventText = await reviewEventName.textContent();
    expect(eventText).toContain('Sunset Bash');
  });

  test('Back button appears on step 2', async ({ page }) => {
    await page.locator('#eventName').fill('Test');
    await page.locator('#eventDate').fill('2026-12-31');
    await page.locator('#eventTime').fill('21:00');
    await page.locator('#eventVenue').selectOption({ index: 1 });
    await page.locator('#eventType').selectOption('nightclub');
    await page.locator('#expectedAttendance').fill('100');
    await page.locator('#nextBtn').click();

    const backBtn = page.locator('#backBtn');
    await expect(backBtn).toBeVisible();
  });
});
