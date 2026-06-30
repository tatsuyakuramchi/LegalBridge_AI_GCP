/**
 * popChrome — search-api のサーバーレンダリング画面共通テーマ(macOS風 × ポップ)。
 *
 * 方針:
 *   - macOS ベース(サイドバー=ソースリスト / 統一ツールバー / 角丸・ソフト影 / SF系フォント)
 *   - ポップ配色(インディゴ→バイオレットのグラデ単一アクセント・キャンディ統計カード・大きめ角丸)
 *   - admin(編集・高密度)と view(検索・閲覧)は同じシェルを共有しつつ density/見出しで差をつける。
 *
 * 使い方:
 *   import { popPage } from "./popChrome.ts";
 *   res.send(popPage({ active: "conditions", mode: "view", title: "...", body: "<...>" }));
 *
 * body にはページ固有の HTML(フィルタ/テーブル/モーダル/スクリプト)を入れる。
 * 共通コンポーネント class: .pop-toolbar .pop-btn(.sec/.ghost/.danger) .pop-seg
 *   .pop-search .pop-chip .pop-table .pop-card .pop-stat(.g-blue/g-green/g-orange/g-pink)
 *   .pop-group .pill(.corp/.ind/.ok) .pop-modal-backdrop .pop-modal などを提供。
 */

import type { Role, ScreenKey } from "../lib/screens.ts";
import { navScreensForRole, SECTION_TITLES } from "../lib/screens.ts";
import { viewSwitchHtml } from "./viewSwitch.ts";

// 後方互換: 各 view が active 指定で使う型。画面レジストリの ScreenKey に統一。
export type PopNavKey = ScreenKey;

// 管理 ID(admin)向け「通常画面 ⇄ 管理画面」切替スイッチ。管理コンソール側なので admin がアクティブ。
function viewSwitchForRole(role?: string): string {
  return role === "admin" ? viewSwitchHtml("admin", "#6c5ce7") : "";
}

const esc = (s: string) =>
  String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * 統合 Phase 1: マスタ編集は React admin-ui に一本化していくため、search-api の
 *   重複コンソール上部に「編集は admin-ui 推奨」バナーを出す。ADMIN_UI_URL が
 *   設定されているときのみ表示(未設定なら従来どおり本ページで編集)。
 *   reactPath は admin-ui 側の対応ルート(例: "/master/vendors")。
 */
export function adminUiEditBanner(reactPath: string): string {
  const base = (process.env.ADMIN_UI_URL || "").replace(/\/+$/, "");
  if (!base) return "";
  const href = base + reactPath;
  return `<a href="${esc(href)}" target="_blank" rel="noopener"
    style="display:flex;gap:10px;align-items:center;justify-content:space-between;
      background:linear-gradient(135deg,#efeaff,#f6f3ff);border:1px solid #e2dbfb;
      border-radius:14px;padding:11px 15px;margin-bottom:14px;text-decoration:none;color:#241f3a;font-weight:700;font-size:12.5px">
    <span>🖥 このマスタの<strong>編集</strong>は admin-ui に移行中です。admin-ui で開く方が高機能です。</span>
    <span style="color:#6c5ce7;font-weight:800">admin-ui で開く ↗</span>
  </a>`;
}

