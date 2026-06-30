/**
 * Phase 2 — 新モデルの保存プリミティブ（documents 統合 ＋ CL 直接書き込み）。
 *
 * Master(契約マスタ)・文書・発注・v3 の保存パスが共用する。旧 contract_capabilities への
 * INSERT ＋ upsertCapabilityFinancialConditions ＋ linkWorkMaterialsForCapability を置き換える。
 *
 * 設計: docs/design/schema-simplification-plan.md（Phase 2）
 *   ② 文書と Master を統合 → documents を upsert
 *   ① 条件は CL に一本化 → upsertDocumentConditions（material_code で原作へ結線）
 *
 * db.query のみに依存（server.ts 非依存＝単体テスト可能）。
 */
import {
  upsertDocumentConditions,
  type CondDb,
  type ConditionInput,
} from "./conditionWrite.ts";

export interface FinancialConditionLike {
  condition_no?: any;
  condition_name?: any;
  calc_method?: any;
  calc_type?: any;
  rate_pct?: any;
  base_price_label?: any;
  mg_amount?: any;
  ag_amount?: any;
  guarantee_type?: any;
  currency?: any;
  region_territory?: any;
  region_language?: any;
  applies_scope?: any;
  formula_text?: any;
  payment_terms?: any;
  fixed_kind?: any;
  subscription_cycle?: any;
  unit_amount?: any;
  // 材料指定（行ごと）。無ければ default(素材番号 / 本体)へ。
  material_code?: any;
  // v3 取引形態ヘッダ
  group_no?: any;
  is_addon?: any;
  manufacturer?: any;
  seller?: any;
  max_region?: any;
  max_language?: any;
}

export interface MasterContractInput {
  document_number: string;
  record_type?: string | null;
  contract_category?: string | null;
  contract_type?: string | null;
  contract_title?: string | null;
  contract_status?: string | null;
  vendor_id?: number | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  flow_direction?: string | null;       // in/out（文書既定）
  deliverable_ownership?: string | null;
  backlog_issue_key?: string | null;
  ledger_code?: string | null;          // 原作（licensed_in works.work_code）
  template_type?: string | null;
  issue_key?: string | null;
  // 材料の既定（軸マテリアル）。行で未指定の条件をここへ束ねる。空なら本体(is_default)。
  default_material_code?: string | null;
  // 行ごとの材料上書き（condition_no → material_code）
  condition_material_codes?: Record<string, string>;
  // 利用許諾/金銭条件（→CL）
  financial_conditions?: FinancialConditionLike[];
}

const s = (v: any): string | null =>
  v == null || String(v).trim() === "" ? null : String(v);

/** flow_direction(in/out) → CL.direction(payable/receivable)。out=収益受取=receivable。 */
function dirFromFlow(flow: string | null | undefined): string {
  return String(flow || "").toLowerCase() === "out" ? "receivable" : "payable";
}

/** financial_condition → ConditionInput（CL入力）へ変換。 */
function toConditionInput(
  fc: FinancialConditionLike,
  idx: number,
  defaults: { direction: string; materialCode: string | null; overrides: Record<string, string> }
): ConditionInput {
  const condNo = Number(fc.condition_no ?? idx + 1);
  const explicit = s(fc.material_code) || s(defaults.overrides[String(condNo)]);
  return {
    line_no: condNo,
    group_no: fc.group_no != null && fc.group_no !== "" ? Number(fc.group_no) : null,
    material_code: explicit || defaults.materialCode,
    direction: defaults.direction,
    transaction_kind: "license",
    payment_scheme: undefined, // 導出（料率→royalty / 他→lump_sum）。calc_type=FIXED 等は別途。
    rate_pct: fc.rate_pct,
    mg_amount: fc.mg_amount,
    ag_amount: fc.ag_amount,
    currency: s(fc.currency) || "JPY",
    base_price_label: s(fc.base_price_label),
    calc_type: s(fc.calc_type),
    fixed_kind: s(fc.fixed_kind),
    subscription_cycle: s(fc.subscription_cycle),
    unit_amount: fc.unit_amount,
    guarantee_type: s(fc.guarantee_type),
    region_territory: s(fc.region_territory),
    region_language: s(fc.region_language),
    applies_scope: s(fc.applies_scope),
    formula_text: s(fc.formula_text),
    payment_terms: s(fc.payment_terms),
    condition_name: s(fc.condition_name),
    is_addon: !!fc.is_addon,
    manufacturer: s(fc.manufacturer),
    seller: s(fc.seller),
    max_region: s(fc.max_region),
    max_language: s(fc.max_language),
  };
}

