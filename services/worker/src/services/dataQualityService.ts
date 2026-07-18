/**
 * dataQualityService — データ完全性 評価エンジン(設計 v1.4 DQ-02, §8.4/§8.6)。
 *
 * DQ-01(migration 0136)で作った data_quality_rules / data_quality_issues /
 * entity_completeness_summary を使い、実スキーマ(works / work_materials /
 * condition_lines)に対して完全性ルールを評価する。
 *
 * 設計:
 *   - ルールごとに「失敗しているエンティティ id を返す SQL(failingSql)」を持つ評価器を登録。
 *   - 評価 = 失敗集合を issue へ upsert(open) / 失敗しなくなったものを auto-close(resolved)。
 *     status='waived' は尊重して再オープンしない(§8.5 の例外運用)。
 *   - 評価後に entity_completeness_summary を集計(blocker/error/warning 件数 + score + 分類別 status)。
 *   - 評価器が未登録のルール(work_relations 等 未実装テーブル依存)はスキップ(台帳には残す)。
 *   - db.query のみに依存(単体テスト・ローカル Postgres で検証可能)。
 */

export interface DqDb {
  query: (text: string, params?: any[]) => Promise<any>;
}

/** ルール評価器: failingSql は対象テーブルの「違反行の id」を返す。 */
type Evaluator = { ruleCode: string; failingSql: string };

// 実スキーマに対応する評価器のみ登録。未実装(work_relations / material_rights_sources /
//   fee_subject_snapshot 等)のルールは台帳にあってもここには無く、評価対象外(skip)。
const EVALUATORS: Evaluator[] = [
  // WORK-ID-001 (work / BLOCKER): タイトル・種別がある。
  {
    ruleCode: "WORK-ID-001",
    failingSql: `SELECT id FROM works
                 WHERE title IS NULL OR btrim(title) = ''
                    OR work_type IS NULL OR btrim(work_type) = ''`,
  },
  // WORK-REL-001 (work / ERROR): 派生作品(is_original=false)は派生元と派生種別がある。
  {
    ruleCode: "WORK-REL-001",
    failingSql: `SELECT id FROM works
                 WHERE is_original = false
                   AND (parent_work_id IS NULL OR derivation_type IS NULL OR btrim(derivation_type) = '')`,
  },
  // WORK-MAT-001 (work / ERROR): 制作・公開作品は使用マテリアルが1件以上ある。
  {
    ruleCode: "WORK-MAT-001",
    failingSql: `SELECT w.id FROM works w
                 WHERE w.status IN ('in_production','released')
                   AND NOT EXISTS (SELECT 1 FROM work_materials m WHERE m.work_id = w.id)`,
  },
  // MAT-ID-001 (material / ERROR): マテリアルは名称・種別がある。
  {
    ruleCode: "MAT-ID-001",
    failingSql: `SELECT id FROM work_materials
                 WHERE material_name IS NULL OR btrim(material_name) = ''
                    OR material_type IS NULL OR btrim(material_type) = ''`,
  },
  // MAT-RGT-002 (material / ERROR): 外部権利マテリアル(rights_type<>'owned')は権利者がある。
  {
    ruleCode: "MAT-RGT-002",
    failingSql: `SELECT id FROM work_materials
                 WHERE COALESCE(rights_type, '') <> 'owned'
                   AND rights_holder_vendor_id IS NULL
                   AND (rights_holder_label IS NULL OR btrim(rights_holder_label) = '')`,
  },
  // COND-FIN-001 (condition / BLOCKER): royalty-bearing 条件は料率・計算基礎・通貨がある。
  {
    ruleCode: "COND-FIN-001",
    failingSql: `SELECT id FROM condition_lines
                 WHERE (payment_scheme = 'royalty' OR rate_pct IS NOT NULL)
                   AND (rate_pct IS NULL
                        OR base_price_label IS NULL OR btrim(base_price_label) = ''
                        OR currency IS NULL OR btrim(currency) = '')`,
  },
];

/** 登録済みルール(評価器がある & is_active)を1件評価: open upsert + auto-close。 */
async function evaluateOne(db: DqDb, ev: Evaluator): Promise<{ ruleCode: string; failing: number }> {
  // open へ upsert(waived は尊重して触らない)。severity/entity_type はルール台帳が単一ソース。
  await db.query(
    `INSERT INTO data_quality_issues (entity_type, entity_id, rule_code, severity)
       SELECT r.entity_type, f.id, r.rule_code, r.severity
         FROM data_quality_rules r
         JOIN (${ev.failingSql}) f ON true
        WHERE r.rule_code = $1 AND r.is_active
     ON CONFLICT (entity_type, entity_id, rule_code) DO UPDATE
       SET status = 'open', last_detected_at = now(), resolved_at = NULL,
           resolution_type = NULL, severity = EXCLUDED.severity
       WHERE data_quality_issues.status <> 'waived'`,
    [ev.ruleCode]
  );
  // 失敗しなくなった open issue を auto-close。
  await db.query(
    `UPDATE data_quality_issues i
        SET status = 'resolved', resolved_at = now(), resolution_type = 'fixed'
      WHERE i.rule_code = $1 AND i.status = 'open'
        AND NOT EXISTS (SELECT 1 FROM (${ev.failingSql}) f WHERE f.id = i.entity_id)`,
    [ev.ruleCode]
  );
  const r = await db.query(`SELECT count(*)::int AS n FROM (${ev.failingSql}) f`);
  return { ruleCode: ev.ruleCode, failing: r.rows?.[0]?.n ?? 0 };
}

