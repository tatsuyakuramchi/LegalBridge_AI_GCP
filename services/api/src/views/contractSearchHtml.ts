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
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans",
               "Yu Gothic", sans-serif;
  margin: 0; padding: 0;
  color: #1f2937;
  background: #f8fafc;
  line-height: 1.6;
  font-size: 14px;
}
.container { max-width: 1100px; margin: 0 auto; padding: 24px 20px 48px; }
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

function statusBadge(status: string): string {
  if (!status) return "";
  const cls = status === "executed" ? "executed" : "draft";
  const label =
    status === "executed" ? "締結済" : status === "draft" ? "草案" : status;
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function categoryTable(rows: any[], cat: "basic" | "individual" | "other"): string {
  if (!rows || rows.length === 0) {
    return `<div class="empty-note">該当なし</div>`;
  }
  const headRow = `<tr>
    <th style="width: 38%">タイトル</th>
    <th style="width: 22%">番号</th>
    <th style="width: 14%">ステータス</th>
    <th style="width: 14%">有効期限</th>
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
      return `<tr>
        <td class="title">${esc(title)}</td>
        <td class="docno">${esc(docNo)}</td>
        <td class="status">${statusBadge(d.contract_status)}</td>
        <td class="docno">${esc(expiry)}</td>
        <td class="link">${linkCell}</td>
      </tr>`;
    })
    .join("");
  return `<table class="docs"><thead>${headRow}</thead><tbody>${bodyRows}</tbody></table>`;
}

/**
 * 検索結果一覧ページ (複数候補)。/search/vendor?q=<name>
 */
export function listPage(
  query: string,
  results: any[],
  token: string
): string {
  const tokenQS = token ? `&token=${encodeURIComponent(token)}` : "";
  const cards = results
    .map((c) => {
      const cp = c.counterparty || {};
      const masters = c.masterContracts || {};
      const cat = c.documentsByCategory || {
        basic: [],
        individual: [],
        other: [],
        total: 0,
      };
      const detailUrl = `/search/vendor/${cp.vendorId}?token=${encodeURIComponent(token)}`;
      return `
      <a href="${esc(detailUrl)}" style="display:block; text-decoration:none; color:inherit;">
        <div class="vendor-card linkable">
          <h2>
            ${esc(cp.vendorName || "-")}
            <span class="vendor-code">${esc(cp.vendorCode || "-")}</span>
          </h2>
          <div class="pills">
            ${masterPill("業務委託", masters.service)}
            ${masterPill("ライセンス", masters.license)}
            ${masterPill("出版", masters.publication)}
          </div>
          <div class="pills" style="margin-top: 8px;">
            <span class="pill count">📁 基本 ${cat.basic?.length || 0}</span>
            <span class="pill count">📁 個別 ${cat.individual?.length || 0}</span>
            <span class="pill count">📁 その他 ${cat.other?.length || 0}</span>
          </div>
        </div>
      </a>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>法務検索: 「${esc(query)}」の結果</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="container">
    <header class="page-header">
      <h1>📋 法務検索 — 結果一覧</h1>
      <div class="breadcrumb">
        検索キーワード: <strong>${esc(query)}</strong> ·
        ヒット件数: <strong>${results.length}</strong>
      </div>
    </header>

    <form class="search-form" method="get" action="/search/vendor">
      <input type="text" name="q" value="${esc(query)}" placeholder="取引先名 / 屋号 / ベンダーコード" autofocus>
      ${token ? `<input type="hidden" name="token" value="${esc(token)}">` : ""}
      <button type="submit">再検索</button>
    </form>

    ${results.length > 0 ? cards : `<div class="notfound">該当する取引先が見つかりませんでした。</div>`}

    <div class="footer">LegalBridge · Search API · ${new Date().toISOString().slice(0, 10)}</div>
  </div>
</body>
</html>`;
}

/**
 * 詳細ページ (1 vendor)。/search/vendor/:vendorId
 */
export function detailPage(payload: any, query: string, token: string): string {
  const cp = payload.counterparty || {};
  const masters = payload.masterContracts || {};
  const cat = payload.documentsByCategory || {
    basic: [],
    individual: [],
    other: [],
    total: 0,
  };
  const tokenQS = token ? `?token=${encodeURIComponent(token)}` : "";
  const backUrl = query
    ? `/search/vendor?q=${encodeURIComponent(query)}${token ? `&token=${encodeURIComponent(token)}` : ""}`
    : `/search/vendor${tokenQS}`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>法務検索: ${esc(cp.vendorName || "-")}</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="container">
    <header class="page-header">
      <h1>📋 ${esc(cp.vendorName || "-")} <span class="vendor-code">${esc(cp.vendorCode || "-")}</span></h1>
      <div class="breadcrumb">
        <a href="${esc(backUrl)}">← 検索結果に戻る</a>
      </div>
    </header>

    <div class="vendor-card">
      <h2>📊 基本契約サマリー</h2>
      <div class="pills">
        ${masterPill("業務委託", masters.service)}
        ${masterPill("ライセンス", masters.license)}
        ${masterPill("出版", masters.publication)}
      </div>
    </div>

    <section class="category-block basic">
      <h3>🟦 基本契約 <span class="count">(${cat.basic?.length || 0}件)</span></h3>
      ${categoryTable(cat.basic || [], "basic")}
    </section>

    <section class="category-block individual">
      <h3>🟩 個別契約 <span class="count">(${cat.individual?.length || 0}件)</span></h3>
      ${categoryTable(cat.individual || [], "individual")}
    </section>

    <section class="category-block other">
      <h3>⬛ その他 <span class="count">(${cat.other?.length || 0}件)</span></h3>
      ${categoryTable(cat.other || [], "other")}
    </section>

    <div class="footer">LegalBridge · Search API · vendor #${esc(cp.vendorId || "-")}</div>
  </div>
</body>
</html>`;
}

/**
 * エラー / 認証失敗 / Not found 用のシンプル HTML。
 */
export function errorPage(title: string, message: string, status = 404): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${esc(title)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="container">
    <header class="page-header"><h1>${esc(title)}</h1></header>
    <div class="notfound">${esc(message)}</div>
    <div class="footer">LegalBridge · Search API · HTTP ${status}</div>
  </div>
</body>
</html>`;
}
