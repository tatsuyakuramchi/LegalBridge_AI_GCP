/**
 * templatePreviewHtml — Phase 22.21.90
 *
 * 事業部担当者向け「ひな型プレビュー」ページ。
 *
 * 設計変更履歴:
 *   - Phase 22.21.37: dropdown + iframe で 1 件選択プレビュー
 *   - Phase 22.21.85: card grid + iframe + Slack markdown コピー機能
 *   - Phase 22.21.90: card grid と Slack markdown パネルを削除。
 *     Slack キャンバス側で固定リンクを管理する運用に切り替わったため、
 *     本ページは "?type=<TYPE>" 経由 で開かれた個別ひな型をプレビュー
 *     する用途に特化。?type= 無しなら案内文だけを表示する。
 *
 * URL 例:
 *   /templates/preview                       → 案内文 (どのひな型を見るか URL に指定して)
 *   /templates/preview?type=nda              → NDA をフルウィンドウ iframe で表示
 *   /templates/preview?type=purchase_order   → 発注書を表示
 *
 * 依存 endpoint (既存):
 *   GET /api/template-preview/list           → ラベル/カテゴリ取得用
 *   GET /api/template-preview/:type/html     → iframe ソース
 *   GET /api/template-preview/:type/html?download=1
 *   GET /api/template-preview/:type/pdf
 */

const STYLE = `
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans",
               "Yu Gothic", sans-serif;
  color: #111827;
  background: #f8fafc;
  font-size: 14px;
}
.shell { max-width: 1280px; margin: 0 auto; padding: 20px 24px 48px; }
.header {
  display: flex; align-items: end; justify-content: space-between; gap: 16px;
  border-bottom: 2px solid #111827; padding-bottom: 14px; margin-bottom: 18px;
  flex-wrap: wrap;
}
h1 { margin: 0; font-size: 22px; letter-spacing: .02em; }
.muted { color: #6b7280; font-size: 12px; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 12px; border: 1px solid #111827; border-radius: 4px;
  background: #111827; color: #fff; text-decoration: none; cursor: pointer;
  font-weight: 600; font-size: 13px; white-space: nowrap;
}
.btn.secondary { background: #fff; color: #111827; }
.btn.tiny { padding: 5px 10px; font-size: 11px; font-weight: 600; }
.btn.tiny.outline { background: #fff; color: #111827; border: 1px solid #d1d5db; }
.btn.tiny.outline:hover { background: #f3f4f6; }

/* ── Viewer ── */
.viewer-section {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 12px; margin-top: 0;
}
.viewer-section header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px; font-size: 12px; color: #475569; gap: 12px; flex-wrap: wrap;
}
.viewer-section h2 {
  font-size: 14px; margin: 0; font-weight: 700; color: #0f172a;
}
.viewer-section .meta {
  font-family: ui-monospace, "Menlo", "SFMono-Regular", monospace;
  font-size: 11px; color: #64748b;
}
.viewer-section .actions {
  display: flex; gap: 6px; flex-wrap: wrap;
}
.viewer {
  background: #fff; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden;
  height: calc(100vh - 200px); min-height: 560px;
}
iframe { width: 100%; height: 100%; border: 0; background: #fff; }

/* ── Empty state (when no ?type=) ── */
.empty-state {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 56px 32px;
  text-align: center;
  color: #475569;
}
.empty-state h2 {
  font-size: 16px; color: #0f172a; margin: 0 0 8px;
}
.empty-state p {
  margin: 8px 0; line-height: 1.7;
}
.empty-state code {
  font-family: ui-monospace, "Menlo", "SFMono-Regular", monospace;
  background: #f3f4f6; padding: 2px 8px; border-radius: 4px; font-size: 12px;
}

.error-banner {
  background: #fef2f2; border: 1px solid #fecaca; color: #991b1b;
  padding: 10px 12px; border-radius: 6px; margin-bottom: 12px; font-size: 12px;
}

@media (max-width: 720px) {
  .header { display: block; }
  .viewer { height: 70vh; min-height: 420px; }
}
`;

