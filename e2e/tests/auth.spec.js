const { test, expect } = require('@playwright/test');

test.describe('Auth Page (auth.html)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');
  });

  test('page loads without crashing @smoke', async ({ page }) => {
    await expect(page).toHaveTitle(/Sign In|ROSTR/i);
    const tabs = page.locator('.auth-tabs');
    await expect(tabs).toBeVisible();
  });

  test('Sign In tab is active by default @smoke', async ({ page }) => {
    const signInTab = page.locator('.auth-tab', { hasText: 'Sign In' });
    await expect(signInTab).toHaveClass(/active/);
  });

  test('Create Account tab exists', async ({ page }) => {
    const createTab = page.locator('.auth-tab', { hasText: 'Create Account' });
    await expect(createTab).toBeVisible();
  });

  test('switching to Create Account tab shows signup form', async ({ page }) => {
    const createTab = page.locator('.auth-tab', { hasText: 'Create Account' });
    await createTab.click();

    const signupForm = page.locator('#signup-form');
    await expect(signupForm).toBeVisible();

    const loginForm = page.locator('#login-form');
    await expect(loginForm).toBeHidden();
  });

  test('switching back to Sign In tab shows login form', async ({ page }) => {
    await page.locator('.auth-tab', { hasText: 'Create Account' }).click();
    await page.locator('.auth-tab', { hasText: 'Sign In' }).click();

    const loginForm = page.locator('#login-form');
    await expect(loginForm).toBeVisible();
  });

  test('Forgot password link switches to reset form', async ({ page }) => {
    const forgotLink = page.locator('a', { hasText: 'Forgot password?' });
    await expect(forgotLink).toBeVisible();
    await forgotLink.click();

    const resetForm = page.locator('#reset-form');
    await expect(resetForm).toBeVisible();

    const loginForm = page.locator('#login-form');
    await expect(loginForm).toBeHidden();
  });

  test('role selector (Promoter/Artist) exists on signup tab', async ({ page }) => {
    await page.locator('.auth-tab', { hasText: 'Create Account' }).click();

    // Use onclick attribute selectors to uniquely target each role option
    const promoterOption = page.locator('[onclick="selectRole(\'promoter\', this)"]');
    const artistOption = page.locator('[onclick="selectRole(\'artist\', this)"]');

    await expect(promoterOption).toBeVisible();
    await expect(artistOption).toBeVisible();
  });

  test('Promoter role is selected by default on signup', async ({ page }) => {
    await page.locator('.auth-tab', { hasText: 'Create Account' }).click();

    const promoterOption = page.locator('[onclick="selectRole(\'promoter\', this)"]');
    await expect(promoterOption).toHaveClass(/selected/);
  });

  test('clicking Artist role selects it', async ({ page }) => {
    await page.locator('.auth-tab', { hasText: 'Create Account' }).click();

    const artistOption = page.locator('[onclick="selectRole(\'artist\', this)"]');
    await artistOption.click();

    await expect(artistOption).toHaveClass(/selected/);

    const promoterOption = page.locator('[onclick="selectRole(\'promoter\', this)"]');
    await expect(promoterOption).not.toHaveClass(/selected/);

    const hiddenRole = page.locator('#signup-role');
    const roleValue = await hiddenRole.inputValue();
    expect(roleValue).toBe('artist');
  });

  test('empty email triggers browser validation on Sign In', async ({ page }) => {
    const emailInput = page.locator('#login-email');
    await expect(emailInput).toBeVisible();

    const required = await emailInput.getAttribute('required');
    expect(required).not.toBeNull();

    const inputType = await emailInput.getAttribute('type');
    expect(inputType).toBe('email');
  });
});
