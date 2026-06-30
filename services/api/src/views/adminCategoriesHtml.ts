/**
 * adminCategoriesHtml — /admin/guides/categories カテゴリ管理(admin 書込)。
 *
 * 法務ポータルのサイトカテゴリ(A〜D 等)を 追加・編集(ラベル/色/説明/並び順/有効)・
 * 削除 する。書込は同一オリジンの JSON API:
 *   POST   /api/portal/categories          作成
 *   PATCH  /api/portal/categories/:catKey   更新
 *   DELETE /api/portal/categories/:catKey   削除(所属ガイドがあるとブロック)
 * 認可は server.ts requireAppRole({allowedRoles:["admin"]}) が担保。
 */

import { popPage } from "./popChrome.ts";
import type { CategoryAdminRow } from "../services/portalGuideService.ts";

const esc = (s: unknown): string =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const EXTRA_CSS = `<style>
.cat-banner{display:flex;gap:10px;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#efeaff,#f6f3ff);border:1px solid #e2dbfb;border-radius:14px;padding:11px 15px;margin-bottom:16px;font-size:12.5px;font-weight:600;flex-wrap:wrap}
.cat-banner a{color:#6c5ce7;text-decoration:none;font-weight:800}
.cat-table{width:100%;border-collapse:collapse;font-size:12.5px;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.cat-table th{background:#f4f1fb;color:var(--ink);text-align:left;font-weight:800;padding:8px 10px;font-size:11.5px;white-space:nowrap}
.cat-table td{padding:7px 10px;border-top:1px solid var(--line);vertical-align:middle}
.cat-table input[type=text]{width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font:inherit;font-size:12px;background:#fff}
.cat-table input[type=number]{width:60px;border:1px solid var(--line);border-radius:8px;padding:6px 6px;font:inherit;font-size:12px}
.cat-table input[type=color]{width:34px;height:28px;border:1px solid var(--line);border-radius:6px;padding:0;background:#fff;vertical-align:middle;cursor:pointer}
.cat-key{font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;color:var(--muted);white-space:nowrap}
.cat-cnt{font-size:11px;color:var(--muted);text-align:center}
.cat-btn{border:0;border-radius:9px;padding:6px 11px;font:inherit;font-size:11.5px;font-weight:800;cursor:pointer}
.cat-save{background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff}
.cat-del{background:#fff;border:1px solid #f0c0cc;color:#a3243e}
.cat-del:disabled{opacity:.4;cursor:not-allowed}
.cat-add{display:grid;grid-template-columns:120px 1fr 56px 1fr 70px auto;gap:8px;align-items:center;background:#fff;border:1px dashed #cdbef5;border-radius:12px;padding:12px 14px;margin-top:16px}
.cat-add input{border:1px solid var(--line);border-radius:8px;padding:7px 9px;font:inherit;font-size:12px}
.cat-add label{font-size:10.5px;font-weight:800;color:var(--muted);grid-column:1/-1;margin-bottom:-2px}
.cat-note{font-size:11px;color:var(--muted);margin:8px 2px 0}
#cat-msg{margin:10px 0;font-size:12.5px;font-weight:700;display:none;border-radius:10px;padding:9px 12px}
#cat-msg.ok{display:block;background:#e4f7f1;color:#0d6b4e}
#cat-msg.err{display:block;background:#ffe9ef;color:#a3243e}
.cat-swatch{display:inline-block;width:13px;height:13px;border-radius:3px;vertical-align:middle;margin-right:6px;border:1px solid rgba(0,0,0,.1)}
</style>`;

function row(c: CategoryAdminRow): string {
  const color = c.color || "#1d3557";
  return `<tr data-key="${esc(c.catKey)}">
    <td class="cat-key"><span class="cat-swatch" style="background:${esc(color)}"></span>${esc(c.catKey)}</td>
    <td><input type="text" class="f-label" value="${esc(c.label)}"></td>
    <td><input type="color" class="f-color" value="${esc(color)}"></td>
    <td><input type="text" class="f-desc" value="${esc(c.description)}"></td>
    <td><input type="number" class="f-sort" value="${c.sortOrder}"></td>
    <td style="text-align:center"><input type="checkbox" class="f-active" ${c.isActive ? "checked" : ""}></td>
    <td class="cat-cnt">${c.guideCount}</td>
    <td style="white-space:nowrap">
      <button class="cat-btn cat-save" onclick="saveCat('${esc(c.catKey)}')">保存</button>
      <button class="cat-btn cat-del" ${c.guideCount > 0 ? "disabled title='所属ガイドあり: 先に付け替え'" : ""} onclick="delCat('${esc(c.catKey)}')">削除</button>
    </td>
  </tr>`;
}

