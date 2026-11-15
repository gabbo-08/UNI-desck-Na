const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
    },
  },
  fullyParallel: true,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    ...devices['Desktop Chrome'],
    locale: 'it-IT',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm --prefix frontend run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    // Next.js rejects requests from the Playwright loopback origin unless it is
    // explicitly allowlisted. Keep this in the test harness so local runs and
    // CI behave the same way without requiring a shell-specific env setup.
    env: {
      ...process.env,
      NEXT_ALLOWED_DEV_ORIGINS: process.env.NEXT_ALLOWED_DEV_ORIGINS || '127.0.0.1,localhost',
    },
    timeout: 120_000,
  },
});
