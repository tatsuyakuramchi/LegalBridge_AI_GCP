/**
 * receivableMapHtml — 分配構造マップ(作品中心)。
 *
 *   GET /master/receivable-map?work=<id>
 *
 * 当社がサブライセンサーとなる構造を 3 層フロー図で表示:
 *   上流(原権利者/ライセンサー) ← 当社が分配(料率×受領額) ← 当社 ← 当社が受領 ← 下流(サブライセンシー)
 *
 * データ: GET /api/receivable-map?work=<id> (receivableMapService)。
 */

import { popPage } from "./popChrome.ts";

const EXTRA_CSS = `<style>
.map-picker{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
.map-flow{display:grid;grid-template-columns:1fr 56px 1fr 56px 1fr;gap:0;align-items:stretch;margin-top:8px}
@media(max-width:1000px){.map-flow{grid-template-columns:1fr;gap:14px}.map-arrow{display:none!important}}
.map-col{display:flex;flex-direction:column;gap:12px;min-width:0}
.map-col h3{font-size:12.5px;font-weight:800;color:var(--muted);margin:0 0 2px;text-transform:none;letter-spacing:.02em}
.map-arrow{display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--accent)}
.map-arrow .a{font-size:26px;line-height:1}
.map-arrow .lbl{font-size:10px;color:var(--muted);writing-mode:horizontal-tb;text-align:center;margin-top:4px}
.node{background:#fff;border:1px solid var(--line);border-radius:16px;padding:13px 15px;box-shadow:0 2px 8px rgba(90,70,180,.06)}
.node.center{background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;border:0;box-shadow:0 10px 24px rgba(108,92,231,.32)}
.node.up{border-left:5px solid #ff9f43} .node.down{border-left:5px solid #1dd1a1}
.node .nm{font-weight:800;font-size:14px}
.node .meta{font-size:11.5px;color:var(--muted);margin-top:3px}
.node.center .meta{color:rgba(255,255,255,.85)}
.node .amt{font-variant-numeric:tabular-nums;font-weight:800;margin-top:8px;font-size:15px}
.node .amt small{font-weight:600;font-size:11px;color:var(--muted)}
.node.center .big{font-size:13px;margin-top:8px;display:flex;justify-content:space-between;gap:10px}
.node.center .big b{font-size:16px}
.kpill{display:inline-block;font-size:10px;font-weight:800;padding:1px 8px;border-radius:12px;background:#efeaff;color:#6c5ce7;margin-left:6px}
.rate{font-size:11px;color:#a9700a;background:#fff4d6;border-radius:10px;padding:1px 7px;font-weight:800}
.empty{color:var(--muted);padding:18px;text-align:center}
.warn{background:#fff7e6;border:1px solid #ffe9bf;color:#a9700a;border-radius:12px;padding:8px 12px;font-size:12px;margin-top:12px}
</style>`;