export const POP_CSS = `
:root{
  --accent:#6c5ce7; --accent2:#a29bfe; --accent-press:#5a4bd6;
  --bg:#f4f1fb; --content:#ffffff; --sidebar:rgba(255,255,255,.72);
  --ink:#241f3a; --muted:#8a86a3; --line:#ece8f6; --hover:#f6f3ff;
  --radius:18px; --radius-sm:12px;
  --shadow:0 2px 6px rgba(90,70,180,.08),0 14px 34px rgba(90,70,180,.12);
  --pink:#ff6b81; --orange:#ff9f43; --green:#1dd1a1; --blue:#54a0ff; --purple:#a55eea; --teal:#00d2d3;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:-apple-system,"SF Pro Rounded","SF Pro Text","Hiragino Maru Gothic ProN","Hiragino Sans",system-ui,sans-serif;
  background:radial-gradient(1200px 500px at 85% -10%,#ffe9f2 0,transparent 60%),radial-gradient(1000px 480px at -10% 0,#e7f7ff 0,transparent 55%),var(--bg);
  color:var(--ink);font-size:13.5px;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.pop-shell{display:grid;grid-template-columns:230px 1fr;min-height:100vh}
/* sidebar */
.pop-side{background:var(--sidebar);backdrop-filter:saturate(180%) blur(20px);border-right:1px solid var(--line);padding:0 0 16px;position:sticky;top:0;height:100vh;overflow:auto}
.pop-brand{padding:16px 18px 6px;font-weight:300;font-size:19px;letter-spacing:.01em}
.pop-brand b{font-weight:800}
.pop-side-title{font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;padding:14px 18px 4px}
.pop-nav{list-style:none}
.pop-nav a{display:flex;align-items:center;gap:10px;padding:9px 13px;margin:3px 10px;border-radius:14px;font-weight:600;color:var(--ink)}
.pop-nav a:hover{background:var(--hover)}
.pop-nav a.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;box-shadow:0 6px 16px rgba(108,92,231,.32)}
.pop-nav a .ic{width:20px;text-align:center;font-size:15px}
.pop-nav a .badge{margin-left:auto;font-size:11px;font-weight:800;background:#efeaff;color:#6c5ce7;border-radius:20px;padding:1px 9px}
.pop-nav a.on .badge{background:rgba(255,255,255,.35);color:#fff}
/* main */
.pop-main{display:flex;flex-direction:column;min-width:0;overflow-x:clip}
.pop-toolbar{display:flex;align-items:center;gap:10px;padding:14px 22px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.75);backdrop-filter:blur(20px);position:sticky;top:0;z-index:20;flex-wrap:wrap}
.pop-toolbar h1{font-size:17px;font-weight:800}
.pop-toolbar .sub{color:var(--muted);font-size:12px}
.pop-toolbar .sp{flex:1}
.pop-body{padding:20px;overflow:auto;min-width:0}
/* buttons */
.pop-btn{border:0;border-radius:12px;padding:8px 16px;font:inherit;font-size:12.5px;font-weight:800;cursor:pointer;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent2));box-shadow:0 6px 14px rgba(108,92,231,.3);display:inline-flex;align-items:center;gap:6px}
.pop-btn:hover{filter:brightness(1.05)} .pop-btn:active{transform:translateY(1px)}
.pop-btn.sec{background:#fff;color:var(--accent);border:2px solid #e2dbfb;box-shadow:none}
.pop-btn.ghost{background:#efeaff;color:#6c5ce7;box-shadow:none}
.pop-btn.danger{background:linear-gradient(135deg,#ff7a8a,#ff5b78)}
.pop-btn[disabled]{background:#ece9f6;color:#bdb8d4;box-shadow:none;cursor:not-allowed}
.pop-btn.sm{padding:6px 11px;font-size:11.5px}
/* segmented */
.pop-seg{display:flex;background:#efeaff;border-radius:12px;padding:3px}
.pop-seg button{border:0;background:transparent;font:inherit;font-size:12px;font-weight:700;padding:6px 14px;border-radius:10px;cursor:pointer;color:#6c5ce7}
.pop-seg button.on{background:#fff;box-shadow:0 2px 6px rgba(108,92,231,.2)}
/* search + chips */
.pop-search{display:flex;align-items:center;gap:10px;background:#fff;border:2px solid #e2dbfb;border-radius:16px;padding:13px 16px;box-shadow:0 6px 18px rgba(108,92,231,.10)}
.pop-search:focus-within{border-color:var(--accent)}
.pop-search input{flex:1;border:0;outline:none;font:inherit;font-size:16px;background:transparent}
.pop-search .mag{color:var(--accent);font-size:18px}
.pop-chip{border:2px solid #e6e2f4;background:#fff;border-radius:20px;padding:6px 14px;font-size:12.5px;font-weight:700;cursor:pointer;color:#6b6786}
.pop-chip.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border-color:transparent;box-shadow:0 6px 14px rgba(108,92,231,.3)}
/* stat cards */
.pop-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-bottom:18px}
.pop-stat{border-radius:var(--radius);padding:16px 18px;color:#fff;box-shadow:0 8px 20px rgba(0,0,0,.10)}
.pop-stat .n{font-size:30px;font-weight:800;line-height:1} .pop-stat .l{font-weight:700;opacity:.95;margin-top:4px;font-size:12.5px}
.g-blue{background:linear-gradient(135deg,#54a0ff,#5f8bff)} .g-green{background:linear-gradient(135deg,#1dd1a1,#10ac84)}
.g-orange{background:linear-gradient(135deg,#feca57,#ff9f43)} .g-pink{background:linear-gradient(135deg,#ff9a9e,#ff6b81)}
.g-purple{background:linear-gradient(135deg,#a55eea,#8854d0)}
/* groups / tables */
.pop-group{background:#fff;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;box-shadow:0 2px 8px rgba(90,70,180,.05)}
.pop-card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:16px;box-shadow:0 2px 8px rgba(90,70,180,.05)}
table.pop-table{width:100%;border-collapse:collapse;font-size:13px;background:#fff}
table.pop-table th{text-align:left;color:var(--muted);font-weight:800;font-size:11.5px;letter-spacing:.03em;padding:10px 13px;border-bottom:1px solid var(--line);background:#faf8ff;position:sticky;top:0}
table.pop-table td{padding:9px 13px;border-bottom:1px solid var(--line);vertical-align:top}
table.pop-table td.num{text-align:right;font-variant-numeric:tabular-nums}
table.pop-table td.wrap{white-space:normal;min-width:140px}
table.pop-table tr.clickable{cursor:pointer}
table.pop-table tbody tr:hover td{background:var(--hover)}
.pop-tablewrap{overflow:auto;max-height:calc(100vh - 260px);border:1px solid var(--line);border-radius:var(--radius);background:#fff}
/* pills / result rows */
.pill{display:inline-block;font-size:11px;font-weight:800;padding:2px 10px;border-radius:20px;white-space:nowrap}
.pill.corp{background:#e6f0ff;color:#2f6fed} .pill.ind{background:#fff0e6;color:#e8810f} .pill.ok{background:#dffbf0;color:#0fa97c}
.pill.mg{background:#fff4d6;color:#a9700a} .pill.adv{background:#ffe6ef;color:#c43c63} .pill.muted{background:#efedf6;color:#7b7796}
.pop-result{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:15px 18px;margin-bottom:12px;display:flex;gap:14px;align-items:flex-start;box-shadow:0 2px 8px rgba(90,70,180,.05)}
.pop-result:hover{box-shadow:var(--shadow)}
.pop-result .tag{width:8px;align-self:stretch;border-radius:8px;background:var(--muted)}
/* modal */
.pop-modal-backdrop{position:fixed;inset:0;background:rgba(36,31,58,.4);backdrop-filter:blur(3px);display:none;align-items:flex-start;justify-content:center;padding:48px 16px;z-index:60;overflow:auto}
.pop-modal-backdrop.open{display:flex}
.pop-modal{background:#fff;border-radius:var(--radius);width:100%;max-width:560px;box-shadow:0 24px 60px rgba(40,20,90,.3)}
.pop-modal .mhead{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line)}
.pop-modal .mhead h3{margin:0;font-size:16px;font-weight:800}
.pop-modal .mbody{padding:18px 20px}
.pop-modal .mfoot{display:flex;gap:8px;justify-content:flex-end;padding:14px 20px;border-top:1px solid var(--line)}
.pop-modal .xbtn{background:none;border:0;font-size:22px;cursor:pointer;color:var(--muted)}
/* filters / forms */
.pop-filters{display:grid;gap:10px 14px;align-items:end;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;margin-bottom:14px;box-shadow:0 2px 8px rgba(90,70,180,.05)}
.pop-filters .f{display:flex;flex-direction:column;gap:4px;min-width:0}
.pop-filters label{font-size:11px;color:var(--muted);font-weight:800}
.pop-filters .range{display:flex;gap:6px;align-items:center;min-width:0}
/* 日付入力等が縮まず本文を押し広げてサイドバーが横へ消える崩れを防ぐ。 */
.pop-filters input,.pop-filters select,.pop-filters .pop-input,.pop-filters .pop-select{min-width:0;max-width:100%}
.pop-input,.pop-select{border:1.5px solid #e2dbfb;border-radius:10px;background:#fff;padding:8px 10px;font:inherit;font-size:13px;color:var(--ink);outline:none}
.pop-input:focus,.pop-select:focus{border-color:var(--accent)}
.pop-toolbar2{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.count-badge{font-size:12px;font-weight:800;color:var(--accent);background:#efeaff;border-radius:20px;padding:4px 12px}
.empty{color:var(--muted);padding:24px;text-align:center}
th.chk,td.chk{width:34px;text-align:center}
.muted{color:var(--muted)}
`;

