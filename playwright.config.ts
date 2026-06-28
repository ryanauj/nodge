import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright smoke config (spec §12 Phase 1 / §13). The app is served by the
 * Vite dev server under the `/nodge/` base.
 *
 * Browser resolution: prefer `PLAYWRIGHT_CHROMIUM_PATH`, else the Chromium
 * preinstalled in this environment (do not run `playwright install` here), else
 * fall back to Playwright's own managed browser (e.g. a CI runner that ran
 * `playwright install chromium`).
 */

const PORT = 5173
const BASE_URL = `http://localhost:${PORT}/nodge/`

const PRESET_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  (existsSync(PRESET_CHROMIUM) ? PRESET_CHROMIUM : undefined)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: CHROMIUM ? { executablePath: CHROMIUM } : {},
      },
      // The desktop smoke + Phase 2-4 specs; the mobile spec is mobile-only.
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      // Phase 5 mobile project (spec §12 acceptance): a phone viewport with
      // touch enabled, mirroring the chromium project's browser resolution. Only
      // the mobile smoke runs here (the touch interaction model).
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        launchOptions: CHROMIUM ? { executablePath: CHROMIUM } : {},
      },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
