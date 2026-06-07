/**
 * workModelHtml — 作品中心(work-centric)新モデルの閲覧 + CRUD + CSV取込ページ。
 *
 * B1: もともと admin-ui(React)内に seed していた WorkModelPage を Search 側へ移設。
 *   /api/v3/* は search-api が提供するため、同一オリジンの client fetch で読む。
 *
 * 依存 endpoint(本サービス内):
 *   GET    /api/v3/{source-ips,works,contracts}            一覧
 *   GET    /api/v3/{source-ips,works,contracts}/:id        詳細(子コレクション込み)
 *   POST   /api/v3/{source-ips,works,contracts}            新規(admin)
 *   PUT    /api/v3/{source-ips,works,contracts}/:id        更新(admin)
 *   POST   /api/v3/import/:entity                          CSV一括取込(admin)
 *   GET    /api/v3/import/:entity/template.csv             サンプルCSV
 *
 * 認証: ルート側で requireIapUser。/api/v3 read=requireRead, write=requireWrite(admin)。
 */

import { popPage } from "./popChrome.ts";
import type { Role } from "../lib/screens.ts";

const STYLE = `
.shell { max-width: 1280px; margin: 0 auto; padding: 20px 24px 48px; }
.header {
  display: flex; align-items: end; justify-content: space-between; gap: 16px;
  border-bottom: 2px solid #111827; padding-bottom: 14px; margin-bottom: 18px;
  flex-wrap: wrap;
}
h1 { margin: 0; font-size: 22px; letter-spacing: .02em; }
.muted { color: #6b7280; font-size: 12px; }
.actions { display: flex; gap: 8px; align-items: center; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 12px; border: 1px solid #111827; border-radius: 4px;
  background: #111827; color: #fff; text-decoration: none; cursor: pointer;
  font-weight: 600; font-size: 13px; white-space: nowrap;
}
.btn.secondary { background: #fff; color: #111827; }
.btn.sm { padding: 4px 9px; font-size: 12px; }
.btn.ghost { background: #fff; color: #374151; border-color: #d1d5db; font-weight: 500; }
section.block { margin-top: 22px; }
section.block > h2 {
  font-size: 14px; margin: 0 0 10px; font-weight: 700; color: #0f172a;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
section.block > h2 .count {
  font-family: ui-monospace, monospace; font-size: 12px; color: #64748b; font-weight: 600;
}
section.block > h2 .spacer { flex: 1; }
.grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
.card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px;
  cursor: pointer; transition: border-color .12s, box-shadow .12s;
}
.card:hover { border-color: #111827; box-shadow: 0 1px 6px rgba(0,0,0,.08); }
.card .row1 { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.card .name { font-weight: 600; color: #0f172a; }
.card .sub { margin-top: 4px; font-size: 12px; color: #6b7280; }
.badge {
  font-family: ui-monospace, monospace; font-size: 11px; color: #334155;
  background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 2px 7px; white-space: nowrap;
}
.badge.outline { background: #fff; }
.empty { color: #94a3b8; font-size: 13px; padding: 8px 2px; }
#err { color: #b91c1c; font-size: 13px; margin-top: 8px; display: none; }

/* modal */
.backdrop {
  position: fixed; inset: 0; background: rgba(15,23,42,.45); display: none;
  align-items: flex-start; justify-content: center; padding: 40px 16px; z-index: 50; overflow: auto;
}
.backdrop.open { display: flex; }
.modal {
  background: #fff; border-radius: 10px; width: 100%; max-width: 760px;
  box-shadow: 0 20px 50px rgba(0,0,0,.25); overflow: hidden;
}
.modal .mhead {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 14px 18px; border-bottom: 1px solid #e5e7eb;
}
.modal .mhead h3 { margin: 0; font-size: 16px; }
.modal .mbody { padding: 16px 18px; max-height: 70vh; overflow: auto; }
.modal .mfoot {
  display: flex; gap: 8px; justify-content: flex-end; padding: 12px 18px; border-top: 1px solid #e5e7eb;
}
.x { background: none; border: none; font-size: 20px; cursor: pointer; color: #6b7280; line-height: 1; }
.field { margin-bottom: 12px; }
.field label { display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px; }
.field input[type=text], .field input[type=date], .field input[type=number], .field textarea, .field select {
  width: 100%; padding: 7px 9px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; font-family: inherit;
}
.field textarea { min-height: 60px; resize: vertical; }
.field .hint { font-size: 11px; color: #9ca3af; margin-top: 3px; }
dl.kv { margin: 0; display: grid; grid-template-columns: 160px 1fr; gap: 6px 12px; }
dl.kv dt { color: #6b7280; font-size: 12px; }
dl.kv dd { margin: 0; color: #111827; font-size: 13px; word-break: break-word; }
.sub-h { font-size: 12px; font-weight: 700; color: #0f172a; margin: 16px 0 6px; }
table.sub { width: 100%; border-collapse: collapse; font-size: 12px; }
table.sub th, table.sub td { border: 1px solid #e5e7eb; padding: 4px 7px; text-align: left; vertical-align: top; }
table.sub th { background: #f8fafc; color: #475569; font-weight: 600; white-space: nowrap; }
.result-stats { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
.result-stats .s { font-size: 13px; }
.result-stats .s b { font-size: 16px; }
.ok { color: #047857; } .skip { color: #b45309; } .bad { color: #b91c1c; }
.row-flex { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
`;