export const POP_HEAD = `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">`;

/**
 * POP_ADMIN_BRIDGE — masterChrome.ts(レトロフューチャー)の既存クラス名をそのまま
 *   pop(macOS風)の見た目に上書きするブリッジ CSS。
 *
 *   admin 系ページは本文マークアップ(.btn / .card / .tech-input / .modal …)を
 *   変えずに、chrome を popAdminPage() のサイドバーシェルへ載せ替えるだけで
 *   pop デザインに移行できる。MASTER_CSS の後に読み込む前提。
 *
 *   レトロ要素(等幅フォント・全大文字・字間広め・▍プレフィックス・角無し)を
 *   打ち消し、角丸・ソフト影・グラデアクセントへ寄せる。
 */
export const POP_ADMIN_BRIDGE = `
/* fonts: 等幅レトロ → 丸ゴシック pop */
.crumb-title,.crumb-sub,.crumb-arcs,.retro-tag,.page-title,.page-desc,.tab,.btn,.count-badge,
.search input,.card-name,.card-sub,.badge,.loading,.modal-tag,.modal-title,.tech-label,
.tech-input,.tech-select,.tech-textarea,.field-help,.checkbox-row label,.import-card h3,
.import-card .desc,.file-input-wrap input,.stat .label,.stat .value,.error-list,.toast{
  font-family:-apple-system,"SF Pro Rounded","SF Pro Text","Hiragino Maru Gothic ProN","Hiragino Sans",system-ui,sans-serif!important;
}
/* page header */
.page-header{border-bottom:1px solid var(--line);padding:18px 0 16px;margin-bottom:18px}
.retro-tag{text-transform:none;letter-spacing:.02em;color:var(--accent);font-weight:800;font-size:11px}
.retro-tag::before{content:"";margin:0}
h2.page-title{font-size:22px;font-weight:800;letter-spacing:0;color:var(--ink)}
.page-desc{text-transform:none;letter-spacing:0;color:var(--muted);font-size:12.5px}
/* buttons → pop */
.btn{border:0;border-radius:12px;padding:8px 16px;font-size:12.5px;font-weight:800;text-transform:none;
  letter-spacing:.01em;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent2));
  box-shadow:0 6px 14px rgba(108,92,231,.3)}
.btn:hover{background:linear-gradient(135deg,var(--accent),var(--accent2));filter:brightness(1.05)}
.btn:active{transform:translateY(1px)}
.btn.outline{background:#fff;color:var(--accent);border:2px solid #e2dbfb;box-shadow:none}
.btn.outline:hover{background:var(--hover);border-color:#e2dbfb}
.btn.ghost{background:#efeaff;color:var(--accent);border:0;box-shadow:none}
.btn.ghost:hover{background:#e6dffb}
.btn.danger{background:linear-gradient(135deg,#ff7a8a,#ff5b78);border:0;color:#fff}
.btn.sm{padding:6px 11px;font-size:11.5px;border-radius:10px}
.btn svg{width:13px;height:13px}
/* toolbar / search / count */
.search input{height:40px;border-radius:14px;border:2px solid #e2dbfb;background:#fff;font-size:14px;
  padding:0 12px 0 36px;color:var(--ink)}
.search input:focus{border-color:var(--accent);box-shadow:none}
.search svg{color:var(--accent);width:16px;height:16px}
.count-badge{text-transform:none;letter-spacing:.01em;color:var(--accent);background:#efeaff;
  border-radius:20px;padding:4px 12px;font-size:12px;font-weight:800}
/* tabs(残っていても pop ピル化) */
.tabs{border-bottom:1px solid var(--line);gap:6px}
.tab{text-transform:none;letter-spacing:.01em;font-weight:700;font-size:12.5px;border-radius:12px 12px 0 0;
  color:var(--muted)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
/* cards */
.grid{gap:14px}
.card{border:1px solid var(--line);border-radius:var(--radius);padding:16px;box-shadow:0 2px 8px rgba(90,70,180,.05);
  background:#fff;transition:box-shadow .15s,transform .15s}
.card:hover{border-color:#e2dbfb;box-shadow:var(--shadow);transform:translateY(-2px)}
.card-head svg{color:var(--accent)}
.card-name{text-transform:none;letter-spacing:0;font-weight:800;font-size:14px;color:var(--ink)}
.card-sub{text-transform:none;letter-spacing:.01em;color:var(--muted);font-size:11.5px}
/* badges → pop pill */
.badge{height:auto;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:800;text-transform:none;
  letter-spacing:.01em;border:0;background:#efedf6;color:#7b7796}
.badge.corp{background:#e6f0ff;color:#2f6fed} .badge.ind{background:#fff0e6;color:#e8810f}
.badge.inv,.badge.success{background:#dffbf0;color:#0fa97c} .badge.warn{background:#fff4d6;color:#a9700a}
.badge.error{background:#ffe6ef;color:#c43c63}
/* empty / loading */
.empty,.loading{text-transform:none;letter-spacing:.02em;color:var(--muted);border-radius:var(--radius)}
.empty{border:1px dashed var(--line)}
/* modal → pop */
.modal-backdrop{background:rgba(36,31,58,.4);backdrop-filter:blur(3px)}
.modal{border:0;border-radius:var(--radius);box-shadow:0 24px 60px rgba(40,20,90,.3)}
.modal::before,.modal::after{display:none}
.modal-header,.modal-footer{border-color:var(--line)}
.modal-tag{text-transform:none;letter-spacing:.02em;color:var(--accent);font-weight:800}
.modal-tag::before{content:"";margin:0}
.modal-title{text-transform:none;letter-spacing:0;font-weight:800;font-size:16px;color:var(--ink)}
/* form fields → pop */
.tech-label{text-transform:none;letter-spacing:.01em;color:var(--muted);font-weight:800;font-size:11.5px}
.tech-input,.tech-select,.tech-textarea{border:1.5px solid #e2dbfb;border-radius:10px;font-size:13px;color:var(--ink);background:#fff}
.tech-input:focus,.tech-select:focus,.tech-textarea:focus{border-color:var(--accent);box-shadow:none}
.tech-input:read-only{background:#f6f3ff;color:var(--muted)}
.field-help{text-transform:none;letter-spacing:0;color:var(--muted);font-size:10.5px}
.checkbox-row label{text-transform:none;letter-spacing:0;color:var(--ink)}
.checkbox-row input[type=checkbox]{accent-color:var(--accent)}
.section-head{border-top:1px solid var(--line)}
.section-head .retro-tag{color:var(--accent)}
/* import / stats */
.import-card{border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 2px 8px rgba(90,70,180,.05)}
.import-card h3{text-transform:none;letter-spacing:.01em;color:var(--ink);border-color:var(--line);font-weight:800}
.import-card h3::before{content:"";color:var(--accent)}
.import-card .desc{text-transform:none;letter-spacing:0;color:var(--muted)}
.stat{background:#faf8ff;border:1px solid var(--line);border-radius:var(--radius-sm)}
.stat .label{text-transform:none;letter-spacing:.02em;color:var(--muted)}
.stat .value{color:var(--ink);font-weight:800}
.stat.ok .value{color:#0fa97c} .stat.warn .value{color:#a9700a} .stat.err .value{color:#c43c63}
/* toast → pop */
.toast{border:0;border-radius:14px;text-transform:none;letter-spacing:.01em;font-weight:800;
  background:#fff;color:var(--ink);box-shadow:var(--shadow)}
.toast::before{content:"";margin:0}
.toast.success{color:#0fa97c} .toast.error{color:#c43c63}
`;

