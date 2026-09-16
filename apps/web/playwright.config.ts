import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        { command: 'cd ../api && DATABASE_URL=file:./data/e2e.db PORT=8787 npx tsx src/node.ts', port: 8787, reuseExistingServer: true, timeout: 120_000 },
        { command: 'npx vite --port 5173', port: 5173, reuseExistingServer: true, timeout: 120_000 },
      ],
});
