/**
 * conditionsHtml — 条件明細(capability_line_items)の横断一覧・検索ページ。
 *
 *   GET /master/conditions  (requireIapUser)
 *   検索 API: GET /api/conditions/search?payment_from=&payment_to=&delivery_from=
 *             &delivery_to=&category=&vendor=&owner=&q=
 *
 * 検索軸: 支払日 / 納期 / 担当 / 種類(業務委託・ライセンス等) / 取引先。
 */

import { HEAD_FONTS, MASTER_CSS, topbarHtml, masterTabsHtml } from "./masterChrome.ts";

const EXTRA_CSS = `
.filters {
  display: grid; gap: 10px 14px; align-items: end;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  background: var(--card); border: 1px solid var(--border); border-radius: 8px;
  padding: 14px 16px; margin-bottom: 14px;
}
.filters .f { display: flex; flex-direction: column; gap: 4px; }
.filters .f.span2 { grid-column: span 2; }
.filters label { font-size: 11px; color: var(--muted-foreground); font-weight: 600; }
.filters .range { display: flex; gap: 6px; align-items: center; }
.filters .range span { color: var(--muted-foreground); font-size: 11px; }
.filters .actions { display: flex; gap: 8px; align-items: end; }
table.cond { width: 100%; border-collapse: collapse; font-size: 12px; background: var(--card); }
table.cond th, table.cond td { border: 1px solid var(--border); padding: 6px 8px; text-align: left; vertical-align: top; white-space: nowrap; }
table.cond th { background: var(--muted); color: var(--muted-foreground); font-weight: 600; position: sticky; top: 0; }
table.cond td.num { text-align: right; font-variant-numeric: tabular-nums; }
table.cond td.wrap { white-space: normal; min-width: 180px; }
table.cond tr:hover td { background: var(--muted); }
.badge-cat { font-size: 10px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--background); white-space: nowrap; }
.empty { color: var(--muted-foreground); padding: 24px; text-align: center; }
.table-scroll { overflow: auto; max-height: calc(100vh - 320px); border: 1px solid var(--border); border-radius: 8px; }
`;

