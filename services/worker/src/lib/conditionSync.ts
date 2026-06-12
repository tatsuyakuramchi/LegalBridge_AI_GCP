/**
 * データ構造刷新 Phase C-5 — 新スキーマへの二重書き込み (runtime, 冪等・非致命)。
 *
 * 既存の保存パス (検収明細・ロイヤリティ計算・契約登録) から呼び出し、旧テーブルと
 * 同一トランザクション内で condition_lines / condition_events にも整合した行を書く。
 *
 * 設計上の最優先事項は「既存機能を壊さないこと」。そのため:
 *   - すべて冪等 (source_* / event の存在チェックで二重挿入しない)。
 *   - condition_lines が未バックフィルの環境では event 書き込みを skip
 *     (condition_line が無ければ何もしない)。
 *   - 呼び出し側は safeSync() で包み、失敗しても保存処理本体を止めない。
 *
 * 変換ルールは conditionLineMapper.ts に集約 (C-2 バックフィルと完全共用)。
 */

import {
  mapLineItemToConditionLine,
  mapFinancialConditionToConditionLine,
  conditionLineInsertValues,
  CONDITION_LINE_COLUMNS,
} from "./conditionLineMapper.js";

// pool / client のどちらでも受ける最小インターフェース。
export interface Db {
  query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

const INSERT_CL = `INSERT INTO condition_lines (${CONDITION_LINE_COLUMNS.join(
  ", "
)}) VALUES (${CONDITION_LINE_COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})`;

async function nextSeq(db: Db, kind: string, year: number): Promise<number> {
  const r = await db.query(
    `INSERT INTO document_sequences (kind, year, current_value) VALUES ($1, $2, 1)
       ON CONFLICT (kind, year) DO UPDATE SET current_value = document_sequences.current_value + 1
     RETURNING current_value`,
    [kind, year]
  );
  return Number(r.rows[0].current_value);
}

async function nextLineNo(db: Db, capabilityId: number): Promise<number> {
  const r = await db.query(
    `SELECT COALESCE(MAX(line_no),0) AS m FROM condition_lines WHERE capability_id = $1`,
    [capabilityId]
  );
  return Number(r.rows[0].m) + 1;
}

async function nextEventNo(db: Db, lineId: number): Promise<number> {
  const r = await db.query(
    `SELECT COALESCE(MAX(event_no),0) AS m FROM condition_events WHERE condition_line_id = $1`,
    [lineId]
  );
  return Number(r.rows[0].m) + 1;
}

/**
 * 指定 capability の capability_line_items / capability_financial_conditions を
 * condition_lines に同期 (未移行分のみ)。新規契約登録の直後に呼ぶ。
 * 戻り値 = 追加した condition_lines 件数。
 */
export async function syncConditionLinesForCapability(
  db: Db,
  capabilityId: number
): Promise<number> {
  const year = new Date().getFullYear();
  let added = 0;

  const cap = (
    await db.query(
      `SELECT id, record_type, structural_role, contract_category, contract_type,
              contract_title, vendor_id, effective_date, expiration_date,
              template_family, backlog_issue_key
         FROM contract_capabilities WHERE id = $1`,
      [capabilityId]
    )
  ).rows[0];
  if (!cap) return 0;

  // A案: master 直付けの明細は暗黙 terms 契約に切り出して付ける
  //   (master は枠組みのみ・条件明細を持たない原則。C-2 バックフィルと同じ挙動)。
  const targetId = await resolveTermsCapability(db, cap);

  const liRows = await db.query(
    `SELECT li.* FROM capability_line_items li
      WHERE li.capability_id = $1
        AND NOT EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.source_line_item_id = li.id)
      ORDER BY li.line_no`,
    [capabilityId]
  );
  for (const li of liRows.rows) {
    const lineNo = await nextLineNo(db, targetId);
    const code = `CL-${year}-${String(await nextSeq(db, "condition_line", year)).padStart(5, "0")}`;
    const row = mapLineItemToConditionLine(li, targetId, lineNo, code);
    await db.query(INSERT_CL, conditionLineInsertValues(row));
    added++;
  }

  const fcRows = await db.query(
    `SELECT fc.* FROM capability_financial_conditions fc
      WHERE fc.capability_id = $1
        AND NOT EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.source_condition_id = fc.id)
      ORDER BY fc.condition_no`,
    [capabilityId]
  );
  for (const fc of fcRows.rows) {
    const lineNo = await nextLineNo(db, targetId);
    const code = `CL-${year}-${String(await nextSeq(db, "condition_line", year)).padStart(5, "0")}`;
    const row = mapFinancialConditionToConditionLine(
      fc,
      { effective_date: cap.effective_date, expiration_date: cap.expiration_date },
      targetId,
      lineNo,
      code
    );
    await db.query(INSERT_CL, conditionLineInsertValues(row));
    added++;
  }

  // 2c-1: 既存 condition_lines のメタを旧 line item から再同期(変更の追従)。
  //   status_flags(検収書発行済 等)・紐付け編集・方向が source 側で変わっても
  //   新台帳へ反映する。新台帳が旧の忠実なスーパーセットであり続けるため。
  await db.query(
    `UPDATE condition_lines cl
        SET source_ip_id       = cli.source_ip_id,
            master_contract_id = cli.master_contract_id,
            ringi_id           = cli.ringi_id,
            status_flags       = COALESCE(cli.status_flags, '{}'::jsonb),
            is_inbound         = COALESCE(cli.is_inbound, FALSE),
            flow_direction     = cli.flow_direction,
            updated_at         = CURRENT_TIMESTAMP
       FROM capability_line_items cli
      WHERE cl.source_line_item_id = cli.id
        AND cli.capability_id = $1`,
    [capabilityId]
  );
  return added;
}

const IMPLICIT_PREFIX = "（基本契約内条件）";

/**
 * A案: structural_role='master'(or record_type='master_contract') の契約に
 * 条件明細を付ける場合、暗黙の terms 契約を 1 件生成 (or 再利用) して返す。
 * terms / その他はそのまま自身を返す。C-2 バックフィルの resolveTargetCapability と同等。
 */
async function resolveTermsCapability(db: Db, cap: any): Promise<number> {
  const role =
    cap.structural_role ||
    (cap.record_type === "master_contract" ? "master" : "terms");
  if (role !== "master") return cap.id;

  const existing = await db.query(
    `SELECT id FROM contract_capabilities
      WHERE parent_capability_id = $1 AND contract_title LIKE $2
      ORDER BY id LIMIT 1`,
    [cap.id, IMPLICIT_PREFIX + "%"]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const ins = await db.query(
    `INSERT INTO contract_capabilities
       (record_type, contract_category, contract_type, contract_title,
        vendor_id, effective_date, expiration_date,
        structural_role, parent_capability_id, template_family, backlog_issue_key)
     VALUES ('standalone_contract', $1, $2, $3, $4, $5, $6, 'terms', $7, $8, $9)
     RETURNING id`,
    [
      cap.contract_category,
      cap.contract_type,
      IMPLICIT_PREFIX + (cap.contract_title || ""),
      cap.vendor_id,
      cap.effective_date,
      cap.expiration_date,
      cap.id,
      cap.template_family,
      cap.backlog_issue_key,
    ]
  );
  const newId = ins.rows[0].id;
  await db.query(
    `INSERT INTO contract_scopes (capability_id, scope)
       SELECT $1, scope FROM contract_scopes WHERE capability_id = $2
     ON CONFLICT (capability_id, scope) DO NOTHING`,
    [newId, cap.id]
  );
  return newId;
}

/**
 * delivery_event 配下の検収明細を condition_events(inspection) に同期。
 * condition_line 未解決 / 検収書 document 未解決の行は skip (CHECK を満たせないため)。
 * 戻り値 = 追加した event 件数。
 */
export async function syncInspectionEventsForDelivery(
  db: Db,
  deliveryEventId: number
): Promise<number> {
  let added = 0;
  const rows = await db.query(
    `SELECT dli.id, dli.capability_line_item_id, dli.inspected_amount_ex_tax,
            dli.inspected_quantity, dli.acceptance_ratio,
            de.delivered_at, de.created_at AS de_created, de.backlog_issue_key,
            cl.id AS condition_line_id
       FROM delivery_line_items dli
       JOIN delivery_events de ON de.id = dli.delivery_event_id
       LEFT JOIN condition_lines cl ON cl.source_line_item_id = dli.capability_line_item_id
      WHERE dli.delivery_event_id = $1
        AND NOT EXISTS (SELECT 1 FROM condition_events e WHERE e.source_delivery_line_item_id = dli.id)`,
    [deliveryEventId]
  );
  for (const row of rows.rows) {
    if (!row.condition_line_id) continue; // 未バックフィル → skip
    const doc = await db.query(
      `SELECT id FROM documents
        WHERE template_type IN ('inspection_certificate','delivery_inspec')
          AND form_data->>'delivery_event_id' = $1::text
          AND COALESCE(lifecycle_status,'final') = 'final'
        ORDER BY created_at DESC LIMIT 1`,
      [deliveryEventId]
    );
    if (!doc.rows.length) continue; // 文書未解決 → skip (CHECK 回避)
    const eventNo = await nextEventNo(db, row.condition_line_id);
    await db.query(
      `INSERT INTO condition_events
         (condition_line_id, event_no, event_type, document_id, backlog_issue_key,
          occurred_at, amount_ex_tax, inspected_quantity, acceptance_ratio,
          source_delivery_line_item_id)
       VALUES ($1,$2,'inspection',$3,$4,$5,$6,$7,$8,$9)`,
      [
        row.condition_line_id,
        eventNo,
        doc.rows[0].id,
        row.backlog_issue_key,
        row.delivered_at || row.de_created,
        Number(row.inspected_amount_ex_tax) || 0,
        row.inspected_quantity ?? null,
        row.acceptance_ratio ?? null,
        row.id,
      ]
    );
    // detail に逆 FK
    await db.query(
      `UPDATE delivery_line_items SET condition_line_id = $1,
         condition_event_id = (SELECT id FROM condition_events WHERE source_delivery_line_item_id = $2)
       WHERE id = $2`,
      [row.condition_line_id, row.id]
    );
    added++;
  }
  return added;
}

/**
 * royalty_calculations 1 件を condition_events(royalty_calc) に同期。
 * condition_line / 計算書 document が未解決なら skip。
 */
export async function syncRoyaltyCalcEvent(
  db: Db,
  royaltyCalculationId: number
): Promise<number> {
  const rcRes = await db.query(
    `SELECT rc.id, rc.capability_financial_condition_id, rc.manufacturing_event_id,
            rc.actual_royalty_ex_tax, rc.mg_consumed_this_time, rc.ag_consumed_this_time,
            rc.period, rc.backlog_issue_key, rc.created_at,
            cl.id AS condition_line_id
       FROM royalty_calculations rc
       LEFT JOIN condition_lines cl ON cl.source_condition_id = rc.capability_financial_condition_id
      WHERE rc.id = $1
        AND NOT EXISTS (SELECT 1 FROM condition_events e WHERE e.source_royalty_calculation_id = rc.id)`,
    [royaltyCalculationId]
  );
  if (!rcRes.rows.length) return 0;
  const row = rcRes.rows[0];
  if (!row.condition_line_id) return 0;
  const doc = await db.query(
    `SELECT id FROM documents
      WHERE template_type IN ('royalty_statement','利用許諾料計算書')
        AND issue_key = $1
        AND COALESCE(lifecycle_status,'final') = 'final'
        AND ((form_data->>'capabilityFinancialConditionId') = $2::text
             OR (form_data->>'manufacturingEventId') = $3::text)
      ORDER BY created_at DESC LIMIT 1`,
    [row.backlog_issue_key, row.capability_financial_condition_id, row.manufacturing_event_id]
  );
  if (!doc.rows.length) return 0;
  const eventNo = await nextEventNo(db, row.condition_line_id);
  await db.query(
    `INSERT INTO condition_events
       (condition_line_id, event_no, event_type, document_id, backlog_issue_key,
        occurred_at, period, amount_ex_tax, manufacturing_event_id,
        mg_consumed_this_time, ag_consumed_this_time, source_royalty_calculation_id)
     VALUES ($1,$2,'royalty_calc',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      row.condition_line_id,
      eventNo,
      doc.rows[0].id,
      row.backlog_issue_key,
      row.created_at,
      row.period,
      Number(row.actual_royalty_ex_tax) || 0,
      row.manufacturing_event_id ?? null,
      row.mg_consumed_this_time ?? null,
      row.ag_consumed_this_time ?? null,
      row.id,
    ]
  );
  await db.query(
    `UPDATE royalty_calculations SET condition_line_id = $1,
       condition_event_id = (SELECT id FROM condition_events WHERE source_royalty_calculation_id = $2)
     WHERE id = $2`,
    [row.condition_line_id, row.id]
  );
  return 1;
}

/**
 * 二重書き込みは「あれば良い」副作用。失敗しても本体処理を止めないラッパ。
 */
export async function safeSync(
  label: string,
  fn: () => Promise<number>
): Promise<void> {
  try {
    const n = await fn();
    if (n > 0) console.log(`[conditionSync] ${label}: +${n}`);
  } catch (e) {
    console.error(`[conditionSync] ${label} skipped (non-fatal):`, e);
  }
}
