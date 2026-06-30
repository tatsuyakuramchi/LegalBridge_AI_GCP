/**
 * guidePortalHtml — 法務ポータル(GAS 移植)のトップ/カテゴリ/準備中ページ。
 *
 * 移植元: legalbridge lib/layout.js。データは静的定義ではなく portalGuideService(DB)から渡す。
 * 各ガイド本体(/g/:key)は GAS 由来のフル HTML をそのまま配信するため、ここで枠付けするのは
 *   ポータルトップ(/portal)・カテゴリ(/c/:cat)・準備中・404 の「当方が用意する」ページのみ。
 * デザインは既存ガイド/viewerHome と同じネイビー基調の独立ページ(popChrome ではない)。
 */

import type { GuideCategory, GuideMeta } from "../services/portalGuideService.ts";
import { viewSwitchHtml } from "./viewSwitch.ts";

const esc = (s: unknown): string =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--navy:#1d3557;--navy-l:#2a4a6e;--g1:#f8f9fa;--g3:#dee2e6;--g5:#6c757d;--tx:#212529;--tx2:#495057}
body{font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;font-size:14px;line-height:1.7;color:var(--tx);background:var(--g1)}
a{color:inherit}
.topbar{background:var(--navy);color:#fff;height:48px;display:flex;align-items:center;gap:14px;padding:0 18px}
.topbar .brand{font-size:11px;font-weight:700;letter-spacing:.08em;color:rgba(255,255,255,.55);text-transform:uppercase}
.topbar a{color:rgba(255,255,255,.8);text-decoration:none;font-size:12px;font-weight:600;padding:4px 10px;border-radius:5px}
.topbar a:hover{background:rgba(255,255,255,.12);color:#fff}
.wrap{max-width:880px;margin:0 auto;padding:34px 22px 80px}
.crumb{font-size:12px;color:var(--g5);margin-bottom:14px}
.crumb a{color:var(--navy);text-decoration:none}.crumb a:hover{text-decoration:underline}
h1.pt{font-size:23px;font-weight:700;color:var(--navy);margin-bottom:6px}
.sub{font-size:13px;color:var(--g5);margin-bottom:26px}
.hero{background:linear-gradient(135deg,#1d3557,#2a4a6e);border-radius:12px;padding:22px 26px;color:#fff;margin-bottom:22px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.hero .ht{font-size:15px;font-weight:700;margin-bottom:3px}
.hero .hd{font-size:12.5px;color:rgba(255,255,255,.78);flex:1;min-width:200px}
.hero a.go{background:#fff;color:var(--navy);font-weight:700;font-size:13px;text-decoration:none;padding:10px 18px;border-radius:8px;white-space:nowrap}
.entry{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 26px}
.entry .e{border:1px solid var(--g3);border-radius:9px;padding:13px 16px;background:#fff}
.entry .e b{color:var(--navy);font-size:13px}
.entry .e code{background:var(--navy);color:#fff;font-size:12px;font-weight:700;padding:2px 9px;border-radius:5px;font-family:Consolas,monospace;display:inline-block;margin:5px 0}
.entry .e p{font-size:11.5px;color:var(--tx2);margin:0}
.sec{font-size:13px;font-weight:700;color:var(--navy);border-left:4px solid var(--navy);padding-left:9px;margin:24px 0 12px}
.cards{display:grid;gap:12px}
.card{display:flex;align-items:center;gap:16px;background:#fff;border:1px solid var(--g3);border-radius:10px;padding:16px 20px;text-decoration:none;transition:all .14s;border-left:5px solid var(--navy)}
.card:hover{background:#f0f4ff;box-shadow:0 2px 10px rgba(29,53,87,.1);transform:translateY(-1px)}
.card .tag{font-size:10px;font-weight:700;color:var(--g5);letter-spacing:.05em;white-space:nowrap;min-width:64px}
.card .body{flex:1}
.card .ct{font-size:15px;font-weight:700;color:var(--navy);margin-bottom:2px}
.card .cd{font-size:12px;color:var(--tx2);line-height:1.5}
.card .arr{font-size:20px;color:var(--g3)}
.badge{display:inline-block;font-size:10px;font-weight:700;border-radius:4px;padding:1px 7px;margin-left:6px}
.b-ready{background:#e4f7f1;color:#0d6b4e}.b-soon{background:#fef3e2;color:#7a4d09}
.tip{background:#fff;border:1px solid var(--g3);border-left:4px solid #c47d1a;border-radius:0 6px 6px 0;padding:11px 15px;font-size:12px;color:var(--tx2);margin:18px 0}
.foot{margin-top:34px;padding-top:16px;border-top:1px solid var(--g3);font-size:11px;color:var(--g5);text-align:center}
@media(max-width:600px){.entry{grid-template-columns:1fr}.hero{flex-direction:column;align-items:flex-start}}
`;

function basePage(title: string, body: string, rightSlot = ""): string {
  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body>
<nav class="topbar"><span class="brand">法務部</span><a href="/portal">ポータル</a><a href="/guide">ご利用案内</a>${rightSlot ? `<span style="margin-left:auto;display:inline-flex;align-items:center">${rightSlot}</span>` : ""}</nav>
${body}
<div class="wrap" style="padding-top:0"><div class="foot">株式会社アークライト 経営管理本部 法務部　｜　社内業務用</div></div>
</body></html>`;
}

/** ポータルトップ。カテゴリ一覧 + 2 つの入口 + ご利用案内ヒーロー。 */
export function portalPage(
  categories: GuideCategory[],
  countByCategory: Record<string, number>,
  isAdmin = false
): string {
  const catCards = categories
    .map((c) => {
      const n = countByCategory[c.catKey] || 0;
      const color = c.color || "#1d3557";
      return `<a class="card" href="/c/${esc(c.catKey)}" style="border-left-color:${esc(color)}">
      <div class="tag" style="color:${esc(color)}">${n} ガイド</div>
      <div class="body"><div class="ct" style="color:${esc(color)}">${esc(c.label)}</div><div class="cd">${esc(c.description)}</div></div>
      <div class="arr">›</div></a>`;
    })
    .join("");

  const body = `<div class="wrap">
    <h1 class="pt">法務部 実務ガイド ポータル</h1>
    <p class="sub">LegalBridge｜契約・取引・個人情報まわりの社内手続きと判断材料の入口</p>

    <div class="hero">
      <div class="hd"><div class="ht">はじめての方・どれを見ればいいか迷う方へ</div>「やりたいこと」から適切なガイドにたどり着ける案内ページです。</div>
      <a class="go" href="/guide">ご利用案内を開く →</a>
    </div>

    <div class="sec">2つの入口</div>
    <div class="entry">
      <div class="e"><b>調べる</b><br><code>/法務検索 [取引先名]</code><p>取引先・契約・文書を検索。検索ポータルからも検索できます。</p></div>
      <div class="e"><b>依頼する</b><br><code>/法務依頼</code><p>文書作成（自社）／他社契約のレビュー（法務相談）を依頼。</p></div>
    </div>

    <div class="sec">目的から探す</div>
    <div class="cards">${catCards}</div>
  </div>`;
  return basePage("法務部 実務ガイド ポータル", body, isAdmin ? viewSwitchHtml("viewer", "#1d3557") : "");
}

/** カテゴリページ。属するガイドを公開中/準備中バッジつきで一覧。 */
export function categoryPage(category: GuideCategory, guides: GuideMeta[], isAdmin = false): string {
  const color = category.color || "#1d3557";
  const items = guides
    .map((g) => {
      const badge = g.linkPath
        ? '<span class="badge b-ready">検索へ</span>'
        : g.ready
        ? '<span class="badge b-ready">公開中</span>'
        : '<span class="badge b-soon">準備中</span>';
      const href = g.linkPath
        ? esc(g.linkPath)
        : g.ready
        ? `/g/${esc(g.guideKey)}`
        : "javascript:void(0)";
      return `<a class="card" href="${href}" style="border-left-color:${esc(color)}">
      <div class="tag">GUIDE ${esc(g.guideNum)}</div>
      <div class="body"><div class="ct">${esc(g.title)}${badge}</div><div class="cd">${esc(g.summary)}</div></div>
      <div class="arr">›</div></a>`;
    })
    .join("");

  const body = `<div class="wrap">
    <div class="crumb"><a href="/portal">ポータル</a> ／ ${esc(category.label)}</div>
    <h1 class="pt" style="color:${esc(color)}">${esc(category.label)}</h1>
    <p class="sub">${esc(category.description)}</p>
    <div class="cards">${items}</div>
  </div>`;
  return basePage(`${category.label}｜法務ポータル`, body, isAdmin ? viewSwitchHtml("viewer", "#1d3557") : "");
}

/** 準備中(現行版未投入)ページ。 */
export function notReadyPage(guide: GuideMeta, category: GuideCategory | null, isAdmin = false): string {
  const catKey = category?.catKey || "transactions";
  const catLabel = category?.label || "ガイド";
  const body = `<div class="wrap">
    <div class="crumb"><a href="/portal">ポータル</a> ／ <a href="/c/${esc(catKey)}">${esc(catLabel)}</a> ／ ${esc(guide.title)}</div>
    <h1 class="pt">${esc(guide.title)}</h1>
    <p class="sub">GUIDE ${esc(guide.guideNum)}・準備中</p>
    <div class="tip">このガイドの本文はまだ公開されていません。<br>
      <code>services/api/guides/${esc(guide.guideKey)}.html</code> を配置し、ガイド同期(sync-guides-to-db.mjs)を実行すると、ここに自動で表示されます（GAS のテンプレートタグはそのままで OK）。</div>
    <p><a href="/c/${esc(catKey)}" style="color:var(--navy);font-weight:700;text-decoration:none">← ${esc(catLabel)} に戻る</a></p>
  </div>`;
  return basePage(`${guide.title}（準備中）｜法務ポータル`, body, isAdmin ? viewSwitchHtml("viewer", "#1d3557") : "");
}

/** 404。 */
export function guideNotFoundPage(): string {
  const body = `<div class="wrap">
    <h1 class="pt">ページが見つかりません</h1>
    <p class="sub">指定されたガイドは存在しないか、移動した可能性があります。</p>
    <p><a href="/portal" style="color:var(--navy);font-weight:700;text-decoration:none">← ポータルへ戻る</a></p>
  </div>`;
  return basePage("ページが見つかりません｜法務ポータル", body);
}
