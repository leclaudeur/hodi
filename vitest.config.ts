import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { hodiConfig } from './web/config-plugin.ts'

// Dates and days read the same on every machine and in CI.
process.env.TZ = 'Europe/Brussels'

// Unit tests of the web app's utilities (web/test). Screens are checked in a real browser (e2e/), not here.
export default defineConfig({
  plugins: [hodiConfig(path.resolve('config.yml'))],
  test: {
    include: ['web/test/**/*.test.ts'],
    // The sanitizer and the stores need a DOM and localStorage.
    environment: 'jsdom',
    setupFiles: ['web/test/setup.ts'],
    restoreMocks: true,
    unstubGlobals: true
  }
})
