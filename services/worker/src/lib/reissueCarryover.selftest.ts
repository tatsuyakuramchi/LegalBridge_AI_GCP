/**
 * reissueCarryover の自己テスト (手動実行: `npx tsx src/lib/reissueCarryover.selftest.ts`)。
 * DB は最小モックで代替し、対応付けと付け替え SQL の発行を検証する。
 * 正式なテストランナーは無いため assert + プロセス終了コードで表現。
 */
import { carryOverReissueConsumption, type CarryoverDb } from "./reissueCarryover.ts";
import assert from "node:assert";

interface MockCall {
  text: string;
  params: any[];
}

/** new/old 行を返し、UPDATE 呼び出しを記録するモック DB。 */
function makeDb(newLines: any[], oldLines: any[]) {
  const updates: MockCall[] = [];
  const db: CarryoverDb = {
    async query(text: string, params: any[] = []) {
      if (/FROM condition_lines cl/.test(text) && /cc\.document_number, d\.document_number\) = \$1/.test(text)) {
        return { rows: newLines };
      }
      if (/base_document_number/.test(text) && /EXISTS/.test(text)) {
        return { rows: oldLines };
      }
      if (/^UPDATE/.test(text.trim())) {
        updates.push({ text: text.trim().split("\n")[0], params });
        // condition_events の UPDATE は rowCount を返す
        if (/UPDATE condition_events/.test(text)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }
      throw new Error("unexpected query: " + text);
    },
  };
  return { db, updates };
}

let failures = 0;
async function testCase(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failures++;
    console.error(`  ✗ ${name}: ${e?.message || e}`);
  }
}

(async () => {
  console.log("reissueCarryover self-test");

  // 1) 純粋な再発行(明細不変): 全ペアが一意対応 → 付け替えられる。
  await testCase("unchanged reissue → carries over all lines", async () => {
    const oldL = [
      { id: 11, line_code: "CL-1", payment_scheme: "lump_sum", direction: "payable", amount_ex_tax: "10909.00", sig_name: "7/5開催分" },
      { id: 12, line_code: "CL-2", payment_scheme: "lump_sum", direction: "payable", amount_ex_tax: 502, sig_name: "交通費" },
    ];
    const newL = [
      { id: 21, line_code: "CL-9", payment_scheme: "lump_sum", direction: "payable", amount_ex_tax: 10909, sig_name: "7/5開催分" },
      { id: 22, line_code: "CL-10", payment_scheme: "lump_sum", direction: "payable", amount_ex_tax: "502.00", sig_name: "交通費" },
    ];
    const { db, updates } = makeDb(newL, oldL);
    const r = await carryOverReissueConsumption(db, "ARC-PO-2026-0001", "ARC-PO-2026-0001_001");
    assert.strictEqual(r.carried, 2, "carried should be 2");
    assert.strictEqual(r.skipped.length, 0, "no skips");
    // 11→21, 12→22 の events 付け替えが発行される
    const evUpd = updates.filter((u) => /UPDATE condition_events/.test(u.text));
    assert.deepStrictEqual(evUpd.map((u) => u.params).sort(), [[21, 11], [22, 12]].sort());
  });

  // 2) 内容編集あり(件名が変わった行がある): 曖昧な行は skip、確実な行だけ付け替え。
  await testCase("edited reissue → only unambiguous lines carried, rest skipped", async () => {
    const oldL = [
      { id: 11, line_code: "CL-1", payment_scheme: "lump_sum", direction: "payable", amount_ex_tax: 10909, sig_name: "7/5開催分" }, // 新版に無い
      { id: 12, line_code: "CL-2", payment_scheme: "lump_sum", direction: "payable", amount_ex_tax: 10909, sig_name: "7/11開催分" }, // 一致
    ];
    const newL = [
      { id: 22, line_code: "CL-10", payment_scheme: "lump_sum", direction: "payable", amount_ex_tax: 10909, sig_name: "7/11開催分" },
      { id: 23, line_code: "CL-11", payment_scheme: "lump_sum", direction: "payable", amount_ex_tax: 502, sig_name: "交通費" },
    ];
    const { db, updates } = makeDb(newL, oldL);
    const r = await carryOverReissueConsumption(db, "B", "B_001");
    assert.strictEqual(r.carried, 1, "only the 7/11 line carries");
    assert.strictEqual(r.skipped.length, 1, "the removed 7/5 line is skipped");
    assert.strictEqual(r.skipped[0].oldLineId, 11);
    const evUpd = updates.filter((u) => /UPDATE condition_events/.test(u.text));
    assert.deepStrictEqual(evUpd.map((u) => u.params), [[22, 12]]);
  });

  // 3) 同一 signature が複数(同額同名の明細が2行): 曖昧 → どちらも skip(取り違え防止)。
  await testCase("duplicate signatures → skipped, never mis-assigned", async () => {
    const oldL = [
      { id: 11, line_code: "CL-1", payment_scheme: "lump_sum", direction: "payable", amount_ex_tax: 1000, sig_name: "作業費" },
      { id: 12, line_code: "CL-2", payment_scheme: "lump_sum", direction: "payable", amount_ex_tax: 1000, sig_name: "作業費" },
    ];
    const newL = [
      { id: 21, line_code: "CL-9", payment_scheme: "lump_sum", direction: "payable", amount_ex_tax: 1000, sig_name: "作業費" },
      { id: 22, line_code: "CL-10", payment_scheme: "lump_sum", direction: "payable", amount_ex_tax: 1000, sig_name: "作業費" },
    ];
    const { db, updates } = makeDb(newL, oldL);
    const r = await carryOverReissueConsumption(db, "C", "C_001");
    assert.strictEqual(r.carried, 0, "nothing carried");
    assert.strictEqual(r.skipped.length, 2, "both skipped");
    assert.strictEqual(updates.filter((u) => /UPDATE condition_events/.test(u.text)).length, 0);
  });

  // 4) 旧版に実績付き明細が無い(通常の再発行) → 何もしない・skip も無い。
  await testCase("no event-bearing old lines → no-op", async () => {
    const { db, updates } = makeDb(
      [{ id: 21, line_code: "n", payment_scheme: "lump_sum", direction: "payable", amount_ex_tax: 1, sig_name: "x" }],
      []
    );
    const r = await carryOverReissueConsumption(db, "D", "D_001");
    assert.strictEqual(r.carried, 0);
    assert.strictEqual(r.skipped.length, 0);
    assert.strictEqual(updates.length, 0);
  });

  // 5) 引数欠落 → 安全に no-op。
  await testCase("missing args → no-op", async () => {
    const { db, updates } = makeDb([], []);
    const r = await carryOverReissueConsumption(db, "", "X");
    assert.strictEqual(r.carried, 0);
    assert.strictEqual(updates.length, 0);
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nall tests passed");
})();
