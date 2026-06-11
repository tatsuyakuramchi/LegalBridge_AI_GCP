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
      `SELECT id, effective_date, expiration_date FROM contract_capabilities WHERE id = $1`,
      [capabilityId]
    )
  ).rows[0];
  if (!cap) return 0;

  const liRows = await db.query(
    `SELECT li.* FROM capability_line_items li
      WHERE li.capability_id = $1
        AND NOT EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.source_line_item_id = li.id)
      ORDER BY li.line_no`,
    [capabilityId]
  );
  for (const li of liRows.rows) {
    const lineNo = await nextLineNo(db, capabilityId);
    const code = `CL-${year}-${String(await nextSeq(db, "condition_line", year)).padStart(5, "0")}`;
    const row = mapLineItemToConditionLine(li, capabilityId, lineNo, code);
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
    const lineNo = await nextLineNo(db, capabilityId);
    const code = `CL-${year}-${String(await nextSeq(db, "condition_line", year)).padStart(5, "0")}`;
    const row = mapFinancialConditionToConditionLine(
      fc,
      { effective_date: cap.effective_date, expiration_date: cap.expiration_date },
      capabilityId,
      lineNo,
      code
    );
    await db.query(INSERT_CL, conditionLineInsertValues(row));
    added++;
  }
  return added;
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
          occurred_at, amount_ex_tax, source_delivery_line_item_id)
       VALUES ($1,$2,'inspection',$3,$4,$5,$6,$7)`,
      [
        row.condition_line_id,
        eventNo,
        doc.rows[0].id,
        row.backlog_issue_key,
        row.delivered_at || row.de_created,
        Number(row.inspected_amount_ex_tax) || 0,
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
            rc.actual_royalty_ex_tax, rc.period, rc.backlog_issue_key, rc.created_at,
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
        occurred_at, period, amount_ex_tax, source_royalty_calculation_id)
     VALUES ($1,$2,'royalty_calc',$3,$4,$5,$6,$7,$8)`,
    [
      row.condition_line_id,
      eventNo,
      doc.rows[0].id,
      row.backlog_issue_key,
      row.created_at,
      row.period,
      Number(row.actual_royalty_ex_tax) || 0,
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
