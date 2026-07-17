/**
 * workSearchHtml — 作品検索(専用画面)の HTML 生成。
 *
 *   workSearchPage({ role, deptCode, q }): /search/work のネイティブ検索ページ。
 *
 * 設計方針:
 *   - 従来の作品モデル(/work-model)は admin-ui(React)を iframe 埋め込みするだけで
 *     ポータルに溶け込まず使いにくかった。本ページはポータルネイティブの検索 UI。
 *   - データは DB 直結の GET /api/v3/works/search を同一オリジン fetch で取得
 *     (title/title_kana/work_code/別題を横断 ILIKE ＋ 種別/状態/区分フィルタ ＋ ページング)。
 *   - 行クリックで GET /api/v3/works/:id を取り、素材/製品/契約を inline 展開。
 *   - popPage 共通クロム(サイドバー/テーマ)に載せる。外部 JS/CSS 依存なし。
 */

import { popPage } from "./popChrome.ts";
import type { Role } from "../lib/screens.ts";

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
.wk-wrap { max-width: 1100px; margin: 0 auto; }
.wk-searchbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.wk-searchbar input[type=search] {
  flex: 1 1 260px; min-width: 220px; padding: 10px 12px; font-size: 14px;
  border: 1px solid var(--line, #d1d5db); border-radius: 12px; background: var(--card, #fff); color: inherit;
}
.wk-searchbar select {
  padding: 9px 10px; font-size: 12px; border: 1px solid var(--line, #d1d5db);
  border-radius: 10px; background: var(--card, #fff); color: inherit;
}
.wk-searchbar button {
  padding: 10px 16px; font-size: 13px; font-weight: 700; border: none; border-radius: 12px;
  background: linear-gradient(135deg, var(--accent, #6c5ce7), var(--accent2, #8e7bff)); color: #fff; cursor: pointer;
}
.wk-meta { font-size: 12px; color: var(--muted, #6b7280); margin: 6px 2px 12px; }
.wk-list { display: flex; flex-direction: column; gap: 8px; }
.wk-card {
  border: 1px solid var(--line, #e5e7eb); border-radius: 12px; background: var(--card, #fff);
  padding: 12px 14px; cursor: pointer; transition: border-color .12s, box-shadow .12s;
}
.wk-card:hover { border-color: var(--accent, #6c5ce7); box-shadow: 0 3px 12px rgba(0,0,0,.06); }
.wk-card h3 { margin: 0; font-size: 15px; font-weight: 700; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.wk-code { font-family: ui-monospace, monospace; font-size: 11px; background: var(--hover, #f3f4f6); color: var(--muted, #4b5563); padding: 2px 7px; border-radius: 6px; }
.wk-kana { font-size: 11px; color: var(--muted, #9ca3af); }
.wk-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
.wk-pill { font-size: 11px; border: 1px solid var(--line, #d1d5db); color: var(--muted, #4b5563); border-radius: 999px; padding: 1px 9px; font-family: ui-monospace, monospace; }
.wk-pill.on { background: #ecfdf5; border-color: #6ee7b7; color: #065f46; }
.wk-alt { font-size: 11px; color: var(--muted, #6b7280); margin-top: 6px; }
.wk-detail { margin-top: 10px; border-top: 1px dashed var(--line, #e5e7eb); padding-top: 10px; font-size: 12px; }
.wk-detail table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; }
.wk-detail th, .wk-detail td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line, #f0f0f0); }
.wk-detail th { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted, #9ca3af); font-weight: 700; }
.wk-detail .sub { font-weight: 700; margin: 8px 0 2px; font-size: 12px; }
.wk-empty { text-align: center; color: var(--muted, #9ca3af); padding: 40px 0; font-size: 13px; }
.wk-pager { display: flex; justify-content: center; gap: 10px; align-items: center; margin: 16px 0; }
.wk-pager button { padding: 7px 14px; border: 1px solid var(--line, #d1d5db); border-radius: 10px; background: var(--card, #fff); color: inherit; cursor: pointer; font-size: 12px; }
.wk-pager button[disabled] { opacity: .4; cursor: not-allowed; }

/* 権利ツリー (詳細内) */
.rt { border: 1px solid var(--line, #e5e7eb); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; background: var(--panel-2, #fafafc); }
.rt-title { font-size: 12px; font-weight: 800; margin-bottom: 8px; }
.rt-kpis { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.rt-k { font-size: 11px; font-family: var(--mono); border: 1px solid var(--line); border-radius: 8px; padding: 2px 9px; }
.rt-k.own { color: #6c5ce7; border-color: #c9bdff; } .rt-k.out { color: #d97316; border-color: #f4c4a2; } .rt-k.in { color: #1f9d5b; border-color: #a5dcbb; }
.rt-branch { margin-top: 8px; }
.rt-bh { font-size: 12px; font-weight: 700; margin: 6px 0; }
.rt-bh.out { color: #d97316; } .rt-bh.in { color: #1f9d5b; }
.rt-leaf { display: flex; gap: 9px; align-items: stretch; border: 1px solid var(--line); border-radius: 10px; background: var(--card, #fff); padding: 7px 10px; margin: 5px 0 5px 12px; }
.rt-stripe { width: 4px; border-radius: 3px; flex: none; }
.rt-leaf.st-own .rt-stripe { background: #6c5ce7; } .rt-leaf.st-in .rt-stripe { background: #1f9d5b; } .rt-leaf.st-out .rt-stripe { background: #d97316; }
.rt-h { font-size: 12.5px; font-weight: 650; }
.rt-party { font-size: 11px; color: var(--muted, #6b7280); font-weight: 400; }
.rt-badge { font-size: 9.5px; font-weight: 700; border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px; color: var(--muted); }
.rt-badge.own { color: #6c5ce7; border-color: #c9bdff; background: #efeaff; }
.rt-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.rt-mc { font-size: 11px; border: 1px solid var(--line); border-radius: 7px; padding: 1px 8px; background: var(--panel-2); }
.rt-mc b { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-right: 3px; }
.rt-mc.rt-own { color: #6c5ce7; border-color: #c9bdff; background: #efeaff; font-family: var(--mono); font-weight: 650; }
.rt-mc.rt-in { color: #1f9d5b; border-color: #a5dcbb; font-family: var(--mono); } .rt-mc.rt-out { color: #d97316; border-color: #f4c4a2; font-family: var(--mono); }
.rt-sum { border: 1px dashed #a5dcbb; background: #e7f6ec; border-radius: 10px; padding: 8px 11px; margin: 4px 0 6px 12px; }
.rt-sum-h { font-size: 11px; font-weight: 800; color: #1f9d5b; margin-bottom: 4px; }
.rt-srow { font-size: 12px; padding: 3px 0; border-top: 1px dashed #a5dcbb; }
.rt-srow:first-of-type { border-top: none; }
.rt-srow b { min-width: 76px; display: inline-block; }
.rt-lang { font-family: var(--mono); font-size: 11px; border: 1px solid #a5dcbb; border-radius: 6px; padding: 0 6px; background: #fff; }
.rt-via { color: var(--muted); font-size: 11px; }
.rt-warn { margin-top: 6px; font-size: 11px; color: #d97316; background: #fdeadf; border: 1px solid #f4c4a2; border-radius: 8px; padding: 4px 9px; }
.rt-empty { font-size: 11px; color: var(--muted); margin-left: 12px; }
`;

export function workSearchPage(opts: {
  role?: Role;
  deptCode?: string | null;
  q?: string;
}): string {
  const q = opts.q || "";
  const body = `
<div class="wk-wrap">
  <form class="wk-searchbar" id="wkForm" onsubmit="return false;">
    <input type="search" id="wkQ" placeholder="🔎 作品を検索（タイトル / 別題 / 作品コード / よみ）" value="${esc(q)}" autofocus>
    <select id="wkType" title="種別">
      <option value="">種別: すべて</option>
      <option value="board_game">ボードゲーム</option>
      <option value="trpg_book">TRPG書籍</option>
      <option value="supplement">サプリメント</option>
      <option value="digital">デジタル</option>
    </select>
    <select id="wkStatus" title="状態">
      <option value="">状態: すべて</option>
      <option value="planning">企画</option>
      <option value="in_production">制作中</option>
      <option value="released">発売済</option>
      <option value="suspended">停止</option>
      <option value="discontinued">終売</option>
    </select>
    <select id="wkDivision" title="区分">
      <option value="">区分: すべて</option>
      <option value="BDG">BDG</option>
      <option value="PUB">PUB</option>
    </select>
    <button type="submit" id="wkGo">検索</button>
  </form>
  <div class="wk-meta" id="wkMeta">タイトルや作品コードで検索してください。</div>
  <div class="wk-list" id="wkList"></div>
  <div class="wk-pager" id="wkPager" style="display:none;">
    <button id="wkPrev">← 前へ</button>
    <span id="wkPage" style="font-size:12px;color:var(--muted,#6b7280);"></span>
    <button id="wkNext">次へ →</button>
  </div>
</div>
<script>
(function(){
  var LIMIT = 50;
  var offset = 0;
  var total = 0;
  var TYPE = { board_game:"ボードゲーム", trpg_book:"TRPG書籍", supplement:"サプリメント", digital:"デジタル" };
  var STATUS = { planning:"企画", in_production:"制作中", released:"発売済", suspended:"停止", discontinued:"終売" };
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  var el = function(id){ return document.getElementById(id); };
  function params(){
    var p = new URLSearchParams();
    var q = el("wkQ").value.trim();
    if (q) p.set("q", q);
    if (el("wkType").value) p.set("type", el("wkType").value);
    if (el("wkStatus").value) p.set("status", el("wkStatus").value);
    if (el("wkDivision").value) p.set("division", el("wkDivision").value);
    p.set("limit", LIMIT); p.set("offset", offset);
    return p;
  }
  function pills(w){
    var out = "";
    if (w.work_type) out += '<span class="wk-pill">'+esc(TYPE[w.work_type]||w.work_type)+'</span>';
    if (w.status) out += '<span class="wk-pill">'+esc(STATUS[w.status]||w.status)+'</span>';
    (w.division||[]).forEach(function(d){ out += '<span class="wk-pill">'+esc(d)+'</span>'; });
    if (w.is_original) out += '<span class="wk-pill on">オリジナル</span>';
    if (w.is_active === false) out += '<span class="wk-pill">非活性</span>';
    out += '<span class="wk-pill">製品 '+(w.product_count||0)+'</span>';
    out += '<span class="wk-pill">権利 '+(w.material_count||0)+'</span>';
    return out;
  }
  function card(w){
    var alt = (w.alternative_titles||[]).filter(Boolean);
    return '<div class="wk-card" data-id="'+w.id+'">'
      + '<h3><span class="wk-code">'+esc(w.work_code)+'</span>'+esc(w.title)
      + (w.title_kana ? ' <span class="wk-kana">'+esc(w.title_kana)+'</span>' : '') + '</h3>'
      + '<div class="wk-pills">'+pills(w)+'</div>'
      + (alt.length ? '<div class="wk-alt">別題: '+esc(alt.join(" / "))+'</div>' : '')
      + '<div class="wk-detail" style="display:none;"></div>'
      + '</div>';
  }
  function detailHtml(d){
    var mats = d.materials||[], prods = d.products||[], contracts = d.contracts||[];
    var h = '';
    if (prods.length){
      h += '<div class="sub">製品 ('+prods.length+')</div><table><tr><th>製品名</th><th>コード</th></tr>'
        + prods.map(function(p){ return '<tr><td>'+esc(p.product_name||p.title||"—")+'</td><td>'+esc(p.product_code||p.code||"")+'</td></tr>'; }).join('') + '</table>';
    }
    if (mats.length){
      h += '<div class="sub">権利台帳 / 素材 ('+mats.length+')</div><table><tr><th>素材</th><th>権利者</th></tr>'
        + mats.map(function(m){ return '<tr><td>'+esc(m.material_name||m.name||m.genre||"—")+'</td><td>'+esc(m.rights_holder||m.effective_rights_holder_name||"")+'</td></tr>'; }).join('') + '</table>';
    }
    if (contracts.length){
      h += '<div class="sub">紐づく契約 ('+contracts.length+')</div><table><tr><th>番号</th><th>件名</th><th>区分</th></tr>'
        + contracts.map(function(c){ return '<tr><td>'+esc(c.document_number||"")+'</td><td>'+esc(c.contract_title||"")+'</td><td>'+esc(c.contract_category||"")+'</td></tr>'; }).join('') + '</table>';
    }
    if (!h) h = '<div style="color:var(--muted,#9ca3af);">製品・素材・契約の紐づけはありません。</div>';
    return h;
  }
  // 権利ツリー(契約構造の金銭イン/アウト・買い切り・許諾地域サマリー)。
  function rtLeaf(r){
    var meta='';
    if (r.type==='own'){
      meta = '<span class="rt-mc rt-own">💴 一時金 '+esc(r.amount_label||'')+'</span><span class="rt-mc"><b>期間</b>永続（買い切り）</span>';
    } else {
      if (r.calc) meta += '<span class="rt-mc rt-'+r.dir+'"><b>計算条件</b>'+esc(r.calc)+'</span>';
      if (r.territory) meta += '<span class="rt-mc"><b>許諾地域</b>'+esc(r.territory)+'</span>';
      if (r.language) meta += '<span class="rt-mc"><b>許諾言語</b>'+esc(r.language)+'</span>';
    }
    var badge = r.type==='own' ? '<span class="rt-badge own">買い切り ∞</span>' : r.type==='free' ? '<span class="rt-badge">無償</span>' : '';
    var st = r.type==='own' ? 'own' : (r.dir==='in' ? 'in' : 'out');
    return '<div class="rt-leaf st-'+st+'"><span class="rt-stripe"></span><div style="min-width:0;">'
      +'<div class="rt-h">'+esc(r.name)+' <span class="rt-party">· '+esc(r.party)+'</span> '+badge+'</div>'
      +'<div class="rt-meta">'+meta+'</div></div></div>';
  }
  function renderRightsTree(rt){
    if (!rt || rt.ok===false) return '';
    var acq = (rt.acquired||[]).map(rtLeaf).join('') || '<div class="rt-empty">なし</div>';
    var grn = (rt.granted||[]).map(rtLeaf).join('') || '<div class="rt-empty">なし</div>';
    var sum='';
    (rt.territorySummary||[]).forEach(function(s){
      sum += '<div class="rt-srow"><b>'+esc(s.territory)+'</b> <span class="rt-lang">'+esc((s.languages||[]).join('・')||'—')+'</span> <span class="rt-via">'+esc((s.rights||[]).join(' / '))+'</span></div>';
    });
    var warn = (rt.overlaps && rt.overlaps.length) ? '<div class="rt-warn">⚠ '+esc(rt.overlaps.join('、'))+' は広域許諾と範囲が重複します。媒体・独占条件をご確認ください。</div>' : '';
    var sumBlock = sum ? '<div class="rt-sum"><div class="rt-sum-h">🌐 許諾地域サマリー</div>'+sum+warn+'</div>' : '';
    var t = rt.totals||{};
    return '<div class="rt">'
      +'<div class="rt-title">契約・権利ツリー（金銭イン/アウト・買い切り）</div>'
      +'<div class="rt-kpis">'
        +'<span class="rt-k own">◆ 買い切り '+(t.buyout_count||0)+'件 / ¥'+((t.buyout_amount||0).toLocaleString('ja-JP'))+'</span>'
        +'<span class="rt-k out">▼ 取得 '+(t.acquired_count||0)+'件</span>'
        +'<span class="rt-k in">▲ 許諾 '+(t.granted_count||0)+'件</span>'
      +'</div>'
      +'<div class="rt-branch"><div class="rt-bh out">▼ 取得した権利（当社が支払・保有）</div>'+acq+'</div>'
      +'<div class="rt-branch"><div class="rt-bh in">▲ 許諾した権利（当社が受領）</div>'+sumBlock+grn+'</div>'
      +'</div>';
  }
  function toggleDetail(cardEl){
    var box = cardEl.querySelector('.wk-detail');
    if (box.style.display !== 'none'){ box.style.display='none'; return; }
    if (box.getAttribute('data-loaded')){ box.style.display='block'; return; }
    box.style.display='block'; box.innerHTML = '読み込み中…';
    var id = encodeURIComponent(cardEl.getAttribute('data-id'));
    Promise.all([
      fetch('/api/v3/works/'+id, { credentials:'same-origin' }).then(function(r){ return r.json(); }).catch(function(){ return {}; }),
      fetch('/api/v3/works/'+id+'/rights-tree', { credentials:'same-origin' }).then(function(r){ return r.json(); }).catch(function(){ return null; })
    ]).then(function(res){
      box.innerHTML = renderRightsTree(res[1]) + detailHtml(res[0]);
      box.setAttribute('data-loaded','1');
    }).catch(function(){ box.innerHTML = '<span style="color:#b91c1c;">詳細の取得に失敗しました</span>'; });
  }
  function render(data){
    total = data.total||0;
    var rows = data.rows||[];
    el("wkMeta").textContent = total ? (total + ' 件ヒット' + (total>LIMIT ? '（'+(offset+1)+'–'+Math.min(offset+LIMIT,total)+' 件を表示）' : '')) : '該当する作品がありません。';
    el("wkList").innerHTML = rows.length ? rows.map(card).join('') : '<div class="wk-empty">該当なし。条件を変えてお試しください。</div>';
    Array.prototype.forEach.call(el("wkList").querySelectorAll('.wk-card'), function(c){
      c.addEventListener('click', function(){ toggleDetail(c); });
    });
    var pager = el("wkPager");
    if (total > LIMIT){
      pager.style.display='flex';
      el("wkPrev").disabled = offset<=0;
      el("wkNext").disabled = offset+LIMIT>=total;
      el("wkPage").textContent = Math.floor(offset/LIMIT)+1 + ' / ' + Math.ceil(total/LIMIT);
    } else { pager.style.display='none'; }
  }
  var busy=false;
  function run(){
    if (busy) return; busy=true;
    el("wkGo").disabled=true;
    var qs = params().toString();
    history.replaceState(null,'', location.pathname + (el("wkQ").value.trim()? ('?q='+encodeURIComponent(el("wkQ").value.trim())) : ''));
    fetch('/api/v3/works/search?'+qs, { credentials:'same-origin' })
      .then(function(r){ return r.json(); })
      .then(function(d){ render(d); })
      .catch(function(e){ el("wkMeta").textContent = '検索に失敗しました: '+e; })
      .then(function(){ busy=false; el("wkGo").disabled=false; });
  }
  el("wkForm").addEventListener('submit', function(){ offset=0; run(); });
  ["wkType","wkStatus","wkDivision"].forEach(function(id){ el(id).addEventListener('change', function(){ offset=0; run(); }); });
  el("wkPrev").addEventListener('click', function(){ if(offset>0){ offset-=LIMIT; run(); } });
  el("wkNext").addEventListener('click', function(){ if(offset+LIMIT<total){ offset+=LIMIT; run(); } });
  // 初期表示: q があれば即検索、無ければ最新作品を一覧。
  run();
})();
</script>`;

  return popPage({
    active: "search-work",
    mode: "view",
    title: "作品検索",
    subtitle: "自社作品(works)を DB 直結で横断検索します。",
    body,
    headExtra: `<style>${STYLE}</style>`,
    pageTitle: "作品検索",
    role: opts.role,
    deptCode: opts.deptCode,
  });
}
