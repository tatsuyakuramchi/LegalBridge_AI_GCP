/**
 * sublicenseHtml — サブライセンス受領管理(第1段)。
 *
 *   GET /master/sublicense  (requireIapUser)
 *   - 上段: 受領条件(sublicense_deals)の一覧 + 追加/編集/削除モーダル
 *           (作品 × サブライセンシー、料率 / MG / 前払 / 基準 / 周期 / 期間)
 *   - 下段: 受領予定一覧(条件を各回に展開)+ フィルタ + CSV(選択/全件)
 *
 * 受領は当社が「受け取る」側。条件明細(支払側)とは分離しつつ UX は統一。
 */

import { MASTER_CSS } from "./masterChrome.ts";
import { popAdminPage } from "./popChrome.ts";

const EXTRA_CSS = `
.sec { margin-bottom: 18px; }
.sec h2 { font-size: 14px; margin: 0 0 8px; display: flex; align-items: center; gap: 10px; }
.muted { color: var(--muted-foreground); font-size: 11px; }
.filters { display: grid; gap: 10px 14px; align-items: end; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
.filters .f { display: flex; flex-direction: column; gap: 4px; }
.filters label { font-size: 11px; color: var(--muted-foreground); font-weight: 600; }
.filters .range { display: flex; gap: 6px; align-items: center; }
table.t { width: 100%; border-collapse: collapse; font-size: 12px; background: var(--card); }
table.t th, table.t td { border: 1px solid var(--border); padding: 6px 8px; text-align: left; vertical-align: top; white-space: nowrap; }
table.t th { background: var(--muted); color: var(--muted-foreground); font-weight: 600; position: sticky; top: 0; }
table.t td.num { text-align: right; font-variant-numeric: tabular-nums; }
table.t td.wrap { white-space: normal; min-width: 140px; }
table.t tr.clickable { cursor: pointer; }
table.t tr:hover td { background: var(--muted); }
.table-scroll { overflow: auto; max-height: 46vh; border: 1px solid var(--border); border-radius: 8px; }
.empty { color: var(--muted-foreground); padding: 18px; text-align: center; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
.pill { font-size: 10px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border); white-space: nowrap; }
.pill.mg { background: #fef3c7; } .pill.sales { background: #eef2ff; } .pill.adv { background: #fce7f3; } .pill.ok { background: #dcfce7; border-color: #86efac; }
table.t tr.confirmed td { background: #f0fdf4; }
.backdrop { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: none; align-items: flex-start; justify-content: center; padding: 40px 16px; z-index: 60; overflow: auto; }
.backdrop.open { display: flex; }
.modal { background: var(--card); border-radius: 10px; width: 100%; max-width: 620px; box-shadow: 0 20px 50px rgba(0,0,0,.25); }
.modal .mhead { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.modal .mhead h3 { margin: 0; font-size: 15px; }
.modal .mbody { padding: 16px 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.modal .mbody .full { grid-column: 1 / -1; }
.modal .fld label { display: block; font-size: 11px; font-weight: 600; color: var(--muted-foreground); margin-bottom: 3px; }
.modal .mfoot { display: flex; gap: 8px; justify-content: space-between; padding: 12px 18px; border-top: 1px solid var(--border); }
.modal .calc { font-size: 11px; color: var(--muted-foreground); background: var(--muted); border-radius: 6px; padding: 6px 10px; }
.xbtn { background: none; border: none; font-size: 20px; cursor: pointer; color: var(--muted-foreground); }
th.chk, td.chk { width: 30px; text-align: center; }
`;

