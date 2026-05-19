import Handlebars from "handlebars";
import fs from "fs";
import path from "path";

import { sanitizeForFilename } from "../lib/db.ts";

export interface DocumentData {
  issueKey: string;
  documentNumber?: string;
  summary: string;
  requester: string;
  date: string;
  details: Record<string, any>;
}

export type DocumentType = 
  | "legal_request" 
  | "purchase_order" 
  | "contract"
  | "nda"
  | "planning_purchase_order"
  | "payment_notice"
  | "fee_statement"
  | "license_report"
  | "sales_master_buyer"
  | "sales_master_credit"
  | "sales_master_standard"
  | "service_master"
  | "service_terms"
  | "inspection_certificate"
  | "inspection_certificate_detailed"
  | "payment_notice_alt"
  | "royalty_statement"
  | "inspection_certificate_v2"
  | "intl_amendment"
  | "intl_master"
  | "intl_purchase_order"
  | "individual_license_terms"
  | "license_calculation_sheet"
  | "license_master";

export class DocumentService {
  private templatesDir: string;

  constructor() {
    // Determine templates directory relative to project root
    this.templatesDir = path.join(process.cwd(), "templates");

    // Register common Handlebars helpers
    this.registerHelpers();

    // Register partials (約款テンプレ等)
    this.registerPartials();
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

  renderHtml(data: DocumentData, type: DocumentType = "legal_request"): string {
    const templateSource = this.loadTemplate(type);
    const template = Handlebars.compile(templateSource);

    // 日付フィールドの auto-expand:
    //   フォーム側は単一の date input (例: CONTRACT_DATE = "2026-05-12") で
    //   入力するが、既存テンプレ HTML は {{CONTRACT_DATE_YEAR}} 等のように
    //   分割形式で参照しているケースがある。ここで自動展開する。
    //
    //   "YYYY-MM-DD" 形式 (または "YYYY-MM-DDTHH:MM:SS..." 形式) の値を持つ
    //   キーに対して、{key}_YEAR / _MONTH / _DAY を補完する (既存値があれば上書きしない)。
    const enrichedDetails: Record<string, any> = { ...(data.details || {}) };
    for (const [key, val] of Object.entries(enrichedDetails)) {
      if (typeof val !== "string") continue;
      const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) continue;
      const [, y, mo, d] = m;
      // 1 ベース。先頭ゼロ落としで自然な表示にする (例: 5月 12日)
      if (enrichedDetails[`${key}_YEAR`] == null) {
        enrichedDetails[`${key}_YEAR`] = String(parseInt(y, 10));
      }
      if (enrichedDetails[`${key}_MONTH`] == null) {
        enrichedDetails[`${key}_MONTH`] = String(parseInt(mo, 10));
      }
      if (enrichedDetails[`${key}_DAY`] == null) {
        enrichedDetails[`${key}_DAY`] = String(parseInt(d, 10));
      }
    }

    const context = {
      ...data,
      ...enrichedDetails,
    };

    return template(context);
  }

  async generateDocument(
    data: DocumentData,
    type: DocumentType = "legal_request",
    opts?: { vendorName?: string }
  ): Promise<{ html: string; fileName: string }> {
    const html = this.renderHtml(data, type);
    const prefix = type.toUpperCase();
    // Phase 22.10: ファイル名に取引先名を含める。
    //   取引先名は filesystem 安全に sanitize し、空のときはサフィックスなし。
    //   例: "ARC-PO-2026-0001_株式会社サンプル.html"
    //       "ARC-PO-2026-0001_001_株式会社サンプル.html" (再発行版)
    const vendorPart = opts?.vendorName
      ? `_${sanitizeForFilename(opts.vendorName)}`
      : "";
    const fileName = data.documentNumber
      ? `${data.documentNumber}${vendorPart}.html`
      : `${prefix}_${data.issueKey}${vendorPart}_${Date.now()}.html`;
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
