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
}
export interface V3Lc {
  material_code?: string;     // 区分（=LC ID, LO-…-NNN）
  name?: string;              // 構成要素名
  holder?: string;            // 権利元（rights_holder）
  rates?: Record<string, string | number>; // { [condId]: 料率(%) }
}
export interface V3Sublicensee {
  slPartner?: string; slRegion?: string; slLang?: string; slCond?: string;
  slRate?: string; slDate?: string; slNote?: string;
}
export interface V3SpecialExtra { seId?: string; seText?: string }

export interface V3FormData {
  // 頭書・許諾概要・署名（テンプレのプレースホルダと同名）
  issueDate?: string; contractNo?: string; workId?: string; masterAgreement?: string;
  licensorName?: string; licenseeName?: string; startDate?: string;
  licensorContact?: string; licenseeContact?: string;
  productDefinition?: string; productName?: string; exclusivity?: string;
  maxRegion?: string; maxLanguage?: string; scope?: string;
  supervisor?: string;
  licensorAddress?: string; licensorRep?: string; licenseeAddress?: string; licenseeRep?: string;
  // マトリクス・台帳
  v3_conds?: V3Cond[];
  v3_lcs?: V3Lc[];
  v3_sublicensees?: V3Sublicensee[];
  v3_special_extras?: V3SpecialExtra[];
}

// ── 出力（テンプレ individual_license_terms_v3.hbs.html が要求）────────────
export interface V3TemplateContext {
  issueDate: string; contractNo: string; workId: string; masterAgreement: string;
  licensorName: string; licenseeName: string; startDate: string;
  licensorContact: string; licenseeContact: string;
  productDefinition: string; productName: string; exclusivity: string;
  maxRegion: string; maxLanguage: string; scope: string;
  condCount: number;
  conds: Array<{
    condLabel: string; manufacturer: string; seller: string;
    maxCondRegion: string; maxCondLang: string; basePrice: string;
    condType: string; condRegion: string; condLang: string;
    appliedRate: string; quantity: string; ag: string; mg: string; currency: string;
  }>;
  lcs: Array<{ lcId: string; lcName: string; lcHolder: string; rates: string[] }>;
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

/** v3 formData → テンプレ context。純関数。 */
export function buildIndividualLicenseV3Context(fd: V3FormData): V3TemplateContext {
  const v3Conds: V3Cond[] = Array.isArray(fd.v3_conds) ? fd.v3_conds : [];
  const v3Lcs: V3Lc[] = Array.isArray(fd.v3_lcs) ? fd.v3_lcs : [];

  const conds = v3Conds.map((c, i) => ({
    condLabel: `条件${i + 1}`,
    manufacturer: s(c.manufacturer),
    seller: s(c.seller),
    maxCondRegion: s(c.maxReg),
    maxCondLang: s(c.maxLang),
    basePrice: s(c.basePrice),
    condType: c.addon ? "【加算型】" : "【非加算型】",
    condRegion: s(c.reg),
    condLang: s(c.lang),
    appliedRate: computeAppliedRate(c, v3Lcs),
    quantity: s(c.qty) || "1",
    ag: s(c.ag) || "0",
    mg: s(c.mg) || "0",
    currency: s(c.cur) || "JPY",
  }));

  const lcs = v3Lcs.map((l) => ({
    lcId: s(l.material_code),
    lcName: s(l.name),
    lcHolder: s(l.holder),
    // rates は conds と同順。非加算型列は "—"（LC料率を持たない）。
    rates: v3Conds.map((c) => {
      if (!c.addon) return "—";
      const r = toNum(l.rates?.[String(c.id ?? "")]);
      return r == null ? "—" : fmtPct(r);
    }),
  }));

  return {
    issueDate: s(fd.issueDate),
    contractNo: s(fd.contractNo),
    workId: s(fd.workId),
    masterAgreement: s(fd.masterAgreement),
    licensorName: s(fd.licensorName),
    licenseeName: s(fd.licenseeName),
    startDate: s(fd.startDate),
    licensorContact: s(fd.licensorContact),
    licenseeContact: s(fd.licenseeContact),
    productDefinition: s(fd.productDefinition),
    productName: s(fd.productName),
    exclusivity: s(fd.exclusivity),
    maxRegion: s(fd.maxRegion),
    maxLanguage: s(fd.maxLanguage),
    scope: s(fd.scope),
    condCount: conds.length,
    conds,
    lcs,
    sublicensees: Array.isArray(fd.v3_sublicensees) ? fd.v3_sublicensees : [],
    supervisor: s(fd.supervisor),
    specialExtras: Array.isArray(fd.v3_special_extras) ? fd.v3_special_extras : [],
    licensorAddress: s(fd.licensorAddress),
    licensorRep: s(fd.licensorRep),
    licenseeAddress: s(fd.licenseeAddress),
    licenseeRep: s(fd.licenseeRep),
  };
}
