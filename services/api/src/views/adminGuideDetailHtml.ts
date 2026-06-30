/**
 * adminGuideDetailHtml — /admin/guides/:key ガイド本文の差し替え(admin)。
 *
 * pass2: 1ガイドに対して
 *   - 公開トグル(公開中 ⇄ 準備中)
 *   - 新版アップロード(HTML 貼付け or ファイル選択 → 新 version を current にして公開)
 *   - 版ロールバック(過去の版を current に戻す)
 * を提供する。書込は同一オリジン JSON API(server.ts):
 *   POST /api/portal/guides/:key/versions  { html }
 *   POST /api/portal/guides/:key/status    { status }
 *   POST /api/portal/guides/:key/rollback  { versionNo }
 */

import { popPage } from "./popChrome.ts";
import type { GuideMeta, GuideVersionRow } from "../services/portalGuideService.ts";

const esc = (s: unknown): string =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const EXTRA_CSS = `<style>
.gdd-top{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:14px}
.gdd-top a.back{color:#6c5ce7;text-decoration:none;font-weight:800;font-size:12.5px}
.gdd-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:16px}
.gdd-card h3{font-size:13.5px;font-weight:800;margin:0 0 10px;color:var(--ink)}
.gdd-meta{font-size:12px;color:var(--muted)}
.gdd-key{font-family:'Geist Mono',ui-monospace,Menlo,monospace}
.pill{display:inline-block;font-size:10.5px;font-weight:800;border-radius:999px;padding:2px 9px}
.p-pub{background:#e4f7f1;color:#0d6b4e}.p-soon{background:#fef3e2;color:#7a4d09}.p-link{background:#eef3ff;color:#2952cc}
.btn{border:0;border-radius:10px;padding:8px 14px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}
.btn-pri{background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff}
.btn-sec{background:#fff;border:1px solid var(--line);color:var(--ink)}
.btn-warn{background:#fff;border:1px solid #f0c0cc;color:#a3243e}
.gdd-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.vtable{width:100%;border-collapse:collapse;font-size:12.5px}
.vtable th{background:#f4f1fb;text-align:left;font-weight:800;padding:7px 10px;font-size:11.5px}
.vtable td{padding:7px 10px;border-top:1px solid var(--line);vertical-align:middle}
.vtable .cur{font-weight:800;color:#0d6b4e}
textarea#html{width:100%;min-height:200px;border:1px solid var(--line);border-radius:10px;padding:11px;font:12px/1.5 ui-monospace,Menlo,monospace;background:#fff;resize:vertical}
.up-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0}
#gdd-msg{margin:10px 0;font-size:12.5px;font-weight:700;display:none;border-radius:10px;padding:9px 12px}
#gdd-msg.ok{display:block;background:#e4f7f1;color:#0d6b4e}
#gdd-msg.err{display:block;background:#ffe9ef;color:#a3243e}
.muted{color:var(--muted);font-size:11.5px}
</style>`;

function statusPill(g: GuideMeta): string {
  if (g.linkPath) return '<span class="pill p-link">検索へ（リンク）</span>';
  if (g.ready) return '<span class="pill p-pub">公開中</span>';
  return '<span class="pill p-soon">準備中</span>';
}

