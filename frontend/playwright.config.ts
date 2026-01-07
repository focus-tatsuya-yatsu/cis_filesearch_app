/**
 * Playwright E2E Testing Configuration
 * E2Eテスト設定
 */

import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright設定
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',

  /* 並列実行の最大数 */
  fullyParallel: true,

  /* CI環境でのリトライ */
  retries: process.env.CI ? 2 : 0,

  /* CI環境でのワーカー数 */
  workers: process.env.CI ? 1 : undefined,

  /* レポーター */
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['list'],
  ],

  /* 共通設定 */
  use: {
    /* ベースURL */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',

    /* 失敗時のスクリーンショット */
    screenshot: 'only-on-failure',

    /* 失敗時のビデオ */
    video: 'retain-on-failure',

    /* トレース */
    trace: 'on-first-retry',

    /* タイムアウト */
    actionTimeout: 10000,
  },

  /* テストのタイムアウト */
  timeout: 30000,

  /* プロジェクト設定 */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* モバイルブラウザテスト */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  /* 開発サーバー設定 */
  webServer: {
    command: 'yarn dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
