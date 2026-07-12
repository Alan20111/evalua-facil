import { test, expect } from '@playwright/test';

// Storybook renderiza cada story de forma aislada en /iframe.html?id=<storyId>&viewMode=story
// storyId = "<title-kebab>--<export-kebab>", ej. Components/Button -> PrimaryMobile => components-button--primary-mobile
function storyUrl(id) {
  return `/iframe.html?id=${id}&viewMode=story`;
}

test.describe('Responsive Design Tests', () => {
  test('Button primario se ve bien en mobile', async ({ page }) => {
    await page.goto(storyUrl('components-button--primary-mobile'));
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible();
    await expect(page).toHaveScreenshot('button-primary-mobile.png');
  });

  test('Button primario se ve bien en tablet', async ({ page }) => {
    await page.goto(storyUrl('components-button--primary-tablet'));
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible();
    await expect(page).toHaveScreenshot('button-primary-tablet.png');
  });

  test('Button primario se ve bien en desktop', async ({ page }) => {
    await page.goto(storyUrl('components-button--primary-desktop'));
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible();
    await expect(page).toHaveScreenshot('button-primary-desktop.png');
  });

  test('Input puede recibir foco (teclado)', async ({ page }) => {
    await page.goto(storyUrl('components-input--standard'));
    const input = page.locator('input');
    await input.click();
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
      await page.goto(`http://localhost:6006${storyUrl('components-card--standard')}`);
      await expect(page.locator('body')).toBeVisible();
      await expect(page).toHaveScreenshot(`card-${viewport.width}px.png`);
      await context.close();
    }
  });
});
