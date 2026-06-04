/**
 * conditionsHtml — 条件明細(capability_line_items)の横断一覧・検索ページ。
 *
 *   GET /master/conditions  (requireIapUser)
 *   検索 API: GET /api/conditions/search?payment_from=&payment_to=&delivery_from=
 *             &delivery_to=&category=&vendor=&owner=&q=
 *
 * 検索軸: 支払日 / 納期 / 担当 / 種類(業務委託・ライセンス等) / 取引先。
 *
 * UI: search-api 共通テーマ popChrome(macOS風×ポップ)の view モード。
 *     検索性・閲覧性を優先しつつ、紐付け編集モーダルは残す。
 */

import { popPage } from "./popChrome.ts";
import { LINE_ITEM_STATUS_DEFS } from "../services/conditionsService.ts";

// 条件明細ページ固有の補助スタイル(共通 POP_CSS に無いリンクピル等)
const EXTRA_CSS = `<style>
.cond-link-pill{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:14px;display:inline-block;margin:1px 2px 1px 0;white-space:nowrap;border:1px solid transparent}
.cond-link-pill.work{background:#eef2ff;color:#4f46e5;border-color:#dfe3ff}
.cond-link-pill.ip{background:#ecfdf5;color:#0fa97c;border-color:#c8f4e4}
.cond-link-pill.master{background:#fff7e6;color:#b97a09;border-color:#ffe9bf}
.cond-link-pill.ringi{background:#fde9f3;color:#c43c80;border-color:#fbd0e6}
.cond-link-pill.status{background:#dffbf0;color:#0fa97c;border-color:#bbf2dd}
.sub10{font-size:10px;color:var(--muted);margin-top:2px}
.badge-cat{font-size:10.5px;font-weight:800;padding:2px 9px;border-radius:14px;background:#efeaff;color:#6c5ce7;white-space:nowrap}
.pop-modal .checks{display:flex;flex-direction:column;gap:9px}
.pop-modal .checks label{display:flex;gap:8px;align-items:center;font-size:13px;font-weight:600;color:var(--ink);margin:0}
.pop-modal .checks input{width:15px;height:15px}
.pop-modal .fld{margin-bottom:14px}
.pop-modal .fld label{display:block;font-size:11.5px;font-weight:800;color:var(--muted);margin-bottom:4px}
.pop-modal .meta{font-size:11.5px;color:var(--muted);margin-bottom:14px;line-height:1.6;background:#faf8ff;border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.filter-extra{display:flex;justify-content:flex-end;align-items:center}
.filter-extra label{display:flex;gap:6px;align-items:center;cursor:pointer;font-size:12px;color:var(--muted);font-weight:700}
</style>`;

