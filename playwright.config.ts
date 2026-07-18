import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright E2E 設定 — 設計 v1.4 で入れた UI 変更の実機スモーク検証用。
 *
 * 対象は「デプロイ済みの admin-ui」。admin-ui は Cloud Run に --allow-unauthenticated で
 * 出ており、クライアント側のログイン壁も無い(IAP ヘッダは表示用に読むだけ)ので、
 * URL を指定すれば認証なしで操作できる。
 *
 * 実行:
 *   E2E_BASE_URL="https://<admin-ui-url>" npx playwright test
 *   E2E_BASE_URL="http://localhost:8080" npx playwright test        # ローカル起動時
 *   E2E_BASE_URL=... npx playwright test --ui                       # デバッグ(UIモード)
 *
 * 注意:
 *   - 本スイートは可能な限り「非破壊」(DOM 構造/CSS/挙動の assert が中心。文書生成や
 *     素材作成のような本番データを増やす操作は既定で行わない)。破壊的フローは
 *     E2E_ALLOW_MUTATION=1 のときのみ有効化する(ステージング推奨)。
 *   - 一部は前提データ(課題なし案件・再編集可能な既存文書)が必要で、無ければ自動 skip。
 */
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:8080"

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
})
