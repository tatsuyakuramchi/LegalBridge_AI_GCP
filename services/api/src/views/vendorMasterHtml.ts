/**
 * 取引先マスター CRUD 管理 UI (Phase 17z)
 *
 * /master/vendors ページ。検索 → 一覧 → 編集/新規作成 を単一ページで
 * 完結させる。フロント JS はバニラ + fetch API (LegalOn インポート画面と
 * 同じパターン)。
 *
 * セキュリティ: 上位 (server.ts) で requireSignedUrl が適用される前提。
 *   URL 自体に exp=&sig= が付かないとアクセスできない (Phase 17s)。
 *   API 呼び出しの URL にも同じ署名を引き継ぐ必要があるので、auth で
 *   渡された SignLink から内部 endpoint 用の signed query string を作る。
 */

import type { SignLink } from "./contractSearchHtml.ts";

const STYLE = `
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans",
               "Yu Gothic", sans-serif;
  margin: 0; padding: 0;
  color: #1f2937;
  background: #f8fafc;
  line-height: 1.6;
  font-size: 14px;
}
.container { max-width: 1280px; margin: 0 auto; padding: 24px 20px 48px; }
header.page-header {
  border-bottom: 2px solid #1f2937;
  padding-bottom: 16px;
  margin-bottom: 20px;
  display: flex; align-items: baseline; gap: 16px;
}
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 16px; margin: 24px 0 12px; }
.muted { color: #6b7280; font-size: 12px; }

.toolbar {
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 12px 16px;
  margin-bottom: 16px;
}
.toolbar input[type="text"] {
  flex: 1;
  min-width: 260px;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 14px;
}
.toolbar .count {
  font-size: 12px;
  color: #6b7280;
  font-family: ui-monospace, monospace;
  letter-spacing: 0.04em;
}

button {
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid #1f2937;
  background: #1f2937;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}
button:hover { background: #374151; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.secondary { background: #fff; color: #1f2937; }
button.secondary:hover { background: #f3f4f6; }
button.danger { background: #dc2626; border-color: #dc2626; }
button.danger:hover { background: #b91c1c; }
button.small { padding: 4px 10px; font-size: 12px; font-weight: 500; }

table.list {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  font-size: 13px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
}
table.list th, table.list td {
  border-bottom: 1px solid #e5e7eb;
  padding: 8px 12px;
  text-align: left;
  vertical-align: middle;
}
table.list th {
  background: #f9fafb;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #4b5563;
  position: sticky; top: 0;
}
table.list tr:hover td { background: #f9fafb; }
table.list tr.empty td {
  text-align: center;
  padding: 32px;
  color: #6b7280;
  font-style: italic;
}
table.list .vc {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #4b5563;
}
table.list .name { font-weight: 600; }

.pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 600;
}
.pill.corp { background: #dbeafe; color: #1e40af; }
.pill.ind  { background: #fef3c7; color: #92400e; }
.pill.inv  { background: #d1fae5; color: #065f46; }

/* Modal */
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: none;
  align-items: center; justify-content: center;
  z-index: 50;
}
.modal-backdrop.open { display: flex; }
.modal {
  background: #fff;
  border-radius: 8px;
  width: min(900px, 92vw);
  max-height: 90vh;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e5e7eb;
  display: flex; justify-content: space-between; align-items: center;
}
.modal-header h3 { margin: 0; font-size: 16px; }
.modal-body { padding: 20px; overflow-y: auto; flex: 1; }
.modal-footer {
  padding: 12px 20px;
  border-top: 1px solid #e5e7eb;
  display: flex; gap: 8px; justify-content: flex-end;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px 16px;
}
.form-grid .col-2 { grid-column: span 2; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #4b5563;
}
.field label .req { color: #dc2626; }
.field input[type="text"],
.field input[type="email"],
.field input[type="tel"],
.field select,
.field textarea {
  padding: 7px 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 14px;
  font-family: inherit;
  background: #fff;
}
.field input:read-only { background: #f9fafb; color: #6b7280; }
.field .help { font-size: 11px; color: #6b7280; }
.field-row.checkbox {
  display: flex; align-items: center; gap: 8px; padding-top: 18px;
}

.section-title {
  grid-column: span 2;
  border-top: 1px dashed #e5e7eb;
  padding-top: 12px;
  margin-top: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6b7280;
}
.section-title:first-child { border-top: none; padding-top: 0; margin-top: 0; }

.toast {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 12px 18px;
  border-radius: 6px;
  color: #fff;
  font-weight: 600;
  font-size: 13px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.2);
  z-index: 100;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.toast.show { opacity: 1; }
.toast.success { background: #059669; }
.toast.error   { background: #dc2626; }

.loading { padding: 24px; text-align: center; color: #6b7280; font-style: italic; }
`;

