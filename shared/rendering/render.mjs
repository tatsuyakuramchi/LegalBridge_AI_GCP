// 共有レンダリングモジュール(B5) — Handlebars helper / 日付auto-expand / render。
//
// worker(文書生成)と search-api(② プレビュー/PDF)が**同一出力**になるよう、
// レンダリングの単一ソースをここに置く。各サービスは自分の Handlebars インスタンス
// を渡す(registerHelpers(Handlebars))。
//
// canonical: shared/rendering/render.mjs
//   → scripts/sync-shared.mjs が services/{worker,api}/src/lib/shared-rendering.mjs
//     に同期コピー(Docker コンテキスト内に置くため)。**コピー側は手編集しない**。
//
// 抽出元: services/worker/src/services/documentService.ts(registerHelpers /
//   renderHtml の date-expand)。挙動は完全一致させること。

/** worker と同一の Handlebars helper 群を登録する。 */
export function registerHelpers(Handlebars) {
  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("ne", (a, b) => a !== b);

  Handlebars.registerHelper("formatCurrency", (value) => {
    if (value === null || value === undefined) return "0";
    const num = typeof value === "number" ? value : parseFloat(String(value).replace(/[^0-9.-]+/g, ""));
    if (isNaN(num)) return "0";
    return new Intl.NumberFormat("ja-JP").format(Math.floor(num));
  });

  Handlebars.registerHelper("formatDate", (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  });

  Handlebars.registerHelper("formatDateCompact", (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}/${m}/${d}`;
  });

  Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b));
  Handlebars.registerHelper("multiply", (a, b) => (Number(a) || 0) * (Number(b) || 0));
  Handlebars.registerHelper("index1", (idx) => Number(idx) + 1);

  Handlebars.registerHelper("circledNum", (idx) => {
    const n = Number(idx) + 1;
    const circled = [
      "①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩",
      "⑪","⑫","⑬","⑭","⑮","⑯","⑰","⑱","⑲","⑳",
    ];
    return circled[n - 1] || `${n}.`;
  });

  Handlebars.registerHelper("formatPct", (value) => {
    if (value === null || value === undefined || value === "") return "";
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value);
    return num.toFixed(4).replace(/\.?0+$/, "") + " %";
  });

  Handlebars.registerHelper("formatYen", (value) => {
    if (value === null || value === undefined || value === "") return "¥ 0";
    const num = Number(value);
    if (!Number.isFinite(num)) return "¥ 0";
    return "¥ " + new Intl.NumberFormat("ja-JP").format(Math.floor(num));
  });

  Handlebars.registerHelper("or", (a, b) => (a ? a : b));
  Handlebars.registerHelper("gt", (a, b) => Number(a) > Number(b));
  Handlebars.registerHelper("lt", (a, b) => Number(a) < Number(b));

  Handlebars.registerHelper("join", (arr, sep) => {
    if (!Array.isArray(arr)) return "";
    return arr.map((v) => (typeof v === "object" ? v.value || v.label : v)).join(sep || ", ");
  });

  Handlebars.registerHelper("length", (arr) => (Array.isArray(arr) ? arr.length : 0));

  Handlebars.registerHelper("concat", function (...args) {
    return args.slice(0, -1).map((v) => (v == null ? "" : String(v))).join("");
  });

  Handlebars.registerHelper("cycleLabel", (cycle) => {
    const c = String(cycle || "").toUpperCase();
    if (c === "QUARTERLY") return "四半期";
    if (c === "SEMIANNUAL") return "半年";
    if (c === "ANNUAL") return "年次";
    return "月次";
  });

  Handlebars.registerHelper("invoiceLabel", (v) => {
    if (v === true) return "該当";
    if (v === false || v == null) return "非該当";
    const s = String(v).trim();
    if (!s) return "非該当";
    if (s === "該当") return "該当";
    if (s === "非該当") return "非該当";
    const lower = s.toLowerCase();
    if (["true", "yes", "y", "1", "○", "✓"].includes(lower)) return "該当";
    if (["false", "no", "n", "0", "×"].includes(lower)) return "非該当";
    return s;
  });

  Handlebars.registerHelper("billingDayLabel", (day, cycle) => {
    if (day === null || day === undefined || day === "") return "";
    const n = Number(day);
    if (Number.isNaN(n)) return "";
    const c = String(cycle || "").toUpperCase();
    const prefix =
      c === "QUARTERLY" ? "毎四半期"
      : c === "SEMIANNUAL" ? "毎半期"
      : c === "ANNUAL" ? "毎年"
      : "毎月";
    if (n === 0 || n > 30) return `${prefix}末日`;
    return `${prefix}${n}日`;
  });
}

/**
 * 単一 date 値 (YYYY-MM-DD[...]) を持つキーに {key}_YEAR/_MONTH/_DAY を補完する
 * (既存値は上書きしない)。元オブジェクトは変更せずコピーを返す。
 */
export function expandDateFields(details) {
  const out = { ...(details || {}) };
  for (const [key, val] of Object.entries(out)) {
    if (typeof val !== "string") continue;
    const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) continue;
    const [, y, mo, d] = m;
    if (out[`${key}_YEAR`] == null) out[`${key}_YEAR`] = String(parseInt(y, 10));
    if (out[`${key}_MONTH`] == null) out[`${key}_MONTH`] = String(parseInt(mo, 10));
    if (out[`${key}_DAY`] == null) out[`${key}_DAY`] = String(parseInt(d, 10));
  }
  return out;
}

/**
 * テンプレ(html)を data でレンダリングする。documentService.renderHtml と同一:
 *   context = { ...data, ...expandDateFields(data.details) }
 * Handlebars インスタンスは呼び出し側が registerHelpers 済みのものを渡す。
 */
export function renderTemplate(Handlebars, html, data) {
  const enriched = expandDateFields(data && data.details);
  const context = { ...(data || {}), ...enriched };
  return Handlebars.compile(html)(context);
}
