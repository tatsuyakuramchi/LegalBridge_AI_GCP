/**
 * paymentExportHtml — 支払Excel発行(検収書/利用許諾料計算書)。
 *
 *   GET /payments/excel-export
 *
 * ログイン担当者が自分の担当する検収書/利用許諾料計算書を支払期日の期間で
 * 絞り込み、チェックして「Excel発行」→ ZIP(検収書PDF×N + Excel 1ファイル/種別)
 * をローカルにダウンロードする。admin は全担当者・担当者未設定も扱える。
 *
 * データ: GET /api/payment-exports/list (paymentExportService)。
 */
import { popPage } from "./popChrome.ts";
import type { Role } from "../lib/screens.ts";

const EXTRA_CSS = `<style>
.pex-filters{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px}
.pex-filters .f{display:flex;flex-direction:column;gap:4px}
.pex-filters label{font-size:11px;font-weight:800;color:var(--muted)}
.pex-filters input[type=date],.pex-filters select{border:1.5px solid #e2dbfb;border-radius:10px;padding:7px 10px;font:inherit;font-size:13px;background:#fff}
.pex-summary{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:0 0 10px;font-size:12.5px;color:var(--muted)}
.pex-summary b{color:var(--ink)}
table.pex{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;font-size:12.5px}
table.pex th{background:#f6f3ff;color:var(--muted);font-size:11px;text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
table.pex td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
table.pex tr:hover td{background:var(--hover)}
table.pex td.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.pex-cat{display:inline-block;font-size:10px;font-weight:800;padding:1px 8px;border-radius:12px;background:#efeaff;color:#6c5ce7;white-space:nowrap}
.pex-cat.royalty{background:#fff0e6;color:#e8810f}
.pex-issued{font-size:11px;color:var(--muted);white-space:nowrap}
.pex-issued.never{color:#1a9c6b;font-weight:800}
.pex-unset{color:#c43c63;font-weight:800;font-size:11.5px;white-space:nowrap}
.pex-assign{display:flex;gap:6px;align-items:center;margin-top:4px}
.pex-assign select{border:1.5px solid #e2dbfb;border-radius:8px;padding:3px 6px;font-size:11.5px;max-width:170px}
.pex-empty{color:var(--muted);padding:26px;text-align:center;background:#fff;border:1px solid var(--line);border-radius:14px}
.pex-note{background:#fff7e6;border:1px solid #ffe9bf;color:#a9700a;border-radius:12px;padding:8px 12px;font-size:12px;margin:10px 0}
#pex-export[disabled]{opacity:.5;cursor:not-allowed}
.pex-pdf-x{color:#c43c63;font-size:11px;font-weight:800}
</style>`;

