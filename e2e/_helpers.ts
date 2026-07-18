import { Page, expect } from "@playwright/test"

/**
 * 共通ヘルパー。admin-ui は SPA(React Router)なので goto 後に主要要素の描画を待つ。
 */
export async function gotoApp(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" })
  // アプリシェル(サイドバー等)の描画を待つ。#root にコンテンツが入るまで。
  await page.waitForSelector("#root *", { timeout: 20_000 })
}

/** テキストが画面に出るまで待つ(SPA 描画の緩衝)。 */
export async function waitForText(page: Page, text: string, timeout = 15_000) {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout })
}

export const MUTATION_ALLOWED = process.env.E2E_ALLOW_MUTATION === "1"
