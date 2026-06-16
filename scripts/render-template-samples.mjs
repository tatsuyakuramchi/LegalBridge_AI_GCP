// scripts/render-template-samples.mjs
// ひな型(検収書/計算書/発注書/NDA)をサンプル値でレンダリングし、PNG 見本を
// docs/images/ に出力する。マニュアルの「ひな型 見本」用。
//
// 前提:
//   - handlebars / puppeteer-core を入手できること
//       npm i -g handlebars puppeteer-core   または近傍に node_modules
//   - Chromium 実行ファイル: 環境変数 PUPPETEER_EXECUTABLE_PATH で指定
//       (未指定時は /usr/bin/chromium。CI/ローカルに合わせて変更)
//   - 日本語フォント(IPAGothic 等)が利用可能なこと
//
// 実行:
//   PUPPETEER_EXECUTABLE_PATH=/path/to/chrome node scripts/render-template-samples.mjs
//
// レンダリングは worker/search-api と同一の共有モジュール
//   services/worker/src/lib/shared-rendering.mjs を使用(プレビューと同じ出力)。

import Handlebars from "handlebars";
import puppeteer from "puppeteer-core";
import { readFileSync, readdirSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  registerHelpers,
  renderTemplate,
  buildSampleData,
} from "../services/worker/src/lib/shared-rendering.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TPL_DIR = path.join(REPO, "services/worker/templates");
const OUT_DIR = path.join(REPO, "docs/images");
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

registerHelpers(Handlebars);

const pdir = path.join(TPL_DIR, "partials");
if (existsSync(pdir)) {
  for (const f of readdirSync(pdir)) {
    if (!f.endsWith(".html")) continue;
    Handlebars.registerPartial(f.replace(/\.html$/, ""), readFileSync(path.join(pdir, f), "utf8"));
  }
}

