/**
 * viewer 用の案内ページ (Phase 22.21.37)
 *
 * search-api のルート / に viewer ロールのユーザーがアクセスしたときに
 * 「あなたが使える URL はここです」を案内する短い HTML ページ。
 *
 * admin は /admin にリダイレクトされるので本ページは表示されない。
 */

const STYLE = `
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif;
  margin: 0;
  padding: 32px 24px 64px;
  background: #f8fafc;
  color: #1f2937;
  font-size: 14px;
  line-height: 1.6;
}
.container { max-width: 760px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 8px; }
.muted { color: #6b7280; font-size: 12px; }
.card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 16px 20px;
  margin: 16px 0;
}
.tile {
  display: block;
  text-decoration: none;
  color: inherit;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-left: 4px solid #d97706;
  border-radius: 6px;
  padding: 12px 14px;
  margin: 8px 0;
}
.tile:hover { background: #f3f4f6; }
.tile .title { font-weight: 700; }
.tile .desc { color: #6b7280; font-size: 12px; margin-top: 4px; }
code {
  font-family: ui-monospace, monospace;
  background: #f3f4f6;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
}
.role-pill {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  background: #e5e7eb;
  color: #374151;
}
`;

function esc(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function viewerGuidePage(opts: {
  currentEmail: string | null;
  currentRole: string | null;
}): string {
  const email = opts.currentEmail || "(不明)";
  const role = opts.currentRole || "viewer";
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>LegalBridge Search Portal</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="container">
    <h1>🔍 LegalBridge Search Portal</h1>
    <div class="muted">
      ログイン: <strong>${esc(email)}</strong>
      <span class="role-pill">role: ${esc(role)}</span>
    </div>

    <div class="card">
      <p>
        あなたのアカウントは <strong>${esc(role)}</strong> ロールのため、検索機能のみご利用いただけます。
        以下の URL を直接ご利用ください。
      </p>
    </div>

    <a class="tile" href="/search/vendor">
      <div class="title">🏢 取引先・契約検索</div>
      <div class="desc">
        <code>/search/vendor?q=&lt;取引先名&gt;</code>
        — 取引先名や契約類型から検索
      </div>
    </a>

    <div class="tile" style="opacity: 0.85;">
      <div class="title">📋 稟議番号検索</div>
      <div class="desc">
        <code>/search/ringi/&lt;5桁の稟議番号&gt;</code>
        — 例: <code>/search/ringi/00001</code>
      </div>
    </div>

    <div class="card" style="background: #f9fafb; font-size: 12px;">
      <strong>取込機能 / 管理機能を使いたい場合</strong><br>
      管理者にロール変更 (app_role=admin) を依頼してください。
      管理者が <code>/admin</code> から該当ユーザーを admin に切り替えると、
      取込機能と <code>/admin</code> ダッシュボードが使えるようになります。
    </div>
  </div>
</body>
</html>`;
}
