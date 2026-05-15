/**
 * 取引先マスター CRUD 管理 UI (Phase 17z)
 *
 * /master/vendors ページ。検索 → 一覧 → 編集/新規作成 を単一ページで
 * 完結させる。フロント JS はバニラ + fetch API。
 *
 * デザイン (Phase 17z-3):
 *   admin-ui (legalbridge-admin-ui) の "Arcs Legal OS Retro-Future"
 *   デザインシステムを踏襲。Geist Variable + Geist Mono、warm off-white
 *   背景にアンバーフォスファーのアクセント、tech-label / retro-tag を
 *   そのまま再現 (Tailwind ではなく素の CSS で同等のトークン値を埋める)。
 *
 * 認可は server.ts 側で requireIapUser + requireDepartmentRole が
 * 適用される前提なので、本ページは「中身を組み立てる」ことだけに専念する。
 */

import type { SignLink } from "./contractSearchHtml.ts";

/**
 * Arcs Legal OS デザイントークン (light mode "paper terminal")。
 * src/index.css の :root から HSL 値を 16進相当に展開して埋め込み。
 * admin-ui と完全に同じ色相を出すため、計算で hsl() のまま使用する。
 */
const STYLE = `
:root {
  --background: hsl(40 40% 97%);
  --foreground: hsl(30 20% 12%);
  --card: hsl(40 30% 99%);
  --card-foreground: hsl(30 20% 12%);
  --muted: hsl(36 20% 94%);
  --muted-foreground: hsl(30 8% 42%);
  --accent: hsl(36 25% 88%);
  --secondary: hsl(36 25% 92%);
  --border: hsl(30 12% 80%);
  --input: hsl(30 12% 84%);
  --ring: hsl(30 30% 30%);
  --phosphor: hsl(28 95% 45%);
  --amber: hsl(35 95% 50%);
  --cyan: hsl(195 70% 38%);
  --destructive: hsl(8 70% 45%);
  --radius: 0.25rem;
  --font-sans: 'Geist Variable', 'Hiragino Sans', system-ui, sans-serif;
  --font-mono: 'Geist Mono Variable', 'JetBrains Mono', 'Menlo', monospace;
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--font-sans);
  background: var(--background);
  color: var(--foreground);
  font-size: 14px;
  line-height: 1.55;
  font-feature-settings: "ss01", "cv11";
}
::selection { background: hsl(28 95% 45% / 0.85); color: hsl(40 40% 97%); }

.container { max-width: 1500px; margin: 0 auto; padding: 0 24px; }

/* ─── Topbar (Arcs breadcrumb) ─────────────────────────── */
.topbar {
  position: sticky; top: 0; z-index: 30;
  height: 56px;
  display: flex; align-items: center; gap: 12px;
  padding: 0 24px;
  background: hsl(40 40% 97% / 0.85);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--border);
}
.crumb-arcs {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--muted-foreground);
}
.crumb-sep {
  width: 12px; height: 12px;
  color: var(--muted-foreground);
}
.crumb-title {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  margin: 0;
}
.crumb-sub {
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--muted-foreground);
  margin-top: 2px;
}

/* ─── Page header (retro-tag + h2) ─────────────────────── */
.page-header {
  border-bottom: 1px solid var(--border);
  padding: 24px 0 20px;
  margin-bottom: 24px;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 24px;
}
.retro-tag {
  display: inline-flex; align-items: center;
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--muted-foreground);
  margin-bottom: 6px;
}
.retro-tag::before {
  content: "▍";
  color: var(--phosphor);
  margin-right: 6px;
}
h2.page-title {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 26px;
  letter-spacing: -0.02em;
  margin: 0;
}
.page-desc {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--muted-foreground);
  margin-top: 6px;
}

/* ─── Tabs (Master sub-navigation, decorative for now) ─── */
.tabs {
  display: flex; gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 24px;
  margin-top: -10px;
}
.tab {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 16px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--muted-foreground);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  text-decoration: none;
  transition: color 120ms ease;
}
.tab:hover { color: var(--foreground); }
.tab.active {
  color: var(--foreground);
  border-bottom-color: var(--foreground);
}

/* ─── Toolbar ──────────────────────────────────────────── */
.toolbar {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.search {
  position: relative;
  flex: 1; max-width: 420px;
}
.search input {
  width: 100%;
  height: 32px;
  padding: 0 10px 0 32px;
  background: var(--card);
  border: 1px solid var(--input);
  border-radius: var(--radius);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--foreground);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.search input:focus {
  outline: none;
  border-color: var(--foreground);
  box-shadow: 0 0 0 1px var(--foreground);
}
.search svg {
  position: absolute; left: 10px; top: 50%;
  transform: translateY(-50%);
  width: 14px; height: 14px;
  color: var(--muted-foreground);
  pointer-events: none;
}
.count-badge {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--muted-foreground);
}
.toolbar .spacer { flex: 1; }

/* ─── Buttons ──────────────────────────────────────────── */
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  border-radius: var(--radius);
  border: 1px solid var(--foreground);
  background: var(--foreground);
  color: var(--background);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.btn:hover { background: hsl(30 20% 22%); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.outline {
  background: transparent;
  color: var(--foreground);
  border-color: var(--border);
}
.btn.outline:hover {
  background: var(--muted);
  border-color: var(--foreground);
}
.btn.ghost {
  background: transparent;
  color: var(--foreground);
  border-color: transparent;
}
.btn.ghost:hover { background: var(--muted); }
.btn.danger {
  background: var(--destructive);
  border-color: var(--destructive);
  color: hsl(40 40% 97%);
}
.btn.sm { padding: 4px 10px; font-size: 10px; }
.btn svg { width: 12px; height: 12px; }

/* ─── Card grid (vendor list) ──────────────────────────── */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  cursor: pointer;
  transition: border-color 120ms ease;
  position: relative;
}
.card:hover { border-color: var(--foreground); }
.card-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 8px; margin-bottom: 8px;
}
.card-head svg {
  width: 16px; height: 16px;
  color: var(--muted-foreground);
}
.card-name {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1.4;
  margin: 0 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.card-sub {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--muted-foreground);
}
.card-meta {
  display: flex; flex-wrap: wrap; gap: 4px;
  margin-top: 8px;
}
.empty {
  grid-column: 1 / -1;
  padding: 48px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  text-align: center;
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--muted-foreground);
}

/* ─── Badges (vendor code, entity_type, etc.) ──────────── */
.badge {
  display: inline-flex; align-items: center;
  height: 18px;
  padding: 0 6px;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--foreground);
  border-radius: 0;
}
.badge.corp { color: var(--cyan); border-color: var(--cyan); }
.badge.ind  { color: var(--phosphor); border-color: var(--phosphor); }
.badge.inv  { color: hsl(150 60% 35%); border-color: hsl(150 60% 35%); }

/* ─── Loading ──────────────────────────────────────────── */
.loading {
  padding: 64px 24px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--muted-foreground);
}
.loading::after {
  content: "_";
  margin-left: 4px;
  animation: blink 1.2s steps(2, end) infinite;
}
@keyframes blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0.15; }
}

/* ─── Modal (Dialog) ───────────────────────────────────── */
.modal-backdrop {
  position: fixed; inset: 0;
  background: hsl(30 20% 12% / 0.5);
  backdrop-filter: blur(2px);
  display: none;
  align-items: center; justify-content: center;
  z-index: 50;
}
.modal-backdrop.open { display: flex; }
.modal {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: min(920px, 92vw);
  max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 80px hsl(30 20% 12% / 0.25);
  overflow: hidden;
  position: relative;
}
.modal::before, .modal::after {
  content: "";
  position: absolute;
  width: 10px; height: 10px;
  border: 1px solid var(--foreground);
  opacity: 0.5;
}
.modal::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }
.modal::after  { bottom: -1px; right: -1px; border-left: none; border-top: none; }

.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
}
.modal-title-wrap { display: flex; flex-direction: column; }
.modal-tag {
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--muted-foreground);
}
.modal-tag::before {
  content: "▍";
  color: var(--phosphor);
  margin-right: 4px;
}
.modal-title {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 14px;
  margin: 2px 0 0;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}
.modal-body::-webkit-scrollbar { width: 8px; height: 8px; }
.modal-body::-webkit-scrollbar-track { background: var(--muted); }
.modal-body::-webkit-scrollbar-thumb { background: var(--border); }
.modal-body::-webkit-scrollbar-thumb:hover { background: var(--muted-foreground); }
.modal-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  display: flex; gap: 8px; justify-content: flex-end;
  background: var(--card);
}

/* ─── Form ─────────────────────────────────────────────── */
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px 16px;
}
.form-grid .col-2 { grid-column: span 2; }
.field { display: flex; flex-direction: column; gap: 6px; }
.tech-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--muted-foreground);
}
.tech-label .req {
  color: var(--destructive);
  font-weight: 700;
  margin-left: 2px;
}
.tech-input, .tech-select {
  width: 100%;
  padding: 8px 10px;
  background: var(--card);
  border: 1px solid var(--input);
  border-radius: var(--radius);
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--foreground);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.tech-input:focus, .tech-select:focus {
  outline: none;
  border-color: var(--foreground);
  box-shadow: 0 0 0 1px var(--foreground);
}
.tech-input:read-only {
  background: var(--muted);
  color: var(--muted-foreground);
  cursor: not-allowed;
}
.field-help {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--muted-foreground);
}
.checkbox-row {
  display: flex; align-items: center; gap: 8px;
  padding: 24px 0 4px;
}
.checkbox-row input[type="checkbox"] {
  width: 14px; height: 14px;
  accent-color: var(--phosphor);
  cursor: pointer;
}
.checkbox-row label {
  font-family: var(--font-mono);
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0;
  color: var(--foreground);
  cursor: pointer;
}

/* ─── Form section divider with retro-tag ──────────────── */
.section-head {
  grid-column: span 2;
  display: flex; align-items: center; gap: 12px;
  padding-top: 8px;
  margin-top: 4px;
  border-top: 1px dashed var(--border);
}
.section-head:first-child { border-top: none; padding-top: 0; margin-top: 0; }
.section-head .retro-tag {
  margin: 0;
  font-size: 10px;
}

/* ─── Toast ────────────────────────────────────────────── */
.toast {
  position: fixed; top: 72px; right: 24px;
  padding: 10px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--foreground);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  background: var(--card);
  color: var(--foreground);
  box-shadow: 0 12px 32px hsl(30 20% 12% / 0.18);
  opacity: 0;
  transform: translateY(-8px);
  transition: opacity 180ms ease, transform 180ms ease;
  z-index: 100;
}
.toast.show { opacity: 1; transform: translateY(0); }
.toast.success {
  border-color: hsl(150 60% 35%);
  color: hsl(150 60% 25%);
}
.toast.error {
  border-color: var(--destructive);
  color: var(--destructive);
}
.toast::before {
  content: "▍";
  margin-right: 6px;
}
.toast.success::before { color: hsl(150 60% 35%); }
.toast.error::before   { color: var(--destructive); }
.toast::not(.success):not(.error)::before { color: var(--phosphor); }
`;

