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
  // 0133: 許諾地域/言語の選択式(1対N)。子テーブルへ保存。
  regions?: any;
  languages?: any;
  // 再許諾/アウトライセンス: 種別・親ライセンス条件・相手方。
  condition_kind?: any;
  parent_license_condition_id?: any;
  counterparty_vendor_id?: any;
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
  ledger_ref_id?: number | null;
  template_type?: string | null;
  template_family?: string | null;
  issue_key?: string | null;
  document_url?: string | null;
  // 契約マスタ メタ（documents へ統合）
  is_active?: boolean | null;
  auto_renewal?: boolean | null;
  renewal_notice_months?: number | null;
  alert_lead_months?: number | null;
  alert_slack_channels?: any;
  alert_slack_mentions?: any;
  original_work?: string | null;
  product_name?: string | null;
  work_name?: string | null;
  media?: string | null;
  territory?: string | null;
  language?: string | null;
  condition_number?: string | null;
  // 材料の既定（軸マテリアル）。行で未指定の条件をここへ束ねる。空なら本体(is_default)。
  default_material_code?: string | null;
  // 行ごとの材料上書き（condition_no → material_code）
  condition_material_codes?: Record<string, string>;
  material_ref_id?: number | null;     // 軸マテリアル
  // 利用許諾/金銭条件（→CL）
  financial_conditions?: FinancialConditionLike[];
  // 業務明細 / 経費 / その他手数料（すべて CL へ。①一本化）
  line_items?: any[];
  expenses?: any[];
  other_fees?: any[];
  // 変換済みの追加 CL（v3マトリクス等、呼び出し側で ConditionInput を組み立てた分）。
  extra_conditions?: ConditionInput[];
}

/**
 * v3 マトリクス(取引形態×構成要素LC)を ConditionInput[] へ変換。
 *   - 加算型: 取引形態(group)ごとに、料率を持つ各LCを1セル(CL)へ。group_no で束ねる。
 *     mg/ag は代表(先頭LC)のみ保持。material_code=LCコード。
 *   - 非加算型: 取引形態ごとに1本（実効料率 fixedRate）。material_code=本体(anchor)。
 *   line_no は 4000+ レンジ（他タイプと非衝突）。
 */
