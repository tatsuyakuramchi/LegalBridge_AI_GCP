import { test, expect } from "@playwright/test"
import { gotoApp } from "./_helpers"

/**
 * UIC-04: Document Editor のアクションバーが実際に sticky。
 *   ?template=nda でテンプレを事前選択してフォーム＋バーを描画させ、
 *   「下書き保存」ボタンの祖先で position:sticky を持つ要素があることを検証。
 * 非破壊(保存/生成はしない)。
 */
test.describe("UIC-04 sticky action bar", () => {
  test("アクションバーが position:sticky である", async ({ page }) => {
    await gotoApp(page, "/documents/new?template=nda")

    // 主操作「下書き保存」ボタンが出るまで待つ(テンプレ選択済みで描画される)。
    const saveBtn = page.getByRole("button", { name: /下書き保存/ })
    await expect(saveBtn.first()).toBeVisible({ timeout: 20_000 })

    // 下書き保存ボタンの祖先を遡り、position:sticky の要素を探す。
    const isSticky = await saveBtn.first().evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement
      for (let i = 0; i < 12 && node; i++) {
        const pos = getComputedStyle(node).position
        if (pos === "sticky" || pos === "fixed") return true
        node = node.parentElement
      }
      return false
    })
    expect(isSticky, "アクションバー(またはその祖先)が sticky/fixed で固定されている").toBe(true)
  })

  test("スクロールしても作成系ボタンが視認できる(ビューポート内)", async ({ page }) => {
    await gotoApp(page, "/documents/new?template=nda")
    const saveBtn = page.getByRole("button", { name: /下書き保存/ }).first()
    await expect(saveBtn).toBeVisible({ timeout: 20_000 })
    // フォーム下端までスクロールしてもバーが画面内に残る。
    await page.mouse.wheel(0, 4000)
    await page.waitForTimeout(300)
    await expect(saveBtn).toBeInViewport()
  })
})
