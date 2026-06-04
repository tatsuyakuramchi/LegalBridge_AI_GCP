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

import { popPage } from "./popChrome.ts";

const STYLE = `
/* グローバル body/* リセットは pop 共通テーマ(POP_CSS)に委譲。ここではページ固有のみ。 */
.shell { max-width: 1280px; margin: 0 auto; padding: 0 0 24px; }
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

/* ── Template list (empty state when no ?type=) ── */
.tpl-list { text-align: left; margin-top: 8px; }
.tpl-cat {
  font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: .06em;
  text-transform: uppercase; margin: 18px 0 6px; padding-bottom: 4px;
  border-bottom: 1px solid #e5e7eb;
}
.tpl-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 9px 10px; border: 1px solid #e5e7eb; border-radius: 6px; margin: 6px 0;
  background: #fff; flex-wrap: wrap;
}
.tpl-info { display: flex; align-items: baseline; gap: 10px; min-width: 0; flex-wrap: wrap; }
.tpl-info a { font-weight: 600; color: #1d4ed8; text-decoration: none; }
.tpl-info a:hover { text-decoration: underline; }
.tpl-type {
  font-family: ui-monospace, "Menlo", "SFMono-Regular", monospace;
  font-size: 11px; color: #94a3b8;
}
.tpl-actions { display: flex; gap: 6px; flex-shrink: 0; }
.copy-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  background: #111827; color: #fff; padding: 8px 16px; border-radius: 6px;
  font-size: 13px; opacity: 0; transition: opacity .2s; pointer-events: none; z-index: 50;
}
.copy-toast.show { opacity: 1; }

@media (max-width: 720px) {
  .header { display: block; }
  .viewer { height: 70vh; min-height: 420px; }
  .tpl-row { flex-direction: column; align-items: stretch; }
}
`;

export function templatePreviewPage(): string {
  const body = `
  <div class="shell">

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

    <!-- ?type= 無し: ひな型一覧 (プレビュー導線 + Slack 用 MD コピー) -->
    <section class="empty-state" id="emptyState" style="display:none;">
      <h2>ひな型一覧</h2>
      <p class="muted">
        「プレビュー」で内容を確認できます。「Slack用リンクをコピー」で
        キャンバスに貼れる Markdown リンク <code>[名称](URL)</code> をコピーします。
      </p>
      <div id="tplListMsg" class="muted" style="margin:14px 0;">読み込み中…</div>
      <div id="tplList" class="tpl-list"></div>
    </section>
  </div>
  <div id="copyToast" class="copy-toast">コピーしました</div>

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

    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
      );
    }

    function showToast(msg) {
      const t = document.getElementById('copyToast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 1500);
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
      }
    }

    // ?type= 無しのときのひな型一覧 (プレビュー導線 + Slack 用 Markdown リンク)
    async function renderTemplateList() {
      const listEl = document.getElementById('tplList');
      const msgEl = document.getElementById('tplListMsg');
      try {
        const res = await fetch('/api/template-preview/list');
        const data = await res.json();
        const templates = (data && data.templates) || [];
        if (!templates.length) {
          msgEl.textContent = 'ひな型が見つかりませんでした。';
          return;
        }
        msgEl.style.display = 'none';
        const byCat = {};
        templates.forEach((t) => {
          const c = t.category || 'その他';
          (byCat[c] = byCat[c] || []).push(t);
        });
        const origin = location.origin;
        let html = '';
        Object.keys(byCat).sort().forEach((cat) => {
          html += '<div class="tpl-cat">' + escapeHtml(cat) + '</div>';
          byCat[cat].forEach((t) => {
            const q = '?type=' + encodeURIComponent(t.type);
            const viewerUrl = origin + '/templates/preview' + q;
            const md = '[' + (t.label || t.type) + '](' + viewerUrl + ')';
            html +=
              '<div class="tpl-row">' +
                '<div class="tpl-info">' +
                  '<a href="' + q + '">' + escapeHtml(t.label || t.type) + '</a>' +
                  '<span class="tpl-type">' + escapeHtml(t.type) + '</span>' +
                '</div>' +
                '<div class="tpl-actions">' +
                  '<a class="btn tiny outline" href="' + q + '">プレビュー</a>' +
                  '<button class="btn tiny" type="button" data-md="' + escapeHtml(md) + '">Slack用リンクをコピー</button>' +
                '</div>' +
              '</div>';
          });
        });
        listEl.innerHTML = html;
        listEl.querySelectorAll('button[data-md]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            await copyText(btn.getAttribute('data-md') || '');
            showToast('Slack用リンクをコピーしました');
          });
        });
      } catch (e) {
        msgEl.textContent = '一覧の取得に失敗しました: ' + e;
      }
    }

    async function init() {
      const params = new URLSearchParams(location.search);
      const type = (params.get('type') || '').trim();
      if (!type) {
        emptyState.style.display = '';
        renderTemplateList();
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
  </script>`;

  return popPage({
    active: "admin",
    mode: "admin",
    title: "ひな型プレビュー",
    subtitle: "Slack キャンバスの個別リンクから開いてください。サンプル PDF / HTML をダウンロードできます。",
    body,
    headExtra: `<style>${STYLE}</style>`,
    contentBridge: true,
    pageTitle: "ひな型プレビュー - LegalBridge",
  });
}