export function templatePreviewPage(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>ひな型プレビュー - LegalBridge</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="shell">
    <header class="header">
      <div>
        <h1>📄 ひな型プレビュー</h1>
        <div class="muted">Slack キャンバスの個別リンクから開いてください。サンプル PDF / HTML をダウンロードできます。</div>
      </div>
      <a class="btn secondary" href="/">← Search Portal に戻る</a>
    </header>

    <div id="errorBanner" class="error-banner" style="display:none;"></div>

    <!-- ?type=X 指定あり: iframe viewer を表示 -->
    <section class="viewer-section" id="viewerSection" style="display:none;">
      <header>
        <div>
          <h2 id="viewerTitle">プレビュー</h2>
          <div class="meta" id="viewerMeta"></div>
        </div>
        <div class="actions">
          <a id="openHtmlBtn" class="btn tiny outline" href="#" target="_blank" rel="noopener">↗ 別タブで開く</a>
          <a id="dlHtmlBtn" class="btn tiny outline" href="#" download>⬇ HTML</a>
          <a id="dlPdfBtn" class="btn tiny" href="#" download>⬇ PDF</a>
        </div>
      </header>
      <div class="viewer">
        <iframe id="previewFrame" title="Template sample preview"></iframe>
      </div>
    </section>

    <!-- ?type= 無し: 案内文 -->
    <section class="empty-state" id="emptyState" style="display:none;">
      <h2>ひな型を選択してください</h2>
      <p>このページは Slack キャンバスから個別のリンクで開く想定です。</p>
      <p class="muted">
        URL に <code>?type=&lt;template&gt;</code> を付けてアクセスしてください。<br>
        例: <code>/templates/preview?type=nda</code>
      </p>
    </section>
  </div>

  <script>
    const viewerSection = document.getElementById('viewerSection');
    const viewerTitle = document.getElementById('viewerTitle');
    const viewerMeta = document.getElementById('viewerMeta');
    const frame = document.getElementById('previewFrame');
    const openHtmlBtn = document.getElementById('openHtmlBtn');
    const dlHtmlBtn = document.getElementById('dlHtmlBtn');
    const dlPdfBtn = document.getElementById('dlPdfBtn');
    const emptyState = document.getElementById('emptyState');
    const errorBanner = document.getElementById('errorBanner');

    function htmlUrl(type, download) {
      const base = '/api/template-preview/' + encodeURIComponent(type) + '/html';
      return download ? (base + '?download=1') : base;
    }
    function pdfUrl(type) {
      return '/api/template-preview/' + encodeURIComponent(type) + '/pdf';
    }

    function showError(msg) {
      errorBanner.textContent = msg;
      errorBanner.style.display = '';
    }

    async function init() {
      const params = new URLSearchParams(location.search);
      const type = (params.get('type') || '').trim();
      if (!type) {
        emptyState.style.display = '';
        return;
      }

      // 該当ひな型のラベル / カテゴリを取得 (失敗しても致命的ではない)
      let label = '';
      let category = '';
      try {
        const res = await fetch('/api/template-preview/list');
        if (res.ok) {
          const data = await res.json();
          const t = (data.templates || []).find((x) => x.type === type);
          if (t) {
            label = t.label || '';
            category = t.category || '';
          } else {
            showError('指定されたひな型 "' + type + '" は見つかりませんでした。URL の type 名を確認してください。');
          }
        }
      } catch (e) {
        // ラベルが取れなくても type だけで表示は続行
      }

      const html = htmlUrl(type, false);
      const htmlDl = htmlUrl(type, true);
      const pdf = pdfUrl(type);

      viewerTitle.textContent = label || type;
      viewerMeta.textContent = label ? (type + (category ? ' · ' + category : '')) : (category || '');
      openHtmlBtn.href = html;
      dlHtmlBtn.href = htmlDl;
      dlHtmlBtn.setAttribute('download', type + '_sample.html');
      dlPdfBtn.href = pdf;
      dlPdfBtn.setAttribute('download', type + '_sample.pdf');
      frame.src = html;
      viewerSection.style.display = '';
    }

    init();
  </script>
</body>
</html>`;
}
