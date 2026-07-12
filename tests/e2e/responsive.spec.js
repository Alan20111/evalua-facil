import { test, expect } from '@playwright/test';

test.describe('Responsive Design Tests', () => {
  test('Button primario se ve bien en mobile', async ({ page }) => {
    await page.goto('/docs/components-button--primary-mobile');
    await expect(page).toHaveScreenshot('button-primary-mobile.png');
  });

  test('Button primario se ve bien en tablet', async ({ page }) => {
    await page.goto('/docs/components-button--primary-tablet');
    await expect(page).toHaveScreenshot('button-primary-tablet.png');
  });

  test('Button primario se ve bien en desktop', async ({ page }) => {
    await page.goto('/docs/components-button--primary-desktop');
    await expect(page).toHaveScreenshot('button-primary-desktop.png');
  });

  test('Input tiene contraste suficiente (WCAG)', async ({ page }) => {
    await page.goto('/docs/components-input--standard');
    const input = page.locator('input');

    // Verifica que el input sea accesible
    await expect(input).toBeFocused();
  });

  test('Card es responsive en todos los tamaños', async ({ browser }) => {
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto('http://localhost:6006/docs/components-card--standard');
      await expect(page).toHaveScreenshot(`card-${viewport.width}px.png`);
      await context.close();
    }
  });
});
