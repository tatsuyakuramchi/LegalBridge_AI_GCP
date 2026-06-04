/**
 * landingHtml — 入口(ログイン)とログイン後ランディング(Viewer / Admin)。
 *
 * 統合 #5: 「美しく・合理的な」入口体験を提供する:
 *   - loginPage      : 未認証(anonymous)向けのブランドゲート。Google SSO 導線。
 *   - viewerHomePage : viewer ログイン後ホーム(検索ポータルのハブ)。
 *   - adminHomeRedirect は server 側で ADMIN_UI_URL があれば React へ。
 *
 * 認証は GCP IAP(LB 前段)で行うため、本ページは「IAP 認証後/または非強制時」に
 * 表示される。デザインは popChrome(macOS×pop・インディゴ→バイオレット)と統一。
 */

const esc = (s: any) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** 共通 <head>。フォント + 配色トークン + 背景グラデ + 微モーション。 */
const HEAD = `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300..800&family=Geist+Mono:wght@400..700&display=swap">`;

const BASE_CSS = `
:root{
  --accent:#6c5ce7; --accent2:#a29bfe; --accent-press:#5a4bd6;
  --bg:#f4f1fb; --ink:#241f3a; --muted:#8a86a3; --line:#ece8f6; --hover:#f6f3ff;
  --radius:20px; --radius-sm:13px;
  --shadow:0 2px 6px rgba(90,70,180,.08),0 24px 60px rgba(90,70,180,.16);
  --font:'Geist',-apple-system,"Hiragino Maru Gothic ProN","Hiragino Sans",system-ui,sans-serif;
  --mono:'Geist Mono',ui-monospace,Menlo,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{
  font-family:var(--font); color:var(--ink); font-size:14px; line-height:1.6;
  -webkit-font-smoothing:antialiased;
  background:
    radial-gradient(1100px 520px at 88% -8%, #ffe3ef 0, transparent 58%),
    radial-gradient(980px 520px at -8% 4%, #e3f3ff 0, transparent 56%),
    radial-gradient(820px 600px at 50% 120%, #efe7ff 0, transparent 60%),
    var(--bg);
  min-height:100vh;
}
.wrap{max-width:1040px;margin:0 auto;padding:40px 24px 56px}
.brand{display:flex;align-items:center;gap:13px;justify-content:center;margin-bottom:6px}
.brand .glyph{
  width:46px;height:46px;border-radius:14px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:19px;
  background:linear-gradient(135deg,var(--accent),var(--accent2));
  box-shadow:0 10px 26px rgba(108,92,231,.42);
}
.brand .name{font-size:21px;font-weight:300;letter-spacing:.01em}
.brand .name b{font-weight:800}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:var(--muted);text-align:center}
.role-pill{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:11px;font-weight:700;
  letter-spacing:.08em;text-transform:uppercase;padding:5px 13px;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--ink)}
.role-pill .dot{width:7px;height:7px;border-radius:50%}
.role-pill.admin .dot{background:#a55eea}.role-pill.viewer .dot{background:#1dd1a1}
.btn{display:inline-flex;align-items:center;gap:10px;border:0;border-radius:14px;padding:13px 22px;font:inherit;
  font-weight:800;font-size:14px;cursor:pointer;text-decoration:none;color:#fff;
  background:linear-gradient(135deg,var(--accent),var(--accent2));box-shadow:0 12px 26px rgba(108,92,231,.38);
  transition:transform .12s, filter .12s, box-shadow .12s}
.btn:hover{filter:brightness(1.05);transform:translateY(-1px)} .btn:active{transform:translateY(0)}
.btn.google{background:#fff;color:#241f3a;border:1.5px solid #e2dbfb;box-shadow:var(--shadow)}
.btn.google:hover{background:var(--hover)}
.btn.ghost{background:#efeaff;color:var(--accent);box-shadow:none}
.gicon{width:18px;height:18px;display:inline-block}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(252px,1fr));gap:15px}
.tile{display:block;text-decoration:none;color:inherit;background:rgba(255,255,255,.86);backdrop-filter:blur(8px);
  border:1px solid var(--line);border-radius:var(--radius);padding:18px 19px;position:relative;overflow:hidden;
  box-shadow:0 2px 10px rgba(90,70,180,.06);transition:transform .14s, box-shadow .14s, border-color .14s}
.tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:linear-gradient(180deg,var(--accent),var(--accent2))}
.tile:hover{transform:translateY(-3px);box-shadow:var(--shadow);border-color:#e2dbfb}
.tile .ic{font-size:22px}
.tile .t{font-weight:800;font-size:14.5px;margin-top:9px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.tile .t .arrow{color:var(--accent);font-weight:800}
.tile .d{color:var(--muted);font-size:12px;margin-top:5px;line-height:1.55}
.tile code{font-family:var(--mono);background:#f4f1fb;border-radius:6px;padding:1px 6px;font-size:11px}
.section-label{font-family:var(--mono);font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;
  color:var(--muted);margin:26px 2px 12px}
.card{background:rgba(255,255,255,.9);border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;box-shadow:0 2px 10px rgba(90,70,180,.06)}
.foot{text-align:center;color:var(--muted);font-family:var(--mono);font-size:10px;letter-spacing:.22em;text-transform:uppercase;margin-top:34px}
/* 入場モーションは「装飾のみ」。opacity は使わず transform だけにして、
   アニメ未実行/キャプチャ時でもコンテンツが必ず見えるようにする。 */
@keyframes rise{from{transform:translateY(9px)}to{transform:translateY(0)}}
.rise{animation:rise .5s cubic-bezier(.2,.7,.2,1) both}
.rise.d1{animation-delay:.05s}.rise.d2{animation-delay:.12s}.rise.d3{animation-delay:.19s}
@media (prefers-reduced-motion: reduce){.rise{animation:none}}
`;