/**
 * POP_CONTENT_BRIDGE — masterChrome を使わない独自CSSページ(取込・作品モデル・
 *   検索結果・案内 等)の「本文」要素を pop トークンに揃えるブリッジ。
 *
 *   すべて `.pop-body` 配下にスコープし、レイアウト(grid/flex/列幅)には触れず
 *   見た目(色・角丸・枠・影・余白の一部)だけを上書きする。popPage の <style>
 *   では headExtra(ページ固有CSS)の「後」に読み込むことで確実に勝たせる。
 *   (contentBridge:true を渡したページにのみ適用)
 */
export const POP_CONTENT_BRIDGE = `
/* buttons */
.pop-body .btn,.pop-body button:not(.x):not(.xbtn):not([class*=pop-]){
  border:0;border-radius:12px;padding:8px 16px;font:inherit;font-size:12.5px;font-weight:800;
  color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent2));
  box-shadow:0 6px 14px rgba(108,92,231,.3);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.pop-body .btn:hover,.pop-body button:not(.x):not(.xbtn):not([class*=pop-]):hover{filter:brightness(1.05)}
.pop-body .btn:active,.pop-body button:not(.x):not(.xbtn):not([class*=pop-]):active{transform:translateY(1px)}
.pop-body .btn.secondary,.pop-body .btn.outline,.pop-body button.secondary,.pop-body button.outline{
  background:#fff;color:var(--accent);border:2px solid #e2dbfb;box-shadow:none}
.pop-body .btn.ghost,.pop-body button.ghost{background:#efeaff;color:var(--accent);box-shadow:none;border:0}
.pop-body .btn.danger,.pop-body button.danger{background:linear-gradient(135deg,#ff7a8a,#ff5b78)}
.pop-body .btn.sm,.pop-body button.sm{padding:6px 11px;font-size:11.5px;border-radius:10px}
.pop-body button[disabled],.pop-body .btn[disabled]{background:#ece9f6;color:#bdb8d4;box-shadow:none;cursor:not-allowed}
/* inputs */
.pop-body input:not([type=checkbox]):not([type=radio]):not([type=file]),
.pop-body select,.pop-body textarea{
  border:1.5px solid #e2dbfb;border-radius:10px;padding:8px 10px;font:inherit;font-size:13px;
  background:#fff;color:var(--ink)}
.pop-body input:focus,.pop-body select:focus,.pop-body textarea:focus{outline:none;border-color:var(--accent)}
.pop-body input[type=checkbox],.pop-body input[type=radio]{accent-color:var(--accent)}
/* cards / sections */
.pop-body .card,.pop-body .vendor-card,.pop-body section.card{
  background:#fff;border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 2px 8px rgba(90,70,180,.05)}
.pop-body .tile{border-radius:var(--radius);box-shadow:0 2px 8px rgba(90,70,180,.05)}
.pop-body .tile:hover{box-shadow:var(--shadow)}
/* modal(workModel 等) */
.pop-body .backdrop{background:rgba(36,31,58,.4);backdrop-filter:blur(3px)}
.pop-body .modal{border:0;border-radius:var(--radius);box-shadow:0 24px 60px rgba(40,20,90,.3)}
.pop-body .modal .mhead,.pop-body .modal .mfoot{border-color:var(--line)}
/* pills / badges */
.pop-body .badge,.pop-body .role-pill,.pop-body .pill{border-radius:20px;font-weight:800}
/* tables */
.pop-body table th{background:#faf8ff;color:var(--muted);font-weight:800}
.pop-body table th,.pop-body table td{border-color:var(--line)}
/* misc */
.pop-body h1,.pop-body h2,.pop-body h3{color:var(--ink)}
.pop-body .muted{color:var(--muted)}
.pop-body code{background:#f4f1fb;border-radius:6px;padding:1px 6px}
.pop-body .footer{color:var(--muted)}
`;