export function mapV3MatrixToConditions(
  v3Conds: any[],
  v3Lcs: any[],
  anchorMaterialCode?: string | null
): ConditionInput[] {
  const conds = Array.isArray(v3Conds) ? v3Conds : [];
  const lcs = Array.isArray(v3Lcs) ? v3Lcs : [];
  const out: ConditionInput[] = [];
  let lineSeq = 4000;
  conds.forEach((c: any, gi: number) => {
    const groupNo = gi + 1;
    const key = String(c?.id ?? "");
    const header = {
      group_no: groupNo,
      transaction_kind: "license" as const,
      direction: "payable" as const,
      condition_name: s(c?.name),
      base_price_label: s(c?.basePrice),
      region_territory: s(c?.reg),
      region_language: s(c?.lang),
      currency: s(c?.cur) || "JPY",
      manufacturer: s(c?.manufacturer),
      seller: s(c?.seller),
      max_region: s(c?.maxReg),
      max_language: s(c?.maxLang),
    };
    if (c?.addon) {
      const cells = lcs
        .map((l: any) => ({ lc: l, rate: l?.rates?.[key] }))
        .filter((x: any) => x.rate != null && String(x.rate).trim() !== "");
      cells.forEach((cell: any, k: number) => {
        out.push({
          ...header,
          line_no: ++lineSeq,
          is_addon: true,
          payment_scheme: "royalty",
          material_code: s(cell.lc?.material_code),
          rate_pct: cell.rate,
          mg_amount: k === 0 ? c?.mg : null, // 代表のみ
          ag_amount: k === 0 ? c?.ag : null,
        });
      });
    } else {
      out.push({
        ...header,
        line_no: ++lineSeq,
        is_addon: false,
        payment_scheme: "royalty",
        material_code: anchorMaterialCode || null, // 本体アンカー
        rate_pct: c?.fixedRate,
        mg_amount: c?.mg,
        ag_amount: c?.ag,
      });
    }
  });
  return out;
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
    // 0133: 選択式の許諾地域/言語(配列)。undefined なら子テーブルは触らない。
    regions: Array.isArray(fc.regions) ? fc.regions : undefined,
    languages: Array.isArray(fc.languages) ? fc.languages : undefined,
    applies_scope: s(fc.applies_scope),
    formula_text: s(fc.formula_text),
    payment_terms: s(fc.payment_terms),
    condition_name: s(fc.condition_name),
    is_addon: !!fc.is_addon,
    manufacturer: s(fc.manufacturer),
    seller: s(fc.seller),
    max_region: s(fc.max_region),
    max_language: s(fc.max_language),
    // 再許諾/アウトライセンス: 種別・親ライセンス条件・相手方(未指定なら NULL)。
    condition_kind: s(fc.condition_kind) || undefined,
    parent_license_condition_id:
      fc.parent_license_condition_id != null && fc.parent_license_condition_id !== ""
        ? Number(fc.parent_license_condition_id)
        : undefined,
    counterparty_vendor_id:
      fc.counterparty_vendor_id != null && fc.counterparty_vendor_id !== ""
        ? Number(fc.counterparty_vendor_id)
        : undefined,
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

  // documents を upsert（②）。列→値マップで構築（列ズレ防止）。NOT NULL は Master 既定。
  const row: Record<string, any> = {
    document_number: input.document_number,
    issue_key: s(input.issue_key) || "",
    template_type: s(input.template_type) || s(input.record_type) || "contract",
    form_data: "{}",
    drive_link: "",
    record_type: s(input.record_type) || "individual_contract",
    contract_category: s(input.contract_category) || "license",
    contract_type: s(input.contract_type),
    contract_title: s(input.contract_title),
    contract_status: s(input.contract_status) || "executed",
    vendor_id: input.vendor_id ?? null,
    effective_date: s(input.effective_date),
    expiration_date: s(input.expiration_date),
    flow_direction: s(input.flow_direction),
    deliverable_ownership: s(input.deliverable_ownership),
    backlog_issue_key: s(input.backlog_issue_key),
    ledger_code: ledger,
    ledger_ref_id: input.ledger_ref_id ?? origWorkId,
    material_ref_id: input.material_ref_id ?? null,
    template_family: s(input.template_family),
    is_active: input.is_active == null ? true : !!input.is_active,
    auto_renewal: !!input.auto_renewal,
    renewal_notice_months: input.renewal_notice_months ?? null,
    alert_lead_months: input.alert_lead_months ?? null,
    alert_slack_channels: input.alert_slack_channels != null ? JSON.stringify(input.alert_slack_channels) : null,
    alert_slack_mentions: input.alert_slack_mentions != null ? JSON.stringify(input.alert_slack_mentions) : null,
    original_work: s(input.original_work),
    product_name: s(input.product_name),
    work_name: s(input.work_name),
    media: s(input.media),
    territory: s(input.territory),
    language: s(input.language),
    condition_number: s(input.condition_number),
    document_url: s(input.document_url),
  };
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  // ON CONFLICT 更新は document_number / form_data / drive_link / issue_key を除く。
  const skip = new Set(["document_number", "form_data", "drive_link", "issue_key"]);
  const updates = cols
    .filter((k) => !skip.has(k))
    .map((k) =>
      k === "contract_title"
        ? `contract_title = COALESCE(NULLIF(EXCLUDED.contract_title,''), documents.contract_title)`
        : `${k} = EXCLUDED.${k}`
    )
    .concat(["updated_at = CURRENT_TIMESTAMP"])
    .join(", ");
  const up = await db.query(
    `INSERT INTO documents (${cols.join(", ")})
       VALUES (${placeholders.join(", ")})
     ON CONFLICT (document_number) DO UPDATE SET ${updates}
     RETURNING id`,
    cols.map((k) => row[k])
  );
  const documentId = Number(up.rows[0].id);

  // PUT 等で明細系が一切未指定（全 undefined）なら既存CLを保持（触らない）。
  const anyProvided =
    input.financial_conditions !== undefined ||
    input.line_items !== undefined ||
    input.expenses !== undefined ||
    input.other_fees !== undefined ||
    input.extra_conditions !== undefined;
  if (!anyProvided) {
    return { documentId, conditionLineIds: [] };
  }

  // 全明細を CL へ（①一本化）。line_no をタイプ別レンジで分離（再保存安定）。
  const direction = dirFromFlow(input.flow_direction);
  const conditions: ConditionInput[] = [];
  // 金銭条件: line_no = condition_no
  for (let i = 0; i < (input.financial_conditions || []).length; i++) {
    conditions.push(
      toConditionInput(input.financial_conditions![i], i, {
        direction,
        materialCode: anchorMaterialCode,
        overrides: input.condition_material_codes || {},
      })
    );
  }
  // 業務明細: 1000+ / その他手数料: 2000+ / 経費: 3000+
  (input.line_items || []).forEach((li: any, i: number) => {
    const cm = String(li?.calc_method || "").toUpperCase();
    conditions.push({
      line_no: 1000 + Number(li?.line_no ?? i + 1),
      transaction_kind: "service",
      payment_scheme: cm === "SUBSCRIPTION" ? "subscription" : "lump_sum",
      direction,
      amount_ex_tax: li?.amount_ex_tax ?? li?.amount ?? 0,
      quantity: li?.quantity,
      unit_price: li?.unit_price,
      condition_name: s(li?.item_name),
      spec: s(li?.spec),
      category: s(li?.category) || "line_item",
      deliverable_ownership: s(li?.deliverable_ownership),
      payment_terms: s(li?.payment_terms),
      delivery_date: s(li?.delivery_date),
      material_code: s(li?.material_code),
    });
  });
  (input.other_fees || []).forEach((f: any, i: number) => {
    conditions.push({
      line_no: 2000 + Number(f?.line_no ?? i + 1),
      transaction_kind: "service", payment_scheme: "lump_sum", direction,
      amount_ex_tax: f?.amount ?? 0,
      condition_name: s(f?.fee_name), notes: s(f?.remarks), category: "other_fee",
    });
  });
  (input.expenses || []).forEach((e: any, i: number) => {
    conditions.push({
      line_no: 3000 + Number(e?.line_no ?? i + 1),
      transaction_kind: "service", payment_scheme: "lump_sum", direction,
      amount_ex_tax: e?.amount_inc_tax ?? e?.amount ?? 0,
      condition_name: s(e?.expense_name), spec: s(e?.spec),
      payment_date: s(e?.spent_date), notes: s(e?.remarks), category: "expense",
    });
  });

  // 変換済み追加 CL（v3 等）を末尾に追加。
  if (Array.isArray(input.extra_conditions)) conditions.push(...input.extra_conditions);

  const { lineIds } = await upsertDocumentConditions(db, documentId, conditions);
  return { documentId, conditionLineIds: lineIds };
}
