import Handlebars from "handlebars";
import fs from "fs";
import path from "path";

import { sanitizeForFilename, query } from "../lib/db.ts";
// B5: 共有レンダリング(canonical: shared/rendering/render.mjs を同期コピー)。
// renderTemplate は date auto-expand + context マージ + compile を担う。
// helper 群は当面 registerHelpers()(下記インライン)と共有版が同一内容。
import { renderTemplate as sharedRenderTemplate } from "../lib/shared-rendering.mjs";
// v3移植: 個別利用許諾条件 v3(マトリクス)の context ビルダー。
import { buildIndividualLicenseV3Context } from "../lib/individualLicenseV3Context.ts";

export interface DocumentData {
  issueKey: string;
  documentNumber?: string;
  summary: string;
  requester: string;
  date: string;
  details: Record<string, any>;
}

// Phase 22.21.82: 未使用テンプレを削除。type は admin-ui templates_config.json
//   に登録され UI 選択可能な 12 種 + 旧互換 (license_calculation_sheet) のみ。
//   削除済み: legal_request / contract / planning_purchase_order /
//             payment_notice / fee_statement / license_report / service_terms /
//             inspection_certificate_detailed / inspection_certificate_v2 /
//             payment_notice_alt / intl_amendment / intl_master
export type DocumentType =
  | "purchase_order"
  | "intl_purchase_order"
  | "nda"
  | "license_master"
  | "individual_license_terms"
  | "service_master"
  | "sales_master_buyer"
  | "sales_master_credit"
  | "sales_master_standard"
  | "royalty_statement"
  | "inspection_certificate"
  | "maintenance_spec"
  | "legal_response" // Phase 22.21.83: 法務回答書 (法務相談・事務手続への正式回答)
  | "pub_master_individual" // Phase 25: 出版等許諾基本契約書 (個人版)
  | "pub_master_corporate" // Phase 25: 出版等許諾基本契約書 (法人版)
  | "pub_license_terms" // Phase 25: 出版等利用許諾条件書
  | "pub_additional_terms" // Phase 25: 追加利用許諾条件書 (商品化・映像化・デジタルゲーム化)
  | "license_calculation_sheet"; // legacy alias (= royalty_statement 系の旧名)

/**
 * 文書ファイル名の単一ソース (generateDocument と過去分 backfill が共用)。
 * 命名ルール(作成日 YYYYMMDD を必ず付与):
 *   検収書 / 利用許諾料計算書 → 文書番号_親文書番号_YYYYMMDD
 *     (親文書番号が不明な場合は取引先名にフォールバック)
 *   それ以外(契約書/発注書/出版等利用許諾条件書/個別利用許諾条件書 等)
 *                            → 文書番号_取引先名_YYYYMMDD
 *   例: "ARC-PO-2026-0001_株式会社サンプル_20260616.html"
 *       "ARC-INS-2026-0001_ARC-PO-2026-0001_20260616.html"
 * 文書番号が無い場合は "TYPE_issueKey..." の旧フォールバックを踏襲。
 */