export function paymentExportPage(
  role: Role = "viewer",
  userEmail = ""
): string {
  const isAdmin = role === "admin";
  const body = `
  <div class="pex-filters">
    <div class="f"><label>支払期日 (自)</label><input type="date" id="pex-from"></div>
    <div class="f"><label>支払期日 (至)</label><input type="date" id="pex-to"></div>
    <div class="f"><label>種別</label>
      <select id="pex-cat">
        <option value="">すべて</option>
        <option value="inspection_certificate">検収書</option>
        <option value="royalty_statement">利用許諾料計算書</option>
      </select>
    </div>
    ${
      isAdmin
        ? `<div class="f"><label>担当者</label>
      <select id="pex-staff">
        <option value="all">全担当者</option>
        <option value="unset">担当者未設定</option>
      </select>
    </div>`
        : ""
    }
    <button class="pop-btn sm" id="pex-reload">🔄 再読込</button>
    <span class="sp" style="flex:1"></span>
    <button class="pop-btn" id="pex-export" disabled>📥 チェックした文書を Excel 発行 (ZIP)</button>
  </div>

  <div class="pex-summary">
    <span>表示 <b id="pex-count">0</b> 件</span>
    <span>選択 <b id="pex-checked">0</b> 件</span>
    <span class="muted">ZIP には 検収書PDF ×選択件数 と、1行=1文書の Excel(種別 × 個人/法人ごとに1ファイル) が入ります。発行のたびに「前回発行日」が更新されます。</span>
  </div>

  <div id="pex-wrap"><div class="pex-empty">期間を指定して読み込んでください。</div></div>

<script>
  var PEX = { isAdmin: ${isAdmin ? "true" : "false"}, email: ${JSON.stringify(
    userEmail || ""
  )} };
  var ROWS = [];
  var STAFF = [];

  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function fmtIssued(iso){
    if(!iso) return '<span class="pex-issued never">未発行</span>';
    var d=new Date(iso);
    var p=function(n){return (n<10?"0":"")+n;};
    return '<span class="pex-issued">'+d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" "+p(d.getHours())+":"+p(d.getMinutes())+'</span>';
  }
  async function jget(u){var r=await fetch(u,{credentials:"same-origin"});var d=await r.json().catch(function(){return{};});if(!r.ok||d.ok===false)throw new Error(d.error||("HTTP "+r.status));return d;}
  async function jpost(u,body){var r=await fetch(u,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});var d=await r.json().catch(function(){return{};});if(!r.ok||d.ok===false)throw new Error(d.error||("HTTP "+r.status));return d;}

  function defaultPeriod(){
    var now=new Date();
    var first=new Date(now.getFullYear(),now.getMonth(),1);
    var last=new Date(now.getFullYear(),now.getMonth()+1,0);
    var f=function(d){var p=function(n){return (n<10?"0":"")+n;};return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());};
    document.getElementById("pex-from").value=f(first);
    document.getElementById("pex-to").value=f(last);
  }

  function visibleRows(){
    var cat=document.getElementById("pex-cat").value;
    return ROWS.filter(function(r){return !cat||r.category===cat;});
  }
  function checkedNumbers(){
    var out=[];
    document.querySelectorAll(".pex-check:checked").forEach(function(c){out.push(c.getAttribute("data-doc"));});
    return out;
  }
  function refreshCounts(){
    var n=checkedNumbers().length;
    document.getElementById("pex-checked").textContent=n;
    document.getElementById("pex-export").disabled=n===0;
  }

  function staffOptionsHtml(){
    return STAFF.map(function(s){return '<option value="'+esc(s.email)+'">'+esc(s.name)+'</option>';}).join("");
  }

  function render(){
    var rows=visibleRows();
    document.getElementById("pex-count").textContent=rows.length;
    var wrap=document.getElementById("pex-wrap");
    if(!rows.length){wrap.innerHTML='<div class="pex-empty">該当する文書がありません。</div>';refreshCounts();return;}
    var showStaff=PEX.isAdmin;
    var html='<table class="pex"><thead><tr>'+
      '<th><input type="checkbox" id="pex-all" title="全選択"></th>'+
      '<th>種別</th><th>検収書番号</th><th>発注書番号</th><th>取引先名</th><th>件名</th><th>支払期日</th>'+
      (showStaff?'<th>担当者</th>':'')+
      '<th>前回Excel発行日</th><th>PDF</th>'+
      '</tr></thead><tbody>';
    rows.forEach(function(r){
      var staffCell="";
      if(showStaff){
        if(r.inspector_email){
          staffCell='<td>'+esc(r.inspector_name||r.inspector_email)+'</td>';
        }else{
          staffCell='<td><span class="pex-unset">未設定</span>'+
            '<div class="pex-assign"><select id="as-'+esc(r.document_number)+'">'+staffOptionsHtml()+'</select>'+
            '<button class="pop-btn sm" onclick="assignStaff(\\''+esc(r.document_number)+'\\')">設定</button></div></td>';
        }
      }
      html+='<tr>'+
        '<td><input type="checkbox" class="pex-check" data-doc="'+esc(r.document_number)+'"></td>'+
        '<td><span class="pex-cat'+(r.category==="royalty_statement"?" royalty":"")+'">'+esc(r.category_label)+'</span></td>'+
        '<td class="num">'+esc(r.document_number)+'</td>'+
        '<td class="num">'+esc(r.po_number||"—")+'</td>'+
        '<td>'+esc(r.vendor_name||"—")+'</td>'+
        '<td>'+esc(r.title||"—")+'</td>'+
        '<td class="num">'+esc(r.payment_date||"—")+'</td>'+
        staffCell+
        '<td>'+fmtIssued(r.excel_issued_at)+'</td>'+
        '<td>'+(r.has_pdf?'<a href="'+esc(r.drive_link)+'" target="_blank" rel="noopener">開く ↗</a>':'<span class="pex-pdf-x">なし</span>')+'</td>'+
        '</tr>';
    });
    html+='</tbody></table>';
    wrap.innerHTML=html;
    document.getElementById("pex-all").addEventListener("change",function(){
      var on=this.checked;
      document.querySelectorAll(".pex-check").forEach(function(c){c.checked=on;});
      refreshCounts();
    });
    document.querySelectorAll(".pex-check").forEach(function(c){c.addEventListener("change",refreshCounts);});
    refreshCounts();
  }

  async function load(){
    var from=document.getElementById("pex-from").value;
    var to=document.getElementById("pex-to").value;
    if(!from||!to){alert("期間(自/至)を指定してください");return;}
    var wrap=document.getElementById("pex-wrap");
    wrap.innerHTML='<div class="pex-empty">読み込み中…</div>';
    try{
      var u="/api/payment-exports/list?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to);
      if(PEX.isAdmin){
        var st=document.getElementById("pex-staff").value;
        u+="&staff="+encodeURIComponent(st);
      }
      var d=await jget(u);
      ROWS=d.rows||[];
      render();
    }catch(e){
      wrap.innerHTML='<div class="pex-empty" style="color:#b91c1c;">読み込み失敗: '+esc(e&&e.message?e.message:e)+'</div>';
    }
  }

  async function loadStaffOptions(){
    if(!PEX.isAdmin)return;
    try{
      var d=await jget("/api/payment-exports/staff-options");
      STAFF=d.rows||[];
      var sel=document.getElementById("pex-staff");
      var keep=sel.value;
      sel.innerHTML='<option value="all">全担当者</option><option value="unset">担当者未設定</option>'+
        STAFF.map(function(s){return '<option value="'+esc(s.email)+'">'+esc(s.name)+'</option>';}).join("");
      sel.value=keep||"all";
    }catch(e){}
  }

  window.assignStaff=async function(docNumber){
    var sel=document.getElementById("as-"+docNumber);
    var email=sel?sel.value:"";
    if(!email){alert("担当者を選択してください");return;}
    if(!confirm(docNumber+" の担当者を設定しますか?"))return;
    try{
      await jpost("/api/payment-exports/assign",{documentNumbers:[docNumber],staff_email:email});
      load();
    }catch(e){alert("担当者設定に失敗: "+(e&&e.message?e.message:e));}
  };

  function fileNameFromDisposition(cd,fallback){
    if(!cd)return fallback;
    var m=/filename\\*=UTF-8''([^;]+)/i.exec(cd);
    if(m){try{return decodeURIComponent(m[1]);}catch(e){}}
    m=/filename="?([^";]+)"?/i.exec(cd);
    return m?m[1]:fallback;
  }

  async function doExport(){
    var nums=checkedNumbers();
    if(!nums.length)return;
    var btn=document.getElementById("pex-export");
    btn.disabled=true;var orig=btn.textContent;btn.textContent="生成中…";
    try{
      var res=await fetch("/api/payment-exports/export",{
        method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({documentNumbers:nums})
      });
      if(!res.ok){
        var d=await res.json().catch(function(){return{};});
        throw new Error(d.error||("HTTP "+res.status));
      }
      var failures=Number(res.headers.get("X-Pdf-Failures")||"0");
      var blob=await res.blob();
      var name=fileNameFromDisposition(res.headers.get("Content-Disposition"),"支払申請.zip");
      var a=document.createElement("a");
      a.href=URL.createObjectURL(blob);a.download=name;
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(function(){URL.revokeObjectURL(a.href);},4000);
      if(failures>0){
        alert("一部の PDF が取得できませんでした ("+failures+"件)。ZIP 内の『PDF未取得一覧.txt』を確認してください。");
      }
      load(); // 前回発行日を更新表示
    }catch(e){
      alert("Excel 発行に失敗: "+(e&&e.message?e.message:e));
    }finally{
      btn.textContent=orig;refreshCounts();
    }
  }

  document.getElementById("pex-reload").addEventListener("click",load);
  document.getElementById("pex-export").addEventListener("click",doExport);
  document.getElementById("pex-cat").addEventListener("change",render);
  ${isAdmin ? `document.getElementById("pex-staff").addEventListener("change",load);` : ""}
  (async function(){
    defaultPeriod();
    await loadStaffOptions();
    load();
  })();
</script>`;

  return popPage({
    active: "payment-exports",
    role,
    mode: "view",
    title: "支払Excel発行",
    subtitle: "検収書・利用許諾料計算書 → 支払申請用 Excel + PDF (ZIP)",
    body,
    headExtra: EXTRA_CSS,
    pageTitle: "支払Excel発行 · Arcs Legal OS",
  });
}
