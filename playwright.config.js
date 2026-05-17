import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npx serve . --listen 3000 --no-clipboard',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    ...devices['Pixel 5'],
  },
  timeout: 15000,
});