// 統合: 登録UIは admin-ui の作品モデル(React)に一本化し、Search Portal 側は
//   それを iframe で埋め込んで共有する。ADMIN_UI_URL 未設定時は旧コンソールに自動フォールバック。
export function workModelEmbedPage(role: Role = "viewer"): string {
  const admin = (process.env.ADMIN_UI_URL || "").replace(/\/+$/, "");
  if (!admin) return workModelPage(role); // フォールバック(旧バニラコンソール)
  const url = admin + "/master/work-model";
  const body = `
<div class="shell" style="display:flex;flex-direction:column;gap:10px;height:calc(100vh - 130px);">
  <div class="header"><div class="actions">
    <a class="btn secondary" href="/">← Search Portal に戻る</a>
    <a class="btn" href="${url}" target="_blank" rel="noopener">↗ 別タブで開く</a>
  </div></div>
  <iframe src="${url}" title="作品モデル"
          style="flex:1;width:100%;border:1px solid #e2e2e2;border-radius:8px;background:#fff;"></iframe>
  <p class="muted" style="font-size:11px;">作品モデルの登録・編集は admin-ui を埋め込んで表示しています（登録APIは search-api 所有）。表示されない場合は「↗ 別タブで開く」をご利用ください。</p>
</div>`;
  return popPage({
    active: "work-model",
    role,
    mode: "admin",
    title: "作品モデル",
    subtitle: "原作IP・自社作品・契約（admin-ui を埋め込み・登録は共通）",
    body,
    contentBridge: true,
  });
}

