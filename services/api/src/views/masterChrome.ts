/**
 * Master Systems 共通レイアウト (Phase 17z-4)
 *
 * /master/* 系の各ページが共有する topbar / page header / タブナビ / CSS。
 * admin-ui の "Arcs Legal OS Retro-Future" デザインシステムを純 CSS で
 * 再現する。
 *
 * 各ページ (vendors / staff / contracts) は本モジュールをコンポーズして
 * 自分の本文と script だけを書く。
 */

export type MasterTab = "contracts" | "vendors" | "staff" | "conditions" | "sublicense";

/**
 * 共通 CSS。各ページの <style> に展開する。
 */
export const MASTER_CSS = `
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
  --font-sans: 'Geist', 'Hiragino Sans', system-ui, sans-serif;
  --font-mono: 'Geist Mono', 'JetBrains Mono', 'Menlo', monospace;
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
.crumb-sep { width: 12px; height: 12px; color: var(--muted-foreground); }
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
/* Phase 22.21.41: topbar 右端の Admin 戻りリンク */
.topbar-back {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--muted-foreground);
  text-decoration: none;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: hsl(40 40% 99%);
  transition: background .15s, color .15s;
}
.topbar-back:hover {
  background: hsl(40 30% 94%);
  color: var(--foreground);
}
.topbar-back svg { width: 12px; height: 12px; }

/* ─── Page header ──────────────────────────────────────── */
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
.retro-tag::before { content: "▍"; color: var(--phosphor); margin-right: 6px; }
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

/* ─── Tabs (Contracts / Vendors / Staff) ───────────────── */
.tabs {
  display: flex; gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 24px;
  margin-top: -10px;
  overflow-x: auto;
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
  white-space: nowrap;
}
.tab:hover { color: var(--foreground); }
.tab.active { color: var(--foreground); border-bottom-color: var(--foreground); }
.tab svg { width: 14px; height: 14px; flex-shrink: 0; }

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
  text-decoration: none;
}
.btn:hover { background: hsl(30 20% 22%); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.outline {
  background: transparent;
  color: var(--foreground);
  border-color: var(--border);
}
.btn.outline:hover { background: var(--muted); border-color: var(--foreground); }
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

/* ─── Toolbar ──────────────────────────────────────────── */
.toolbar {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.search { position: relative; flex: 1; max-width: 420px; }
.search input {
  width: 100%; height: 32px;
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

/* ─── Card grid ────────────────────────────────────────── */
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
.card-head svg { width: 16px; height: 16px; color: var(--muted-foreground); }
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

/* ─── Badge ────────────────────────────────────────────── */
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
.badge.success { color: hsl(150 60% 35%); border-color: hsl(150 60% 35%); }
.badge.warn { color: var(--amber); border-color: var(--amber); }
.badge.error { color: var(--destructive); border-color: var(--destructive); }

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

/* ─── Modal ────────────────────────────────────────────── */
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
.modal-tag::before { content: "▍"; color: var(--phosphor); margin-right: 4px; }
.modal-title {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 14px;
  margin: 2px 0 0;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.modal-body { padding: 20px; overflow-y: auto; flex: 1; }
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
.tech-label .req { color: var(--destructive); font-weight: 700; margin-left: 2px; }
.tech-input, .tech-select, .tech-textarea {
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
.tech-input:focus, .tech-select:focus, .tech-textarea:focus {
  outline: none;
  border-color: var(--foreground);
  box-shadow: 0 0 0 1px var(--foreground);
}
.tech-input:read-only { background: var(--muted); color: var(--muted-foreground); cursor: not-allowed; }
.tech-textarea { resize: vertical; min-height: 80px; }
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
.section-head {
  grid-column: span 2;
  display: flex; align-items: center; gap: 12px;
  padding-top: 8px;
  margin-top: 4px;
  border-top: 1px dashed var(--border);
}
.section-head:first-child { border-top: none; padding-top: 0; margin-top: 0; }
.section-head .retro-tag { margin: 0; font-size: 10px; }

/* ─── Import card ──────────────────────────────────────── */
.import-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  margin-bottom: 16px;
}
.import-card h3 {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  margin: 0 0 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 8px;
}
.import-card h3::before {
  content: "▍";
  color: var(--phosphor);
  font-weight: 400;
  font-size: 14px;
  line-height: 1;
}
/* h3 内に inline SVG が混じった場合のサイズ強制 (lucide は viewBox のみで
   width/height が無いため、未指定だと巨大化する事故が起きやすい) */
.import-card h3 svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.import-card .desc {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted-foreground);
  margin: 0 0 16px;
  line-height: 1.6;
}
.file-input-wrap {
  display: flex; align-items: center; gap: 12px;
  flex-wrap: wrap;
}
.file-input-wrap input[type="file"] {
  font-family: var(--font-mono);
  font-size: 11px;
}
.dup-mode { display: inline-flex; align-items: center; gap: 6px; }

/* ─── Result stats ─────────────────────────────────────── */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
  margin: 16px 0;
}
.stat {
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  text-align: center;
}
.stat .label {
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--muted-foreground);
}
.stat .value {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 22px;
  color: var(--foreground);
  margin-top: 4px;
}
.stat.ok .value   { color: hsl(150 60% 30%); }
.stat.warn .value { color: var(--phosphor); }
.stat.err .value  { color: var(--destructive); }

.error-list {
  background: hsl(8 70% 95%);
  border-left: 3px solid var(--destructive);
  border-radius: 0 var(--radius) var(--radius) 0;
  padding: 12px 16px;
  margin: 12px 0;
  font-family: var(--font-mono);
  font-size: 11px;
  max-height: 200px;
  overflow-y: auto;
}
.error-list .row {
  padding: 4px 0;
  border-bottom: 1px dashed hsl(8 30% 80%);
}
.error-list .row:last-child { border-bottom: none; }

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
.toast.success { border-color: hsl(150 60% 35%); color: hsl(150 60% 25%); }
.toast.error   { border-color: var(--destructive); color: var(--destructive); }
.toast::before { content: "▍"; margin-right: 6px; color: var(--phosphor); }
.toast.success::before { color: hsl(150 60% 35%); }
.toast.error::before   { color: var(--destructive); }
`;

