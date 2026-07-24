/**
 * 個別利用許諾条件 v3（マトリクス構造）— テンプレ context ビルダー（純関数・DBアクセスなし）。
 *
 * 設計: docs/design/individual-license-terms-v3-migration-plan.md
 * テンプレ: docs/design/individual_license_terms_v3.hbs.html（→本番 templates/ へは配線後）
 *
 * フォーム(Stage B)が送る v3 構造 → Handlebars context へ変換する。
 *   取引形態(列) × 構成要素LC(=原作マテリアル, 行) の料率マトリクス。
 *   - 加算型(addon): 適用料率 = 各LCの当該取引形態料率の合算（Σ）
 *   - 非加算型: 適用料率 = 実効料率(fixedRate)。1-3(B)の該当列は "—"
 *   - LC の区分(lcId) = material_code（LO-…-NNN）
 *
 * 本モジュールは登録(condition_lines)やDBに依存しない。生成時に formData から
 * テンプレ context を組み立てる責務のみを持つ（既存の formData 駆動レンダリングと同思想）。
 */

// ── 入力（v3 フォームが formData に載せる構造）─────────────────────────────
export interface V3Cond {
  id?: number | string;       // 取引形態の一時ID（lcs.rates のキー）
  name?: string;              // 取引形態名（未使用でも可。condLabel は条件Nで採番）
  manufacturer?: string;      // 製造者（1-3A）
  seller?: string;            // 販売者（1-3A）
  maxReg?: string;            // 最大地域（1-3A）
  maxLang?: string;           // 最大言語（1-3A）
  basePrice?: string;         // 基準価格（1-3A）
  addon?: boolean;            // 加算型か
  fixedRate?: string | number;// 非加算型の実効料率(%)
  reg?: string;               // 今回地域（2-1）
  lang?: string;              // 今回言語（2-1）
  qty?: string;               // 個数（2-1）
  ag?: string | number;       // AG
  mg?: string | number;       // MG
  cur?: string;               // 通貨
  calc_type?: string;         // 計算モデル（取引形態に紐づく: BASE_QTY_RATE / BASE_RATE / FIXED / SUBSCRIPTION / SUPPLY_QTY）
}
export interface V3Lc {
  material_code?: string;     // 区分（=LC ID, LO-…-NNN）
  name?: string;              // 構成要素名
  holder?: string;            // 権利元（rights_holder）
  source_doc?: string;        // 根拠文書番号（利用許諾条件書/発注書、または「この条件書(新規)」）
  region?: string;            // 許諾地域（この構成要素の上流権利が許す枠。空=1-1に準ずる）
  language?: string;          // 許諾言語（同上）
  rates?: Record<string, string | number>; // { [condId]: 料率(%) }
}
export interface V3Sublicensee {
  slPartner?: string; slRegion?: string; slLang?: string; slCond?: string;
  slRate?: string; slDate?: string; slNote?: string;
}
export interface V3SpecialExtra { seId?: string; seText?: string }
/** 2-3(A) 計算基準日の1行（版ごとに支払期日の起点事由を定める）。 */
export interface V3CalcBaseRow { edition?: string; trigger?: string; note?: string }

export interface V3FormData {
  // マトリクス・台帳（v3 フォームが produce）
  v3_conds?: V3Cond[];
  v3_lcs?: V3Lc[];
  v3_sublicensees?: V3Sublicensee[];
  v3_special_extras?: V3SpecialExtra[];
  v3_calc_base_rows?: V3CalcBaseRow[];
  // ヘッダ等は既存フォームの日本語キー（契約書番号 / Licensor_名称 …）も読むため index 許容。
  [k: string]: any;
}

