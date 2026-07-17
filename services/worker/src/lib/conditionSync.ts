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

// pool / client のどちらでも受ける最小インターフェース。
export interface Db {
  query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
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
  _db: Db,
  _capabilityId: number
): Promise<number> {
  // スキーマ単純化(0089): capability_financial_conditions / capability_line_items は
  //   condition_lines 上の互換ビュー(INSTEAD OF トリガ)になった。書き込みは既に
  //   condition_lines へ直接着地しているため、ミラー同期は不要（循環/二重化を避ける）。
  //   G3b: 到達不能だった旧ミラー実装(capability_* からの読取り)は削除済み。
  return 0;
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
       -- 0101 以降 cli は condition_lines の VIEW(cli.id = cl.id)。dli.capability_line_item_id は
       --   cli(=CL) の id を指すため、旧 source_line_item_id 自己間接(文書経路で常にNULL=0件)を
       --   自己 id 一致へ是正。これで検収明細→condition_events(inspection) が生成される(S3)。
       LEFT JOIN condition_lines cl ON cl.id = dli.capability_line_item_id
      WHERE dli.delivery_event_id = $1
        AND NOT EXISTS (SELECT 1 FROM condition_events e WHERE e.source_delivery_line_item_id = dli.id)`,
    [deliveryEventId]
  );
  for (const row of rows.rows) {
    if (!row.condition_line_id) continue; // 未バックフィル → skip
    // 検収書 document の解決。手動/取込の検収書(ARC-*)は form_data に
    //   delivery_event_id を持たないため、精密一致(delivery_event_id) だけでは
    //   解決できず保留になっていた(これがステータス未更新の主因)。
    //   フォールバックとして delivery_event の課題(backlog_issue_key)で検収書を
    //   解決し、誤リンク回避のため「ちょうど1件」のときだけ採用する(C-3 相当)。
    let doc = await db.query(
      `SELECT id FROM documents
        WHERE template_type IN ('inspection_certificate','delivery_inspec')
          AND form_data->>'delivery_event_id' = $1::text
          AND COALESCE(lifecycle_status,'final') = 'final'
        ORDER BY created_at DESC LIMIT 1`,
      [deliveryEventId]
    );
    if (!doc.rows.length && row.backlog_issue_key) {
      const byIssue = await db.query(
        `SELECT id FROM documents
          WHERE template_type IN ('inspection_certificate','delivery_inspec')
            AND issue_key = $1
            AND COALESCE(lifecycle_status,'final') = 'final'`,
        [row.backlog_issue_key]
      );
      if (byIssue.rows.length === 1) doc = byIssue;
    }
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
 * capability_line_items を削除/間引いた際に、ミラーした condition_lines も
 * 連動して削除する(旧来は syncConditionLinesForCapability が追加のみで、
 * 明細削除時に condition_lines が孤児化し横断検索に未了行として残っていた)。
 *
 * ただし検収/計算イベント(condition_events)や成果物紐付け(work_component_lines)
 * を持つ行は履歴保全のため残す。capability_line_item が消えても、これらの
 * condition_line と実績は Cockpit/監査に残る(横断検索は明細(cli)が背骨のため
 * 表示はされなくなる)。condition_line_installments は ON DELETE CASCADE。
 *
 * @param removedLineItemIds 削除した capability_line_items.id の配列
 * @returns 連動削除した condition_lines 件数
 */
export async function pruneOrphanConditionLines(
  db: Db,
  removedLineItemIds: number[]
): Promise<number> {
  const ids = (removedLineItemIds || []).filter((n) => Number.isFinite(n));
  if (ids.length === 0) return 0;
  const orphan = await db.query(
    `SELECT cl.id FROM condition_lines cl
      WHERE cl.source_line_item_id = ANY($1::int[])
        AND NOT EXISTS (SELECT 1 FROM condition_events e WHERE e.condition_line_id = cl.id)
        AND NOT EXISTS (SELECT 1 FROM work_component_lines wcl WHERE wcl.condition_line_id = cl.id)`,
    [ids]
  );
  const orphanIds = orphan.rows
    .map((r: any) => Number(r.id))
    .filter((n: number) => Number.isFinite(n));
  if (orphanIds.length === 0) return 0;
  await db.query(`DELETE FROM condition_lines WHERE id = ANY($1::int[])`, [orphanIds]);
  return orphanIds.length;
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