/**
 * サイドバーをログイン者の役割で生成する (Phase 25)。
 *
 * 旧 navGroups("all"/"view") を廃止し、画面レジストリ(screens.ts)を
 * role でフィルタして描画する。これにより「ページごとにナビが変わる」
 * 「viewer に admin リンクが漏れる」問題が解消する。console セクションは
 * admin のみに項目が出るため、viewer では自然に非表示になる。
 */
function navHtml(active: PopNavKey, role: Role, deptCode?: string | null): string {
  const section = (key: "console" | "browse") => {
    const screens = navScreensForRole(role, key, deptCode);
    if (screens.length === 0) return "";
    const items = screens
      .map(
        (s) =>
          `<a class="${s.key === active ? "on" : ""}" href="${s.path}"><span class="ic">${s.icon}</span>${esc(s.label)}</a>`
      )
      .join("");
    return `<div class="pop-side-title">${SECTION_TITLES[key]}</div>
    <nav class="pop-nav">${items}</nav>`;
  };
  return `
  <aside class="pop-side">
    <div class="pop-brand">ARCS <b>Legal OS</b></div>
    ${section("console")}
    ${section("browse")}
  </aside>`;
}

// ツールバー左の「← 戻る」ボタン。履歴があれば戻る、無ければ検索ポータル(/)へ。
function backBtnHtml(): string {
  return `<button type="button" class="pop-btn sec sm" title="前のページへ戻る" style="margin-right:6px;" onclick="if(window.history.length>1){window.history.back()}else{window.location.href='/'}">← 戻る</button>`;
}

