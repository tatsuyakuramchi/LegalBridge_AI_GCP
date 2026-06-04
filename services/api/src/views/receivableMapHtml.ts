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
.tier{border:1px solid var(--line);border-radius:18px;padding:12px 14px;margin-bottom:0;background:#fbfaff}
.tier.sel{border-color:var(--accent);box-shadow:0 0 0 2px rgba(108,92,231,.18)}
.tier-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.tier-head .t{font-weight:800;font-size:14px}
.deriv{display:inline-block;font-size:10.5px;font-weight:800;padding:1px 9px;border-radius:12px;background:#fff0e6;color:#e8810f}
.deriv.sel{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff}
.connector{display:flex;flex-direction:column;align-items:center;color:var(--accent);padding:6px 0}
.connector .a{font-size:20px;line-height:1}
.connector .lbl{font-size:10.5px;color:var(--muted);font-weight:700}
.children{margin-top:14px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:10px 14px}
.children a{display:inline-block;margin:3px 6px 3px 0;font-size:12px;font-weight:700;color:var(--accent);background:#efeaff;border-radius:12px;padding:3px 10px;text-decoration:none}
.chain-totals{display:flex;gap:18px;flex-wrap:wrap;background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;border-radius:16px;padding:12px 16px;margin-bottom:14px}
.chain-totals .k{font-size:11px;opacity:.9} .chain-totals .v{font-size:18px;font-weight:800}
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

  var DERIV={translation:"翻訳",edition:"版",title_change:"改題",localization:"地域化",adaptation:"翻案"};
  function renderTier(n, isSel){
    var w=n.work||{};
    var ups=(n.upstream||[]).length?n.upstream.map(nodeUp).join(""):'<div class="empty" style="padding:8px;">上流(license-in)なし</div>';
    var downs=(n.downstream||[]).length?n.downstream.map(nodeDown).join(""):'<div class="empty" style="padding:8px;">受領(下流)なし</div>';
    var deriv=n.derivation_type?'<span class="deriv'+(isSel?' sel':'')+'">'+esc(DERIV[n.derivation_type]||n.derivation_type)+'</span>':(w.is_original?'<span class="deriv">原版</span>':'');
    var center='<div class="node center">'+
      '<div class="nm">当社</div>'+
      '<div class="big"><span>サブライセンス受領</span><b>¥'+yen(n.received)+'</b></div>'+
      '<div class="big"><span>上流へ分配</span><b>− ¥'+yen(n.distributed)+'</b></div>'+
      '<div class="big" style="border-top:1px solid rgba(255,255,255,.35);padding-top:6px;"><span>留保</span><b>¥'+yen((n.received||0)-(n.distributed||0))+'</b></div>'+
      ((n.all_received||0)>(n.received||0)?'<div class="meta" style="margin-top:6px;">※ 全受領 ¥'+yen(n.all_received)+'</div>':'')+
      '</div>';
    return '<div class="tier'+(isSel?' sel':'')+'">'+
      '<div class="tier-head"><span class="t">'+esc((w.work_code?w.work_code+" : ":"")+w.title)+'</span>'+deriv+(isSel?'<span class="kpill">選択中</span>':'')+'</div>'+
      '<div class="map-flow">'+
        '<div class="map-col"><h3>⬆ 上流(当社が分配)</h3>'+ups+'</div>'+
        '<div class="map-arrow"><div class="a">→</div><div class="lbl">分配</div></div>'+
        '<div class="map-col"><h3>● 当社</h3>'+center+'</div>'+
        '<div class="map-arrow"><div class="a">→</div><div class="lbl">受領</div></div>'+
        '<div class="map-col"><h3>⬇ 下流(当社が受領)</h3>'+downs+'</div>'+
      '</div></div>';
  }

  async function loadMap(id){
    var wrap=document.getElementById("map-wrap");
    if(!id){wrap.innerHTML='<div class="empty">作品を選択してください。</div>';return;}
    wrap.innerHTML='<div class="empty">読み込み中…</div>';
    try{
      var d=await jget("/api/receivable-map/lineage?work="+encodeURIComponent(id));
      var chain=d.chain||[];
      if(!chain.length){wrap.innerHTML='<div class="empty">作品が見つかりません。</div>';return;}
      var t=d.totals||{};
      var html='<div class="chain-totals">'+
        '<div><div class="k">系譜合計 受領</div><div class="v">¥'+yen(t.received)+'</div></div>'+
        '<div><div class="k">上流へ分配</div><div class="v">− ¥'+yen(t.distributed)+'</div></div>'+
        '<div><div class="k">当社 留保</div><div class="v">¥'+yen(t.retained)+'</div></div>'+
        '</div>';
      // root → selected の順に段表示。段間に派生コネクタ。
      for(var i=0;i<chain.length;i++){
        var isSel=String(chain[i].work.id)===String(d.selected_work_id);
        html+=renderTier(chain[i], isSel);
        if(i<chain.length-1){
          var next=chain[i+1];
          html+='<div class="connector"><div class="a">▼</div><div class="lbl">派生: '+esc(DERIV[next.derivation_type]||next.derivation_type||"派生")+'</div></div>';
        }
      }
      // 直下の派生作品(子)へのリンク
      if((d.children||[]).length){
        html+='<div class="children"><b style="font-size:12px;">この作品の派生(下位):</b> '+
          d.children.map(function(c){return '<a href="?work='+c.id+'">'+esc((c.work_code?c.work_code+" : ":"")+c.title)+(c.derivation_type?' ('+esc(DERIV[c.derivation_type]||c.derivation_type)+')':'')+'</a>';}).join("")+
          '</div>';
      }
      var anyRateUnknown=chain.some(function(n){return (n.upstream||[]).some(function(u){return u.rate_pct==null;});});
      if(anyRateUnknown) html+='<div class="warn">一部の上流で分配料率が未設定です。利用許諾/出版条件の金銭条件(サブライセンス/翻訳・海外版)に料率を入れると分配額が自動算定されます。</div>';
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
