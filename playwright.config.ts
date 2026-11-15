import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig } from '@playwright/test'

// End-to-end tests: the built app in Chromium, on a fresh install whose news sites are e2e/server.ts's own pages.
// `npm run test:e2e` builds the web app first.
const PORT = 3997

export default defineConfig({
  testDir: 'e2e',
  // One install, set up by the first test, for every test in order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    locale: 'fr-BE',
    timezoneId: 'Europe/Brussels',
    // The service worker would answer some requests from its cache, between two tests.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    // A Chromium already on the machine, when it is not the one Playwright downloads.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined }
  },
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning e2e/server.ts',
    url: `http://127.0.0.1:${PORT}/health`,
    env: { PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'hodi-e2e-')) },
    reuseExistingServer: false,
    stdout: 'pipe'
  }
})
