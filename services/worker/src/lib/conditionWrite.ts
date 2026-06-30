/**
 * Phase 2 — condition_lines を「単一の真実源」として直接書き込む新プリミティブ。
 *
 * 旧 upsertCapabilityFinancialConditions / upsertCapabilityLineItems ＋
 * ミラー同期(syncConditionLinesForCapability) ＋ linkWorkMaterialsForCapability を
 * 置き換える。cfc/cli を介さず CL を直接 upsert し、material_code から原作マテリアルへ結線する。
 *
 * 設計: docs/design/schema-simplification-plan.md（Phase 2）
 *
 * 純粋に db.query インターフェースのみに依存（server.ts 非依存＝単体テスト可能）。
 */

export interface CondDb {
  query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

/** 1条件(=CL)の入力。フォーム/保存パスが組み立てる。 */
export interface ConditionInput {
  line_no?: number | null;
  group_no?: number | null;        // 取引形態(v3列)。加算型セルを束ねる
  // 原作マテリアル結線（どちらか）
  material_code?: string | null;   // work_materials.material_code で解決
  material_id?: number | null;
  // 向き・種別
  direction?: string | null;            // payable(当社支払) / receivable(当社受取)
  transaction_kind?: string | null;     // license / product / service
  deliverable_ownership?: string | null;// 発注者 / 受注者
  payment_scheme?: string | null;       // royalty/lump_sum/per_unit/subscription/installment（空なら導出）
  // 経済条件
  rate_pct?: any; mg_amount?: any; ag_amount?: any; currency?: string | null;
  base_price_label?: string | null;
  quantity?: any; unit_price?: any; amount_ex_tax?: any; unit_amount?: any;
  calc_type?: string | null; fixed_kind?: string | null; subscription_cycle?: string | null;
  guarantee_type?: string | null;
  region_territory?: string | null; region_language?: string | null;
  formula_text?: string | null; payment_terms?: string | null; payment_method?: string | null;
  payment_date?: string | null; delivery_date?: string | null;
  term_start?: string | null; term_end?: string | null; cycle?: string | null; billing_day?: any;
  // v3 取引形態ヘッダ（インライン）
  is_addon?: boolean; manufacturer?: string | null; seller?: string | null;
  max_region?: string | null; max_language?: string | null;
  // 属性
  condition_name?: string | null; subject?: string | null; spec?: string | null;
  category?: string | null; notes?: string | null; applies_scope?: string | null;
  // 互換ビュー振分け（cfc/cli/expense/other_fee）。未指定なら category から導出。
  legacy_role?: string | null;
}

const num = (v: any): number | null => {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: any): string | null =>
  v == null || String(v).trim() === "" ? null : String(v);

/** payment_scheme 導出: 明示優先、無ければ料率ありで royalty / それ以外 lump_sum。 */
function derivePaymentScheme(c: ConditionInput): string {
  const ps = String(c.payment_scheme || "").trim();
  if (ps) return ps;
  return num(c.rate_pct) != null ? "royalty" : "lump_sum";
}

/**
 * 文書(documentId)配下の条件明細を CL へ直接 upsert する（置換セマンティクス）。
 *   - material_code → work_materials.id を解決し source_material_id / source_work_id へ。
 *   - (document_id, line_no) を一意キーに upsert。
 *   - CHECK 整合: 非royalty は rate/mg/ag を NULL、消化型は amount_ex_tax 既定0。
 *   - セットに無い旧 line_no で、実績(condition_events)/作品参照(work_material_uses)を
 *     持たない CL は削除（履歴は保全）。
 * @returns 書き込んだ CL の id 配列
 */
export async function upsertDocumentConditions(
  db: CondDb,
  documentId: number,
  conditions: ConditionInput[]
): Promise<{ written: number; lineIds: number[] }> {
  const year = new Date().getFullYear();
  const list = Array.isArray(conditions) ? conditions : [];
  const keptLineNos: number[] = [];
  const lineIds: number[] = [];

  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const lineNo = Number(c.line_no ?? i + 1);
    keptLineNos.push(lineNo);

    // 原作マテリアル解決（material_id 優先 → material_code）。source_work_id を導出。
    let materialId: number | null = c.material_id != null ? Number(c.material_id) : null;
    let sourceWorkId: number | null = null;
    const code = str(c.material_code);
    if (materialId) {
      const r = await db.query(`SELECT work_id FROM work_materials WHERE id = $1`, [materialId]);
      if (r.rows[0]) sourceWorkId = Number(r.rows[0].work_id);
      else materialId = null;
    } else if (code) {
      const r = await db.query(
        `SELECT id, work_id FROM work_materials WHERE material_code = $1 LIMIT 1`,
        [code]
      );
      if (r.rows[0]) {
        materialId = Number(r.rows[0].id);
        sourceWorkId = Number(r.rows[0].work_id);
      }
    }

    const scheme = derivePaymentScheme(c);
    const isRoyalty = scheme === "royalty";
    const isDepletable = !(scheme === "royalty" || scheme === "subscription");
    const direction = c.direction === "receivable" ? "receivable" : "payable";

    // line_code: 既存(同 document_id, line_no)があれば再利用、無ければ採番。
    const ex = await db.query(
      `SELECT line_code FROM condition_lines WHERE document_id = $1 AND line_no = $2`,
      [documentId, lineNo]
    );
    let lineCode: string;
    if (ex.rows[0]?.line_code) {
      lineCode = ex.rows[0].line_code;
    } else {
      const seq = await db.query(
        `INSERT INTO document_sequences (kind, year, current_value) VALUES ('condition_line', $1, 1)
           ON CONFLICT (kind, year) DO UPDATE SET current_value = document_sequences.current_value + 1
         RETURNING current_value`,
        [year]
      );
      lineCode = `CL-${year}-${String(Number(seq.rows[0].current_value)).padStart(5, "0")}`;
    }

    // 互換ビュー振分け: 明示 legacy_role 優先、無ければ category から導出（既定 cfc）。
    const legacyRole =
      str(c.legacy_role) ||
      (c.category === "line_item"
        ? "cli"
        : c.category === "expense"
          ? "expense"
          : c.category === "other_fee"
            ? "other_fee"
            : "cfc");

    // 列→値マップ（列ズレ防止のため動的に INSERT/UPDATE を組み立て）。
    const row: Record<string, any> = {
      document_id: documentId,
      capability_id: documentId, // 旧 cl.capability_id 参照の互換ミラー
      legacy_role: legacyRole,
      line_no: lineNo,
      line_code: lineCode,
      group_no: c.group_no ?? null,
      source_material_id: materialId,
      source_work_id: sourceWorkId,
      direction,
      payment_scheme: scheme,
      transaction_kind: str(c.transaction_kind),
      deliverable_ownership: str(c.deliverable_ownership),
      currency: str(c.currency) || "JPY",
      subject: str(c.subject),
      notes: str(c.notes),
      spec: str(c.spec),
      category: str(c.category),
      quantity: num(c.quantity),
      unit_price: num(c.unit_price),
      amount_ex_tax: isDepletable ? num(c.amount_ex_tax) ?? 0 : num(c.amount_ex_tax),
      unit_amount: num(c.unit_amount),
      rate_pct: isRoyalty ? num(c.rate_pct) : null,
      base_price_label: str(c.base_price_label),
      mg_amount: isRoyalty ? num(c.mg_amount) : null,
      ag_amount: isRoyalty ? num(c.ag_amount) : null,
      calc_type: str(c.calc_type),
      fixed_kind: str(c.fixed_kind),
      subscription_cycle: str(c.subscription_cycle),
      guarantee_type: str(c.guarantee_type),
      region_territory: str(c.region_territory),
      region_language: str(c.region_language),
      applies_scope: str(c.applies_scope),
      formula_text: str(c.formula_text),
      payment_terms: str(c.payment_terms),
      payment_method: str(c.payment_method),
      payment_date: str(c.payment_date),
      delivery_date: str(c.delivery_date),
      term_start: str(c.term_start),
      term_end: str(c.term_end),
      cycle: str(c.cycle),
      billing_day: num(c.billing_day),
      condition_name: str(c.condition_name),
      is_addon: !!c.is_addon,
      manufacturer: str(c.manufacturer),
      seller: str(c.seller),
      max_region: str(c.max_region),
      max_language: str(c.max_language),
      status_flags: "{}",
      is_inbound: false,
    };

    const cols = Object.keys(row);
    const vals = cols.map((k) => row[k]);
    const placeholders = cols.map((_, idx) => `$${idx + 1}`);
    // ON CONFLICT 更新は document_id / line_no / line_code を除く全列。
    const updates = cols
      .filter((k) => k !== "document_id" && k !== "line_no" && k !== "line_code")
      .map((k) => `${k} = EXCLUDED.${k}`)
      .concat(["updated_at = now()"])
      .join(", ");
    const ins = await db.query(
      `INSERT INTO condition_lines (${cols.join(", ")}, updated_at)
         VALUES (${placeholders.join(", ")}, now())
       ON CONFLICT (document_id, line_no) DO UPDATE SET ${updates}
       RETURNING id`,
      vals
    );
    lineIds.push(Number(ins.rows[0].id));
  }

  // 不要CL削除（新セットに無い line_no で、実績/作品参照を持たない CL のみ）。
  const cond =
    keptLineNos.length > 0
      ? { sql: "AND cl.line_no <> ALL($2::int[])", params: [documentId, keptLineNos] }
      : { sql: "", params: [documentId] };
  await db.query(
    `DELETE FROM condition_lines cl
      WHERE cl.document_id = $1 ${cond.sql}
        AND NOT EXISTS (SELECT 1 FROM condition_events e WHERE e.condition_line_id = cl.id)
        AND NOT EXISTS (SELECT 1 FROM work_material_uses w WHERE w.condition_line_id = cl.id)`,
    cond.params
  );

  return { written: lineIds.length, lineIds };
}