/**
 * Master(契約マスタ)を新モデルで保存する: documents を upsert ＋ 金銭条件を CL へ。
 *   - documents は document_number で upsert（②統合。contract_capabilities 廃止）。
 *   - 各 financial_condition を CL へ（①一本化）。材料は行指定→既定→原作本体(is_default)。
 *     → CL に source_material_id/source_work_id が必ず付き、原作ビューに出る（症状解消）。
 * @returns documentId
 */
export async function upsertMasterContract(
  db: CondDb,
  input: MasterContractInput
): Promise<{ documentId: number; conditionLineIds: number[] }> {
  const ledger = s(input.ledger_code);

  // 原作(licensed_in) と本体マテリアル(is_default) を解決（材料の既定アンカー）。
  let origWorkId: number | null = null;
  let anchorMaterialCode: string | null = s(input.default_material_code);
  if (ledger) {
    const w = await db.query(
      `SELECT id FROM works WHERE work_code = $1 AND kind = 'licensed_in' LIMIT 1`,
      [ledger]
    );
    origWorkId = w.rows[0]?.id ? Number(w.rows[0].id) : null;
    if (origWorkId && !anchorMaterialCode) {
      const dm = await db.query(
        `SELECT material_code FROM work_materials
          WHERE work_id = $1 AND is_default = TRUE
          ORDER BY material_no NULLS LAST, id LIMIT 1`,
        [origWorkId]
      );
      anchorMaterialCode = dm.rows[0]?.material_code || null;
    }
  }

  // ledger_ref_id を原作 id で補完。
  const ledgerRefId = origWorkId;

  // documents を upsert（②）。NOT NULL 列は Master 既定で埋める。
  const up = await db.query(
    `INSERT INTO documents (
       document_number, issue_key, template_type, form_data, drive_link,
       record_type, contract_category, contract_type, contract_title, contract_status,
       vendor_id, effective_date, expiration_date, flow_direction, deliverable_ownership,
       backlog_issue_key, ledger_code, ledger_ref_id
     ) VALUES (
       $1, $2, $3, '{}'::jsonb, '',
       $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13,
       $14, $15, $16
     )
     ON CONFLICT (document_number) DO UPDATE SET
       record_type = EXCLUDED.record_type,
       contract_category = EXCLUDED.contract_category,
       contract_type = EXCLUDED.contract_type,
       contract_title = COALESCE(NULLIF(EXCLUDED.contract_title,''), documents.contract_title),
       contract_status = EXCLUDED.contract_status,
       vendor_id = EXCLUDED.vendor_id,
       effective_date = EXCLUDED.effective_date,
       expiration_date = EXCLUDED.expiration_date,
       flow_direction = EXCLUDED.flow_direction,
       deliverable_ownership = EXCLUDED.deliverable_ownership,
       backlog_issue_key = COALESCE(EXCLUDED.backlog_issue_key, documents.backlog_issue_key),
       ledger_code = EXCLUDED.ledger_code,
       ledger_ref_id = EXCLUDED.ledger_ref_id
     RETURNING id`,
    [
      input.document_number,
      s(input.issue_key) || "",
      s(input.template_type) || s(input.record_type) || "contract",
      s(input.record_type) || "individual_contract",
      s(input.contract_category) || "license",
      s(input.contract_type),
      s(input.contract_title),
      s(input.contract_status) || "executed",
      input.vendor_id ?? null,
      s(input.effective_date),
      s(input.expiration_date),
      s(input.flow_direction),
      s(input.deliverable_ownership),
      s(input.backlog_issue_key),
      ledger,
      ledgerRefId,
    ]
  );
  const documentId = Number(up.rows[0].id);

  // 金銭条件 → CL（①）。材料は行指定→既定→本体。
  const fcs = Array.isArray(input.financial_conditions) ? input.financial_conditions : [];
  const direction = dirFromFlow(input.flow_direction);
  const conditions: ConditionInput[] = fcs.map((fc, i) =>
    toConditionInput(fc, i, {
      direction,
      materialCode: anchorMaterialCode,
      overrides: input.condition_material_codes || {},
    })
  );
  const { lineIds } = await upsertDocumentConditions(db, documentId, conditions);

  return { documentId, conditionLineIds: lineIds };
}
