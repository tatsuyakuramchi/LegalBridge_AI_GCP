/**
 * Staff マスター CRUD 管理 UI (Phase 17z-4)
 *
 * /master/staff ページ。Vendor 版と同じ構造で、Slack ID をユニークキーに
 * 部署/メール/電話を管理する。CSV 一括インポート機能あり。
 */

import {
  MASTER_CSS,
  SVG,
  HEAD_FONTS,
  topbarHtml,
  pageHeaderHtml,
  masterTabsHtml,
} from "./masterChrome.ts";

export function staffMasterPage(): string {
  const apiListUrl = "/api/master/staff";
  const apiDetailTpl = "/api/master/staff/__ID__";
  const apiImportUrl = "/api/master/staff/import-csv";
  const apiTemplateUrl = "/api/master/staff/template.csv";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Staff · Arcs Legal OS</title>
  ${HEAD_FONTS}
  <style>${MASTER_CSS}</style>
</head>
<body>
  ${topbarHtml("Staff", "Master · Internal")}

  <div class="container" style="padding-top: 24px; padding-bottom: 48px;">
    ${pageHeaderHtml({
      tag: "MST · INDEX",
      title: "Master Systems",
      desc: "Reference data — vendors, staff, and contracts.",
    })}

    ${masterTabsHtml("staff")}

    <div class="toolbar">
      <div class="search">
        ${SVG.search}
        <input type="text" id="search" placeholder="氏名・部署・メール・Slack ID で検索…" autocomplete="off">
      </div>
      <span class="count-badge" id="count">— entries</span>
      <div class="spacer"></div>
      <button class="btn outline" id="btn-import">${SVG.upload} CSV 一括取込</button>
      <button class="btn" id="btn-new">${SVG.plus} スタッフを追加</button>
    </div>

    <div id="list-wrap">
      <div class="loading">LOADING</div>
    </div>
  </div>

  <!-- Edit / Create Modal -->
  <div class="modal-backdrop" id="modal-backdrop">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title-wrap">
          <span class="modal-tag" id="modal-tag">MST · STAFF</span>
          <h3 class="modal-title" id="modal-title">スタッフの編集</h3>
        </div>
        <button class="btn ghost sm" id="btn-close" aria-label="閉じる">${SVG.x}</button>
      </div>
      <div class="modal-body">
        <form id="form" autocomplete="off">
          <div class="form-grid">

            <div class="section-head"><span class="retro-tag">SEC · 01 / 基本情報</span></div>

            <div class="field">
              <label class="tech-label">Slack ユーザー ID<span class="req">*</span></label>
              <input class="tech-input" type="text" name="slack_user_id" required maxlength="50" placeholder="例: U01ABCDEF12">
              <span class="field-help">unique key。Slack のプロフィールから取得 (Member ID)。新規時のみ編集可能。</span>
            </div>

            <div class="field">
              <label class="tech-label">氏名<span class="req">*</span></label>
              <input class="tech-input" type="text" name="staff_name" required maxlength="255" placeholder="例: 倉持 達也">
            </div>

            <div class="field">
              <label class="tech-label">部署</label>
              <input class="tech-input" type="text" name="department" maxlength="100" placeholder="例: 経営管理本部">
              <span class="field-help">役割ベース認可で部署照会に使用。</span>
            </div>

            <div class="field">
              <label class="tech-label">部署コード</label>
              <input class="tech-input" type="text" name="department_code" maxlength="50" placeholder="例: MGMT / LEGAL">
            </div>

            <div class="section-head"><span class="retro-tag">SEC · 02 / 連絡先</span></div>

            <div class="field">
              <label class="tech-label">メールアドレス</label>
              <input class="tech-input" type="email" name="email" maxlength="255" placeholder="user@arclight.co.jp">
            </div>

            <div class="field">
              <label class="tech-label">電話番号</label>
              <input class="tech-input" type="tel" name="phone" maxlength="50" placeholder="03-1234-5678">
            </div>

          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn outline" id="btn-cancel">キャンセル</button>
        <button class="btn" id="btn-save">保存</button>
      </div>
    </div>
  </div>

  <!-- CSV Import Modal -->
  <div class="modal-backdrop" id="import-backdrop">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title-wrap">
          <span class="modal-tag">MST · STAFF / BULK</span>
          <h3 class="modal-title">CSV 一括取込</h3>
        </div>
        <button class="btn ghost sm" id="btn-import-close" aria-label="閉じる">${SVG.x}</button>
      </div>
      <div class="modal-body">
        <div class="import-card" style="margin: 0;">
          <p class="desc">
            CSV (UTF-8) を選択してアップロードしてください。
            <code>slack_user_id</code> と <code>staff_name</code> が必須、
            それ以外は欠落可。<br>
            既存の Slack ID は重複モードに従って処理されます。
          </p>

          <div class="file-input-wrap">
            <input type="file" id="import-file" accept=".csv,text/csv">
            <span class="count-badge" id="import-filename"></span>
          </div>

          <div style="margin-top: 16px; display: flex; gap: 16px; flex-wrap: wrap;">
            <div class="dup-mode">
              <label class="tech-label" style="margin-right: 4px;">重複時:</label>
              <select id="import-dup-mode" class="tech-select" style="width: auto;">
                <option value="overwrite" selected>overwrite (上書き・推奨)</option>
                <option value="fill_only">fill_only (空欄のみ補完)</option>
                <option value="skip">skip (既存はスキップ)</option>
              </select>
            </div>
            <label class="dup-mode" style="cursor: pointer;">
              <input type="checkbox" id="import-dry-run" checked>
              <span class="tech-label" style="margin: 0;">Dry Run (プレビューのみ)</span>
            </label>
          </div>

          <div style="margin-top: 16px;">
            <a href="${apiTemplateUrl}" download="staff_sample.csv" class="btn outline sm">
              ${SVG.download} サンプル CSV
            </a>
          </div>

          <div id="import-log" style="margin-top: 16px; font-family: var(--font-mono); font-size: 11px; color: var(--muted-foreground);"></div>
          <div id="import-result"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn outline" id="btn-import-cancel">キャンセル</button>
        <button class="btn" id="btn-import-submit">取込実行</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const apiListUrl   = ${JSON.stringify(apiListUrl)};
    const apiDetailTpl = ${JSON.stringify(apiDetailTpl)};
    const apiImportUrl = ${JSON.stringify(apiImportUrl)};
    const $ = (id) => document.getElementById(id);
    const ICON_USER = ${JSON.stringify(SVG.user)};

    let cache = [];
    let creating = false;

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
    function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

    /* ----- list ----- */
    async function loadList() {
      $('list-wrap').innerHTML = '<div class="loading">LOADING</div>';
      try {
        const res = await fetch(apiListUrl);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        cache = data.rows || [];
        renderList();
      } catch (e) {
        $('list-wrap').innerHTML =
          '<div class="loading" style="color: hsl(8 70% 45%);">FETCH FAILED — ' + (e?.message || e) + '</div>';
      }
    }

    function renderList() {
      const q = $('search').value.trim().toLowerCase();
      const rows = q
        ? cache.filter(s => {
            const hay = [s.slack_user_id, s.staff_name, s.email, s.department, s.department_code]
              .filter(Boolean).join(' ').toLowerCase();
            return hay.includes(q);
          })
        : cache;

      $('count').textContent = q
        ? rows.length + ' / ' + cache.length + ' ENTRIES'
        : cache.length + ' ENTRIES';

      if (rows.length === 0) {
        $('list-wrap').innerHTML =
          '<div class="grid"><div class="empty">NO STAFF REGISTERED</div></div>';
        return;
      }

      const cards = rows.map(s => {
        const deptBadge = s.department
          ? '<span class="badge">' + escHtml(s.department) + '</span>'
          : '';
        const codeBadge = s.department_code
          ? '<span class="badge corp">' + escHtml(s.department_code) + '</span>'
          : '';
        const sub = s.email || s.phone || '—';
        return '<div class="card" data-id="' + escAttr(s.slack_user_id) + '">'
          + '<div class="card-head">'
          +   ICON_USER
          +   '<span class="badge">' + escHtml(s.slack_user_id) + '</span>'
          + '</div>'
          + '<p class="card-name">' + escHtml(s.staff_name) + '</p>'
          + '<p class="card-sub">' + escHtml(sub) + '</p>'
          + '<div class="card-meta">' + deptBadge + ' ' + codeBadge + '</div>'
          + '</div>';
      }).join('');

      $('list-wrap').innerHTML = '<div class="grid">' + cards + '</div>';
      $('list-wrap').querySelectorAll('.card[data-id]').forEach(card => {
        card.addEventListener('click', () => openEdit(card.dataset.id));
      });
    }

    $('search').addEventListener('input', renderList);

    /* ----- edit modal ----- */
    function openCreate() {
      creating = true;
      $('modal-tag').textContent = 'MST · STAFF / NEW';
      $('modal-title').textContent = 'スタッフの新規追加';
      const form = $('form');
      form.reset();
      form.querySelector('[name=slack_user_id]').readOnly = false;
      $('modal-backdrop').classList.add('open');
      setTimeout(() => form.querySelector('[name=slack_user_id]').focus(), 50);
    }

    async function openEdit(id) {
      creating = false;
      $('modal-tag').textContent = 'MST · STAFF / EDIT';
      $('modal-title').textContent = id;
      const form = $('form');
      form.reset();
      $('modal-backdrop').classList.add('open');
      try {
        const url = apiDetailTpl.replace('__ID__', encodeURIComponent(id));
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const s = await res.json();
        fillForm(s);
        form.querySelector('[name=slack_user_id]').readOnly = true;
      } catch (e) {
        toast('取得失敗: ' + (e?.message || e), 'error');
        closeEditModal();
      }
    }

    function closeEditModal() { $('modal-backdrop').classList.remove('open'); }

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
        out[el.name] = el.value.trim();
      });
      return out;
    }

    $('btn-new').addEventListener('click', openCreate);
    $('btn-close').addEventListener('click', closeEditModal);
    $('btn-cancel').addEventListener('click', closeEditModal);
    $('modal-backdrop').addEventListener('click', (e) => {
      if (e.target === $('modal-backdrop')) closeEditModal();
    });

    $('btn-save').addEventListener('click', async () => {
      const payload = readForm();
      if (!payload.slack_user_id) { toast('Slack ID は必須です', 'error'); return; }
      if (!payload.staff_name) { toast('氏名は必須です', 'error'); return; }
      $('btn-save').disabled = true;
      try {
        const res = await fetch(apiListUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          throw new Error(data?.error || ('HTTP ' + res.status));
        }
        toast(creating ? '登録しました' : '更新しました', 'success');
        closeEditModal();
        await loadList();
      } catch (e) {
        toast('保存失敗: ' + (e?.message || e), 'error');
      } finally {
        $('btn-save').disabled = false;
      }
    });

    /* ----- import modal ----- */
    function openImport() {
      $('import-file').value = '';
      $('import-filename').textContent = '';
      $('import-dry-run').checked = true;
      $('import-dup-mode').value = 'overwrite';
      $('import-log').textContent = '';
      $('import-result').innerHTML = '';
      $('btn-import-submit').disabled = false;
      $('import-backdrop').classList.add('open');
    }

    function closeImport() { $('import-backdrop').classList.remove('open'); }

    $('btn-import').addEventListener('click', openImport);
    $('btn-import-close').addEventListener('click', closeImport);
    $('btn-import-cancel').addEventListener('click', closeImport);
    $('import-backdrop').addEventListener('click', (e) => {
      if (e.target === $('import-backdrop')) closeImport();
    });

    $('import-file').addEventListener('change', (e) => {
      const f = e.target.files[0];
      $('import-filename').textContent = f
        ? f.name + ' (' + Math.round(f.size / 1024) + ' KB)'
        : '';
    });

    $('btn-import-submit').addEventListener('click', async () => {
      const f = $('import-file').files[0];
      if (!f) { toast('ファイルを選択してください', 'error'); return; }
      const dryRun = $('import-dry-run').checked;
      const dupMode = $('import-dup-mode').value;
      $('btn-import-submit').disabled = true;
      $('import-log').textContent = '⏳ サーバー処理中…';
      $('import-result').innerHTML = '';

      try {
        const csvText = await f.text();
        const res = await fetch(apiImportUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv: csvText, dry_run: dryRun, duplicate_mode: dupMode }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          throw new Error(data?.error || ('HTTP ' + res.status));
        }
        $('import-log').textContent = dryRun
          ? '✅ Dry Run 完了 (DB は変更されていません)'
          : '✅ 取込完了';
        renderImportResult(data);
        if (!dryRun) {
          toast('取込完了: 成功 ' + (data.succeeded || 0) + ' 件', 'success');
          await loadList();
        }
      } catch (e) {
        $('import-log').textContent = '❌ 失敗: ' + (e?.message || e);
        toast('取込失敗: ' + (e?.message || e), 'error');
      } finally {
        $('btn-import-submit').disabled = false;
      }
    });

    function renderImportResult(r) {
      const errBlock = (r.errors && r.errors.length > 0)
        ? '<div class="error-list">'
          + r.errors.map(e => '<div class="row">行 ' + e.row + ' [' + escHtml(e.slack_user_id) + ']: ' + escHtml(e.error) + '</div>').join('')
          + '</div>'
        : '';
      $('import-result').innerHTML =
        '<div class="summary-grid">'
        + '<div class="stat"><div class="label">Total</div><div class="value">' + (r.total || 0) + '</div></div>'
        + '<div class="stat ok"><div class="label">Succeeded</div><div class="value">' + (r.succeeded || 0) + '</div></div>'
        + '<div class="stat warn"><div class="label">Skipped</div><div class="value">' + (r.skipped || 0) + '</div></div>'
        + '<div class="stat err"><div class="label">Failed</div><div class="value">' + (r.failed || 0) + '</div></div>'
        + '</div>'
        + errBlock;
    }

    /* ----- init ----- */
    loadList();
  </script>
</body>
</html>`;
}
