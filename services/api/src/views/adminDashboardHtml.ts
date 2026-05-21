/**
 * /admin ダッシュボードページ (Phase 22.21.36)
 *
 * 管理者 (staff.app_role='admin') 専用の操作集約ページ。
 *
 *   - ユーザー権限管理 (staff 一覧 + admin/viewer 切替)
 *   - インポート機能のショートカット (/imports/legalon, /imports/vendor)
 *   - 検索・マスター系へのリンク (案内のみ、誰でも開けるリンク)
 *
 * 認可は server.ts 側で requireAppRole({allowedRoles:["admin"]}) を適用済み。
 */

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
.container { max-width: 1100px; margin: 0 auto; padding: 24px 20px 48px; }
header.page-header {
  border-bottom: 2px solid #1f2937;
  padding-bottom: 16px;
  margin-bottom: 24px;
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
.grid-2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  margin-top: 8px;
}
.tile {
  display: block;
  text-decoration: none;
  color: inherit;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-left: 4px solid #1f2937;
  border-radius: 6px;
  padding: 14px 16px;
  transition: background .15s;
}
.tile:hover { background: #f3f4f6; }
.tile .title { font-weight: 700; font-size: 14px; }
.tile .desc  { color: #6b7280; font-size: 12px; margin-top: 4px; }
.tile.import { border-left-color: #2563eb; }
.tile.master { border-left-color: #16a34a; }
.tile.search { border-left-color: #d97706; }
table.staff-list { width: 100%; border-collapse: collapse; font-size: 13px; }
table.staff-list th, table.staff-list td {
  border-bottom: 1px solid #e5e7eb;
  padding: 8px 10px;
  text-align: left;
  vertical-align: middle;
}
table.staff-list thead { background: #f3f4f6; }
.pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
}
.pill.admin  { background: #fee2e2; color: #991b1b; }
.pill.viewer { background: #e5e7eb; color: #374151; }
button {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #1f2937;
  background: #fff;
  color: #1f2937;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}
button.primary { background: #1f2937; color: #fff; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
input.search-box {
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  width: 100%;
  max-width: 320px;
  font-size: 13px;
}
.error-row {
  background: #fef2f2;
  border-left: 4px solid #ef4444;
  padding: 6px 10px;
  margin: 6px 0;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
.toast {
  background: #d1fae5;
  border-left: 4px solid #10b981;
  padding: 6px 10px;
  margin: 6px 0;
  font-size: 12px;
}
#log .loading { color: #6b7280; font-style: italic; }
`;

interface AdminPageOpts {
  currentEmail: string | null;
}

export function adminDashboardPage(opts: AdminPageOpts): string {
  const email = opts.currentEmail || "(unknown)";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>LegalBridge 管理ダッシュボード</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="container">
    <header class="page-header">
      <h1>⚙️ LegalBridge 管理ダッシュボード</h1>
      <div class="muted">あなたのログイン: <strong>${escapeHtml(email)}</strong> (app_role=admin)</div>
    </header>

    <!-- ==== 1. データ取り込み (Imports) ==== -->
    <section class="card">
      <h2>📥 データ取り込み</h2>
      <p class="muted">大量データを CSV で一括登録します。すべて Dry Run プレビュー付き。</p>
      <div class="grid-2">
        <a class="tile import" href="/imports/legalon">
          <div class="title">📋 LegalOn 契約台帳</div>
          <div class="desc">過去の契約 (CloudSign / Drive / 紙) を contract_capabilities へ一括登録</div>
        </a>
        <a class="tile import" href="/imports/vendor">
          <div class="title">🏢 取引先マスタ</div>
          <div class="desc">vendor_code をキーに upsert。3 種の重複モードに対応</div>
        </a>
      </div>
    </section>

    <!-- ==== 2. ユーザー権限管理 ==== -->
    <section class="card">
      <h2>👥 ユーザー権限管理</h2>
      <p class="muted">
        admin 権限を持つユーザーは、本ページとデータ取り込み機能を使用できます。
        viewer (デフォルト) は検索系のみ。bootstrap 用に
        <code>LB_APP_ADMIN_EMAILS</code> env でも admin 指定可能。
      </p>
      <input type="text" id="staff-search" class="search-box" placeholder="メールアドレスや氏名で絞り込み…" />
      <div id="staff-msg"></div>
      <div id="staff-container">
        <div class="muted" style="padding: 12px 0;">⏳ 読み込み中...</div>
      </div>
    </section>

    <!-- ==== 3. マスター管理 (search-api 内 CRUD) ==== -->
    <section class="card">
      <h2>🗂️ マスター CRUD (search-api ネイティブ)</h2>
      <div class="grid-2">
        <a class="tile master" href="/master/staff">
          <div class="title">👤 スタッフマスタ</div>
          <div class="desc">staff CRUD + CSV 取込 (経営管理本部・法務のみ)</div>
        </a>
        <a class="tile master" href="/master/vendors">
          <div class="title">🏢 取引先マスタ</div>
          <div class="desc">vendors CRUD (個別 1 件単位)</div>
        </a>
        <a class="tile master" href="/master/contracts">
          <div class="title">📜 契約マスタ</div>
          <div class="desc">contract_capabilities 詳細表示・LegalOn 統合</div>
        </a>
      </div>
    </section>

    <!-- ==== 4. 検索 (Viewer も使う) ==== -->
    <section class="card">
      <h2>🔍 検索 (viewer / admin 共通)</h2>
      <p class="muted">
        以下は admin / viewer の両方が使えます。viewer ユーザーには本ダッシュボードへの
        リンクではなく、こちらの URL を直接案内してください。
      </p>
      <div class="grid-2">
        <a class="tile search" href="/search/vendor">
          <div class="title">🔎 取引先・契約検索</div>
          <div class="desc">/search/vendor?q=&lt;取引先名&gt; — 取引先名や契約類型から</div>
        </a>
        <a class="tile search" href="javascript:void(0)" onclick="alert('稟議番号 (5 桁) を URL 末尾に追加してください: /search/ringi/00001');return false;">
          <div class="title">📋 稟議番号検索</div>
          <div class="desc">/search/ringi/00001 — 5 桁の稟議番号で詳細表示</div>
        </a>
      </div>
    </section>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);

    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }

    let allStaff = [];

    async function loadStaff() {
      try {
        const res = await fetch('/api/master/staff', {
          headers: { 'Accept': 'application/json' },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
        allStaff = Array.isArray(data) ? data : (data.rows || []);
        renderStaff();
      } catch (err) {
        $('staff-container').innerHTML =
          '<div class="error-row">❌ スタッフ一覧取得失敗: ' + escapeHtml(String(err.message || err)) + '</div>';
      }
    }

    function renderStaff() {
      const q = ($('staff-search').value || '').toLowerCase().trim();
      const rows = allStaff.filter(s => {
        if (!q) return true;
        return (
          (s.email || '').toLowerCase().includes(q) ||
          (s.staff_name || '').toLowerCase().includes(q) ||
          (s.department || '').toLowerCase().includes(q)
        );
      });
      if (rows.length === 0) {
        $('staff-container').innerHTML = '<div class="muted" style="padding:12px 0;">該当するスタッフがいません。</div>';
        return;
      }
      let html = '<table class="staff-list">'
        + '<thead><tr>'
        + '<th>氏名</th><th>メール</th><th>部署</th><th>役割</th><th style="width:140px;">操作</th>'
        + '</tr></thead><tbody>';
      for (const s of rows) {
        const role = (s.app_role || 'viewer').toLowerCase();
        const pill = role === 'admin'
          ? '<span class="pill admin">admin</span>'
          : '<span class="pill viewer">viewer</span>';
        const btnLabel = role === 'admin' ? 'viewer に変更' : 'admin に昇格';
        const newRole = role === 'admin' ? 'viewer' : 'admin';
        html += '<tr>'
          + '<td>' + escapeHtml(s.staff_name || '') + '</td>'
          + '<td><span style="font-family:ui-monospace,monospace;font-size:12px;">' + escapeHtml(s.email || '') + '</span></td>'
          + '<td>' + escapeHtml(s.department || '-') + '</td>'
          + '<td>' + pill + '</td>'
          + '<td>'
          + (s.email
              ? '<button data-email="' + escapeHtml(s.email) + '" data-role="' + newRole + '" class="role-btn">' + btnLabel + '</button>'
              : '<span class="muted">email 無</span>')
          + '</td>'
          + '</tr>';
      }
      html += '</tbody></table>';
      $('staff-container').innerHTML = html;
      document.querySelectorAll('.role-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const email = btn.dataset.email;
          const role = btn.dataset.role;
          if (!confirm(email + ' を ' + role + ' に変更します。よろしいですか?')) return;
          btn.disabled = true;
          try {
            const res = await fetch(
              '/api/master/staff/' + encodeURIComponent(email) + '/role',
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ app_role: role }),
              }
            );
            const data = await res.json();
            if (!res.ok || data.ok === false) {
              throw new Error(data.error || 'HTTP ' + res.status);
            }
            $('staff-msg').innerHTML =
              '<div class="toast">✓ ' + escapeHtml(email) + ' → ' + escapeHtml(role) + ' に変更しました</div>';
            await loadStaff();
          } catch (err) {
            $('staff-msg').innerHTML =
              '<div class="error-row">❌ 変更失敗: ' + escapeHtml(String(err.message || err)) + '</div>';
            btn.disabled = false;
          }
        });
      });
    }

    $('staff-search').addEventListener('input', renderStaff);
    loadStaff();
  </script>
</body>
</html>`;
}

function escapeHtml(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