function esc(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * /master/vendors ページ HTML 本体。
 *
 * auth: HMAC 署名関数。API 呼び出しの URL 末尾に exp/sig を付ける用途。
 */
export function vendorMasterPage(
  auth: SignLink | string | null | undefined
): string {
  // API 呼び出し時に同じ resource ID の署名 QS を付与する。
  function buildSignedUrl(base: string): string {
    if (typeof auth === "function") {
      try {
        const qs = auth("master:vendors");
        if (qs) return base + (base.includes("?") ? "&" : "?") + qs;
      } catch {
        /* noop */
      }
    } else if (typeof auth === "string" && auth) {
      return base + (base.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(auth);
    }
    return base;
  }

  const apiListUrl = buildSignedUrl("/api/master/vendors");
  const apiDetailBase = buildSignedUrl("/api/master/vendors/__CODE__");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>取引先マスター</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="container">
    <header class="page-header">
      <h1>🏢 取引先マスター</h1>
      <span class="muted">vendors テーブル CRUD</span>
    </header>

    <div class="toolbar">
      <input type="text" id="search" placeholder="取引先コード / 取引先名 / 屋号 / ペンネーム / 別名で絞り込み…" autocomplete="off" />
      <span class="count" id="count">—</span>
      <button id="btn-new">＋ 新規追加</button>
    </div>

    <div id="list-wrap">
      <div class="loading">読み込み中…</div>
    </div>
  </div>

  <!-- Edit / Create Modal -->
  <div class="modal-backdrop" id="modal-backdrop">
    <div class="modal">
      <div class="modal-header">
        <h3 id="modal-title">取引先の編集</h3>
        <button class="secondary small" id="btn-close">× 閉じる</button>
      </div>
      <div class="modal-body">
        <form id="form" autocomplete="off">
          <div class="form-grid">

            <div class="section-title">基本情報</div>

            <div class="field">
              <label>取引先コード <span class="req">*</span></label>
              <input type="text" name="vendor_code" required maxlength="50" placeholder="例: 2-20-1234" />
              <span class="help">既存コードを入れると上書き (UPSERT)。新規時のみ編集可能。</span>
            </div>

            <div class="field">
              <label>区分</label>
              <select name="entity_type">
                <option value="">(未指定)</option>
                <option value="corporate">法人</option>
                <option value="individual">個人</option>
                <option value="sole_proprietor">個人事業主</option>
              </select>
            </div>

            <div class="field col-2">
              <label>正式名称 <span class="req">*</span></label>
              <input type="text" name="vendor_name" required maxlength="255" placeholder="例: 株式会社サンプル" />
            </div>

            <div class="field">
              <label>屋号 / 略称</label>
              <input type="text" name="trade_name" maxlength="255" />
            </div>

            <div class="field">
              <label>ペンネーム</label>
              <input type="text" name="pen_name" maxlength="255" />
            </div>

            <div class="field">
              <label>敬称サフィックス</label>
              <input type="text" name="vendor_suffix" maxlength="50" placeholder="様 / 御中" />
            </div>

            <div class="field">
              <label>別名 (aliases)</label>
              <input type="text" name="aliases" placeholder="カンマ区切りで複数可" />
            </div>

            <div class="section-title">連絡先</div>

            <div class="field">
              <label>担当部署</label>
              <input type="text" name="contact_department" maxlength="100" />
            </div>

            <div class="field">
              <label>担当者</label>
              <input type="text" name="contact_name" maxlength="100" />
            </div>

            <div class="field">
              <label>電話番号</label>
              <input type="tel" name="phone" maxlength="50" placeholder="03-1234-5678" />
            </div>

            <div class="field">
              <label>メールアドレス</label>
              <input type="email" name="email" maxlength="255" placeholder="contact@example.com" />
            </div>

            <div class="field col-2">
              <label>住所</label>
              <input type="text" name="address" />
            </div>

            <div class="section-title">税務 / インボイス</div>

            <div class="field-row checkbox">
              <input type="checkbox" id="withholding_enabled" name="withholding_enabled" />
              <label for="withholding_enabled" style="text-transform: none; letter-spacing: 0; font-size: 13px;">源泉徴収を行う</label>
            </div>

            <div class="field-row checkbox">
              <input type="checkbox" id="is_invoice_issuer" name="is_invoice_issuer" />
              <label for="is_invoice_issuer" style="text-transform: none; letter-spacing: 0; font-size: 13px;">適格請求書発行事業者 (インボイス)</label>
            </div>

            <div class="field col-2">
              <label>インボイス登録番号</label>
              <input type="text" name="invoice_registration_number" maxlength="50" placeholder="T1234567890123" />
            </div>

            <div class="section-title">振込先</div>

            <div class="field">
              <label>銀行名</label>
              <input type="text" name="bank_name" />
            </div>

            <div class="field">
              <label>支店名</label>
              <input type="text" name="branch_name" />
            </div>

            <div class="field">
              <label>口座種別</label>
              <select name="account_type">
                <option value="">(未指定)</option>
                <option value="普通">普通</option>
                <option value="当座">当座</option>
                <option value="貯蓄">貯蓄</option>
              </select>
            </div>

            <div class="field">
              <label>口座番号</label>
              <input type="text" name="account_number" maxlength="50" />
            </div>

            <div class="field col-2">
              <label>口座名義 (カナ)</label>
              <input type="text" name="account_holder_kana" />
            </div>

            <div class="section-title">その他</div>

            <div class="field col-2">
              <label>マスター契約参照</label>
              <input type="text" name="master_contract_ref" placeholder="既存契約番号 / URL 等" />
            </div>

            <div class="field col-2">
              <label>銀行情報メモ</label>
              <input type="text" name="bank_info" placeholder="自由記述" />
            </div>

          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="secondary" id="btn-cancel">キャンセル</button>
        <button id="btn-save">保存</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const apiListUrl   = ${JSON.stringify(apiListUrl)};
    const apiDetailTpl = ${JSON.stringify(apiDetailBase)};
    const $ = (id) => document.getElementById(id);

    let cache = [];        // 全件キャッシュ (絞り込みはクライアント側)
    let creating = false;  // true なら新規作成モード

    /* ----- toast ----- */
    function toast(msg, kind) {
      const t = $('toast');
      t.textContent = msg;
      t.className = 'toast show ' + (kind || '');
      setTimeout(() => { t.className = 'toast ' + (kind || ''); }, 3000);
    }

    /* ----- list ----- */
    async function loadList() {
      $('list-wrap').innerHTML = '<div class="loading">読み込み中…</div>';
      try {
        const res = await fetch(apiListUrl);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        cache = data.rows || [];
        renderList();
      } catch (e) {
        $('list-wrap').innerHTML = '<div class="loading" style="color: #dc2626;">読み込み失敗: ' + (e?.message || e) + '</div>';
      }
    }

    function renderList() {
      const q = $('search').value.trim().toLowerCase();
      const rows = q
        ? cache.filter(v => {
            const hay = [v.vendor_code, v.vendor_name, v.trade_name, v.pen_name, v.aliases]
              .filter(Boolean).join(' ').toLowerCase();
            return hay.includes(q);
          })
        : cache;

      $('count').textContent = q
        ? rows.length + ' / ' + cache.length + ' 件'
        : cache.length + ' 件';

      if (rows.length === 0) {
        $('list-wrap').innerHTML =
          '<table class="list"><thead><tr><th colspan="6">No vendors</th></tr></thead>'
          + '<tbody><tr class="empty"><td colspan="6">該当する取引先がありません</td></tr></tbody></table>';
        return;
      }

      const trs = rows.map(v => {
        const pillEntity = v.entity_type === 'corporate'
          ? '<span class="pill corp">法人</span>'
          : (v.entity_type === 'individual' || v.entity_type === 'sole_proprietor')
            ? '<span class="pill ind">個人</span>'
            : '';
        const pillInvoice = v.is_invoice_issuer
          ? '<span class="pill inv">インボイス</span>'
          : '';
        return '<tr data-code="' + escAttr(v.vendor_code) + '">'
          + '<td class="vc">' + escHtml(v.vendor_code) + '</td>'
          + '<td class="name">' + escHtml(v.vendor_name) + ' ' + pillEntity + ' ' + pillInvoice + '</td>'
          + '<td>' + escHtml(v.trade_name || v.pen_name || '') + '</td>'
          + '<td>' + escHtml(v.contact_name || '') + '</td>'
          + '<td>' + escHtml(v.phone || '') + '</td>'
          + '<td>' + escHtml(v.email || '') + '</td>'
          + '</tr>';
      }).join('');

      $('list-wrap').innerHTML =
        '<table class="list"><thead><tr>'
        + '<th>コード</th><th>正式名称</th><th>屋号 / ペンネーム</th><th>担当者</th><th>電話</th><th>メール</th>'
        + '</tr></thead><tbody>' + trs + '</tbody></table>';

      $('list-wrap').querySelectorAll('tr[data-code]').forEach(tr => {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => openEdit(tr.dataset.code));
      });
    }

    function escHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function escAttr(s) {
      return escHtml(s).replace(/"/g, '&quot;');
    }

    $('search').addEventListener('input', renderList);

    /* ----- modal ----- */
    function openCreate() {
      creating = true;
      $('modal-title').textContent = '取引先の新規追加';
      const form = $('form');
      form.reset();
      form.querySelector('[name=vendor_code]').readOnly = false;
      $('modal-backdrop').classList.add('open');
    }

    async function openEdit(code) {
      creating = false;
      $('modal-title').textContent = '取引先の編集 — ' + code;
      const form = $('form');
      form.reset();
      $('modal-backdrop').classList.add('open');
      try {
        const url = apiDetailTpl.replace('__CODE__', encodeURIComponent(code));
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const v = await res.json();
        fillForm(v);
        form.querySelector('[name=vendor_code]').readOnly = true;
      } catch (e) {
        toast('取得失敗: ' + (e?.message || e), 'error');
        closeModal();
      }
    }

    function closeModal() {
      $('modal-backdrop').classList.remove('open');
    }

    function fillForm(v) {
      const form = $('form');
      Array.from(form.elements).forEach(el => {
        if (!el.name) return;
        if (el.type === 'checkbox') el.checked = !!v[el.name];
        else el.value = v[el.name] == null ? '' : v[el.name];
      });
    }

    function readForm() {
      const form = $('form');
      const out = {};
      Array.from(form.elements).forEach(el => {
        if (!el.name) return;
        if (el.type === 'checkbox') out[el.name] = el.checked;
        else out[el.name] = el.value.trim();
      });
      return out;
    }

    $('btn-new').addEventListener('click', openCreate);
    $('btn-close').addEventListener('click', closeModal);
    $('btn-cancel').addEventListener('click', closeModal);
    $('modal-backdrop').addEventListener('click', (e) => {
      if (e.target === $('modal-backdrop')) closeModal();
    });

    $('btn-save').addEventListener('click', async () => {
      const payload = readForm();
      if (!payload.vendor_code) {
        toast('取引先コードは必須です', 'error');
        return;
      }
      if (!payload.vendor_name) {
        toast('正式名称は必須です', 'error');
        return;
      }
      $('btn-save').disabled = true;
      try {
        const res = await fetch(apiListUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          const msg = data?.error || ('HTTP ' + res.status);
          throw new Error(msg);
        }
        toast(creating ? '登録しました' : '更新しました', 'success');
        closeModal();
        await loadList();
      } catch (e) {
        toast('保存失敗: ' + (e?.message || e), 'error');
      } finally {
        $('btn-save').disabled = false;
      }
    });

    /* ----- init ----- */
    loadList();
  </script>
</body>
</html>`;
}
