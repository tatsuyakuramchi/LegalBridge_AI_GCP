/**
 * contractSearchHtml — Slack /法務検索 から飛ばす Web 詳細ページの
 * HTML 生成。
 *
 * ページ:
 *   - listPage(query, vendors[]): /search/vendor?q=<name> の一覧
 *   - detailPage(payload):        /search/vendor/:vendorId の詳細
 *
 * 設計方針:
 *   - 自己完結 HTML (外部 CSS / JS 依存なし) — Cloud Run の cold start
 *     と Slack モバイルからの即時表示を両立。
 *   - 法務文書らしい落ち着いた配色 (グレー + 微強調色)。
 *   - レスポンシブ (1 カラム / スマホ縦長対応)。
 *   - 全リンクは target=_blank で新タブ。
 */

import { popPage } from "./popChrome.ts";

function esc(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
/* グローバル body/* リセットは pop 共通テーマ(POP_CSS)に委譲。ここではページ固有のみ。 */
.container { max-width: 1100px; margin: 0 auto; padding: 0 0 24px; }
header.page-header {
  border-bottom: 2px solid #1f2937;
  padding-bottom: 12px;
  margin-bottom: 24px;
  display: flex; justify-content: space-between; align-items: baseline; gap: 16px;
  flex-wrap: wrap;
}
header.page-header h1 { font-size: 20px; font-weight: 700; margin: 0; }
header.page-header .breadcrumb {
  font-family: ui-monospace, "Cascadia Mono", Menlo, monospace;
  font-size: 11px; color: #6b7280;
  text-transform: uppercase; letter-spacing: 0.18em;
}
header.page-header .breadcrumb a { color: #2563eb; text-decoration: none; }
header.page-header .breadcrumb a:hover { text-decoration: underline; }

.vendor-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 16px 20px;
  margin-bottom: 20px;
}
.vendor-card.compact { cursor: default; }
.vendor-card.linkable:hover { border-color: #1f2937; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
.vendor-card h2 {
  font-size: 17px; font-weight: 700; margin: 0 0 8px 0;
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
}
.vendor-card .vendor-code {
  font-family: ui-monospace, monospace; font-size: 11px;
  background: #f3f4f6; color: #4b5563; padding: 2px 6px; border-radius: 3px;
}
.pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; font-size: 12px; }
.pill {
  display: inline-flex; align-items: center; gap: 4px;
  border: 1px solid #d1d5db; padding: 2px 8px; border-radius: 999px;
  font-family: ui-monospace, monospace;
}
.pill.executed { border-color: #10b981; background: #d1fae5; color: #065f46; }
.pill.empty { color: #9ca3af; }
.pill.count { background: #eff6ff; border-color: #bfdbfe; color: #1e3a8a; }

a.btn-link {
  display: inline-block;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.1em;
  color: #1f2937;
  background: #fff;
  border: 1px solid #1f2937;
  padding: 4px 10px; border-radius: 3px;
  text-decoration: none;
}
a.btn-link:hover { background: #1f2937; color: #fff; }

section.category-block {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 16px 20px;
  margin-bottom: 16px;
}
section.category-block h3 {
  font-size: 14px; margin: 0 0 12px 0;
  border-left: 4px solid #1f2937; padding-left: 8px;
  display: flex; align-items: baseline; gap: 8px;
}
section.category-block.basic h3 { border-left-color: #2563eb; }
section.category-block.individual h3 { border-left-color: #10b981; }
section.category-block.inspection h3 { border-left-color: #f59e0b; }
section.category-block.other h3 { border-left-color: #6b7280; }
section.category-block .count {
  font-family: ui-monospace, monospace; font-size: 11px; color: #6b7280;
  font-weight: normal;
}
table.docs {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
table.docs th {
  text-align: left;
  font-family: ui-monospace, monospace;
  font-size: 10px;
  text-transform: uppercase; letter-spacing: 0.15em;
  color: #6b7280; font-weight: 600;
  border-bottom: 2px solid #e5e7eb;
  padding: 6px 8px;
}
table.docs td {
  border-bottom: 1px solid #f3f4f6;
  padding: 8px;
  vertical-align: top;
}
table.docs td.docno {
  font-family: ui-monospace, monospace; font-size: 11px; color: #4b5563;
  white-space: nowrap;
}
table.docs td.title { font-weight: 500; }
table.docs td.status .badge {
  display: inline-block; padding: 1px 6px; border-radius: 3px;
  font-size: 10px; font-family: ui-monospace, monospace;
}
table.docs td.status .badge.executed { background: #d1fae5; color: #065f46; }
table.docs td.status .badge.draft { background: #fef3c7; color: #92400e; }
table.docs td.link a {
  color: #2563eb; text-decoration: none; font-size: 11px;
  font-family: ui-monospace, monospace;
}
table.docs td.link a:hover { text-decoration: underline; }
.empty-note { color: #9ca3af; font-size: 12px; padding: 8px 0; font-style: italic; }

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 0 28px;
  font-size: 12px;
  margin-top: 4px;
}
.info-grid .row {
  display: flex; gap: 10px; padding: 5px 0;
  border-bottom: 1px solid #f3f4f6;
}
.info-grid .row .k {
  color: #6b7280; min-width: 92px; flex-shrink: 0;
  font-family: ui-monospace, monospace; font-size: 11px;
}
.info-grid .row .v { color: #1f2937; word-break: break-word; }

form.search-form {
  display: flex; gap: 8px; margin-bottom: 24px;
}
form.search-form input {
  flex: 1; font-size: 14px; padding: 8px 12px;
  border: 1px solid #d1d5db; border-radius: 3px;
}
form.search-form button {
  font-size: 12px; font-family: ui-monospace, monospace;
  text-transform: uppercase; letter-spacing: 0.1em;
  padding: 8px 16px;
  background: #1f2937; color: #fff;
  border: none; border-radius: 3px;
  cursor: pointer;
}
.notfound {
  text-align: center; padding: 40px 20px; color: #6b7280; font-size: 13px;
  background: #fff; border: 1px dashed #e5e7eb; border-radius: 4px;
}
.footer {
  text-align: center; font-size: 10px; color: #9ca3af;
  margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb;
  font-family: ui-monospace, monospace;
  text-transform: uppercase; letter-spacing: 0.2em;
}
`;

function masterPill(label: string, master: any): string {
  if (master && master.exists) {
    const num = master.documentNumber ? ` (${esc(master.documentNumber)})` : "";
    return `<span class="pill executed">${esc(label)} ✓${num}</span>`;
  }
  return `<span class="pill empty">${esc(label)} —</span>`;
}

function infoRow(label: string, value: any): string {
  if (value == null || value === "") return "";
  return `<div class="row"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span></div>`;
}

/**
 * Phase 26.8: 取引先マスタの入力済み項目を全件カードで描画。
 * counterparty (buildCounterparty の戻り値) を受け取り、値が入っている
 * 項目のみを「全件」並べる。Slack /法務検索 → Web 詳細で
 * 「文書情報だけでなく取引先情報も表示」を満たすための区画。
 */
function vendorInfoCard(cp: any): string {
  if (!cp) return "";
  const yen = (n: any) =>
    n == null || n === "" ? "" : `¥${Number(n).toLocaleString("ja-JP")}`;
  const ppl = (n: any) =>
    n == null || n === "" ? "" : `${Number(n).toLocaleString("ja-JP")} 名`;
  const bool = (b: any) => (b === true ? "対象" : b === false ? "対象外" : "");
  const entity =
    cp.entityType === "corporate"
      ? "法人"
      : cp.entityType === "individual"
        ? "個人"
        : cp.entityType || "";
  const rows = [
    infoRow("正式名称", cp.vendorName),
    infoRow("コード", cp.vendorCode),
    infoRow("区分", entity),
    infoRow("屋号", cp.tradeName),
    infoRow("ペンネーム", cp.penName),
    infoRow("敬称", cp.vendorSuffix),
    infoRow("別名", cp.aliases),
    infoRow("法人番号", cp.corporateNumber),
    infoRow("登録番号", cp.invoiceRegistrationNumber),
    infoRow("適格請求書", bool(cp.isInvoiceIssuer)),
    infoRow("源泉徴収", bool(cp.withholdingEnabled)),
    infoRow("下請法", bool(cp.subcontractActApplicable)),
    infoRow("住所", cp.address),
    infoRow("電話", cp.phone),
    infoRow("メール", cp.email),
    infoRow("担当部署", cp.contactDepartment),
    infoRow("担当者", cp.contactName),
    infoRow("取引区分", cp.transactionCategory),
    infoRow("支払条件", cp.paymentTerms),
    infoRow("主要事業", cp.mainBusiness),
    infoRow("資本金", yen(cp.capitalYen)),
    infoRow("従業員数", ppl(cp.employeeCount)),
    infoRow("格付", cp.rating),
    infoRow("反社チェック", cp.antisocialCheckResult),
    infoRow("振込先銀行", cp.bankName),
    infoRow("支店", cp.branchName),
    infoRow("口座種別", cp.accountType),
    infoRow("口座番号", cp.accountNumber),
    infoRow("口座名義", cp.accountHolderKana),
    infoRow("基本契約参照", cp.masterContractRef),
    infoRow("マスタ更新日", cp.masterUpdatedAt),
  ].filter(Boolean);
  if (rows.length === 0) return "";
  return `
    <div class="vendor-card">
      <h2>🏢 取引先情報</h2>
      <div class="info-grid">${rows.join("")}</div>
    </div>`;
}

function statusBadge(status: string): string {
  if (!status) return "";
  const cls = status === "executed" ? "executed" : "draft";
  const label =
    status === "executed" ? "締結済" : status === "draft" ? "草案" : status;
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function categoryTable(rows: any[], cat: "basic" | "individual" | "inspection" | "other"): string {
  if (!rows || rows.length === 0) {
    return `<div class="empty-note">該当なし</div>`;
  }
  const headRow = `<tr>
    <th style="width: 30%">タイトル</th>
    <th style="width: 18%">番号</th>
    <th style="width: 12%">ステータス</th>
    <th style="width: 16%">Backlog 状態</th>
    <th style="width: 12%">有効期限</th>
    <th style="width: 12%">リンク</th>
  </tr>`;
  const bodyRows = rows
    .map((d) => {
      const title = d.contract_title || d.template_type || "(無題)";
      const docNo = d.document_number || "";
      const expiry = d.expiration_date || "";
      const linkCell = d.file_link
        ? `<a href="${esc(d.file_link)}" target="_blank" rel="noopener noreferrer">📄 開く</a>`
        : `<span style="color:#9ca3af">—</span>`;
      // Phase 17d: Backlog status (例: "クラウドサイン待ち")
      const backlogCell = d.backlog_status
        ? `<span class="badge draft">${esc(d.backlog_status)}</span>`
        : d.issue_key && !d.issue_key.startsWith("IMPORT-") && !d.issue_key.startsWith("MANUAL-")
          ? `<span style="color:#9ca3af; font-size:10px;">${esc(d.issue_key)}</span>`
          : `<span style="color:#9ca3af">—</span>`;
      return `<tr>
        <td class="title">${esc(title)}</td>
        <td class="docno">${esc(docNo)}</td>
        <td class="status">${statusBadge(d.contract_status)}</td>
        <td class="status">${backlogCell}</td>
        <td class="docno">${esc(expiry)}</td>
        <td class="link">${linkCell}</td>
      </tr>`;
    })
    .join("");
  return `<table class="docs"><thead>${headRow}</thead><tbody>${bodyRows}</tbody></table>`;
}

/**
 * Phase 17s: HMAC 短期署名 URL ヘルパー。
 *
 * server.ts が view 関数に「resourceId → QS文字列 (`exp=...&sig=...`)」
 * のクロージャを渡してくる。view 側はこれを呼んで内部リンクを組み立てる。
 *
 * 旧 token 文字列を受け取る互換シム (legacy mode) は authShim() で吸収:
 *   - signLink が渡されたらそれを使う (HMAC URL)
 *   - 旧 token (string) が渡されたら `token=<value>` を返す
 *   - 両方未指定なら空文字 (= 認可なしモード / dev)
 */
export type SignLink = (resourceId: string) => string;

interface AuthLinker {
  /** 任意 resourceId のためのクエリ文字列を返す (先頭の `?`/`&` なし) */
  qs(resourceId: string): string;
  /** form の hidden inputs として埋めたい場合 (再検索フォーム用) */
  hiddenInputs(resourceId: string): string;
}

function authShim(
  signLink: SignLink | string | null | undefined
): AuthLinker {
  // 新方式: 関数が来た
  if (typeof signLink === "function") {
    return {
      qs(resourceId) {
        try {
          return signLink(resourceId);
        } catch {
          return "";
        }
      },
      hiddenInputs(resourceId) {
        try {
          const qs = signLink(resourceId);
          if (!qs) return "";
          // qs は "exp=N&sig=X" 形式
          return qs
            .split("&")
            .filter(Boolean)
            .map((pair) => {
              const i = pair.indexOf("=");
              const k = i >= 0 ? pair.slice(0, i) : pair;
              const v = i >= 0 ? decodeURIComponent(pair.slice(i + 1)) : "";
              return `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`;
            })
            .join("");
        } catch {
          return "";
        }
      },
    };
  }
  // 旧方式: token string がそのまま渡された (legacy migration window)
  if (typeof signLink === "string" && signLink) {
    const token = signLink;
    return {
      qs(_resourceId) {
        return `token=${encodeURIComponent(token)}`;
      },
      hiddenInputs(_resourceId) {
        return `<input type="hidden" name="token" value="${esc(token)}">`;
      },
    };
  }
  // 認可なし (dev など)
  return {
    qs(_resourceId) {
      return "";
    },
    hiddenInputs(_resourceId) {
      return "";
    },
  };
}

/**
 * 検索結果一覧ページ (複数候補)。/search/vendor?q=<name>
 *
 * 第 3 引数は HMAC 署名URL生成関数 (新) OR 旧 LB_PORTAL_SECRET 文字列 (legacy)。
 */
export function listPage(
  query: string,
  results: any[],
  auth: SignLink | string | null | undefined
): string {
  const a = authShim(auth);
  const cards = results
    .map((c) => {
      const cp = c.counterparty || {};
      const masters = c.masterContracts || {};
      const cat = c.documentsByCategory || {
        basic: [],
        individual: [],
        inspection: [],
        other: [],
        total: 0,
      };
      const sub = a.qs(`vendor:${cp.vendorId}`);
      const detailUrl = `/search/vendor/${cp.vendorId}${sub ? `?${sub}` : ""}`;
      const entity =
        cp.entityType === "corporate"
          ? "法人"
          : cp.entityType === "individual"
            ? "個人"
            : cp.entityType || "";
      const idBits = [
        entity,
        cp.tradeName ? `屋号: ${cp.tradeName}` : "",
        cp.corporateNumber ? `法人番号 ${cp.corporateNumber}` : "",
        cp.invoiceRegistrationNumber ? `登録 ${cp.invoiceRegistrationNumber}` : "",
      ].filter(Boolean);
      return `
      <a href="${esc(detailUrl)}" style="display:block; text-decoration:none; color:inherit;">
        <div class="vendor-card linkable">
          <h2>
            ${esc(cp.vendorName || "-")}
            <span class="vendor-code">${esc(cp.vendorCode || "-")}</span>
          </h2>
          ${
            idBits.length
              ? `<div style="font-size:12px; color:#6b7280; margin-bottom:4px;">${esc(idBits.join(" · "))}</div>`
              : ""
          }
          <div class="pills">
            ${masterPill("業務委託", masters.service)}
            ${masterPill("ライセンス", masters.license)}
            ${masterPill("出版", masters.publication)}
          </div>
          <div class="pills" style="margin-top: 8px;">
            <span class="pill count">📁 基本 ${cat.basic?.length || 0}</span>
            <span class="pill count">📁 個別 ${cat.individual?.length || 0}</span>
            <span class="pill count">🧾 検収書 ${cat.inspection?.length || 0}</span>
            <span class="pill count">📁 その他 ${cat.other?.length || 0}</span>
          </div>
        </div>
      </a>`;
    })
    .join("");

  const body = `
  <div class="container">
    <form class="search-form" method="get" action="/search/vendor">
      <input type="text" name="q" value="${esc(query)}" placeholder="取引先名 / 屋号 / ベンダーコード" autofocus>
      ${a.hiddenInputs("list")}
      <button type="submit">再検索</button>
    </form>

    ${results.length > 0 ? cards : `<div class="notfound">該当する取引先が見つかりませんでした。</div>`}

    <div class="footer">LegalBridge · Search API · ${new Date().toISOString().slice(0, 10)}</div>
  </div>`;

  return popPage({
    active: "search-vendor",
    mode: "view",
    navGroups: "view",
    title: "取引先・契約検索",
    subtitle: `検索キーワード: 「${esc(query)}」 · ヒット ${results.length} 件`,
    body,
    headExtra: `<style>${STYLE}</style>`,
    contentBridge: true,
    pageTitle: `法務検索: 「${esc(query)}」の結果`,
  });
}

/**
 * 詳細ページ (1 vendor)。/search/vendor/:vendorId
 */
export function detailPage(
  payload: any,
  query: string,
  auth: SignLink | string | null | undefined
): string {
  const cp = payload.counterparty || {};
  const masters = payload.masterContracts || {};
  const cat = payload.documentsByCategory || {
    basic: [],
    individual: [],
    inspection: [],
    other: [],
    total: 0,
  };
  const a = authShim(auth);
  const listQs = a.qs("list");
  const backUrl = query
    ? `/search/vendor?q=${encodeURIComponent(query)}${listQs ? `&${listQs}` : ""}`
    : `/search/vendor${listQs ? `?${listQs}` : ""}`;

  const body = `
  <div class="container">
    <div class="breadcrumb" style="margin-bottom:12px;display:flex;gap:14px;flex-wrap:wrap;">
      <a href="${esc(backUrl)}">← 検索結果に戻る</a>
      <a href="/master/receivable-map">🔀 分配構造マップ</a>
    </div>

    <div class="vendor-card">
      <h2>📊 基本契約サマリー</h2>
      <div class="pills">
        ${masterPill("業務委託", masters.service)}
        ${masterPill("ライセンス", masters.license)}
        ${masterPill("出版", masters.publication)}
      </div>
    </div>

    ${vendorInfoCard(cp)}

    <section class="category-block basic">
      <h3>🟦 基本契約 <span class="count">(${cat.basic?.length || 0}件)</span></h3>
      ${categoryTable(cat.basic || [], "basic")}
    </section>

    <section class="category-block individual">
      <h3>🟩 個別契約 <span class="count">(${cat.individual?.length || 0}件)</span></h3>
      ${categoryTable(cat.individual || [], "individual")}
    </section>

    <section class="category-block inspection">
      <h3>🧾 検収書 <span class="count">(${cat.inspection?.length || 0}件)</span><span style="font-size:10px;color:#9ca3af;font-weight:normal;">※ 契約ではなく納品検収の記録</span></h3>
      ${categoryTable(cat.inspection || [], "inspection")}
    </section>

    <section class="category-block other">
      <h3>⬛ その他 <span class="count">(${cat.other?.length || 0}件)</span></h3>
      ${categoryTable(cat.other || [], "other")}
    </section>

    <div class="footer">LegalBridge · Search API · vendor #${esc(cp.vendorId || "-")}</div>
  </div>`;

  return popPage({
    active: "search-vendor",
    mode: "view",
    navGroups: "view",
    title: `${cp.vendorName || "-"}`,
    subtitle: `取引先コード: ${cp.vendorCode || "-"}`,
    body,
    headExtra: `<style>${STYLE}</style>`,
    contentBridge: true,
    pageTitle: `法務検索: ${esc(cp.vendorName || "-")}`,
  });
}

/**
 * Phase 17c: 稟議詳細ページ。/search/ringi/:number
 * 稟議ヘッダ情報 + 紐付く全文書を 3 カテゴリで表示。
 */
export function ringiPage(
  payload: any,
  auth: SignLink | string | null | undefined
): string {
  const r = payload.ringi || {};
  const cat = payload.documentsByCategory || {
    basic: [], individual: [], inspection: [], other: [], total: 0,
  };
  const a = authShim(auth);
  const listQs = a.qs("list");
  const backUrl = `/search/vendor${listQs ? `?${listQs}` : ""}`;
  const metaLines: string[] = [];
  if (r.category) metaLines.push(`カテゴリ: <strong>${esc(r.category)}</strong>`);
  if (r.owner_name) metaLines.push(`起案者: <strong>${esc(r.owner_name)}</strong>`);
  if (r.owner_department) metaLines.push(`部署: <strong>${esc(r.owner_department)}</strong>`);
  if (r.approved_at) metaLines.push(`承認日: <strong>${esc(r.approved_at)}</strong>`);
  if (r.status) metaLines.push(`状態: <strong>${esc(r.status)}</strong>`);
  if (r.total_budget)
    metaLines.push(`予算: <strong>¥${Number(r.total_budget).toLocaleString("ja-JP")}</strong>`);

  const body = `
  <div class="container">
    <div class="breadcrumb" style="margin-bottom:12px;">
      <a href="${esc(backUrl)}">← 検索に戻る</a>
    </div>

    <div class="vendor-card">
      <h2>📊 稟議サマリー</h2>
      <div class="pills">
        ${metaLines.map((m) => `<span class="pill">${m}</span>`).join("")}
      </div>
      ${r.remarks ? `<p style="margin-top:12px; font-size:12px; color:#4b5563;">${esc(r.remarks)}</p>` : ""}
    </div>

    <section class="category-block basic">
      <h3>🟦 基本契約 <span class="count">(${cat.basic?.length || 0}件)</span></h3>
      ${categoryTable(cat.basic || [], "basic")}
    </section>

    <section class="category-block individual">
      <h3>🟩 個別契約 <span class="count">(${cat.individual?.length || 0}件)</span></h3>
      ${categoryTable(cat.individual || [], "individual")}
    </section>

    <section class="category-block inspection">
      <h3>🧾 検収書 <span class="count">(${cat.inspection?.length || 0}件)</span><span style="font-size:10px;color:#9ca3af;font-weight:normal;">※ 契約ではなく納品検収の記録</span></h3>
      ${categoryTable(cat.inspection || [], "inspection")}
    </section>

    <section class="category-block other">
      <h3>⬛ その他 <span class="count">(${cat.other?.length || 0}件)</span></h3>
      ${categoryTable(cat.other || [], "other")}
    </section>

    <div class="footer">LegalBridge · Ringi · #${esc(r.ringi_number || "-")}</div>
  </div>`;

  return popPage({
    active: "search-vendor",
    mode: "view",
    navGroups: "view",
    title: `稟議 ${r.ringi_number || "-"}`,
    subtitle: r.title || "",
    body,
    headExtra: `<style>${STYLE}</style>`,
    contentBridge: true,
    pageTitle: `稟議 ${esc(r.ringi_number || "-")}: ${esc(r.title || "-")}`,
  });
}

/**
 * エラー / 認証失敗 / Not found 用のシンプル HTML。
 *
 * Phase 22.21.39: 改行 (\n) を <br> に変換するよう改良。
 *   呼び出し側は HTML タグを書かず \n を使うだけで段落分けできる。
 *   メール / role 等の動的値も先に esc() してから埋め込めば XSS 安全。
 */
export function errorPage(title: string, message: string, status = 404): string {
  // \n → <br> 変換。これ以外の HTML は全て escape される。
  const messageHtml = esc(message).replace(/\n/g, "<br>");
  // errorPage は認証前/403/404 でも出るため pop シェル(サイドバー)は付けず自己完結。
  // STYLE からグローバル body リセットを外したので、ここで最小限を補う。
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${esc(title)}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box}
    body{margin:0;padding:0;background:#f4f1fb;color:#241f3a;line-height:1.6;font-size:14px;
      font-family:-apple-system,"SF Pro Rounded","Hiragino Maru Gothic ProN","Hiragino Sans",system-ui,sans-serif}
    ${STYLE}
  </style>
</head>
<body>
  <div class="container" style="padding:24px 20px 48px;">
    <header class="page-header"><h1>${esc(title)}</h1></header>
    <div class="notfound">${messageHtml}</div>
    <div class="footer">LegalBridge · Search API · HTTP ${status}</div>
  </div>
</body>
</html>`;
}
