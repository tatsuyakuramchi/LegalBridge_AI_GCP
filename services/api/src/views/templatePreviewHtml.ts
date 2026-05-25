/**
 * templatePreviewHtml — Phase 22.21.85
 *
 * 事業部担当者 (viewer ロール) 向け「ひな型プレビュー / ダウンロード」ページ。
 *
 *   旧 (Phase 22.21.37): dropdown で 1 件選択 → iframe で表示
 *   新 (Phase 22.21.85): 全テンプレートをカードグリッドで列挙し、各カードから
 *     プレビュー / 別タブ / HTML ダウンロード / PDF ダウンロード に直リンク。
 *     検索ボックスで部分一致絞り込み可能。下部に従来の iframe ビューアも残し、
 *     カードの「プレビュー」ボタンで iframe に読み込む / 別タブで開く 両対応。
 *
 * テンプレ一覧の取得:
 *   - `/api/template-preview/list` (worker から templates_config を fetch)
 *   - レスポンス shape: { templates: [{ type, label, category }] }
 *
 * 各テンプレの直リンク:
 *   - HTML preview      /api/template-preview/<type>/html
 *   - HTML download     /api/template-preview/<type>/html?download=1
 *   - PDF download      /api/template-preview/<type>/pdf
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
.shell { max-width: 1280px; margin: 0 auto; padding: 20px 24px 80px; }
.header {
  display: flex; align-items: end; justify-content: space-between; gap: 16px;
  border-bottom: 2px solid #111827; padding-bottom: 14px; margin-bottom: 18px;
  flex-wrap: wrap;
}
h1 { margin: 0; font-size: 22px; letter-spacing: .02em; }
.muted { color: #6b7280; font-size: 12px; }
.toolbar {
  display: flex; gap: 10px; align-items: center;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 6px;
  padding: 10px 12px; margin-bottom: 16px; flex-wrap: wrap;
}
.toolbar input[type=search] {
  flex: 1 1 280px; min-width: 240px;
  padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 4px;
  background: #fff; font: inherit;
}
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
.btn.tiny.danger { border-color: transparent; background: #fee2e2; color: #b91c1c; }

.status { min-height: 18px; margin: 0 0 12px; color: #475569; font-size: 12px; }

/* ── Card grid ── */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px 14px 12px;
  display: flex; flex-direction: column; gap: 10px;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.card:hover {
  border-color: #94a3b8;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}
.card.hidden { display: none; }
.card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.card-title {
  font-weight: 700; font-size: 14.5px; color: #0f172a;
  word-break: break-word;
}
.card-type {
  font-family: ui-monospace, "Menlo", "SFMono-Regular", monospace;
  color: #64748b; font-size: 11px; margin-top: 2px;
  word-break: break-all;
}
.cat-badge {
  flex-shrink: 0; display: inline-block;
  padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700;
  letter-spacing: 0.04em; text-transform: uppercase;
}
.cat-Domestic       { background: #dbeafe; color: #1e40af; }
.cat-International  { background: #dcfce7; color: #166534; }
.cat-Internal       { background: #fef3c7; color: #92400e; }
.cat-Other          { background: #e5e7eb; color: #374151; }

.card-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 4px;
}
.card-actions a {
  text-align: center;
}

/* ── Embedded viewer ── */
.viewer-section {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 12px; margin-top: 12px;
}
.viewer-section header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px; font-size: 12px; color: #475569;
}
.viewer-section h2 {
  font-size: 13px; margin: 0; font-weight: 700; color: #0f172a;
}
.viewer {
  background: #fff; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden;
  height: 70vh; min-height: 480px;
}
iframe { width: 100%; height: 100%; border: 0; background: #fff; }

.empty {
  text-align: center; padding: 48px 16px; color: #94a3b8;
  border: 1px dashed #cbd5e1; border-radius: 8px; background: #fff;
}

/* ── Slack canvas markdown panel (Phase 22.21.86) ── */
.md-section {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 12px 14px; margin-top: 16px;
}
.md-section header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; margin-bottom: 8px; flex-wrap: wrap;
}
.md-section h2 {
  font-size: 13px; margin: 0; font-weight: 700; color: #0f172a;
}
.md-section .desc { color: #6b7280; font-size: 11px; margin: 2px 0 8px; line-height: 1.6; }
.md-section .desc code {
  font-family: ui-monospace, "Menlo", "SFMono-Regular", monospace;
  background: #f3f4f6; padding: 1px 6px; border-radius: 3px; font-size: 11px;
}
.md-section .md-tabs {
  display: inline-flex; gap: 2px; background: #f3f4f6;
  border-radius: 6px; padding: 3px;
}
.md-section .md-tab {
  padding: 5px 12px; border: 0; background: transparent;
  font: inherit; font-size: 11.5px; font-weight: 600; color: #475569;
  border-radius: 4px; cursor: pointer;
}
.md-section .md-tab.active { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.md-section textarea {
  width: 100%; min-height: 220px; max-height: 50vh;
  font-family: ui-monospace, "Menlo", "SFMono-Regular", monospace;
  font-size: 12px; line-height: 1.55;
  padding: 12px; border: 1px solid #d1d5db; border-radius: 6px;
  background: #f8fafc; color: #1f2937; resize: vertical;
}
.md-section .md-actions {
  display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;
}
.copy-flash {
  display: inline-block; margin-left: 8px; font-size: 11px;
  color: #15803d; font-weight: 600;
  opacity: 0; transition: opacity 0.15s;
}
.copy-flash.shown { opacity: 1; }

@media (max-width: 720px) {
  .header { display: block; }
  .grid { grid-template-columns: 1fr; }
}
`;

export function templatePreviewPage(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>ひな型ライブラリ - LegalBridge</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="shell">
    <header class="header">
      <div>
        <h1>📄 ひな型ライブラリ</h1>
        <div class="muted">
          各ひな型のサンプル PDF / HTML を直接ダウンロードできます。プレビューで内容を確認後、PDF をご利用ください。
        </div>
      </div>
      <a class="btn secondary" href="/">← Search Portal に戻る</a>
    </header>

    <div class="toolbar">
      <input
        id="searchBox"
        type="search"
        placeholder="ひな型名 / type で絞り込み (例: 発注書, sales_master)"
        autocomplete="off"
      >
      <span id="count" class="muted">— 件</span>
      <button id="reloadBtn" type="button" class="btn secondary" title="サーバから一覧を再取得">⟳ 再読み込み</button>
    </div>

    <div id="status" class="status">テンプレート一覧を読み込み中...</div>
    <div id="grid" class="grid"></div>
    <div id="emptyMsg" class="empty" style="display:none;">該当するひな型がありません。</div>

    <section class="viewer-section" id="viewerSection" style="display:none;">
      <header>
        <h2 id="viewerTitle">プレビュー</h2>
        <div>
          <a id="viewerOpen" class="btn tiny outline" href="#" target="_blank" rel="noopener">別タブで開く ↗</a>
          <button id="viewerClose" type="button" class="btn tiny outline">✕ 閉じる</button>
        </div>
      </header>
      <div class="viewer">
        <iframe id="previewFrame" title="Template sample preview"></iframe>
      </div>
    </section>

    <!-- Phase 22.21.86: Slack キャンバス用 markdown スニペット
         viewer ロールで誰でも閲覧 / コピー可能。ベース URL は
         window.location.origin で動的に決まるので、custom domain 移行後も
         そのまま動く。 -->
    <section class="md-section" id="mdSection">
      <header>
        <div>
          <h2>📋 Slack キャンバス用 markdown</h2>
          <div class="desc">
            下のスタイルを選び、テキストをコピーして Slack キャンバスに貼り付けてください。<br>
            URL は常に <code>https://legalbridge.arclight.co.jp</code> (IAP 経由) を使用するため、貼り付け後のリンクは社内 Google アカウントでサインインしたユーザーがそのまま開けます。
          </div>
        </div>
        <div class="md-tabs" role="tablist">
          <button class="md-tab active" type="button" data-style="table">📊 表形式</button>
          <button class="md-tab" type="button" data-style="grouped">📑 カテゴリ別</button>
          <button class="md-tab" type="button" data-style="compact">📝 コンパクト</button>
        </div>
      </header>
      <textarea id="mdOutput" readonly aria-label="Slack canvas markdown"></textarea>
      <div class="md-actions">
        <button id="copyMdBtn" type="button" class="btn">📋 クリップボードにコピー</button>
        <button id="selectMdBtn" type="button" class="btn secondary">🔍 全選択</button>
        <span id="copyFlash" class="copy-flash">✓ コピーしました</span>
      </div>
    </section>

    <div class="muted" style="margin-top: 32px; font-size: 11px; line-height: 1.7;">
      ※ サンプル PDF はダミーデータを差し込んで生成されたもので、実運用の文書ではありません。<br>
      ※ 「プレビュー」ボタンを押すと下部に内容が表示されます。新しいタブで開く / DL も可能です。<br>
      ※ 取引先 / 案件固有の文書を発行したい場合は法務部までご依頼ください。<br>
      ※ Slack キャンバスに貼った URL は <strong>IAP 認証ゲート</strong>配下です — クリックした人が社内 Google アカウントでサインインしていればそのまま閲覧できます。
    </div>
  </div>

  <script>
    // ----- DOM refs -----
    const gridEl = document.getElementById('grid');
    const statusEl = document.getElementById('status');
    const emptyEl = document.getElementById('emptyMsg');
    const countEl = document.getElementById('count');
    const searchEl = document.getElementById('searchBox');
    const reloadBtn = document.getElementById('reloadBtn');
    const viewerSection = document.getElementById('viewerSection');
    const viewerTitle = document.getElementById('viewerTitle');
    const viewerOpen = document.getElementById('viewerOpen');
    const viewerClose = document.getElementById('viewerClose');
    const frame = document.getElementById('previewFrame');
    // Phase 22.21.86: Slack 用 markdown panel refs
    const mdOutput = document.getElementById('mdOutput');
    const copyMdBtn = document.getElementById('copyMdBtn');
    const selectMdBtn = document.getElementById('selectMdBtn');
    const copyFlash = document.getElementById('copyFlash');
    const mdTabs = document.querySelectorAll('.md-tab');
    let currentMdStyle = 'table';
    let currentTemplates = [];

    // ----- URL builders -----
    function htmlUrl(type, download) {
      const base = '/api/template-preview/' + encodeURIComponent(type) + '/html';
      return download ? (base + '?download=1') : base;
    }
    function pdfUrl(type) {
      return '/api/template-preview/' + encodeURIComponent(type) + '/pdf';
    }

    // ----- Card rendering -----
    function escapeHtml(s) {
      if (s == null) return '';
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function categoryClass(cat) {
      // Domestic / International / Internal / それ以外 = Other
      if (cat === 'Domestic') return 'cat-Domestic';
      if (cat === 'International') return 'cat-International';
      if (cat === 'Internal') return 'cat-Internal';
      return 'cat-Other';
    }

    function renderCard(t) {
      const labelHtml = escapeHtml(t.label || t.type);
      const typeHtml = escapeHtml(t.type);
      const catHtml = escapeHtml(t.category || 'Other');
      const catCls = categoryClass(t.category);
      const html = htmlUrl(t.type, false);
      const htmlDl = htmlUrl(t.type, true);
      const pdf = pdfUrl(t.type);

      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.type = t.type;
      card.dataset.label = (t.label || '').toLowerCase();
      card.innerHTML =
        '<div class="card-head">' +
          '<div>' +
            '<div class="card-title">' + labelHtml + '</div>' +
            '<div class="card-type">' + typeHtml + '</div>' +
          '</div>' +
          '<span class="cat-badge ' + catCls + '">' + catHtml + '</span>' +
        '</div>' +
        '<div class="card-actions">' +
          '<button class="btn tiny" data-action="preview">👁 プレビュー</button>' +
          '<a class="btn tiny outline" href="' + html + '" target="_blank" rel="noopener">↗ 別タブ</a>' +
          '<a class="btn tiny outline" href="' + htmlDl + '" download="' + typeHtml + '_sample.html">⬇ HTML</a>' +
          '<a class="btn tiny outline" href="' + pdf + '" download="' + typeHtml + '_sample.pdf">⬇ PDF</a>' +
        '</div>';

      const previewBtn = card.querySelector('[data-action=preview]');
      previewBtn.addEventListener('click', () => openInViewer(t));
      return card;
    }

    // ----- Phase 22.21.86 → 22.21.87: Slack canvas markdown 生成 -----
    //   3 スタイル (table / grouped / compact) を currentTemplates から生成。
    //
    //   Phase 22.21.87: ベース URL を IAP 経由の公開ドメイン
    //   (legalbridge.arclight.co.jp) にハードコード。
    //   理由: window.location.origin だと、もし担当者が誤って
    //   .run.app 直 URL でこのページを開いていた場合、コピーされる
    //   markdown が .run.app になり、Slack でクリックされた瞬間 IAP を
    //   バイパスして 401 になる。ハードコードすればホスト名に関係なく
    //   常に正しい IAP-fronted URL が生成される。
    //
    //   将来ドメイン変更が必要になったらこの定数 1 か所を更新する。
    const PUBLIC_ORIGIN = 'https://legalbridge.arclight.co.jp';

    // category → 表示順 & 日本語ラベル (grouped スタイル用)
    const CAT_ORDER = ['Domestic', 'International', 'Internal', 'Other'];
    const CAT_LABEL_JA = {
      Domestic: '🟦 国内文書',
      International: '🟢 国際文書',
      Internal: '🟡 内部文書',
      Other: '⬜ その他',
    };

    function buildMdTable(templates) {
      const lines = [];
      lines.push('# 📄 ひな型ライブラリ');
      lines.push('');
      lines.push('> [🗂 全件一覧ページを開く](' + PUBLIC_ORIGIN + '/templates/preview)');
      lines.push('');
      lines.push('| ひな型 | プレビュー | PDF DL |');
      lines.push('|---|---|---|');
      templates.forEach((t) => {
        const label = (t.label || t.type).replace(/\\|/g, '\\\\|');
        const prev = PUBLIC_ORIGIN + '/templates/preview?type=' + encodeURIComponent(t.type);
        const pdf = PUBLIC_ORIGIN + '/api/template-preview/' + encodeURIComponent(t.type) + '/pdf';
        lines.push('| ' + label + ' | [📖](' + prev + ') | [⬇](' + pdf + ') |');
      });
      return lines.join('\\n');
    }

    function buildMdGrouped(templates) {
      const buckets = {};
      templates.forEach((t) => {
        const cat = t.category || 'Other';
        if (!buckets[cat]) buckets[cat] = [];
        buckets[cat].push(t);
      });
      const lines = [];
      lines.push('# 📄 ひな型ライブラリ');
      lines.push('');
      lines.push('[🗂 全件一覧ページ](' + PUBLIC_ORIGIN + '/templates/preview)');
      lines.push('');
      CAT_ORDER.forEach((cat) => {
        const list = buckets[cat];
        if (!list || list.length === 0) return;
        lines.push('## ' + (CAT_LABEL_JA[cat] || cat));
        list.forEach((t) => {
          const label = t.label || t.type;
          const prev = PUBLIC_ORIGIN + '/templates/preview?type=' + encodeURIComponent(t.type);
          const pdf = PUBLIC_ORIGIN + '/api/template-preview/' + encodeURIComponent(t.type) + '/pdf';
          lines.push('- **' + label + '** — [📖 プレビュー](' + prev + ') ・ [⬇ PDF](' + pdf + ')');
        });
        lines.push('');
      });
      return lines.join('\\n').trimEnd();
    }

    function buildMdCompact(templates) {
      const lines = [];
      lines.push('# 📄 ひな型 PDF ダウンロード');
      lines.push('');
      lines.push('[🗂 全件一覧（プレビュー付き）](' + PUBLIC_ORIGIN + '/templates/preview)');
      lines.push('');
      templates.forEach((t) => {
        const label = t.label || t.type;
        const pdf = PUBLIC_ORIGIN + '/api/template-preview/' + encodeURIComponent(t.type) + '/pdf';
        lines.push('- [' + label + '](' + pdf + ')');
      });
      return lines.join('\\n');
    }

    function regenerateMd() {
      if (!currentTemplates.length) {
        mdOutput.value = '(テンプレート一覧を読み込み中...)';
        return;
      }
      if (currentMdStyle === 'grouped') {
        mdOutput.value = buildMdGrouped(currentTemplates);
      } else if (currentMdStyle === 'compact') {
        mdOutput.value = buildMdCompact(currentTemplates);
      } else {
        mdOutput.value = buildMdTable(currentTemplates);
      }
    }

    mdTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        mdTabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        currentMdStyle = tab.dataset.style || 'table';
        regenerateMd();
      });
    });

    selectMdBtn.addEventListener('click', () => {
      mdOutput.focus();
      mdOutput.select();
    });

    copyMdBtn.addEventListener('click', async () => {
      const text = mdOutput.value;
      let ok = false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          ok = true;
        }
      } catch (e) { /* fall through to execCommand fallback */ }
      if (!ok) {
        // フォールバック: textarea を select して execCommand('copy')
        mdOutput.focus();
        mdOutput.select();
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      }
      if (ok) {
        copyFlash.classList.add('shown');
        setTimeout(() => copyFlash.classList.remove('shown'), 1800);
      } else {
        alert('コピーに失敗しました。手動で全選択 (Ctrl+A) → コピー (Ctrl+C) してください。');
      }
    });

    // ----- Viewer -----
    function openInViewer(t) {
      const url = htmlUrl(t.type, false);
      viewerTitle.textContent = (t.label || t.type) + ' / ' + t.type;
      viewerOpen.href = url;
      frame.src = url;
      viewerSection.style.display = '';
      viewerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    viewerClose.addEventListener('click', () => {
      viewerSection.style.display = 'none';
      frame.src = 'about:blank';
    });

    // ----- Filter -----
    function applyFilter() {
      const q = (searchEl.value || '').toLowerCase().trim();
      const cards = gridEl.querySelectorAll('.card');
      let visible = 0;
      cards.forEach((c) => {
        const t = (c.dataset.type || '').toLowerCase();
        const l = c.dataset.label || '';
        const hit = !q || t.includes(q) || l.includes(q);
        c.classList.toggle('hidden', !hit);
        if (hit) visible++;
      });
      countEl.textContent = visible + ' 件 (全 ' + cards.length + ' 件)';
      emptyEl.style.display = visible === 0 && cards.length > 0 ? '' : 'none';
    }
    searchEl.addEventListener('input', applyFilter);

    // ----- Load templates -----
    async function loadTemplates() {
      statusEl.textContent = 'テンプレート一覧を読み込み中...';
      gridEl.innerHTML = '';
      try {
        const res = await fetch('/api/template-preview/list');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const templates = Array.isArray(data.templates) ? data.templates : [];
        if (templates.length === 0) {
          statusEl.textContent = 'テンプレートが登録されていません。';
          return;
        }
        // category, label の昇順
        templates.sort((a, b) => {
          const ca = a.category || 'zzz';
          const cb = b.category || 'zzz';
          if (ca !== cb) return ca.localeCompare(cb);
          return (a.label || a.type).localeCompare(b.label || b.type, 'ja');
        });
        templates.forEach((t) => gridEl.appendChild(renderCard(t)));
        statusEl.textContent = '';
        applyFilter();

        // Phase 22.21.86: Slack markdown panel に流し込む
        currentTemplates = templates;
        regenerateMd();

        // Deep link: /templates/preview?type=xxx で来た場合は自動で viewer を開く
        const params = new URLSearchParams(location.search);
        const deeplinkType = params.get('type');
        if (deeplinkType) {
          const t = templates.find((x) => x.type === deeplinkType);
          if (t) openInViewer(t);
        }
      } catch (e) {
        statusEl.textContent = 'テンプレート一覧の取得に失敗: ' + (e && e.message ? e.message : e);
      }
    }

    reloadBtn.addEventListener('click', loadTemplates);
    loadTemplates();
  </script>
</body>
</html>`;
}
