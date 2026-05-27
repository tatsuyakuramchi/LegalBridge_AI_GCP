/**
 * Phase 23.0 — 統一スキーマへのデータ移行スクリプト (one-shot)
 *
 * 移行マップ:
 *   order_items                  → contract_capabilities (record_type='purchase_order')
 *   order_line_items             → capability_line_items
 *   order_expenses               → capability_expenses
 *   order_other_fees             → capability_other_fees
 *   license_contracts            → contract_capabilities (record_type='individual_contract' or 'standalone_contract')
 *   license_financial_conditions → capability_financial_conditions
 *
 *   delivery_events.order_item_id           → delivery_events.capability_id
 *   delivery_line_items.order_line_item_id  → delivery_line_items.capability_line_item_id
 *   royalty_calculations.license_contract_id           → capability_id
 *   royalty_calculations.license_financial_condition_id→ capability_financial_condition_id
 *
 * 実行:
 *   tsx scripts/phase23_migrate_to_capabilities.ts            # ドライラン (件数比較のみ)
 *   tsx scripts/phase23_migrate_to_capabilities.ts --apply    # 実際に移行
 *   tsx scripts/phase23_migrate_to_capabilities.ts --apply --drop                # 旧テーブルの依存関係を表示 (削除はしない)
 *   tsx scripts/phase23_migrate_to_capabilities.ts --apply --drop --really-drop  # 実際にDROP TABLE CASCADE
 *
 * 全工程は単一トランザクション (--apply) で実行。失敗時は ROLLBACK。
 * 冪等性:
 *   - 既存 contract_capabilities (document_number で同定) は UPDATE
 *   - 子テーブルは ON CONFLICT (capability_id, line_no/condition_no) DO UPDATE
 *   - 再実行しても件数増えない
 *
 * Phase 23.0.4: `--drop` だけでは DROP TABLE を実行しない安全モードに変更。
 *   依存オブジェクト (FK / view / index 等) の一覧を表示するだけにとどめ、
 *   実際に物理削除する場合は `--really-drop` を併用する必要がある。
 *   これにより `DROP TABLE ... CASCADE` で manufacturing_events や
 *   royalty_payments の FK 列が意図せず壊れる事故を防ぐ。
 */

import { pool } from "../services/worker/src/lib/db.js";

const APPLY = process.argv.includes("--apply");
const DROP = process.argv.includes("--drop");
const REALLY_DROP = process.argv.includes("--really-drop");

type Counts = Record<string, number>;

async function countAll(): Promise<Counts> {
  const tables = [
    "order_items",
    "order_line_items",
    "order_expenses",
    "order_other_fees",
    "license_contracts",
    "license_financial_conditions",
    "contract_capabilities",
    "capability_line_items",
    "capability_financial_conditions",
    "capability_expenses",
    "capability_other_fees",
    "delivery_events",
    "delivery_line_items",
    "royalty_calculations",
  ];
  const counts: Counts = {};
  for (const t of tables) {
    try {
      const r = await pool.query(`SELECT COUNT(*)::int AS c FROM ${t}`);
      counts[t] = r.rows[0].c;
    } catch {
      counts[t] = -1;
    }
  }
  return counts;
}

function printCounts(label: string, c: Counts) {
  console.log(`\n=== ${label} ===`);
  for (const [k, v] of Object.entries(c)) {
    console.log(`  ${k.padEnd(36)} ${v >= 0 ? v : "(missing)"}`);
  }
}

