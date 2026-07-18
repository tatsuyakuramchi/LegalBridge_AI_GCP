import { test, expect } from "@playwright/test"
import { gotoApp } from "./_helpers"

/**
 * UIC-03: 素材登録画面が「素材CRUD限定」になっている。
 *   金銭条件エディタ(取引形態×料率の入力表・「金銭条件を追加」ボタン)が撤去され、
 *   代わりに「保存して文書フォームで条件を登録」CTA がある。
 *
 * 前提: 原作(source-ip)が 1 件以上あり、WorkPicker で選べること。
 *   選べない環境では form へ入れないため skip する(パネル描画のスモークのみ実施)。
 */
test.describe("UIC-03 MaterialEntry 素材CRUD限定", () => {
  test("パネルが描画され、旧金銭条件エディタが存在しない", async ({ page }) => {
    await gotoApp(page, "/master/materials")
    await expect(
      page.getByText("原作マテリアル", { exact: false }).first()
    ).toBeVisible({ timeout: 20_000 })

    // 原作を選んで新規作成フォームへ入る(best-effort)。
    const workSearch = page
      .getByPlaceholder(/原作コード|タイトル|検索/)
      .first()
    const canSearch = await workSearch.isVisible().catch(() => false)
    test.skip(!canSearch, "原作ピッカーが見つからない環境のため skip")

    await workSearch.click()
    await workSearch.fill("")
    await page.waitForTimeout(800)
    // ドロップダウン候補(role=option or listitem)を 1 件選ぶ。
    const option = page.getByRole("option").first()
    const hasOption = await option.isVisible().catch(() => false)
    test.skip(!hasOption, "原作候補が無い(前提データなし)ため skip")
    await option.click()

    // 新規作成へ。
    const newBtn = page.getByRole("button", { name: /新規マテリアルを作成|新規/ }).first()
    if (await newBtn.isVisible().catch(() => false)) await newBtn.click()

    // 検証: 条件は文書フォームCTAへ一本化。旧「金銭条件を追加」ボタンは無い。
    await expect(
      page.getByRole("button", { name: /金銭条件を追加/ })
    ).toHaveCount(0)
    await expect(
      page.getByText(/文書フォームで条件を登録/).first()
    ).toBeVisible()
  })
})