export function adminGuideDetailPage(opts: {
  guide: GuideMeta;
  versions: GuideVersionRow[];
}): string {
  const g = opts.guide;
  const isPublished = g.status === "published";
  const verRows = opts.versions
    .map((v) => {
      const when = v.createdAt ? esc(v.createdAt.replace("T", " ").slice(0, 16)) : "—";
      return `<tr>
        <td>${v.isCurrent ? '<span class="cur">v' + v.versionNo + " ★現行</span>" : "v" + v.versionNo}</td>
        <td>${when}</td>
        <td>${esc(v.createdBy)}</td>
        <td>${v.chars.toLocaleString()} 文字</td>
        <td>${esc(v.comment)}</td>
        <td>${
          v.isCurrent
            ? '<span class="muted">現行</span>'
            : `<button class="btn btn-sec" onclick="rollback(${v.versionNo})">この版に戻す</button>`
        }</td>
      </tr>`;
    })
    .join("");

  const verSection = g.linkPath
    ? `<p class="muted">このガイドは<strong>リンク型</strong>（${esc(g.linkPath)} へ接続）のため、本文版はありません。</p>`
    : opts.versions.length
    ? `<div class="tw" style="overflow:auto"><table class="vtable">
        <thead><tr><th>版</th><th>作成</th><th>作成者</th><th>サイズ</th><th>コメント</th><th>操作</th></tr></thead>
        <tbody>${verRows}</tbody></table></div>`
    : '<p class="muted">まだ版がありません。下のフォームから最初の本文をアップロードしてください。</p>';

  const body = `
  <div class="gdd-top">
    <div class="gdd-meta">
      <span class="gdd-key">${esc(g.guideKey)}</span> ・ GUIDE ${esc(g.guideNum)} ・ ${statusPill(g)}
      ${g.needsRuntime ? ' ・ <span class="pill p-soon">要改修</span>' : ""}
    </div>
    <a class="back" href="/admin/guides">← ガイド管理へ</a>
  </div>
  <div id="gdd-msg"></div>

  <div class="gdd-card">
    <h3>📣 公開状態</h3>
    <div class="gdd-row">
      <div>現在: ${statusPill(g)}</div>
      ${
        g.linkPath
          ? '<span class="muted">リンク型は常時有効です。</span>'
          : `<button class="btn ${isPublished ? "btn-warn" : "btn-pri"}" onclick="setStatus('${isPublished ? "draft" : "published"}')">
               ${isPublished ? "準備中にする（非公開）" : "公開する"}
             </button>`
      }
      <a class="btn btn-sec" href="${g.linkPath ? esc(g.linkPath) : "/g/" + esc(g.guideKey)}" target="_blank" rel="noopener" style="text-decoration:none">配信プレビュー ↗</a>
    </div>
    ${
      !g.linkPath && g.status === "published" && opts.versions.length === 0
        ? '<p class="muted" style="margin-top:8px">※ 現行版がないため、実際には準備中として扱われます。本文をアップロードしてください。</p>'
        : ""
    }
  </div>

  ${
    g.linkPath
      ? ""
      : `<div class="gdd-card">
    <h3>⬆️ 新版アップロード（差し替え）</h3>
    <p class="muted">GAS 由来の HTML をそのまま貼り付け、またはファイル選択。保存すると<strong>新しい版</strong>を作成し現行版として公開します（旧版は履歴に残ります）。GAS タグはそのままで OK。</p>
    <div class="up-row">
      <input type="file" id="file" accept=".html,.htm,text/html">
      <span class="muted">ファイルを選ぶと下のテキストに読み込まれます</span>
    </div>
    <textarea id="html" placeholder="<!DOCTYPE html> ... ここに HTML を貼り付け"></textarea>
    <div class="up-row">
      <button class="btn btn-pri" onclick="upload()">新版を保存して公開</button>
      <span class="muted" id="bytes"></span>
    </div>
  </div>`
  }

  <div class="gdd-card">
    <h3>🕘 版履歴 / ロールバック</h3>
    ${verSection}
  </div>

  <script>
    var KEY = ${JSON.stringify(g.guideKey)};
    function msg(text, ok){
      var m=document.getElementById('gdd-msg');
      m.textContent=text; m.className=ok?'ok':'err';
      if(ok) setTimeout(function(){ location.reload(); }, 700);
    }
    async function call(path, payload){
      var res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})});
      var data={}; try{ data=await res.json(); }catch(_){}
      if(!res.ok || data.ok===false) throw new Error(data.error || ('HTTP '+res.status));
      return data;
    }
    var fileEl=document.getElementById('file');
    if(fileEl){
      fileEl.addEventListener('change', function(){
        var f=fileEl.files[0]; if(!f) return;
        var r=new FileReader();
        r.onload=function(){ document.getElementById('html').value=String(r.result||''); updBytes(); };
        r.readAsText(f);
      });
    }
    function updBytes(){
      var t=document.getElementById('html'); var b=document.getElementById('bytes');
      if(t&&b) b.textContent = t.value.length.toLocaleString()+' 文字';
    }
    var ta=document.getElementById('html'); if(ta) ta.addEventListener('input', updBytes);
    async function upload(){
      var html=document.getElementById('html').value;
      if(!html.trim()){ msg('HTML が空です', false); return; }
      try{ var d=await call('/api/portal/guides/'+encodeURIComponent(KEY)+'/versions',{html:html}); msg('v'+d.versionNo+' を保存・公開しました', true); }
      catch(e){ msg('保存失敗: '+e.message, false); }
    }
    async function setStatus(s){
      try{ await call('/api/portal/guides/'+encodeURIComponent(KEY)+'/status',{status:s}); msg('公開状態を更新しました', true); }
      catch(e){ msg('更新失敗: '+e.message, false); }
    }
    async function rollback(v){
      if(!confirm('v'+v+' を現行版に戻しますか？')) return;
      try{ await call('/api/portal/guides/'+encodeURIComponent(KEY)+'/rollback',{versionNo:v}); msg('v'+v+' に戻しました', true); }
      catch(e){ msg('失敗: '+e.message, false); }
    }
  </script>`;

  return popPage({
    active: "guides",
    role: "admin",
    mode: "admin",
    title: `ガイド: ${g.title}`,
    subtitle: "法務ポータル — 本文の差し替え・版管理",
    body,
    headExtra: EXTRA_CSS,
    pageTitle: `LegalBridge ガイド編集 — ${g.title}`,
  });
}
