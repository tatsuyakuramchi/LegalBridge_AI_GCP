/**
 * LegalOn 契約台帳取り込みの管理 UI (Phase 17x)
 *
 * /imports/legalon ページ。CSV ファイルを選択 → Dry Run → 本番取り込み の
 * フローを単一ページで完結させる。フロント JS はバニラ + fetch API。
 *
 * セキュリティ: 上位 (server.ts) で requireSignedUrl が適用される前提。
 *   URL 自体に exp=&sig= が付かないとアクセスできない (Phase 17s)。
 *   ?sig= をフォーム送信に再利用するため、ページ自身の query string を
 *   保持して送信する。
 */

import type { SignLink } from "./contractSearchHtml.ts";
import { popPage } from "./popChrome.ts";

/**
 * 個人情報・URL 等を含まないインラインスタイル。法務系の落ち着いた配色。
 */
const STYLE = `
/* グローバル body/* リセットは pop 共通テーマ(POP_CSS)に委譲。ここではページ固有のみ。 */
.container { max-width: 1100px; margin: 0 auto; padding: 0 0 24px; }
header.page-header {
  border-bottom: 2px solid #1f2937;
  padding-bottom: 16px;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
header.page-header .title-wrap { flex: 1; min-width: 0; }
header.page-header .back-link {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  text-decoration: none;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: background .15s, color .15s, border-color .15s;
}
header.page-header .back-link:hover {
  background: #f3f4f6;
  color: #1f2937;
  border-color: #9ca3af;
}
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 16px; margin: 24px 0 12px; }
.muted { color: #6b7280; font-size: 12px; }
.card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 16px 20px;
  margin-bottom: 16px;
}
form .row { margin: 12px 0; display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
label { font-weight: 600; }
input[type=file], select {
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 14px;
  background: #fff;
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
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.stat {
  background: #f3f4f6;
  border-radius: 6px;
  padding: 12px 16px;
  text-align: center;
}
.stat .label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
.stat .value { font-size: 22px; font-weight: 700; color: #1f2937; margin-top: 4px; }
.stat.ok .value { color: #059669; }
.stat.warn .value { color: #d97706; }
.stat.err .value { color: #dc2626; }
table.preview {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin: 12px 0;
}
table.preview th, table.preview td {
  border-bottom: 1px solid #e5e7eb;
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}
table.preview th {
  background: #f9fafb;
  font-weight: 600;
  position: sticky; top: 0;
}
.pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 600;
}
.pill.insert { background: #d1fae5; color: #065f46; }
.pill.update { background: #dbeafe; color: #1e40af; }
.pill.skip   { background: #f3f4f6; color: #6b7280; }
.pill.error  { background: #fee2e2; color: #991b1b; }
.pill.multi  { background: #fef3c7; color: #92400e; }
.pill.unresolved { background: #fde68a; color: #92400e; }
.warning {
  background: #fef3c7;
  border-left: 4px solid #f59e0b;
  padding: 8px 12px;
  margin: 8px 0;
  font-size: 12px;
}
.error-row {
  background: #fef2f2;
  border-left: 4px solid #ef4444;
  padding: 8px 12px;
  margin: 8px 0;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
#log { font-family: ui-monospace, monospace; font-size: 11px; color: #6b7280; }
.loading { display: inline-block; padding: 4px 8px; color: #6b7280; font-style: italic; }
.scroll-area { max-height: 360px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 4px; }
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
 * /imports/legalon のページ HTML。
 *
 * 第 2 引数の auth は、本ページの POST 先 URL に署名 QS を継ぐためのコールバック
 * (Phase 17s 互換)。SignLink が来れば HMAC URL、文字列なら legacy token、null
 * なら認可なしモードで動く。
 */
export function legalonImportPage(
  auth: SignLink | string | null | undefined
): string {
  // 内部 endpoint は同じ resourceId で署名する必要がある。
  let apiUrl = "/api/imports/legalon-csv";
  if (typeof auth === "function") {
    try {
      const qs = auth("imports:legalon");
      if (qs) apiUrl += "?" + qs;
    } catch {
      /* noop */
    }
  } else if (typeof auth === "string" && auth) {
    apiUrl += "?token=" + encodeURIComponent(auth);
  }

  const body = `
  <div class="container">

    <section class="card">
      <h2>0. (任意) サンプル CSV をダウンロード</h2>
      <p class="muted" style="margin: 0 0 8px;">
        実 LegalOn データの取込前に、サンプル CSV で動作確認したい場合や、
        列フォーマットの確認用に。3 者契約の書き方サンプルも含まれます。
      </p>
      <a href="/api/imports/legalon-csv/template" download="legalon_sample.csv">
        <button type="button" class="secondary">📥 サンプル CSV をダウンロード</button>
      </a>
    </section>

    <section class="card">
      <h2>1. CSV ファイルを選択</h2>
      <form id="upload">
        <div class="row">
          <label>CSV ファイル: <input type="file" id="csv" accept=".csv,text/csv" required></label>
          <span class="muted" id="filename"></span>
        </div>
        <div class="row">
          <label>重複時の動作:
            <select id="dup_mode">
              <option value="overwrite" selected>overwrite (上書き・推奨)</option>
              <option value="skip">skip (既存はスキップ)</option>
              <option value="fill_only">fill_only (NULL のみ補完)</option>
            </select>
          </label>
          <label>
            <input type="checkbox" id="dry_run" checked>
            Dry Run (プレビューのみ・DB は書き換えない)
          </label>
        </div>
        <div class="row">
          <button type="submit" id="submit-btn">取り込み開始</button>
          <button type="button" class="secondary" id="reset-btn">リセット</button>
        </div>
        <div id="log"></div>
      </form>
    </section>

    <section class="card" id="result-card" style="display:none;">
      <h2>2. 取り込み結果</h2>
      <div id="result"></div>
    </section>

    <section class="card">
      <h2>📖 使い方</h2>
      <ol style="margin: 8px 0 0; padding-left: 18px; color: #4b5563;">
        <li>LegalOn Cloud から契約書台帳を <strong>CSV (UTF-8)</strong> でエクスポート</li>
        <li>初回は <strong>Dry Run</strong> にチェックを入れたまま「取り込み開始」→ プレビュー確認</li>
        <li>件数・契約類型・取引先解決状況を確認</li>
        <li>問題なければ <strong>Dry Run のチェックを外して</strong> 再実行 → 本番取り込み</li>
        <li>3 者契約は <strong>取引先名 列にカンマ区切り</strong> で入れてください (1 つ目 = 主取引先)</li>
      </ol>
    </section>
  </div>

  <script>
    const apiUrl = ${JSON.stringify(apiUrl)};
    const $ = (id) => document.getElementById(id);

    $('csv').addEventListener('change', (e) => {
      const f = e.target.files[0];
      $('filename').textContent = f ? f.name + ' (' + Math.round(f.size / 1024) + ' KB)' : '';
    });

    $('reset-btn').addEventListener('click', () => {
      $('upload').reset();
      $('filename').textContent = '';
      $('log').textContent = '';
      $('result-card').style.display = 'none';
      $('result').innerHTML = '';
    });

    $('upload').addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = $('csv').files[0];
      if (!file) return;
      const dryRun = $('dry_run').checked;
      const dupMode = $('dup_mode').value;

      $('submit-btn').disabled = true;
      $('log').innerHTML = '<span class="loading">📤 CSV 読み込み中...</span>';
      $('result-card').style.display = 'none';

      try {
        const csvText = await file.text();
        $('log').innerHTML = '<span class="loading">⏳ サーバー側で処理中... (1,000 行で 10〜30 秒)</span>';

        const t0 = Date.now();
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            csv: csvText,
            dry_run: dryRun,
            duplicate_mode: dupMode,
          }),
        });
        const data = await res.json();
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

        if (!res.ok || data.ok === false) {
          $('log').innerHTML =
            '<div class="error-row">❌ サーバーエラー: ' +
            (data && data.error ? escapeHtml(data.error) : 'HTTP ' + res.status) +
            '</div>';
        } else {
          $('log').innerHTML = '<span class="muted">✅ 処理完了 (' + elapsed + 's)</span>';
          renderResult(data);
        }
      } catch (err) {
        $('log').innerHTML =
          '<div class="error-row">❌ クライアントエラー: ' + escapeHtml(String(err.message || err)) + '</div>';
      } finally {
        $('submit-btn').disabled = false;
      }
    });

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }

    function renderResult(data) {
      $('result-card').style.display = '';
      const isDry = !!data.dry_run;
      const stats = \`
        <div class="summary-grid">
          <div class="stat"><div class="label">Total</div><div class="value">\${data.total}</div></div>
          <div class="stat ok"><div class="label">\${isDry ? 'Would Succeed' : 'Succeeded'}</div><div class="value">\${data.succeeded}</div></div>
          <div class="stat err"><div class="label">Failed</div><div class="value">\${data.failed}</div></div>
          <div class="stat"><div class="label">Skipped</div><div class="value">\${data.skipped}</div></div>
          <div class="stat warn"><div class="label">Multi-Party</div><div class="value">\${data.multi_party_count}</div></div>
          <div class="stat warn"><div class="label">Unresolved Vendors</div><div class="value">\${data.unresolved_vendor_count}</div></div>
        </div>
      \`;

      let modeBanner = '';
      if (isDry) {
        modeBanner = '<div class="warning">🔍 <strong>Dry Run モード</strong> — DB は変更されていません。プレビューを確認して、問題なければ Dry Run チェックを外して再実行してください。</div>';
      } else {
        modeBanner = '<div class="warning" style="background:#d1fae5;border-left-color:#10b981;color:#065f46;">✅ <strong>本番取り込み完了</strong> — contract_capabilities を更新しました。</div>';
      }

      let errorsHtml = '';
      if (data.errors && data.errors.length > 0) {
        errorsHtml = '<h2>エラー (\${data.errors.length} 件)</h2><div class="scroll-area">';
        for (const e of data.errors.slice(0, 100)) {
          errorsHtml += '<div class="error-row">Row ' + e.row + (e.document_number ? ' (' + escapeHtml(e.document_number) + ')' : '') + ': ' + escapeHtml(e.error) + '</div>';
        }
        if (data.errors.length > 100) {
          errorsHtml += '<div class="muted" style="padding:8px;">… 他 ' + (data.errors.length - 100) + ' 件</div>';
        }
        errorsHtml += '</div>';
        errorsHtml = errorsHtml.replace('\${data.errors.length}', data.errors.length);
      }

      let previewHtml = '';
      if (data.preview && data.preview.length > 0) {
        previewHtml = '<h2>プレビュー (' + data.preview.length + ' 件 / ' + data.total + ' 件中)</h2>';
        previewHtml += '<div class="scroll-area"><table class="preview"><thead><tr>'
          + '<th>Action</th><th>管理番号</th><th>タイトル</th><th>類型</th><th>主取引先</th><th>追加取引先</th><th>締結日</th><th>終了日</th><th>自動更新</th>'
          + '</tr></thead><tbody>';
        for (const p of data.preview) {
          const actionPill = '<span class="pill ' + p.action.toLowerCase() + '">' + p.action + '</span>';
          const primary = p.primary_vendor
            ? (p.primary_vendor.vendor_id ? escapeHtml(p.primary_vendor.name) : '<span class="pill unresolved">未登録</span> ' + escapeHtml(p.primary_vendor.name))
            : '<span class="muted">なし</span>';
          let additional = '<span class="muted">-</span>';
          if (p.additional_parties && p.additional_parties.length > 0) {
            const items = p.additional_parties.map(a =>
              a.vendor_id ? escapeHtml(a.name) : escapeHtml(a.name) + ' <span class="pill unresolved">未登録</span>'
            );
            additional = '<span class="pill multi">+' + p.additional_parties.length + '</span> ' + items.join(', ');
          }
          previewHtml += '<tr>'
            + '<td>' + actionPill + '</td>'
            + '<td>' + escapeHtml(p.document_number) + '</td>'
            + '<td>' + escapeHtml(p.contract_title) + '</td>'
            + '<td>' + escapeHtml(p.contract_type) + '<br><span class="muted">' + escapeHtml(p.contract_category) + '/' + escapeHtml(p.record_type) + '</span></td>'
            + '<td>' + primary + '</td>'
            + '<td>' + additional + '</td>'
            + '<td>' + escapeHtml(p.effective_date || '-') + '</td>'
            + '<td>' + escapeHtml(p.expiration_date || '-') + '</td>'
            + '<td>' + (p.auto_renewal ? '✓' : '-') + '</td>'
            + '</tr>';
          if (p.warning) {
            previewHtml += '<tr><td colspan="9" style="background:#fef3c7;padding:2px 8px;font-size:11px;color:#92400e;">⚠️ ' + escapeHtml(p.warning) + '</td></tr>';
          }
        }
        previewHtml += '</tbody></table></div>';
      }

      $('result').innerHTML = modeBanner + stats + errorsHtml + previewHtml;
    }
  </script>`;

  return popPage({
    active: "contracts",
    mode: "admin",
    title: "LegalOn 契約台帳 取り込み",
    subtitle: "contract_capabilities テーブルに upsert します",
    body,
    headExtra: `<style>${STYLE}</style>`,
    contentBridge: true,
    pageTitle: "LegalOn 契約台帳 取り込み",
  });
}
