import { test, expect } from "@playwright/test"
import { gotoApp } from "./_helpers"

/**
 * UIC-06: 閲覧モードで true readonly(<fieldset disabled>)。
 *   課題を選ぶと閲覧モードになる(DocumentEditor: handleIssueSelect → isReadOnly=true)。
 *   閲覧モードのフォームラッパが disabled な fieldset で、入力がキーボードでも変更不可。
 *
 * 前提: 課題(Backlog issue)が選べること。無ければ skip。
 */
test.describe("UIC-06 true readonly", () => {
  test("課題選択で閲覧モード→ disabled な fieldset になり入力不可", async ({ page }) => {
    await gotoApp(page, "/documents/new?template=nda")

    // 課題選択 UI(検索/一覧)を探す。実装差異に強いよう複数候補を試す。
    const issueTrigger = page
      .getByPlaceholder(/課題|issue|ARC-|検索/i)
      .first()
    const canPick = await issueTrigger.isVisible().catch(() => false)
    test.skip(!canPick, "課題ピッカーが見つからない環境のため skip")

    await issueTrigger.click()
    await page.waitForTimeout(600)
    const option = page.getByRole("option").first()
    const hasOption = await option.isVisible().catch(() => false)
    test.skip(!hasOption, "課題候補が無い(前提データなし)ため skip")
    await option.click()
    await page.waitForTimeout(800)

    // 閲覧モードのラッパ: disabled 属性を持つ fieldset が存在する。
    const disabledFieldset = page.locator("fieldset[disabled]")
    await expect(disabledFieldset.first()).toBeVisible({ timeout: 10_000 })

    // その中の input はキーボードでも編集不可(disabled)。
    const anyInput = disabledFieldset.locator("input, textarea, select").first()
    if (await anyInput.count()) {
      await expect(anyInput).toBeDisabled()
    }
  })
})