export function conditionsPage(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>条件明細 · Arcs Legal OS</title>
${HEAD_FONTS}
<style>${MASTER_CSS}${EXTRA_CSS}</style>
</head>
<body>
${topbarHtml("Conditions", "条件明細 · 支払日 / 納期 / 担当 / 種類 / 取引先で検索")}
${masterTabsHtml("conditions")}
<div class="container">
  <div class="filters">
    <div class="f">
      <label>支払日</label>
      <div class="range"><input class="tech-input" type="date" id="payment_from"><span>〜</span><input class="tech-input" type="date" id="payment_to"></div>
    </div>
    <div class="f">
      <label>納期</label>
      <div class="range"><input class="tech-input" type="date" id="delivery_from"><span>〜</span><input class="tech-input" type="date" id="delivery_to"></div>
    </div>
    <div class="f">
      <label>種類</label>
      <select class="tech-select" id="category">
        <option value="">全種類</option>
        <option value="service">業務委託</option>
        <option value="license">ライセンス</option>
        <option value="publication">出版</option>
        <option value="sales">売買</option>
        <option value="nda">NDA</option>
      </select>
    </div>
    <div class="f">
      <label>取引先(名称 / コード)</label>
      <input class="tech-input" type="text" id="vendor" placeholder="例: 株式会社X / V-001">
    </div>
    <div class="f">
      <label>担当(作成者 / 氏名)</label>
      <input class="tech-input" type="text" id="owner" placeholder="例: 山田 / メール">
    </div>
    <div class="f span2">
      <label>キーワード(品目 / 仕様 / 契約名 / 文書番号)</label>
      <input class="tech-input" type="text" id="q" placeholder="フリーワード">
    </div>
    <div class="f actions">
      <button class="btn" id="btn-search">検索</button>
      <button class="btn outline" id="btn-clear">クリア</button>
    </div>
  </div>

  <div class="toolbar" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <span class="count-badge" id="count">—</span>
    <span class="muted" style="font-size:11px;color:var(--muted-foreground);">明細行(capability_line_items)単位で表示</span>
  </div>

  <div class="table-scroll">
    <div id="list-wrap"><div class="empty">LOADING…</div></div>
  </div>
</div>

<script>
  var API = "/api/conditions/search";
  var CAT_LABEL = { service: "業務委託", license: "ライセンス", license_in: "ライセンス(IN)", license_out: "ライセンス(OUT)", publication: "出版", sales: "売買", nda: "NDA" };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function yen(n) {
    if (n == null || n === "") return "";
    var v = Number(n);
    return isFinite(v) ? v.toLocaleString("ja-JP") : esc(n);
  }
  function catLabel(c) { return CAT_LABEL[c] || (c || "—"); }

  function gather() {
    var ids = ["payment_from", "payment_to", "delivery_from", "delivery_to", "category", "vendor", "owner", "q"];
    var p = new URLSearchParams();
    ids.forEach(function (id) {
      var v = (document.getElementById(id).value || "").trim();
      if (v) p.set(id, v);
    });
    return p;
  }

  function render(rows) {
    var wrap = document.getElementById("list-wrap");
    if (!rows || rows.length === 0) {
      wrap.innerHTML = '<div class="empty">該当する条件明細がありません</div>';
      return;
    }
    var head = '<tr>' +
      '<th>支払日</th><th>納期</th><th>種類</th><th>取引先</th><th>担当</th>' +
      '<th>品目</th><th>計算</th><th class="num">数量</th><th class="num">単価</th>' +
      '<th class="num">金額(税抜)</th><th>文書番号</th><th>契約名 / 課題</th>' +
      '</tr>';
    var body = rows.map(function (r) {
      var typeCell = '<span class="badge-cat">' + esc(catLabel(r.contract_category)) + '</span>' +
        (r.contract_type ? '<div style="font-size:10px;color:var(--muted-foreground);margin-top:2px;">' + esc(r.contract_type) + '</div>' : '');
      var vendor = esc(r.vendor_name || "—") + (r.vendor_code ? '<div style="font-size:10px;color:var(--muted-foreground);">' + esc(r.vendor_code) + '</div>' : '');
      var item = '<div>' + esc(r.item_name || "—") + '</div>' +
        (r.spec ? '<div style="font-size:10px;color:var(--muted-foreground);white-space:normal;">' + esc(r.spec) + '</div>' : '');
      var contract = esc(r.contract_title || "—") +
        (r.issue_key ? '<div style="font-size:10px;color:var(--muted-foreground);">' + esc(r.issue_key) + '</div>' : '');
      return '<tr>' +
        '<td>' + esc(r.payment_date || "—") + '</td>' +
        '<td>' + esc(r.delivery_date || "—") + '</td>' +
        '<td>' + typeCell + '</td>' +
        '<td class="wrap">' + vendor + '</td>' +
        '<td>' + esc(r.owner_name || "—") + '</td>' +
        '<td class="wrap">' + item + '</td>' +
        '<td>' + esc(r.calc_method || "") + (r.payment_terms ? '<div style="font-size:10px;color:var(--muted-foreground);">' + esc(r.payment_terms) + '</div>' : '') + '</td>' +
        '<td class="num">' + (r.quantity == null ? "" : esc(r.quantity)) + '</td>' +
        '<td class="num">' + yen(r.unit_price) + '</td>' +
        '<td class="num">' + yen(r.amount_ex_tax) + '</td>' +
        '<td>' + esc(r.document_number || "—") + '</td>' +
        '<td class="wrap">' + contract + '</td>' +
        '</tr>';
    }).join("");
    wrap.innerHTML = '<table class="cond">' + head + body + '</table>';
  }

  async function load() {
    var wrap = document.getElementById("list-wrap");
    wrap.innerHTML = '<div class="empty">検索中…</div>';
    document.getElementById("count").textContent = "…";
    try {
      var res = await fetch(API + "?" + gather().toString(), { credentials: "same-origin" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      var rows = data.rows || [];
      document.getElementById("count").textContent =
        rows.length + " 件" + (data.total && data.total > rows.length ? " / 全 " + data.total + " 件" : "");
      render(rows);
    } catch (e) {
      wrap.innerHTML = '<div class="empty" style="color:#b91c1c;">読み込みに失敗しました: ' + esc(e && e.message ? e.message : e) + '</div>';
      document.getElementById("count").textContent = "—";
    }
  }

  function clearAll() {
    ["payment_from", "payment_to", "delivery_from", "delivery_to", "category", "vendor", "owner", "q"]
      .forEach(function (id) { document.getElementById(id).value = ""; });
    load();
  }

  document.getElementById("btn-search").addEventListener("click", load);
  document.getElementById("btn-clear").addEventListener("click", clearAll);
  ["vendor", "owner", "q"].forEach(function (id) {
    document.getElementById(id).addEventListener("keydown", function (e) {
      if (e.key === "Enter") load();
    });
  });
  load();
</script>
</body>
</html>`;
}
