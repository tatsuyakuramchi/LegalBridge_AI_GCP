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
import type { Role } from "../lib/screens.ts";

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
#resolve-res{position:absolute;top:38px;left:0;z-index:30;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);min-width:280px;max-height:280px;overflow:auto;display:none}
#resolve-res.open{display:block}
#resolve-res a{display:block;padding:8px 12px;font-size:12.5px;text-decoration:none;color:var(--ink);border-bottom:1px solid var(--line)}
#resolve-res a:hover{background:var(--hover)}
#resolve-res .via{font-size:10px;color:var(--accent);font-weight:800;margin-left:6px}
.alias-card{margin-top:16px;background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px 16px;box-shadow:0 2px 8px rgba(90,70,180,.05)}
.alias-card h3{font-size:13px;font-weight:800;margin:0 0 8px}
.alias-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--line);font-size:12.5px;flex-wrap:wrap}
.alias-row .ctx{color:var(--muted);font-size:11px}
.alias-add{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.alias-add input{border:1.5px solid #e2dbfb;border-radius:10px;padding:6px 10px;font:inherit;font-size:12.5px}
</style>`;

export function receivableMapPage(role: Role = "viewer"): string {
  const body = `
  <div class="map-picker">
    <label class="muted" style="font-weight:800;">作品:</label>
    <select class="pop-select" id="work" style="min-width:260px;"><option value="">— 作品を選択 —</option></select>
    <span style="position:relative;">
      <input class="pop-input" id="resolve" placeholder="🔎 他社/改題タイトルで作品検索…" style="min-width:240px;">
      <div id="resolve-res"></div>
    </span>
    <span class="muted" id="hint">受領のある作品を選ぶと系譜(上流分配←当社←下流受領)を表示。他社が付けた改題タイトルでも検索できます。</span>
  </div>

  <div id="map-wrap"><div class="empty">作品を選択してください。</div></div>
  <div id="alias-panel"></div>

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
    var dist=u.inherited?'<small>上位段で計上済</small>':(u.distribute_amount==null?'<small>(料率未設定のため算定不可)</small>':'¥'+yen(u.distribute_amount));
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
    var cascadeLine=((n.cascade_base||0)>(n.received||0))
      ? '<div class="big"><span>分配基礎(累計)</span><b>¥'+yen(n.cascade_base)+'</b></div>' : '';
    var center='<div class="node center">'+
      '<div class="nm">当社</div>'+
      '<div class="big"><span>受領(直接)</span><b>¥'+yen(n.received)+'</b></div>'+
      cascadeLine+
      '<div class="big"><span>上流へ分配</span><b>− ¥'+yen(n.distributed)+'</b></div>'+
      '<div class="big" style="border-top:1px solid rgba(255,255,255,.35);padding-top:6px;"><span>留保</span><b>¥'+yen((n.cascade_base||n.received||0)-(n.distributed||0))+'</b></div>'+
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
      loadAliases(id);
    }catch(e){wrap.innerHTML='<div class="empty" style="color:#b91c1c;">読み込み失敗: '+esc(e&&e.message?e.message:e)+'</div>';}
  }

  /* ---- タイトル別名(名寄せ)---- */
  async function loadAliases(workId){
    var p=document.getElementById("alias-panel");
    try{
      var d=await jget("/api/works/"+encodeURIComponent(workId)+"/aliases");
      var rows=d.rows||[];
      var list=rows.length?rows.map(function(a){
        return '<div class="alias-row"><b>'+esc(a.alias_title)+'</b>'+
          (a.party_name?' <span class="kpill">'+esc(a.party_name)+'</span>':'')+
          (a.context?' <span class="ctx">'+esc(a.context)+'</span>':'')+
          '<span style="flex:1"></span><a href="javascript:void(0)" onclick="delAlias('+a.id+','+workId+')" style="color:#c43c63;text-decoration:none;font-weight:800;">削除</a></div>';
      }).join(""):'<div class="ctx">別名は未登録です。他社が付けた改題タイトル等を登録すると、その名称で作品を検索できます。</div>';
      p.innerHTML='<div class="alias-card"><h3>📝 タイトル別名(他社/改題タイトルの名寄せ)</h3>'+list+
        '<div class="alias-add">'+
          '<input id="al-title" placeholder="別名(例: K社の出版タイトル)" style="min-width:220px;">'+
          '<input id="al-ctx" placeholder="文脈(例: K社 海外出版版)" style="min-width:200px;">'+
          '<button class="pop-btn sm" onclick="addAlias('+workId+')">＋ 別名を追加</button>'+
        '</div></div>';
    }catch(e){p.innerHTML='';}
  }
  window.addAlias=async function(workId){
    var title=(document.getElementById("al-title").value||"").trim();
    if(!title){alert("別名を入力してください");return;}
    var ctx=(document.getElementById("al-ctx").value||"").trim();
    try{
      var res=await fetch("/api/works/"+encodeURIComponent(workId)+"/aliases",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({alias_title:title,context:ctx||null})});
      var d=await res.json().catch(function(){return{};});
      if(!res.ok||d.ok===false)throw new Error(d.error||("HTTP "+res.status));
      loadAliases(workId);
    }catch(e){alert("追加に失敗: "+(e&&e.message?e.message:e));}
  };
  window.delAlias=async function(id,workId){
    if(!confirm("この別名を削除しますか?"))return;
    try{
      var res=await fetch("/api/work-aliases/"+id,{method:"DELETE",credentials:"same-origin"});
      var d=await res.json().catch(function(){return{};});
      if(!res.ok||d.ok===false)throw new Error(d.error||("HTTP "+res.status));
      loadAliases(workId);
    }catch(e){alert("削除に失敗: "+(e&&e.message?e.message:e));}
  };

  /* ---- 他社/改題タイトル → 作品 解決 ---- */
  var resolveTimer=null;
  function doResolve(){
    var q=(document.getElementById("resolve").value||"").trim();
    var box=document.getElementById("resolve-res");
    if(!q){box.className="";box.innerHTML="";return;}
    jget("/api/receivable-map/resolve?q="+encodeURIComponent(q)).then(function(d){
      var rows=d.rows||[];
      if(!rows.length){box.innerHTML='<a>該当作品なし</a>';box.className="open";return;}
      var VIA={title:"正式",alternative_title:"別タイトル",alias:"名寄せ別名"};
      box.innerHTML=rows.map(function(r){
        return '<a href="?work='+r.id+'">'+esc((r.work_code?r.work_code+" : ":"")+r.title)+
          '<span class="via">'+esc(VIA[r.matched_via]||r.matched_via)+(r.matched_via!=="title"&&r.matched_text?": "+esc(r.matched_text):"")+'</span></a>';
      }).join("");
      box.className="open";
    }).catch(function(){box.className="";});
  }
  document.getElementById("resolve").addEventListener("input",function(){clearTimeout(resolveTimer);resolveTimer=setTimeout(doResolve,250);});
  document.addEventListener("click",function(e){
    var box=document.getElementById("resolve-res");
    if(box && !box.contains(e.target) && e.target.id!=="resolve") box.className="";
  });

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
    role,
    mode: "admin",
    title: "分配構造マップ",
    subtitle: "作品中心 · 上流(分配) ← 当社 ← 下流(受領)",
    body,
    headExtra: EXTRA_CSS,
    pageTitle: "分配構造マップ · Arcs Legal OS",
  });
}
