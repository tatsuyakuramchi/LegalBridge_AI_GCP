/**
 * 取引先マスター CSV 取り込みの管理 UI (Phase 22.21.35)
 *
 * /imports/vendor ページ。CSV ファイルを選択 → Dry Run → 本番取り込み の
 * フローを単一ページで完結させる。フロント JS はバニラ + fetch API。
 *
 * legalonImportHtml.ts と同じデザイン規約 / CSS / イベントフローで構築。
 * 保守対象が search-api 側に統一されているため、admin-ui (React) 側に
 * 同等 UI を持たせず、本ページに集約する方針。
 */

import type { SignLink } from "./contractSearchHtml.ts";
import { popPage } from "./popChrome.ts";

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
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.secondary { background: #fff; color: #1f2937; }
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.stat {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 10px 14px;
}
.stat .label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
.stat .value { font-size: 22px; font-weight: 700; margin-top: 2px; }
.stat.ok   .value { color: #065f46; }
.stat.err  .value { color: #991b1b; }
.stat.warn .value { color: #92400e; }
table.preview {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
table.preview th, table.preview td {
  border-bottom: 1px solid #e5e7eb;
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}
table.preview thead {
  background: #f3f4f6;
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
.pill.fill_only { background: #fef3c7; color: #92400e; }
.pill.error  { background: #fee2e2; color: #991b1b; }
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

/**
 * /imports/vendor のページ HTML。
 *
 * 第 1 引数の auth は、本ページの POST 先 URL に署名 QS を継ぐためのコールバック
 * (legalonImportHtml.ts と同じ規約)。SignLink が来れば HMAC URL、文字列なら
 * legacy token、null なら認可なしモード (現状: IAP 直接保護)。
 */
export function vendorImportPage(
  auth: SignLink | string | null | undefined
): string {
  let apiUrl = "/api/master/vendors/import-csv";
  if (typeof auth === "function") {
    try {
      const qs = auth("imports:vendor");
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
        サンプル CSV を取り込み前にダウンロードして、列フォーマットを確認できます。
        vendor_code と vendor_name が必須、その他 (住所 / 担当者 / 法人個人 等) は任意です。
      </p>
      <a href="/api/master/vendors/template.csv" download="vendor_sample.csv">
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
              <option value="fill_only">fill_only (空欄のみ補完)</option>
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
        <li>「サンプル CSV をダウンロード」で書式雛形を取得</li>
        <li>Excel 等で <strong>UTF-8 CSV</strong> として編集 (必須: vendor_code, vendor_name)</li>
        <li>初回は <strong>Dry Run</strong> にチェックを入れたまま「取り込み開始」→ プレビュー確認</li>
        <li>件数 (新規 / 更新 / スキップ / エラー) と各行の action を確認</li>
        <li>問題なければ <strong>Dry Run のチェックを外して</strong> 再実行 → 本番取り込み</li>
        <li>重複モード:
          <ul style="margin: 4px 0 0; padding-left: 18px;">
            <li><strong>overwrite</strong>: 既存 vendor_code は CSV の値で全列上書き</li>
            <li><strong>skip</strong>: 既存はスキップ、新規のみ追加</li>
            <li><strong>fill_only</strong>: 既存の空欄列だけ CSV で埋める (有値は維持)</li>
          </ul>
        </li>
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
        $('log').innerHTML = '<span class="loading">⏳ サーバー側で処理中...</span>';

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
          renderResult(data, dryRun);
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

    function renderResult(data, isDry) {
      $('result-card').style.display = '';
      const stats = \`
        <div class="summary-grid">
          <div class="stat"><div class="label">Total</div><div class="value">\${data.total}</div></div>
          <div class="stat ok"><div class="label">\${isDry ? 'Would Succeed' : 'Succeeded'}</div><div class="value">\${data.succeeded}</div></div>
          <div class="stat err"><div class="label">Failed</div><div class="value">\${data.failed}</div></div>
          <div class="stat"><div class="label">Skipped</div><div class="value">\${data.skipped}</div></div>
        </div>
      \`;

      let modeBanner = '';
      if (isDry) {
        modeBanner = '<div class="warning">🔍 <strong>Dry Run モード</strong> — DB は変更されていません。プレビューを確認して、問題なければ Dry Run チェックを外して再実行してください。</div>';
      } else {
        modeBanner = '<div class="warning" style="background:#d1fae5;border-left-color:#10b981;color:#065f46;">✅ <strong>本番取り込み完了</strong> — vendors テーブルを更新しました。</div>';
      }

      let errorsHtml = '';
      if (data.errors && data.errors.length > 0) {
        errorsHtml = '<h2>エラー (' + data.errors.length + ' 件)</h2><div class="scroll-area">';
        for (const e of data.errors.slice(0, 100)) {
          errorsHtml += '<div class="error-row">Row ' + e.row + (e.vendor_code ? ' (' + escapeHtml(e.vendor_code) + ')' : '') + ': ' + escapeHtml(e.error) + '</div>';
        }
        if (data.errors.length > 100) {
          errorsHtml += '<div class="muted" style="padding:8px;">… 他 ' + (data.errors.length - 100) + ' 件</div>';
        }
        errorsHtml += '</div>';
      }

      let previewHtml = '';
      if (data.preview && data.preview.length > 0) {
        previewHtml = '<h2>プレビュー (' + data.preview.length + ' 件 / ' + data.total + ' 件中)</h2>';
        previewHtml += '<div class="scroll-area"><table class="preview"><thead><tr>'
          + '<th>Action</th><th>Row</th><th>vendor_code</th><th>vendor_name</th>'
          + '</tr></thead><tbody>';
        for (const p of data.preview.slice(0, 500)) {
          const actionPill = '<span class="pill ' + escapeHtml(p.action) + '">' + escapeHtml(p.action) + '</span>';
          previewHtml += '<tr>'
            + '<td>' + actionPill + '</td>'
            + '<td>' + escapeHtml(String(p.row)) + '</td>'
            + '<td><strong>' + escapeHtml(p.vendor_code) + '</strong></td>'
            + '<td>' + escapeHtml(p.vendor_name) + '</td>'
            + '</tr>';
        }
        if (data.preview.length > 500) {
          previewHtml += '<tr><td colspan="4" class="muted" style="padding:8px;">… 他 ' + (data.preview.length - 500) + ' 件 (表示上限)</td></tr>';
        }
        previewHtml += '</tbody></table></div>';
      }

      $('result').innerHTML = modeBanner + stats + errorsHtml + previewHtml;
    }
  </script>`;

  return popPage({
    active: "vendors",
    mode: "admin",
    title: "取引先マスター CSV 取り込み",
    subtitle: "vendors テーブルに upsert します (vendor_code を主キーとして判定)",
    body,
    headExtra: `<style>${STYLE}</style>`,
    contentBridge: true,
    pageTitle: "取引先マスター CSV 取り込み",
  });
}