export function receivableMapPage(): string {
  const body = `
  <div class="map-picker">
    <label class="muted" style="font-weight:800;">作品:</label>
    <select class="pop-select" id="work" style="min-width:280px;"><option value="">— 作品を選択 —</option></select>
    <span class="muted" id="hint">請求権(受領)のある作品を選ぶと、上流(分配)・当社・下流(受領)のフローを表示します。</span>
  </div>

  <div id="map-wrap"><div class="empty">作品を選択してください。</div></div>

<script>
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
  function yen(n){var v=Number(n);return isFinite(v)?v.toLocaleString("ja-JP"):"";}
  var KIND={sublicense:"サブライセンス",publication:"出版印税",license_out:"ライセンスアウト",service:"役務・その他",other:"その他"};
  function qs(k){var m=new RegExp("[?&]"+k+"=([^&]*)").exec(location.search);return m?decodeURIComponent(m[1]):"";}

  async function jget(u){var r=await fetch(u,{credentials:"same-origin"});if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}

  async function loadWorks(){
    try{
      var d=await jget("/api/receivable-map/works");
      var sel=document.getElementById("work");
      sel.innerHTML='<option value="">— 作品を選択 —</option>'+(d.rows||[]).map(function(w){
        return '<option value="'+w.id+'">'+esc((w.work_code?w.work_code+" : ":"")+w.title)+' ('+w.deal_count+'件)</option>';
      }).join("");
    }catch(e){}
  }

  function nodeUp(u){
    var rate=u.rate_pct==null?'<span class="rate">料率未設定</span>':'<span class="rate">料率 '+esc(u.rate_pct)+'%</span>'+(u.rate_basis?' <span class="muted" style="font-size:10px;">('+esc(u.rate_basis)+')</span>':'');
    var dist=u.distribute_amount==null?'<small>(料率未設定のため算定不可)</small>':'¥'+yen(u.distribute_amount);
    return '<div class="node up"><div class="nm">'+esc(u.licensor_name||"(ライセンサー未設定)")+'</div>'+
      '<div class="meta">'+(u.source_ip_title?'原作: '+esc(u.source_ip_title)+' ':'')+(u.document_number?'· '+esc(u.document_number):'')+'</div>'+
      '<div class="meta">'+rate+'</div>'+
      '<div class="amt">分配 '+dist+'</div></div>';
  }
  function nodeDown(r){
    return '<div class="node down"><div class="nm">'+esc(r.sublicensee_name||"(相手方未設定)")+'<span class="kpill">'+esc(KIND[r.receivable_kind]||r.receivable_kind)+'</span></div>'+
      (r.source_contract_number?'<div class="meta">'+esc(r.source_contract_number)+'</div>':'')+
      '<div class="amt">受領 '+esc(r.currency)+' '+yen(r.received)+'</div></div>';
  }

  async function loadMap(id){
    var wrap=document.getElementById("map-wrap");
    if(!id){wrap.innerHTML='<div class="empty">作品を選択してください。</div>';return;}
    wrap.innerHTML='<div class="empty">読み込み中…</div>';
    try{
      var d=await jget("/api/receivable-map?work="+encodeURIComponent(id));
      if(!d.work){wrap.innerHTML='<div class="empty">作品が見つかりません。</div>';return;}
      var t=d.totals||{};
      var ups=(d.upstream||[]).length?d.upstream.map(nodeUp).join(""):'<div class="empty">上流(ライセンサー)の license-in 明細がありません。</div>';
      var downs=(d.downstream||[]).length?d.downstream.map(nodeDown).join(""):'<div class="empty">下流(受領)の請求権がありません。</div>';
      var center='<div class="node center">'+
        '<div class="nm">当社(サブライセンサー)</div>'+
        '<div class="meta">'+esc((d.work.work_code?d.work.work_code+" : ":"")+d.work.title)+(d.work.is_original?' · 自社オリジナル':'')+'</div>'+
        '<div class="big"><span>サブライセンス受領</span><b>¥'+yen(t.sublicense_received)+'</b></div>'+
        '<div class="big"><span>上流へ分配</span><b>− ¥'+yen(t.distributed)+'</b></div>'+
        '<div class="big" style="border-top:1px solid rgba(255,255,255,.35);padding-top:6px;"><span>当社 留保</span><b>¥'+yen(t.retained)+'</b></div>'+
        (t.all_received>t.sublicense_received?'<div class="meta" style="margin-top:8px;">※ 全請求権受領(他種別含む) ¥'+yen(t.all_received)+'</div>':'')+
        '</div>';
      var html='<div class="map-flow">'+
        '<div class="map-col"><h3>⬆ 上流 — 原権利者 / ライセンサー(当社が分配)</h3>'+ups+'</div>'+
        '<div class="map-arrow"><div class="a">→</div><div class="lbl">分配<br>料率×受領</div></div>'+
        '<div class="map-col"><h3>● 当社</h3>'+center+'</div>'+
        '<div class="map-arrow"><div class="a">→</div><div class="lbl">受領<br>請求権</div></div>'+
        '<div class="map-col"><h3>⬇ 下流 — サブライセンシー(当社が受領)</h3>'+downs+'</div>'+
        '</div>';
      if(!t.rate_known && (d.upstream||[]).length) html+='<div class="warn">上流の分配料率(サブライセンス条件 condition_no=2)が未設定です。利用許諾契約の金銭条件に料率を入れると分配額が自動算定されます。</div>';
      wrap.innerHTML=html;
    }catch(e){wrap.innerHTML='<div class="empty" style="color:#b91c1c;">読み込み失敗: '+esc(e&&e.message?e.message:e)+'</div>';}
  }

  document.getElementById("work").addEventListener("change",function(){
    var id=this.value;
    history.replaceState(null,"", id?("?work="+id):location.pathname);
    loadMap(id);
  });
  (async function(){
    await loadWorks();
    var w=qs("work");
    if(w){document.getElementById("work").value=w;loadMap(w);}
  })();
</script>`;

  return popPage({
    active: "receivable-map",
    mode: "admin",
    title: "分配構造マップ",
    subtitle: "作品中心 · 上流(分配) ← 当社 ← 下流(受領)",
    body,
    headExtra: EXTRA_CSS,
    pageTitle: "分配構造マップ · Arcs Legal OS",
  });
}
