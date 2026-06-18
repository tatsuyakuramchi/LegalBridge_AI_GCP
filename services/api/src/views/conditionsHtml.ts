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
import type { PopNavKey } from "./popChrome.ts";
import type { Role } from "../lib/screens.ts";
import { LINE_ITEM_STATUS_DEFS } from "../services/conditionsService.ts";

// 条件明細ページ固有の補助スタイル(共通 POP_CSS に無いリンクピル等)
const EXTRA_CSS = `<style>
.cond-link-pill{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:14px;display:inline-block;margin:1px 2px 1px 0;white-space:nowrap;border:1px solid transparent}
.cond-link-pill.work{background:#eef2ff;color:#4f46e5;border-color:#dfe3ff}
.cond-link-pill.ip{background:#ecfdf5;color:#0fa97c;border-color:#c8f4e4}
.cond-link-pill.master{background:#fff7e6;color:#b97a09;border-color:#ffe9bf}
.cond-link-pill.ringi{background:#fde9f3;color:#c43c80;border-color:#fbd0e6}
.cond-link-pill.status{background:#dffbf0;color:#0fa97c;border-color:#bbf2dd}
.fulfill-pill{font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:14px;display:inline-block;white-space:nowrap;border:1px solid #e3e3e3;background:#f4f4f5;color:#52525b}
.fulfill-pill.fulfilled{background:#dcfce7;color:#15803d;border-color:#bbf7d0}
.fulfill-pill.ongoing{background:#fef3c7;color:#b45309;border-color:#fde68a}
.fulfill-pill.dead{background:#f4f4f5;color:#9ca3af;border-color:#e5e7eb;text-decoration:line-through}
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
/* ツリー表示(作品/原作/取引先/部署 で分類。作品は IN/OUT 段あり) */
.view-switch{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0 0 10px}
.tree{font-size:12.5px}
.tnode{border-radius:10px}
.tnode>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px}
.tnode>summary::-webkit-details-marker{display:none}
.tnode>summary:hover{background:var(--hover)}
.tnode>summary .tw{flex:1;min-width:0;font-weight:800;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tnode>summary .cnt{background:#efeaff;color:#6c5ce7;border-radius:14px;padding:1px 9px;font-weight:800;font-size:11px;flex-shrink:0}
.tnode>summary .amt{color:var(--muted);font-variant-numeric:tabular-nums;min-width:120px;text-align:right;font-size:11.5px;flex-shrink:0}
.tnode>summary .caret{transition:transform .15s;color:var(--muted);font-size:11px;width:12px;flex-shrink:0}
.tnode[open]>summary .caret{transform:rotate(90deg)}
.tchildren{margin-left:16px;border-left:1px solid var(--line);padding-left:6px}
.tleaf{display:flex;align-items:center;gap:10px;padding:6px 8px;border-top:1px solid var(--line);cursor:pointer}
.tleaf:hover{background:var(--hover)}
.tleaf .d{width:80px;color:var(--muted);font-size:11px;flex-shrink:0;font-variant-numeric:tabular-nums}
.tleaf .nm{flex:1;min-width:0}
.tleaf .nm .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tleaf .nm .s{font-size:10.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tleaf .a{width:112px;text-align:right;font-weight:800;font-variant-numeric:tabular-nums;flex-shrink:0}
.dirpill{font-size:9.5px;font-weight:800;border-radius:12px;padding:1px 8px;white-space:nowrap;flex-shrink:0}
.dirpill.out{background:#ecfdf5;color:#0fa97c}
.dirpill.in{background:#eef2ff;color:#4f46e5}
.statpill{font-size:9.5px;font-weight:800;border-radius:12px;padding:1px 8px;white-space:nowrap;flex-shrink:0}
.statpill.s-ok{background:#ecfdf5;color:#0fa97c}
.statpill.s-term{background:#fef2f2;color:#dc2626;text-decoration:line-through}
.statpill.s-warn{background:#fff7e6;color:#b97a09}
.statpill.s-mut{background:#f1f0f6;color:#8a86a3}
.accent{width:4px;align-self:stretch;border-radius:3px;flex-shrink:0;min-height:18px}
</style>`;

