import { test, expect } from '@playwright/test';

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('bonakala-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('radiologist opens the reading worklist and a study with AI candidates', async ({ page }) => {
  await signIn(page, 'rgt@demo.bonakala');
  await page.waitForURL('**/read');
  await expect(page.getByRole('heading', { name: 'Reading worklist' })).toBeVisible();
  await expect(page.getByText('Unreported')).toBeVisible();
  // Open the first study in the queue
  await page.locator('.queue .row').first().click();
  await page.waitForURL('**/read/study/**');
  await expect(page.getByRole('heading', { name: 'Report' })).toBeVisible();
  await expect(page.getByText('Signing is the only route that publishes report text', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign report' })).toBeVisible();
});

test('technologist sees the room worklist and a study workspace with the protocol card', async ({ page }) => {
  await signIn(page, 'rad@demo.bonakala');
  await page.waitForURL('**/tech');
  await expect(page.getByRole('heading', { name: 'Room worklist' })).toBeVisible();
  await page.locator('.queue .row').first().click();
  await page.waitForURL('**/tech/study/**');
  await expect(page.getByText('Protocol card')).toBeVisible();
  await expect(page.getByText('Identity check')).toBeVisible();
});

test('AI operations sees the model registry with output classes', async ({ page }) => {
  await signIn(page, 'aio@demo.bonakala');
  await page.waitForURL('**/bci');
  await expect(page.getByRole('heading', { name: 'Model registry' })).toBeVisible();
  await expect(page.getByText('BCI-CXR-FINDINGS').first()).toBeVisible();
  await page.goto('/bci/monitoring');
  await expect(page.getByRole('heading', { name: 'Monitoring' })).toBeVisible();
  await expect(page.getByText('AI slips · class 1 and 2')).toBeVisible();
});

test('nurse console lists contrast cases', async ({ page }) => {
  await signIn(page, 'nur@demo.bonakala');
  await page.waitForURL('**/nurse');
  await expect(page.getByRole('heading', { name: 'Patients today' })).toBeVisible();
});