async function migrateOrderItems(client: any) {
  console.log("\n[1/8] order_items → contract_capabilities (purchase_order)");

  // 既存 contract_capabilities に document_number で対応する行があれば UPDATE、
  // なければ INSERT。マッピングのため一時テーブルを作る。
  await client.query(`
    DROP TABLE IF EXISTS _tmp_oi_to_cc;
    CREATE TEMP TABLE _tmp_oi_to_cc (
      order_item_id INTEGER PRIMARY KEY,
      capability_id INTEGER
    );
  `);

  // PO 文書番号と order_items の対応を取得
  await client.query(`
    WITH po_docs AS (
      SELECT DISTINCT ON (d.issue_key)
             d.issue_key,
             d.document_number
        FROM documents d
       WHERE d.template_type LIKE '%purchase_order%'
       ORDER BY d.issue_key, d.created_at DESC
    ),
    enriched AS (
      SELECT
        oi.id   AS order_item_id,
        oi.backlog_issue_key,
        oi.legal_request_id,
        oi.vendor_code,
        oi.description,
        oi.amount_ex_tax,
        oi.amount_inc_tax,
        oi.tax_rate,
        oi.tax_amount,
        oi.due_date,
        oi.created_at,
        v.id AS vendor_id,
        pd.document_number
      FROM order_items oi
      LEFT JOIN po_docs pd ON pd.issue_key = oi.backlog_issue_key
      LEFT JOIN vendors v  ON v.vendor_code = oi.vendor_code
    ),
    upsert AS (
      INSERT INTO contract_capabilities (
        vendor_id, record_type, contract_category, contract_type, contract_title,
        document_number, contract_status, source_system,
        backlog_issue_key, legal_request_id,
        amount_ex_tax, amount_inc_tax, tax_rate, tax_amount, due_date
      )
      SELECT
        e.vendor_id,
        'purchase_order',
        'service',
        'purchase_order',
        COALESCE(NULLIF(e.description, ''), e.document_number, e.backlog_issue_key),
        e.document_number,
        'executed',
        'phase23-migration',
        e.backlog_issue_key,
        e.legal_request_id,
        e.amount_ex_tax,
        e.amount_inc_tax,
        e.tax_rate,
        e.tax_amount,
        e.due_date
      FROM enriched e
      ON CONFLICT (document_number) DO UPDATE SET
        record_type        = 'purchase_order',
        contract_category  = 'service',
        contract_type      = 'purchase_order',
        vendor_id          = COALESCE(EXCLUDED.vendor_id, contract_capabilities.vendor_id),
        backlog_issue_key  = COALESCE(EXCLUDED.backlog_issue_key, contract_capabilities.backlog_issue_key),
        legal_request_id   = COALESCE(EXCLUDED.legal_request_id, contract_capabilities.legal_request_id),
        amount_ex_tax      = COALESCE(EXCLUDED.amount_ex_tax, contract_capabilities.amount_ex_tax),
        amount_inc_tax     = COALESCE(EXCLUDED.amount_inc_tax, contract_capabilities.amount_inc_tax),
        tax_rate           = COALESCE(EXCLUDED.tax_rate, contract_capabilities.tax_rate),
        tax_amount         = COALESCE(EXCLUDED.tax_amount, contract_capabilities.tax_amount),
        due_date           = COALESCE(EXCLUDED.due_date, contract_capabilities.due_date),
        updated_at         = CURRENT_TIMESTAMP
      RETURNING id, backlog_issue_key
    )
    INSERT INTO _tmp_oi_to_cc (order_item_id, capability_id)
    SELECT oi.id, u.id
      FROM order_items oi
      JOIN upsert u ON u.backlog_issue_key = oi.backlog_issue_key;
  `);

  // backlog_issue_key が NULL の order_items (document_number でしか紐付かない場合)
  // のため fallback INSERT を別途回す。
  await client.query(`
    INSERT INTO _tmp_oi_to_cc (order_item_id, capability_id)
    SELECT oi.id, cc.id
      FROM order_items oi
      JOIN documents d ON d.issue_key = oi.backlog_issue_key AND d.template_type LIKE '%purchase_order%'
      JOIN contract_capabilities cc ON cc.document_number = d.document_number
     WHERE NOT EXISTS (SELECT 1 FROM _tmp_oi_to_cc t WHERE t.order_item_id = oi.id)
    ON CONFLICT (order_item_id) DO NOTHING;
  `);

  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS c FROM _tmp_oi_to_cc"
  );
  console.log(`      mapped ${rows[0].c} order_items → contract_capabilities`);
}