export function adminCategoriesPage(opts: { categories: CategoryAdminRow[] }): string {
  const rows = opts.categories.map(row).join("");
  const body = `
  <div class="cat-banner">
    <span>🗂️ ポータルの<strong style="margin:0 3px">カテゴリ</strong>(A〜D 等)の追加・編集・並び替え・削除。変更は即時反映されます。</span>
    <a href="/admin/guides">← ガイド管理へ</a>
  </div>
  <div id="cat-msg"></div>
  <table class="cat-table">
    <thead><tr><th>キー(/c/:cat)</th><th>ラベル</th><th>色</th><th>説明</th><th>並び順</th><th>有効</th><th>ガイド数</th><th>操作</th></tr></thead>
    <tbody id="cat-rows">${rows}</tbody>
  </table>

  <div class="cat-add">
    <label>新規カテゴリ</label>
    <input type="text" id="n-key" placeholder="キー (例: compliance)">
    <input type="text" id="n-label" placeholder="ラベル (例: D. 法律・コンプラ)">
    <input type="color" id="n-color" value="#1d3557">
    <input type="text" id="n-desc" placeholder="説明">
    <input type="number" id="n-sort" placeholder="並び順">
    <button class="cat-btn cat-save" onclick="addCat()">追加</button>
  </div>
  <p class="cat-note">キーは英小文字・数字・<code>_</code>・<code>-</code>（40字以内）。URL <code>/c/&lt;キー&gt;</code> に使われるため作成後は変更不可。削除は所属ガイドが 0 件のときのみ可能。</p>

  <script>
    function msg(text, ok){
      var m=document.getElementById('cat-msg');
      m.textContent=text; m.className=ok?'ok':'err';
      if(ok) setTimeout(function(){ location.reload(); }, 600);
    }
    async function call(method, path, payload){
      var res = await fetch(path, {
        method: method,
        headers: payload ? {'Content-Type':'application/json'} : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
      });
      var data = {};
      try { data = await res.json(); } catch(_){}
      if(!res.ok || data.ok===false){ throw new Error(data.error || ('HTTP '+res.status)); }
      return data;
    }
    async function saveCat(key){
      var tr=document.querySelector('tr[data-key="'+key+'"]');
      var payload={
        label: tr.querySelector('.f-label').value,
        color: tr.querySelector('.f-color').value,
        description: tr.querySelector('.f-desc').value,
        sortOrder: Number(tr.querySelector('.f-sort').value),
        isActive: tr.querySelector('.f-active').checked,
      };
      try{ await call('PATCH','/api/portal/categories/'+encodeURIComponent(key), payload); msg('保存しました', true); }
      catch(e){ msg('保存失敗: '+e.message, false); }
    }
    async function delCat(key){
      if(!confirm('カテゴリ「'+key+'」を削除しますか？')) return;
      try{ await call('DELETE','/api/portal/categories/'+encodeURIComponent(key)); msg('削除しました', true); }
      catch(e){ msg('削除失敗: '+e.message, false); }
    }
    async function addCat(){
      var payload={
        catKey: document.getElementById('n-key').value.trim(),
        label: document.getElementById('n-label').value.trim(),
        color: document.getElementById('n-color').value,
        description: document.getElementById('n-desc').value,
        sortOrder: document.getElementById('n-sort').value ? Number(document.getElementById('n-sort').value) : undefined,
      };
      try{ await call('POST','/api/portal/categories', payload); msg('追加しました', true); }
      catch(e){ msg('追加失敗: '+e.message, false); }
    }
  </script>`;

  return popPage({
    active: "guides",
    role: "admin",
    mode: "admin",
    title: "カテゴリ管理",
    subtitle: "法務ポータル — ポータル & ガイド",
    body,
    headExtra: EXTRA_CSS,
    pageTitle: "LegalBridge カテゴリ管理",
  });
}