const GOOGLE_G = `<svg class="gicon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"/></svg>`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="ja"><head>${HEAD}<title>${esc(title)}</title>
<style>${BASE_CSS}</style></head><body>${body}</body></html>`;
}

/**
 * 未認証(anonymous)向けブランドゲート。Google SSO 導線。
 * IAP 配下なら CTA で保護領域へ → Google ログイン。非強制時は案内のみ。
 */
export function loginPage(opts: { continueUrl?: string } = {}): string {
  const cont = opts.continueUrl || "/";
  const body = `
  <div class="wrap" style="max-width:520px;display:flex;flex-direction:column;justify-content:center;min-height:100vh">
    <div class="card rise" style="padding:40px 36px;text-align:center">
      <div class="brand" style="margin-bottom:18px">
        <span class="glyph">A</span>
        <span class="name">ARCS <b>Legal OS</b></span>
      </div>
      <p class="eyebrow" style="margin-bottom:18px">Contract Intelligence Platform</p>
      <h1 style="font-size:25px;font-weight:800;letter-spacing:-.01em;margin-bottom:8px">ようこそ</h1>
      <p style="color:var(--muted);font-size:13.5px;margin-bottom:26px">
        社内 Google アカウントでログインしてください。<br>
        権限に応じて、検索ポータル または 管理コンソールに進みます。
      </p>
      <a class="btn google" href="${esc(cont)}" style="width:100%;justify-content:center">
        ${GOOGLE_G} Google でログイン
      </a>
      <p style="color:var(--muted);font-size:11px;margin-top:18px;font-family:var(--mono);letter-spacing:.04em">
        SSO は Google Workspace / IAP により保護されています
      </p>
    </div>
    <p class="foot">Arcs Legal OS · Secure Sign-in</p>
  </div>`;
  return page("ログイン · Arcs Legal OS", body);
}

type Tool = { href: string; icon: string; title: string; desc: string; ext?: boolean };

function tile(t: Tool, cls = ""): string {
  const ext = t.ext ? ' target="_blank" rel="noopener"' : "";
  return `<a class="tile ${cls}" href="${esc(t.href)}"${ext}>
    <div class="ic">${t.icon}</div>
    <div class="t">${esc(t.title)} <span class="arrow">${t.ext ? "↗" : "→"}</span></div>
    <div class="d">${t.desc}</div>
  </a>`;
}

/**
 * viewer ログイン後ホーム。検索ポータルのハブ。美しいヒーロー + ツールカード。
 */
export function viewerHomePage(opts: {
  currentEmail: string | null;
  currentRole?: string | null;
}): string {
  const email = opts.currentEmail || "(不明)";
  const role = opts.currentRole || "viewer";
  const tools: Tool[] = [
    {
      href: "/search/vendor",
      icon: "🔎",
      title: "取引先・契約 検索",
      desc: "取引先名や契約類型から、契約・文書の状況を横断検索します。",
    },
    {
      href: "/templates/preview",
      icon: "📄",
      title: "ひな型プレビュー",
      desc: "全ひな型をサンプル表示・PDF 化。Slack 貼付け用リンクもここで。",
    },
  ];
  const body = `
  <div class="wrap" style="max-width:880px">
    <div class="rise" style="text-align:center;margin-top:18px;margin-bottom:30px">
      <div class="brand"><span class="glyph">A</span><span class="name">ARCS <b>Legal OS</b></span></div>
      <p class="eyebrow" style="margin-top:8px">Search Portal</p>
      <h1 style="font-size:27px;font-weight:800;letter-spacing:-.01em;margin:10px 0 6px">検索ポータル</h1>
      <p style="color:var(--muted);font-size:13.5px">必要な契約・文書をすばやく探せます。</p>
      <div style="margin-top:14px"><span class="role-pill viewer"><span class="dot"></span>${esc(role)}</span></div>
    </div>

    <div class="tiles rise d1">
      ${tools.map((t) => tile(t)).join("")}
      <div class="tile" style="cursor:default">
        <div class="ic">📋</div>
        <div class="t">稟議番号で開く</div>
        <div class="d">アドレス欄に <code>/search/ringi/00001</code> のように 5 桁で。</div>
      </div>
    </div>

    <div class="card rise d2" style="margin-top:22px;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <div style="font-size:12.5px;color:var(--muted)">
        <b style="color:var(--ink)">取込・編集・管理</b> を使うには管理者(app_role=admin)権限が必要です。
        管理者にロール付与を依頼してください。
      </div>
      <span class="role-pill"><span class="dot" style="background:#8a86a3"></span>${esc(email)}</span>
    </div>

    <p class="foot">Arcs Legal OS · Search Portal</p>
  </div>`;
  return page("検索ポータル · Arcs Legal OS", body);
}