export function conditionsPage(
  role: Role = "viewer",
  opts: { active?: PopNavKey; deptCode?: string | null; canEdit?: boolean } = {}
): string {
  // 編集(紐付けモーダル)は admin のみ。FIN viewer 等の閲覧専用ビューでは無効化。
  const canEdit = opts.canEdit ?? role === "admin";
  const toolbar = `
      ${canEdit ? '<button class="pop-btn sm" id="btn-autolink" title="原作/作品/基本契約/稟議を自動推定して空欄を補完(手動設定は温存)">🔗 自動紐付け</button>' : ""}
      ${canEdit ? '<button class="pop-btn sm" id="btn-autostatus" title="発注書締結済/検収書発行済/支払申請出力済 を実データから自動判定して同期(手動切替も可)">✅ 状態 自動判定</button>' : ""}
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
    <span class="muted" style="font-size:12px;">${canEdit ? "行をクリックで紐付け(原作 / 作品 / 基本契約 / 稟議 / 状態)を編集" : "閲覧専用ビュー(検索・CSV出力のみ)"}</span>
  </div>

  <div class="view-switch">
    <div class="pop-seg" id="view-seg">
      <button data-view="table" class="on">テーブル</button>
      <button data-view="tree">ツリー</button>
    </div>
    <div class="pop-seg" id="axis-seg" style="display:none;">
      <button data-axis="work" class="on">作品</button>
      <button data-axis="source_ip">原作</button>
      <button data-axis="vendor">取引先</button>
      <button data-axis="department">部署</button>
    </div>
    <div class="pop-seg" id="status-seg" style="display:none;">
      <button data-stat="all" class="on">すべて</button>
      <button data-stat="executed">有効中</button>
      <button data-stat="terminated">解約済</button>
    </div>
    <span class="muted" id="tree-hint" style="font-size:11.5px;display:none;">作品はイン(受けている権利/支払)・アウト(提供している権利/受領)で分岐</span>
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
  var CAN_EDIT = ${canEdit ? "true" : "false"}; // 閲覧専用ビューでは紐付け編集を無効化
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

  /* ---------- ツリー表示(作品/原作/取引先/部署) ---------- */
  var VIEW = "table";   // table | tree
  var AXIS = "work";    // work | source_ip | vendor | department
  var STATFILT = "all"; // all | executed(有効中) | terminated(解約済)
  var SORT = { key: null, dir: 1 }; // テーブル列の並び替え(key=行フィールド, dir=1昇順/-1降順)
  function draw() {
    if (VIEW === "tree") renderTree(currentRows, AXIS);
    else render(currentRows);
  }
  function dirOf(r) {
    if (r.flow_direction === "in" || r.flow_direction === "out") return r.flow_direction;
    if (r.is_inbound) return "out";
    var c = (r.contract_category || "").toLowerCase();
    if (/_in$/.test(c)) return "in";
    if (/_out$/.test(c)) return "out";
    return "";
  }
  function axisKey(axis, r) {
    if (axis === "work") return r.work_id != null ? "w:" + r.work_id : "none";
    if (axis === "source_ip") return r.source_ip_id != null ? "s:" + r.source_ip_id : "none";
    if (axis === "vendor") return (r.vendor_code || r.vendor_name) ? "v:" + (r.vendor_code || r.vendor_name) : "none";
    return r.department ? "d:" + r.department : "none";
  }
  function axisLabel(axis, r) {
    if (axis === "work") return r.work_title ? ((r.work_code ? r.work_code + " " : "") + r.work_title) : "（作品なし）";
    if (axis === "source_ip") return r.source_ip_title ? ((r.source_code ? r.source_code + " " : "") + r.source_ip_title) : "（原作なし）";
    if (axis === "vendor") return r.vendor_name || r.vendor_code || "（取引先なし）";
    return r.department || "（部署なし）";
  }
  function sumAmt(rows) { return rows.reduce(function (a, r) { return a + (Number(r.amount_ex_tax) || 0); }, 0); }
  // 契約状態(contract_status)。マスター(ContractsPanel)と同一語彙。
  var CSTAT = {
    draft: ["作成中", "s-mut"], awaiting_signature: ["締結待ち", "s-warn"],
    executed: ["締結中", "s-ok"], expired: ["満了", "s-mut"], terminated: ["解約済", "s-term"],
  };
  function statPill(r) {
    var s = r.contract_status; if (!s) return "";
    var m = CSTAT[s] || [s, "s-mut"];
    return '<span class="statpill ' + m[1] + '">' + esc(m[0]) + '</span>';
  }
  function leafHtml(r) {
    var dir = dirOf(r);
    var dp = dir === "out" ? '<span class="dirpill out">OUT 提供</span>'
      : dir === "in" ? '<span class="dirpill in">IN 受領中</span>' : '';
    var sub = [catLabel(r.contract_category), r.vendor_name, r.document_number]
      .filter(Boolean).map(esc).join(" · ");
    return '<div class="tleaf" data-id="' + r.id + '">' +
      '<span class="d">' + esc(r.payment_date || r.delivery_date || "—") + '</span>' +
      '<div class="nm"><div class="t">' + esc(r.item_name || r.contract_title || "—") + '</div>' +
      (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>' + statPill(r) + dp +
      '<span class="a">' + (r.amount_ex_tax != null ? "¥" + yen(r.amount_ex_tax) : "—") + '</span></div>';
  }
  function nodeHtml(label, rows, childrenHtml, opts) {
    opts = opts || {};
    var accent = opts.accent ? '<span class="accent" style="background:' + opts.accent + '"></span>' : '';
    return '<details class="tnode"' + (opts.open ? " open" : "") + '><summary>' +
      '<span class="caret">▶</span>' + accent +
      '<span class="tw">' + esc(label) + '</span>' +
      '<span class="cnt">' + rows.length + '</span>' +
      '<span class="amt">¥' + yen(sumAmt(rows)) + '</span></summary>' +
      '<div class="tchildren">' + childrenHtml + '</div></details>';
  }
  function renderTree(rows, axis) {
    var wrap = document.getElementById("list-wrap");
    if (STATFILT !== "all") rows = (rows || []).filter(function (r) { return r.contract_status === STATFILT; });
    if (!rows || !rows.length) { wrap.innerHTML = '<div class="empty">該当する条件明細がありません</div>'; return; }
    var groups = {}, order = [];
    rows.forEach(function (r) {
      var k = axisKey(axis, r);
      if (!groups[k]) { groups[k] = { label: axisLabel(axis, r), rows: [] }; order.push(k); }
      groups[k].rows.push(r);
    });
    order.sort(function (a, b) { return groups[b].rows.length - groups[a].rows.length; });
    var html = order.map(function (k) {
      var g = groups[k];
      if (axis !== "work") return nodeHtml(g.label, g.rows, g.rows.map(leafHtml).join(""), {});
      var outR = g.rows.filter(function (r) { return dirOf(r) === "out"; });
      var inR = g.rows.filter(function (r) { return dirOf(r) === "in"; });
      var naR = g.rows.filter(function (r) { return dirOf(r) === ""; });
      var kids = "";
      if (outR.length) kids += nodeHtml("OUT ・ 当社が提供している権利（受領）", outR, outR.map(leafHtml).join(""), { accent: "#0fa97c", open: true });
      if (inR.length) kids += nodeHtml("IN ・ 当社が受けている権利（支払）", inR, inR.map(leafHtml).join(""), { accent: "#4f46e5", open: true });
      if (naR.length) kids += nodeHtml("方向未設定", naR, naR.map(leafHtml).join(""), { accent: "#cbd5e1" });
      return nodeHtml(g.label, g.rows, kids, {});
    }).join("");
    wrap.innerHTML = '<div class="tree">' + html + '</div>';
  }

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

  // 列見出しクリックでテーブルを並び替え(同列再クリックで昇順/降順トグル)。
  function applySort(key, type) {
    if (!key) return;
    if (SORT.key === key) SORT.dir = -SORT.dir;
    else { SORT.key = key; SORT.dir = 1; }
    var d = SORT.dir;
    currentRows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      var ae = (av == null || av === ""), be = (bv == null || bv === "");
      if (ae && be) return 0;
      if (ae) return 1;   // 空は常に末尾
      if (be) return -1;
      if (type === "num") return ((parseFloat(av) || 0) - (parseFloat(bv) || 0)) * d;
      return String(av).localeCompare(String(bv), "ja") * d;
    });
    render(currentRows);
  }

  function render(rows) {
    currentRows = rows || [];
    var wrap = document.getElementById("list-wrap");
    if (!rows || rows.length === 0) {
      wrap.innerHTML = '<div class="empty">該当する条件明細がありません</div>';
      return;
    }
    // 並び替え可能な列見出し。data-sort=行フィールド, data-type=str|num|date。
    function thc(label, key, type, cls) {
      var ind = SORT.key === key ? (SORT.dir > 0 ? ' ▲' : ' ▼') : '';
      var c = cls ? (' class="' + cls + '"') : '';
      return '<th' + c + ' data-sort="' + key + '" data-type="' + (type || 'str') +
        '" style="cursor:pointer;user-select:none;white-space:nowrap;" title="クリックで並び替え">' +
        label + '<span class="sort-ind">' + ind + '</span></th>';
    }
    var head = '<tr>' +
      '<th class="chk"><input type="checkbox" id="chk-all" title="全選択"></th>' +
      thc('支払日', 'payment_date', 'date') + thc('納期', 'delivery_date', 'date') +
      thc('種類', 'contract_category', 'str') + thc('取引先', 'vendor_name', 'str') +
      thc('担当', 'owner_name', 'str') + thc('品目', 'item_name', 'str') +
      thc('計算', 'calc_method', 'str') + thc('数量', 'quantity', 'num', 'num') +
      thc('単価', 'unit_price', 'num', 'num') + thc('金額(税抜)', 'amount_ex_tax', 'num', 'num') +
      thc('文書番号', 'document_number', 'str') + thc('成就', 'fulfillment_status', 'str') +
      '<th>成就文書</th><th>送信</th>' + thc('契約名 / 課題', 'contract_title', 'str') +
      '<th>紐付け' + (CAN_EDIT ? '(クリックで編集)' : '') + '</th><th>状態</th>' +
      '</tr>';
    // 成就状態 → ラベル(契約期間型は 履行中 / 成就(満了))。
    var FULFILL_LABEL = {
      open: "未成就", partially_fulfilled: "一部成就", fulfilled: "成就",
      pending: "開始前", active: "履行中", expired: "成就(満了)",
      cancelled: "取消", closed_short: "中途終了"
    };
    function fulfillBadge(s) {
      if (!s) return '<span class="muted">—</span>';
      var label = FULFILL_LABEL[s] || s;
      var done = (s === "fulfilled" || s === "expired");           // 成就 / 成就(満了)
      var ongoing = (s === "partially_fulfilled" || s === "active");
      var dead = (s === "cancelled" || s === "closed_short");
      var cls = done ? "fulfilled" : ongoing ? "ongoing" : dead ? "dead" : "";
      return '<span class="fulfill-pill ' + cls + '">' + esc(label) + '</span>';
    }
    function fulfillDocCell(r) {
      if (!r.fulfilling_doc_number) return '<span class="muted">—</span>';
      var more = (r.fulfilling_doc_count && r.fulfilling_doc_count > 1)
        ? '<span class="sub10">ほか' + (r.fulfilling_doc_count - 1) + '件</span>' : '';
      return esc(r.fulfilling_doc_number) + more;
    }
    // 送信履歴: メール送信済 → 送信日時 + 送信先 / CloudSign 送信済 → クラウドサイン。
    function fmtJst(iso) {
      if (!iso) return "";
      try {
        return new Date(iso).toLocaleString("ja-JP", {
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo"
        });
      } catch (e) { return iso; }
    }
    function sendCell(r) {
      if (r.send_email_sent_at) {
        return '<span class="cond-link-pill" style="border-color:#34d399;color:#047857;">✉ メール</span>' +
          '<div class="sub10">' + esc(fmtJst(r.send_email_sent_at)) + '</div>' +
          (r.send_email_to ? '<div class="sub10">' + esc(r.send_email_to) + '</div>' : '');
      }
      if (r.send_cloudsign_sent_at) {
        return '<span class="cond-link-pill" style="border-color:#38bdf8;color:#0369a1;">✍ クラウドサイン</span>' +
          '<div class="sub10">' + esc(fmtJst(r.send_cloudsign_sent_at)) + '</div>';
      }
      return '<span class="muted">—</span>';
    }
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
        '<td>' + fulfillBadge(r.fulfillment_status) + '</td>' +
        '<td class="wrap">' + fulfillDocCell(r) + '</td>' +
        '<td class="wrap">' + sendCell(r) + '</td>' +
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
      currentRows = rows;
      draw();
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
    // 列見出しクリック → 並び替え(編集権限に関係なく動作)。
    var th = t.closest ? t.closest("th[data-sort]") : null;
    if (th) { applySort(th.getAttribute("data-sort"), th.getAttribute("data-type")); return; }
    // チェックボックス(行選択/全選択)はモーダルを開かない
    if (t && (t.classList.contains("row-chk") || t.id === "chk-all")) {
      if (t.id === "chk-all") {
        Array.prototype.slice.call(document.querySelectorAll(".row-chk"))
          .forEach(function (c) { c.checked = t.checked; });
      }
      updateSelCount();
      return;
    }
    if (!CAN_EDIT) return; // 閲覧専用: 行クリックでの編集を無効化(チェックボックス選択は上で処理済)
    var leaf = t.closest ? t.closest(".tleaf") : null;
    if (leaf && leaf.getAttribute("data-id")) { openEdit(leaf.getAttribute("data-id")); return; }
    var tr = t.closest ? t.closest("tr.clickable") : null;
    if (tr && tr.getAttribute("data-id")) openEdit(tr.getAttribute("data-id"));
  });

  /* ---------- 表示モード/切り口の切替 ---------- */
  function setSeg(segId, attr, val) {
    Array.prototype.slice.call(document.querySelectorAll("#" + segId + " button")).forEach(function (b) {
      b.classList.toggle("on", b.getAttribute(attr) === val);
    });
  }
  document.getElementById("view-seg").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    VIEW = b.getAttribute("data-view"); setSeg("view-seg", "data-view", VIEW);
    var tree = VIEW === "tree";
    document.getElementById("axis-seg").style.display = tree ? "" : "none";
    document.getElementById("status-seg").style.display = tree ? "" : "none";
    document.getElementById("tree-hint").style.display = (tree && AXIS === "work") ? "" : "none";
    draw();
  });
  document.getElementById("status-seg").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    STATFILT = b.getAttribute("data-stat"); setSeg("status-seg", "data-stat", STATFILT);
    draw();
  });
  document.getElementById("axis-seg").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    AXIS = b.getAttribute("data-axis"); setSeg("axis-seg", "data-axis", AXIS);
    document.getElementById("tree-hint").style.display = (AXIS === "work") ? "" : "none";
    draw();
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

  /* ---------- 自動紐付け(admin のみ) ---------- */
  function postJSON(url, body) {
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  function autoLink() {
    var btn = document.getElementById("btn-autolink");
    if (!btn) return;
    var sel = checkedIds();
    var ids = (sel.length ? sel : (currentRows || []).map(function (r) { return r.id; }))
      .map(Number).filter(function (n) { return !isNaN(n); });
    if (!ids.length) { alert("対象の明細がありません。先に検索してください。"); return; }
    var scope = sel.length ? ("選択した " + ids.length + " 行") : ("表示中の " + ids.length + " 行");
    btn.disabled = true;
    // 1) まず提案(dry-run)。
    postJSON("/api/conditions/auto-link", { ids: ids, dryRun: true })
      .then(function (d) {
        if (!d || d.ok === false) throw new Error((d && d.error) || "提案の取得に失敗");
        var c = d.counts || {};
        if (!d.changed) { alert(scope + "に紐付け候補は見つかりませんでした。"); return null; }
        var msg = "【自動紐付けの候補】" + scope + "が対象\\n"
          + d.changed + " 行に候補があります(空欄のみ補完・手動設定は温存):\\n"
          + "・基本契約 " + (c.master || 0) + " / 作品 " + (c.work || 0)
          + " / 原作 " + (c.source_ip || 0) + " / 稟議 " + (c.ringi || 0) + "\\n\\n適用しますか?";
        if (!confirm(msg)) return null;
        // 2) 適用。
        return postJSON("/api/conditions/auto-link", { ids: ids, dryRun: false }).then(function (r) {
          if (!r || r.ok === false) throw new Error((r && r.error) || "適用に失敗");
          alert("自動紐付けを適用しました(" + r.changed + " 行を更新)。");
          load();
        });
      })
      .catch(function (e) { alert("自動紐付けエラー: " + (e && e.message ? e.message : e)); })
      .then(function () { btn.disabled = false; });
  }
  var _alb = document.getElementById("btn-autolink");
  if (_alb) _alb.addEventListener("click", autoLink);

  /* ---------- 状態の自動判定(完全同期 / admin のみ) ---------- */
  function autoStatus() {
    var btn = document.getElementById("btn-autostatus");
    if (!btn) return;
    var sel = checkedIds();
    var ids = (sel.length ? sel : (currentRows || []).map(function (r) { return r.id; }))
      .map(Number).filter(function (n) { return !isNaN(n); });
    if (!ids.length) { alert("対象の明細がありません。先に検索してください。"); return; }
    var scope = sel.length ? ("選択した " + ids.length + " 行") : ("表示中の " + ids.length + " 行");
    btn.disabled = true;
    postJSON("/api/conditions/auto-status", { ids: ids, dryRun: true })
      .then(function (d) {
        if (!d || d.ok === false) throw new Error((d && d.error) || "提案の取得に失敗");
        if (!d.changed) { alert(scope + "は既に実態と一致しています(変更なし)。"); return null; }
        var on = d.on || {}, off = d.off || {};
        var pe = d.payment_evidence === false ? "\\n※支払出力の証拠が取得できないため payment は据え置き" : "";
        var msg = "【状態の自動判定(完全同期)】" + scope + "が対象\\n"
          + d.changed + " 行を実態に同期します:\\n"
          + "ON  → 締結 " + (on.po_signed || 0) + " / 検収 " + (on.inspection_issued || 0) + " / 支払 " + (on.payment_exported || 0) + "\\n"
          + "OFF → 締結 " + (off.po_signed || 0) + " / 検収 " + (off.inspection_issued || 0) + " / 支払 " + (off.payment_exported || 0) + "\\n"
          + "(証拠の無い手動ONはOFFになります)" + pe + "\\n\\n適用しますか?";
        if (!confirm(msg)) return null;
        return postJSON("/api/conditions/auto-status", { ids: ids, dryRun: false }).then(function (r) {
          if (!r || r.ok === false) throw new Error((r && r.error) || "適用に失敗");
          alert("状態を同期しました(" + r.changed + " 行を更新)。");
          load();
        });
      })
      .catch(function (e) { alert("状態自動判定エラー: " + (e && e.message ? e.message : e)); })
      .then(function () { btn.disabled = false; });
  }
  var _asb = document.getElementById("btn-autostatus");
  if (_asb) _asb.addEventListener("click", autoStatus);

  load();
</script>`;

  return popPage({
    active: opts.active || "conditions",
    role,
    deptCode: opts.deptCode,
    mode: "view",
    title: "条件明細",
    subtitle: canEdit
      ? "支払日 / 納期 / 担当 / 種類 / 取引先で検索"
      : "支払日 / 納期 / 担当 / 種類 / 取引先で検索(閲覧専用)",
    toolbar,
    body,
    headExtra: EXTRA_CSS,
  });
}