async function migrateOrderLineItems(client: any) {
  console.log("\n[2/8] order_line_items → capability_line_items");
  await client.query(`
    DROP TABLE IF EXISTS _tmp_oli_to_cli;
    CREATE TEMP TABLE _tmp_oli_to_cli (
      order_line_item_id INTEGER PRIMARY KEY,
      capability_line_item_id INTEGER
    );
  `);
  await client.query(`
    WITH ins AS (
      INSERT INTO capability_line_items (
        capability_id, line_no, item_name, spec, calc_method, payment_method,
        payment_terms, quantity, unit_price, amount_ex_tax,
        delivery_date, payment_date, cycle, billing_day, term_start, term_end,
        inspected_amount_ex_tax
      )
      SELECT
        t.capability_id, oli.line_no, oli.item_name, oli.spec, oli.calc_method,
        oli.payment_method, oli.payment_terms, oli.quantity, oli.unit_price,
        oli.amount_ex_tax, oli.delivery_date, oli.payment_date,
        oli.cycle, oli.billing_day, oli.term_start, oli.term_end,
        0
      FROM order_line_items oli
      JOIN _tmp_oi_to_cc t ON t.order_item_id = oli.order_item_id
      ON CONFLICT (capability_id, line_no) DO UPDATE SET
        item_name        = EXCLUDED.item_name,
        spec             = EXCLUDED.spec,
        calc_method      = EXCLUDED.calc_method,
        payment_method   = EXCLUDED.payment_method,
        payment_terms    = EXCLUDED.payment_terms,
        quantity         = EXCLUDED.quantity,
        unit_price       = EXCLUDED.unit_price,
        amount_ex_tax    = EXCLUDED.amount_ex_tax,
        delivery_date    = EXCLUDED.delivery_date,
        payment_date     = EXCLUDED.payment_date,
        cycle            = EXCLUDED.cycle,
        billing_day      = EXCLUDED.billing_day,
        term_start       = EXCLUDED.term_start,
        term_end         = EXCLUDED.term_end,
        updated_at       = CURRENT_TIMESTAMP
      RETURNING id, capability_id, line_no
    )
    INSERT INTO _tmp_oli_to_cli (order_line_item_id, capability_line_item_id)
    SELECT oli.id, ins.id
      FROM order_line_items oli
      JOIN _tmp_oi_to_cc t ON t.order_item_id = oli.order_item_id
      JOIN ins ON ins.capability_id = t.capability_id AND ins.line_no = oli.line_no;
  `);
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS c FROM _tmp_oli_to_cli"
  );
  console.log(`      mapped ${rows[0].c} order_line_items → capability_line_items`);
}

async function migrateOrderExpenses(client: any) {
  console.log("\n[3/8] order_expenses → capability_expenses");
  const r = await client.query(`
    INSERT INTO capability_expenses (
      capability_id, line_no, expense_name, spec, spent_date, amount_inc_tax, remarks
    )
    SELECT t.capability_id, oe.line_no, oe.expense_name, oe.spec, oe.spent_date,
           oe.amount_inc_tax, oe.remarks
      FROM order_expenses oe
      JOIN _tmp_oi_to_cc t ON t.order_item_id = oe.order_item_id
    ON CONFLICT (capability_id, line_no) DO UPDATE SET
      expense_name    = EXCLUDED.expense_name,
      spec            = EXCLUDED.spec,
      spent_date      = EXCLUDED.spent_date,
      amount_inc_tax  = EXCLUDED.amount_inc_tax,
      remarks         = EXCLUDED.remarks,
      updated_at      = CURRENT_TIMESTAMP;
  `);
  console.log(`      inserted/updated ${r.rowCount} expenses`);
}

async function migrateOrderOtherFees(client: any) {
  console.log("\n[4/8] order_other_fees → capability_other_fees");
  const r = await client.query(`
    INSERT INTO capability_other_fees (
      capability_id, line_no, fee_name, amount, remarks
    )
    SELECT t.capability_id, oof.line_no, oof.fee_name, oof.amount, oof.remarks
      FROM order_other_fees oof
      JOIN _tmp_oi_to_cc t ON t.order_item_id = oof.order_item_id
    ON CONFLICT (capability_id, line_no) DO UPDATE SET
      fee_name = EXCLUDED.fee_name,
      amount   = EXCLUDED.amount,
      remarks  = EXCLUDED.remarks,
      updated_at = CURRENT_TIMESTAMP;
  `);
  console.log(`      inserted/updated ${r.rowCount} other_fees`);
}

