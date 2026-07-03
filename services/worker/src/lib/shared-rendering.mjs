// AUTO-SYNCED from shared/rendering/render.mjs by scripts/sync-shared.mjs.
// Do not edit here — edit the canonical source and re-run the sync.

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

  Handlebars.registerHelper("formatMoney", (value) => {
    if (value === null || value === undefined || value === "") return "0";
    const num = typeof value === "number" ? value : parseFloat(String(value).replace(/[^0-9.-]+/g, ""));
    if (!Number.isFinite(num)) return "0";
    const hasFraction = Math.abs(num % 1) > 1e-9;
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(num);
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

  Handlebars.registerHelper("cycleLabelEn", (cycle, intervalUnit, intervalCount) => {
    // 海外発注書用の英語サイクルラベル。プレビュー(生値 "QUARTERLY")と
    // 最終生成(worker 英語化後 "Quarterly")の両方を正規化して受ける。
    const c = String(cycle || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (c === "CUSTOM") {
      const n = Number(intervalCount);
      if (Number.isFinite(n) && n > 0) {
        const u = String(intervalUnit || "").toUpperCase() === "DAY" ? "day" : "month";
        return `Every ${n} ${u}${n > 1 ? "s" : ""}`;
      }
      return "Custom cycle";
    }
    if (c === "QUARTERLY") return "Quarterly";
    if (c === "SEMIANNUAL") return "Semi-annual";
    if (c === "ANNUAL") return "Annual";
    if (c === "MONTHLY") return "Monthly";
    return cycle ? String(cycle) : "Periodic";
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

// ── サンプルプレビュー用データ生成(B5b)─────────────────────────────
// worker documentService.getTemplateVariables / buildSampleDocumentData /
// sampleValueForTemplateField から汎用部分を抽出。出版特化の
// PUBLICATION_SAMPLE_OVERRIDES は worker 側に温存(プレビューは汎用値で表示)。

/** テンプレ html から参照変数名を抽出(標準フィールドは除く)。 */
export function extractTemplateVariables(html) {
  const regex = /\{\{\{?[#\/!]?(?:if|each|unless|with)?\s*([^}\s]+)(?:\s+[^}\s]+)*\s*\}\}\}?/g;
  const vars = new Set();
  let m;
  while ((m = regex.exec(html)) !== null) {
    const name = m[1];
    if (!["issueKey", "summary", "requester", "date", "details"].includes(name)) vars.add(name);
  }
  return [...vars];
}

/** フィールド定義(field_schema の1要素)から型/名称ヒューリスティックでサンプル値。 */
export function sampleValueForField(fieldId, def) {
  const id = String(fieldId || "");
  const upper = id.toUpperCase();
  const label = String(def?.label || "");
  const placeholder = String(def?.placeholder || "");
  if (def?.type === "boolean") return true;
  if (def?.type === "number") {
    if (upper.includes("DAYS")) return 10;
    if (upper.includes("YEARS")) return 5;
    if (upper.includes("RATE")) return 10;
    if (upper.includes("AMOUNT") || upper.includes("TOTAL") || label.includes("金額")) return 100000;
    return 1;
  }
  if (def?.type === "select" && Array.isArray(def.options) && def.options.length > 0) return def.options[0];
  if (upper.includes("CONTRACT_NO") || upper.includes("ORDER_NO")) return "SAMPLE-2026-0001";
  if (upper.includes("CONTRACT_DATE_FORMATTED")) return "2026年5月24日";
  if (upper.includes("DATE")) return "2026-05-24";
  if (upper.includes("PARTY_B_NAME") || upper.includes("VENDOR_NAME")) return "サンプル株式会社";
  if (upper.includes("ADDRESS")) return "東京都千代田区サンプル1-2-3";
  if (upper.includes("REPRESENTATIVE") || upper.includes("_REP")) return "代表取締役 山田 太郎";
  if (upper.includes("EMAIL")) return "sample@example.com";
  if (upper.includes("PHONE") || upper.includes("TEL")) return "03-1234-5678";
  if (upper.includes("JURISDICTION")) return "東京地方裁判所";
  if (upper.includes("CONFIDENTIALITY_YEARS")) return 5;
  if (upper.includes("BREACH_CURE_DAYS")) return 14;
  if (upper.includes("PAYMENT")) return "月末締め翌月末日払い";
  if (upper.includes("DELIVERY_LOCATION")) return "甲指定倉庫";
  if (upper.includes("PRODUCT_SCOPE")) return "アナログゲーム製品および関連商品";
  if (upper.includes("WARRANTY_PERIOD")) return "引渡し後1年";
  if (upper.includes("SPECIAL_TERMS") || upper.includes("REMARKS") || upper.includes("NOTES")) {
    return "本欄はサンプル表示です。実運用では案件に応じて編集してください。";
  }
  if (placeholder) return placeholder.replace(/^例[:：]\s*/, "");
  if (label) return `${label}サンプル`;
  return `[${id}]`;
}

/**
 * field_schema(配列)+ html からサンプル DocumentData を構築(汎用)。
 * 出版テンプレの作り込み値は含めない(worker 側 PUBLICATION_SAMPLE_OVERRIDES)。
 */
export function buildSampleData(fieldSchema, html, label) {
  const defs = {};
  for (const f of fieldSchema || []) if (f && f.name) defs[f.name] = f;
  const fieldIds = new Set([...Object.keys(defs), ...extractTemplateVariables(html || "")]);
  const details = {};
  for (const id of fieldIds) details[id] = sampleValueForField(id, defs[id]);

  Object.assign(details, {
    CONTRACT_NO: details.CONTRACT_NO || "SAMPLE-2026-0001",
    ORDER_NO: details.ORDER_NO || "SAMPLE-2026-0001",
    DOC_NO: details.DOC_NO || "SAMPLE-2026-0001",
    items: [
      { item_name: "サンプル品目A", spec: "仕様A", quantity: 10, unit_price: 10000, amount: 100000, remarks: "サンプル明細" },
      { item_name: "サンプル品目B", spec: "仕様B", quantity: 5, unit_price: 20000, amount: 100000, remarks: "" },
    ],
    order_lines: [
      { line_no: 1, item_name: "サンプル品目A", spec: "仕様A", quantity: 10, unit_price: 10000, amount_ex_tax: 100000 },
      { line_no: 2, item_name: "サンプル品目B", spec: "仕様B", quantity: 5, unit_price: 20000, amount_ex_tax: 100000 },
    ],
    order_lines_for_inspection: [
      { id: 1, line_no: 1, item_name: "サンプル成果物A", spec: "仕様A", quantity: 10, unit_price: 10000, amount_ex_tax: 100000 },
    ],
    delivery_line_items: [
      { line_no: 1, item_name: "サンプル成果物A", spec: "仕様A", inspected_quantity: 10, acceptance_ratio: 1, inspected_amount_ex_tax: 100000 },
    ],
    expenses: [
      { line_no: 1, expense_name: "サンプル経費", spent_date: "2026-05-24", amount_inc_tax: 11000, remarks: "交通費" },
    ],
    other_fees: [
      { line_no: 1, fee_name: "サンプル手数料", amount: 10000, remarks: "任意手数料" },
    ],
    // 個別利用許諾条件書ほか financial_conditions[] を描画するテンプレ用の金銭条件サンプル。
    financial_conditions: [
      {
        condition_no: 1, condition_name: "自社製造・直接販売",
        region_territory: "日本国内", region_language: "日本語", region_language_label: "日本国内・日本語",
        calc_type: "BASE_QTY_RATE", calc_method: "基準価格 × 個数 × 料率",
        base_price_label: "上代（MSRP）", rate_pct: 5, mg_amount: 100000, ag_amount: 0, currency: "JPY",
        payment_terms: "毎四半期末締め翌月末日払い", formula_text: "基準価格 × 個数 × 5%",
      },
      {
        condition_no: 2, condition_name: "国内・海外展開（ライセンスアウト型）",
        region_territory: "全世界", region_language: "全言語", region_language_label: "全世界・全言語",
        calc_type: "BASE_RATE", calc_method: "受領ライセンス料 × 料率",
        base_price_label: "受領サブライセンス料", rate_pct: 50, mg_amount: 0, ag_amount: 0, currency: "JPY",
        payment_terms: "毎半期末締め翌月末日払い", formula_text: "受領サブライセンス料 × 50%",
      },
    ],
    CHANGE_RECORDS: details.CHANGE_RECORDS || "2026-05-24|検収金額|100000|80000|一部不合格のため減額",
  });

  const documentNumber = String(
    details.契約番号 || details.条件書番号 || details.追加条件書番号 ||
    details.CONTRACT_NO || details.ORDER_NO || details.DOC_NO || "SAMPLE-2026-0001"
  );
  return {
    issueKey: "SAMPLE-1",
    documentNumber,
    summary: `${label || ""} サンプル`,
    requester: "LegalBridge Sample",
    date: new Date().toLocaleDateString("ja-JP"),
    details,
  };
}