// ── 出力（テンプレ individual_license_terms_v3.hbs.html が要求）────────────
export interface V3TemplateContext {
  issueDate: string; contractNo: string; workId: string; masterAgreement: string;
  licensorName: string; licenseeName: string; startDate: string;
  licensorContact: string; licenseeContact: string;
  productDefinition: string; productName: string; exclusivity: string;
  maxRegion: string; maxLanguage: string; scope: string;
  conds: Array<{
    condLabel: string; condName: string; basePrice: string;
    condType: string; calcModel: string; condRegion: string; condLang: string;
    appliedRate: string; quantity: string; ag: string; mg: string; currency: string;
  }>;
  // 1-3 構成要素マトリクスの料率列 = 加算型の取引形態のみ(appliedRate=構成要素料率の合算Σ)。
  addonConds: Array<{ condLabel: string; condName: string; appliedRate: string }>;
  // 権利元列を出すか(構成要素の権利元が複数に分かれる時のみ=按分ケース)。
  showHolder: boolean;
  // 1-3(A) 構成要素の許諾範囲 表の列数(空行 colspan 用)。
  scopeColCount: number;
  // 1-3(B) 加算型料率 表の列数(空行 colspan 用)。
  rateColCount: number;
  // Licensor が法人か(2-3(B) 支払期日の分岐)。
  licensorIsCorp: boolean;
  lcs: Array<{
    lcId: string;
    lcName: string;
    lcHolder: string;
    lcSourceDoc: string;
    lcRegion: string;   // 許諾地域(枠)。空=1-1に準ずる。
    lcLanguage: string; // 許諾言語(枠)。空=1-1に準ずる。
    // 加算型の取引形態ごとの この構成要素の料率(addonConds と同順)。
    addonRates: string[];
  }>;
  calcBaseRows: Array<{ edition: string; trigger: string; note: string }>;
  sublicensees: V3Sublicensee[];
  supervisor: string;
  specialExtras: V3SpecialExtra[];
  licensorAddress: string; licensorRep: string; licenseeAddress: string; licenseeRep: string;
}