async function migrateLicenseContracts(client: any) {
  console.log("\n[5/8] license_contracts → contract_capabilities (license)");
  await client.query(`
    DROP TABLE IF EXISTS _tmp_lc_to_cc;
    CREATE TEMP TABLE _tmp_lc_to_cc (
      license_contract_id INTEGER PRIMARY KEY,
      capability_id INTEGER
    );
  `);
  await client.query(`
    WITH enriched AS (
      SELECT
        lc.id AS license_contract_id,
        lc.backlog_issue_key,
        COALESCE(lc.contract_number, lc.ledger_number, lc.work_id) AS document_number,
        lc.licensor_name, lc.licensee_name,
        lc.license_start_date, lc.original_work, lc.original_work_note,
        lc.product_name_predicted, lc.exclusivity, lc.supervisor,
        lc.credit_display, lc.remarks,
        CASE WHEN lc.basic_contract_name IS NULL OR lc.basic_contract_name = ''
             THEN 'standalone_contract'
             ELSE 'individual_contract' END AS rt,
        v.id AS vendor_id
      FROM license_contracts lc
      LEFT JOIN vendors v ON v.vendor_name = lc.licensor_name OR v.vendor_name = lc.licensee_name
    ),
    upsert AS (
      INSERT INTO contract_capabilities (
        vendor_id, record_type, contract_category, contract_type, contract_title,
        document_number, contract_status, source_system,
        backlog_issue_key, original_work, effective_date,
        caution_note
      )
      SELECT
        e.vendor_id,
        e.rt,
        'license',
        CASE WHEN e.rt = 'standalone_contract' THEN 'license_standalone' ELSE 'license_individual' END,
        COALESCE(NULLIF(e.product_name_predicted, ''), NULLIF(e.original_work, ''), e.document_number),
        e.document_number,
        'executed',
        'phase23-migration',
        e.backlog_issue_key,
        e.original_work,
        e.license_start_date,
        e.remarks
      FROM enriched e
      WHERE e.document_number IS NOT NULL
      ON CONFLICT (document_number) DO UPDATE SET
        record_type       = EXCLUDED.record_type,
        contract_category = 'license',
        contract_type     = EXCLUDED.contract_type,
        vendor_id         = COALESCE(EXCLUDED.vendor_id, contract_capabilities.vendor_id),
        backlog_issue_key = COALESCE(EXCLUDED.backlog_issue_key, contract_capabilities.backlog_issue_key),
        original_work     = COALESCE(EXCLUDED.original_work, contract_capabilities.original_work),
        effective_date    = COALESCE(EXCLUDED.effective_date, contract_capabilities.effective_date),
        updated_at        = CURRENT_TIMESTAMP
      RETURNING id, document_number
    )
    INSERT INTO _tmp_lc_to_cc (license_contract_id, capability_id)
    SELECT lc.id, u.id
      FROM license_contracts lc
      JOIN upsert u ON u.document_number = COALESCE(lc.contract_number, lc.ledger_number, lc.work_id);
  `);
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS c FROM _tmp_lc_to_cc"
  );
  console.log(`      mapped ${rows[0].c} license_contracts → contract_capabilities`);
}

