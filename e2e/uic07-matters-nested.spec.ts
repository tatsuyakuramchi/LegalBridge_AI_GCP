import { test, expect } from "@playwright/test"
import { gotoApp } from "./_helpers"

/**
 * UIC-07: 案件一覧のネスト interactive control 解消。
 *   行は非インタラクティブな div、遷移は単一の overlay button、統合カートは独立 button。
 * 非破壊(DOM 構造/挙動の検証のみ)。前提: 案件が 1 件以上あること(無ければ skip)。
 */
test.describe("UIC-07 MattersList nested interactive", () => {
  test("行は button でネストせず、遷移用 overlay と統合ボタンが兄弟である", async ({ page }) => {
    await gotoApp(page, "/matters")

    // 行の遷移用 overlay(aria-label="案件 ... を開く")を待つ。無ければ案件ゼロとみなし skip。
    const navButtons = page.getByRole("button", { name: /案件.*を開く/ })
    const count = await navButtons.count().catch(() => 0)
    test.skip(count === 0, "案件が無い環境のため skip(前提データなし)")

    // 1) 遷移用 overlay button が存在する。
    await expect(navButtons.first()).toBeVisible()

    // 2) ネスト interactive が無い: 行内の button の中に別の button / [role=button] が無い。
    const nestedInteractive = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"))
      return buttons.some((b) => b.querySelector("button, [role='button']") !== null)
    })
    expect(nestedInteractive, "button の中に button/[role=button] がネストしていない").toBe(false)

    // 3) 統合カートのトグルは本物の button(title に「統合カート」)。
    const mergeBtn = page.getByRole("button", { name: /統合カート/ }).first()
    await expect(mergeBtn).toBeVisible()

    // 4) キーボード到達性: overlay と統合ボタンがそれぞれ tab フォーカスできる。
    await navButtons.first().focus()
    await expect(navButtons.first()).toBeFocused()
    await mergeBtn.focus()
    await expect(mergeBtn).toBeFocused()
  })

  test("統合ボタンのクリックで行遷移が発火しない(stopPropagation)", async ({ page }) => {
    await gotoApp(page, "/matters")
    const mergeBtn = page.getByRole("button", { name: /統合カート/ })
    const count = await mergeBtn.count().catch(() => 0)
    test.skip(count === 0, "案件が無い環境のため skip")

    const urlBefore = page.url()
    await mergeBtn.first().click()
    // 詳細(/matters/:id)へ遷移していないこと(統合カート操作のみ)。
    await page.waitForTimeout(500)
    expect(page.url()).toBe(urlBefore)
  })
})
