/**
 * portalRender — GAS(Google Apps Script)用に書かれた法務ポータルのガイド HTML を、
 * search-api(Cloud Run / Express)配信用に変換する。
 *
 * 移植元: legalbridge(GAS 移行版) lib/render.js。DB(portal_guide_versions.html_source)
 *   に GAS 原文をそのまま保存し、配信時に本モジュールで変換する(原文は不変)。
 *
 * 主な変換:
 *   - <?!= include('common_top_tabs', {...}) ?> → 右下「ポータルへ」フローティングボタン
 *   - <?= appUrl ?>?page=KEY → /g/KEY(ガイド間リンク)。ただし page=portal は /portal。
 *   - GAS exec URL(?page=KEY 付き/素)→ /g/KEY または /portal
 *   - {{JURISDICTION}} 等の env プレースホルダを環境変数で差し替え
 *   - 取りこぼした GAS スクリプトレットを除去
 */

// 「ポータルへ戻る」フローティングボタン(common_top_tabs インクルードの置換先)。
//   遷移先はポータルトップ /portal。既存ガイドの .portal-back-button と衝突しないよう独自クラス。
const TOP_TABS = `<a href="/portal" class="lb-home-btn" aria-label="ポータルへ戻る" style="position:fixed;right:16px;bottom:16px;z-index:3000;display:inline-flex;align-items:center;gap:6px;padding:9px 15px;border-radius:999px;background:#1d3557;color:#fff;text-decoration:none;font-size:12px;font-weight:700;box-shadow:0 3px 12px rgba(0,0,0,.22)">← ポータル</a>`;

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

// ガイドではない page ターゲットの遷移先(レジストリ外)。
//   knowledge ガイド等の <?= appUrl ?>?page=portal → /portal にマップ。
//   related_party_tool 等の対話アプリは現状ガイドから除外済みだが、将来 page=*_tool が
//   混じってもガイド扱い(/g/...)にしないよう、ここに追記して制御する。
const PAGE_TARGET_OVERRIDES: Record<string, string> = {
  portal: "/portal",
};

function pageTarget(key: string): string {
  return PAGE_TARGET_OVERRIDES[key] || `/g/${key}`;
}

export function renderGuide(rawHtml: string): string {
  let html = rawHtml;

  // 1) <?!= include('common_top_tabs', {...}) ?> → ポータルへボタン
  html = html.replace(
    /<\?!?=?\s*include\(\s*['"]common_top_tabs['"][\s\S]*?\)\s*;?\s*\?>/g,
    TOP_TABS
  );

  // 2) <?= appUrl ?>?page=KEY → /g/KEY(portal 等は特例マップ)
  html = html.replace(/<\?=\s*appUrl\s*\?>\s*\?page=([a-zA-Z_]+)/g, (_m, key) => pageTarget(key));

  // 3) 素の <?= appUrl ?> → ルート
  html = html.replace(/<\?=\s*appUrl\s*\?>/g, "");

  // 4) ハードコードされた GAS exec URL(?page=KEY 付き)→ /g/KEY(portal 等は特例)
  html = html.replace(
    /https:\/\/script\.google\.com\/[^"'\s]*?\?page=([a-zA-Z_]+)/g,
    (_m, key) => pageTarget(key)
  );

  // 5) 素の GAS exec URL → ポータルトップ(移行先が一意に定まらないものは /portal へ)
  html = html.replace(/https:\/\/script\.google\.com\/[^"'\s]*?\/exec(?=["'\s])/g, "/portal");

  // 6) DL バナー等の env プレースホルダを差し替え(未設定なら無効リンク/既定値)
  html = html.replace(/<\?=\s*serviceGuideUrl\s*\?>/g, env("SERVICE_GUIDE_URL", "#"));
  html = html.replace(/<\?=\s*licenseGuideUrl\s*\?>/g, env("LICENSE_GUIDE_URL", "#"));
  html = html.replace(/\{\{\s*GDRIVE_URL_SERVICE\s*\}\}/g, env("GDRIVE_URL_SERVICE", "#"));
  html = html.replace(/\{\{\s*GDRIVE_URL_LICENSE\s*\}\}/g, env("GDRIVE_URL_LICENSE", "#"));
  html = html.replace(/\{\{\s*JURISDICTION\s*\}\}/g, env("JURISDICTION", "東京地方裁判所"));

  // 7) ルート相対リンク href="./" → ポータルトップ
  html = html.replace(/href="\.\/"/g, 'href="/portal"');

  // 8) 取りこぼした GAS スクリプトレット <?= ... ?> / <?!= ... ?> を除去
  html = html.replace(/<\?!?=?[\s\S]*?\?>/g, "");

  return html;
}

export { TOP_TABS };
