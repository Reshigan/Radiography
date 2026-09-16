import { test, expect } from '@playwright/test';

const personas: Array<[string, string, string]> = [
  ['fdk@demo.bonakala', '/desk', 'Front Desk'], ['rgt@demo.bonakala', '/read', 'Reading Room'], ['bil@demo.bonakala', '/billing', 'Revenue Cycle'],
  ['exe@demo.bonakala', '/group', 'Group Console'], ['cmp@demo.bonakala', '/compliance', 'Compliance'], ['pat@demo.bonakala', '/p', 'Bonakala Imaging'],
];

for (const [email, home, title] of personas) {
  test(`sign in as ${email} lands on ${home}`, async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('bonakala-demo');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(`**${home}`);
    await expect(page.getByText(title).first()).toBeVisible();
  });
}
