/**
 * viewSwitch — 「通常画面 ⇄ 管理画面」切替スイッチ(admin 専用)。
 *
 * 管理 ID(app_role=admin)でログインした利用者だけに表示する想定。
 * 呼び出し側(popChrome / landingHtml / guidePortalHtml)が role 判定のうえで埋め込む。
 *   - 通常画面: viewer 体験。admin はリダイレクトされないよう /?preview=viewer へ。
 *   - 管理画面: search-api の管理コンソール /admin へ。
 *
 * インライン style で自己完結(各ページの CSS 文脈に依存しない)。active 側は非リンク。
 * accent = アクティブ側の塗り色(管理=インディゴ、ポータル/閲覧=ネイビー等、文脈に合わせる)。
 */

// 通常画面 = 法務ガイドポータル(トップ)。admin はリダイレクトされない /portal を直接指す。
const VIEWER_HREF = "/portal";
const ADMIN_HREF = "/admin";

export function viewSwitchHtml(active: "viewer" | "admin", accent = "#6c5ce7"): string {
  const base =
    "display:inline-flex;align-items:center;padding:5px 12px;font-size:11.5px;font-weight:700;" +
    "text-decoration:none;line-height:1;white-space:nowrap;letter-spacing:.02em;";
  const on = `${base}background:${accent};color:#fff;`;
  const off = `${base}background:transparent;color:#6c757d;`;

  const viewerSeg =
    active === "viewer"
      ? `<span aria-current="page" style="${on}">通常画面</span>`
      : `<a href="${VIEWER_HREF}" style="${off}">通常画面</a>`;
  const adminSeg =
    active === "admin"
      ? `<span aria-current="page" style="${on}">管理画面</span>`
      : `<a href="${ADMIN_HREF}" style="${off}">管理画面</a>`;

  return (
    `<span class="lb-view-switch" role="group" aria-label="画面切替" ` +
    `style="display:inline-flex;align-items:center;border:1px solid rgba(120,120,140,.35);` +
    `border-radius:999px;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08)">` +
    `${viewerSeg}<span style="width:1px;align-self:stretch;background:rgba(120,120,140,.25)"></span>${adminSeg}` +
    `</span>`
  );
}
