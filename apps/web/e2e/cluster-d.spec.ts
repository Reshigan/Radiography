import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page, email: string, home: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('bonakala-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`**${home}`);
}

test.describe('cluster D consoles', () => {
  test('practice control tower shows tiles, the heatmap and Hand alerts', async ({ page }) => {
    await signIn(page, 'prm@demo.bonakala', '/practice');
    await expect(page.getByRole('heading', { name: /Today at|Control tower/ })).toBeVisible();
    await expect(page.getByText('Utilisation by room and hour')).toBeVisible();
    await expect(page.getByText('Alerts')).toBeVisible();
    await expect(page.getByText('Hands awaiting my approval')).toBeVisible();
    // A tile opens its metric definition.
    await page.getByText('Waiting-room time', { exact: false }).first().click();
    await expect(page.getByText('Formula')).toBeVisible();
  });

  test('practice staff page lists the roster and open gaps', async ({ page }) => {
    await signIn(page, 'prm@demo.bonakala', '/practice');
    await page.goto('/practice/staff');
    await expect(page.getByRole('heading', { name: 'Staff' })).toBeVisible();
    await page.getByRole('tab', { name: /Gaps/ }).click();
    await expect(page.getByText('Open gaps and Roster Hand proposals')).toBeVisible();
  });

  test('compliance board shows the register, the calendar strip and reportable results', async ({ page }) => {
    await signIn(page, 'cmp@demo.bonakala', '/compliance');
    await expect(page.getByRole('heading', { name: 'Regulatory status board' })).toBeVisible();
    await expect(page.getByText('Regulatory calendar · next 90 days')).toBeVisible();
    await expect(page.getByText('Reportable-results register')).toBeVisible();
    await expect(page.getByText(/The Platform never notifies a regulator/)).toBeVisible();
    await page.goto('/compliance/register');
    await expect(page.getByRole('heading', { name: /Statutory and regulatory register/ })).toBeVisible();
  });

  test('group console shows tiles, the benchmark and the Insight Hand', async ({ page }) => {
    await signIn(page, 'exe@demo.bonakala', '/group');
    await expect(page.getByRole('heading', { name: 'Group control tower' })).toBeVisible();
    await expect(page.getByText('Ask the semantic layer')).toBeVisible();
    await expect(page.getByText('Acquisition pipeline')).toBeVisible();
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(page.getByText('Definition', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('engineering console shows the gateway fleet with the offline site', async ({ page }) => {
    await signIn(page, 'bio@demo.bonakala', '/engineering');
    await expect(page.getByRole('heading', { name: 'Fleet and engineering' })).toBeVisible();
    await expect(page.getByText('Edge Gateway fleet')).toBeVisible();
    await expect(page.getByText(/offline/i).first()).toBeVisible();
  });

  test('admin lists the Hands with editable leashes', async ({ page }) => {
    await signIn(page, 'sup@demo.bonakala', '/support');
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Hands and leashes' })).toBeVisible();
    await expect(page.getByText('Roster Hand')).toBeVisible();
    await expect(page.getByText('Compliance Hand')).toBeVisible();
    await page.getByText('Roster Hand').first().click();
    await expect(page.getByText('maxAgencyCentsPerShift')).toBeVisible();
    await expect(page.getByText('Change reason (required)')).toBeVisible();
  });
});