/**
 * Inline lucide-style SVG (admin-ui の lucide-react と同じパス)。
 * 外部リソースに依存しないよう SVG をそのまま埋め込む。
 */
const SVG = {
  search: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  plus: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
  building: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>`,
  chevronRight: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
  x: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  users: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  fileText: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
  gitBranch: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
};

function esc(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * /master/vendors のページ HTML 本体。
 *
 * @param auth Phase 17z-2 で恒久 URL 化した結果、null を渡せば HMAC は付かない。
 *             API 呼び出しは同一オリジン内なので IAP セッションがそのまま継承される。
 */
export function vendorMasterPage(
  auth: SignLink | string | null | undefined
): string {
  // API 呼び出し時に HMAC が必要な互換経路 (auth が SignLink 関数のとき)
  function buildSignedUrl(base: string): string {
    if (typeof auth === "function") {
      try {
        const qs = auth("master:vendors");
        if (qs) return base + (base.includes("?") ? "&" : "?") + qs;
      } catch {
        /* noop */
      }
    } else if (typeof auth === "string" && auth) {
      return base + (base.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(auth);
    }
    return base;
  }

  const apiListUrl = buildSignedUrl("/api/master/vendors");
  const apiDetailBase = buildSignedUrl("/api/master/vendors/__CODE__");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Vendors · Arcs Legal OS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@300..700&display=swap">
  <style>${STYLE}
    :root {
      --font-sans: 'Geist', 'Hiragino Sans', system-ui, sans-serif;
      --font-mono: 'Geist Mono', 'JetBrains Mono', 'Menlo', monospace;
    }
  </style>
</head>
<body>
  <!-- Topbar (Arcs breadcrumb) -->
  <header class="topbar">
    <span class="crumb-arcs">ARCS</span>
    <span class="crumb-sep">${SVG.chevronRight}</span>
    <div>
      <h1 class="crumb-title">Vendors</h1>
      <p class="crumb-sub">Master · External partners</p>
    </div>
    <div style="flex:1"></div>
  </header>

  <div class="container" style="padding-top: 24px; padding-bottom: 48px;">
    <!-- Page header -->
    <header class="page-header">
      <div>
        <p class="retro-tag">MST · INDEX</p>
        <h2 class="page-title">Master Systems</h2>
        <p class="page-desc">Reference data — vendors, staff, contracts, and workflow routing.</p>
      </div>
      <div></div>
    </header>

    <!-- Tab navigation (decorative; only Vendors is wired) -->
    <nav class="tabs">
      <span class="tab" title="未実装">${SVG.fileText} Contracts</span>
      <a class="tab active" href="/master/vendors">${SVG.building} Vendors</a>
      <span class="tab" title="未実装">${SVG.users} Staff</span>
      <span class="tab" title="未実装">${SVG.gitBranch} Routing</span>
    </nav>

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="search">
        ${SVG.search}
        <input type="text" id="search" placeholder="取引先名・取引先コードで検索…" autocomplete="off">
      </div>
      <span class="count-badge" id="count">— entries</span>
      <div class="spacer"></div>
      <button class="btn" id="btn-new">${SVG.plus} 取引先を追加</button>
    </div>

    <!-- List -->
    <div id="list-wrap">
      <div class="loading">LOADING</div>
    </div>
  </div>

  <!-- Edit / Create Modal -->
  <div class="modal-backdrop" id="modal-backdrop">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title-wrap">
          <span class="modal-tag" id="modal-tag">MST · VENDORS</span>
          <h3 class="modal-title" id="modal-title">取引先の編集</h3>
        </div>
        <button class="btn ghost sm" id="btn-close" aria-label="閉じる">${SVG.x}</button>
      </div>
      <div class="modal-body">
        <form id="form" autocomplete="off">
          <div class="form-grid">

            <div class="section-head"><span class="retro-tag">SEC · 01 / 基本情報</span></div>

            <div class="field">
              <label class="tech-label">取引先コード<span class="req">*</span></label>
              <input class="tech-input" type="text" name="vendor_code" required maxlength="50" placeholder="例: 2-20-1234">
              <span class="field-help">既存コードを入れると上書き (UPSERT)。新規時のみ編集可能。</span>
            </div>

            <div class="field">
              <label class="tech-label">区分</label>
              <select class="tech-select" name="entity_type">
                <option value="">(未指定)</option>
                <option value="corporate">法人</option>
                <option value="individual">個人</option>
                <option value="sole_proprietor">個人事業主</option>
              </select>
            </div>

            <div class="field col-2">
              <label class="tech-label">正式名称<span class="req">*</span></label>
              <input class="tech-input" type="text" name="vendor_name" required maxlength="255" placeholder="例: 株式会社サンプル">
            </div>

            <div class="field">
              <label class="tech-label">屋号 / 略称</label>
              <input class="tech-input" type="text" name="trade_name" maxlength="255">
            </div>

            <div class="field">
              <label class="tech-label">ペンネーム</label>
              <input class="tech-input" type="text" name="pen_name" maxlength="255">
            </div>

            <div class="field">
              <label class="tech-label">敬称サフィックス</label>
              <input class="tech-input" type="text" name="vendor_suffix" maxlength="50" placeholder="様 / 御中">
            </div>

            <div class="field">
              <label class="tech-label">別名 (aliases)</label>
              <input class="tech-input" type="text" name="aliases" placeholder="カンマ区切りで複数可">
            </div>

            <div class="section-head"><span class="retro-tag">SEC · 02 / 連絡先</span></div>

            <div class="field">
              <label class="tech-label">担当部署</label>
              <input class="tech-input" type="text" name="contact_department" maxlength="100">
            </div>

            <div class="field">
              <label class="tech-label">担当者</label>
              <input class="tech-input" type="text" name="contact_name" maxlength="100">
            </div>

            <div class="field">
              <label class="tech-label">電話番号</label>
              <input class="tech-input" type="tel" name="phone" maxlength="50" placeholder="03-1234-5678">
            </div>

            <div class="field">
              <label class="tech-label">メールアドレス</label>
              <input class="tech-input" type="email" name="email" maxlength="255" placeholder="contact@example.com">
            </div>

            <div class="field col-2">
              <label class="tech-label">住所</label>
              <input class="tech-input" type="text" name="address">
            </div>

            <div class="section-head"><span class="retro-tag">SEC · 03 / 税務・インボイス</span></div>

            <div class="checkbox-row">
              <input type="checkbox" id="withholding_enabled" name="withholding_enabled">
              <label for="withholding_enabled">源泉徴収を行う</label>
            </div>

            <div class="checkbox-row">
              <input type="checkbox" id="is_invoice_issuer" name="is_invoice_issuer">
              <label for="is_invoice_issuer">適格請求書発行事業者 (インボイス)</label>
            </div>

            <div class="field col-2">
              <label class="tech-label">インボイス登録番号</label>
              <input class="tech-input" type="text" name="invoice_registration_number" maxlength="50" placeholder="T1234567890123">
            </div>

            <div class="section-head"><span class="retro-tag">SEC · 04 / 振込先</span></div>

            <div class="field">
              <label class="tech-label">銀行名</label>
              <input class="tech-input" type="text" name="bank_name">
            </div>

            <div class="field">
              <label class="tech-label">支店名</label>
              <input class="tech-input" type="text" name="branch_name">
            </div>

            <div class="field">
              <label class="tech-label">口座種別</label>
              <select class="tech-select" name="account_type">
                <option value="">(未指定)</option>
                <option value="普通">普通</option>
                <option value="当座">当座</option>
                <option value="貯蓄">貯蓄</option>
              </select>
            </div>

            <div class="field">
              <label class="tech-label">口座番号</label>
              <input class="tech-input" type="text" name="account_number" maxlength="50">
            </div>

            <div class="field col-2">
              <label class="tech-label">口座名義 (カナ)</label>
              <input class="tech-input" type="text" name="account_holder_kana">
            </div>

            <div class="section-head"><span class="retro-tag">SEC · 05 / その他</span></div>

            <div class="field col-2">
              <label class="tech-label">マスター契約参照</label>
              <input class="tech-input" type="text" name="master_contract_ref" placeholder="既存契約番号 / URL 等">
            </div>

            <div class="field col-2">
              <label class="tech-label">銀行情報メモ</label>
              <input class="tech-input" type="text" name="bank_info" placeholder="自由記述">
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

  <div class="toast" id="toast"></div>

  <script>
    const apiListUrl   = ${JSON.stringify(apiListUrl)};
    const apiDetailTpl = ${JSON.stringify(apiDetailBase)};
    const $ = (id) => document.getElementById(id);

    let cache = [];
    let creating = false;

    /* ----- toast ----- */
    function toast(msg, kind) {
      const t = $('toast');
      t.textContent = msg;
      t.className = 'toast show ' + (kind || '');
      setTimeout(() => { t.className = 'toast ' + (kind || ''); }, 3200);
    }

    /* ----- escape ----- */
    function escHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

    const ICON_BUILDING = ${JSON.stringify(SVG.building)};

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
        ? cache.filter(v => {
            const hay = [v.vendor_code, v.vendor_name, v.trade_name, v.pen_name, v.aliases]
              .filter(Boolean).join(' ').toLowerCase();
            return hay.includes(q);
          })
        : cache;

      $('count').textContent = q
        ? rows.length + ' / ' + cache.length + ' ENTRIES'
        : cache.length + ' ENTRIES';

      if (rows.length === 0) {
        $('list-wrap').innerHTML =
          '<div class="grid"><div class="empty">NO VENDORS REGISTERED</div></div>';
        return;
      }

      const cards = rows.map(v => {
        const entityBadge = v.entity_type === 'corporate'
          ? '<span class="badge corp">CORP</span>'
          : (v.entity_type === 'individual' || v.entity_type === 'sole_proprietor')
            ? '<span class="badge ind">IND</span>'
            : '';
        const invoiceBadge = v.is_invoice_issuer ? '<span class="badge inv">INV</span>' : '';
        const sub = v.trade_name || v.pen_name || '—';
        return '<div class="card" data-code="' + escAttr(v.vendor_code) + '">'
          + '<div class="card-head">'
          +   ICON_BUILDING
          +   '<span class="badge">' + escHtml(v.vendor_code) + '</span>'
          + '</div>'
          + '<p class="card-name">' + escHtml(v.vendor_name) + '</p>'
          + '<p class="card-sub">' + escHtml(sub) + '</p>'
          + '<div class="card-meta">' + entityBadge + ' ' + invoiceBadge + '</div>'
          + '</div>';
      }).join('');

      $('list-wrap').innerHTML = '<div class="grid">' + cards + '</div>';
      $('list-wrap').querySelectorAll('.card[data-code]').forEach(card => {
        card.addEventListener('click', () => openEdit(card.dataset.code));
      });
    }

    $('search').addEventListener('input', renderList);

    /* ----- modal ----- */
    function openCreate() {
      creating = true;
      $('modal-tag').textContent = 'MST · VENDORS / NEW';
      $('modal-title').textContent = '取引先の新規追加';
      const form = $('form');
      form.reset();
      form.querySelector('[name=vendor_code]').readOnly = false;
      $('modal-backdrop').classList.add('open');
      setTimeout(() => form.querySelector('[name=vendor_code]').focus(), 50);
    }

    async function openEdit(code) {
      creating = false;
      $('modal-tag').textContent = 'MST · VENDORS / EDIT';
      $('modal-title').textContent = code;
      const form = $('form');
      form.reset();
      $('modal-backdrop').classList.add('open');
      try {
        const url = apiDetailTpl.replace('__CODE__', encodeURIComponent(code));
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const v = await res.json();
        fillForm(v);
        form.querySelector('[name=vendor_code]').readOnly = true;
      } catch (e) {
        toast('取得失敗: ' + (e?.message || e), 'error');
        closeModal();
      }
    }

    function closeModal() { $('modal-backdrop').classList.remove('open'); }

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
        if (el.type === 'checkbox') out[el.name] = el.checked;
        else out[el.name] = el.value.trim();
      });
      return out;
    }

    $('btn-new').addEventListener('click', openCreate);
    $('btn-close').addEventListener('click', closeModal);
    $('btn-cancel').addEventListener('click', closeModal);
    $('modal-backdrop').addEventListener('click', (e) => {
      if (e.target === $('modal-backdrop')) closeModal();
    });

    $('btn-save').addEventListener('click', async () => {
      const payload = readForm();
      if (!payload.vendor_code) { toast('取引先コードは必須です', 'error'); return; }
      if (!payload.vendor_name) { toast('正式名称は必須です', 'error'); return; }
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
        closeModal();
        await loadList();
      } catch (e) {
        toast('保存失敗: ' + (e?.message || e), 'error');
      } finally {
        $('btn-save').disabled = false;
      }
    });

    /* ----- init ----- */
    loadList();
  </script>
</body>
</html>`;
}