export function sublicensePage(): string {
  const body = `
<div class="container" style="padding:0 0 24px;">

  <div class="sec">
    <div class="toolbar">
      <h2>請求権の条件(種別 × 相手方 × 受領条件)<span class="muted" id="deal-count">—</span></h2>
      <div style="display:flex;gap:6px;">
        <button class="btn outline" id="btn-import" title="条件明細で「受領(inbound)」ON の明細を請求権に取り込みます">⟳ 条件明細から取り込む</button>
        <button class="btn" id="btn-add">＋ 条件を追加</button>
      </div>
    </div>
    <div class="table-scroll">
      <div id="deals-wrap"><div class="empty">LOADING…</div></div>
    </div>
  </div>

  <div class="sec">
    <h2>受領予定一覧</h2>
    <div class="filters">
      <div class="f"><label>受領予定日</label><div class="range"><input class="tech-input" type="date" id="from"><span>〜</span><input class="tech-input" type="date" id="to"></div></div>
      <div class="f"><label>種別</label><select class="tech-select" id="kind"><option value="">全種別</option><option value="sublicense">サブライセンス</option><option value="publication">出版印税</option><option value="license_out">ライセンスアウト</option><option value="service">役務・その他</option><option value="other">その他</option></select></div>
      <div class="f"><label>請求状態</label><select class="tech-select" id="status"><option value="">全状態</option><option value="unbilled">未請求</option><option value="billed">請求済</option><option value="received">入金済</option></select></div>
      <div class="f"><label>相手方</label><input class="tech-input" type="text" id="sublicensee" placeholder="名称"></div>
      <div class="f"><label>作品</label><input class="tech-input" type="text" id="work" placeholder="作品名 / コード"></div>
      <div class="f"><label>キーワード</label><input class="tech-input" type="text" id="q" placeholder="作品/相手/契約番号"></div>
      <div class="f" style="justify-content:end;flex-direction:row;gap:8px;align-items:end;">
        <button class="btn" id="btn-search">検索</button>
        <button class="btn outline" id="btn-clear">クリア</button>
      </div>
    </div>
    <div class="toolbar">
      <span class="count-badge" id="rcount">—</span>
      <div style="display:flex;gap:6px;">
        <button class="btn outline" id="btn-csv-sel">選択をCSV (<span id="sel-n">0</span>)</button>
        <button class="btn outline" id="btn-csv-all">全件CSV</button>
      </div>
    </div>
    <div class="table-scroll">
      <div id="receipts-wrap"><div class="empty">—</div></div>
    </div>
  </div>
</div>

<div class="backdrop" id="backdrop">
  <div class="modal">
    <div class="mhead"><h3 id="m-title">受領条件</h3><button class="xbtn" id="m-close">×</button></div>
    <div class="mbody">
      <div class="fld full"><label>種別(請求権の種類)</label><select class="tech-select" id="m-kind">
        <option value="sublicense">サブライセンス受領</option>
        <option value="publication">出版印税</option>
        <option value="license_out">ライセンスアウト</option>
        <option value="service">役務・その他受領</option>
        <option value="other">その他</option>
      </select></div>
      <div class="fld"><label>作品</label><select class="tech-select" id="m-work"><option value="">—</option></select></div>
      <div class="fld"><label>サブライセンシー(マスタ)</label><select class="tech-select" id="m-sub"><option value="">— 手入力 —</option></select></div>
      <div class="fld full"><label>相手方名(手入力 / マスタ未登録・サブライセンシー以外)</label><input class="tech-input" id="m-cpname" placeholder="例: ○○出版 / 海外ライセンシー名"></div>
      <div class="fld"><label>参照: 契約番号(個別利用許諾 等)</label><input class="tech-input" id="m-contract" placeholder="ARC-LIC-2026-0001"></div>
      <div class="fld"><label>算定基準</label><select class="tech-select" id="m-basis"><option value="sales">売上ベース(料率×売上)</option><option value="manufacturing">製造数ベース(料率×単価×数量)</option></select></div>
      <div class="fld"><label>料率 (%)</label><input class="tech-input" type="number" step="0.0001" id="m-rate" placeholder="10"></div>
      <div class="fld"><label>基準価格(製造数ベース時)</label><input class="tech-input" type="number" id="m-unit" placeholder="単価"></div>
      <div class="fld"><label>見込売上 / 見込数量</label><input class="tech-input" type="number" id="m-forecast" placeholder="受領予定の試算用"></div>
      <div class="fld"><label>MG(最低保証)総額</label><input class="tech-input" type="number" id="m-mg" placeholder="0"></div>
      <div class="fld"><label>前払 / AG(相殺)</label><input class="tech-input" type="number" id="m-adv" placeholder="0"></div>
      <div class="fld"><label>通貨</label><input class="tech-input" id="m-cur" value="JPY"></div>
      <div class="fld"><label>周期</label><select class="tech-select" id="m-cycle"><option value="MONTHLY">月次</option><option value="QUARTERLY">四半期</option><option value="SEMIANNUAL">半年</option><option value="ANNUAL">年次</option><option value="CUSTOM">カスタム</option></select></div>
      <div class="fld" id="m-custom-wrap" style="display:none;"><label>カスタム間隔</label><div style="display:flex;gap:6px;align-items:center;">毎<input class="tech-input" type="number" id="m-icount" style="width:64px;" placeholder="2"><select class="tech-select" id="m-iunit"><option value="MONTH">ヶ月</option><option value="DAY">日</option></select>ごと</div></div>
      <div class="fld"><label>受領日(毎期X日 / 0で末日)</label><input class="tech-input" type="number" id="m-billday" placeholder="末日=0"></div>
      <div class="fld"><label>開始日</label><input class="tech-input" type="date" id="m-start"></div>
      <div class="fld"><label>終了日</label><input class="tech-input" type="date" id="m-end"></div>
      <div class="fld full"><label>備考</label><input class="tech-input" id="m-remarks"></div>
      <div class="calc full" id="m-calc"></div>
    </div>
    <div class="mfoot">
      <button class="btn outline" id="m-delete" style="color:#b91c1c;border-color:#b91c1c;">削除</button>
      <div style="display:flex;gap:8px;">
        <button class="btn outline" id="m-cancel">キャンセル</button>
        <button class="btn" id="m-save">保存</button>
      </div>
    </div>
  </div>
</div>

<div class="backdrop" id="rbackdrop">
  <div class="modal" style="max-width:420px;">
    <div class="mhead"><h3>売上報告(実績)</h3><button class="xbtn" id="r-close">×</button></div>
    <div class="mbody" style="grid-template-columns:1fr;">
      <div class="muted" id="r-meta"></div>
      <div class="fld" id="r-sales-wrap"><label>実売上</label><input class="tech-input" type="number" id="r-sales" placeholder="この期の売上"></div>
      <div class="fld" id="r-qty-wrap" style="display:none;"><label>実数量</label><input class="tech-input" type="number" id="r-qty" placeholder="この期の製造/販売数"></div>
      <div class="fld"><label>メモ</label><input class="tech-input" id="r-note"></div>
      <div class="calc full">入力すると、この回の受領予定が「実績(料率×実績)」で再計算されます。MG・前払は全体で調整されます。</div>
    </div>
    <div class="mfoot" style="flex-wrap:wrap;gap:8px;">
      <div style="display:flex;gap:8px;">
        <button class="btn outline" id="r-delete" style="color:#b91c1c;border-color:#b91c1c;">報告を削除</button>
        <button class="btn outline" id="r-confirm">受領確定</button>
      </div>
      <div style="display:flex;gap:8px;"><button class="btn outline" id="r-cancel">閉じる</button><button class="btn" id="r-save">報告を保存</button></div>
    </div>
  </div>
</div>

<script>
  var OPT = { works: [], sublicensees: [] };
  var rCtx = null; // { deal_id, date, basis }
  var DEALS = [];
  var RECEIPTS = [];
  var editId = null;
  var KIND_LABEL = { sublicense:"サブライセンス", publication:"出版印税", license_out:"ライセンスアウト", service:"役務・その他", other:"その他" };
  var STATUS_LABEL = { unbilled:"未請求", billed:"請求済", received:"入金済" };
  function kindLabel(k){return KIND_LABEL[k]||k||"";}

  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function yen(n){var v=Number(n);return isFinite(v)?v.toLocaleString("ja-JP"):"";}
  function gv(id){return (document.getElementById(id).value||"").trim();}

  async function jget(u){var r=await fetch(u,{credentials:"same-origin"});if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}

  async function loadOptions(){
    try{var d=await jget("/api/sublicense/options");OPT.works=d.works||[];OPT.sublicensees=d.sublicensees||[];}catch(e){}
    var w=document.getElementById("m-work");
    w.innerHTML='<option value="">—</option>'+OPT.works.map(function(o){return '<option value="'+o.id+'">'+esc((o.work_code?o.work_code+" : ":"")+(o.title||("#"+o.id)))+'</option>';}).join("");
    var s=document.getElementById("m-sub");
    s.innerHTML='<option value="">— 手入力 —</option>'+OPT.sublicensees.map(function(o){return '<option value="'+o.id+'">'+esc(o.name||("#"+o.id))+'</option>';}).join("");
  }

  /* ---- 受領条件(deals) ---- */
  async function loadDeals(){
    try{var d=await jget("/api/sublicense/deals");DEALS=d.rows||[];}catch(e){DEALS=[];}
    document.getElementById("deal-count").textContent=DEALS.length+" 件";
    var wrap=document.getElementById("deals-wrap");
    if(DEALS.length===0){wrap.innerHTML='<div class="empty">受領条件がありません。「＋ 条件を追加」から登録してください。</div>';return;}
    var head='<tr><th>種別</th><th>作品</th><th>相手方</th><th>基準</th><th class="num">料率%</th><th class="num">MG</th><th class="num">前払</th><th class="num">受領予定(net)</th><th>周期/期間</th><th>参照契約</th></tr>';
    var body=DEALS.map(function(r){
      var basis=r.basis==="manufacturing"?'<span class="pill">製造数</span>':'<span class="pill sales">売上</span>';
      var term=(r.term_start||"—")+" 〜 "+(r.term_end||"継続");
      return '<tr class="clickable" data-id="'+r.id+'">'+
        '<td><span class="pill">'+esc(kindLabel(r.receivable_kind))+'</span></td>'+
        '<td class="wrap">'+esc((r.work_code?r.work_code+" : ":"")+(r.work_title||"—"))+'</td>'+
        '<td class="wrap">'+esc(r.sublicensee_name||"—")+'</td>'+
        '<td>'+basis+'</td>'+
        '<td class="num">'+(r.rate_pct==null?"":esc(r.rate_pct))+'</td>'+
        '<td class="num">'+yen(r.mg_amount)+'</td>'+
        '<td class="num">'+yen(r.advance_amount)+'</td>'+
        '<td class="num"><b>'+yen(r.net)+'</b></td>'+
        '<td>'+esc(cycleLabel(r.cycle))+'<div class="muted">'+esc(term)+'</div></td>'+
        '<td>'+esc(r.source_contract_number||"—")+'</td>'+
        '</tr>';
    }).join("");
    wrap.innerHTML='<table class="t">'+head+body+'</table>';
  }
  function cycleLabel(c){return c==="MONTHLY"?"月次":c==="QUARTERLY"?"四半期":c==="SEMIANNUAL"?"半年":c==="ANNUAL"?"年次":c==="CUSTOM"?"カスタム":(c||"");}

  function openEdit(deal){
    editId=deal&&deal.id?deal.id:null;
    document.getElementById("m-title").textContent=editId?"受領条件を編集":"受領条件を追加";
    document.getElementById("m-delete").style.display=editId?"":"none";
    var d=deal||{};
    document.getElementById("m-kind").value=d.receivable_kind||"sublicense";
    document.getElementById("m-work").value=d.work_id||"";
    document.getElementById("m-sub").value=d.sublicensee_id||"";
    document.getElementById("m-cpname").value=d.counterparty_name||d.inline_sublicensee_name||"";
    document.getElementById("m-contract").value=d.source_contract_number||"";
    document.getElementById("m-basis").value=d.basis||"sales";
    document.getElementById("m-rate").value=d.rate_pct==null?"":d.rate_pct;
    document.getElementById("m-unit").value=d.unit_price==null?"":d.unit_price;
    document.getElementById("m-forecast").value=d.forecast_amount==null?"":d.forecast_amount;
    document.getElementById("m-mg").value=d.mg_amount==null?"":d.mg_amount;
    document.getElementById("m-adv").value=d.advance_amount==null?"":d.advance_amount;
    document.getElementById("m-cur").value=d.currency||"JPY";
    document.getElementById("m-cycle").value=d.cycle||"QUARTERLY";
    document.getElementById("m-icount").value=d.interval_count==null?"":d.interval_count;
    document.getElementById("m-iunit").value=d.interval_unit||"MONTH";
    document.getElementById("m-billday").value=d.billing_day==null?"":d.billing_day;
    document.getElementById("m-start").value=d.term_start||"";
    document.getElementById("m-end").value=d.term_end||"";
    document.getElementById("m-remarks").value=d.remarks||"";
    toggleCustom(); updateCalc();
    document.getElementById("backdrop").classList.add("open");
  }
  function closeModal(){document.getElementById("backdrop").classList.remove("open");editId=null;}
  function toggleCustom(){document.getElementById("m-custom-wrap").style.display=document.getElementById("m-cycle").value==="CUSTOM"?"":"none";}
  function collect(){
    return {
      id: editId||undefined,
      receivable_kind: gv("m-kind")||"sublicense",
      work_id: gv("m-work")||null,
      sublicensee_id: gv("m-sub")||null,
      counterparty_name: gv("m-cpname")||null,
      inline_sublicensee_name: null, // 手入力は counterparty_name に一本化(旧 inline は移行)
      source_contract_number: gv("m-contract")||null,
      basis: gv("m-basis")||"sales",
      rate_pct: gv("m-rate")||null,
      unit_price: gv("m-unit")||null,
      forecast_amount: gv("m-forecast")||null,
      mg_amount: gv("m-mg")||null,
      advance_amount: gv("m-adv")||null,
      currency: gv("m-cur")||"JPY",
      cycle: gv("m-cycle")||"QUARTERLY",
      interval_unit: gv("m-iunit")||null,
      interval_count: gv("m-icount")||null,
      billing_day: gv("m-billday")||null,
      term_start: gv("m-start")||null,
      term_end: gv("m-end")||null,
      remarks: gv("m-remarks")||null,
    };
  }
  function updateCalc(){
    var d=collect();
    var rate=Number(d.rate_pct)/100||0;
    var royalty=d.basis==="manufacturing"?rate*(Number(d.unit_price)||0)*(Number(d.forecast_amount)||0):rate*(Number(d.forecast_amount)||0);
    var gross=Math.max(royalty,Number(d.mg_amount)||0);
    var net=Math.max(gross-(Number(d.advance_amount)||0),0);
    document.getElementById("m-calc").innerHTML=
      "試算: 料率×見込 = "+yen(Math.round(royalty))+" / max(料率,MG)= "+yen(Math.round(gross))+
      " / 前払相殺後 <b>net = "+yen(Math.round(net))+"</b>(通貨 "+esc(d.currency)+")。期間内で均等割りして各回に展開します。";
  }
  async function saveDeal(){
    var btn=document.getElementById("m-save");btn.disabled=true;
    try{
      var res=await fetch("/api/sublicense/deals",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(collect())});
      var data=await res.json().catch(function(){return{};});
      if(!res.ok||data.ok===false)throw new Error(data.error||("HTTP "+res.status));
      closeModal(); await loadDeals(); await loadReceipts();
    }catch(e){alert("保存に失敗しました: "+(e&&e.message?e.message:e));}finally{btn.disabled=false;}
  }
  async function deleteDeal(){
    if(!editId)return; if(!confirm("この受領条件を削除しますか?"))return;
    try{
      var res=await fetch("/api/sublicense/deals/"+editId,{method:"DELETE",credentials:"same-origin"});
      var data=await res.json().catch(function(){return{};});
      if(!res.ok||data.ok===false)throw new Error(data.error||("HTTP "+res.status));
      closeModal(); await loadDeals(); await loadReceipts();
    }catch(e){alert("削除に失敗しました: "+(e&&e.message?e.message:e));}
  }

  /* ---- 受領予定一覧 ---- */
  function rgather(){
    var p=new URLSearchParams();
    ["from","to","kind","status","sublicensee","work","q"].forEach(function(id){var v=gv(id);if(v)p.set(id,v);});
    return p;
  }
  async function loadReceipts(){
    var wrap=document.getElementById("receipts-wrap");
    wrap.innerHTML='<div class="empty">検索中…</div>';
    try{
      var data=await jget("/api/sublicense/receipts?"+rgather().toString());
      RECEIPTS=data.rows||[];
      document.getElementById("rcount").textContent=RECEIPTS.length+" 件";
      renderReceipts();
    }catch(e){wrap.innerHTML='<div class="empty" style="color:#b91c1c;">読み込み失敗: '+esc(e&&e.message?e.message:e)+'</div>';}
  }
  function renderReceipts(){
    var wrap=document.getElementById("receipts-wrap");
    if(RECEIPTS.length===0){wrap.innerHTML='<div class="empty">受領予定がありません(条件の開始日・周期・金額を設定してください)。</div>';updateSel();return;}
    var head='<tr><th class="chk"><input type="checkbox" id="chk-all"></th><th>請求状態</th><th>種別</th><th>受領予定日</th><th>相手方</th><th>作品</th><th>参照契約</th><th>区分</th><th>実売上/数量</th><th>回</th><th class="num">金額</th></tr>';
    var body=RECEIPTS.map(function(r){
      var kubun=r.estimated?'<span class="pill">見込</span>':'<span class="pill sales">実績</span>';
      var st=r.status||"unbilled";
      var sel='<select class="tech-select stsel" data-deal="'+r.deal_id+'" data-date="'+esc(r.receipt_date)+'" onclick="event.stopPropagation()" style="font-size:11px;padding:2px 4px;">'+
        ['unbilled','billed','received'].map(function(k){return '<option value="'+k+'"'+(k===st?' selected':'')+'>'+STATUS_LABEL[k]+'</option>';}).join("")+'</select>';
      var reported=r.basis==="manufacturing"?(r.reported_quantity==null?"":yen(r.reported_quantity)):(r.reported_sales==null?"":yen(r.reported_sales));
      var note=(r.mg_topup?' <span class="pill mg">MG+'+yen(r.mg_topup)+'</span>':'')+(r.advance_applied?' <span class="pill adv">前払-'+yen(r.advance_applied)+'</span>':'');
      return '<tr class="clickable'+(st==="received"?' confirmed':'')+'" data-deal="'+r.deal_id+'" data-date="'+esc(r.receipt_date)+'" data-basis="'+esc(r.basis)+'" data-confirmed="'+(r.confirmed?'1':'')+'">'+
        '<td class="chk"><input type="checkbox" class="rchk" value="'+esc(r.row_id)+'" onclick="event.stopPropagation()"></td>'+
        '<td>'+sel+'</td>'+
        '<td><span class="pill">'+esc(kindLabel(r.receivable_kind))+'</span></td>'+
        '<td>'+esc(r.receipt_date)+'</td>'+
        '<td class="wrap">'+esc(r.sublicensee_name||"—")+'</td>'+
        '<td class="wrap">'+esc((r.work_code?r.work_code+" : ":"")+(r.work_title||"—"))+'</td>'+
        '<td>'+esc(r.source_contract_number||"—")+'</td>'+
        '<td>'+kubun+'</td>'+
        '<td class="num">'+reported+'</td>'+
        '<td>'+r.seq+'/'+r.of+'</td>'+
        '<td class="num">'+esc(r.currency)+' '+yen(r.amount)+note+'</td></tr>';
    }).join("");
    wrap.innerHTML='<table class="t">'+head+body+'</table>';
    updateSel();
  }
  /* ---- 売上報告(実績)入力 ---- */
  async function openReport(dealId, date, basis, confirmed){
    rCtx={deal_id:dealId,date:date,basis:basis,confirmed:!!confirmed};
    var deal=DEALS.filter(function(x){return x.id===dealId;})[0]||{};
    document.getElementById("r-meta").innerHTML="作品: <b>"+esc(deal.work_title||"—")+"</b><br>相手: "+esc(deal.sublicensee_name||"—")+" / 受領予定日: <b>"+esc(date)+"</b>"+(confirmed?' <span class="pill ok">受領済</span>':"");
    var cb=document.getElementById("r-confirm");
    cb.textContent=confirmed?"受領を取消":"受領確定";
    cb.style.color=confirmed?"#b91c1c":"";cb.style.borderColor=confirmed?"#b91c1c":"";
    document.getElementById("r-sales-wrap").style.display=basis==="manufacturing"?"none":"";
    document.getElementById("r-qty-wrap").style.display=basis==="manufacturing"?"":"none";
    document.getElementById("r-sales").value="";document.getElementById("r-qty").value="";document.getElementById("r-note").value="";
    // 既存報告を取得して prefill
    try{
      var d=await jget("/api/sublicense/deals/"+dealId+"/reports");
      var rep=(d.rows||[]).filter(function(x){return x.period_date===date;})[0];
      if(rep){document.getElementById("r-sales").value=rep.reported_sales==null?"":rep.reported_sales;document.getElementById("r-qty").value=rep.reported_quantity==null?"":rep.reported_quantity;document.getElementById("r-note").value=rep.note||"";}
    }catch(e){}
    document.getElementById("rbackdrop").classList.add("open");
  }
  function closeReport(){document.getElementById("rbackdrop").classList.remove("open");rCtx=null;}
  async function saveReport(){
    if(!rCtx)return;var btn=document.getElementById("r-save");btn.disabled=true;
    try{
      var body={deal_id:rCtx.deal_id,period_date:rCtx.date,note:gv("r-note")||null};
      if(rCtx.basis==="manufacturing")body.reported_quantity=gv("r-qty")||null;else body.reported_sales=gv("r-sales")||null;
      var res=await fetch("/api/sublicense/reports",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      var data=await res.json().catch(function(){return{};});
      if(!res.ok||data.ok===false)throw new Error(data.error||("HTTP "+res.status));
      closeReport();await loadReceipts();
    }catch(e){alert("保存に失敗しました: "+(e&&e.message?e.message:e));}finally{btn.disabled=false;}
  }
  async function deleteReport(){
    if(!rCtx)return;if(!confirm("この期の売上報告を削除しますか?(受領予定は見込ベースに戻ります)"))return;
    try{
      var res=await fetch("/api/sublicense/reports?deal_id="+rCtx.deal_id+"&period_date="+encodeURIComponent(rCtx.date),{method:"DELETE",credentials:"same-origin"});
      var data=await res.json().catch(function(){return{};});
      if(!res.ok||data.ok===false)throw new Error(data.error||("HTTP "+res.status));
      closeReport();await loadReceipts();
    }catch(e){alert("削除に失敗しました: "+(e&&e.message?e.message:e));}
  }

  async function toggleConfirm(){
    if(!rCtx)return;var btn=document.getElementById("r-confirm");btn.disabled=true;
    try{
      var res;
      if(rCtx.confirmed){
        res=await fetch("/api/sublicense/receipts/confirm?deal_id="+rCtx.deal_id+"&period_date="+encodeURIComponent(rCtx.date),{method:"DELETE",credentials:"same-origin"});
      }else{
        res=await fetch("/api/sublicense/receipts/confirm",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({deal_id:rCtx.deal_id,period_date:rCtx.date})});
      }
      var data=await res.json().catch(function(){return{};});
      if(!res.ok||data.ok===false)throw new Error(data.error||("HTTP "+res.status));
      closeReport();await loadReceipts();
    }catch(e){alert("処理に失敗しました: "+(e&&e.message?e.message:e));}finally{btn.disabled=false;}
  }

  /* ---- 請求状態(台帳)更新 ---- */
  async function setStatus(dealId, date, status){
    try{
      var res=await fetch("/api/sublicense/receipts/status",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({deal_id:dealId,period_date:date,status:status})});
      var data=await res.json().catch(function(){return{};});
      if(!res.ok||data.ok===false)throw new Error(data.error||("HTTP "+res.status));
      // RECEIPTS 内の該当行を更新して再描画(全件再取得は不要)
      RECEIPTS.forEach(function(r){if(r.deal_id===dealId&&r.receipt_date===date)r.status=status;});
      renderReceipts();
    }catch(e){alert("状態更新に失敗しました: "+(e&&e.message?e.message:e));loadReceipts();}
  }

  function checkedIds(){return Array.prototype.slice.call(document.querySelectorAll(".rchk:checked")).map(function(c){return c.value;});}
  function updateSel(){var el=document.getElementById("sel-n");if(el)el.textContent=checkedIds().length;}
  function csvExport(ids){var p=rgather();if(ids&&ids.length)p.set("ids",ids.join(","));window.location.href="/api/sublicense/receipts/export?"+p.toString();}

  /* ---- 条件明細(inbound)→請求権 取込 ---- */
  async function importInbound(silent){
    var btn=document.getElementById("btn-import");if(btn)btn.disabled=true;
    try{
      var res=await fetch("/api/sublicense/receipts/import",{method:"POST",credentials:"same-origin"});
      var data=await res.json().catch(function(){return{};});
      if(!res.ok||data.ok===false)throw new Error(data.error||("HTTP "+res.status));
      if(!silent)alert("取込完了: 新規 "+(data.imported||0)+" 件 / 更新 "+(data.updated||0)+" 件");
      await loadDeals();await loadReceipts();
    }catch(e){if(!silent)alert("取込に失敗しました: "+(e&&e.message?e.message:e));}finally{if(btn)btn.disabled=false;}
  }

  /* ---- wiring ---- */
  document.getElementById("btn-import").addEventListener("click",function(){importInbound(false);});
  document.getElementById("btn-add").addEventListener("click",function(){openEdit(null);});
  document.getElementById("deals-wrap").addEventListener("click",function(e){var tr=e.target.closest?e.target.closest("tr.clickable"):null;if(tr){var id=Number(tr.getAttribute("data-id"));var d=DEALS.filter(function(x){return x.id===id;})[0];if(d)openEdit(d);}});
  document.getElementById("m-close").addEventListener("click",closeModal);
  document.getElementById("m-cancel").addEventListener("click",closeModal);
  document.getElementById("m-save").addEventListener("click",saveDeal);
  document.getElementById("m-delete").addEventListener("click",deleteDeal);
  document.getElementById("m-cycle").addEventListener("change",function(){toggleCustom();updateCalc();});
  ["m-basis","m-rate","m-unit","m-forecast","m-mg","m-adv","m-cur"].forEach(function(id){document.getElementById(id).addEventListener("input",updateCalc);});
  document.getElementById("backdrop").addEventListener("click",function(e){if(e.target===document.getElementById("backdrop"))closeModal();});
  document.getElementById("btn-search").addEventListener("click",loadReceipts);
  document.getElementById("kind").addEventListener("change",loadReceipts);
  document.getElementById("status").addEventListener("change",loadReceipts);
  document.getElementById("btn-clear").addEventListener("click",function(){["from","to","kind","status","sublicensee","work","q"].forEach(function(id){document.getElementById(id).value="";});loadReceipts();});
  document.getElementById("receipts-wrap").addEventListener("change",function(e){
    var s=e.target;
    if(s&&s.classList&&s.classList.contains("stsel")){setStatus(Number(s.getAttribute("data-deal")),s.getAttribute("data-date"),s.value);}
  });
  document.getElementById("receipts-wrap").addEventListener("click",function(e){
    var t=e.target;
    if(t&&t.id==="chk-all"){Array.prototype.slice.call(document.querySelectorAll(".rchk")).forEach(function(c){c.checked=t.checked;});updateSel();return;}
    if(t&&(t.classList.contains("rchk"))){updateSel();return;}
    if(t&&t.classList&&t.classList.contains("stsel"))return; // 状態selectはモーダルを開かない
    var tr=t.closest?t.closest("tr.clickable"):null;
    if(tr){openReport(Number(tr.getAttribute("data-deal")),tr.getAttribute("data-date"),tr.getAttribute("data-basis"),tr.getAttribute("data-confirmed")==="1");}
  });
  document.getElementById("r-close").addEventListener("click",closeReport);
  document.getElementById("r-cancel").addEventListener("click",closeReport);
  document.getElementById("r-save").addEventListener("click",saveReport);
  document.getElementById("r-delete").addEventListener("click",deleteReport);
  document.getElementById("r-confirm").addEventListener("click",toggleConfirm);
  document.getElementById("rbackdrop").addEventListener("click",function(e){if(e.target===document.getElementById("rbackdrop"))closeReport();});
  document.getElementById("btn-csv-all").addEventListener("click",function(){csvExport(null);});
  document.getElementById("btn-csv-sel").addEventListener("click",function(){var ids=checkedIds();if(!ids.length){alert("CSV出力する行を選択してください。");return;}csvExport(ids);});

  (async function(){
    await loadOptions();await loadDeals();await loadReceipts();
    importInbound(true); // 起動時に条件明細(inbound)を自動取込(冪等・サイレント)
  })();
</script>`;

  return popAdminPage({
    active: "sublicense",
    masterCss: MASTER_CSS,
    title: "請求権台帳(受領予定)",
    subtitle: "当社の請求権 · サブライセンス/出版印税/ライセンスアウト等の受領予定と請求状態(未請求/請求済/入金済)",
    body,
    headExtra: `<style>${EXTRA_CSS}</style>`,
  });
}
