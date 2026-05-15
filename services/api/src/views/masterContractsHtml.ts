/**
 * Contracts マスター UI — LegalOn 一括取込 (Phase 17z-4)
 *
 * /master/contracts ページ。タブナビ「CONTRACTS」の遷移先。
 * 旧 /imports/legalon と機能は同じだが、Arcs Legal OS デザインで
 * Master Systems のタブ群と一体化させる。
 *
 * 既存の /imports/legalon ルートもそのまま動かす (後方互換)。
 */

import {
  MASTER_CSS,
  SVG,
  HEAD_FONTS,
  topbarHtml,
  pageHeaderHtml,
  masterTabsHtml,
} from "./masterChrome.ts";

export function masterContractsPage(): string {
  const apiImportUrl = "/api/imports/legalon-csv";
  const apiTemplateUrl = "/api/imports/legalon-csv/template";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Contracts · Arcs Legal OS</title>
  ${HEAD_FONTS}
  <style>${MASTER_CSS}</style>
</head>
<body>
  ${topbarHtml("Contracts", "Master · LegalOn import")}

  <div class="container" style="padding-top: 24px; padding-bottom: 48px;">
    ${pageHeaderHtml({
      tag: "MST · INDEX",
      title: "Master Systems",
      desc: "Reference data — vendors, staff, and contracts.",
    })}

    ${masterTabsHtml("contracts")}

    <!-- LegalOn 一括取込カード -->
    <div class="import-card">
      <h3>LegalOn 契約台帳 / 一括取込</h3>
      <p class="desc">
        LegalOn Cloud から出力した契約書台帳 CSV (UTF-8) を <code>contract_capabilities</code> テーブルに upsert します。
        3 者契約は <strong>取引先名列をカンマ区切り</strong> (1 つ目が主取引先) で入れてください。
        初回は Dry Run で件数・解決状況を確認してから本番取込してください。
      </p>

      <div class="file-input-wrap">
        <input type="file" id="csv" accept=".csv,text/csv">
        <span class="count-badge" id="filename"></span>
      </div>

      <div style="margin-top: 16px; display: flex; gap: 16px; flex-wrap: wrap;">
        <div class="dup-mode">
          <label class="tech-label" style="margin-right: 4px;">重複時:</label>
          <select id="dup-mode" class="tech-select" style="width: auto;">
            <option value="overwrite" selected>overwrite (上書き・推奨)</option>
            <option value="fill_only">fill_only (空欄のみ補完)</option>
            <option value="skip">skip (既存はスキップ)</option>
          </select>
        </div>
        <label class="dup-mode" style="cursor: pointer;">
          <input type="checkbox" id="dry-run" checked>
          <span class="tech-label" style="margin: 0;">Dry Run (プレビューのみ)</span>
        </label>
      </div>

      <div style="margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
        <button class="btn" id="btn-submit">取込実行</button>
        <button class="btn ghost sm" id="btn-reset">リセット</button>
        <div style="flex:1"></div>
        <a href="${apiTemplateUrl}" download="legalon_sample.csv" class="btn outline sm">
          サンプル CSV
        </a>
      </div>

      <div id="log" style="margin-top: 16px; font-family: var(--font-mono); font-size: 11px; color: var(--muted-foreground);"></div>
    </div>

    <!-- 結果カード (実行後に出現) -->
    <div class="import-card" id="result-card" style="display:none;">
      <h3>取込結果</h3>
      <div id="result"></div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const apiUrl = ${JSON.stringify(apiImportUrl)};
    const $ = (id) => document.getElementById(id);

    function toast(msg, kind) {
      const t = $('toast');
      t.textContent = msg;
      t.className = 'toast show ' + (kind || '');
      setTimeout(() => { t.className = 'toast ' + (kind || ''); }, 3200);
    }

    function escHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    $('csv').addEventListener('change', (e) => {
      const f = e.target.files[0];
      $('filename').textContent = f
        ? f.name + ' (' + Math.round(f.size / 1024) + ' KB)'
        : '';
    });

    $('btn-reset').addEventListener('click', () => {
      $('csv').value = '';
      $('filename').textContent = '';
      $('log').textContent = '';
      $('result-card').style.display = 'none';
      $('result').innerHTML = '';
      $('dry-run').checked = true;
      $('dup-mode').value = 'overwrite';
    });

    $('btn-submit').addEventListener('click', async () => {
      const f = $('csv').files[0];
      if (!f) { toast('CSV ファイルを選択してください', 'error'); return; }
      const dryRun = $('dry-run').checked;
      const dupMode = $('dup-mode').value;

      $('btn-submit').disabled = true;
      $('log').textContent = '⏳ サーバー処理中…';
      $('result-card').style.display = 'none';

      try {
        const csvText = await f.text();
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
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          throw new Error(data?.error || ('HTTP ' + res.status));
        }
        const elapsed = Math.round((Date.now() - t0) / 100) / 10;
        $('log').textContent = (dryRun ? '✅ Dry Run 完了' : '✅ 取込完了') + ' (' + elapsed + 's)';
        renderResult(data);
        $('result-card').style.display = '';
        if (!dryRun) {
          toast('取込完了: 成功 ' + (data.succeeded || 0) + ' 件', 'success');
        }
      } catch (e) {
        $('log').textContent = '❌ 失敗: ' + (e?.message || e);
        toast('取込失敗: ' + (e?.message || e), 'error');
      } finally {
        $('btn-submit').disabled = false;
      }
    });

    function renderResult(r) {
      const stats = '<div class="summary-grid">'
        + '<div class="stat"><div class="label">Total</div><div class="value">' + (r.total || 0) + '</div></div>'
        + '<div class="stat ok"><div class="label">Succeeded</div><div class="value">' + (r.succeeded || 0) + '</div></div>'
        + '<div class="stat warn"><div class="label">Skipped</div><div class="value">' + (r.skipped || 0) + '</div></div>'
        + '<div class="stat err"><div class="label">Failed</div><div class="value">' + (r.failed || 0) + '</div></div>'
        + (typeof r.multi_party_count !== 'undefined'
            ? '<div class="stat warn"><div class="label">Multi-party</div><div class="value">' + r.multi_party_count + '</div></div>'
            : '')
        + (typeof r.unresolved_vendor_count !== 'undefined'
            ? '<div class="stat err"><div class="label">Vendor未解決</div><div class="value">' + r.unresolved_vendor_count + '</div></div>'
            : '')
        + '</div>';
      const errBlock = (r.errors && r.errors.length > 0)
        ? '<div class="error-list">'
          + r.errors.map(e => {
              if (typeof e === 'string') return '<div class="row">' + escHtml(e) + '</div>';
              return '<div class="row">行 ' + (e.row || '?') + ': ' + escHtml(e.error || JSON.stringify(e)) + '</div>';
            }).join('')
          + '</div>'
        : '';
      $('result').innerHTML = stats + errBlock;
    }
  </script>
</body>
</html>`;
}