/**
 * Inline lucide-style SVG (admin-ui の lucide-react と同じパス)。
 */
export const SVG = {
  search: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  plus: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
  upload: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>`,
  download: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,
  building: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>`,
  chevronRight: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
  x: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  users: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  user: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  fileText: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
  refresh: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>`,
};

/**
 * Topbar HTML を返す。
 * @param title    breadcrumb 後ろの大文字タイトル (例: "Vendors")
 * @param subtitle 小さい注記 (例: "Master · External partners")
 *
 * Phase 22.21.41: 右端に「← Admin」戻りリンクを追加 (admin ダッシュボードへ)。
 */
export function topbarHtml(title: string, subtitle: string): string {
  return `<header class="topbar">
    <span class="crumb-arcs">ARCS</span>
    <span class="crumb-sep">${SVG.chevronRight}</span>
    <div>
      <h1 class="crumb-title">${title}</h1>
      <p class="crumb-sub">${subtitle}</p>
    </div>
    <div style="flex:1"></div>
    <a class="topbar-back" href="/admin" title="管理ダッシュボードに戻る">
      <span aria-hidden="true" style="display:inline-flex;transform:rotate(180deg);">${SVG.chevronRight}</span>
      Admin に戻る
    </a>
  </header>`;
}

/**
 * Page header (retro-tag + h2 + desc + 任意の右側アクション)。
 */
export function pageHeaderHtml(opts: {
  tag: string;
  title: string;
  desc: string;
  actionsHtml?: string;
}): string {
  return `<header class="page-header">
    <div>
      <p class="retro-tag">${opts.tag}</p>
      <h2 class="page-title">${opts.title}</h2>
      <p class="page-desc">${opts.desc}</p>
    </div>
    <div>${opts.actionsHtml || ""}</div>
  </header>`;
}

/**
 * タブナビ (Contracts / Vendors / Staff)。
 * active で現在ページを示す。
 */
export function masterTabsHtml(active: MasterTab): string {
  const tabs: Array<{ key: MasterTab; href: string; icon: string; label: string }> = [
    { key: "contracts", href: "/master/contracts", icon: SVG.fileText, label: "Contracts" },
    { key: "vendors",   href: "/master/vendors",   icon: SVG.building, label: "Vendors" },
    { key: "staff",     href: "/master/staff",     icon: SVG.users,    label: "Staff" },
    { key: "conditions", href: "/master/conditions", icon: SVG.fileText, label: "条件明細" },
    { key: "sublicense", href: "/master/sublicense", icon: SVG.fileText, label: "受領予定(サブライセンス)" },
  ];
  const items = tabs
    .map(
      (t) =>
        `<a class="tab${t.key === active ? " active" : ""}" href="${t.href}">${
          t.icon
        } ${t.label}</a>`
    )
    .join("");
  return `<nav class="tabs">${items}</nav>`;
}

/**
 * Google Fonts (Geist) を <head> に注入する <link> 群。
 */
export const HEAD_FONTS = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@300..700&display=swap">
`;

/**
 * HTML エスケープ。
 */
export function esc(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