async function migrateLicenseFinancialConditions(client: any) {
  console.log("\n[6/8] license_financial_conditions → capability_financial_conditions");
  await client.query(`
    DROP TABLE IF EXISTS _tmp_lfc_to_cfc;
    CREATE TEMP TABLE _tmp_lfc_to_cfc (
      license_financial_condition_id INTEGER PRIMARY KEY,
      capability_financial_condition_id INTEGER
    );
  `);
  await client.query(`
    WITH ins AS (
      INSERT INTO capability_financial_conditions (
        capability_id, condition_no, region_language_label, calc_method,
        rate_pct, base_price_label, calc_period, calc_period_kind, calc_period_close_month,
        currency, formula_text, payment_terms, mg_amount, ag_amount
      )
      SELECT t.capability_id, lfc.condition_no, lfc.region_language_label, lfc.calc_method,
             lfc.rate_pct, lfc.base_price_label, lfc.calc_period,
             lfc.calc_period_kind, lfc.calc_period_close_month,
             lfc.currency, lfc.formula_text, lfc.payment_terms,
             lfc.mg_amount, lfc.ag_amount
        FROM license_financial_conditions lfc
        JOIN _tmp_lc_to_cc t ON t.license_contract_id = lfc.license_contract_id
      ON CONFLICT (capability_id, condition_no) DO UPDATE SET
        calc_method            = EXCLUDED.calc_method,
        rate_pct               = EXCLUDED.rate_pct,
        base_price_label       = EXCLUDED.base_price_label,
        calc_period            = EXCLUDED.calc_period,
        calc_period_kind       = EXCLUDED.calc_period_kind,
        calc_period_close_month= EXCLUDED.calc_period_close_month,
        currency               = EXCLUDED.currency,
        formula_text           = EXCLUDED.formula_text,
        payment_terms          = EXCLUDED.payment_terms,
        mg_amount              = EXCLUDED.mg_amount,
        ag_amount              = EXCLUDED.ag_amount,
        updated_at             = CURRENT_TIMESTAMP
      RETURNING id, capability_id, condition_no
    )
    INSERT INTO _tmp_lfc_to_cfc (license_financial_condition_id, capability_financial_condition_id)
    SELECT lfc.id, ins.id
      FROM license_financial_conditions lfc
      JOIN _tmp_lc_to_cc t ON t.license_contract_id = lfc.license_contract_id
      JOIN ins ON ins.capability_id = t.capability_id AND ins.condition_no = lfc.condition_no;
  `);
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS c FROM _tmp_lfc_to_cfc"
  );
  console.log(`      mapped ${rows[0].c} license_financial_conditions → capability_financial_conditions`);
}

async function relinkDeliveryAndRoyalty(client: any) {
  console.log("\n[7/8] FK 張り替え: delivery_events / delivery_line_items / royalty_calculations");

  const d1 = await client.query(`
    UPDATE delivery_events de
       SET capability_id = t.capability_id
      FROM _tmp_oi_to_cc t
     WHERE de.order_item_id = t.order_item_id
       AND de.capability_id IS NULL;
  `);
  console.log(`      delivery_events.capability_id   updated: ${d1.rowCount}`);

  const d2 = await client.query(`
    UPDATE delivery_line_items dli
       SET capability_line_item_id = t.capability_line_item_id
      FROM _tmp_oli_to_cli t
     WHERE dli.order_line_item_id = t.order_line_item_id
       AND dli.capability_line_item_id IS NULL;
  `);
  console.log(`      delivery_line_items.capability_line_item_id updated: ${d2.rowCount}`);

  const r1 = await client.query(`
    UPDATE royalty_calculations rc
       SET capability_id = t.capability_id
      FROM _tmp_lc_to_cc t
     WHERE rc.license_contract_id = t.license_contract_id
       AND rc.capability_id IS NULL;
  `);
  console.log(`      royalty_calculations.capability_id updated: ${r1.rowCount}`);

  const r2 = await client.query(`
    UPDATE royalty_calculations rc
       SET capability_financial_condition_id = t.capability_financial_condition_id
      FROM _tmp_lfc_to_cfc t
     WHERE rc.license_financial_condition_id = t.license_financial_condition_id
       AND rc.capability_financial_condition_id IS NULL;
  `);
  console.log(`      royalty_calculations.capability_financial_condition_id updated: ${r2.rowCount}`);
}

async function backfillInspectedAmount(client: any) {
  console.log("\n[8/8] capability_line_items.inspected_amount_ex_tax を再集計");
  const r = await client.query(`
    UPDATE capability_line_items cli
       SET inspected_amount_ex_tax = COALESCE(sub.s, 0)
      FROM (
        SELECT dli.capability_line_item_id AS id,
               SUM(dli.inspected_amount_ex_tax) AS s
          FROM delivery_line_items dli
         WHERE dli.capability_line_item_id IS NOT NULL
         GROUP BY dli.capability_line_item_id
      ) sub
     WHERE cli.id = sub.id;
  `);
  console.log(`      inspected_amount backfilled rows: ${r.rowCount}`);
}