/** ルール台帳のうち評価器を持ち is_active なものだけ評価。 */
export async function evaluateAll(db: DqDb): Promise<{ evaluated: number; results: Array<{ ruleCode: string; failing: number }> }> {
  const active = await db.query(`SELECT rule_code FROM data_quality_rules WHERE is_active`);
  const activeSet = new Set<string>((active.rows || []).map((r: any) => r.rule_code));
  const results: Array<{ ruleCode: string; failing: number }> = [];
  for (const ev of EVALUATORS) {
    if (!activeSet.has(ev.ruleCode)) continue;
    results.push(await evaluateOne(db, ev));
  }
  return { evaluated: results.length, results };
}

// entity_completeness_summary 再計算に使う: rule_code → 完全性カテゴリの分類。
const CATEGORY_CASE = `CASE
    WHEN rule_code IN ('WORK-ID-001','MAT-ID-001') THEN 'identity'
    WHEN rule_code LIKE 'WORK-REL%' OR rule_code LIKE 'WORK-FAM%' OR rule_code = 'WORK-MAT-001' THEN 'relationship'
    WHEN rule_code IN ('MAT-DOC-001','COND-ROUTE-001','COND-SCOPE-001','WORK-MAT-002','WORK-MAT-003') THEN 'contract'
    WHEN rule_code IN ('COND-FIN-001','COND-RGT-001','MAT-FEE-001','MAT-FEE-002','MAT-RGT-001','MAT-RGT-002','MAT-RGT-003','WORK-OUT-001') THEN 'financial'
    WHEN rule_code = 'WORK-EVD-001' THEN 'evidence'
    ELSE 'identity'
  END`;

// ランク(0-3) → status 文字列を SQL 内でインライン展開(runtime DDL を避け、worker 実行ロールの
//   CREATE 権限に依存しない)。
const rankToStatus = (expr: string) =>
  `CASE ${expr} WHEN 3 THEN 'blocker' WHEN 2 THEN 'error' WHEN 1 THEN 'warning' ELSE 'ok' END`;

/** 指定 entity_type(work/material/condition)の全エンティティのサマリーを再計算。 */
async function recomputeSummaryFor(db: DqDb, entityType: string, baseTable: string): Promise<void> {
  // 分類別に「開いている issue の最悪 severity ランク」を出し、status 文字列へ写す。
  await db.query(
    `INSERT INTO entity_completeness_summary
       (entity_type, entity_id, identity_status, relationship_status, contract_status,
        financial_status, evidence_status, blocker_count, error_count, warning_count, score, evaluated_at)
     SELECT $1, e.id,
       ${rankToStatus("COALESCE(a.identity_rank, 0)")},
       ${rankToStatus("COALESCE(a.relationship_rank, 0)")},
       ${rankToStatus("COALESCE(a.contract_rank, 0)")},
       ${rankToStatus("COALESCE(a.financial_rank, 0)")},
       ${rankToStatus("COALESCE(a.evidence_rank, 0)")},
       COALESCE(a.blocker, 0), COALESCE(a.error, 0), COALESCE(a.warning, 0),
       GREATEST(0, 100 - COALESCE(a.blocker,0)*40 - COALESCE(a.error,0)*15 - COALESCE(a.warning,0)*5),
       now()
     FROM ${baseTable} e
     LEFT JOIN (
       SELECT entity_id,
         count(*) FILTER (WHERE severity='BLOCKER') AS blocker,
         count(*) FILTER (WHERE severity='ERROR')   AS error,
         count(*) FILTER (WHERE severity='WARNING') AS warning,
         max(sevrank) FILTER (WHERE cat='identity')     AS identity_rank,
         max(sevrank) FILTER (WHERE cat='relationship') AS relationship_rank,
         max(sevrank) FILTER (WHERE cat='contract')     AS contract_rank,
         max(sevrank) FILTER (WHERE cat='financial')    AS financial_rank,
         max(sevrank) FILTER (WHERE cat='evidence')     AS evidence_rank
       FROM (
         SELECT entity_id, severity, ${CATEGORY_CASE} AS cat,
           CASE severity WHEN 'BLOCKER' THEN 3 WHEN 'ERROR' THEN 2 WHEN 'WARNING' THEN 1 ELSE 0 END AS sevrank
         FROM data_quality_issues WHERE entity_type = $1 AND status = 'open'
       ) x GROUP BY entity_id
     ) a ON a.entity_id = e.id
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET
       identity_status     = EXCLUDED.identity_status,
       relationship_status = EXCLUDED.relationship_status,
       contract_status     = EXCLUDED.contract_status,
       financial_status    = EXCLUDED.financial_status,
       evidence_status     = EXCLUDED.evidence_status,
       blocker_count       = EXCLUDED.blocker_count,
       error_count         = EXCLUDED.error_count,
       warning_count       = EXCLUDED.warning_count,
       score               = EXCLUDED.score,
       evaluated_at        = now()`,
    [entityType]
  );
}

/** 全エンティティ型のサマリーを再計算。 */
export async function recomputeSummaries(db: DqDb): Promise<void> {
  await recomputeSummaryFor(db, "work", "works");
  await recomputeSummaryFor(db, "material", "work_materials");
  await recomputeSummaryFor(db, "condition", "condition_lines");
}

/** 全件再スキャン: 評価 → サマリー再計算。 */
export async function rescan(db: DqDb): Promise<{ evaluated: number; results: Array<{ ruleCode: string; failing: number }> }> {
  const r = await evaluateAll(db);
  await recomputeSummaries(db);
  return r;
}
