import { test, expect } from "@playwright/test"
import { gotoApp, MUTATION_ALLOWED } from "./_helpers"

/**
 * UIC-05: 課題の無い「案件のみ」でも下書き保存・再開できる。
 *
 * このフローは下書きを作成する(= データを増やす)ため、既定では skip。
 * 実行するには:
 *   E2E_ALLOW_MUTATION=1
 *   E2E_MATTER_ID_NO_ISSUE=<課題の無い案件の matter_id>
 * を指定する(ステージング推奨)。
 *
 * 手順: /documents/new?matter_id=<id> で開く → テンプレ選択 → 入力 → 下書き保存 →
 *       /master/drafts に「案件のみ (Matter #id)」が出る → 再開 → 復元される。
 */
const MATTER_ID = process.env.E2E_MATTER_ID_NO_ISSUE || ""

test.describe("UIC-05 Matterのみ下書き", () => {
  test("案件のみで下書き保存→一覧表示→再開", async ({ page }) => {
    test.skip(!MUTATION_ALLOWED, "破壊的フローのため E2E_ALLOW_MUTATION=1 のときのみ実行")
    test.skip(!MATTER_ID, "E2E_MATTER_ID_NO_ISSUE(課題なし案件のID)が必要")

    // 1) 案件起点で開く + テンプレ nda を事前選択。
    await gotoApp(page, `/documents/new?matter_id=${MATTER_ID}&template=nda`)

    // 2) 下書き保存ボタンが押せる(課題が無くても案件があれば有効)。
    const saveBtn = page.getByRole("button", { name: /下書き保存/ }).first()
    await expect(saveBtn).toBeVisible({ timeout: 20_000 })
    // 何か入力して hasContent を満たす(任意の可視 input へ)。
    const firstInput = page.locator("input:not([type=hidden]):not([disabled])").first()
    if (await firstInput.count()) {
      await firstInput.fill("E2E 下書きテスト")
    }
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(page.getByText(/Draft saved|一時保存|保存しました/).first()).toBeVisible({
      timeout: 10_000,
    })

    // 3) 下書き一覧に「案件のみ (Matter #<id>)」が出る。
    await gotoApp(page, "/master/drafts")
    await expect(
      page.getByText(new RegExp(`案件のみ.*#${MATTER_ID}`)).first()
    ).toBeVisible({ timeout: 15_000 })

    // 4) 再開して開ける(matter_id 起点でエディタに戻る)。
    const resumeRow = page.getByText(new RegExp(`案件のみ.*#${MATTER_ID}`)).first()
    await resumeRow.click().catch(() => {})
    // 開くボタンがある実装なら押す。
    const openBtn = page.getByRole("button", { name: /開く|編集|再開/ }).first()
    if (await openBtn.isVisible().catch(() => false)) await openBtn.click()
    await page.waitForURL(/\/documents\/new/, { timeout: 15_000 }).catch(() => {})
    expect(page.url()).toContain("/documents/new")
  })
})
