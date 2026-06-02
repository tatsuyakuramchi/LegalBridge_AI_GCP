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
import { LINE_ITEM_STATUS_DEFS } from "../services/conditionsService.ts";

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
table.cond tr.clickable { cursor: pointer; }
.link-pill { font-size: 10px; padding: 1px 5px; border-radius: 4px; border: 1px solid var(--border); display: inline-block; margin: 1px 0; white-space: nowrap; }
.link-pill.work { background: #eef2ff; }
.link-pill.ip { background: #ecfdf5; }
.link-pill.master { background: #fef3c7; }
.link-pill.ringi { background: #fce7f3; }
.link-pill.status { background: #dcfce7; border-color: #86efac; }
table.cond th.chk, table.cond td.chk { width: 34px; text-align: center; padding: 4px; }
.csvbtns { display: flex; gap: 6px; }
.modal .checks { display: flex; flex-direction: column; gap: 8px; }
.modal .checks label { display: flex; gap: 7px; align-items: center; font-size: 13px; font-weight: 500; color: var(--foreground); margin: 0; }
.modal .checks input { width: 15px; height: 15px; }
.backdrop { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: none; align-items: flex-start; justify-content: center; padding: 48px 16px; z-index: 60; overflow: auto; }
.backdrop.open { display: flex; }
.modal { background: var(--card); border-radius: 10px; width: 100%; max-width: 560px; box-shadow: 0 20px 50px rgba(0,0,0,.25); }
.modal .mhead { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.modal .mhead h3 { margin: 0; font-size: 15px; }
.modal .mbody { padding: 16px 18px; }
.modal .mfoot { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 18px; border-top: 1px solid var(--border); }
.modal .fld { margin-bottom: 14px; }
.modal .fld label { display: block; font-size: 12px; font-weight: 600; color: var(--muted-foreground); margin-bottom: 4px; }
.modal .meta { font-size: 11px; color: var(--muted-foreground); margin-bottom: 12px; line-height: 1.5; }
.xbtn { background: none; border: none; font-size: 20px; cursor: pointer; color: var(--muted-foreground); }
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

  <div class="toolbar" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:12px;">
    <span class="count-badge" id="count">—</span>
    <div class="csvbtns">
      <button class="btn outline" id="btn-csv-sel">選択をCSV (<span id="sel-n">0</span>)</button>
      <button class="btn outline" id="btn-csv-all">全件CSV</button>
    </div>
  </div>

  <div class="table-scroll">
    <div id="list-wrap"><div class="empty">LOADING…</div></div>
  </div>
</div>

<div class="backdrop" id="backdrop">
  <div class="modal">
    <div class="mhead"><h3>紐付けを編集</h3><button class="xbtn" id="m-close">×</button></div>
    <div class="mbody">
      <div class="meta" id="m-meta"></div>
      <div class="fld">
        <label>原作 (source IP)</label>
        <select class="tech-select" id="m-source"><option value="">— なし —</option></select>
      </div>
      <div class="fld">
        <label>作品 (work)</label>
        <select class="tech-select" id="m-work"><option value="">— なし —</option></select>
      </div>
      <div class="fld">
        <label>マスター契約 (基本契約 / 作品モデル v3)</label>
        <select class="tech-select" id="m-master"><option value="">— なし —</option></select>
      </div>
      <div class="fld">
        <label>稟議 (ringi)</label>
        <select class="tech-select" id="m-ringi"><option value="">— なし —</option></select>
      </div>
      <div class="fld">
        <label>状態</label>
        <div class="checks" id="m-status"></div>
      </div>
    </div>
    <div class="mfoot">
      <button class="btn outline" id="m-cancel">キャンセル</button>
      <button class="btn" id="m-save">保存</button>
    </div>
  </div>
</div>

<script>
  var API = "/api/conditions/search";
  var CAT_LABEL = { service: "業務委託", license: "ライセンス", license_in: "ライセンス(IN)", license_out: "ライセンス(OUT)", publication: "出版", sales: "売買", nda: "NDA" };
  var STATUS_DEFS = ${JSON.stringify(LINE_ITEM_STATUS_DEFS)};
  var currentRows = [];
  var PICK = { source: null, works: null, masters: null, ringi: null }; // ピッカーのキャッシュ

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
    currentRows = rows || [];
    var wrap = document.getElementById("list-wrap");
    if (!rows || rows.length === 0) {
      wrap.innerHTML = '<div class="empty">該当する条件明細がありません</div>';
      return;
    }
    var head = '<tr>' +
      '<th class="chk"><input type="checkbox" id="chk-all" title="全選択"></th>' +
      '<th>支払日</th><th>納期</th><th>種類</th><th>取引先</th><th>担当</th>' +
      '<th>品目</th><th>計算</th><th class="num">数量</th><th class="num">単価</th>' +
      '<th class="num">金額(税抜)</th><th>文書番号</th><th>契約名 / 課題</th>' +
      '<th>紐付け(クリックで編集)</th><th>状態</th>' +
      '</tr>';
    var body = rows.map(function (r) {
      var typeCell = '<span class="badge-cat">' + esc(catLabel(r.contract_category)) + '</span>' +
        (r.contract_type ? '<div style="font-size:10px;color:var(--muted-foreground);margin-top:2px;">' + esc(r.contract_type) + '</div>' : '');
      var vendor = esc(r.vendor_name || "—") + (r.vendor_code ? '<div style="font-size:10px;color:var(--muted-foreground);">' + esc(r.vendor_code) + '</div>' : '');
      var item = '<div>' + esc(r.item_name || "—") + '</div>' +
        (r.spec ? '<div style="font-size:10px;color:var(--muted-foreground);white-space:normal;">' + esc(r.spec) + '</div>' : '');
      var contract = esc(r.contract_title || "—") +
        (r.issue_key ? '<div style="font-size:10px;color:var(--muted-foreground);">' + esc(r.issue_key) + '</div>' : '');
      var link = "";
      if (r.work_title) link += '<span class="link-pill work">作 ' + esc(r.work_title) + '</span> ';
      if (r.source_ip_title) link += '<span class="link-pill ip">原 ' + esc(r.source_ip_title) + '</span> ';
      if (r.master_contract_title || r.master_contract_number)
        link += '<span class="link-pill master">基 ' + esc(r.master_contract_title || r.master_contract_number) + '</span> ';
      if (r.ringi_number || r.ringi_title)
        link += '<span class="link-pill ringi">稟 ' + esc(r.ringi_number ? (r.ringi_number + (r.ringi_title ? " " + r.ringi_title : "")) : r.ringi_title) + '</span>';
      if (!link) link = '<span style="color:var(--muted-foreground);">＋ 未設定</span>';
      var st = "";
      var sf = r.status_flags || {};
      STATUS_DEFS.forEach(function (d) {
        if (sf[d.key]) st += '<span class="link-pill status">' + esc(d.label) + '</span> ';
      });
      if (!st) st = '<span style="color:var(--muted-foreground);">—</span>';
      return '<tr class="clickable" data-id="' + r.id + '">' +
        '<td class="chk"><input type="checkbox" class="row-chk" value="' + r.id + '"></td>' +
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
        '<td class="wrap">' + link + '</td>' +
        '<td class="wrap">' + st + '</td>' +
        '</tr>';
    }).join("");
    wrap.innerHTML = '<table class="cond">' + head + body + '</table>';
    updateSelCount();
  }

  /* ---------- 選択(CSV)関連 ---------- */
  function checkedIds() {
    return Array.prototype.slice.call(document.querySelectorAll(".row-chk:checked"))
      .map(function (c) { return c.value; });
  }
  function updateSelCount() {
    var n = checkedIds().length;
    var el = document.getElementById("sel-n");
    if (el) el.textContent = n;
  }
  function csvExport(ids) {
    var p = gather();
    if (ids && ids.length) p.set("ids", ids.join(","));
    window.location.href = "/api/conditions/export?" + p.toString();
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

  /* ---------- 紐付け編集モーダル ---------- */
  var editingId = null;
  async function loadPickers() {
    if (PICK.source && PICK.works && PICK.masters && PICK.ringi) return;
    var get = function (u) {
      return fetch(u, { credentials: "same-origin" }).then(function (x) { return x.ok ? x.json() : []; }).catch(function () { return []; });
    };
    var r = await Promise.all([
      get("/api/v3/source-ips"), get("/api/v3/works"), get("/api/v3/contracts"),
      get("/api/conditions/ringi-options"),
    ]);
    PICK.source = Array.isArray(r[0]) ? r[0] : [];
    PICK.works = Array.isArray(r[1]) ? r[1] : [];
    // マスター契約 = contract_level === 'master'(level 不明な行も候補に含める)
    PICK.masters = (Array.isArray(r[2]) ? r[2] : []).filter(function (c) {
      var lv = c.contract_level || "";
      return lv === "master" || lv === "";
    });
    PICK.ringi = Array.isArray(r[3]) ? r[3] : [];
  }
  function fillSelect(sel, items, getVal, getLabel, selectedId) {
    var opts = ['<option value="">— なし —</option>'];
    items.forEach(function (it) {
      var v = getVal(it);
      opts.push('<option value="' + v + '"' + (String(v) === String(selectedId) ? " selected" : "") + ">" + esc(getLabel(it)) + "</option>");
    });
    sel.innerHTML = opts.join("");
  }
  async function openEdit(id) {
    var row = currentRows.filter(function (r) { return String(r.id) === String(id); })[0];
    if (!row) return;
    editingId = id;
    document.getElementById("m-meta").innerHTML =
      "品目: <b>" + esc(row.item_name || "—") + "</b><br>文書: " + esc(row.document_number || "—") +
      " / 取引先: " + esc(row.vendor_name || "—") +
      " / 支払日: " + esc(row.payment_date || "—");
    document.getElementById("backdrop").classList.add("open");
    await loadPickers();
    fillSelect(document.getElementById("m-source"), PICK.source || [],
      function (s) { return s.id; },
      function (s) { return (s.source_code ? s.source_code + " : " : "") + (s.title || ("#" + s.id)); },
      row.source_ip_id);
    fillSelect(document.getElementById("m-work"), PICK.works || [],
      function (w) { return w.id; },
      function (w) { return (w.work_code ? w.work_code + " : " : "") + (w.title || ("#" + w.id)); },
      row.work_id);
    fillSelect(document.getElementById("m-master"), PICK.masters || [],
      function (c) { return c.id; },
      function (c) { return (c.document_number ? c.document_number + " : " : "") + (c.contract_title || ("#" + c.id)); },
      row.master_contract_id);
    fillSelect(document.getElementById("m-ringi"), PICK.ringi || [],
      function (g) { return g.id; },
      function (g) { return (g.ringi_number ? g.ringi_number + " : " : "") + (g.title || ("#" + g.id)); },
      row.ringi_id);
    // 状態チェックボックス(STATUS_DEFS から動的生成)
    var sf = row.status_flags || {};
    document.getElementById("m-status").innerHTML = STATUS_DEFS.map(function (d) {
      return '<label><input type="checkbox" class="st-chk" value="' + esc(d.key) + '"' +
        (sf[d.key] ? " checked" : "") + ">" + esc(d.label) + "</label>";
    }).join("");
  }
  function closeModal() { document.getElementById("backdrop").classList.remove("open"); editingId = null; }
  async function saveLinks() {
    if (!editingId) return;
    var btn = document.getElementById("m-save");
    btn.disabled = true;
    try {
      var res = await fetch("/api/conditions/" + encodeURIComponent(editingId) + "/links", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_ip_id: document.getElementById("m-source").value || null,
          work_id: document.getElementById("m-work").value || null,
          master_contract_id: document.getElementById("m-master").value || null,
          ringi_id: document.getElementById("m-ringi").value || null,
          status_flags: (function () {
            var f = {};
            Array.prototype.slice.call(document.querySelectorAll("#m-status .st-chk"))
              .forEach(function (c) { if (c.checked) f[c.value] = true; });
            return f;
          })(),
        }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || data.ok === false) throw new Error(data.error || ("HTTP " + res.status));
      closeModal();
      load();
    } catch (e) {
      alert("保存に失敗しました: " + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- wiring ---------- */
  document.getElementById("btn-search").addEventListener("click", load);
  document.getElementById("btn-clear").addEventListener("click", clearAll);
  ["vendor", "owner", "q"].forEach(function (id) {
    document.getElementById(id).addEventListener("keydown", function (e) {
      if (e.key === "Enter") load();
    });
  });
  document.getElementById("list-wrap").addEventListener("click", function (e) {
    var t = e.target;
    // チェックボックス(行選択/全選択)はモーダルを開かない
    if (t && (t.classList.contains("row-chk") || t.id === "chk-all")) {
      if (t.id === "chk-all") {
        Array.prototype.slice.call(document.querySelectorAll(".row-chk"))
          .forEach(function (c) { c.checked = t.checked; });
      }
      updateSelCount();
      return;
    }
    var tr = t.closest ? t.closest("tr.clickable") : null;
    if (tr && tr.getAttribute("data-id")) openEdit(tr.getAttribute("data-id"));
  });
  document.getElementById("btn-csv-all").addEventListener("click", function () { csvExport(null); });
  document.getElementById("btn-csv-sel").addEventListener("click", function () {
    var ids = checkedIds();
    if (!ids.length) { alert("CSV出力する明細を選択してください(チェックボックス)。"); return; }
    csvExport(ids);
  });
  document.getElementById("m-close").addEventListener("click", closeModal);
  document.getElementById("m-cancel").addEventListener("click", closeModal);
  document.getElementById("m-save").addEventListener("click", saveLinks);
  document.getElementById("backdrop").addEventListener("click", function (e) {
    if (e.target === document.getElementById("backdrop")) closeModal();
  });
  load();
</script>
</body>
</html>`;
}