// 汎用 [field] 表示を実値に置換するための種別別サンプル。
const OVERRIDES = {
  inspection_certificate: (d) => Object.assign(d, {
    counterparty: "サンプルクリエイティブ株式会社", COUNTERPARTY_IS_CORPORATION: "法人",
    counterpartyRep: "代表取締役 山田 太郎", counterpartyTni: "T1234567890123",
    projectTitle: "アナログゲーム『サンプル』制作業務", parent_po_number: "ARC-PO-2026-0001",
    itemNo: "1", itemCount: "1", itemNoList: "", deliveryNo: "1", totalDeliveries: "1", isPartial: "完了",
    documentDate: "2026-05-24", orderDate: "2026-04-01", deliveredAt: "2026-05-20",
    inspectionCompletedAt: "2026-05-24", paymentDueDate: "2026-06-30",
    inspectorDept: "管理本部 法務部", inspectorName: "法務 花子", inspectorEmail: "legal@example.co.jp",
    bankName: "サンプル銀行", branchName: "本店営業部", accountType: "普通",
    accountNo: "1234567", accountHolder: "サンプルクリエイティブ（カ",
    paymentConditionSummary: "検収月の翌月末日払い", taxRate: 10, isReducedTax: false,
    deliveredAmountStr: "200,000", taxAmountStr: "20,000", totalAmountStr: "220,000",
    expensesTotalIncTaxStr: "11,000", grandTotalPayableStr: "231,000",
    delivery_line_items: [{ line_no: 1, item_name: "サンプルカードデザイン一式", spec: "カード20種・パッケージ", delivery_date: "2026-05-20", inspected_amount_ex_tax: 200000 }],
    expenses: [{ line_no: 1, expense_name: "交通費", spec: "都内移動", spent_date: "2026-05-18", amount_inc_tax: 11000, remarks: "" }],
    other_fees: [], otherFeesTaxable: false, hasChangeLogs: false, changeLogs: [],
  }),
  royalty_statement: (d) => Object.assign(d, {
    DOC_NO: "ARC-RYL-2026-0001", linked_contract_number: "ARC-LIC-2026-0001",
    licensor: "サンプルライセンス株式会社", LICENSOR_SUFFIX: "御中",
    VENDOR_REPRESENTATIVE_SAMA: "代表取締役 鈴木 一郎 様", licensee: "株式会社アークライト",
    originalWork: "『サンプル原作』", productName: "サンプルカードゲーム", edition: "初版",
    completionDate: "2026-05-20", documentDate: "2026-05-24", currency: "円",
    quantity: 5000, billableQuantity: 5000, msrpStr: "2,000", grossRoyaltyStr: "1,000,000",
    agAmountStr: "0", agConsumedBeforeStr: "0", agConsumedThisTimeStr: "0", agConsumedAfterStr: "0",
    agRemainingStr: "0", agProgressPct: 0, mgTopupThisTimeStr: "0", mgAmountStr: "300,000",
    actualRoyalty: 1000000, actualRoyaltyStr: "1,000,000", taxAmount: "100,000", taxRate: 10,
    totalPaymentStr: "1,100,000", paymentDueDate: "2026-06-30", reportingDeadline: "2026-06-15",
    paymentConditionSummary: "売上計上月の翌々月末日払い",
    bankName: "サンプル銀行", branchName: "本店営業部", accountType: "普通",
    accountNo: "7654321", accountHolder: "サンプルライセンス（カ", invoiceRegistrationNumber: "T9876543210123",
    STAFF_NAME: "法務 花子", STAFF_DEPARTMENT: "管理本部 法務部", STAFF_EMAIL: "legal@example.co.jp",
    STAFF_PHONE: "03-1234-5678", licensor_t_number: "",
    notes: "本欄はサンプル表示です。実運用では案件に応じて編集してください。",
  }),
  purchase_order: (d) => Object.assign(d, {
    ORDER_NO: "ARC-PO-2026-0001", PROJECT_TITLE: "アナログゲーム『サンプル』制作業務",
    PARTY_A_NAME: "株式会社アークライト", PARTY_A_ADDRESS: "東京都千代田区神田小川町1-2 風雲堂ビル2階",
    PARTY_A_REP: "代表取締役 田中 一郎", VENDOR_NAME: "サンプルクリエイティブ株式会社", VENDOR_SUFFIX: "御中",
    VENDOR_REPRESENTATIVE_SAMA: "代表取締役 山田 太郎 様", VENDOR_ADDRESS: "東京都新宿区サンプル3-4-5",
    VENDOR_EMAIL: "contact@sample.co.jp", VENDOR_CONTACT_NAME: "山田 太郎",
    VENDOR_CONTACT_DEPARTMENT: "制作部", VENDOR_CONTACT_PHONE: "03-9876-5432",
    VENDOR_ACCEPT_NAME: "サンプルクリエイティブ株式会社", PAYMENT_TERMS: "検収月の翌月末日払い",
    PAYMENT_METHOD: "銀行振込", TRANSFER_FEE_PAYER: "甲", ACCEPT_METHOD: "成果物の納品をもって検収",
    ACCEPT_REPLY_DUE_DATE: "2026-06-30", BANK_NAME: "サンプル銀行", BRANCH_NAME: "本店営業部",
    ACCOUNT_TYPE: "普通", ACCOUNT_NUMBER: "1234567", ACCOUNT_HOLDER_KANA: "サンプルクリエイティブ（カ",
    INVOICE_REGISTRATION_NUMBER: "T1234567890123", STAFF_NAME: "法務 花子",
    STAFF_DEPARTMENT: "管理本部 法務部", STAFF_EMAIL: "legal@example.co.jp", STAFF_PHONE: "03-1234-5678",
    SPECIAL_TERMS: "本欄はサンプル表示です。", REMARKS_FREE: "", REVISION: 0,
  }),
  nda: (d) => Object.assign(d, {
    CONTRACT_NO: "ARC-NDA-2026-0001", CONTRACT_DATE_FORMATTED: "2026年5月24日",
    PARTY_A_NAME: "株式会社アークライト", PARTY_A_ADDRESS: "東京都千代田区神田小川町1-2 風雲堂ビル2階",
    PARTY_A_REP: "代表取締役 田中 一郎", PARTY_B_NAME: "サンプルクリエイティブ株式会社",
    PARTY_B_ADDRESS: "東京都新宿区サンプル3-4-5", PARTY_B_REP: "代表取締役 山田 太郎",
    NDA_PURPOSE: "アナログゲーム共同企画の検討に関する協議および情報交換",
    CONFIDENTIALITY_PERIOD: "本契約終了後3年間", CONTRACT_PERIOD: "締結日から1年間",
    GOVERNING_LAW: "日本法", JURISDICTION: "東京地方裁判所", RETURN_DISPOSAL: "開示者の指示に従い返還または破棄する",
  }),
};

const targets = [
  ["inspection_certificate", "検収書"],
  ["royalty_statement", "利用許諾料計算書"],
  ["purchase_order", "発注書"],
  ["nda", "秘密保持契約書(NDA)"],
];

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
for (const [key, label] of targets) {
  const html = readFileSync(path.join(TPL_DIR, `${key}.html`), "utf8");
  const data = buildSampleData([], html, label);
  if (OVERRIDES[key]) OVERRIDES[key](data.details);
  const rendered = renderTemplate(Handlebars, html, data);
  const page = await browser.newPage();
  await page.setViewport({ width: 820, height: 1160, deviceScaleFactor: 2 });
  await page.setContent(rendered, { waitUntil: "load" });
  await page.screenshot({ path: path.join(OUT_DIR, `sample_${key}.png`), fullPage: true, type: "png" });
  await page.close();
  console.log("wrote", `docs/images/sample_${key}.png`);
}
await browser.close();
console.log("done");
