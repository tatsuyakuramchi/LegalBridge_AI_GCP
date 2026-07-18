import { test, expect } from "@playwright/test"
import { gotoApp } from "./_helpers"

/**
 * FRM-04: 出版利用許諾条件書(pub_license_terms)が Schema フォームとして描画される。
 *   ?template=pub_license_terms でテンプレ事前選択(UIC-12 のリダイレクト先と同じ)。
 *   独自セクション「作品・原作・基本契約」が bare custom で出ることを検証。
 * 非破壊(生成はしない)。
 */
test.describe("FRM-04 pub_license_terms Schema form", () => {
  test("独自セクション(作品/原作/基本契約)が描画される", async ({ page }) => {
    await gotoApp(page, "/documents/new?template=pub_license_terms")

    // FRM-04 で bare custom として移設した独自セクションの見出し。
    await expect(
      page.getByText("作品・原作・基本契約", { exact: false }).first()
    ).toBeVisible({ timeout: 20_000 })

    // 許諾者(取引先)検索 or 原作(Ledger)ピッカーのいずれかが存在する。
    const hasPickers =
      (await page.getByText(/原作 \(Ledger\)|許諾者\(取引先\)|対象作品/).count()) > 0
    expect(hasPickers, "作品/原作/許諾者いずれかのピッカー見出しが存在").toBe(true)
  })

  test("旧 /master/pub-license は文書フォームへリダイレクト(UIC-12)", async ({ page }) => {
    await gotoApp(page, "/master/pub-license")
    await page.waitForTimeout(800)
    expect(page.url()).toContain("/documents/new")
    expect(page.url()).toContain("pub_license_terms")
  })
})
