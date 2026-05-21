/**
 * /admin ダッシュボードページ (Phase 22.21.36, 22.21.42 で再構成)
 *
 * 管理者 (staff.app_role='admin') 専用の操作集約ページ。
 * 各操作をカード/タイル形式でリンク表示するハブ。具体的な機能は
 * 子ページ (/admin/staff, /imports/legalon, /master/*, /search/* …) に分割。
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
  transition: background .15s, border-color .15s;
}
.tile:hover { background: #f3f4f6; }
.tile .title { font-weight: 700; font-size: 14px; }
.tile .desc  { color: #6b7280; font-size: 12px; margin-top: 4px; }
.tile .arrow { float: right; color: #9ca3af; font-weight: 700; }
.tile.users  { border-left-color: #9333ea; }
.tile.import { border-left-color: #2563eb; }
.tile.master { border-left-color: #16a34a; }
.tile.search { border-left-color: #d97706; }
.tile.preview { border-left-color: #db2777; }
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

    <!-- ==== 1. ユーザー権限管理 ==== -->
    <section class="card">
      <h2>👥 ユーザー権限管理</h2>
      <p class="muted">
        staff の admin / viewer ロールを切り替えます。誤操作防止のため
        昇格・降格は専用サブページに集約しています。
      </p>
      <div class="grid-2">
        <a class="tile users" href="/admin/staff">
          <div class="title">スタッフ権限管理 <span class="arrow">→</span></div>
          <div class="desc">staff 一覧と admin/viewer 切替ボタン</div>
        </a>
      </div>
    </section>

    <!-- ==== 2. データ取り込み (Imports) ==== -->
    <section class="card">
      <h2>📥 データ取り込み</h2>
      <p class="muted">大量データを CSV で一括登録します。すべて Dry Run プレビュー付き。</p>
      <div class="grid-2">
        <a class="tile import" href="/imports/legalon">
          <div class="title">📋 LegalOn 契約台帳 <span class="arrow">→</span></div>
          <div class="desc">過去の契約 (CloudSign / Drive / 紙) を contract_capabilities へ一括登録</div>
        </a>
        <a class="tile import" href="/imports/vendor">
          <div class="title">🏢 取引先マスタ <span class="arrow">→</span></div>
          <div class="desc">vendor_code をキーに upsert。3 種の重複モードに対応</div>
        </a>
      </div>
    </section>

    <!-- ==== 3. マスター管理 (search-api 内 CRUD) ==== -->
    <section class="card">
      <h2>🗂️ マスター CRUD</h2>
      <p class="muted">個別レコードの追加・編集・削除。一括登録は上記「データ取り込み」を利用。</p>
      <div class="grid-2">
        <a class="tile master" href="/master/staff">
          <div class="title">👤 スタッフマスタ <span class="arrow">→</span></div>
          <div class="desc">staff CRUD + CSV 取込 (経営管理本部・法務のみ)</div>
        </a>
        <a class="tile master" href="/master/vendors">
          <div class="title">🏢 取引先マスタ <span class="arrow">→</span></div>
          <div class="desc">vendors CRUD (個別 1 件単位)</div>
        </a>
        <a class="tile master" href="/master/contracts">
          <div class="title">📜 契約マスタ <span class="arrow">→</span></div>
          <div class="desc">contract_capabilities 詳細表示・LegalOn 統合</div>
        </a>
      </div>
    </section>

    <!-- ==== 4. 検索ポータル (admin/viewer 共通) ==== -->
    <section class="card">
      <h2>🔍 検索ポータル (admin / viewer 共通)</h2>
      <p class="muted">
        viewer ユーザーが利用する検索機能。admin もここから直接 検索可能です。
        viewer ユーザーへの案内ページを確認する場合は「Viewer 用ポータルを開く」を使用。
      </p>
      <div class="grid-2">
        <a class="tile search" href="/search/vendor">
          <div class="title">🔎 取引先・契約検索 <span class="arrow">→</span></div>
          <div class="desc"><code>/search/vendor?q=&lt;取引先名&gt;</code> — 取引先名や契約類型から</div>
        </a>
        <a class="tile search" href="javascript:void(0)" onclick="promptRingi();return false;">
          <div class="title">📋 稟議番号検索 <span class="arrow">→</span></div>
          <div class="desc"><code>/search/ringi/00001</code> — 5 桁の稟議番号で詳細表示</div>
        </a>
        <a class="tile preview" href="/?preview=viewer" target="_blank" rel="noopener">
          <div class="title">👁️ Viewer 用ポータルを開く <span class="arrow">↗</span></div>
          <div class="desc">別タブで開く — viewer ロールのユーザーが見るランディングページを確認</div>
        </a>
      </div>
    </section>
  </div>

  <script>
    function promptRingi() {
      const v = prompt('稟議番号 (5 桁の数字) を入力してください', '00001');
      if (!v) return;
      const trimmed = String(v).trim();
      if (!/^\\d{1,5}$/.test(trimmed)) {
        alert('5 桁以内の数字で入力してください');
        return;
      }
      // 5 桁ゼロ詰め
      const padded = trimmed.padStart(5, '0');
      window.location.href = '/search/ringi/' + padded;
    }
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
