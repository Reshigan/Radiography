import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('bonakala-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(800);
}

test('front desk shows today with a registration panel and a Collect card', async ({ page }) => {
  await signIn(page, 'fdk@demo.bonakala');
  await page.waitForURL('**/desk');
  await expect(page.getByRole('heading', { name: /Today at/ })).toBeVisible();
  await expect(page.getByText('Booked today')).toBeVisible();
  await expect(page.getByText('Expected desk collections')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Arrivals' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Collect' })).toBeVisible();
});

test('the public queue screen never shows a patient name', async ({ page }) => {
  await signIn(page, 'fdk@demo.bonakala');
  await page.goto('/desk/queue');
  await expect(page.getByRole('heading', { name: 'Waiting-room screen' })).toBeVisible();
  await expect(page.getByText('Ticket numbers only. No names appear on this screen.')).toBeVisible();
});

test('central booking shows the omnichannel inbox and the calendar grid', async ({ page }) => {
  await signIn(page, 'bkg@demo.bonakala');
  await page.waitForURL('**/booking');
  await expect(page.getByRole('heading', { name: 'Omnichannel inbox' })).toBeVisible();
  await expect(page.getByText('Simulate an inbound message')).toBeVisible();
  await page.goto('/booking/calendar');
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await expect(page.getByText('booked', { exact: true }).first()).toBeVisible();
});

test('patient space reads a referral and offers slots with a price', async ({ page }) => {
  await signIn(page, 'pat@demo.bonakala');
  await page.waitForURL('**/p');
  await expect(page.getByRole('heading', { name: /Sawubona/ })).toBeVisible();
  await page.goto('/p/book');
  await page.getByRole('button', { name: 'Use an example' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('referral-extract')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Earliest near me' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Your price')).toBeVisible({ timeout: 15_000 });
});

test('the kiosk asks for an ID and offers eleven languages', async ({ page }) => {
  await signIn(page, 'fdk@demo.bonakala');
  await page.goto('/kiosk');
  await expect(page.getByRole('heading', { name: 'Scan your ID or enter your number' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'isiZulu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tshivenda' })).toBeVisible();
});

test('referrer space shows guidance in the provenance style before sending', async ({ page }) => {
  await signIn(page, 'ref@demo.bonakala');
  await page.waitForURL('**/r');
  await expect(page.getByRole('heading', { name: 'Refer', exact: true })).toBeVisible();
  await page.getByLabel('Procedure').selectOption('MR-LSPINE');
  await page.getByLabel('Clinical indication').fill('Low back pain for 3 weeks, no red flags');
  await expect(page.getByText('guideline-rules')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('usually not appropriate')).toBeVisible();
  await expect(page.getByText('Reason for proceeding (required when you keep this request)')).toBeVisible();
});