export function conditionsPage(): string {
  const toolbar = `
      <button class="pop-btn sec sm" id="btn-csv-sel">⤓ 選択をCSV (<span id="sel-n">0</span>)</button>
      <button class="pop-btn sm" id="btn-csv-all">⤓ 全件CSV</button>`;

  const body = `
  <div class="pop-filters">
    <div class="f">
      <label>支払日</label>
      <div class="range"><input class="pop-input" type="date" id="payment_from"><span class="muted">〜</span><input class="pop-input" type="date" id="payment_to"></div>
    </div>
    <div class="f">
      <label>納期</label>
      <div class="range"><input class="pop-input" type="date" id="delivery_from"><span class="muted">〜</span><input class="pop-input" type="date" id="delivery_to"></div>
    </div>
    <div class="f">
      <label>種類</label>
      <select class="pop-select" id="category">
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
      <input class="pop-input" type="text" id="vendor" placeholder="例: 株式会社X / V-001">
    </div>
    <div class="f">
      <label>担当(作成者 / 氏名)</label>
      <input class="pop-input" type="text" id="owner" placeholder="例: 山田 / メール">
    </div>
    <div class="f" style="grid-column:span 2;">
      <label>キーワード(品目 / 仕様 / 契約名 / 文書番号)</label>
      <input class="pop-input" type="text" id="q" placeholder="フリーワード">
    </div>
    <div class="f" style="flex-direction:row;gap:8px;align-items:end;">
      <button class="pop-btn" id="btn-search">検索</button>
      <button class="pop-btn sec" id="btn-clear">クリア</button>
    </div>
    <div class="f filter-extra">
      <label><input type="checkbox" id="include_all"> 古い版・重複も表示</label>
    </div>
  </div>

  <div class="pop-toolbar2">
    <span class="count-badge" id="count">—</span>
    <span class="muted" style="font-size:12px;">行をクリックで紐付け(原作 / 作品 / 基本契約 / 稟議 / 状態)を編集</span>
  </div>

  <div class="pop-tablewrap">
    <div id="list-wrap"><div class="empty">LOADING…</div></div>
  </div>

<div class="pop-modal-backdrop" id="backdrop">
  <div class="pop-modal">
    <div class="mhead"><h3>紐付けを編集</h3><button class="xbtn" id="m-close">×</button></div>
    <div class="mbody">
      <div class="meta" id="m-meta"></div>
      <div class="fld">
        <label>原作 (source IP)</label>
        <select class="pop-select" id="m-source" style="width:100%;"><option value="">— なし —</option></select>
      </div>
      <div class="fld">
        <label>作品 (work)</label>
        <select class="pop-select" id="m-work" style="width:100%;"><option value="">— なし —</option></select>
      </div>
      <div class="fld">
        <label>マスター契約 (基本契約 / 作品モデル v3)</label>
        <select class="pop-select" id="m-master" style="width:100%;"><option value="">— なし —</option></select>
      </div>
      <div class="fld">
        <label>稟議 (ringi)</label>
        <select class="pop-select" id="m-ringi" style="width:100%;"><option value="">— なし —</option></select>
      </div>
      <div class="fld">
        <label>状態</label>
        <div class="checks" id="m-status"></div>
      </div>
      <div class="fld">
        <label>方向(in/out)</label>
        <select id="m-direction" class="pop-select" style="width:100%;">
          <option value="">(未設定)</option>
          <option value="in">イン — 当社が支払う(ライセンスイン/プロダクトイン・仕入)</option>
          <option value="out">アウト — 当社が受領する(ライセンスアウト/プロダクトアウト)</option>
        </select>
        <div class="muted" style="font-size:11px;">「アウト」にすると当社の受領明細として「請求権台帳(受領予定)」へ自動取込されます。</div>
      </div>
    </div>
    <div class="mfoot">
      <button class="pop-btn sec" id="m-cancel">キャンセル</button>
      <button class="pop-btn" id="m-save">保存</button>
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
    if (document.getElementById("include_all").checked) p.set("include_all", "1");
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
    var bodyHtml = rows.map(function (r) {
      var dir = (r.flow_direction === "in" || r.flow_direction === "out")
        ? r.flow_direction : (r.is_inbound ? "out" : "");
      var dirPill = dir === "out" ? ' <span class="cond-link-pill ip">アウト(受領)</span>'
        : dir === "in" ? ' <span class="cond-link-pill">イン(支払)</span>' : '';
      var typeCell = '<span class="badge-cat">' + esc(catLabel(r.contract_category)) + '</span>' + dirPill +
        (r.contract_type ? '<div class="sub10">' + esc(r.contract_type) + '</div>' : '');
      var vendor = esc(r.vendor_name || "—") + (r.vendor_code ? '<div class="sub10">' + esc(r.vendor_code) + '</div>' : '');
      var item = '<div>' + esc(r.item_name || "—") + '</div>' +
        (r.spec ? '<div class="sub10" style="white-space:normal;">' + esc(r.spec) + '</div>' : '');
      var contract = esc(r.contract_title || "—") +
        (r.issue_key ? '<div class="sub10">' + esc(r.issue_key) + '</div>' : '');
      var link = "";
      if (r.work_title) link += '<span class="cond-link-pill work">作 ' + esc(r.work_title) + '</span> ';
      if (r.source_ip_title) link += '<span class="cond-link-pill ip">原 ' + esc(r.source_ip_title) + '</span> ';
      if (r.master_contract_title || r.master_contract_number)
        link += '<span class="cond-link-pill master">基 ' + esc(r.master_contract_title || r.master_contract_number) + '</span> ';
      if (r.ringi_number || r.ringi_title)
        link += '<span class="cond-link-pill ringi">稟 ' + esc(r.ringi_number ? (r.ringi_number + (r.ringi_title ? " " + r.ringi_title : "")) : r.ringi_title) + '</span>';
      if (!link) link = '<span class="muted">＋ 未設定</span>';
      var st = "";
      var sf = r.status_flags || {};
      STATUS_DEFS.forEach(function (d) {
        if (sf[d.key]) st += '<span class="cond-link-pill status">' + esc(d.label) + '</span> ';
      });
      if (!st) st = '<span class="muted">—</span>';
      return '<tr class="clickable" data-id="' + r.id + '">' +
        '<td class="chk"><input type="checkbox" class="row-chk" value="' + r.id + '"></td>' +
        '<td>' + esc(r.payment_date || "—") + '</td>' +
        '<td>' + esc(r.delivery_date || "—") + '</td>' +
        '<td>' + typeCell + '</td>' +
        '<td class="wrap">' + vendor + '</td>' +
        '<td>' + esc(r.owner_name || "—") + '</td>' +
        '<td class="wrap">' + item + '</td>' +
        '<td>' + esc(r.calc_method || "") + (r.payment_terms ? '<div class="sub10">' + esc(r.payment_terms) + '</div>' : '') + '</td>' +
        '<td class="num">' + (r.quantity == null ? "" : esc(r.quantity)) + '</td>' +
        '<td class="num">' + yen(r.unit_price) + '</td>' +
        '<td class="num">' + yen(r.amount_ex_tax) + '</td>' +
        '<td>' + esc(r.document_number || "—") + '</td>' +
        '<td class="wrap">' + contract + '</td>' +
        '<td class="wrap">' + link + '</td>' +
        '<td class="wrap">' + st + '</td>' +
        '</tr>';
    }).join("");
    wrap.innerHTML = '<table class="pop-table">' + head + bodyHtml + '</table>';
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
    document.getElementById("include_all").checked = false;
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
    // 方向: flow_direction 優先、無ければ is_inbound から out を推定。
    document.getElementById("m-direction").value =
      row.flow_direction === "in" || row.flow_direction === "out"
        ? row.flow_direction
        : (row.is_inbound ? "out" : "");
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
          flow_direction: document.getElementById("m-direction").value,
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
  document.getElementById("include_all").addEventListener("change", load);
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
</script>`;

  return popPage({
    active: "conditions",
    mode: "view",
    title: "条件明細",
    subtitle: "支払日 / 納期 / 担当 / 種類 / 取引先で検索",
    toolbar,
    body,
    headExtra: EXTRA_CSS,
  });
}
