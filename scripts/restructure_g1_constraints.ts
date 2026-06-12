/**
 * データ構造刷新 Phase G-1 — 制約強化 (ゲート付き・DROP は含まない)。
 *
 * 注意: 本スクリプトの制約は initDb には入れない。未移行環境を壊さないよう、
 *   データ補正(C-1〜C-4)完了後に「検証 → 適用」する一度きりの移行として実行する。
 *
 * 適用内容:
 *   - contract_capabilities.structural_role を NULL から自動補完するトリガ
 *     (record_type 由来。既存の全 INSERT 経路が structural_role を渡さなくても
 *      充足されるため、NOT NULL を安全に付与できる)。
 *   - structural_role に CHECK('master','terms') + NOT NULL。
 *   - condition_lines に cl_scheme_recurring_term CHECK
 *     (subscription/royalty は term_start 必須)。違反データがあれば中断
 *     (--force で NOT VALID 付与=既存は不問・新規のみ強制)。
 *   - トリガ「condition_lines は terms 契約のみ」「parent は master のみ」。
 *
 * 実行:
 *   tsx scripts/restructure_g1_constraints.ts           # 検証のみ(dry-run)
 *   tsx scripts/restructure_g1_constraints.ts --apply    # 検証OKなら適用
 *   tsx scripts/restructure_g1_constraints.ts --apply --force  # 違反は NOT VALID で適用
 */

import { pool } from "../services/worker/src/lib/db.js";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