const LEGACY_TABLES = [
  "order_expenses",
  "order_other_fees",
  "order_line_items",
  "order_items",
  "license_financial_conditions",
  "license_contracts",
] as const;

const LEGACY_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "delivery_events", column: "order_item_id" },
  { table: "delivery_line_items", column: "order_line_item_id" },
  { table: "royalty_calculations", column: "license_contract_id" },
  { table: "royalty_calculations", column: "license_financial_condition_id" },
  { table: "royalty_calculations", column: "manufacturing_event_id" },
];

async function inspectDependencies(client: any) {
  console.log("\n[DROP/inspect] 旧テーブルへの依存オブジェクトを列挙");
  for (const t of LEGACY_TABLES) {
    const r = await client.query(
      `SELECT DISTINCT
         CASE c.relkind
           WHEN 'r' THEN 'table'
           WHEN 'v' THEN 'view'
           WHEN 'm' THEN 'matview'
           WHEN 'i' THEN 'index'
           WHEN 'S' THEN 'sequence'
           ELSE c.relkind::text
         END AS obj_type,
         n.nspname || '.' || c.relname AS obj_name
       FROM pg_depend d
       JOIN pg_class c ON c.oid = d.objid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE d.refobjid = to_regclass($1)
         AND d.deptype = 'n'
         AND c.relname <> $2
       ORDER BY obj_type, obj_name`,
      [t, t]
    );
    if (r.rows.length === 0) {
      console.log(`  ${t.padEnd(36)} (依存なし)`);
    } else {
      console.log(`  ${t}:`);
      for (const row of r.rows) {
        console.log(`    - ${row.obj_type.padEnd(10)} ${row.obj_name}`);
      }
    }
  }
}

async function dropLegacy(client: any) {
  if (!REALLY_DROP) {
    console.log(
      "\n[DROP] 依存関係の表示のみ実行 (実際の DROP は --really-drop を併用してください)"
    );
    await inspectDependencies(client);
    console.log(
      "\n  ⚠️  --really-drop を付けて再実行すると DROP TABLE ... CASCADE が走り、上記の依存オブジェクトが破壊されます。"
    );
    return;
  }

  console.log(
    "\n[DROP] --really-drop 指定あり: 旧テーブル / 旧カラムを物理削除します"
  );
  await inspectDependencies(client);
  console.log("\n  ⚠️  CASCADE 削除を実行します...");

  // 旧 FK 列を先に DROP（テーブル参照されているため）
  for (const { table, column } of LEGACY_COLUMNS) {
    await client.query(
      `ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column};`
    );
  }

  // 旧テーブル DROP
  for (const t of LEGACY_TABLES) {
    await client.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
  }
  // manufacturing_events / royalty_payments も license_contracts 依存だったので確認
  // ※ manufacturing_events は royalty_calculations から参照されていたので一旦残す
  //   royalty_payments も同様。新スキーマに移行する場合は別途対応。
  console.log("      legacy tables dropped");
}

async function main() {
  const mode = APPLY ? "APPLY" : "DRY-RUN";
  const dropPart = DROP
    ? REALLY_DROP
      ? "+ DROP (REALLY)"
      : "+ DROP (inspect-only)"
    : "";
  console.log(`Phase 23 migration: ${mode} ${dropPart}`);
  if (REALLY_DROP && !DROP) {
    console.log(
      "  ℹ️  --really-drop は --drop と併用してください (単独では何もしません)"
    );
  }

  const before = await countAll();
  printCounts("BEFORE", before);

  if (!APPLY) {
    console.log("\n(dry-run 終了。実際の移行は --apply を付けて再実行)");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await migrateOrderItems(client);
    await migrateOrderLineItems(client);
    await migrateOrderExpenses(client);
    await migrateOrderOtherFees(client);
    await migrateLicenseContracts(client);
    await migrateLicenseFinancialConditions(client);
    await relinkDeliveryAndRoyalty(client);
    await backfillInspectedAmount(client);
    if (DROP) await dropLegacy(client);
    await client.query("COMMIT");
    console.log("\n✅ COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("\n❌ ROLLBACK", e);
    process.exitCode = 1;
  } finally {
    client.release();
  }

  const after = await countAll();
  printCounts("AFTER", after);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