// admin でログインしているときだけ表示する「管理画面へ」リンク(React admin-ui)。
//   ADMIN_UI_URL(env)が設定されている場合のみ表示。
function adminLinkHtml(role?: string): string {
  const url = (process.env.ADMIN_UI_URL || "").replace(/\/+$/, "");
  if (role !== "admin" || !url) return "";
  return `<a class="pop-btn sm" href="${url}" title="管理画面(admin-ui)へ" style="margin-left:6px;text-decoration:none;">管理画面へ ↗</a>`;
}

export function popPage(opts: {
  active: PopNavKey;
  mode?: "admin" | "view";
  title: string;
  subtitle?: string;
  toolbar?: string; // ツールバー右側に置く HTML(ボタン等)
  body: string;
  headExtra?: string; // ページ固有 <style> 等
  pageTitle?: string;
  role?: Role; // ログイン者の役割。サイドバーをこの役割で絞る(既定 viewer)。
  deptCode?: string | null; // ログイン者の部署コード。departments 指定画面の表示判定に使う。
  contentBridge?: boolean; // 独自CSSページの本文要素を pop に揃える(headExtra の後に適用)
}): string {
  const titleTag = opts.pageTitle || `${opts.title} · Arcs Legal OS`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
${POP_HEAD}
<title>${esc(titleTag)}</title>
<style>${POP_CSS}</style>
${opts.headExtra || ""}
${opts.contentBridge ? `<style>${POP_CONTENT_BRIDGE}</style>` : ""}
</head>
<body>
<div class="pop-shell">
${navHtml(opts.active, opts.role || "viewer", opts.deptCode)}
  <div class="pop-main">
    <div class="pop-toolbar">
      ${backBtnHtml()}
      <h1>${esc(opts.title)}</h1>
      ${opts.subtitle ? `<span class="sub">${esc(opts.subtitle)}</span>` : ""}
      <span class="sp"></span>
      ${viewSwitchForRole(opts.role)}
      ${adminLinkHtml(opts.role)}
      ${opts.toolbar || ""}
    </div>
    <div class="pop-body">
${opts.body}
    </div>
  </div>
</div>
</body>
</html>`;
}

/**
 * popAdminPage — masterChrome 由来の本文(レガシークラス)を pop シェルに載せる。
 *
 *   MASTER_CSS + POP_CSS + POP_ADMIN_BRIDGE の順で読み込み、本文のクラス名は
 *   そのままに pop デザインへ上書きする。topbar / tabs は不要(サイドバーが代替)。
 *
 *   既存ページの移行手順:
 *     1. import { popAdminPage } from "./popChrome.ts";
 *     2. topbarHtml(...) / masterTabsHtml(...) / pageHeaderHtml(...) を本文から外す
 *        (page header は残してもよい。retro-tag は pop 化される)
 *     3. 本文 + modal + script を body として渡す
 */
export function popAdminPage(opts: {
  active: PopNavKey;
  masterCss: string; // masterChrome.ts の MASTER_CSS を渡す(import 循環回避のため引数)
  title: string;
  subtitle?: string;
  toolbar?: string;
  body: string;
  headExtra?: string;
  pageTitle?: string;
  role?: Role; // ログイン者の役割。サイドバーをこの役割で絞る(既定 viewer)。
  deptCode?: string | null; // ログイン者の部署コード(departments 指定画面の表示判定)。
}): string {
  const titleTag = opts.pageTitle || `${opts.title} · Arcs Legal OS`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
${POP_HEAD}
<meta name="robots" content="noindex, nofollow">
<title>${esc(titleTag)}</title>
<style>${opts.masterCss}${POP_CSS}${POP_ADMIN_BRIDGE}</style>
${opts.headExtra || ""}
</head>
<body>
<div class="pop-shell">
${navHtml(opts.active, opts.role || "viewer", opts.deptCode)}
  <div class="pop-main">
    <div class="pop-toolbar">
      ${backBtnHtml()}
      <h1>${esc(opts.title)}</h1>
      ${opts.subtitle ? `<span class="sub">${esc(opts.subtitle)}</span>` : ""}
      <span class="sp"></span>
      ${viewSwitchForRole(opts.role)}
      ${adminLinkHtml(opts.role)}
      ${opts.toolbar || ""}
    </div>
    <div class="pop-body">
${opts.body}
    </div>
  </div>
</div>
</body>
</html>`;
}