async function main() {
  console.log(`\n=== Phase G-1: 制約強化 (${APPLY ? (FORCE ? "APPLY --force" : "APPLY") : "DRY-RUN"}) ===`);

  // ---- 検証 ---------------------------------------------------------------
  const nullRole = (await pool.query(
    `SELECT COUNT(*)::int c FROM contract_capabilities WHERE structural_role IS NULL`
  )).rows[0].c;
  const badRole = (await pool.query(
    `SELECT COUNT(*)::int c FROM contract_capabilities
      WHERE structural_role IS NOT NULL AND structural_role NOT IN ('master','terms')`
  )).rows[0].c;
  const clOnNonTerms = (await pool.query(
    `SELECT COUNT(*)::int c FROM condition_lines cl
       JOIN contract_capabilities cc ON cc.id = cl.capability_id
      WHERE cc.structural_role IS NOT NULL AND cc.structural_role <> 'terms'`
  )).rows[0].c;
  const recurringNoTerm = (await pool.query(
    `SELECT COUNT(*)::int c FROM condition_lines
      WHERE payment_scheme IN ('subscription','royalty') AND term_start IS NULL`
  )).rows[0].c;
  const badParent = (await pool.query(
    `SELECT COUNT(*)::int c FROM contract_capabilities child
       JOIN contract_capabilities parent ON parent.id = child.parent_capability_id
      WHERE parent.structural_role IS NOT NULL AND parent.structural_role <> 'master'`
  )).rows[0].c;

  console.log("\n[検証結果]");
  console.log(`  structural_role NULL (apply で record_type から補完): ${nullRole}`);
  console.log(`  structural_role 不正値 (master/terms 以外): ${badRole}  ${badRole ? "← 要修正" : "OK"}`);
  console.log(`  condition_lines が非 terms 契約に付与: ${clOnNonTerms}  ${clOnNonTerms ? "← 警告(既存・トリガは将来分のみ)" : "OK"}`);
  console.log(`  subscription/royalty で term_start 欠落: ${recurringNoTerm}  ${recurringNoTerm ? "← --force 必要" : "OK"}`);
  console.log(`  parent_capability_id が非 master を指す: ${badParent}  ${badParent ? "← 警告" : "OK"}`);

  const hardBlock = badRole > 0;
  const recurringBlock = recurringNoTerm > 0 && !FORCE;

  if (!APPLY) {
    console.log("\nDRY-RUN 完了。--apply で適用。");
    if (hardBlock) console.log("⚠ structural_role 不正値があるため、修正するまで適用不可。");
    if (recurringNoTerm > 0) console.log("⚠ term_start 欠落があります。term_start を補完するか --force(NOT VALID) で適用。");
    await pool.end();
    return;
  }
  if (hardBlock) {
    console.error("\n❌ structural_role 不正値があるため中断 (master/terms に修正してください)。");
    await pool.end();
    process.exit(1);
  }

  // ---- 適用 ---------------------------------------------------------------
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. NULL structural_role を backfill
    await client.query(`
      UPDATE contract_capabilities SET structural_role =
        CASE WHEN record_type = 'master_contract' THEN 'master' ELSE 'terms' END
      WHERE structural_role IS NULL
    `);

    // 2. 自動補完トリガ (全 INSERT/UPDATE 経路で NULL を埋める → NOT NULL 安全化)
    await client.query(`
      CREATE OR REPLACE FUNCTION cc_fill_structural_role() RETURNS trigger AS $fn$
      BEGIN
        IF NEW.structural_role IS NULL THEN
          NEW.structural_role := CASE WHEN NEW.record_type = 'master_contract' THEN 'master' ELSE 'terms' END;
        END IF;
        RETURN NEW;
      END $fn$ LANGUAGE plpgsql;
    `);
    await client.query(`DROP TRIGGER IF EXISTS trg_cc_fill_structural_role ON contract_capabilities`);
    await client.query(`
      CREATE TRIGGER trg_cc_fill_structural_role BEFORE INSERT OR UPDATE ON contract_capabilities
        FOR EACH ROW EXECUTE FUNCTION cc_fill_structural_role()
    `);

    // 3. structural_role CHECK + NOT NULL
    await addConstraintIfAbsent(
      client,
      "cc_structural_role_chk",
      `ALTER TABLE contract_capabilities ADD CONSTRAINT cc_structural_role_chk
         CHECK (structural_role IN ('master','terms'))`
    );
    await client.query(`ALTER TABLE contract_capabilities ALTER COLUMN structural_role SET NOT NULL`);

    // 4. condition_lines: subscription/royalty は term_start 必須
    await addConstraintIfAbsent(
      client,
      "cl_scheme_recurring_term",
      `ALTER TABLE condition_lines ADD CONSTRAINT cl_scheme_recurring_term
         CHECK (payment_scheme NOT IN ('subscription','royalty') OR term_start IS NOT NULL)
         ${recurringBlock ? "" : recurringNoTerm > 0 ? "NOT VALID" : ""}`
    );

    // 5. condition_lines は terms 契約のみ
    await client.query(`
      CREATE OR REPLACE FUNCTION cl_enforce_terms_only() RETURNS trigger AS $fn$
      DECLARE r text;
      BEGIN
        SELECT structural_role INTO r FROM contract_capabilities WHERE id = NEW.capability_id;
        IF r IS NOT NULL AND r <> 'terms' THEN
          RAISE EXCEPTION 'condition_lines は terms 契約にのみ付与できます (capability_id=%, role=%)', NEW.capability_id, r;
        END IF;
        RETURN NEW;
      END $fn$ LANGUAGE plpgsql;
    `);
    await client.query(`DROP TRIGGER IF EXISTS trg_cl_terms_only ON condition_lines`);
    await client.query(`
      CREATE TRIGGER trg_cl_terms_only BEFORE INSERT OR UPDATE ON condition_lines
        FOR EACH ROW EXECUTE FUNCTION cl_enforce_terms_only()
    `);

    // 6. parent_capability_id は master のみ
    await client.query(`
      CREATE OR REPLACE FUNCTION cc_enforce_master_parent() RETURNS trigger AS $fn$
      DECLARE r text;
      BEGIN
        IF NEW.parent_capability_id IS NOT NULL THEN
          SELECT structural_role INTO r FROM contract_capabilities WHERE id = NEW.parent_capability_id;
          IF r IS NOT NULL AND r <> 'master' THEN
            RAISE EXCEPTION 'parent_capability_id は master 契約のみ指せます (parent=%, role=%)', NEW.parent_capability_id, r;
          END IF;
        END IF;
        RETURN NEW;
      END $fn$ LANGUAGE plpgsql;
    `);
    await client.query(`DROP TRIGGER IF EXISTS trg_cc_master_parent ON contract_capabilities`);
    await client.query(`
      CREATE TRIGGER trg_cc_master_parent BEFORE INSERT OR UPDATE ON contract_capabilities
        FOR EACH ROW EXECUTE FUNCTION cc_enforce_master_parent()
    `);

    await client.query("COMMIT");
    console.log("\n✅ COMMIT 完了。制約・トリガを適用しました。");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("ROLLBACK:", e);
    process.exitCode = 1;
  } finally {
    client.release();
  }
  await pool.end();
}

// 制約が無ければ追加 (pg_constraint で冪等判定)。
async function addConstraintIfAbsent(client: any, name: string, ddl: string) {
  const ex = await client.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [name]);
  if (ex.rows.length) {
    console.log(`  制約 ${name} は既存 → skip`);
    return;
  }
  await client.query(ddl);
  console.log(`  制約 ${name} を追加`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
