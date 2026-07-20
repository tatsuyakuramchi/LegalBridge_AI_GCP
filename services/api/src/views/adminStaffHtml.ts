/**
 * /admin/staff スタッフ権限管理サブページ (Phase 22.21.42)
 *
 * /admin ダッシュボードから 1 ステップ挟んで開く「ユーザー権限管理」専用ページ。
 * staff 一覧 + admin/viewer 切替ボタン。
 *
 * 認可は server.ts 側で requireAppRole({allowedRoles:["admin"]}) を適用済み。
 */

import { popPage } from "./popChrome.ts";

const STYLE = `
.container { max-width: 1100px; margin: 0 auto; padding: 24px 20px 48px; }
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
.warning-banner {
  background: #fef3c7;
  border-left: 4px solid #f59e0b;
  padding: 10px 14px;
  margin-bottom: 12px;
  font-size: 13px;
  border-radius: 4px;
}
`;

function escHtml(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface AdminStaffPageOpts {
  currentEmail: string | null;
}

export function adminStaffPage(opts: AdminStaffPageOpts): string {
  const email = opts.currentEmail || "(unknown)";

  const body = `
  <div class="container">
    <div class="warning-banner">
      ⚠️ <strong>注意:</strong> admin 昇格を行うと、対象ユーザーは
      <code>/admin</code> ダッシュボードと CSV 取込機能 (LegalOn / 取引先) を
      利用できるようになります。viewer (デフォルト) は検索系のみ。
    </div>

    <section class="card">
      <h2>スタッフ一覧 &amp; ロール切替</h2>
      <p class="muted">
        bootstrap 用に <code>LB_APP_ADMIN_EMAILS</code> env でも admin 指定可能。
        env 由来の admin は本一覧で viewer 表示でも実質 admin として動作します。
      </p>
      <input type="text" id="staff-search" class="search-box" placeholder="メールアドレスや氏名で絞り込み…" />
      <div id="staff-msg"></div>
      <div id="staff-container">
        <div class="muted" style="padding: 12px 0;">⏳ 読み込み中...</div>
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
        // 全UIリニューアル A(ステップ2+3): SSR ポータルは閲覧専用。役割変更は admin-ui に
        //   集約(search-api の PATCH /api/master/staff/:email/role は撤去)。操作列は表示のみ。
        html += '<tr>'
          + '<td>' + escapeHtml(s.staff_name || '') + '</td>'
          + '<td><span style="font-family:ui-monospace,monospace;font-size:12px;">' + escapeHtml(s.email || '') + '</span></td>'
          + '<td>' + escapeHtml(s.department || '-') + '</td>'
          + '<td>' + pill + '</td>'
          + '<td><span class="muted" style="font-size:11px;">admin-ui で変更</span></td>'
          + '</tr>';
      }
      html += '</tbody></table>';
      $('staff-container').innerHTML = html;
    }

    $('staff-search').addEventListener('input', renderStaff);
    loadStaff();
  </script>`;

  return popPage({
    active: "admin",
    role: "admin",
    mode: "admin",
    title: "ユーザー権限管理",
    subtitle: "staff の admin / viewer ロール切替",
    body,
    headExtra: `<style>${STYLE}</style>`,
    contentBridge: true,
    pageTitle: "ユーザー権限管理 — LegalBridge 管理",
  });
}