export function buildDocumentFileName(
  type: DocumentType | string,
  opts: {
    documentNumber?: string;
    issueKey?: string;
    vendorName?: string | null;
    parentDocNumber?: string | null;
    date?: Date;
  }
): string {
  const t = String(type || "");
  // 検収書 / 利用許諾料計算書(legacy alias 含む) は親文書番号で命名。
  const isParentNamed =
    t.includes("inspection") ||
    t === "royalty_statement" ||
    t === "license_calculation_sheet";
  const vendorPart = opts.vendorName
    ? `_${sanitizeForFilename(opts.vendorName)}`
    : "";
  const parentPart = opts.parentDocNumber
    ? `_${sanitizeForFilename(opts.parentDocNumber)}`
    : "";
  const midPart = isParentNamed ? parentPart || vendorPart : vendorPart;
  // 作成日 YYYYMMDD (JST)。date 未指定は現在時刻。
  const base = opts.date instanceof Date && !isNaN(opts.date.getTime())
    ? opts.date
    : new Date();
  const ymd = new Date(base.getTime() + 9 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  return opts.documentNumber
    ? `${opts.documentNumber}${midPart}_${ymd}.html`
    : `${t.toUpperCase()}_${opts.issueKey}${midPart}_${ymd}.html`;
}

export class DocumentService {
  private templatesDir: string;

  // Phase 2 / C3: テンプレ読取元。TEMPLATE_SOURCE=db で DB(document_templates)
  // から取得、それ以外は従来どおり disk(templates/*.html)。可逆フラグ。
  private templateSource: "disk" | "db";
  // db モード時、起動時に current version の html_source を template_key で保持。
  private dbCache: Map<string, string> | null = null;

  constructor() {
    // Determine templates directory relative to project root
    this.templatesDir = path.join(process.cwd(), "templates");
    this.templateSource = process.env.TEMPLATE_SOURCE === "db" ? "db" : "disk";

    // Register common Handlebars helpers
    this.registerHelpers();

    // disk モードは即 partial 登録。db モードは loadFromDb() で登録する。
    if (this.templateSource === "disk") {
      this.registerPartials();
    }
  }

  /**
   * Phase 2 / C3: DB(document_templates / _versions)から current version の
   * テンプレ本体と partial を一括ロードしてキャッシュ・登録する。
   * TEMPLATE_SOURCE=db のときに worker 起動時へ一度だけ呼ぶ(server.ts)。
   * disk モードでは no-op。失敗時は disk フォールバックできるよう投げない。
   */
  async loadFromDb(): Promise<void> {
    if (this.templateSource !== "db") return;
    try {
      const res = await query(
        `SELECT dt.template_key, dt.kind, v.html_source
           FROM document_templates dt
           JOIN document_template_versions v ON v.id = dt.current_version_id
          WHERE dt.is_active = true`
      );
      const cache = new Map<string, string>();
      let docs = 0;
      let partials = 0;
      for (const row of res.rows as Array<{ template_key: string; kind: string; html_source: string }>) {
        if (row.kind === "partial") {
          Handlebars.registerPartial(row.template_key, row.html_source);
          partials++;
        } else {
          cache.set(row.template_key, row.html_source);
          docs++;
        }
      }
      this.dbCache = cache;
      console.log(`[documentService] loaded templates from DB: ${docs} documents, ${partials} partials`);
    } catch (err) {
      // DB 読取に失敗しても disk フォールバック(loadTemplate)で動作継続。
      console.error("[documentService] loadFromDb failed — falling back to disk:", err);
      this.registerPartials();
    }
  }

  /**
   * Phase 17i: Register Handlebars partials from templates/partials/.
   *
   * Used by purchase_order.html to attach the standard 業務委託基本契約約款
   * (terms_spot_2026) when 基本契約あり=FALSE.
   */
  private registerPartials() {
    try {
      const partialsDir = path.join(this.templatesDir, "partials");
      if (!fs.existsSync(partialsDir)) return;
      for (const fileName of fs.readdirSync(partialsDir)) {
        if (!fileName.endsWith(".html")) continue;
        const partialName = fileName.replace(/\.html$/, "");
        const partialSource = fs.readFileSync(path.join(partialsDir, fileName), "utf-8");
        Handlebars.registerPartial(partialName, partialSource);
      }
    } catch (error) {
      console.error("Error registering partials:", error);
    }
  }

  private registerHelpers() {
    // 1. Equality check
    Handlebars.registerHelper("eq", (a, b) => a === b);
    
    // 2. Inequality check
    Handlebars.registerHelper("ne", (a, b) => a !== b);
    
    // 3. Currency formatting (¥ 1,234,567)
    Handlebars.registerHelper("formatCurrency", (value) => {
      if (value === null || value === undefined) return "0";
      const num = typeof value === "number" ? value : parseFloat(String(value).replace(/[^0-9.-]+/g, ""));
      if (isNaN(num)) return "0";
      return new Intl.NumberFormat("ja-JP").format(Math.floor(num));
    });
    
    // 4. Date formatting (YYYY年MM月DD日)
    Handlebars.registerHelper("formatDate", (value) => {
      if (!value) return "";
      const date = new Date(value);
      if (isNaN(date.getTime())) return String(value);
      return date.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    });

    // Phase 22.8.1: コンパクト日付 (YYYY/MM/DD) — 表の狭い列で改行を避けたい時に使う
    Handlebars.registerHelper("formatDateCompact", (value) => {
      if (!value) return "";
      const date = new Date(value);
      if (isNaN(date.getTime())) return String(value);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}/${m}/${d}`;
    });

    // 5. Addition (used for indexing etc)
    Handlebars.registerHelper("add", (a, b) => {
      return Number(a) + Number(b);
    });

    // 6. Multiplication (e.g. unit_price × quantity = amount)
    Handlebars.registerHelper("multiply", (a, b) => {
      return (Number(a) || 0) * (Number(b) || 0);
    });

    // 7. 1-based index (use inside {{#each}} as {{index1 @index}})
    Handlebars.registerHelper("index1", (idx) => Number(idx) + 1);

    // 7b. Phase 22.21.55: 丸数字 (①②③...⑳) — {{circledNum @index}} で 0-based を 1-based に。
    //     21 以降は "21." のような数字表記にフォールバック。
    //     maintenance_spec のスコープ外項目箇条書きで使う。
    Handlebars.registerHelper("circledNum", (idx: any) => {
      const n = Number(idx) + 1;
      const circled = [
        "①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩",
        "⑪","⑫","⑬","⑭","⑮","⑯","⑰","⑱","⑲","⑳",
      ];
      return circled[n - 1] || `${n}.`;
    });

    // 8. Percent formatting (e.g. 5.0 -> "5.0 %")
    //    Strips trailing zeros after decimal point for visual hygiene.
    Handlebars.registerHelper("formatPct", (value) => {
      if (value === null || value === undefined || value === "") return "";
      const num = Number(value);
      if (!Number.isFinite(num)) return String(value);
      return num.toFixed(4).replace(/\.?0+$/, "") + " %";
    });

    // 9. Yen with mark (e.g. 1234 -> "¥ 1,234")
    Handlebars.registerHelper("formatYen", (value) => {
      if (value === null || value === undefined || value === "") return "¥ 0";
      const num = Number(value);
      if (!Number.isFinite(num)) return "¥ 0";
      return "¥ " + new Intl.NumberFormat("ja-JP").format(Math.floor(num));
    });

    // 10. Default value (e.g. {{or value "—"}} renders "—" when falsy)
    Handlebars.registerHelper("or", (a, b) => (a ? a : b));

    // 11. Greater-than for {{#if (gt remaining 0)}} style guards.
    Handlebars.registerHelper("gt", (a, b) => Number(a) > Number(b));
    Handlebars.registerHelper("lt", (a, b) => Number(a) < Number(b));

    // 12. Joined list helper for arrays of strings or {{value: ...}} objects.
    Handlebars.registerHelper("join", (arr, sep) => {
      if (!Array.isArray(arr)) return "";
      return arr.map((v) => (typeof v === "object" ? v.value || v.label : v)).join(sep || ", ");
    });

    // 13. Length helper — useful for {{#if (gt (length items) 0)}}.
    Handlebars.registerHelper("length", (arr) => (Array.isArray(arr) ? arr.length : 0));

    // 14. String concat — useful for synthesizing dates from year/month/day
    //     {{concat year "-" month "-" day}} → "2026-5-12"
    // 末尾の Handlebars options 引数は除外する。
    Handlebars.registerHelper("concat", function (...args: any[]) {
      return args
        .slice(0, -1)
        .map((v) => (v == null ? "" : String(v)))
        .join("");
    });

    // 15. Phase 22.8: SUBSCRIPTION の周期コード → 日本語ラベル
    //     {{cycleLabel "MONTHLY"}} → "月次"
    Handlebars.registerHelper("cycleLabel", (cycle: any) => {
      const c = String(cycle || "").toUpperCase();
      if (c === "QUARTERLY") return "四半期";
      if (c === "SEMIANNUAL") return "半年";
      if (c === "ANNUAL") return "年次";
      if (c === "CUSTOM") return "カスタム"; // 任意周期(支払スケジュール参照)
      return "月次"; // MONTHLY or unknown は月次扱い (default)
    });

    // Phase 22.16: 適格請求書発行事業者の表示ラベル正規化。
    //   テンプレ間で IS_INVOICE_ISSUER の値型がバラバラだったため:
    //     boolean true        → "該当"
    //     boolean false       → "非該当"
    //     文字列 "該当"        → "該当"
    //     文字列 "非該当"      → "非該当"
    //     文字列 "true"/"yes"  → "該当"
    //     文字列 "false"/"no"  → "非該当"
    //     空 / undefined / null → "非該当"
    //   PDF で "true" / "false" がそのまま出てしまう不格好を防ぐ。
    Handlebars.registerHelper("invoiceLabel", (v: any) => {
      if (v === true) return "該当";
      if (v === false || v == null) return "非該当";
      const s = String(v).trim();
      if (!s) return "非該当";
      if (s === "該当") return "該当";
      if (s === "非該当") return "非該当";
      const lower = s.toLowerCase();
      if (["true", "yes", "y", "1", "○", "✓"].includes(lower)) return "該当";
      if (["false", "no", "n", "0", "×"].includes(lower)) return "非該当";
      // それ以外の文字列はそのまま返す (フリーテキスト想定外なので fallback)
      return s;
    });

    // 16. Phase 22.8: SUBSCRIPTION の支払日表示
    //     {{billingDayLabel 25 "MONTHLY"}} → "毎月25日"
    //     {{billingDayLabel 0  "MONTHLY"}} → "毎月末日" (0 or >30 で末日)
    //     {{billingDayLabel 15 "QUARTERLY"}} → "毎四半期15日"
    Handlebars.registerHelper("billingDayLabel", (day: any, cycle: any) => {
      if (day === null || day === undefined || day === "") return "";
      const n = Number(day);
      if (Number.isNaN(n)) return "";
      const c = String(cycle || "").toUpperCase();
      const prefix =
        c === "QUARTERLY"
          ? "毎四半期"
          : c === "SEMIANNUAL"
            ? "毎半期"
            : c === "ANNUAL"
              ? "毎年"
              : "毎月";
      if (n === 0 || n > 30) return `${prefix}末日`;
      return `${prefix}${n}日`;
    });
  }

  private loadTemplate(type: DocumentType): string {
    // db モード: 起動時キャッシュ(current version)から取得。未ヒット時は
    // 移行期の安全策として disk フォールバック。
    if (this.templateSource === "db" && this.dbCache) {
      const cached = this.dbCache.get(type);
      if (cached !== undefined) return cached;
      console.warn(`[documentService] template '${type}' not in DB cache — falling back to disk`);
    }

    const filePath = path.join(this.templatesDir, `${type}.html`);
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch (error) {
      console.error(`Error loading template ${type}:`, error);
    }

    // Fallback or throw error
    throw new Error(`Template not found: ${type}`);
  }

  renderHtml(data: DocumentData, type: DocumentType = "purchase_order"): string {
    // B5: レンダリングは共有モジュールに委譲(date auto-expand + context マージ
    //   + Handlebars.compile)。worker の Handlebars インスタンス(helper/partial
    //   登録済み)を渡すため出力は従来と同一。
    // v3移植(Stage C-1): 個別利用許諾でマトリクス入力(v3_conds)があれば、v3 テンプレ＋
    //   v3 context で描画する。v3 データが無ければ従来テンプレ・従来描画(挙動不変)。
    const dv3: any = data;
    const isLicense = type === "individual_license_terms";
    if (isLicense && Array.isArray(dv3?.v3_conds) && dv3.v3_conds.length > 0) {
      const v3Source = this.loadTemplate("individual_license_terms_v3" as DocumentType);
      const v3Data = { ...dv3, ...buildIndividualLicenseV3Context(dv3) };
      return sharedRenderTemplate(Handlebars, v3Source, v3Data);
    }

    const templateSource = this.loadTemplate(type);
    // 検収書: delivery_line_items に item_name が無い(旧データ/フォーム未保持)場合、
    //   order_lines_for_inspection(親PO明細)から品目名/仕様を補完する。これが無いと
    //   テンプレが全行 ../description にフォールバックして同名表示になる。
    let renderData: any = data;
    const d: any = data;
    if (
      type === "inspection_certificate" &&
      d &&
      Array.isArray(d.delivery_line_items)
    ) {
      const ol: any[] = Array.isArray(d.order_lines_for_inspection)
        ? d.order_lines_for_inspection
        : [];
      const byId = new Map<number, any>();
      for (const l of ol) byId.set(Number(l.id), l);
      renderData = {
        ...d,
        delivery_line_items: d.delivery_line_items.map((dl: any) => {
          if (dl && (dl.item_name == null || dl.item_name === "")) {
            const p = byId.get(Number(dl.order_line_item_id));
            if (p)
              return { ...dl, item_name: p.item_name, spec: dl.spec || p.spec };
          }
          return dl;
        }),
      };
    }
    return sharedRenderTemplate(Handlebars, templateSource, renderData);
  }

  async generateDocument(
    data: DocumentData,
    type: DocumentType = "purchase_order",
    opts?: { vendorName?: string; parentDocNumber?: string }
  ): Promise<{ html: string; fileName: string }> {
    const html = this.renderHtml(data, type);
    // ファイル名は buildDocumentFileName に集約 (過去分 backfill と完全共用)。
    const fileName = buildDocumentFileName(type, {
      documentNumber: data.documentNumber,
      issueKey: data.issueKey,
      vendorName: opts?.vendorName,
      parentDocNumber: opts?.parentDocNumber,
    });
    return { html, fileName };
  }

  getTemplateVariables(type: DocumentType): string[] {
    const templateSource = this.loadTemplate(type);
    const regex = /\{\{\{?[#\/!]?(?:if|each|unless|with)?\s*([^}\s]+)(?:\s+[^}\s]+)*\s*\}\}\}?/g;
    const variables = new Set<string>();
    let match;
    while ((match = regex.exec(templateSource)) !== null) {
      const varName = match[1];
      // Skip standard data fields that we usually provide
      if (!["issueKey", "summary", "requester", "date", "details"].includes(varName)) {
        variables.add(varName);
      }
    }
    return Array.from(variables);
  }
}
