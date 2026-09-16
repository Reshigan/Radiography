// Screenshot a signed-in page: node tools/shot.mjs <email> <path> <out.png> [width] [height]
// Requires API on :8787 and web on :5173 (pnpm dev). Uses the preinstalled Chromium when PW_CHROMIUM_PATH is set.
import { chromium } from '@playwright/test';
const [email, path, out = 'shot.png', w = '1440', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:5201/');
if (email) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('bonakala-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(800);
}
await page.goto('http://localhost:5201' + path);
await page.waitForTimeout(1200);
await page.screenshot({ path: out });
console.log('saved', out, errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '(no console errors)');
await browser.close();
