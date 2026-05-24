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
.shell { max-width: 1440px; margin: 0 auto; padding: 20px; }
.header {
  display: flex; align-items: end; justify-content: space-between; gap: 16px;
  border-bottom: 2px solid #111827; padding-bottom: 14px; margin-bottom: 16px;
}
h1 { margin: 0; font-size: 22px; letter-spacing: .02em; }
.muted { color: #6b7280; font-size: 12px; }
.toolbar {
  display: grid; grid-template-columns: minmax(260px, 1fr) auto auto auto; gap: 8px;
  align-items: center; background: #fff; border: 1px solid #e5e7eb; border-radius: 6px;
  padding: 12px; margin-bottom: 12px;
}
select, input {
  width: 100%; padding: 9px 10px; border: 1px solid #d1d5db; border-radius: 4px;
  background: #fff; font: inherit;
}
button, a.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px 12px; border: 1px solid #111827; border-radius: 4px;
  background: #111827; color: #fff; text-decoration: none; cursor: pointer;
  font-weight: 600; white-space: nowrap;
}
button.secondary, a.btn.secondary { background: #fff; color: #111827; }
button:disabled { opacity: .5; cursor: not-allowed; }
.status { min-height: 18px; margin: 0 0 10px; color: #475569; font-size: 12px; }
.viewer {
  background: #fff; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden;
  height: calc(100vh - 170px); min-height: 620px;
}
iframe { width: 100%; height: 100%; border: 0; background: #fff; }
@media (max-width: 760px) {
  .header { display: block; }
  .toolbar { grid-template-columns: 1fr; }
  .viewer { height: 70vh; min-height: 480px; }
}
`;

export function templatePreviewPage(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Template Preview - LegalBridge</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="shell">
    <header class="header">
      <div>
        <h1>Template Preview</h1>
        <div class="muted">サンプル情報でテンプレートの HTML プレビューと PDF ダウンロードを確認します。</div>
      </div>
      <a class="btn secondary" href="/">Search Portal に戻る</a>
    </header>

    <div class="toolbar">
      <select id="templateSelect" aria-label="template"></select>
      <button id="previewBtn" type="button">HTML プレビュー</button>
      <a id="openHtmlBtn" class="btn secondary" href="#" target="_blank" rel="noopener">別タブで開く</a>
      <a id="pdfBtn" class="btn" href="#" download>PDF ダウンロード</a>
    </div>

    <div id="status" class="status">テンプレート一覧を読み込み中...</div>
    <div class="viewer">
      <iframe id="previewFrame" title="Template sample preview"></iframe>
    </div>
  </div>

  <script>
    const select = document.getElementById('templateSelect');
    const frame = document.getElementById('previewFrame');
    const statusEl = document.getElementById('status');
    const previewBtn = document.getElementById('previewBtn');
    const openHtmlBtn = document.getElementById('openHtmlBtn');
    const pdfBtn = document.getElementById('pdfBtn');

    function setStatus(text) { statusEl.textContent = text || ''; }
    function currentType() { return select.value; }
    function htmlUrl(type) { return '/api/template-preview/' + encodeURIComponent(type) + '/html'; }
    function pdfUrl(type) { return '/api/template-preview/' + encodeURIComponent(type) + '/pdf'; }

    function refreshLinks() {
      const type = currentType();
      if (!type) return;
      const h = htmlUrl(type);
      const p = pdfUrl(type);
      frame.src = h;
      openHtmlBtn.href = h;
      pdfBtn.href = p;
      pdfBtn.setAttribute('download', type + '_sample.pdf');
      setStatus(type + ' を表示中');
    }

    async function loadTemplates() {
      try {
        const res = await fetch('/api/template-preview/list');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        select.innerHTML = '';
        for (const t of data.templates || []) {
          const opt = document.createElement('option');
          opt.value = t.type;
          opt.textContent = (t.label ? t.label + ' / ' : '') + t.type;
          select.appendChild(opt);
        }
        if (!select.options.length) {
          setStatus('テンプレートが見つかりませんでした。');
          return;
        }
        refreshLinks();
      } catch (e) {
        setStatus('テンプレート一覧の取得に失敗: ' + (e && e.message ? e.message : e));
      }
    }

    select.addEventListener('change', refreshLinks);
    previewBtn.addEventListener('click', refreshLinks);
    frame.addEventListener('load', () => setStatus(currentType() + ' の HTML プレビューを表示しました。'));
    loadTemplates();
  </script>
</body>
</html>`;
}
