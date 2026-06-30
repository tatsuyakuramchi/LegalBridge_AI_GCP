/**
 * adminAccessHtml — /admin/access 外部アドレス許可(管理者設定)。
 *
 * 外部メールアドレスを許可リスト(portal_access_allowlist)へ追加/削除する。
 * 書込は同一オリジン JSON API(server.ts):
 *   POST   /api/portal/access          { email, note }
 *   DELETE /api/portal/access/:email
 * 認可は requireAppRole admin。
 *
 * ⚠️ これはアプリのロール審査用 allowlist。実際にサイトへ到達できるかは IAP
 *    (GCP エッジ)のドメイン制限次第で、外部ドメインは別途 IAM 許可が必要。
 */

import { popPage } from "./popChrome.ts";
import type { AllowedEmailRow } from "../services/accessAllowlistService.ts";

const esc = (s: unknown): string =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const EXTRA_CSS = `<style>
.ac-note{display:flex;gap:10px;align-items:flex-start;background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:12px 15px;margin-bottom:16px;font-size:12.5px;color:#7a4d09;line-height:1.6}
.ac-add{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#fff;border:1px dashed #cdbef5;border-radius:12px;padding:13px 15px;margin-bottom:16px}
.ac-add input{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit;font-size:12.5px}
.ac-add input.email{min-width:260px}.ac-add input.note{flex:1;min-width:180px}
.btn{border:0;border-radius:9px;padding:8px 13px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}
.btn-pri{background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff}
.btn-del{background:#fff;border:1px solid #f0c0cc;color:#a3243e;font-size:11.5px;padding:6px 11px}
.ac-table{width:100%;border-collapse:collapse;font-size:12.5px;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.ac-table th{background:#f4f1fb;text-align:left;font-weight:800;padding:8px 11px;font-size:11.5px;white-space:nowrap}
.ac-table td{padding:8px 11px;border-top:1px solid var(--line);vertical-align:middle}
.ac-email{font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-weight:700;color:var(--ink)}
.ac-meta{font-size:11px;color:var(--muted)}
#ac-msg{margin:10px 0;font-size:12.5px;font-weight:700;display:none;border-radius:10px;padding:9px 12px}
#ac-msg.ok{display:block;background:#e4f7f1;color:#0d6b4e}
#ac-msg.err{display:block;background:#ffe9ef;color:#a3243e}
</style>`;

export function adminAccessPage(opts: { rows: AllowedEmailRow[] }): string {
  const rows = opts.rows
    .map((r) => {
      const when = r.createdAt ? esc(r.createdAt.replace("T", " ").slice(0, 16)) : "—";
      return `<tr>
        <td><span class="ac-email">${esc(r.email)}</span></td>
        <td>${esc(r.note)}</td>
        <td class="ac-meta">${when}<br>${esc(r.createdBy)}</td>
        <td><button class="btn btn-del" onclick="del('${esc(r.email)}')">削除</button></td>
      </tr>`;
    })
    .join("");

  const body = `
  <div class="ac-note">
    <span>⚠️</span>
    <span>これは<strong>アプリ側のロール審査用</strong>の許可リストです。サイトへ実際に到達できるかは <strong>IAP（GCP エッジ）のドメイン制限</strong>に依存します。外部ドメインのユーザーには、別途 GCP の IAP（IAM）で <code>IAP-secured Web App User</code> 付与が必要です（本画面は IAP を制御しません）。</span>
  </div>
  <div id="ac-msg"></div>

  <div class="ac-add">
    <input type="email" class="email" id="n-email" placeholder="メールアドレス（例: user@example.com）">
    <input type="text" class="note" id="n-note" placeholder="メモ（任意：所属・用途など）">
    <button class="btn btn-pri" onclick="add()">許可に追加</button>
  </div>

  <table class="ac-table">
    <thead><tr><th>メールアドレス</th><th>メモ</th><th>登録</th><th>操作</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="ac-meta" style="padding:14px">まだ登録がありません。</td></tr>'}</tbody>
  </table>

  <script>
    function msg(text, ok){
      var m=document.getElementById('ac-msg');
      m.textContent=text; m.className=ok?'ok':'err';
      if(ok) setTimeout(function(){ location.reload(); }, 600);
    }
    async function call(method, path, payload){
      var res=await fetch(path,{method:method,headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined});
      var data={}; try{ data=await res.json(); }catch(_){}
      if(!res.ok || data.ok===false) throw new Error(data.error || ('HTTP '+res.status));
      return data;
    }
    async function add(){
      var email=document.getElementById('n-email').value.trim();
      var note=document.getElementById('n-note').value;
      if(!email){ msg('メールアドレスを入力してください', false); return; }
      try{ await call('POST','/api/portal/access',{email:email, note:note}); msg('追加しました', true); }
      catch(e){ msg('追加失敗: '+e.message, false); }
    }
    async function del(email){
      if(!confirm(email+' を許可リストから削除しますか？')) return;
      try{ await call('DELETE','/api/portal/access/'+encodeURIComponent(email)); msg('削除しました', true); }
      catch(e){ msg('削除失敗: '+e.message, false); }
    }
  </script>`;

  return popPage({
    active: "admin",
    role: "admin",
    mode: "admin",
    title: "外部アドレス許可",
    subtitle: "アクセス & 権限 — 許可リスト",
    body,
    headExtra: EXTRA_CSS,
    pageTitle: "LegalBridge 外部アドレス許可",
  });
}
