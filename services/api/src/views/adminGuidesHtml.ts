/**
 * adminGuidesHtml — /admin/guides ガイド管理(一覧)ページ。
 *
 * 管理対象軸 MECE 再編の「ポータル & ガイド」束に対応する管理者画面。
 * pass1(release/api)では読取専用:
 *   - カテゴリ別にガイドの 公開状況(公開中/準備中)・版数・現行版・運用フラグを一覧
 *   - 各ガイドの配信プレビュー(/g/:key)・カテゴリ(/c/:cat)へ導線
 * 差し替え(新版アップロード・公開トグル・並べ替え)は pass2(worker, release/worker)で
 *   本ページを編集可能化する。ここではその予定をバナーで示す。
 *
 * 認可は server.ts 側で requireAppRole({allowedRoles:["admin"]}) を適用済み。
 */

import { popPage } from "./popChrome.ts";
import type { GuideAdminRow } from "../services/portalGuideService.ts";

const esc = (s: unknown): string =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const EXTRA_CSS = `<style>
.gd-sec{margin-bottom:22px}
.gd-sec h2{font-size:14px;font-weight:800;margin:0 0 4px;color:var(--ink);display:flex;align-items:center;gap:8px}
.gd-sec .muted{font-size:12px;margin-bottom:10px}
.gd-banner{display:flex;gap:10px;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#efeaff,#f6f3ff);border:1px solid #e2dbfb;border-radius:14px;padding:11px 15px;margin-bottom:16px;font-size:12.5px;color:#241f3a;font-weight:600}
.gd-table{width:100%;border-collapse:collapse;font-size:12.5px;background:#fff;border:1px solid var(--line);border-radius:var(--radius-sm);overflow:hidden}
.gd-table th{background:#f4f1fb;color:var(--ink);text-align:left;font-weight:800;padding:8px 11px;font-size:11.5px;white-space:nowrap}
.gd-table td{padding:8px 11px;border-top:1px solid var(--line);vertical-align:middle}
.gd-table tr:hover td{background:#faf8ff}
.gd-key{font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;color:var(--muted)}
.gd-title{font-weight:700;color:var(--ink)}
.pill{display:inline-block;font-size:10.5px;font-weight:800;border-radius:999px;padding:2px 9px;white-space:nowrap}
.p-pub{background:#e4f7f1;color:#0d6b4e}.p-soon{background:#fef3e2;color:#7a4d09}.p-rt{background:#ffe9ef;color:#a3243e}
.gd-actions a{font-size:11.5px;font-weight:700;color:#6c5ce7;text-decoration:none;margin-right:10px}
.gd-actions a:hover{text-decoration:underline}
.gd-actions a.disabled{color:var(--muted);pointer-events:none}
</style>`;

function statusPill(row: GuideAdminRow): string {
  if (row.linkPath) return '<span class="pill p-pub">検索へ</span>';
  if (row.ready) return '<span class="pill p-pub">公開中</span>';
  return '<span class="pill p-soon">準備中</span>';
}

export function adminGuidesPage(opts: { rows: GuideAdminRow[] }): string {
  const rows = opts.rows;
  const published = rows.filter((r) => r.ready).length;
  const total = rows.length;

  // カテゴリ(ラベル)ごとにグルーピング。overview は先頭に独立表示。
  const groups = new Map<string, GuideAdminRow[]>();
  for (const r of rows) {
    const k = r.isOverview ? "ご利用案内" : r.categoryLabel || "（未分類）";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const renderRow = (r: GuideAdminRow): string => {
    const previewHref = r.linkPath
      ? esc(r.linkPath)
      : r.ready
      ? `/g/${esc(r.guideKey)}`
      : "javascript:void(0)";
    const catHref = r.categoryKey ? `/c/${esc(r.categoryKey)}` : "/portal";
    const ver = r.linkPath
      ? `リンク → ${esc(r.linkPath)}`
      : r.currentVersionNo != null
      ? `v${r.currentVersionNo} / 全${r.versionCount}版`
      : `— / 全${r.versionCount}版`;
    const rt = r.needsRuntime ? ' <span class="pill p-rt" title="GAS ランタイム依存。配信は可だが対話部分は要改修">要改修</span>' : "";
    return `<tr>
      <td><div class="gd-title">${esc(r.title)}${rt}</div><div class="gd-key">${esc(r.guideKey)}・GUIDE ${esc(r.guideNum)}</div></td>
      <td>${statusPill(r)}</td>
      <td>${esc(ver)}</td>
      <td class="gd-actions">
        <a href="${previewHref}"${r.ready ? "" : ' class="disabled"'} ${r.ready ? 'target="_blank" rel="noopener"' : ""}>配信プレビュー ↗</a>
        <a href="${catHref}" target="_blank" rel="noopener">カテゴリ</a>
      </td>
    </tr>`;
  };

  const sections = Array.from(groups.entries())
    .map(([label, list]) => {
      const body = list.map(renderRow).join("");
      return `<section class="gd-sec">
        <h2>${esc(label)}</h2>
        <table class="gd-table">
          <thead><tr><th>ガイド</th><th>状態</th><th>版</th><th>操作</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </section>`;
    })
    .join("");

  const body = `
  <div class="gd-banner">
    <span>📚 ガイド本文の<strong>差し替え</strong>（新版アップロード・公開切替・並べ替え）は worker 連携（pass2）で本画面に実装予定です。現在は<strong>公開状況の確認</strong>と<strong>配信プレビュー</strong>に対応しています。</span>
  </div>
  <div class="gd-sec" style="margin-bottom:14px">
    <div class="muted">公開中 <strong>${published}</strong> / 全 <strong>${total}</strong> ガイド。準備中はガイド本文(<code>services/api/guides/&lt;key&gt;.html</code>)を配置し同期すると公開中になります。</div>
  </div>
  ${sections}`;

  return popPage({
    active: "guides",
    role: "admin",
    mode: "admin",
    title: "ガイド管理",
    subtitle: "法務ポータル — ポータル & ガイド",
    body,
    headExtra: EXTRA_CSS,
    pageTitle: "LegalBridge ガイド管理",
  });
}