export function workModelPage(role: Role = "viewer"): string {
  const body = `
<div class="shell">
  <div class="header">
    <div class="actions">
      <button id="reloadBtn" class="btn">↻ 更新</button>
      <a class="btn secondary" href="/">← Search Portal に戻る</a>
    </div>
  </div>

  <div id="err"></div>

  <section class="block">
    <h2>📚 原作IP <span class="count" id="ipCount">…</span><span class="spacer"></span>
      <button class="btn sm add-btn" data-type="source-ips">＋ 新規</button>
      <button class="btn sm ghost imp-btn" data-type="source-ips">⇪ CSV取込</button>
    </h2>
    <div class="grid" id="ipGrid"></div>
  </section>

  <section class="block">
    <h2>🎲 自社作品 <span class="count" id="workCount">…</span><span class="spacer"></span>
      <button class="btn sm add-btn" data-type="works">＋ 新規</button>
      <button class="btn sm ghost imp-btn" data-type="works">⇪ CSV取込</button>
    </h2>
    <div class="grid" id="workGrid"></div>
  </section>

  <section class="block">
    <h2>📜 契約 <span class="count" id="contractCount">…</span><span class="spacer"></span>
      <button class="btn sm add-btn" data-type="contracts">＋ 新規</button>
      <button class="btn sm ghost imp-btn" data-type="contracts">⇪ CSV取込</button>
    </h2>
    <div class="grid" id="contractGrid"></div>
  </section>
</div>

<div class="backdrop" id="backdrop">
  <div class="modal">
    <div class="mhead"><h3 id="mTitle"></h3><button class="x" id="mClose">×</button></div>
    <div class="mbody" id="mBody"></div>
    <div class="mfoot" id="mFoot"></div>
  </div>
</div>

<script>
  var API = { "source-ips": "/api/v3/source-ips", "works": "/api/v3/works", "contracts": "/api/v3/contracts" };
  var LABEL = { "source-ips": "原作IP", "works": "自社作品", "contracts": "契約" };
  var WORKS_OPT = [];     // 作品ピッカー用(派生元 parent_work_id)
  var VENDORS_OPT = [];   // 取引先ピッカー用(vendor-select)。{ id, vendor_code, vendor_name }
  var FORM_EDIT_ID = null; // 編集中の自分自身を派生元候補から除外する用
  var DERIV_CHOICES = [["","(なし・原版)"],["translation","翻訳"],["edition","版"],["title_change","改題"],["localization","地域化"],["adaptation","翻案"]];

  // 各エンティティの編集/新規フォーム項目。type: text|textarea|date|bool|array|number|select|options|work-select|vendor-select
  //   ★ admin-ui(WorkModelPanel)の WORK_FIELDS / SCHEMA と項目・group を一致させる(統一化)。
  //   group でセクション分けして入力しやすくする。取引先は ID 直入力ではなく vendor-select(検索)。
  var SCHEMA = {
    "source-ips": [
      { name: "title", label: "タイトル", type: "text", required: true, group: "基本情報" },
      { name: "title_kana", label: "タイトル(カナ)", type: "text", group: "基本情報" },
      { name: "alternative_titles", label: "別タイトル(, 区切り)", type: "array", group: "基本情報" },
      { name: "division", label: "区分(, 区切り)", type: "array", hint: "例: BDG, PUB", group: "基本情報" },
      { name: "rights_holder_vendor_id", label: "権利者(取引先)", type: "vendor-select", hint: "取引先を名称/コードで検索して選択", group: "権利・既定値" },
      { name: "original_publisher", label: "原作出版社", type: "text", group: "権利・既定値" },
      { name: "default_rights_holder", label: "既定権利者", type: "text", group: "権利・既定値" },
      { name: "default_credit_display", label: "クレジット表記", type: "text", group: "権利・既定値" },
      { name: "default_work_supplement", label: "作品補足", type: "textarea", group: "権利・既定値" },
      { name: "default_approval_target", label: "承認対象", type: "text", group: "権利・既定値" },
      { name: "default_approval_timing", label: "承認タイミング", type: "text", group: "権利・既定値" },
      { name: "parent_work_id", label: "派生元(系譜)", type: "work-select", hint: "翻訳版・改題版などの派生元を選ぶ(原作IPは A原作→B翻訳 等)", group: "系譜・備考" },
      { name: "derivation_type", label: "派生種別", type: "options", choices: "DERIV", group: "系譜・備考" },
      { name: "remarks", label: "備考", type: "textarea", group: "系譜・備考" }
    ],
    "works": [
      { name: "title", label: "タイトル", type: "text", required: true, group: "基本情報" },
      { name: "title_kana", label: "タイトル(カナ)", type: "text", group: "基本情報" },
      { name: "alternative_titles", label: "別タイトル(, 区切り)", type: "array", group: "基本情報" },
      { name: "division", label: "区分(, 区切り)", type: "array", hint: "例: BDG, PUB", group: "基本情報" },
      { name: "work_type", label: "作品種別", type: "select", options: ["", "board_game", "trpg_book", "supplement", "digital"], group: "区分・状態" },
      { name: "status", label: "ステータス", type: "select", options: ["", "planning", "in_production", "released", "suspended", "discontinued"], group: "区分・状態" },
      { name: "parent_work_id", label: "派生元(系譜)", type: "work-select", hint: "翻訳版・改題版などの派生元を選ぶ(原作IPは A原作→B翻訳 等)", group: "系譜・備考" },
      { name: "derivation_type", label: "派生種別", type: "options", choices: "DERIV", group: "系譜・備考" },
      { name: "remarks", label: "備考", type: "textarea", group: "系譜・備考" }
    ],
    "contracts": [
      { name: "contract_title", label: "契約名", type: "text", required: true, group: "基本情報" },
      { name: "contract_level", label: "契約レベル", type: "select", options: ["", "master", "individual", "standalone"], group: "基本情報" },
      { name: "contract_category", label: "契約カテゴリ", type: "text", hint: "license_in / license_out / service / publication / sales / nda", group: "基本情報" },
      { name: "contract_type", label: "契約類型", type: "text", group: "基本情報" },
      { name: "lifecycle_stage", label: "ライフサイクル", type: "text", hint: "requested / under_review / executed 等", group: "基本情報" },
      { name: "primary_vendor_id", label: "主取引先", type: "vendor-select", hint: "取引先を名称/コードで検索して選択", group: "当事者・期間" },
      { name: "effective_date", label: "発効日", type: "date", group: "当事者・期間" },
      { name: "expiration_date", label: "満了日", type: "date", group: "当事者・期間" },
      { name: "auto_renewal", label: "自動更新", type: "bool", group: "当事者・期間" }
    ]
  };
  // 一覧カード用の表示(name/badge/sub の組み立て)
  function cardOf(type, x) {
    if (type === "source-ips") {
      return { id: x.id, name: x.title || ("#" + x.id), badge: x.source_code,
        sub: "権利者: " + (x.default_rights_holder || "—") + " / 素材 " + (x.material_count || 0) };
    }
    if (type === "works") {
      return { id: x.id, name: x.title || ("#" + x.id), badge: x.work_code,
        sub: (x.work_type || "—") + " / " + (x.status || "—") + " / 製品 " + (x.product_count || 0) };
    }
    return { id: x.id, name: x.contract_title || x.document_number || ("#" + x.id), badge: x.contract_level || "—",
      sub: (x.contract_category || "—") + " / " + (x.primary_vendor || "—") + " / " + (x.lifecycle_stage || "—") + " / 条件 " + (x.term_count || 0) };
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function showErr(msg) {
    var e = document.getElementById("err");
    e.style.display = "block"; e.textContent = msg;
  }
  async function getJson(url) {
    var r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error(url + " → HTTP " + r.status);
    return r.json();
  }
  async function sendJson(method, url, body) {
    var r = await fetch(url, {
      method: method, credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    var data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((data && (data.error || data.message)) || (method + " " + url + " → HTTP " + r.status));
    return data;
  }

  /* ---------- modal helpers ---------- */
  function openModal(title) {
    document.getElementById("mTitle").textContent = title;
    document.getElementById("backdrop").classList.add("open");
  }
  function closeModal() { document.getElementById("backdrop").classList.remove("open"); }
  function setFoot(buttons) {
    var f = document.getElementById("mFoot");
    f.innerHTML = "";
    buttons.forEach(function (b) {
      var el = document.createElement("button");
      el.className = "btn " + (b.cls || "");
      el.textContent = b.label;
      el.addEventListener("click", b.onClick);
      f.appendChild(el);
    });
  }

  /* ---------- list ---------- */
  function renderList(type, gridId, countId, items) {
    var grid = document.getElementById(gridId);
    document.getElementById(countId).textContent = "(" + items.length + ")";
    if (!items.length) { grid.innerHTML = '<div class="empty">データがありません</div>'; return; }
    grid.innerHTML = items.map(function (x) {
      var c = cardOf(type, x);
      // 作品カードには分配構造マップへのリンクを添える(クリックで詳細は開かない)。
      var mapLink = (type === "works")
        ? '<a class="badge outline" href="/master/receivable-map?work=' + c.id + '" ' +
          'onclick="event.stopPropagation()" title="分配構造マップ" style="text-decoration:none;">🔀 分配マップ</a>'
        : '';
      return '<div class="card" data-type="' + type + '" data-id="' + c.id + '">' +
        '<div class="row1"><div class="name">' + esc(c.name) + '</div>' +
        (c.badge ? '<span class="badge outline">' + esc(c.badge) + '</span>' : '') +
        '</div><div class="sub">' + esc(c.sub) + '</div>' +
        (mapLink ? '<div style="margin-top:8px;">' + mapLink + '</div>' : '') +
        '</div>';
    }).join("");
  }

  async function load() {
    document.getElementById("err").style.display = "none";
    ["ipCount", "workCount", "contractCount"].forEach(function (id) { document.getElementById(id).textContent = "…"; });
    try {
      var r = await Promise.all([getJson(API["source-ips"]), getJson(API["works"]), getJson(API["contracts"])]);
      WORKS_OPT = Array.isArray(r[1]) ? r[1] : [];
      // 取引先一覧(vendor-select 用)。失敗しても本体表示は続行。
      try {
        var vr = await getJson("/api/master/vendors");
        VENDORS_OPT = (Array.isArray(vr) ? vr : [])
          .filter(function (v) { return v && v.id; })
          .map(function (v) { return { id: Number(v.id), vendor_code: v.vendor_code || "", vendor_name: v.vendor_name || "" }; });
      } catch (e) { VENDORS_OPT = []; }
      renderList("source-ips", "ipGrid", "ipCount", r[0]);
      renderList("works", "workGrid", "workCount", r[1]);
      renderList("contracts", "contractGrid", "contractCount", r[2]);
    } catch (e) {
      showErr("読み込みに失敗しました: " + (e && e.message ? e.message : e));
    }
  }

  /* ---------- detail ---------- */
  function fmtVal(v) {
    if (v == null || v === "") return "—";
    if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
    if (typeof v === "boolean") return v ? "はい" : "いいえ";
    if (typeof v === "string" && v.length >= 10 && /^\\d{4}-\\d{2}-\\d{2}T/.test(v)) return v.slice(0, 10);
    return String(v);
  }
  function subTable(label, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return "";
    var cols = Object.keys(rows[0]).filter(function (k) { return k !== "id"; }).slice(0, 8);
    var head = "<tr>" + cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr>";
    var body = rows.map(function (rw) {
      return "<tr>" + cols.map(function (c) { return "<td>" + esc(fmtVal(rw[c])) + "</td>"; }).join("") + "</tr>";
    }).join("");
    return '<div class="sub-h">' + esc(label) + ' (' + rows.length + ')</div><table class="sub">' + head + body + "</table>";
  }
  var SUBKEYS = {
    "source-ips": [["materials", "素材 / 権利者台帳"]],
    "works": [["products", "製品"], ["rights", "権利台帳"], ["contracts", "紐づく契約"], ["payment_summary", "支払集計"]],
    "contracts": [["works", "対象作品 / IP"], ["parties", "当事者"], ["financial_terms", "財務条件"], ["line_items", "明細"], ["royalty_statements", "ロイヤリティ"]]
  };
  async function openDetail(type, id) {
    openModal(LABEL[type] + " 詳細");
    var body = document.getElementById("mBody");
    body.innerHTML = '<div class="muted">読み込み中…</div>';
    setFoot([{ label: "閉じる", cls: "ghost", onClick: closeModal }]);
    try {
      var obj = await getJson(API[type] + "/" + id);
      var dl = SCHEMA[type].map(function (f) {
        var disp;
        if (f.type === "vendor-select" && obj[f.name]) {
          var vm = VENDORS_OPT.filter(function (v) { return String(v.id) === String(obj[f.name]); })[0];
          disp = vm ? ((vm.vendor_code ? vm.vendor_code + " : " : "") + vm.vendor_name) : fmtVal(obj[f.name]);
        } else if (f.type === "work-select" && obj[f.name]) {
          var wm = WORKS_OPT.filter(function (w) { return String(w.id) === String(obj[f.name]); })[0];
          disp = wm ? ((wm.work_code ? wm.work_code + " : " : "") + (wm.title || ("#" + wm.id))) : fmtVal(obj[f.name]);
        } else {
          disp = fmtVal(obj[f.name]);
        }
        return "<dt>" + esc(f.label) + "</dt><dd>" + esc(disp) + "</dd>";
      }).join("");
      var codeKey = type === "source-ips" ? "source_code" : type === "works" ? "work_code" : "document_number";
      var head = '<dl class="kv"><dt>コード</dt><dd>' + esc(obj[codeKey] || "—") + "</dd>" + dl + "</dl>";
      var subs = (SUBKEYS[type] || []).map(function (p) { return subTable(p[1], obj[p[0]]); }).join("");
      body.innerHTML = head + subs;
      setFoot([
        { label: "✎ 編集", cls: "", onClick: function () { openForm(type, "edit", obj); } },
        { label: "閉じる", cls: "ghost", onClick: closeModal }
      ]);
    } catch (e) {
      body.innerHTML = '<div class="bad">取得失敗: ' + esc(e && e.message ? e.message : e) + "</div>";
    }
  }

  /* ---------- create / edit form ---------- */
  // 取引先 select の <option> 群を組み立てる。kw で絞り込み、選択中(sel)は常に残す。
  function vendorOptions(sel, kw) {
    kw = (kw || "").trim().toLowerCase();
    var selStr = sel == null ? "" : String(sel);
    var list = VENDORS_OPT.filter(function (v) {
      if (!kw) return true;
      return (String(v.vendor_code) + " " + String(v.vendor_name)).toLowerCase().indexOf(kw) >= 0;
    });
    // 選択中が絞り込みから外れても候補に残す(値が消えないように)
    var hasSel = !selStr || list.some(function (v) { return String(v.id) === selStr; });
    if (!hasSel) {
      var cur = VENDORS_OPT.filter(function (v) { return String(v.id) === selStr; });
      list = cur.concat(list);
    }
    list = list.slice(0, 80);
    var out = ['<option value="">(なし)</option>'];
    list.forEach(function (v) {
      var label = (v.vendor_code ? v.vendor_code + " : " : "") + (v.vendor_name || ("#" + v.id));
      out.push('<option value="' + v.id + '"' + (selStr === String(v.id) ? " selected" : "") + ">" + esc(label) + "</option>");
    });
    return out.join("");
  }
  function fieldHtml(f, val) {
    var v = val == null ? "" : val;
    var inner;
    if (f.type === "textarea") {
      inner = '<textarea id="f_' + f.name + '">' + esc(v) + "</textarea>";
    } else if (f.type === "bool") {
      inner = '<input type="checkbox" id="f_' + f.name + '"' + (v ? " checked" : "") + " style='width:auto'>";
    } else if (f.type === "select") {
      inner = '<select id="f_' + f.name + '">' + f.options.map(function (o) {
        return '<option value="' + esc(o) + '"' + (String(v) === o ? " selected" : "") + ">" + (o === "" ? "(未設定)" : esc(o)) + "</option>";
      }).join("") + "</select>";
    } else if (f.type === "options") {
      // value/label ペアの select(f.choices = "DERIV" 等のキー)
      var choices = f.choices === "DERIV" ? DERIV_CHOICES : (f.choices || []);
      inner = '<select id="f_' + f.name + '">' + choices.map(function (c) {
        return '<option value="' + esc(c[0]) + '"' + (String(v) === String(c[0]) ? " selected" : "") + ">" + esc(c[1]) + "</option>";
      }).join("") + "</select>";
    } else if (f.type === "work-select") {
      var opts = ['<option value="">(なし)</option>'];
      WORKS_OPT.forEach(function (w) {
        if (FORM_EDIT_ID && String(w.id) === String(FORM_EDIT_ID)) return; // 自分自身は除外
        opts.push('<option value="' + w.id + '"' + (String(v) === String(w.id) ? " selected" : "") + ">" +
          esc((w.work_code ? w.work_code + " : " : "") + (w.title || ("#" + w.id))) + "</option>");
      });
      inner = '<select id="f_' + f.name + '">' + opts.join("") + "</select>";
    } else if (f.type === "vendor-select") {
      // 取引先を ID 直入力ではなく「検索 + 選択」で。検索ボックスは選択肢を絞り込む。
      if (VENDORS_OPT.length === 0) {
        // 一覧取得に失敗したときは従来どおり ID 直接入力でフォールバック。
        inner = '<input type="number" id="f_' + f.name + '" value="' + esc(v) + '" placeholder="取引先ID(一覧取得不可)">';
      } else {
        inner =
          '<input type="text" class="vsel-q" data-target="f_' + f.name + '" placeholder="取引先を検索 (名称 / コード)…" style="margin-bottom:6px;">' +
          '<select id="f_' + f.name + '" class="vsel">' + vendorOptions(v) + "</select>";
      }
    } else if (f.type === "array") {
      inner = '<input type="text" id="f_' + f.name + '" value="' + esc(Array.isArray(v) ? v.join(", ") : v) + '">';
    } else if (f.type === "number") {
      inner = '<input type="number" id="f_' + f.name + '" value="' + esc(v) + '">';
    } else if (f.type === "date") {
      inner = '<input type="date" id="f_' + f.name + '" value="' + esc(String(v).slice(0, 10)) + '">';
    } else {
      inner = '<input type="text" id="f_' + f.name + '" value="' + esc(v) + '">';
    }
    return '<div class="field"><label>' + esc(f.label) + (f.required ? ' <span class="bad">*</span>' : "") + "</label>" +
      inner + (f.hint ? '<div class="hint">' + esc(f.hint) + "</div>" : "") + "</div>";
  }
  function gatherForm(type) {
    var out = {};
    SCHEMA[type].forEach(function (f) {
      var el = document.getElementById("f_" + f.name);
      if (!el) return;
      if (f.type === "bool") out[f.name] = el.checked;
      else if (f.type === "array") out[f.name] = el.value.split(/[,、]/).map(function (s) { return s.trim(); }).filter(Boolean);
      else if (f.type === "number" || f.type === "work-select" || f.type === "vendor-select") { var n = el.value.trim(); out[f.name] = n === "" ? null : Number(n); }
      else { var s = el.value.trim(); out[f.name] = s === "" ? null : s; }
    });
    return out;
  }
  // 入力しやすさのため group ごとにセクション見出しを付けて項目を並べる(定義順を維持)。
  function renderFormFields(type, data) {
    var order = [];
    var byGroup = {};
    SCHEMA[type].forEach(function (f) {
      var g = f.group || "";
      if (!byGroup[g]) { byGroup[g] = []; order.push(g); }
      byGroup[g].push(f);
    });
    return order.map(function (g) {
      var head = g
        ? '<div style="font-size:11px;font-weight:700;letter-spacing:.12em;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin:16px 0 10px;">' + esc(g) + "</div>"
        : "";
      return head + byGroup[g].map(function (f) { return fieldHtml(f, data[f.name]); }).join("");
    }).join("");
  }
  function openForm(type, mode, data) {
    data = data || {};
    FORM_EDIT_ID = (mode === "edit" && data.id) ? data.id : null;
    openModal((mode === "edit" ? "✎ 編集 — " : "＋ 新規 — ") + LABEL[type]);
    document.getElementById("mBody").innerHTML = renderFormFields(type, data);
    setFoot([
      { label: "キャンセル", cls: "ghost", onClick: closeModal },
      { label: "保存", cls: "", onClick: function () { saveForm(type, mode, data.id); } }
    ]);
  }
  async function saveForm(type, mode, id) {
    var payload = gatherForm(type);
    var titleField = type === "contracts" ? "contract_title" : "title";
    if (!payload[titleField]) { alert((type === "contracts" ? "契約名" : "タイトル") + "は必須です"); return; }
    try {
      if (mode === "edit") await sendJson("PUT", API[type] + "/" + id, payload);
      else await sendJson("POST", API[type], payload);
      closeModal();
      await load();
    } catch (e) {
      alert("保存に失敗しました: " + (e && e.message ? e.message : e));
    }
  }

  /* ---------- CSV import ---------- */
  function openImport(type) {
    openModal("⇪ CSV取込 — " + LABEL[type]);
    var tpl = "/api/v3/import/" + type + "/template.csv";
    document.getElementById("mBody").innerHTML =
      '<div class="field"><a class="btn sm ghost" href="' + tpl + '">⬇ サンプルCSVをダウンロード</a>' +
      '<div class="hint">UTF-8。日本語/英語ヘッダ対応。コード列が空なら自動採番されます。</div></div>' +
      '<div class="field"><label>CSVファイル</label><input type="file" id="imp_file" accept=".csv,text/csv"></div>' +
      '<div class="field"><label>または CSV を貼り付け</label><textarea id="imp_text" style="min-height:120px;font-family:ui-monospace,monospace;"></textarea></div>' +
      '<div class="row-flex">' +
        '<label style="font-size:13px;"><input type="checkbox" id="imp_dry" checked> ドライラン(検証のみ・書込なし)</label>' +
        '<label style="font-size:13px;">重複時: <select id="imp_dup"><option value="overwrite">上書き</option><option value="skip">スキップ</option><option value="fill_only">空欄のみ補完</option></select></label>' +
      '</div>' +
      '<div id="imp_result" style="margin-top:12px;"></div>';
    var fileEl = document.getElementById("imp_file");
    fileEl.addEventListener("change", function () {
      var file = fileEl.files && fileEl.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { document.getElementById("imp_text").value = String(reader.result || ""); };
      reader.readAsText(file, "UTF-8");
    });
    setFoot([
      { label: "閉じる", cls: "ghost", onClick: closeModal },
      { label: "実行", cls: "", onClick: function () { runImport(type); } }
    ]);
  }
  async function runImport(type) {
    var csv = document.getElementById("imp_text").value;
    var dry = document.getElementById("imp_dry").checked;
    var dup = document.getElementById("imp_dup").value;
    var box = document.getElementById("imp_result");
    if (!csv.trim()) { box.innerHTML = '<div class="bad">CSV が空です</div>'; return; }
    box.innerHTML = '<div class="muted">処理中…</div>';
    try {
      var r = await sendJson("POST", "/api/v3/import/" + type, { csv: csv, dry_run: dry, duplicate_mode: dup });
      var stats = '<div class="result-stats">' +
        '<div class="s">総数 <b>' + r.total + '</b></div>' +
        '<div class="s ok">成功 <b>' + r.succeeded + '</b></div>' +
        '<div class="s skip">スキップ <b>' + r.skipped + '</b></div>' +
        '<div class="s bad">失敗 <b>' + r.failed + '</b></div>' +
        '</div>';
      var banner = r.dry_run
        ? '<div class="skip" style="margin-bottom:8px;">🧪 ドライラン結果(DBには書き込んでいません)。問題なければドライランを外して再実行してください。</div>'
        : '<div class="ok" style="margin-bottom:8px;">✅ 取込完了。</div>';
      var errs = (r.errors && r.errors.length)
        ? '<div class="sub-h">エラー</div><table class="sub"><tr><th>行</th><th>内容</th></tr>' +
          r.errors.map(function (e) { return "<tr><td>" + e.row + "</td><td>" + esc(e.message) + "</td></tr>"; }).join("") + "</table>"
        : "";
      var prev = (r.preview && r.preview.length)
        ? subTable("プレビュー", r.preview)
        : "";
      box.innerHTML = banner + stats + errs + prev;
      if (!r.dry_run && r.succeeded > 0) await load();
    } catch (e) {
      box.innerHTML = '<div class="bad">取込に失敗しました: ' + esc(e && e.message ? e.message : e) + "</div>";
    }
  }

  /* ---------- wiring ---------- */
  // vendor-select の検索ボックス: 入力に応じて対象 select の選択肢を再構築(選択値は維持)。
  document.addEventListener("input", function (e) {
    var q = e.target && e.target.classList && e.target.classList.contains("vsel-q") ? e.target : null;
    if (!q) return;
    var sel = document.getElementById(q.getAttribute("data-target"));
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = vendorOptions(cur, q.value);
    sel.value = cur; // 現選択を維持
  });
  document.getElementById("reloadBtn").addEventListener("click", load);
  document.getElementById("mClose").addEventListener("click", closeModal);
  document.getElementById("backdrop").addEventListener("click", function (e) {
    if (e.target === document.getElementById("backdrop")) closeModal();
  });
  document.addEventListener("click", function (e) {
    var add = e.target.closest ? e.target.closest(".add-btn") : null;
    if (add) { openForm(add.getAttribute("data-type"), "new", {}); return; }
    var imp = e.target.closest ? e.target.closest(".imp-btn") : null;
    if (imp) { openImport(imp.getAttribute("data-type")); return; }
    var card = e.target.closest ? e.target.closest(".card") : null;
    if (card) { openDetail(card.getAttribute("data-type"), card.getAttribute("data-id")); }
  });
  load();
</script>`;

  return popPage({
    active: "work-model",
    role,
    mode: "admin",
    title: "作品モデル",
    subtitle: "原作IP・自社作品・契約を作品軸で閲覧 (新プラットフォーム /api/v3)",
    body,
    headExtra: `<style>${STYLE}</style>`,
    contentBridge: true,
  });
}
