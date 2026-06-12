/**
 * データ構造刷新 — バックフィル一括実行ドライバ。
 *
 * 個別スクリプト(C-1〜C-4, E-2a)を「正しい依存順」で順に実行し、最後に突合検証
 * (D-verify) と移行レディネス監査を回す。各スクリプトは冪等なので再実行安全。
 *
 * 実行:
 *   tsx scripts/restructure_run_all.ts            # 全工程 dry-run (件数確認のみ)
 *   tsx scripts/restructure_run_all.ts --apply     # 全工程 apply (バックフィル実行)
 *
 * 依存順 (実装設計書 Phase C/E-2(a)):
 *   C-1 契約ヘッダ分解 → C-2 条件明細 → C-3 実績 → C-4 sublicensee/works
 *   → E-2(a) 表示列 再backfill → D-verify 突合 → readiness 監査
 *
 * 注意: 物理 DROP / 旧テーブル書き込み停止 / G-1 制約強化 は本ドライバに含めない
 *   (破壊的 or ゲート付きのため、レディネス監査が全GOになってから個別に実行する)。
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const APPLY = process.argv.includes("--apply");
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

// tsx 実行コマンドを解決 (ローカル binary 優先 → npx tsx フォールバック)。
function tsxRunner(): { cmd: string; pre: string[] } {
  const local = path.resolve(process.cwd(), "node_modules", ".bin", "tsx");
  if (fs.existsSync(local)) return { cmd: local, pre: [] };
  return { cmd: "npx", pre: ["tsx"] };
}

// [スクリプト, apply時に --apply を渡すか]
const STEPS: Array<{ file: string; label: string; applyFlag: boolean }> = [
  { file: "restructure_c1_contract_roles.ts", label: "C-1 契約ヘッダ分解", applyFlag: true },
  { file: "restructure_c2_condition_lines.ts", label: "C-2 条件明細", applyFlag: true },
  { file: "restructure_c3_condition_events.ts", label: "C-3 実績", applyFlag: true },
  { file: "restructure_c4_works.ts", label: "C-4 sublicensee/works", applyFlag: true },
  { file: "restructure_e2a_display_columns.ts", label: "E-2(a) 表示列 再backfill", applyFlag: true },
  // 検証系は常に読み取りのみ (--apply を渡さない)
  { file: "restructure_d_verify.ts", label: "D-5 突合検証", applyFlag: false },
  { file: "restructure_readiness_audit.ts", label: "レディネス監査", applyFlag: false },
];

function run(file: string, args: string[]): number {
  const full = path.join(SCRIPTS_DIR, file);
  const { cmd, pre } = tsxRunner();
  const r = spawnSync(cmd, [...pre, full, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  return r.status ?? 1;
}

function main() {
  console.log(
    `\n############ データ構造刷新 一括バックフィル (${APPLY ? "APPLY" : "DRY-RUN"}) ############`
  );
  for (const step of STEPS) {
    console.log(`\n======== ${step.label} (${step.file}) ========`);
    const args = APPLY && step.applyFlag ? ["--apply"] : [];
    const code = run(step.file, args);
    if (code !== 0) {
      console.error(
        `\n❌ ${step.label} が異常終了 (exit=${code})。中断します。` +
          ` 各スクリプトは冪等なので、原因解消後に再実行してください。`
      );
      process.exit(code);
    }
  }
  console.log(
    `\n############ 完了 (${APPLY ? "APPLY" : "DRY-RUN"}) ############\n` +
      (APPLY
        ? "バックフィル適用済み。レディネス監査が全GOなら、別途 G-1 制約強化 / 旧テーブル DROP に進めます。"
        : "DRY-RUN 完了。--apply で実行してください。")
  );
}

main();