// ── helpers ────────────────────────────────────────────────────────────────
const s = (v: any): string => (v == null ? "" : String(v));
const toNum = (v: any): number | null => {
  if (v == null || String(v).trim() === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const fmtPct = (n: number | null): string =>
  n == null ? "—" : `${+n.toFixed(2)}%`;

/** 計算モデル(calc_type)の表示ラベル。取引形態(1-3A/2-1)に紐づく。 */
const CALC_MODEL_LABEL: Record<string, string> = {
  BASE_QTY_RATE: "基準価格×個数×料率",
  BASE_RATE: "実効料率",
  FIXED: "固定額",
  SUBSCRIPTION: "サブスク",
  SUPPLY_QTY: "供給価格×個数×料率",
};
const calcModelLabel = (t?: string): string => (t ? CALC_MODEL_LABEL[t] || "" : "");

/** 2-3(A) 計算基準日の既定行。フォーム未設定・既存保存データでもこの標準2行で描画する。 */
export const DEFAULT_CALC_BASE_ROWS: Array<{ edition: string; trigger: string; note: string }> = [
  { edition: "初版", trigger: "発売日", note: "" },
  { edition: "2版以降", trigger: "製造日", note: "" },
];

/** 1-1 対象製品の定義（固定文言）。対象製品は「被許諾者が対象作品を利用して製造・販売する
 *  ボードゲーム製品」と定義で固定する。フォームに項目は無く、v3_productDefinition/対象製品の定義
 *  が明示指定された場合のみ上書きする。姉妹テンプレ(individual_license_terms.html)の定義と揃える。 */
export const DEFAULT_PRODUCT_DEFINITION =
  "被許諾者（Licensee）が本契約に基づき対象作品を利用して企画・開発・製造・販売するボードゲーム製品（以下「対象製品」という。）";

/** 取引形態 c の適用料率: 加算型=各LCの当該料率を合算 / 非加算型=実効料率。 */
export function computeAppliedRate(cond: V3Cond, lcs: V3Lc[]): string {
  if (!cond.addon) {
    const r = toNum(cond.fixedRate);
    return r == null ? "—" : fmtPct(r);
  }
  const key = String(cond.id ?? "");
  let sum = 0;
  let any = false;
  for (const l of lcs || []) {
    const r = toNum(l.rates?.[key]);
    if (r != null) {
      sum += r;
      any = true;
    }
  }
  return any ? fmtPct(sum) : "—";
}

/**
 * 雛形プレビュー用のサンプル v3 formData（worker / search-api 共用）。
 *   跨ぎ原作・加算型（A 原作X 5% ＋ B 原作Y 2% ＝ 7%）＋ 非加算型サブライセンス 50%。
 *   ヘッダは context builder が読む top-level 日本語キーで持たせる。
 */
export function v3SampleFormData(): V3FormData {
  return {
    契約書番号: "LIC-LO-2026-0015-ILT-0001",
    発行日: "2026-06-27",
    許諾開始日: "2026-07-01",
    Licensor_氏名会社名: "株式会社オリジナル（サンプル）",
    Licensee_氏名会社名: "株式会社ライセンシー（サンプル）",
    対象製品予定名: "コラボボードゲーム（サンプル）",
    独占性: "非独占",
    監修者: "監修部",
    Licensor_担当者: "山田", Licensor_電話: "03-1111-2222", Licensor_メール: "yamada@example.co.jp",
    Licensor_住所: "東京都千代田区サンプル1-2-3", Licensor_代表者名: "代表取締役 鈴木 一郎",
    Licensee_住所: "大阪府大阪市サンプル4-5-6", Licensee_代表者名: "代表取締役 佐藤 花子",
    v3_conds: [
      { id: 1, name: "製造・販売", addon: true, manufacturer: "Licensee", seller: "Licensee",
        maxReg: "全世界", maxLang: "全言語", basePrice: "上代（MSRP）× 数量",
        reg: "日本", lang: "日本語", qty: "数量", ag: "0", mg: "100000", cur: "JPY" },
      { id: 2, name: "サブライセンス", addon: false, fixedRate: "50",
        reg: "全世界", lang: "全言語", qty: "1", ag: "0", mg: "0", cur: "JPY" },
    ],
    v3_lcs: [
      { material_code: "LO-2026-0015-001", name: "原作ゲーム（A）", holder: "株式会社オリジナル", region: "全世界", language: "全言語", rates: { "1": "5" } },
      { material_code: "LO-2026-0008-003", name: "過去成果物（B・別原作）", holder: "株式会社クリエイト", region: "日本国内", language: "日本語", rates: { "1": "2" } },
    ],
    v3_sublicensees: [
      { slPartner: "サブA社", slRegion: "北米", slLang: "英語", slCond: "サブライセンス", slRate: "50", slDate: "2026-08-01", slNote: "サンプル" },
    ],
    v3_calc_base_rows: [
      { edition: "初版", trigger: "発売日", note: "" },
      { edition: "2版以降", trigger: "製造日", note: "" },
    ],
  };
}

/** v3 formData → テンプレ context。純関数。 */
export function buildIndividualLicenseV3Context(fd: V3FormData): V3TemplateContext {
  const v3Conds: V3Cond[] = Array.isArray(fd.v3_conds) ? fd.v3_conds : [];
  const v3Lcs: V3Lc[] = Array.isArray(fd.v3_lcs) ? fd.v3_lcs : [];

  const conds = v3Conds.map((c, i) => ({
    condLabel: `条件${i + 1}`,
    condName: s(c.name),
    basePrice: s(c.basePrice),
    condType: c.addon ? "【加算型】" : "【非加算型】",
    calcModel: calcModelLabel(c.calc_type),
    condRegion: s(c.reg),
    condLang: s(c.lang),
    appliedRate: computeAppliedRate(c, v3Lcs),
    quantity: s(c.qty) || "1",
    ag: s(c.ag) || "0",
    mg: s(c.mg) || "0",
    currency: s(c.cur) || "JPY",
  }));

  // 1-3 マトリクスの料率列 = 加算型の取引形態のみ(非加算型は構成要素別料率を持たない)。
  const addonConds = v3Conds
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !!c.addon)
    .map(({ i }) => ({
      condLabel: conds[i].condLabel,
      condName: conds[i].condName,
      appliedRate: conds[i].appliedRate, // 加算型の適用料率 = 構成要素料率の合算(Σ)
    }));

  const lcs = v3Lcs.map((l) => {
    const raw = s(l.source_doc).trim();
    // 文書番号: 各構成要素の根拠文書(過去の利用許諾条件書 or 発注書の番号)。
    //   未設定 or FE の「(この|本)条件書…(新規)」= 初回作品で本条件書が根拠 ⇒ 統一表記。
    const lcSourceDoc =
      raw === "" || /^(この|本)条件書/.test(raw) ? "本条件書（新規）" : raw;
    return {
      lcId: s(l.material_code),
      lcName: s(l.name),
      lcHolder: s(l.holder),
      lcSourceDoc,
      lcRegion: s(l.region),
      lcLanguage: s(l.language),
      // 加算型の取引形態ごとの この構成要素の料率(addonConds と同順)。
      addonRates: v3Conds
        .filter((c) => !!c.addon)
        .map((c) => {
          const r = toNum(l.rates?.[String(c.id ?? "")]);
          return r == null ? "—" : fmtPct(r);
        }),
    };
  });

  // 権利元は「非常時」表示: 構成要素の権利元が複数に分かれる時のみ列を出す(按分の透明性)。
  const showHolder =
    new Set(v3Lcs.map((l) => s(l.holder).trim()).filter((h) => h !== "")).size > 1;
  // 1-3(A) 構成要素の許諾範囲: #/構成要素/文書番号 + 権利元? + 許諾地域 + 許諾言語。
  const scopeColCount = 3 + (showHolder ? 1 : 0) + 2;
  // 1-3(B) 加算型料率: #/構成要素 + 加算型料率列。
  const rateColCount = 2 + addonConds.length;

  // Licensor が法人か個人か(2-3(B) 支払期日の分岐用)。
  //   優先: 許諾者種別("法人"/"個人") → licensor_is_corporation 系フラグ →
  //   代表者名の有無(あれば法人とみなす)でフォールバック。
  const licensorIsCorp = (() => {
    const kind = s(fd["許諾者種別"]).trim();
    if (kind) return kind === "法人";
    for (const k of ["licensor_is_corporation", "LICENSOR_IS_CORPORATION", "Licensor_種別"]) {
      const raw = fd[k];
      if (raw != null && String(raw).trim() !== "") {
        const t = String(raw).trim().toLowerCase();
        if (t === "individual" || t === "個人" || t === "personal") return false;
        return t === "true" || t === "1" || t === "yes" || t === "法人" || t === "corporate" || t === "corp";
      }
    }
    return s(fd["Licensor_代表者名"] ?? fd["licensorRep"]).trim() !== "";
  })();

  // 2-3(A) 計算基準日。空行を除き、実質未設定なら既定2行（初版=発売日/2版以降=製造日）。
  const calcBaseInput: V3CalcBaseRow[] = Array.isArray(fd.v3_calc_base_rows)
    ? fd.v3_calc_base_rows
    : [];
  const calcBaseRows = calcBaseInput
    .map((r) => ({ edition: s(r?.edition), trigger: s(r?.trigger), note: s(r?.note) }))
    .filter((r) => r.edition !== "" || r.trigger !== "" || r.note !== "");

  // ヘッダ等は既存フォームの日本語キーを優先し、英語キーへフォールバック。
  //   v3 固有(対象製品の定義/許諾範囲/許諾地域・言語の上限)は現フォームに項目が無いので
  //   v3_* 任意項目 → 既存 → 空 の順で解決する。
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = fd[k];
      if (v != null && String(v).trim() !== "") return String(v);
    }
    return "";
  };
  const licensorContact = [fd["Licensor_担当者"], fd["Licensor_電話"], fd["Licensor_メール"]]
    .filter((x) => x != null && String(x).trim() !== "")
    .join(" ／ ");

  return {
    issueDate: pick("発行日", "issueDate"),
    contractNo: pick("契約書番号", "contractNo"),
    workId: pick("work_id", "台帳ID", "workId"),
    masterAgreement: pick("基本契約名", "masterAgreement"),
    licensorName: pick("Licensor_氏名会社名", "Licensor_名称", "licensorName"),
    licenseeName: pick("Licensee_氏名会社名", "Licensee_名称", "licenseeName"),
    startDate: pick("許諾開始日", "startDate"),
    licensorContact: licensorContact || pick("licensorContact"),
    licenseeContact: pick("Licensee_連絡先", "licenseeContact"),
    productDefinition:
      pick("v3_productDefinition", "対象製品の定義", "productDefinition") ||
      DEFAULT_PRODUCT_DEFINITION,
    productName: pick("対象製品予定名", "productName"),
    exclusivity: pick("独占性", "exclusivity"),
    maxRegion: pick("v3_maxRegion", "許諾地域", "maxRegion"),
    maxLanguage: pick("v3_maxLanguage", "許諾言語", "maxLanguage"),
    scope: pick("v3_scope", "許諾範囲", "scope"),
    conds,
    addonConds,
    showHolder,
    scopeColCount,
    rateColCount,
    licensorIsCorp,
    lcs,
    calcBaseRows: calcBaseRows.length > 0 ? calcBaseRows : DEFAULT_CALC_BASE_ROWS,
    sublicensees: Array.isArray(fd.v3_sublicensees) ? fd.v3_sublicensees : [],
    supervisor: pick("監修者", "supervisor"),
    specialExtras: Array.isArray(fd.v3_special_extras) ? fd.v3_special_extras : [],
    licensorAddress: pick("Licensor_住所", "licensorAddress"),
    licensorRep: pick("Licensor_代表者名", "licensorRep"),
    licenseeAddress: pick("Licensee_住所", "licenseeAddress"),
    licenseeRep: pick("Licensee_代表者名", "licenseeRep"),
  };
}
