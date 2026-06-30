-- 0095_seed_portal_guide_html.sql  (GENERATED — do not edit by hand)
-- 生成: migrations/gen-portal-guide-seed.mjs <- services/api/guides/*.html
-- 各ガイドの現行版(version 1)を投入し status='published' にする。
-- 既に版があるガイドはスキップ(冪等)。本文の更新は新版追加(sync-guides-to-db.mjs)で。

-- ── bg ──────────────────────────────────────────────
DO $seed_bg$
DECLARE gid INTEGER; vid INTEGER;
BEGIN
  SELECT id INTO gid FROM portal_guides WHERE guide_key = 'bg';
  IF gid IS NULL THEN
    RAISE NOTICE 'skip bg: portal_guides にメタ行なし(0094 を先に適用)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM portal_guide_versions WHERE guide_id = gid) THEN
    RETURN; -- 既に版あり。再適用しない(冪等)。
  END IF;
  INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
    VALUES (gid, 1, $g_bg$<!DOCTYPE html>

<html lang="ja"><head>
<meta charset="utf-8"/>
<meta content="width=device-width,initial-scale=1" name="viewport"/>
<title>BG事業部 契約スキーム実務ガイド（契約別確認事項追加版）</title>
<style>
:root{--navy:#1d3557;--navy-l:#2a4a6e;--red:#e63946;--red-s:#fde8ea;--gold:#c47d1a;--gold-s:#fef3e2;--green:#1d9e75;--green-s:#e4f7f1;--blue:#378add;--blue-s:#e8f1fb;--g1:#f8f9fa;--g2:#e9ecef;--g3:#dee2e6;--g5:#6c757d;--tx:#212529;--tx2:#495057;--sw:248px}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;font-size:13.5px;line-height:1.7;color:var(--tx);background:#fff}
#sidebar{position:fixed;top:0;left:0;width:var(--sw);height:100vh;background:var(--navy);overflow-y:auto;display:flex;flex-direction:column;z-index:100}
#sh{padding:18px 16px 14px;border-bottom:1px solid rgba(255,255,255,.1)}
#sh h1{font-size:10px;font-weight:700;color:rgba(255,255,255,.5);letter-spacing:.08em;text-transform:uppercase}
#sh p{font-size:12px;color:rgba(255,255,255,.9);font-weight:600;margin-top:4px;line-height:1.4}
nav{padding:8px 0 20px}
.ns{display:block;padding:5px 16px;font-size:10px;font-weight:700;color:rgba(255,255,255,.35);letter-spacing:.07em;text-transform:uppercase;margin-top:10px}
.nl{display:block;padding:5px 16px;font-size:12px;color:rgba(255,255,255,.72);text-decoration:none;border-left:2px solid transparent;transition:all .15s;line-height:1.4}
.nl:hover,.nl.active{color:#fff;background:rgba(255,255,255,.1);border-left-color:#e63946}
.nsub{display:block;padding:3px 16px 3px 26px;font-size:11px;color:rgba(255,255,255,.48);text-decoration:none;transition:color .15s}
.nsub:hover{color:rgba(255,255,255,.85)}
.bdg{display:inline-block;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-right:4px;vertical-align:middle}
.b-in{background:#e1f5ee;color:#085041}.b-out{background:#faeeda;color:#633806}
#main{margin-left:var(--sw);padding:40px 48px 80px;max-width:calc(var(--sw) + 880px)}
h1.dt{font-size:22px;font-weight:700;color:var(--navy);border-bottom:3px solid var(--navy);padding-bottom:10px;margin-bottom:6px}
.dm{font-size:12px;color:var(--g5);margin-bottom:32px}
h2.sec{font-size:17px;font-weight:700;color:var(--navy);border-left:4px solid var(--navy);padding-left:10px;margin:36px 0 14px;scroll-margin-top:20px}
h3.sub{font-size:14px;font-weight:700;color:var(--navy-l);margin:22px 0 10px;padding-bottom:4px;border-bottom:1px solid var(--g3);scroll-margin-top:20px}
h4.sh4{font-size:13px;font-weight:700;color:var(--tx2);margin:14px 0 8px}
p{margin-bottom:10px;color:var(--tx2)}strong{color:var(--tx)}.tgh strong{color:inherit}
ul,ol{padding-left:20px;margin-bottom:10px;color:var(--tx2)}li{margin-bottom:4px}
.shb{background:var(--navy);color:#fff;border-radius:8px;padding:14px 20px;margin-bottom:18px;scroll-margin-top:16px}
.shb .sn{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:3px}
.shb h2{font-size:15px;font-weight:700;color:#fff;border:none;padding:0;margin:0}
.cl{border-left:3px solid;padding:9px 13px;border-radius:0 5px 5px 0;margin:10px 0;font-size:13px}
.cl-w{border-color:var(--red);background:var(--red-s)}.cl-i{border-color:var(--blue);background:var(--blue-s)}.cl-t{border-color:var(--green);background:var(--green-s)}.cl-n{border-color:var(--gold);background:var(--gold-s)}
.tw{overflow-x:auto;margin:10px 0}
table{width:100%;border-collapse:collapse;font-size:12.5px}
thead th{background:var(--navy);color:#fff;padding:7px 10px;text-align:left;font-weight:600;font-size:12px;white-space:nowrap}
tbody tr:nth-child(even){background:var(--g1)}
tbody td{padding:7px 10px;border-bottom:1px solid var(--g3);vertical-align:top;line-height:1.55}
tbody tr:hover{background:#f0f4ff}
td.tc{font-weight:600;white-space:nowrap;color:var(--navy);font-size:12px;min-width:150px}
td.tcr{font-weight:700;color:var(--red)}
.tg{display:grid;grid-template-columns:74px 1fr 1fr;gap:1px;background:var(--g3);border:1px solid var(--g3);border-radius:6px;overflow:hidden;margin:10px 0}
.tgh{background:var(--navy);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;padding:12px 14px}
.tgh.r{background:var(--navy-l)}
.tgc{background:#fff;padding:12px 14px}
.tgt{font-size:12.5px;font-weight:700;color:var(--navy);margin-bottom:4px}
.tgb{font-size:12px;color:var(--tx2);line-height:1.6}
.tgn{font-size:10px;color:var(--g5);margin-top:4px}
.sl{display:grid;gap:7px;margin:10px 0}
.tag{display:inline-block;font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;margin-right:3px}
.ts1{background:#e6f1fb;color:#0c447c}.ts2{background:#eaf3de;color:#27500a}.ts3{background:#e1f5ee;color:#085041}.ts4{background:#faece7;color:#712b13}.ts5{background:#fbeaf0;color:#72243e}.ts6{background:#faeeda;color:#633806}.ts7{background:#eeedfe;color:#3c3489}
.pl{list-style:none;padding:0;margin:7px 0}
.pl li{padding:6px 10px 6px 28px;position:relative;border-bottom:1px solid var(--g2);font-size:12.5px;color:var(--tx2)}
.pl li::before{content:"⚠";position:absolute;left:7px;font-size:11px}
.pl li:last-child{border-bottom:none}
.ap{background:var(--g1);border-radius:8px;padding:18px 22px;margin-bottom:18px}
.pb{display:inline-block;font-size:10px;font-weight:700;background:#fde8ea;color:#a32d2d;padding:1px 6px;border-radius:3px;margin-left:5px}
hr.sd{border:none;border-top:2px solid var(--g2);margin:36px 0}
.dw{background:var(--g1);border:1px solid var(--g3);border-radius:6px;padding:14px 14px 10px;margin:10px 0}
.dtitle{font-size:10px;font-weight:700;color:var(--g5);letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px}
.dleg{display:flex;gap:16px;margin-top:8px;padding-top:7px;border-top:1px solid var(--g3);flex-wrap:wrap}
.dleg span{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--g5)}
/* ===== 再編集版 追加クラス ===== */
.scode{display:inline-block;font-size:11px;font-weight:700;background:var(--navy);color:#fff;padding:1px 8px;border-radius:4px;margin-right:7px;font-family:'SFMono-Regular',Consolas,monospace;letter-spacing:.02em}
.plain{background:var(--green-s);border-left:4px solid var(--green);border-radius:0 6px 6px 0;padding:11px 15px;margin:12px 0;font-size:14px;line-height:1.65}
.plain b{color:#0d6b4e;font-weight:700}
.plain .pll{display:block;font-size:10px;font-weight:700;color:#0d6b4e;letter-spacing:.08em;margin-bottom:3px}
.qbox{border:2px solid var(--navy);border-radius:9px;padding:15px 17px;margin:14px 0;background:#fff}
.qbox .qn{display:inline-block;background:var(--navy);color:#fff;font-size:11px;font-weight:700;padding:3px 11px;border-radius:14px;margin-bottom:9px}
.qbox .qq{font-size:15.5px;font-weight:700;color:var(--navy);margin-bottom:11px;line-height:1.5}
.qopts{display:grid;grid-template-columns:1fr 1fr;gap:11px}
@media(max-width:640px){.qopts{grid-template-columns:1fr}}
.qopt{border:1px solid var(--g3);border-radius:7px;padding:11px 13px;font-size:12.5px;color:var(--tx2);line-height:1.55}
.qopt b{display:block;color:var(--navy);font-size:13.5px;margin-bottom:3px}
.qopt .qr{display:block;font-size:11px;color:var(--g5);margin-top:5px}
.mapwrap{margin:12px 0}
.mapt{width:100%;border-collapse:separate;border-spacing:6px}
.mapt th{background:var(--navy);color:#fff;font-size:12px;font-weight:700;padding:9px;border-radius:6px;text-align:center}
.mapt td.rh{background:var(--navy-l);color:#fff;font-size:12px;font-weight:700;padding:9px 11px;border-radius:6px;text-align:left;min-width:150px;white-space:nowrap}
.cell{border-radius:7px;padding:11px 12px;text-decoration:none;display:block;border:1px solid transparent;transition:transform .12s}
.cell:hover{transform:translateY(-1px)}
.cell .cc{font-family:'SFMono-Regular',Consolas,monospace;font-size:11px;font-weight:700}
.cell .cn{font-size:13px;font-weight:700;margin-top:2px}
.cell .cd{font-size:11px;margin-top:3px;line-height:1.45;opacity:.85}
.cell.in{background:var(--green-s);color:#0d6b4e;border-color:#bfe6d8}
.cell.out{background:var(--gold-s);color:#7a4d09;border-color:#f0d9ad}
.cell.gap{background:repeating-linear-gradient(45deg,#fff,#fff 7px,#f3f3f3 7px,#f3f3f3 14px);color:#9aa0a6;border:1px dashed #c8ccd1}
.grp{font-size:12px;font-weight:700;color:#fff;background:var(--navy);border-radius:6px;padding:7px 13px;margin:22px 0 4px;display:flex;align-items:center;gap:8px}
.grp.ingrp{background:#1d9e75}.grp.outgrp{background:#c47d1a}
.legcard{display:flex;gap:18px;flex-wrap:wrap;background:var(--g1);border:1px solid var(--g3);border-radius:8px;padding:12px 16px;margin:10px 0}
.legcard div{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--tx2)}
.legcard .sw{width:22px;height:0;border-top-width:2.5px;border-top-style:solid}
.box{display:inline-block;width:13px;height:13px;border-radius:3px;vertical-align:middle}

/* ===== インタラクティブ検索UI ===== */
.finder{background:linear-gradient(145deg,#f5f8fc 0%,#fff 55%,#f5fbf8 100%);border:1px solid #d8e1eb;border-radius:14px;padding:24px;margin:8px 0 22px;scroll-margin-top:18px;box-shadow:0 6px 22px rgba(29,53,87,.07)}
.finder-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}.finder-head h2{font-size:21px;color:var(--navy);line-height:1.35;margin:3px 0 6px}.finder-head p{max-width:680px;margin:0}.finder-kicker{font-size:10px;font-weight:800;letter-spacing:.14em;color:var(--green)}
.btn-reset,.link-button{border:0;background:none;font:inherit;cursor:pointer}.btn-reset{white-space:nowrap;border:1px solid var(--g3);background:#fff;color:var(--tx2);border-radius:7px;padding:7px 11px;font-size:11.5px}.btn-reset:hover{border-color:var(--navy);color:var(--navy)}
.finder-progress{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin:16px 0 22px}.prog{display:flex;align-items:center;justify-content:center;gap:6px;background:#e8edf3;color:#7a8490;padding:7px 5px;font-size:10.5px;font-weight:700}.prog:first-child{border-radius:7px 0 0 7px}.prog:last-child{border-radius:0 7px 7px 0}.prog b{display:inline-flex;width:19px;height:19px;align-items:center;justify-content:center;border-radius:50%;background:#fff;font-size:10px}.prog.active{background:var(--navy);color:#fff}.prog.done{background:#dff3ec;color:#0d6b4e}
.selected-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #d7e2ec;background:#fff;border-radius:8px;padding:8px 11px;margin-bottom:15px}.selected-label{font-size:10px;font-weight:700;color:var(--g5);margin-right:7px}.sel-chip{display:inline-block;background:#eef3f8;color:var(--navy);border-radius:999px;padding:2px 8px;font-size:10.5px;font-weight:700;margin:2px 3px}.link-button{color:var(--blue);font-size:11.5px;text-decoration:underline;white-space:nowrap}
.finder-step{animation:fadein .18s ease}@keyframes fadein{from{opacity:.2;transform:translateY(3px)}to{opacity:1;transform:none}}.step-title{display:flex;gap:10px;align-items:flex-start;margin:8px 0 13px}.step-title>span{display:inline-flex;background:var(--navy);color:#fff;border-radius:14px;font-size:10.5px;font-weight:800;padding:3px 9px}.step-title b{display:block;color:var(--navy);font-size:15.5px;line-height:1.45}.step-title small{display:block;color:var(--g5);font-size:11.5px;margin-top:2px}
.choice-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.choice-grid-4{grid-template-columns:1fr 1fr}.choice-card{appearance:none;text-align:left;width:100%;border:1px solid #d5dde5;background:#fff;border-radius:10px;padding:15px;cursor:pointer;transition:border-color .14s,box-shadow .14s,transform .14s;font-family:inherit;color:var(--tx2)}.choice-card:hover,.choice-card:focus-visible{border-color:var(--navy);box-shadow:0 5px 14px rgba(29,53,87,.09);transform:translateY(-1px);outline:none}.choice-card.selected{border:2px solid var(--green);padding:14px;background:#f5fcf9}.choice-card b{display:block;color:var(--navy);font-size:13.5px;line-height:1.45;margin:4px 0}.choice-card small{display:block;font-size:11.5px;line-height:1.55;color:var(--tx2)}.choice-card em{display:inline-block;font-style:normal;font-size:9.5px;font-weight:700;color:#0d6b4e;background:var(--green-s);border-radius:4px;padding:2px 6px;margin-top:8px}.choice-icon{font-size:9.5px;font-weight:800;letter-spacing:.05em;color:var(--gold)}.choice-card.compact{min-height:92px}
.finder-result{border:2px solid var(--navy);background:#fff;border-radius:12px;overflow:hidden;animation:fadein .2s ease}.result-head{background:var(--navy);color:#fff;padding:17px 20px}.result-eyebrow{font-size:10px;font-weight:700;color:rgba(255,255,255,.6);letter-spacing:.1em}.result-head h3{font-size:19px;margin:2px 0 3px}.result-head p{color:rgba(255,255,255,.82);margin:0}.result-body{padding:19px 20px}.result-grid{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin:14px 0}.result-panel{background:var(--g1);border-radius:8px;padding:13px 15px}.result-panel.full{grid-column:1/-1}.result-panel h4{color:var(--navy);font-size:12px;margin-bottom:6px}.result-panel ul{margin:0;padding-left:18px;font-size:12px}.result-reason{border-left:4px solid var(--green);background:var(--green-s);padding:10px 13px;margin-bottom:13px}.result-alert{border-left:4px solid var(--red);background:var(--red-s);padding:10px 13px;margin:12px 0}.result-note{border-left:4px solid var(--gold);background:var(--gold-s);padding:10px 13px;margin:12px 0}.result-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.result-actions a,.result-actions button{display:inline-flex;align-items:center;justify-content:center;border-radius:7px;padding:8px 13px;font-size:11.5px;font-weight:700;text-decoration:none;cursor:pointer;font-family:inherit}.primary-action{background:var(--navy);color:#fff;border:1px solid var(--navy)}.secondary-action{background:#fff;color:var(--navy);border:1px solid #b7c4d1}.result-memo{margin-top:13px;border-top:1px solid var(--g3);padding-top:12px}.result-memo pre{display:none;white-space:pre-wrap;background:#f7f8fa;border:1px solid var(--g3);border-radius:7px;padding:11px;font:11px/1.6 'SFMono-Regular',Consolas,monospace;color:var(--tx2);margin-top:9px}.result-memo.open pre{display:block}
.result-contract-table{font-size:11.5px;margin-top:4px}.result-contract-table th,.result-contract-table td{padding:7px 8px}.result-contract-table td:first-child{font-weight:700;color:var(--navy);white-space:nowrap}.contract-intro{font-size:12px;color:var(--tx2);margin:5px 0 8px}.contract-kind{display:inline-block;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap}.ck-main{background:var(--navy);color:#fff}.ck-pre{background:var(--red-s);color:#8d2630}.ck-exec{background:var(--green-s);color:#0d6b4e}.ck-cond{background:var(--gold-s);color:#7a4d09}.contract-table td:nth-child(1){width:70px}.contract-table td:nth-child(2){min-width:175px;font-weight:700;color:var(--navy)}.contract-table td:nth-child(3){min-width:205px}
.example-search{border-top:1px solid var(--g3);margin-top:20px;padding-top:14px}.example-search summary{cursor:pointer;color:var(--navy);font-weight:700}.example-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:11px}.example-grid button,.example-grid a{text-align:left;border:1px solid var(--g3);background:#fff;color:var(--tx2);border-radius:7px;padding:8px 10px;font:11.5px/1.45 inherit;text-decoration:none;cursor:pointer}.example-grid button:hover,.example-grid a:hover{border-color:var(--navy);color:var(--navy)}.finder-links{display:flex;gap:14px;flex-wrap:wrap;margin-top:17px}.finder-links a{font-size:11.5px;color:var(--blue)}.nav-code{float:right;font-size:9px;color:rgba(255,255,255,.35)}
@media(max-width:760px){:root{--sw:0px}#sidebar{position:static;width:100%;height:auto;max-height:none}#sidebar nav{display:none}#main{margin-left:0;padding:22px 16px 60px;max-width:none}.finder{padding:17px}.finder-head{display:block}.btn-reset{margin-top:10px}.finder-progress{grid-template-columns:1fr 1fr}.prog:first-child,.prog:last-child{border-radius:5px}.choice-grid,.choice-grid-4,.result-grid,.example-grid{grid-template-columns:1fr}.selected-bar{align-items:flex-start}.mapt td.rh{min-width:118px}.dm{margin-bottom:20px}}
@media print{#sidebar,.finder-progress,.btn-reset,.finder-links,.example-search,.result-actions,.selected-bar{display:none!important}#main{margin:0;padding:20px;max-width:none}.finder{box-shadow:none}}

.contract-table td:nth-child(4){min-width:210px}.contract-table td:nth-child(5){min-width:285px}.contract-checks{margin:0;padding-left:16px;font-size:11.5px;line-height:1.5;color:var(--tx2)}.contract-checks li{margin-bottom:3px}.contract-checks li:last-child{margin-bottom:0}.result-contract-table td:nth-child(4){min-width:190px}.result-contract-table td:nth-child(5){min-width:270px}.result-contract-table .contract-checks{font-size:11px}.result-panel.full .tw{max-height:520px;overflow:auto}
</style>
<style id="gas-portal-back-style">
.portal-back-button{position:fixed;right:16px;bottom:16px;z-index:3000;display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:999px;background:#1d3557;color:#fff;text-decoration:none;font-size:12px;font-weight:700;box-shadow:0 3px 12px rgba(0,0,0,.22);opacity:.92;transition:opacity .15s,transform .15s}
.portal-back-button:hover{opacity:1;transform:translateY(-1px)}
@media print{.portal-back-button{display:none}}
</style>
</head>
<body>
<?!= include('common_top_tabs', { appUrl: appUrl, currentPage: currentPage }); ?>
<aside id="sidebar">
<div id="sh"><h1>法務部</h1><p>BG事業部<br/>契約スキーム実務ガイド<br/><span style="font-size:10px;color:rgba(255,255,255,.55);font-weight:400">インタラクティブ版</span></p></div>
<nav>
<span class="ns">スキームを探す</span>
<a class="nl" href="#finder">取引内容から検索</a>
<a class="nsub" href="#examples">具体例から検索</a>
<a class="nl" href="#map">全スキーム一覧</a>
<span class="ns">スキーム詳細</span>
<a class="nl" href="#in"><span class="bdg b-in">IN</span>受け取る・仕入れる</a>
<a class="nsub" href="#s1">国内ライセンスイン <span class="nav-code">S1</span></a>
<a class="nsub" href="#s5">海外ライセンスイン <span class="nav-code">S5</span></a>
<a class="nsub" href="#s4">海外プロダクトイン <span class="nav-code">S4</span></a>
<a class="nsub" href="#sPin">国内プロダクトイン（未整備）</a>
<a class="nl" href="#out"><span class="bdg b-out">OUT</span>渡す・供給する</a>
<a class="nsub" href="#s7">国内ライセンスアウト <span class="nav-code">S7</span></a>
<a class="nsub" href="#s2">海外ライセンスアウト <span class="nav-code">S2</span></a>
<a class="nsub" href="#s6">国内プロダクトアウト <span class="nav-code">S6</span></a>
<a class="nsub" href="#s3">海外プロダクトアウト <span class="nav-code">S3</span></a>
<a class="nl" href="#combo">複合取引・コラボ</a>
<span class="ns">資料</span>
<a class="nl" href="#terms">用語集</a>
<a class="nsub" href="#terms-acr">略語のはやわかり</a>
<a class="nl" href="#appa">A 新旧・スキーム対応表</a>
<a class="nl" href="#appb">B 補助契約</a>
<a class="nl" href="#appc">C 共通の必須6項目</a>
</nav>
</aside>
<main id="main">
<h1 class="dt">BG事業部 契約スキーム実務ガイド（契約別確認事項追加版）</h1>
<p class="dm">作成日：2026年4月／再編集：2026年6月　法務部次長 倉持達也　｜　対象：BG事業部担当者（法務相談前の社内検討用）</p>
<section aria-labelledby="finder-title" class="finder" id="finder">
<div class="finder-head">
<div>
<span class="finder-kicker">SCHEME FINDER</span>
<h2 id="finder-title">今回の取引に合う契約スキームを探す</h2>
<p>専門用語を覚える前に、まず「誰が製造または製造委託を管理するか」を選んでください。製造主体とIPの利用関係から、推奨スキーム、確認事項、類似スキームを表示します。</p>
</div>
<button class="btn-reset" id="finder-reset" type="button">選択をリセット</button>
</div>
<div aria-label="検索の進行状況" class="finder-progress">
<span class="prog active" data-prog="1"><b>1</b>製造主体</span>
<span class="prog" data-prog="2"><b>2</b>取引関係</span>
<span class="prog" data-prog="3"><b>3</b>相手所在地</span>
<span class="prog" data-prog="4"><b>4</b>追加確認</span>
<span class="prog" data-prog="5"><b>✓</b>検索結果</span>
</div>
<div class="selected-bar" hidden="" id="selected-bar">
<div><span class="selected-label">現在の選択</span><span id="selected-chips"></span></div>
<button class="link-button" id="finder-back" type="button">1つ前に戻る</button>
</div>
<div class="finder-step" id="finder-step1">
<div class="step-title"><span>Q1</span><div><b>商品の製造または製造委託を管理するのはどちらですか？</b><small>実際の工場ではなく、仕様・発注先・製造費・品質・納期を管理する主体で選んでください。</small></div></div>
<div class="choice-grid choice-grid-4">
<button class="choice-card" data-maker="company" type="button">
<span class="choice-icon">当社が製造主体</span><b>当社が製造または製造委託を行う</b><small>当社が工場等へ発注し、製造費・品質・納期・余剰在庫の責任を負う</small>
</button>
<button class="choice-card" data-maker="counterparty" type="button">
<span class="choice-icon">相手方が製造主体</span><b>相手方が製造または製造委託を行う</b><small>相手方または相手方指定の供給者が完成品を準備し、製造責任を負う</small>
</button>
<button class="choice-card" data-maker="mixed" type="button">
<span class="choice-icon">共同・未確定</span><b>双方が分担する／まだ決まっていない</b><small>共同商品化、費用分担、指定工場などにより製造責任が一方に定まらない</small>
</button>
</div>
</div>
<div class="finder-step" hidden="" id="finder-step2"></div>
<div class="finder-step" hidden="" id="finder-step3">
<div class="step-title"><span>Q3</span><div><b>契約相手はどこに所在しますか？</b><small>商品の販売地域ではなく、原則として契約当事者の所在地で選びます。</small></div></div>
<div class="choice-grid">
<button class="choice-card compact" data-region="domestic" type="button"><b>日本国内</b><small>日本法人または国内の個人・団体との契約</small></button>
<button class="choice-card compact" data-region="overseas" type="button"><b>海外</b><small>外国法人または海外の個人・団体とのクロスボーダー契約</small></button>
</div>
</div>
<div class="finder-step" hidden="" id="finder-step4"></div>
<div aria-live="polite" class="finder-result" hidden="" id="finder-result"></div>
<details class="example-search" id="examples">
<summary>具体例から探す</summary>
<div class="example-grid">
<button data-example="s5" type="button">海外ゲームの日本語版を当社が作る</button>
<button data-example="s4" type="button">海外側が製造した完成品を輸入する</button>
<button data-example="s7" type="button">当社IPを国内企業の商品に使わせる</button>
<button data-example="s2" type="button">当社IPを海外企業に現地語化させる</button>
<button data-example="s6" type="button">当社が製造した商品を国内企業へ卸す</button>
<button data-example="s3" type="button">海外企業の注文に基づき当社が製造する</button>
<a href="#combo">複数IPを組み合わせたコラボ製品</a>
</div>
</details>
<div class="finder-links">
<a href="#map">全スキーム一覧から探す</a>
<a href="#terms">用語集から探す</a>
<a href="#combo">複合取引・コラボを確認する</a>
</div>
</section>
<div class="cl cl-i"><strong>このガイドの使い方：</strong>検索結果で型を選び、該当スキームの詳細で「事業部が決めておく条件」と「よくある落とし穴」を確認してください。既存のS番号はテンプレートや他資料との互換のため維持しています。</div><div class="cl cl-n"><strong>契約別確認事項の見方：</strong>検索結果と各スキーム詳細には、契約ごとに「契約前の確認事項」を表示します。取引全体の条件だけでなく、主契約・前提契約・実行契約ごとに当事者、権限、対象範囲、対価、責任分担を確認してください。</div>
<hr class="sd"/>
<!-- ===== 全体マップ ===== -->
<h2 class="sec" id="map">全スキーム一覧から探す</h2>
<p>基本となる取引を「IPを誰が利用するか」「誰が製造・製造委託を管理するか」「国内／海外」で一覧化しています。売主・買主はスキームの出発点ではなく、完成品を供給した結果として整理します。各マスをクリックすると詳細に移動します。</p>
<div class="cl cl-t"><strong>判定の中心は製造主体です。</strong> ライセンス型では利用許諾を受ける側が製造主体となり、プロダクト型では供給側が製造主体となります。製造主体とは、仕様・製造委託先・製造費・品質・納期・在庫を管理する当事者をいいます。</div>
<div class="mapwrap"><table class="mapt">
<thead><tr><th style="background:transparent"></th><th>国内</th><th>海外</th></tr></thead>
<tbody>
<tr>
<td class="rh" style="background:#1d9e75">当社がIPを利用・製造<br/><span style="font-weight:400;font-size:10px">ライセンス・イン</span></td>
<td><a class="cell in" href="#s1"><span class="cc">S1</span><span class="cn">国内ライセンスイン</span><span class="cd">国内権利者のIPを当社が利用し、当社が製造・販売する</span></a></td>
<td><a class="cell in" href="#s5"><span class="cc">S5</span><span class="cn">海外ライセンスイン</span><span class="cd">海外版元のIPを当社が利用し、当社が日本語版を製造する</span></a></td>
</tr>
<tr>
<td class="rh" style="background:#1d9e75">相手方が製造・当社が仕入れ<br/><span style="font-weight:400;font-size:10px">プロダクト・イン</span></td>
<td><a class="cell gap" href="#sPin"><span class="cc">（空白）</span><span class="cn">国内プロダクトイン</span><span class="cd">国内相手が製造した完成品を当社が仕入れる／未整備</span></a></td>
<td><a class="cell in" href="#s4"><span class="cc">S4</span><span class="cn">海外プロダクトイン</span><span class="cd">海外相手が製造した完成品を当社が輸入・販売する</span></a></td>
</tr>
<tr>
<td class="rh" style="background:#c47d1a">相手方がIPを利用・製造<br/><span style="font-weight:400;font-size:10px">ライセンス・アウト</span></td>
<td><a class="cell out" href="#s7"><span class="cc">S7</span><span class="cn">国内ライセンスアウト</span><span class="cd">国内相手にIPを利用させ、相手が製造・販売する</span></a></td>
<td><a class="cell out" href="#s2"><span class="cc">S2</span><span class="cn">海外ライセンスアウト</span><span class="cd">海外相手にIPを利用させ、相手が現地で製造・販売する</span></a></td>
</tr>
<tr>
<td class="rh" style="background:#c47d1a">当社が製造・相手方へ供給<br/><span style="font-weight:400;font-size:10px">プロダクト・アウト</span></td>
<td><a class="cell out" href="#s6"><span class="cc">S6</span><span class="cn">国内プロダクトアウト/OEM</span><span class="cd">当社が製造・製造委託した完成品を国内相手へ供給する</span></a></td>
<td><a class="cell out" href="#s3"><span class="cc">S3</span><span class="cn">海外プロダクトアウト/受託</span><span class="cd">当社が製造・製造委託した完成品を海外相手へ供給する</span></a></td>
</tr>
</tbody>
</table></div>
<div class="cl cl-w"><strong>所在地と製造形態は別に確認します。</strong>プロダクトアウトは、国内・海外を問わず「自主製造・卸売型」と「受注製造型」があります。検索では両者を追加質問で区別し、現行S番号に完全一致しない場合は個別設計へ誘導します。</div>
<div class="legcard">
<div><span class="box" style="background:#4B8BDB"></span>青の点線＝権利（ライセンス）の許可</div>
<div><span class="box" style="background:#1D9E75"></span>緑の実線＝製品・モノの流れ</div>
<div><span class="box" style="background:#C47D1A"></span>金＝お金（代金・ロイヤルティ）</div>
<div><span class="box" style="background:#1d3557"></span>紺の★＝当社（アークライト）</div>
</div>
<hr class="sd"/>
<!-- ===================== IN ===================== -->
<div class="grp ingrp" id="in" style="scroll-margin-top:16px">▼ イン ── 当社が相手方IPを利用して製造する／相手方製造品を仕入れる</div>
<!-- S1 -->
<div class="shb" id="s1"><div class="sn">イン × ライセンス × 国内</div><h2><span class="scode">S1</span>国内ライセンスイン</h2></div>
<div class="plain"><span class="pll">ひとことで言うと</span><b>日本のクリエイターや会社からIPの利用許諾を受け、当社が作って売る。</b></div>
<div class="cl cl-i"><strong>製造・製造委託の主体：</strong><strong>当社</strong>。当社が仕様・製造委託先・品質・納期を管理します。<br/><strong>利用許諾上の立場：</strong>ライセンサー＝相手（国内クリエイター・会社）／ライセンシー＝<strong>当社</strong>。</div>
<h4 class="sh4">必要な契約・締結相手・契約前の確認事項</h4>
<p class="contract-intro">主契約でIPの利用許諾を確保し、当社が外部へ制作・製造を委託する場合は実行契約を別途締結します。 右欄は、担当者が法務相談前に確認・整理する事項です。</p>
<div class="tw"><table class="contract-table"><thead><tr><th>区分</th><th>必要な契約</th><th>締結相手・当社の立場</th><th>目的・必要となる場合</th><th>契約前の確認事項</th></tr></thead><tbody>
<tr><td><span class="contract-kind ck-main">主契約</span></td><td>国内IP利用許諾契約</td><td>国内の権利者と締結<br/>当社＝ライセンシー</td><td>対象IP、利用方法、商品、地域・販路、独占性、ロイヤルティ、監修等を定める</td><td><ul class="contract-checks"><li>許諾者が対象IPを単独で許諾できるか</li><li>対象IP・商品／媒体・販路・地域・期間・独占性</li><li>ロイヤルティ／MG・計算基礎・報告／監査方法</li><li>監修・改変・成果物の権利・終了後在庫の取扱い</li></ul></td></tr>
<tr><td><span class="contract-kind ck-pre">前提</span></td><td>権利確認書・共同権利者同意書</td><td>共同著作者、所属会社、権利管理会社等から取得</td><td>契約相手が単独で許諾できない場合、必要な同意・権限を確保する</td><td><ul class="contract-checks"><li>著作権・商標権等の原始帰属と譲渡履歴</li><li>共同著作者・所属会社・権利管理会社の同意範囲</li><li>第三者素材・肖像・名称等が含まれていないか</li><li>権限保証、紛争発生時の協力・補償</li></ul></td></tr>
<tr><td><span class="contract-kind ck-exec">実行</span></td><td>制作・翻訳・製造委託契約／発注書</td><td>翻訳者、デザイナー、製造会社等と締結<br/>当社＝委託者</td><td>当社がローカライズ、デザイン、製造を外部委託する場合</td><td><ul class="contract-checks"><li>成果物・仕様・納期・修正回数・変更手続</li><li>請負／準委任の区分、検収・再実施・支払条件</li><li>著作権帰属・二次利用・著作者人格権不行使</li><li>再委託、秘密保持、支給素材、品質・不良対応</li></ul></td></tr>
</tbody></table></div>
<div class="dw"><div class="dtitle">商流：S1 国内ライセンスイン</div>
<svg aria-hidden="true" style="width:100%;display:block" viewbox="0 0 560 92">
<defs><marker id="alic" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#4B8BDB" points="0 0,7 3,0 6"></polygon></marker><marker id="aprd" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#1D9E75" points="0 0,7 3,0 6"></polygon></marker><marker id="amny" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#C47D1A" points="0 0,7 3,0 6"></polygon></marker></defs>
<rect fill="#fff" height="42" rx="6" stroke="#9CA3AF" stroke-width="1.2" width="150" x="10" y="26"></rect><text fill="#374151" font-family="sans-serif" font-size="12" font-weight="600" text-anchor="middle" x="85" y="44">ライセンサー</text><text fill="#9CA3AF" font-family="sans-serif" font-size="9" text-anchor="middle" x="85" y="58">国内クリエイター・会社</text>
<rect fill="#1d3557" height="50" rx="8" width="150" x="205" y="22"></rect><text fill="#fff" font-family="sans-serif" font-size="13" font-weight="600" text-anchor="middle" x="280" y="44">当社 ★</text><text fill="rgba(255,255,255,.6)" font-family="sans-serif" font-size="9" text-anchor="middle" x="280" y="58">製造・販売</text>
<rect fill="rgba(0,0,0,.02)" height="30" rx="6" stroke="#B5C6D4" stroke-dasharray="4,2" stroke-width="1.2" width="150" x="400" y="32"></rect><text fill="#6B7280" font-family="sans-serif" font-size="11" font-weight="600" text-anchor="middle" x="475" y="51">国内市場</text>
<line marker-end="url(#alic)" stroke="#4B8BDB" stroke-dasharray="5,3" stroke-width="1.5" x1="162" x2="203" y1="38" y2="38"></line><text fill="#4B8BDB" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="33">許可</text>
<line marker-end="url(#amny)" stroke="#C47D1A" stroke-width="1.5" x1="203" x2="162" y1="56" y2="56"></line><text fill="#C47D1A" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="68">ロイヤルティ</text>
<line marker-end="url(#aprd)" stroke="#1D9E75" stroke-width="1.5" x1="357" x2="398" y1="47" y2="47"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="378" y="42">製造・販売</text>
</svg></div>
<div class="cl cl-t"><strong>海外展開が見込まれるなら、S1の時点で海外許諾の範囲まで上流と合意</strong>しておくと、後の追加交渉（→S2/S3）が不要になります。</div>
<h4 class="sh4">ライセンサーが個人クリエイターの場合の固有論点</h4>
<div class="tw"><table><thead><tr><th>論点</th><th>内容</th></tr></thead><tbody>
<tr><td class="tc">職務著作の確認</td><td>ライセンサーに所属会社・団体があれば、著作権が個人に帰属するか事前確認</td></tr>
<tr><td class="tc">活動継続性</td><td>専業か副業か・他社との交渉状況・活動休止リスクを把握</td></tr>
<tr><td class="tc">権利継承</td><td>契約期間中に活動停止（病気・廃業等）した場合の対応を決めておく</td></tr>
</tbody></table></div>
<h4 class="sh4">事業部が決めておく条件</h4>
<div class="tw"><table><thead><tr><th>項目</th><th>決める内容</th><th>目安・注意点</th></tr></thead><tbody>
<tr><td class="tc">ロイヤルティ計算基礎</td><td>定価ベース（国内慣行）</td><td>実売ベースはライセンサー有利だが管理コスト増</td></tr>
<tr><td class="tc">MG金額・支払時期</td><td>契約時/製造確定時/発売時の分割比率</td><td>分割払いは当社有利。一括を求めるライセンサーも多い</td></tr>
<tr><td class="tc">重版時のMG</td><td>重版ごとにMGが追加発生するか</td><td>「初版MGのみ、以降はロイヤルティ」が多い</td></tr>
<tr><td class="tc">監修ターンアラウンド</td><td>ライセンサーが何営業日以内に返答するか</td><td>10〜15営業日。沈黙承認ルールとセットで</td></tr>
<tr><td class="tc">監修フローの段階・回数</td><td>ラフ/試作/最終の段階数と修正回数上限</td><td>無制限修正は工数が読めない</td></tr>
<tr><td class="tc">販売テリトリー</td><td>国内のみで締結（海外はS2/S3で別途）</td><td>将来の海外展開が見込まれるなら拡張条件を覚書で先に合意</td></tr>
<tr><td class="tc">在庫消化期間</td><td>契約終了後に在庫を売れる期間</td><td>通常6ヶ月〜1年</td></tr>
</tbody></table></div>
<h4 class="sh4">よくある落とし穴</h4>
<ul class="pl">
<li>国内で締結後に海外展開の話が出て、上流ライセンサーへ追加許諾の交渉が発生した（→S1時点で海外範囲も合意しておく）</li>
<li>個人ライセンサーの監修が遅く、ゲームマーケットの発売が崩れた（沈黙承認ルール未設定）</li>
<li>独占を付与したのにMRGを設けず、他社にも展開できない「塩漬け」状態が続いた</li>
<li>重版時のMG発生有無を決めず、重版のたびに交渉が発生した</li>
</ul>
<hr class="sd"/>
<!-- S5 -->
<div class="shb" id="s5"><div class="sn">イン × ライセンス × 海外</div><h2><span class="scode">S5</span>海外ライセンスイン</h2></div>
<div class="plain"><span class="pll">ひとことで言うと</span><b>海外の版元からIPの利用許諾を受け、当社が日本語版を作って売る。</b></div>
<div class="cl cl-i"><strong>製造・製造委託の主体：</strong><strong>当社</strong>。当社が日本語版の仕様・製造委託先・品質・納期を管理します。<br/><strong>利用許諾上の立場：</strong>ライセンサー＝相手（海外版元）／ライセンシー＝<strong>当社</strong>。</div>
<h4 class="sh4">必要な契約・締結相手・契約前の確認事項</h4>
<p class="contract-intro">海外版元との利用許諾契約が中心です。開示・交渉段階と、国内での制作・製造段階を分けて契約します。 右欄は、担当者が法務相談前に確認・整理する事項です。</p>
<div class="tw"><table class="contract-table"><thead><tr><th>区分</th><th>必要な契約</th><th>締結相手・当社の立場</th><th>目的・必要となる場合</th><th>契約前の確認事項</th></tr></thead><tbody>
<tr><td><span class="contract-kind ck-main">主契約</span></td><td>国際IP利用許諾契約<br/>（Master＋個別条件書）</td><td>海外版元・権利者と締結<br/>当社＝ライセンシー</td><td>言語、地域、商品、独占性、MG・ロイヤルティ、監修、製造、準拠法等を定める</td><td><ul class="contract-checks"><li>契約主体・署名権限・対象IPの許諾権限</li><li>言語・地域・商品・媒体・製造権・再許諾の範囲</li><li>MG／ロイヤルティ、通貨・税・送金、報告／監査</li><li>ローカライズ・改変・監修期限・承認手続</li><li>期間・更新・sell-off・準拠法・紛争解決</li></ul></td></tr>
<tr><td><span class="contract-kind ck-cond">条件付</span></td><td>NDA</td><td>海外版元・権利者と締結</td><td>未発表作品、販売計画、原価、翻訳データ等を本契約前に開示する場合</td><td><ul class="contract-checks"><li>検討目的と秘密情報の定義・除外情報</li><li>グループ会社・翻訳者・製造先への共有可否</li><li>秘密保持期間、返還・消去、複製物の管理</li><li>準拠法、差止め、既存NDAとの優先関係</li></ul></td></tr>
<tr><td><span class="contract-kind ck-exec">実行</span></td><td>翻訳・制作・製造委託契約／発注書</td><td>翻訳者、制作会社、製造会社等と締結<br/>当社＝委託者</td><td>日本語版の翻訳、組版、デザイン、製造を外部委託する場合</td><td><ul class="contract-checks"><li>上流契約上の仕様・監修・秘密保持条件を反映したか</li><li>成果物・版管理・納期・修正・検収手続</li><li>翻訳・デザイン等の権利帰属と人格権不行使</li><li>再委託先、支給データ、製造品質・不良時の責任</li></ul></td></tr>
</tbody></table></div>
<div class="dw"><div class="dtitle">商流：S5 海外ライセンスイン</div>
<svg aria-hidden="true" style="width:100%;display:block" viewbox="0 0 560 92">
<defs><marker id="blic" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#4B8BDB" points="0 0,7 3,0 6"></polygon></marker><marker id="bprd" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#1D9E75" points="0 0,7 3,0 6"></polygon></marker><marker id="bmny" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#C47D1A" points="0 0,7 3,0 6"></polygon></marker></defs>
<rect fill="#fff" height="42" rx="6" stroke="#9CA3AF" stroke-width="1.2" width="150" x="10" y="26"></rect><text fill="#374151" font-family="sans-serif" font-size="12" font-weight="600" text-anchor="middle" x="85" y="44">ライセンサー</text><text fill="#9CA3AF" font-family="sans-serif" font-size="9" text-anchor="middle" x="85" y="58">海外版元</text>
<rect fill="#1d3557" height="50" rx="8" width="150" x="205" y="22"></rect><text fill="#fff" font-family="sans-serif" font-size="13" font-weight="600" text-anchor="middle" x="280" y="44">当社 ★</text><text fill="rgba(255,255,255,.6)" font-family="sans-serif" font-size="9" text-anchor="middle" x="280" y="58">日本語版を製造・販売</text>
<rect fill="rgba(0,0,0,.02)" height="30" rx="6" stroke="#B5C6D4" stroke-dasharray="4,2" stroke-width="1.2" width="150" x="400" y="32"></rect><text fill="#6B7280" font-family="sans-serif" font-size="11" font-weight="600" text-anchor="middle" x="475" y="51">国内市場</text>
<line marker-end="url(#blic)" stroke="#4B8BDB" stroke-dasharray="5,3" stroke-width="1.5" x1="162" x2="203" y1="38" y2="38"></line><text fill="#4B8BDB" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="33">許可</text>
<line marker-end="url(#bmny)" stroke="#C47D1A" stroke-width="1.5" x1="203" x2="162" y1="56" y2="56"></line><text fill="#C47D1A" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="68">ロイヤルティ/MG</text>
<line marker-end="url(#bprd)" stroke="#1D9E75" stroke-width="1.5" x1="357" x2="398" y1="47" y2="47"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="378" y="42">製造・販売</text>
</svg></div>
<div class="cl cl-w"><strong>S4（仕入れ）との違いに注意。</strong>S5は当社が日本語版を「作る」型。製造コスト・ローカライズ・リードタイムを当社がコントロールできる代わりに、製造責任を負います。日本語化が不要・小ロットならS4の方が向く場合があります。</div>
<h4 class="sh4">事業部が決めておく条件</h4>
<div class="tw"><table><thead><tr><th>項目</th><th>決める内容</th><th>目安・注意点</th></tr></thead><tbody>
<tr><td class="tc">ロイヤルティ計算基礎</td><td>定価ベース or 実売ベース</td><td>ライセンサーは定価ベースを好む。「希望小売価格×〇%」が起点</td></tr>
<tr><td class="tc tcr">MG金額</td><td>悲観ケース（最低限売れた場合）で回収できる水準か</td><td><strong>過大MGは後で重荷。「最低限売れた場合」で検証</strong></td></tr>
<tr><td class="tc">MG支払スケジュール</td><td>署名時/サンプル承認時/発売時の分割比率</td><td>発売後払いを増やすほど当社有利</td></tr>
<tr><td class="tc">承認ターンアラウンド</td><td>ライセンサーが何営業日以内に返答するか</td><td>15〜20営業日を明記。沈黙承認も交渉</td></tr>
<tr><td class="tc">ローカライズ自由度</td><td>テキスト変更・アート修正・コンポーネント削除の許容範囲</td><td>国内向け変更をライセンサーが認めるか事前確認</td></tr>
<tr><td class="tc">デジタル版・サブライセンス</td><td>デジタル版・他媒体展開の可否</td><td>後から再交渉にならないよう先に押さえる</td></tr>
<tr><td class="tc">sell-off期間</td><td>契約終了後の在庫消化期間</td><td>6〜12ヶ月。追加製造禁止・既存在庫のみ可を明確化</td></tr>
</tbody></table></div>
<h4 class="sh4">属地的特約（海外イン共通：S4・S5）</h4>
<div class="tw"><table><thead><tr><th>論点</th><th>内容</th></tr></thead><tbody>
<tr><td class="tc">国際消尽（BBS事件・最高裁1997年）</td><td>海外でライセンサーが適法に売った正規品の日本への並行輸入は、原則差し止められない（正規品の並行輸入は適法）</td></tr>
<tr><td class="tc">実務への影響</td><td>ライセンサーの英語版が日本に並行輸入されても原則止められない。「独占インポート権」を契約に書いても法的保護には限界がある</td></tr>
<tr><td class="tc">対応策</td><td>①日本語版限定の特典・専用素材で差別化、②ライセンサーに海外販売チャネルの管理協力を求める、が現実的</td></tr>
<tr><td class="tc">準拠法・紛争解決</td><td>当社は日本法が望ましいが欧米のライセンサーは自国法を主張しがち。外国法人相手は仲裁（JCAA・ICC）の方が執行力が高く有利な場合が多い</td></tr>
</tbody></table></div>
<h4 class="sh4">よくある落とし穴</h4>
<ul class="pl">
<li>独占インポート権を明記したが並行輸入品が流通し、法的に止められなかった（国際消尽）</li>
<li>ライセンサーの承認が遅延しゲームマーケットの発売に間に合わなかった</li>
<li>MGを強気に設定したら初版で回収できず、以降の取引に影響した</li>
<li>準拠法を相手国法のまま締結し、紛争時に日本での権利行使が困難になった</li>
</ul>
<hr class="sd"/>
<!-- S4 -->
<div class="shb" id="s4"><div class="sn">イン × プロダクト × 海外</div><h2><span class="scode">S4</span>海外プロダクトイン</h2></div>
<div class="plain"><span class="pll">ひとことで言うと</span><b>海外版元またはその指定供給者が製造・製造委託した完成品を、当社が輸入し、日本で販売する。</b></div>
<div class="cl cl-i"><strong>製造・製造委託の主体：</strong>相手（海外版元・製造元または指定供給者）。<br/><strong>売買上の立場（製品供給の結果）：</strong>相手＝売主・供給者／<strong>当社＝買主・輸入者</strong>。<br/><strong>IP面（販売ライセンスを伴う場合）：</strong>ライセンサー＝相手／ライセンシー＝<strong>当社</strong>。</div>
<h4 class="sh4">必要な契約・締結相手・契約前の確認事項</h4>
<p class="contract-intro">完成品の継続供給を受ける契約が中心です。独占販売や販促素材の利用は、完成品の購入とは別に明示します。 右欄は、担当者が法務相談前に確認・整理する事項です。</p>
<div class="tw"><table class="contract-table"><thead><tr><th>区分</th><th>必要な契約</th><th>締結相手・当社の立場</th><th>目的・必要となる場合</th><th>契約前の確認事項</th></tr></thead><tbody>
<tr><td><span class="contract-kind ck-main">主契約</span></td><td>国際売買・継続供給契約<br/>またはディストリビューション契約</td><td>海外の製造・供給者と締結<br/>当社＝買主・輸入者・販売者</td><td>商品、価格、MOQ、納期、貿易条件、検収、不良品、供給継続等を定める</td><td><ul class="contract-checks"><li>供給者の販売権限・製造主体・サプライチェーン</li><li>商品仕様、MOQ・予測、価格・通貨・税・関税</li><li>Incoterms、所有権・危険移転、保険・通関書類</li><li>納期、到着後検収、潜在欠陥、不良補充・リコール</li><li>供給継続、価格改定、終売・部品／交換品の確保</li></ul></td></tr>
<tr><td><span class="contract-kind ck-cond">条件付</span></td><td>独占販売契約／独占条項</td><td>海外版元または正当な販売権限を持つ供給者と締結<br/>当社＝独占販売者</td><td>日本または特定チャネルで独占販売する場合。直販・並行流通・最低購入数量も定める</td><td><ul class="contract-checks"><li>独占権の付与権限と既存代理店・販売店の有無</li><li>地域・言語・販路・顧客・オンライン販売の範囲</li><li>直販・他社供給・最低購入量・販売開始期限</li><li>競争法上の制約、受動的販売・並行流通の扱い</li><li>期間、非独占化・解除、終了後在庫の販売</li></ul></td></tr>
<tr><td><span class="contract-kind ck-cond">条件付</span></td><td>商標・販促素材利用許諾</td><td>IP・商標権者と締結<br/>当社＝利用者</td><td>商品再販売を超えて、ロゴ、画像、動画、翻訳販促物等を広告に利用する場合</td><td><ul class="contract-checks"><li>権利者・許諾権限と対象商標／素材の特定</li><li>媒体・地域・期間・翻訳／編集・広告出稿の範囲</li><li>ブランドガイド、事前承認、クレジット表示</li><li>広告代理店・EC・SNS事業者への共有可否</li><li>終了後の掲載停止・データ削除・在庫販促物の扱い</li></ul></td></tr>
</tbody></table></div>
<div class="dw"><div class="dtitle">商流：S4 海外プロダクトイン</div>
<svg aria-hidden="true" style="width:100%;display:block" viewbox="0 0 560 92">
<defs><marker id="cprd" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#1D9E75" points="0 0,7 3,0 6"></polygon></marker><marker id="cmny" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#C47D1A" points="0 0,7 3,0 6"></polygon></marker></defs>
<rect fill="#fff" height="42" rx="6" stroke="#9CA3AF" stroke-width="1.2" width="150" x="10" y="26"></rect><text fill="#374151" font-family="sans-serif" font-size="12" font-weight="600" text-anchor="middle" x="85" y="44">製造・供給者</text><text fill="#9CA3AF" font-family="sans-serif" font-size="9" text-anchor="middle" x="85" y="58">海外版元・指定供給者</text>
<rect fill="#1d3557" height="50" rx="8" width="150" x="205" y="22"></rect><text fill="#fff" font-family="sans-serif" font-size="13" font-weight="600" text-anchor="middle" x="280" y="44">当社 ★</text><text fill="rgba(255,255,255,.6)" font-family="sans-serif" font-size="9" text-anchor="middle" x="280" y="58">輸入・国内販売</text>
<rect fill="rgba(0,0,0,.02)" height="30" rx="6" stroke="#B5C6D4" stroke-dasharray="4,2" stroke-width="1.2" width="150" x="400" y="32"></rect><text fill="#6B7280" font-family="sans-serif" font-size="11" font-weight="600" text-anchor="middle" x="475" y="51">国内市場</text>
<line marker-end="url(#cprd)" stroke="#1D9E75" stroke-width="1.5" x1="162" x2="203" y1="38" y2="38"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="33">完成品を供給</text>
<line marker-end="url(#cmny)" stroke="#C47D1A" stroke-width="1.5" x1="203" x2="162" y1="56" y2="56"></line><text fill="#C47D1A" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="68">製品代金</text>
<line marker-end="url(#cprd)" stroke="#1D9E75" stroke-width="1.5" x1="357" x2="398" y1="47" y2="47"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="378" y="42">輸入・販売</text>
</svg></div>
<div class="cl cl-w"><strong>製品を買っただけでは日本の販売権は付いてこない。</strong>独占販売したいならS5（ライセンス）と組み合わせる必要があります。</div>
<h4 class="sh4">事業部が決めておく条件</h4>
<div class="tw"><table><thead><tr><th>項目</th><th>決める内容</th><th>目安・注意点</th></tr></thead><tbody>
<tr><td class="tc">販売権の確認</td><td>製品購入に日本での独占販売権が含まれるか</td><td>含まれなければS5との組み合わせを検討</td></tr>
<tr><td class="tc">貿易条件</td><td>FOB / CIF等・支払条件</td><td>FOBで輸送を当社管理するか、CIFで簡略化するか</td></tr>
<tr><td class="tc">MOQ・リードタイム</td><td>最低発注数量・製造確定〜納品の期間</td><td>通常3〜5ヶ月。発売日から逆算して発注時期を決める</td></tr>
<tr><td class="tc">価格改定通知</td><td>売主からの値上げ通知期間</td><td>最低3ヶ月前通知を求める</td></tr>
<tr><td class="tc">ローカライズ費用</td><td>翻訳・印刷・ルール再構成の負担者</td><td>通常当社負担。売主が日本語素材提供なら圧縮可</td></tr>
<tr><td class="tc">不良品処理</td><td>定義・許容不良率・検品期間・返品条件</td><td>到着後30日以内・ex-factory起算排除が当社標準</td></tr>
<tr><td class="tc">並行輸入リスク</td><td>売主が別ルートで日本に直販するリスク</td><td>独占購入権がなければ並行輸入は防げない</td></tr>
</tbody></table></div>
<p style="font-size:12px;color:var(--g5)">※属地的特約（国際消尽・準拠法・仲裁）は<a href="#s5" style="color:var(--blue)">S5の同項</a>と共通。</p>
<h4 class="sh4">よくある落とし穴</h4>
<ul class="pl">
<li>製品を仕入れたが日本での販売権が別途必要だった（販売権は自動では付かない）</li>
<li>独占インポート権を明記したが並行輸入を止められなかった（国際消尽）</li>
</ul>
<hr class="sd"/>
<!-- 空白マス -->
<div class="shb" id="sPin" style="background:#6c757d"><div class="sn">イン × プロダクト × 国内</div><h2>（空白）国内プロダクトイン</h2></div>
<div class="cl cl-w"><strong>このマスは現状このガイドでは未整備です。</strong>「日本の相手方が製造または製造委託した完成品を当社が仕入れ、自社で（ホビーステーション等を通じて）販売する」ケースが該当します。製造主体は相手方であり、売主・買主は完成品供給の結果として生じる立場です。<br/>
8マスのうちここだけ詳細がありません。<strong>この取引が出てきたら、型としては存在することを認識のうえ法務へ相談</strong>してください。論点はS4（海外PO-IN）から国際論点を除いたもの＝主に「独占販売権の有無・MOQ・不良品処理・並行品リスク・卸価格と改定条件」になります。需要があれば正式に詳細を追加します。</div>
<h4 class="sh4">必要な契約・締結相手・契約前の確認事項</h4>
<div class="tw"><table class="contract-table"><thead><tr><th>区分</th><th>必要な契約</th><th>締結相手・当社の立場</th><th>目的・必要となる場合</th><th>契約前の確認事項</th></tr></thead><tbody>
<tr><td><span class="contract-kind ck-main">主契約</span></td><td>国内売買基本契約／継続供給契約</td><td>国内の製造・供給者と締結<br/>当社＝買主・販売者</td><td>商品、価格、発注、納期、検収、不良品、返品、価格改定等を定める</td><td><ul class="contract-checks"><li>供給者の販売権限・製造主体・正規流通品か</li><li>商品仕様、価格・税、発注方法、最低発注数量</li><li>納期・引渡場所・危険負担・所有権・検収</li><li>契約不適合、不良品、返品、リコール・費用負担</li><li>価格改定、供給停止、終売通知、在庫・部品対応</li></ul></td></tr>
<tr><td><span class="contract-kind ck-exec">実行</span></td><td>個別発注書・注文請書</td><td>国内の供給者との個別取引</td><td>品名、数量、単価、納期等を個別に確定する</td><td><ul class="contract-checks"><li>適用する基本契約・文書間の優先順位</li><li>品名・仕様／版・数量・単価・消費税</li><li>納期・納品場所・検収期限・請求／支払日</li><li>変更・キャンセル・不足／過納時の処理</li></ul></td></tr>
<tr><td><span class="contract-kind ck-cond">条件付</span></td><td>独占販売契約／ブランド利用許諾</td><td>販売権限・ブランド権限を持つ相手と締結</td><td>独占販売または販促物・商標の利用を伴う場合</td><td><ul class="contract-checks"><li>付与者が独占販売権・ブランド利用権を付与できるか</li><li>対象地域・販路・顧客・商品・独占期間</li><li>直販・他社供給・最低購入数量・販売開始期限</li><li>利用可能な商標・素材、承認手続、終了後の削除</li></ul></td></tr>
</tbody></table></div>
<hr class="sd"/>
<!-- ===================== OUT ===================== -->
<div class="grp outgrp" id="out" style="scroll-margin-top:16px">▼ アウト ── 相手方が当社管理IPを利用して製造する／当社製造品を供給する</div>
<!-- S7 -->
<div class="shb" id="s7"><div class="sn">アウト × ライセンス × 国内</div><h2><span class="scode">S7</span>国内ライセンスアウト</h2></div>
<div class="plain"><span class="pll">ひとことで言うと</span><b>当社が保有する、または利用許諾を受けたIPについて、日本の他社に利用を許諾し、相手が作って売る。</b></div>
<div class="cl cl-i"><strong>製造・製造委託の主体：</strong>相手。相手が商品仕様・製造委託先・品質・納期を管理します。<br/><strong>利用許諾上の立場：</strong>自社IPなら ライセンサー＝<strong>当社</strong>／ライセンシー＝相手。<u>S1・S5で利用許諾を受けたIPを再許諾する場合</u> <strong>当社＝ライセンシー（サブライセンサー）</strong>／相手＝サブライセンシー／大もと＝ライセンサー。</div>
<h4 class="sh4">必要な契約・締結相手・契約前の確認事項</h4>
<p class="contract-intro">相手方との利用許諾契約に加え、当社が上流から許諾を受けたIPを再許諾する場合は、上流権利者との権限確保が先に必要です。 右欄は、担当者が法務相談前に確認・整理する事項です。 右欄は、担当者が法務相談前に確認・整理する事項です。</p>
<div class="tw"><table class="contract-table"><thead><tr><th>区分</th><th>必要な契約</th><th>締結相手・当社の立場</th><th>目的・必要となる場合</th><th>契約前の確認事項</th></tr></thead><tbody>
<tr><td><span class="contract-kind ck-main">主契約</span></td><td>国内IP利用許諾契約</td><td>国内の利用者・商品化事業者と締結<br/>当社＝ライセンサーまたはサブライセンサー</td><td>商品、販路、独占性、ロイヤルティ、監修、品質、報告、終了後処理等を定める</td><td><ul class="contract-checks"><li>当社の権利保有・管理権限または転許諾権限</li><li>対象IP・商品・媒体・販路・地域・期間</li><li>独占性、MRG、販売開始期限、競合許諾との重複</li><li>ロイヤルティ、報告・証憑・監査、税の扱い</li><li>監修・品質・回収、再許諾・製造委託、sell-off</li></ul></td></tr>
<tr><td><span class="contract-kind ck-pre">前提</span></td><td>転許諾同意書／上流契約の変更覚書</td><td>元のライセンサーと締結<br/>当社＝ライセンシー</td><td>当社保有IPではなく、利用許諾を受けたIPを第三者へ再許諾する場合</td><td><ul class="contract-checks"><li>再許諾先・商品・販路・地域・期間を特定したか</li><li>上流への追加ロイヤルティ・報告・承認条件</li><li>監修・品質・表示等を下流契約へ転嫁できるか</li><li>下流違反時の当社責任と上流への補償</li><li>上流契約終了時の下流契約・在庫の処理</li></ul></td></tr>
<tr><td><span class="contract-kind ck-cond">条件付</span></td><td>NDA</td><td>許諾先候補と締結</td><td>未発表商品、監修資料、販売計画等を契約前に開示する場合</td><td><ul class="contract-checks"><li>検討目的・秘密情報・開示範囲</li><li>役職員・委託先への共有と管理義務</li><li>秘密保持期間・返還／廃棄・公表可否</li><li>本契約不成立時の企画・サンプル利用禁止</li></ul></td></tr>
</tbody></table></div>
<div class="dw"><div class="dtitle">商流：S7 国内ライセンスアウト</div>
<svg aria-hidden="true" style="width:100%;display:block" viewbox="0 0 560 92">
<defs><marker id="dlic" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#4B8BDB" points="0 0,7 3,0 6"></polygon></marker><marker id="dprd" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#1D9E75" points="0 0,7 3,0 6"></polygon></marker><marker id="dmny" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#C47D1A" points="0 0,7 3,0 6"></polygon></marker></defs>
<rect fill="#1d3557" height="50" rx="8" width="150" x="10" y="22"></rect><text fill="#fff" font-family="sans-serif" font-size="13" font-weight="600" text-anchor="middle" x="85" y="44">当社 ★</text><text fill="rgba(255,255,255,.6)" font-family="sans-serif" font-size="9" text-anchor="middle" x="85" y="58">許可する側</text>
<rect fill="#fff" height="42" rx="6" stroke="#9CA3AF" stroke-width="1.2" width="150" x="205" y="26"></rect><text fill="#374151" font-family="sans-serif" font-size="12" font-weight="600" text-anchor="middle" x="280" y="44">ライセンシー</text><text fill="#9CA3AF" font-family="sans-serif" font-size="9" text-anchor="middle" x="280" y="58">国内他社（製造・販売）</text>
<rect fill="rgba(0,0,0,.02)" height="30" rx="6" stroke="#B5C6D4" stroke-dasharray="4,2" stroke-width="1.2" width="150" x="400" y="32"></rect><text fill="#6B7280" font-family="sans-serif" font-size="11" font-weight="600" text-anchor="middle" x="475" y="51">国内市場</text>
<line marker-end="url(#dlic)" stroke="#4B8BDB" stroke-dasharray="5,3" stroke-width="1.5" x1="162" x2="203" y1="38" y2="38"></line><text fill="#4B8BDB" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="33">許可</text>
<line marker-end="url(#dmny)" stroke="#C47D1A" stroke-width="1.5" x1="203" x2="162" y1="56" y2="56"></line><text fill="#C47D1A" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="68">ロイヤルティ</text>
<line marker-end="url(#dprd)" stroke="#1D9E75" stroke-width="1.5" x1="357" x2="398" y1="47" y2="47"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="378" y="42">製造・販売</text>
</svg></div>
<div class="cl cl-w"><strong>カニバリ（食い合い）と転許諾に注意。</strong>S6（OEM供給）や自社直販と販路がぶつかると価格・ブランド管理が崩れます。また<strong>S1/S5由来のIPを第三者に利用させる場合は、上流ライセンサーの転許諾OKを必ず確認</strong>。</div>
<h4 class="sh4">事業部が決めておく条件</h4>
<div class="tw"><table><thead><tr><th>項目</th><th>決める内容</th><th>目安・注意点</th></tr></thead><tbody>
<tr><td class="tc tcr">すでに渡した範囲との重複チェック</td><td>今回の販路が既存ライセンシーに許可済みの範囲と重ならないか</td><td>S6との兼ね合いも確認。同一商品が複数ルートで流れると管理不能に</td></tr>
<tr><td class="tc">ロイヤルティ計算基礎</td><td>定価ベース（当社有利）</td><td>実売ベースを求められたら返品・値引きの対象範囲を明確化</td></tr>
<tr><td class="tc">MRG（独占維持基準）</td><td>金額・評価時期（年次）・非独占転換条件</td><td>販売計画の50〜70%が目安。低すぎると独占の価値がない</td></tr>
<tr><td class="tc">監修費の別途請求</td><td>ロイヤルティと分けて監修費を取るか</td><td>当社のIP管理工数を回収できる</td></tr>
<tr><td class="tc">上流対応コストの負担</td><td>版権者への承認申請費・サンプル送付費の負担者</td><td>S1/S5由来IPの再許諾は、上流対応コストをライセンシー負担で設計</td></tr>
<tr><td class="tc">クレジット・デザインガイド</td><td>表示フォーマット・掲載場所を事前提示</td><td>品質の低い製品にIPが付くとブランド棄損</td></tr>
<tr><td class="tc">粗悪品への対応フロー</td><td>回収要請・許可取消しの条件</td><td>事前に決めないと即時対応できない</td></tr>
<tr><td class="tc">sell-off期間</td><td>契約終了後の在庫消化期間</td><td>通常3〜6ヶ月。独占終了後は非独占扱いと明記</td></tr>
</tbody></table></div>
<h4 class="sh4">よくある落とし穴</h4>
<ul class="pl">
<li>MRGを設けず、ライセンシーが製造しても売らない「死に体ライセンス」になった</li>
<li>上流（S1/S5）の転許諾可否を確認せずに再許諾を進めてしまった</li>
</ul>
<hr class="sd"/>
<!-- S2 -->
<div class="shb" id="s2"><div class="sn">アウト × ライセンス × 海外</div><h2><span class="scode">S2</span>海外ライセンスアウト</h2></div>
<div class="plain"><span class="pll">ひとことで言うと</span><b>当社が保有する、または利用許諾を受けたIPについて、海外企業に利用を許諾し、相手が現地で作って売る。</b></div>
<div class="cl cl-i"><strong>製造・製造委託の主体：</strong>相手。相手が商品仕様・製造委託先・品質・納期を管理します。<br/><strong>利用許諾上の立場：</strong>自社IPなら ライセンサー＝<strong>当社</strong>／ライセンシー＝相手。<u>S1・S5で利用許諾を受けたIPを再許諾する場合</u> <strong>当社＝ライセンシー（サブライセンサー）</strong>／相手＝サブライセンシー／大もと＝ライセンサー。</div><h4 class="sh4">必要な契約・締結相手・契約前の確認事項</h4><p class="contract-intro">海外の利用者との国際ライセンス契約が中心です。再許諾案件では、海外契約を締結する前に上流権利者から権限を確保します。 右欄は、担当者が法務相談前に確認・整理する事項です。</p><div class="tw"><table class="contract-table"><thead><tr><th>区分</th><th>必要な契約</th><th>締結相手・当社の立場</th><th>目的・必要となる場合</th><th>契約前の確認事項</th></tr></thead><tbody>
<tr><td><span class="contract-kind ck-main">主契約</span></td><td>国際IP利用許諾契約<br/>（Master＋個別条件書）</td><td>海外の利用者・現地版元と締結<br/>当社＝ライセンサーまたはサブライセンサー</td><td>地域・言語、商品、独占性、MG・ロイヤルティ、監修、報告、準拠法等を定める</td><td><ul class="contract-checks"><li>当社の権利・転許諾権限と相手方の契約主体／信用</li><li>地域・言語・商品・媒体・販路・製造／再許諾範囲</li><li>独占性、発売期限、MG・ロイヤルティ、Net Sales定義</li><li>報告・監査、源泉税・送金・通貨／為替の扱い</li><li>監修・品質・現地規制、競争法・制裁／輸出管理</li><li>期間・sell-off・準拠法・仲裁・判決／仲裁判断の執行</li></ul></td></tr>
<tr><td><span class="contract-kind ck-pre">前提</span></td><td>転許諾同意書／上流契約の変更覚書</td><td>元のライセンサーと締結<br/>当社＝ライセンシー</td><td>当社が利用許諾を受けたIPを海外へ再許諾する場合</td><td><ul class="contract-checks"><li>対象国・言語・再許諾先・商品・販売経路</li><li>追加対価、為替・税、上流への報告・監査</li><li>現地版の監修・品質・クレジット条件</li><li>下流契約への必須条項・責任転嫁</li><li>上流終了時の下流契約・在庫・素材の処理</li></ul></td></tr>
<tr><td><span class="contract-kind ck-cond">条件付</span></td><td>NDA</td><td>海外候補先と締結</td><td>秘密情報を開示して交渉する場合</td><td><ul class="contract-checks"><li>検討目的・秘密情報・許可された利用</li><li>関連会社・専門家・製造候補への共有範囲</li><li>秘密保持期間、返還／削除、残存情報の扱い</li><li>準拠法・差止め・公表／プレスリリース</li></ul></td></tr><tr><td><span class="contract-kind ck-cond">条件付</span></td><td>交渉代理・エージェント契約</td><td>現地エージェントと締結<br/>当社＝委託者</td><td>第三者に候補先探索・交渉・契約事務を委ねる場合</td><td><ul class="contract-checks"><li>権限範囲（紹介・交渉・署名権限の有無）</li><li>対象地域・案件、独占性、競業・利益相反</li><li>報酬・成功報酬の算定基礎と支払時期</li><li>秘密保持、法令遵守、再委託、活動報告</li><li>契約終了後のテール報酬・顧客帰属</li></ul></td></tr>
</tbody></table></div>
<div class="dw"><div class="dtitle">商流：S2 海外ライセンスアウト</div>
<svg aria-hidden="true" style="width:100%;display:block" viewbox="0 0 560 92">
<defs><marker id="elic" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#4B8BDB" points="0 0,7 3,0 6"></polygon></marker><marker id="eprd" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#1D9E75" points="0 0,7 3,0 6"></polygon></marker><marker id="emny" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#C47D1A" points="0 0,7 3,0 6"></polygon></marker></defs>
<rect fill="#1d3557" height="50" rx="8" width="150" x="10" y="22"></rect><text fill="#fff" font-family="sans-serif" font-size="13" font-weight="600" text-anchor="middle" x="85" y="44">当社 ★</text><text fill="rgba(255,255,255,.6)" font-family="sans-serif" font-size="9" text-anchor="middle" x="85" y="58">ライセンサー</text>
<rect fill="#fff" height="42" rx="6" stroke="#9CA3AF" stroke-width="1.2" width="150" x="205" y="26"></rect><text fill="#374151" font-family="sans-serif" font-size="12" font-weight="600" text-anchor="middle" x="280" y="44">ライセンシー</text><text fill="#9CA3AF" font-family="sans-serif" font-size="9" text-anchor="middle" x="280" y="58">海外（自ら製造・販売）</text>
<rect fill="rgba(0,0,0,.02)" height="30" rx="6" stroke="#B5C6D4" stroke-dasharray="4,2" stroke-width="1.2" width="150" x="400" y="32"></rect><text fill="#6B7280" font-family="sans-serif" font-size="11" font-weight="600" text-anchor="middle" x="475" y="51">海外市場</text>
<line marker-end="url(#elic)" stroke="#4B8BDB" stroke-dasharray="5,3" stroke-width="1.5" x1="162" x2="203" y1="38" y2="38"></line><text fill="#4B8BDB" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="33">許可</text>
<line marker-end="url(#emny)" stroke="#C47D1A" stroke-width="1.5" x1="203" x2="162" y1="56" y2="56"></line><text fill="#C47D1A" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="68">ロイヤルティ/MG</text>
<line marker-end="url(#eprd)" stroke="#1D9E75" stroke-width="1.5" x1="357" x2="398" y1="47" y2="47"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="378" y="42">製造・販売</text>
</svg></div>
<div class="cl cl-w"><strong>S3（受託製造）と最初に必ず仕分ける。</strong>S2は<u>相手が作る</u>。S3は<u>当社が作る</u>。ここを取り違えたまま交渉を進めるのが最大の事故です。</div>
<div class="cl cl-n"><strong>上流確認（必須）：</strong>S1/S5でライセンスインしたタイトルを海外展開する場合、上流ライセンサーから海外展開・製品供給の追加許諾を得ているか確認。</div>
<h4 class="sh4">事業部が決めておく条件</h4>
<div class="tw"><table><thead><tr><th>項目</th><th>決める内容</th><th>目安・注意点</th></tr></thead><tbody>
<tr><td class="tc tcr">すでに渡した範囲との重複チェック</td><td>今回付与する地域・言語が既存ライセンシーの範囲と重ならないか</td><td>BG事業部の先行契約を必ず照会してから交渉に入る</td></tr>
<tr><td class="tc">ロイヤルティ計算基礎</td><td>卸価格ベース（Net Sales）が海外慣行</td><td>定価ベースは管理は簡単だが実額が小さくなる場合がある</td></tr>
<tr><td class="tc">MG/Advance</td><td>金額・支払スケジュール（署名時/サンプル承認時/初回出荷時）</td><td>署名時50%＋出荷時50%が起点。早期回収が当社有利</td></tr>
<tr><td class="tc">MRG（独占維持基準）</td><td>金額・評価時期（年次）・非独占転換条件</td><td>ライセンシーの販売計画の50〜70%が目安</td></tr>
<tr><td class="tc">独占の地域・言語範囲</td><td>EU加盟国・英国・スイス等を列記。「英語版のみ」か「英語権全域」か</td><td>「ヨーロッパ」では曖昧すぎる</td></tr>
<tr><td class="tc">オンライン販売の扱い</td><td>Amazon越境・Kickstarter・独自ECの許可範囲</td><td>越境販売による他地域ライセンシーとの競合を明確化</td></tr>
<tr><td class="tc">承認ターンアラウンド</td><td>当社が何営業日以内に返答するか</td><td>15営業日以内が目安。沈黙承認ルールとセット</td></tr>
<tr><td class="tc">sell-off期間</td><td>契約終了後の在庫消化期間</td><td>6〜12ヶ月。独占終了後は非独占扱いと明記</td></tr>
<tr><td class="tc">翻訳・アートの帰属</td><td>ライセンシー作成素材の当社流用権</td><td>後続ライセンシーに流用できる権利を留保する交渉も可能</td></tr>
</tbody></table></div>
<h4 class="sh4">属地的特約（海外アウト：S2で特に重要）</h4>
<div class="cl cl-i">海外向けは、日本にはない「域内ルール」が条件に直結します。特にEU・英国向けは下記を事前整理。</div>
<div class="tw"><table><thead><tr><th>論点</th><th>内容</th></tr></thead><tbody>
<tr><td class="tc">テリトリーの定義</td><td><strong>EU27</strong>≠<strong>EEA</strong>（EU27＋ノルウェー・アイスランド・リヒテンシュタイン）≠<strong>英国</strong>（Brexitで離脱）≠<strong>スイス</strong>（どちらも非加盟）。「ヨーロッパ」「北米」と曖昧に書かず国・言語で指定する</td></tr>
<tr><td class="tc">EEA権利消尽</td><td>EEA域内のどこかで適法販売された製品はEEA全域で再販を止められない。「ドイツのみ独占」でも域内に流通するリスクがあるため、EEAを一括テリトリーとして設計するのが安全</td></tr>
<tr><td class="tcr">EU競争法（受動的販売）</td><td>指定地域外への積極営業の禁止は原則OK。だが<strong>顧客から来た注文を断らせる（受動的販売の禁止）は原則違反</strong>。ECの地理ブロッキングも要注意（EU規則2018/302）。制限を設けるなら専門家確認</td></tr>
<tr><td class="tc">製品安全・認証</td><td>EU/EEA＝CEマーキング（玩具安全指令2009/48/EC、14歳以下・小部品は厳格）。英国＝UKCA（CEと原則別申請）。両方供給ならコスト倍</td></tr>
<tr><td class="tc">関税（日EU・EPA）</td><td>日本原産品に特恵関税。<strong>中国工場製造は原産地規則を満たさず適用不可</strong>。採算前提に注意</td></tr>
</tbody></table></div>
<h4 class="sh4">よくある落とし穴</h4>
<ul class="pl">
<li>「EU展開」と書いたが英国・スイスが含まれるか曖昧で後でトラブルに（EU≠EEA≠UK）</li>
<li>EEA域内を国別に分割したが、EEA消尽でテリトリー保護が機能しなかった</li>
<li>「地域外への販売禁止」が受動的販売まで禁じる表現になりEU競争法上問題に</li>
<li>EUとUK両方に納品したがCEのみ取得、UKCAが別途必要だった</li>
<li>日EU・EPA税率前提で採算を組んだが、中国工場製造で原産地規則を満たさず適用できなかった</li>
<li>S2をS3と混同し「当社が作る」前提で交渉してしまった（製造主体の確認が最初の一歩）</li>
</ul>
<hr class="sd"/>
<!-- S6 -->
<div class="shb" id="s6"><div class="sn">アウト × プロダクト × 国内（売買型）</div><h2><span class="scode">S6</span>国内プロダクトアウト/OEM</h2></div>
<div class="plain"><span class="pll">ひとことで言うと</span><b>当社が製造または製造委託した完成品を、日本の他社へ供給する。S6は当社起点の自主製造・卸売型が典型。</b></div>
<div class="cl cl-i"><strong>製造・製造委託の主体：</strong><strong>当社</strong>。当社が製造仕様・委託先・製造費・品質・納期・在庫を管理します。<br/><strong>売買上の立場（製品供給の結果）：</strong><strong>当社＝売主・供給者</strong>／相手＝買主・販売先。<br/><strong>IP面（S1/S5由来IPを載せる場合）：</strong>大もと＝ライセンサー／<strong>当社＝ライセンシー（サブライセンサー）</strong>／相手＝サブライセンシー。自社IPなら 当社＝ライセンサー／相手＝ライセンシー。</div>
<h4 class="sh4">必要な契約・締結相手・契約前の確認事項</h4>
<p class="contract-intro">自主製造品の卸売では売買・供給契約を中心とし、相手方の注文・仕様に基づく場合はOEM・製造受託契約へ切り替えます。 右欄は、担当者が法務相談前に確認・整理する事項です。</p>
<div class="tw"><table class="contract-table"><thead><tr><th>区分</th><th>必要な契約</th><th>締結相手・当社の立場</th><th>目的・必要となる場合</th><th>契約前の確認事項</th></tr></thead><tbody>
<tr><td><span class="contract-kind ck-main">主契約</span></td><td>国内売買基本契約／継続供給・販売店契約</td><td>国内の販売先・卸先と締結<br/>当社＝売主・供給者</td><td>商品、卸価格、発注、納期、検収、返品、販路、販売終了等を定める</td><td><ul class="contract-checks"><li>商品・卸価格・発注単位・支払条件・与信</li><li>引渡し、危険負担・所有権、検収・不良品・返品</li><li>販売地域・販路・再卸・EC／マーケットプレイスの可否</li><li>販促・価格表示の運用は独禁法上の制約を法務確認</li><li>終売・契約終了・残存在庫・リコール時の協力</li></ul></td></tr>
<tr><td><span class="contract-kind ck-exec">実行</span></td><td>個別発注書・注文請書</td><td>国内の販売先との個別取引</td><td>商品、数量、単価、納期等を個別に確定する</td><td><ul class="contract-checks"><li>基本契約の特定と個別条件の優先順位</li><li>商品・仕様／版・数量・単価・消費税</li><li>納期・納品場所・請求／支払日</li><li>変更・キャンセル・分納・欠品時の処理</li></ul></td></tr>
<tr><td><span class="contract-kind ck-cond">条件付</span></td><td>OEM・製造受託契約</td><td>仕様・数量を指定する国内委託者と締結<br/>当社＝受託製造者</td><td>相手方起点の商品を当社が製造する場合。仕様変更、検収、知財、製造物責任等を定める</td><td><ul class="contract-checks"><li>仕様決定、設計・材料・金型・支給品の責任分担</li><li>発注数量・予測・キャンセル・仕様変更の手続</li><li>委託料・材料費・価格改定、検収・契約不適合</li><li>知財・金型／データの帰属、再委託・秘密保持</li><li>製造物責任・表示規制・リコール・保険</li><li>取適法・フリーランス法等の適用と書面／支払条件</li></ul></td></tr>
<tr><td><span class="contract-kind ck-cond">条件付</span></td><td>商標・販促素材利用許諾</td><td>販売先と締結<br/>当社＝ライセンサーまたは権限付与者</td><td>販売先が当社ロゴ・画像等を広告、EC、店舗表示に利用する場合</td><td><ul class="contract-checks"><li>当社が許諾できる商標・画像・商品情報の範囲</li><li>利用媒体・店舗／EC・期間・改変可否</li><li>ブランドガイド・事前承認・表示義務</li><li>第三者制作会社への共有と素材管理</li><li>終了・違反時の掲載停止・データ削除</li></ul></td></tr>
</tbody></table></div>
<div class="dw"><div class="dtitle">商流：S6 国内プロダクトアウト/OEM</div>
<svg aria-hidden="true" style="width:100%;display:block" viewbox="0 0 560 92">
<defs><marker id="fprd" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#1D9E75" points="0 0,7 3,0 6"></polygon></marker><marker id="fmny" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#C47D1A" points="0 0,7 3,0 6"></polygon></marker></defs>
<rect fill="#1d3557" height="50" rx="8" width="150" x="10" y="22"></rect><text fill="#fff" font-family="sans-serif" font-size="13" font-weight="600" text-anchor="middle" x="85" y="44">当社 ★</text><text fill="rgba(255,255,255,.6)" font-family="sans-serif" font-size="9" text-anchor="middle" x="85" y="58">製造して卸す</text>
<rect fill="#fff" height="42" rx="6" stroke="#9CA3AF" stroke-width="1.2" width="150" x="205" y="26"></rect><text fill="#374151" font-family="sans-serif" font-size="12" font-weight="600" text-anchor="middle" x="280" y="44">供給先</text><text fill="#9CA3AF" font-family="sans-serif" font-size="9" text-anchor="middle" x="280" y="58">国内OEM先・販売先</text>
<rect fill="rgba(0,0,0,.02)" height="30" rx="6" stroke="#B5C6D4" stroke-dasharray="4,2" stroke-width="1.2" width="150" x="400" y="32"></rect><text fill="#6B7280" font-family="sans-serif" font-size="11" font-weight="600" text-anchor="middle" x="475" y="51">国内市場</text>
<line marker-end="url(#fprd)" stroke="#1D9E75" stroke-width="1.5" x1="162" x2="203" y1="38" y2="38"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="33">製品を供給</text>
<line marker-end="url(#fmny)" stroke="#C47D1A" stroke-width="1.5" x1="203" x2="162" y1="56" y2="56"></line><text fill="#C47D1A" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="68">製品代金</text>
<line marker-end="url(#fprd)" stroke="#1D9E75" stroke-width="1.5" x1="357" x2="398" y1="47" y2="47"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="378" y="42">販売</text>
</svg></div>
<div class="cl cl-w"><strong>カニバリと上流ロイヤルティの転嫁に注意。</strong>当社直販（ホビーステーション等）と同じ客層に安く流れると食い合います。また<strong>S1/S5由来のIPなら、OEM先の販売数量分も当社が上流に支払う義務</strong>があるため卸価格に必ず転嫁を。</div>
<h4 class="sh4">事業部が決めておく条件</h4>
<div class="tw"><table><thead><tr><th>項目</th><th>決める内容</th><th>目安・注意点</th></tr></thead><tbody>
<tr><td class="tc tcr">すでに渡した範囲との重複チェック</td><td>今回のOEM販路・地域が既存取引先の範囲と重ならないか</td><td>国内は地域より販路（EC・量販・専門店等）の重複が問題になりやすい</td></tr>
<tr><td class="tc">卸価格・改定条件</td><td>単価・改定条件（原材料費上昇時の転嫁）</td><td>改定権を留保しないと製造コスト上昇を当社が全額被る</td></tr>
<tr><td class="tc">MOQ・発注単位</td><td>最低発注数量・製造確定〜納品のリードタイム</td><td>MOQ未達の発注は製造効率が落ちる</td></tr>
<tr><td class="tc tcr">上流ロイヤルティの転嫁</td><td>S1/S5取得IPの場合、OEM先販売分のロイヤルティを卸価格に転嫁しているか</td><td>OEM先の販売数量分も当社が上流に支払う義務あり</td></tr>
<tr><td class="tc">チャネル制限</td><td>OEM先が販売できる範囲（販路・地域）</td><td>ホビーステーション同一商圏への販売禁止等を設ける</td></tr>
<tr><td class="tc">再卸の可否</td><td>OEM先が別の流通業者に再卸できる範囲</td><td>無制限再卸は価格・チャネル管理が不能に</td></tr>
<tr><td class="tc">MAP設定</td><td>最低小売価格の設定・当社事前通知義務</td><td>OEM先の安売りが直販価格を下回るとブランド棄損</td></tr>
<tr><td class="tc">在庫処分</td><td>契約終了後の在庫処分方法</td><td>買戻し / 市中販売継続 / 廃棄のいずれかを先に決める</td></tr>
</tbody></table></div>
<h4 class="sh4">よくある落とし穴</h4>
<ul class="pl">
<li>OEM先が自社直販と同じ客層に低価格で売り、カニバリが発生した</li>
<li>S1/S5由来IPで、OEM先販売分のロイヤルティを卸価格に乗せ忘れて逆ザヤになった</li>
</ul>
<hr class="sd"/>
<!-- S3 -->
<div class="shb" id="s3"><div class="sn">アウト × プロダクト × 海外（受託製造型）</div><h2><span class="scode">S3</span>海外プロダクトアウト/受託製造</h2></div>
<div class="plain"><span class="pll">ひとことで言うと</span><b>海外の相手から仕様・数量の指定を受け、当社が製造または製造委託して完成品を納品する受注製造型。</b></div>
<div class="cl cl-i"><strong>製造・製造委託の主体：</strong><strong>当社</strong>。ただし商品化の起点・仕様・数量は相手の発注に基づきます。<br/><strong>製造委託上の立場：</strong>相手＝委託者／<strong>当社＝受託製造者</strong>。完成品売買を伴う場合は、その結果として当社＝売主・供給者／相手＝買主となります。<br/><strong>IP面（S1/S5由来IPを載せる場合）：</strong>大もと＝ライセンサー／<strong>当社＝ライセンシー（サブライセンサー）</strong>／相手＝サブライセンシー。</div>
<h4 class="sh4">必要な契約・締結相手・契約前の確認事項</h4>
<p class="contract-intro">受注製造では、製造条件と完成品供給条件を一体化した国際OEM・製造供給契約を中心にします。 右欄は、担当者が法務相談前に確認・整理する事項です。</p>
<div class="tw"><table class="contract-table"><thead><tr><th>区分</th><th>必要な契約</th><th>締結相手・当社の立場</th><th>目的・必要となる場合</th><th>契約前の確認事項</th></tr></thead><tbody>
<tr><td><span class="contract-kind ck-main">主契約</span></td><td>国際OEM・製造供給契約<br/>または製造業務委託契約</td><td>海外の発注者・委託者と締結<br/>当社＝受託製造者・供給者</td><td>仕様、数量、製造費、納期、変更、検収、不良品、貿易条件、責任分担等を定める</td><td><ul class="contract-checks"><li>売買／製造委託の性質と当社・相手方の責任範囲</li><li>仕様・サンプル・変更管理、材料・金型・支給品</li><li>予測・MOQ・確定発注・キャンセル・余剰在庫</li><li>価格・前払金・通貨／税、Incoterms・危険／所有権移転</li><li>検収・潜在欠陥・補充、製造物責任・リコール</li><li>IP・再委託・認証／表示規制・制裁／輸出管理</li><li>準拠法・仲裁・責任制限・保険</li></ul></td></tr>
<tr><td><span class="contract-kind ck-exec">実行</span></td><td>個別仕様書・発注書・注文請書</td><td>海外の委託者との個別案件</td><td>製品仕様、数量、価格、納期、梱包、認証等を個別に確定する</td><td><ul class="contract-checks"><li>適用するMaster契約と文書間の優先順位</li><li>仕様書番号・版、数量、単価・通貨・税</li><li>製造／出荷日、Incoterms、梱包・表示・必要書類</li><li>検収基準・サンプル承認・変更／キャンセル手続</li></ul></td></tr>
<tr><td><span class="contract-kind ck-pre">前提</span></td><td>製造目的のIP利用許諾</td><td>相手方またはIP権利者から取得<br/>当社＝製造目的の利用者</td><td>相手方保有IP・データ・商標を当社が製造のため利用する場合。主契約に内包可能</td><td><ul class="contract-checks"><li>許諾者の権限と製造対象IP・データの特定</li><li>製造目的・工場／再委託先・地域・期間の限定</li><li>複製・保管・データセキュリティ・監修／承認</li><li>製造以外の利用禁止、余剰品・データの返還／廃棄</li></ul></td></tr>
<tr><td><span class="contract-kind ck-pre">前提</span></td><td>転許諾同意書／上流契約の変更覚書</td><td>元のライセンサーと締結</td><td>当社が上流から許諾を受けたIPを載せた完成品を供給し、相手方に販売・利用させる場合</td><td><ul class="contract-checks"><li>供給先・販売地域・商品・数量・販売権限の範囲</li><li>追加ロイヤルティ、販売報告、サンプル・監修</li><li>下流への品質・表示・禁止事項の転嫁</li><li>上流契約終了時の供給・在庫・下流販売の処理</li></ul></td></tr>
</tbody></table></div>
<div class="dw"><div class="dtitle">商流：S3 海外プロダクトアウト/受託製造</div>
<svg aria-hidden="true" style="width:100%;display:block" viewbox="0 0 560 110">
<defs><marker id="glic" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#4B8BDB" points="0 0,7 3,0 6"></polygon></marker><marker id="gprd" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#1D9E75" points="0 0,7 3,0 6"></polygon></marker><marker id="gmny" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#C47D1A" points="0 0,7 3,0 6"></polygon></marker></defs>
<rect fill="#1d3557" height="50" rx="8" width="150" x="10" y="32"></rect><text fill="#fff" font-family="sans-serif" font-size="13" font-weight="600" text-anchor="middle" x="85" y="54">当社 ★</text><text fill="rgba(255,255,255,.6)" font-family="sans-serif" font-size="9" text-anchor="middle" x="85" y="68">受託製造者</text>
<rect fill="#fff" height="42" rx="6" stroke="#9CA3AF" stroke-width="1.2" width="150" x="205" y="36"></rect><text fill="#374151" font-family="sans-serif" font-size="12" font-weight="600" text-anchor="middle" x="280" y="54">委託者</text><text fill="#9CA3AF" font-family="sans-serif" font-size="9" text-anchor="middle" x="280" y="68">海外（委託者・販売）</text>
<rect fill="rgba(0,0,0,.02)" height="30" rx="6" stroke="#B5C6D4" stroke-dasharray="4,2" stroke-width="1.2" width="150" x="400" y="42"></rect><text fill="#6B7280" font-family="sans-serif" font-size="11" font-weight="600" text-anchor="middle" x="475" y="61">海外市場</text>
<line marker-end="url(#gprd)" stroke="#1D9E75" stroke-width="1.5" x1="203" x2="162" y1="44" y2="44"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="39">製造委託（依頼）</text>
<line marker-end="url(#gprd)" stroke="#1D9E75" stroke-width="1.5" x1="162" x2="203" y1="60" y2="60"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="72">製品納品</text>
<line marker-end="url(#gmny)" stroke="#C47D1A" stroke-width="1.5" x1="203" x2="162" y1="76" y2="76"></line><text fill="#C47D1A" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="182" y="88">製造費</text>
<line marker-end="url(#gprd)" stroke="#1D9E75" stroke-width="1.5" x1="357" x2="398" y1="57" y2="57"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8.5" text-anchor="middle" x="378" y="52">販売</text>
</svg></div>
<div class="cl cl-w"><strong>S2との比較は必ず収益で行う。</strong>S3は当社が製造する分コストとリスクを負います。上流のライセンサーへのロイヤルティ支払い後の手残りを、S2（ロイヤルティのみ）と比較してから選ぶこと。<strong>製造キャパ（工場・製造枠）の確保が前提</strong>です。</div>
<div class="cl cl-n"><strong>上流確認（必須）：</strong>S1/S5由来IPなら、海外への製品供給の追加許諾を上流から得ているか。</div>
<h4 class="sh4">事業部が決めておく条件</h4>
<div class="tw"><table><thead><tr><th>項目</th><th>決める内容</th><th>目安・注意点</th></tr></thead><tbody>
<tr><td class="tc tcr">すでに渡した範囲との重複チェック</td><td>今回供給する地域が既存の供給先の範囲と重ならないか</td><td>同一地域にS2のライセンシーがいる場合、PO供給はその独占権を侵害しうる</td></tr>
<tr><td class="tc">製造委託の範囲</td><td>製造仕様（言語・コンポーネント・仕上がり基準）を事前合意</td><td>仕様が曖昧なまま製造すると後の変更対応が高コスト</td></tr>
<tr><td class="tc tcr">製造費（委託費）の設定</td><td>製造原価＋上流ロイヤルティ＋物流費を回収できる単価か</td><td><strong>上流ロイヤルティ分を必ず製造費に転嫁する</strong></td></tr>
<tr><td class="tc">貿易条件</td><td>FOB / CIF / EXW</td><td>FOBが当社有利（出荷後リスクは委託者＝海外の相手）</td></tr>
<tr><td class="tc">MPR（最低発注数量）</td><td>数量・評価期間（年次）・未達時の対応</td><td>未達時は「引き下げ交渉」か「解除権発生」かを先に決める</td></tr>
<tr><td class="tc">支払条件</td><td>前払い比率 / T/T〇日後 / L/C</td><td>新規取引先は前払い30〜50%が望ましい</td></tr>
<tr><td class="tc">不良品基準</td><td>AQL基準・検品タイミング・補充リードタイム</td><td>製造責任が当社にあるため、曖昧だと全額補填リスクを負う</td></tr>
<tr><td class="tc">現地規制対応費</td><td>CE・ASTM等の認証取得費の負担者</td><td>製品改修が必要な場合のコストは大きい</td></tr>
</tbody></table></div>
<p style="font-size:12px;color:var(--g5)">※認証・関税の属地論点（CE/UKCA、日EU・EPA原産地規則）は<a href="#s2" style="color:var(--blue)">S2の属地的特約</a>と共通。</p>
<h4 class="sh4">よくある落とし穴</h4>
<ul class="pl">
<li>仕様を曖昧にしたまま製造を始め、後からの変更で高コストになった</li>
<li>製造費を製造原価だけで設定し、上流ロイヤルティを乗せ忘れて逆ザヤになった</li>
<li>同一地域にS2のライセンシーがいるのにPO供給し、独占権を侵害した</li>
</ul>
<hr class="sd"/>
<!-- ===================== 応用 ===================== -->
<div class="shb" id="combo" style="background:linear-gradient(90deg,#1d3557,#3c3489)"><div class="sn">応用編 ── 新しい型ではなく「型の組み合わせ」</div><h2>複数IPを組み合わせたコラボ製品</h2></div>
<p>コラボは<strong>独立した新しい型ではありません</strong>。<span class="scode">S1/S5</span>（ライセンスイン）を<strong>2本</strong>取得したうえで、最後の出口を「自社販売」か「受託製造」かで選ぶ組み合わせです。だから8マスとは別の「応用」に置いています。</p>
<div class="cl cl-i"><strong>登場人物：</strong>ライセンサー＝相手①・②（2つのIPの大もと）／ライセンシー＝<strong>当社</strong>（2本のライセンスを取得）。パターンBでは当社がライセンサー名義の製造を受託（受託製造者）。</div>
<div class="tw"><table><thead><tr><th>パターン</th><th>構成</th><th>当社の立場</th><th>販売名義</th><th>当社の収益</th><th>在庫・販売リスク</th></tr></thead><tbody>
<tr><td class="tc">パターンA<br/>当社名義で販売</td><td>S1/S5 ×2本 ＋ 自社販売</td><td>ライセンシー＋販売者</td><td>当社</td><td>販売利益（ロイヤルティ×2控除後）</td><td><strong>当社が負う</strong></td></tr>
<tr><td class="tc">パターンB<br/>ライセンサー名義で販売</td><td>S1/S5 ×2本 ＋ 製造委託（＝S3類似）</td><td>ライセンシー＋受託製造者</td><td>ライセンサー（①or②）</td><td>製造費（受託料）</td><td>原則ライセンサー側</td></tr>
</tbody></table></div>
<div class="dw"><div class="dtitle">パターンB：当社が両ライセンスを取得し、ライセンサーの製造委託を受けて、ライセンサー名義で販売する</div>
<svg aria-hidden="true" style="width:100%;display:block" viewbox="0 0 660 150">
<defs><marker id="hlic" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#4B8BDB" points="0 0,7 3,0 6"></polygon></marker><marker id="hprd" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#1D9E75" points="0 0,7 3,0 6"></polygon></marker><marker id="hmny" markerheight="6" markerwidth="8" orient="auto" refx="6" refy="3"><polygon fill="#C47D1A" points="0 0,7 3,0 6"></polygon></marker></defs>
<rect fill="#fff" height="34" rx="6" stroke="#9CA3AF" stroke-width="1.2" width="128" x="8" y="22"></rect><text fill="#374151" font-family="sans-serif" font-size="11.5" font-weight="600" text-anchor="middle" x="72" y="36">ライセンサー①</text><text fill="#9CA3AF" font-family="sans-serif" font-size="9" text-anchor="middle" x="72" y="49">S1/S5取得済み</text>
<rect fill="#fff" height="34" rx="6" stroke="#9CA3AF" stroke-width="1.2" width="128" x="8" y="90"></rect><text fill="#374151" font-family="sans-serif" font-size="11.5" font-weight="600" text-anchor="middle" x="72" y="104">ライセンサー②</text><text fill="#9CA3AF" font-family="sans-serif" font-size="9" text-anchor="middle" x="72" y="117">S1別途締結</text>
<rect fill="#1d3557" height="46" rx="8" width="140" x="195" y="50"></rect><text fill="#fff" font-family="sans-serif" font-size="12.5" font-weight="600" text-anchor="middle" x="265" y="71">当社 ★</text><text fill="rgba(255,255,255,.6)" font-family="sans-serif" font-size="9" text-anchor="middle" x="265" y="85">受託製造</text>
<rect fill="#fff" height="62" rx="6" stroke="#9CA3AF" stroke-width="1.2" width="146" x="400" y="42"></rect><text fill="#374151" font-family="sans-serif" font-size="11.5" font-weight="600" text-anchor="middle" x="473" y="68">ライセンサー①or②</text><text fill="#9CA3AF" font-family="sans-serif" font-size="9" text-anchor="middle" x="473" y="82">委託者・名義販売</text>
<rect fill="rgba(0,0,0,.02)" height="30" rx="6" stroke="#B5C6D4" stroke-dasharray="4,2" stroke-width="1.2" width="80" x="572" y="58"></rect><text fill="#6B7280" font-family="sans-serif" font-size="10.5" font-weight="600" text-anchor="middle" x="612" y="77">市場</text>
<line marker-end="url(#hlic)" stroke="#4B8BDB" stroke-dasharray="5,3" stroke-width="1.5" x1="138" x2="193" y1="40" y2="58"></line><text fill="#4B8BDB" font-family="sans-serif" font-size="8" text-anchor="middle" x="160" y="40">許可①</text>
<line marker-end="url(#hlic)" stroke="#4B8BDB" stroke-dasharray="5,3" stroke-width="1.5" x1="138" x2="193" y1="106" y2="88"></line><text fill="#4B8BDB" font-family="sans-serif" font-size="8" text-anchor="middle" x="160" y="108">許可②</text>
<line marker-end="url(#hprd)" stroke="#1D9E75" stroke-width="1.5" x1="398" x2="337" y1="64" y2="64"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8" text-anchor="middle" x="367" y="59">製造委託</text>
<line marker-end="url(#hprd)" stroke="#1D9E75" stroke-width="1.5" x1="337" x2="398" y1="78" y2="78"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8" text-anchor="middle" x="367" y="90">納品/製造費</text>
<line marker-end="url(#hprd)" stroke="#1D9E75" stroke-width="1.5" x1="548" x2="570" y1="73" y2="73"></line><text fill="#1D9E75" font-family="sans-serif" font-size="8" text-anchor="middle" x="559" y="68">販売</text>
</svg></div>
<h4 class="sh4">パターン共通の確認事項</h4>
<div class="tw"><table><thead><tr><th>確認事項</th><th>内容</th></tr></thead><tbody>
<tr><td class="tcr">すでに渡した範囲との重複チェック</td><td>コラボ製品を売る地域・販路が、①②いずれかのIPで既に他社に許可済みの範囲と重ならないか</td></tr>
<tr><td class="tc">コラボ許諾の有無（上流①）</td><td>既存のS1/S5契約が「他社IPとのコラボ製品」を許可範囲に含むか。含まなければ追加許諾（覚書）が必要</td></tr>
<tr><td class="tc">②の組み合わせ承認</td><td>ライセンサー①が、②の他社IPと自社タイトルの組み合わせを承認するか</td></tr>
<tr><td class="tcr">ロイヤルティ設計</td><td>①と②のロイヤルティ合計を製品価格に転嫁できているか試算</td></tr>
<tr><td class="tcr">パターンBの製造費</td><td>製造費に①②両方のロイヤルティ相当を転嫁できているか（製造費＜ロイヤルティ合計なら逆ザヤ）</td></tr>
<tr><td class="tcr">監修の直列リスク</td><td>①②が別々に監修すると承認待ちが直列に積み上がり、スケジュールが倍になる</td></tr>
<tr><td class="tc">PL責任の所在（B）</td><td>当社は製造者として責任を問われうる。製造委託契約で責任分担を明確化</td></tr>
</tbody></table></div>
<h4 class="sh4">よくある落とし穴</h4>
<ul class="pl">
<li>①の既存ライセンスにコラボ許諾が含まれていなかったが、確認せず進めた</li>
<li>①と②の監修が直列になりゲームマーケットに間に合わなかった</li>
<li>パターンBで製造費を原価だけで設定し、①②のロイヤルティを考慮せず逆ザヤに</li>
<li>パターンBで販売名義はライセンサーなのに、消費者クレームの一次窓口を当社に設定していた</li>
</ul>
<hr class="sd"/>
<!-- ===================== 用語集 ===================== -->
<hr class="sd"/>
<h2 class="sec" id="terms">用語集：検索結果を詳しく読むために</h2>
<p>検索結果で表示されたスキームを詳しく確認するときに参照してください。最初からすべてを読む必要はありません。</p>
<p>このガイドでは、スキームを<strong>①IPを誰が利用するか、②誰が製造または製造委託を管理するか</strong>で判定します。製造主体とは、実際の工場ではなく、仕様・製造委託先・製造費・品質・納期・在庫を管理する当事者です。<strong>売主／買主はスキームの判定軸ではなく、完成品を供給した結果として生じる契約上の立場</strong>として整理します。</p>
<h3 class="sub">基本の4類型 ── IPの利用関係と製造主体</h3>
<div class="tw"><table><thead><tr><th>スキーム</th><th>IPの利用関係</th><th>製造・製造委託の主体</th><th>完成品の流れ</th><th>結果としての主な立場</th></tr></thead><tbody>
<tr><td class="tc">ライセンスイン</td><td>当社が相手方IPを利用する</td><td><strong>当社</strong></td><td>当社が製造し、市場へ販売</td><td>当社＝ライセンシー</td></tr>
<tr><td class="tc">プロダクトイン</td><td>利用許諾は必須ではない</td><td><strong>相手方または指定供給者</strong></td><td>相手方の完成品を当社が仕入れる</td><td>結果として相手方＝売主・供給者／当社＝買主</td></tr>
<tr><td class="tc">ライセンスアウト</td><td>相手方が当社管理IPを利用する</td><td><strong>相手方</strong></td><td>相手方が製造し、市場へ販売</td><td>当社＝ライセンサーまたはサブライセンサー</td></tr>
<tr><td class="tc">プロダクトアウト</td><td>利用許諾は取引内容により併存する</td><td><strong>当社</strong></td><td>当社の完成品を相手方へ供給</td><td>結果として当社＝売主・供給者／相手方＝買主</td></tr>
</tbody></table></div>
<div class="cl cl-n"><strong>製造主体の見分け方：</strong>「誰が実際に工場を持っているか」ではなく、誰が製造仕様を決め、工場等へ発注し、製造費・品質・納期・余剰在庫の責任を負うかで判断します。ライセンサーが指定工場を紹介するだけで、当社が発注・費用負担・品質管理を行う場合は、原則として当社が製造主体です。</div>
<div class="cl cl-n"><strong>プロダクトアウトの下位類型：</strong><br/>
  <strong>(a) 自主製造・卸売型</strong>＝当社が商品化を決定し、製造数量・在庫リスクを負って完成品を供給する（S6が典型）。<br/>
  <strong>(b) 受注製造型</strong>＝相手方の注文・仕様・数量に基づき、当社が製造または製造委託して納品する（S3が典型）。<br/>
いずれも<strong>製造主体は当社</strong>であり、違いは商品化の起点、仕様決定、数量決定、在庫リスクの所在です。</div>
<h3 class="sub">用語定義 ── 登場人物（契約上の呼び名で統一）</h3>
<p style="font-size:13px;color:#555">当事者は<strong>権利を「利用させる／利用する」関係</strong>で呼びます。ライセンス系の型は、つねに次の4語のどれかです。</p>
<div class="tw"><table><thead><tr><th>呼び名</th><th>意味</th></tr></thead><tbody>
<tr><td class="tc">ライセンサー</td><td>権利の利用を<strong>許諾する</strong>大もとの側。ロイヤルティを受け取る</td></tr>
<tr><td class="tc">ライセンシー</td><td>ライセンサーから権利の<strong>利用許諾を受ける</strong>側。ロイヤルティを支払う</td></tr>
<tr><td class="tc">サブライセンサー</td><td>利用許諾を受けた権利を<strong>第三者へ再許諾する</strong>側。ライセンサーから転許諾を認められていることが前提</td></tr>
<tr><td class="tc">サブライセンシー</td><td>その<strong>再許諾を受けて利用する</strong>側</td></tr>
</tbody></table></div>
<div class="cl cl-n"><strong>重要ルール ── 当社が「イン→当社→アウト」の真ん中に立つ場合：</strong><br/>
当社が大もと（ライセンサー）からIPの利用許諾を受け、さらに相手へ再許諾するときは、当社は<u>利用する側であり、かつ利用させる側</u>の二役になります。このとき当社は<strong>「ライセンシー（サブライセンサー）」</strong>と表記し、その相手は<strong>サブライセンシー</strong>になります。<br/>
逆に、当社の<strong>自社IP</strong>を相手に利用させる場合（再許諾ではない場合）は、当社は単に<strong>ライセンサー</strong>、相手は<strong>ライセンシー</strong>です。</div>
<h4 class="sh4">型ごとの役割対応（だれがどの呼び名か）</h4>
<div class="tw"><table><thead><tr><th>型</th><th>ライセンサー</th><th>ライセンシー</th><th>サブライセンシー</th></tr></thead><tbody>
<tr><td class="tc">S1 国内ライセンスイン</td><td>権利者（国内クリエイター・会社）</td><td><strong>当社</strong></td><td>—</td></tr>
<tr><td class="tc">S5 海外ライセンスイン</td><td>権利者（海外版元）</td><td><strong>当社</strong></td><td>—</td></tr>
<tr><td class="tc">S7 国内ライセンスアウト（自社IP）</td><td><strong>当社</strong></td><td>相手（国内他社）</td><td>—</td></tr>
<tr><td class="tc">S7 国内ライセンスアウト（S1/S5で利用許諾を受けたIPの再許諾）</td><td>大もとの権利者</td><td colspan="1"><strong>当社＝ライセンシー（サブライセンサー）</strong></td><td>相手（国内他社）</td></tr>
<tr><td class="tc">S2 海外ライセンスアウト（自社IP）</td><td><strong>当社</strong></td><td>相手（海外）</td><td>—</td></tr>
<tr><td class="tc">S2 海外ライセンスアウト（利用許諾を受けたIPの再許諾）</td><td>大もとの権利者</td><td><strong>当社＝ライセンシー（サブライセンサー）</strong></td><td>相手（海外）</td></tr>
<tr><td class="tc">コラボ（S1/S5×2）</td><td>権利者①・②</td><td><strong>当社</strong>（2本のライセンシー）</td><td>—</td></tr>
</tbody></table></div>
<p style="font-size:12px;color:#555">※「当社」はアークライト（図では紺の★）。会社の実体名は当社のまま、上の<strong>役割（呼び名）</strong>を併記して読む。</p>
<h4 class="sh4">プロダクト（モノ）系の型の呼び名</h4>
<p style="font-size:13px;color:#555">プロダクト系では、最初に<strong>製造・製造委託の主体</strong>を確認し、その後に売買・製造委託上の立場を整理します。売主／買主だけからスキームを判定しません。</p>
<div class="tw"><table><thead><tr><th>呼び名</th><th>意味</th></tr></thead><tbody>
<tr><td class="tc">製造主体／製造委託発注主体</td><td>仕様を決定し、工場等へ発注し、製造費・品質・納期・在庫を管理する側。プロダクトインは相手方、プロダクトアウトは当社</td></tr>
<tr><td class="tc">委託者／受託製造者</td><td>相手方の注文に基づく受注製造では、発注する側が委託者、製造または製造委託して納品する側が受託製造者。S3では相手方＝委託者、当社＝受託製造者</td></tr>
<tr><td class="tc">売主／買主</td><td>完成品を供給した結果として生じる売買上の立場。S4では相手方＝売主・当社＝買主、S6では当社＝売主・相手方＝買主。スキーム判定の出発点ではない</td></tr>
<tr><td class="tc">（IP面の併記）</td><td>製品にS1/S5由来や自社のIPが乗る場合は、製造・売買上の立場に加えて<strong>IP面の利用許諾関係</strong>も併記する。利用許諾を受けたIPを載せて供給するときは <strong>当社＝ライセンシー（サブライセンサー）／相手＝サブライセンシー／大もと＝ライセンサー</strong>。自社IPなら 当社＝ライセンサー／相手＝ライセンシー</td></tr>
</tbody></table></div>
<h4 class="sh4">テリトリー（範囲）</h4>
<div class="tw"><table><thead><tr><th>言葉</th><th>意味</th></tr></thead><tbody>
<tr><td class="tc">テリトリー</td><td>許可・供給が及ぶ<strong>範囲</strong>の総称。<strong>海外案件＝地域・言語</strong>、<strong>国内案件＝販路・チャネル（EC・量販・専門店など）</strong>を指す。本ガイドの「すでに渡した範囲との重複チェック」も、この読み替えで判断する</td></tr>
</tbody></table></div>
<h3 class="sub" id="terms-acr">用語定義 ── お金・数量のことば（略語）</h3>
<div class="tw"><table><thead><tr><th>言葉</th><th>読み・正式</th><th>意味</th></tr></thead><tbody>
<tr><td class="tc">ロイヤルティ</td><td>使用料</td><td>権利を利用する（利用させる）対価。売れた数や金額に応じて払う／もらう</td></tr>
<tr><td class="tc">計算基礎</td><td>—</td><td>ロイヤルティを何に掛けて計算するかの土台。<strong>定価ベース</strong>＝希望小売価格基準（国内慣行）／<strong>卸価格ベース（Net Sales）</strong>＝実際の出荷価格基準（海外アウト慣行）</td></tr>
<tr><td class="tc">MG／Advance</td><td>ミニマムギャランティ／前払金</td><td>「最低これだけは払う／もらう」と先に約束する保証金。前払い的なもの</td></tr>
<tr><td class="tc">MRG</td><td>最低保証ロイヤルティ</td><td>独占を続けるなら「年間これだけは売って納めてね」という最低ライン。下回ったら独占を外せる</td></tr>
<tr><td class="tc">MOQ／MPR</td><td>最低発注数量</td><td>1回（または1年）で最低これだけは発注する約束</td></tr>
<tr><td class="tc">MAP</td><td>最低小売価格</td><td>「これより安く売ってはダメ」という売価の下限。安売りでブランドが傷むのを防ぐ</td></tr>
<tr><td class="tc">AQL</td><td>合格品質水準</td><td>抜き取り検査で「不良がここまでならOK」という許容ライン</td></tr>
<tr><td class="tc">FOB／CIF／EXW</td><td>貿易条件（インコタームズ）</td><td>送料と「途中で壊れた時の責任」をどちらがどこまで負うかの取り決め。FOB＝船に積むまでが売主</td></tr>
</tbody></table></div>
<h3 class="sub">用語定義 ── 契約運用のことば</h3>
<div class="tw"><table><thead><tr><th>言葉</th><th>意味</th></tr></thead><tbody>
<tr><td class="tc">上流</td><td>当社より前の段階。当社にIPの利用を許諾する権利者の側を指す</td></tr>
<tr><td class="tc">転許諾（再許諾）</td><td>当社がライセンサーから利用許諾を受けたIPを、さらに相手（サブライセンシー）に利用させること。ライセンサーから転許諾を認められていることが必須</td></tr>
<tr><td class="tc">監修ターンアラウンド</td><td>監修（中身チェック）の返答にかかる日数。「何営業日以内に返す」と決めておく</td></tr>
<tr><td class="tc">沈黙承認</td><td>期限内に相手から返事が来なければ「承認した」とみなすルール。承認待ちの遅延を防ぐ</td></tr>
<tr><td class="tc">sell-off期間（在庫消化期間）</td><td>契約終了後、残った在庫を売りきってよい猶予期間</td></tr>
<tr><td class="tc">カニバリ（食い合い）</td><td>同じ商品が複数のルートで同じ客層に流れ、価格やブランドが崩れること</td></tr>
<tr><td class="tc">直販</td><td>当社が自社のチャネル（ホビーステーション等）で消費者へ直接売ること</td></tr>
</tbody></table></div>
<h3 class="sub">用語定義 ── 属地（海外案件）のことば</h3>
<div class="tw"><table><thead><tr><th>言葉</th><th>意味</th></tr></thead><tbody>
<tr><td class="tc">国際消尽／並行輸入</td><td>海外で権利者が適法に売った正規品は、日本に流れてきても原則として差し止められない（BBS事件・最高裁1997年）。この正規品の流入が並行輸入</td></tr>
<tr><td class="tc">EU27／EEA／英国／スイス</td><td>同じ「ヨーロッパ」でも別物。<strong>EU27</strong>≠<strong>EEA</strong>（EU27＋ノルウェー・アイスランド・リヒテンシュタイン）≠<strong>英国</strong>（離脱済）≠<strong>スイス</strong>（非加盟）。地域指定は国・言語で書く</td></tr>
<tr><td class="tc">EEA権利消尽</td><td>EEA域内のどこかで適法販売された製品は、EEA全域で再販を止められない。域内は一括テリトリーで設計するのが安全</td></tr>
<tr><td class="tc">CEマーキング／UKCA</td><td>製品安全の認証。EU/EEA＝CE、英国＝UKCA。原則別申請で、両方売るならコストが倍</td></tr>
<tr><td class="tc">EPA原産地規則</td><td>日EU・EPAの特恵関税は日本原産品が対象。中国工場製造は原産地規則を満たさず適用不可</td></tr>
</tbody></table></div>
<!-- ===================== 付録 ===================== -->
<h2 class="sec" id="appa">付録A：新旧・スキーム対応表</h2>
<p>旧版の「場面」番号・S番号と、本再編集版の8マスの対応です。<strong>S番号は変えていない</strong>ので、既存のテンプレートや他資料の参照はそのまま使えます。</p>
<div class="ap"><div class="tw"><table><thead><tr><th>8マス（本版）</th><th>S番号</th><th>旧・場面</th><th>主テンプレート</th></tr></thead><tbody>
<tr><td><span class="tag ts1">IN・ライセンス・国内</span></td><td>S1</td><td>場面3</td><td>license_master + individual_license_terms</td></tr>
<tr><td><span class="tag ts5">IN・ライセンス・海外</span></td><td>S5</td><td>場面2</td><td>相手方案 + Additional Terms X.1〜X.22</td></tr>
<tr><td><span class="tag ts4">IN・プロダクト・海外</span></td><td>S4</td><td>場面2</td><td>相手方案 + Additional Terms X.1〜X.22</td></tr>
<tr><td style="color:#9aa0a6">IN・プロダクト・国内</td><td>—</td><td>（旧版になし）</td><td><span class="pb">空白マス</span></td></tr>
<tr><td><span class="tag ts7">OUT・ライセンス・国内</span></td><td>S7</td><td>場面4</td><td><span class="pb">未整備</span></td></tr>
<tr><td><span class="tag ts2">OUT・ライセンス・海外</span></td><td>S2</td><td>場面1</td><td>intl_master（IGLA Schedule 1）</td></tr>
<tr><td><span class="tag ts6">OUT・プロダクト・国内</span></td><td>S6</td><td>場面4</td><td><span class="pb">未整備</span></td></tr>
<tr><td><span class="tag ts3">OUT・プロダクト・海外</span></td><td>S3</td><td>場面1</td><td>intl_master + Supply Terms Addendum</td></tr>
<tr><td colspan="4" style="background:#eef1f6;font-weight:700;color:var(--navy)">応用：コラボ（型の組み合わせ）</td></tr>
<tr><td>パターンA：当社名義販売</td><td>S1/S5×2</td><td>場面5A</td><td>license_master×2 + 自社販売</td></tr>
<tr><td>パターンB：製造受託</td><td>S1/S5×2 + 受託</td><td>場面5B</td><td>license_master×2 + 製造委託契約<span class="pb">未整備</span></td></tr>
</tbody></table></div></div>
<h2 class="sec" id="appb">付録B：補助契約・実行契約</h2>
<div class="ap"><p>主契約だけでは取引を実行できない場合があります。次の契約は、各スキームの前提または実行段階で追加します。</p><div class="tw"><table><thead><tr><th>契約</th><th>主な締結相手</th><th>使用場面・主な論点</th></tr></thead><tbody>
<tr><td class="tc">NDA</td><td>契約候補先・版元・製造先</td><td>未発表作品、原価、販売計画、仕様等を本契約前に開示する場合。国内は東京地裁、海外は本契約との整合を確認</td></tr>
<tr><td class="tc">転許諾同意書・変更覚書</td><td>元のライセンサー</td><td>当社が利用許諾を受けたIPを第三者へ再許諾し、または完成品供給を通じて第三者に利用させる場合</td></tr>
<tr><td class="tc">権利確認書・共同権利者同意書</td><td>共同著作者・所属会社・権利管理会社</td><td>契約相手が単独で利用許諾できるか不明な場合。職務著作、共同著作、代理権を確認</td></tr>
<tr><td class="tc">国内制作・製造委託</td><td>翻訳者・制作会社・製造会社</td><td>service_master + PO + 検収書 + 支払通知書。フリーランス法、検収、知財帰属、再委託等を確認</td></tr>
<tr><td class="tc">個別仕様書・発注書</td><td>売買先・供給先・製造委託先</td><td>基本契約の下で、商品、仕様、数量、単価、納期、検収条件等を案件ごとに確定</td></tr>
<tr><td class="tc">商標・販促素材利用許諾</td><td>ブランド権者または販売先</td><td>完成品の売買を超えて、ロゴ、画像、動画、販促文言等を広告・EC・店舗表示に利用させる場合</td></tr>
</tbody></table></div></div>
<h2 class="sec" id="appc">付録C：共通の必須6項目（全マス）</h2>
<div class="ap"><p style="margin-bottom:12px">法務に渡す前に、どのマスでも以下6項目を社内で決めておくこと。</p>
<div class="tw"><table><thead><tr><th>#</th><th>項目</th><th>業界慣行・目安</th></tr></thead><tbody>
<tr><td>1</td><td><strong>ロイヤルティの計算基礎</strong></td><td>国内：定価ベース。海外アウト：卸価格ベース（Net Sales）</td></tr>
<tr><td>2</td><td><strong>MG/代金の支払タイミング</strong></td><td>早期払いは支払う側に不利。資金繰りを踏まえ社内で統一</td></tr>
<tr><td>3</td><td><strong>費用負担の原則</strong></td><td>ローカライズ費・サンプル送付費・検査費の負担者を先に決める</td></tr>
<tr><td>4</td><td><strong>監修ターンアラウンド</strong></td><td>10〜15営業日が目安。沈黙承認ルールとセット</td></tr>
<tr><td>5</td><td><strong>報告・精算サイクル</strong></td><td>半期が慣行。支払期日まで決めてから法務に渡す</td></tr>
<tr><td>6</td><td><strong>終了後の在庫消化期間</strong></td><td>国内：3〜6ヶ月、海外：6〜12ヶ月が目安</td></tr>
</tbody></table></div></div>
</main>
<script>
(function(){
'use strict';
const state={maker:null,flow:null,region:null,extra:null};
const historyStack=[];
const labels={
 company:'当社が製造・製造委託',counterparty:'相手方が製造・製造委託',mixed:'製造主体が共同・未確定',
 'license-in':'相手方IPを当社が利用','product-in':'相手方製造品を仕入れる','license-out':'当社管理IPを相手方が利用','product-out':'当社製造品を供給','mixed-manufacturing':'共同・未確定の製造体制',
 domestic:'国内の相手',overseas:'海外の相手',own:'自社・管理IP',licensed:'他社から利用許諾を受けたIP',borrowed:'他社から利用許諾を受けたIP',unknown:'未確認',
 wholesale:'自主製造・卸売型',commissioned:'受注製造型',mixedProduct:'共同商品化・複合型',exclusive:'独占販売を希望',nonexclusive:'非独占',undecided:'未定'
};
const el={
 step1:document.getElementById('finder-step1'),step2:document.getElementById('finder-step2'),step3:document.getElementById('finder-step3'),step4:document.getElementById('finder-step4'),result:document.getElementById('finder-result'),
 bar:document.getElementById('selected-bar'),chips:document.getElementById('selected-chips'),reset:document.getElementById('finder-reset'),back:document.getElementById('finder-back')
};
function cloneState(){return {maker:state.maker,flow:state.flow,region:state.region,extra:state.extra};}
function pushHistory(){historyStack.push(cloneState());}
function setProgress(n){document.querySelectorAll('.prog').forEach((p,i)=>{p.classList.toggle('active',i===n-1);p.classList.toggle('done',i<n-1);});}
function renderChips(){const vals=[state.maker,state.flow,state.region,state.extra].filter(Boolean);el.bar.hidden=!vals.length;el.chips.innerHTML=vals.map(v=>'<span class="sel-chip">'+(labels[v]||v)+'</span>').join('');}
function markSelected(){document.querySelectorAll('[data-maker],[data-flow],[data-region],[data-extra]').forEach(b=>{const v=b.dataset.maker||b.dataset.flow||b.dataset.region||b.dataset.extra;b.classList.toggle('selected',v===state.maker||v===state.flow||v===state.region||v===state.extra);b.setAttribute('aria-pressed',b.classList.contains('selected')?'true':'false');});}
function updateUrl(){const p=new URLSearchParams();if(state.maker)p.set('maker',state.maker);if(state.flow)p.set('flow',state.flow);if(state.region)p.set('region',state.region);if(state.extra)p.set('extra',state.extra);const q=p.toString();history.replaceState(null,'',location.pathname+(q?'?'+q:'')+location.hash);}
function showStep(step){el.step1.hidden=step!==1;el.step2.hidden=step!==2;el.step3.hidden=step!==3;el.step4.hidden=step!==4;el.result.hidden=step!==5;setProgress(step);renderChips();markSelected();updateUrl();document.getElementById('finder').scrollIntoView({behavior:'smooth',block:'start'});}
function secondQuestion(){
 let title='',help='',opts=[];
 if(state.maker==='company'){
  title='当社が製造主体となる理由はどちらですか？';help='IPの利用許諾を受けて当社が商品化するか、当社製造品を相手方へ供給するかで区別します。';
  opts=[['license-in','相手方IPの利用許諾を受け、当社が商品化する','ライセンスイン：利用許諾を受ける側である当社が製造主体'],['product-out','当社が製造した完成品を相手方へ供給する','プロダクトアウト：当社が製造主体・供給主体']];
 }else if(state.maker==='counterparty'){
  title='相手方が製造主体となる理由はどちらですか？';help='当社管理IPを相手方が利用して商品化するか、相手方製造品を当社が仕入れるかで区別します。';
  opts=[['license-out','当社管理IPを相手方に利用させ、相手方が商品化する','ライセンスアウト：利用許諾を受ける相手方が製造主体'],['product-in','相手方が製造した完成品を当社が仕入れる','プロダクトイン：供給者側が製造主体']];
 }else{return false;}
 el.step2.innerHTML='<div class="step-title"><span>Q2</span><div><b>'+title+'</b><small>'+help+'</small></div></div><div class="choice-grid">'+opts.map(o=>'<button type="button" class="choice-card compact" data-flow="'+o[0]+'"><b>'+o[1]+'</b><small>'+o[2]+'</small></button>').join('')+'</div>';
 el.step2.querySelectorAll('[data-flow]').forEach(b=>b.addEventListener('click',()=>selectFlow(b.dataset.flow)));
 return true;
}
function fourthQuestion(){
 let title='',help='',opts=[];
 if(state.flow==='license-out'){
  title='相手方に利用させるIPはどちらですか？';help='他社から利用許諾を受けたIPの場合、元の契約で転許諾が認められている必要があります。';
  opts=[['own','当社が権利を保有・管理するIP','当社が直接ライセンサーになる'],['licensed','他社から利用許諾を受けたIP','当社はサブライセンサーになる'],['unknown','分からない／未確認','検索結果で上流確認を案内する']];
 }else if(state.flow==='product-out'){
  title='商品化の起点と在庫リスクはどちらにありますか？';help='いずれも製造主体は当社ですが、卸売型と受注製造型では契約条件が異なります。';
  opts=[['wholesale','当社が商品化を決定し、製造数量・在庫リスクを負う','自主製造・卸売型'],['commissioned','相手方の注文・仕様・数量に基づき当社が製造する','受注製造型'],['mixedProduct','双方で企画・費用・在庫を分担する／分からない','共同商品化・複合型として法務確認']];
 }else if(state.flow==='product-in'){
  title='日本国内で独占的に販売する予定ですか？';help='独占販売権は、完成品の購入だけでは当然には付与されません。';
  opts=[['exclusive','独占販売を希望する','販売地域・チャネルの独占条件を追加検討'],['nonexclusive','非独占で仕入れる','通常の売買・継続供給条件を検討'],['undecided','未定','検索結果で決定事項として表示']];
 }else{return false;}
 el.step4.innerHTML='<div class="step-title"><span>Q4</span><div><b>'+title+'</b><small>'+help+'</small></div></div><div class="choice-grid">'+opts.map(o=>'<button type="button" class="choice-card compact" data-extra="'+o[0]+'"><b>'+o[1]+'</b><small>'+o[2]+'</small></button>').join('')+'</div>';
 el.step4.querySelectorAll('[data-extra]').forEach(b=>b.addEventListener('click',()=>{pushHistory();state.extra=b.dataset.extra;renderResult();}));
 return true;
}
const baseResults={
 s1:{code:'S1',title:'国内ライセンスイン',phrase:'国内の権利者からIPの利用許諾を受け、当社が製造または製造委託して商品を販売する取引です。',maker:'当社。仕様・製造委託先・製造費・品質・納期を当社が管理します。',role:'利用許諾上：相手方＝ライセンサー／当社＝ライセンシー',conditions:['対象作品・利用方法・販売チャネル','ロイヤルティ計算基礎、MG、支払時期','製造仕様、監修段階、回答期限','契約期間、独占性、終了後の在庫販売'],detail:'#s1',compare:'#s5'},
 s5:{code:'S5',title:'海外ライセンスイン',phrase:'海外版元からIPの利用許諾を受け、当社が日本語版を製造または製造委託して販売する取引です。',maker:'当社。日本語版の仕様・製造委託先・品質・納期を当社が管理します。',role:'利用許諾上：相手方＝海外ライセンサー／当社＝ライセンシー',conditions:['対象作品、言語、販売地域','ロイヤルティ、MG、支払スケジュール','製造・ローカライズ範囲と承認期限','準拠法、紛争解決、終了後の在庫販売'],detail:'#s5',compare:'#s4'},
 spin:{code:'未整備',title:'国内プロダクトイン',phrase:'国内の相手方または指定供給者が製造した完成品を、当社が仕入れて販売する取引です。',maker:'相手方または相手方指定の供給者。製造責任・品質・納期の管理は供給者側です。',role:'完成品供給の結果として：相手方＝売主・供給者／当社＝買主・仕入主体',conditions:['商品、数量、単価、納期','検収・不良品・返品条件','販売地域・チャネル・独占性','継続供給、価格改定、終了条件'],detail:'#sPin',compare:'#s4',gap:true},
 s4:{code:'S4',title:'海外プロダクトイン',phrase:'海外の相手方または指定供給者が製造した完成品を、当社が輸入して日本で販売する取引です。',maker:'相手方または相手方指定の供給者。製造責任・品質・納期の管理は供給者側です。',role:'完成品供給の結果として：相手方＝売主・供給者／当社＝買主・輸入者',conditions:['商品仕様、MOQ、価格、貿易条件','納期、検収、不良品処理','日本での販売権・独占性','輸入規制、表示、安全性、並行輸入対応'],detail:'#s4',compare:'#s5'},
 s7:{code:'S7',title:'国内ライセンスアウト',phrase:'国内の相手方にIPの利用を許諾し、相手方が製造または製造委託して商品を販売する取引です。',maker:'相手方。相手方が商品仕様・製造委託先・製造費・品質・納期を管理します。',role:'利用許諾上：当社＝ライセンサーまたはサブライセンサー／相手方＝ライセンシーまたはサブライセンシー',conditions:['対象IP、商品、販路・チャネル','独占性、競合・既存許諾との重複','ロイヤルティ、MG、報告・監査','監修、品質管理、契約終了後の処理'],detail:'#s7',compare:'#s2'},
 s2:{code:'S2',title:'海外ライセンスアウト',phrase:'海外の相手方にIPの利用を許諾し、相手方が現地語版を製造または製造委託して販売する取引です。',maker:'相手方。相手方が現地版の仕様・製造委託先・製造費・品質・納期を管理します。',role:'利用許諾上：当社＝ライセンサーまたはサブライセンサー／相手方＝ライセンシーまたはサブライセンシー',conditions:['地域・言語・商品・販売チャネル','独占性、最低保証、販売開始期限','ロイヤルティ、Net Sales、税・送金','競争法、準拠法、仲裁、監修'],detail:'#s2',compare:'#s3'},
 s6:{code:'S6',title:'国内プロダクトアウト／自主製造・卸売型',phrase:'当社が商品化を決定し、製造または製造委託した完成品を国内企業へ供給する取引です。',maker:'当社。製造仕様・委託先・製造費・品質・納期・在庫を当社が管理します。',role:'完成品供給の結果として：当社＝売主・供給者／相手方＝買主・販売先',conditions:['商品仕様、数量、卸価格、発注方法','納期、引渡し、検収、不良品処理','販路・販売地域・価格政策','在庫リスク、返品、販売終了条件'],detail:'#s6',compare:'#s3'},
 s3:{code:'S3',title:'海外プロダクトアウト／受注製造型',phrase:'海外企業の注文・仕様・数量に基づき、当社が製造または製造委託して完成品を納品する取引です。',maker:'当社。ただし商品化の起点・仕様・数量は相手方の発注に基づきます。',role:'製造委託上：相手方＝委託者／当社＝受託製造者。完成品売買を伴う場合は、結果として当社＝売主・供給者／相手方＝買主',conditions:['製造仕様、数量、変更管理','製造費、前払金、貿易条件','検収、不良品、補充、責任分担','現地規制、認証、上流IPの許諾'],detail:'#s3',compare:'#s2'},
 domesticCommission:{code:'未整備',title:'国内プロダクトアウト／受注製造型',phrase:'国内企業の注文・仕様・数量に基づき、当社が製造または製造委託して完成品を納品する取引です。',maker:'当社。ただし商品化の起点・仕様・数量は相手方の発注に基づきます。',role:'製造委託上：相手方＝委託者／当社＝受託製造者。完成品売買を伴う場合は売主・買主の立場も併存します。',conditions:['成果物・仕様・変更手続','委託料、材料費、支払条件','納期、検収、契約不適合責任','知的財産、製造物責任、再委託'],detail:'#s6',compare:'#s3',gap:true},
 overseasWholesale:{code:'未整備',title:'海外プロダクトアウト／自主製造・卸売型',phrase:'当社が商品化を決定し、製造または製造委託した完成品を海外企業へ卸し、相手方が現地で再販売する取引です。',maker:'当社。製造仕様・委託先・製造費・品質・納期・在庫を当社が管理します。',role:'完成品供給の結果として：当社＝売主・供給者／相手方＝買主・販売店',conditions:['商品、地域、販路、独占性','価格、MOQ、発注、貿易条件','検収、保証、返品、リコール','現地規制、商標使用、販売店管理'],detail:'#s3',compare:'#s2',gap:true},
 mixedProduct:{code:'要個別設計',title:'共同商品化・複合型プロダクトアウト',phrase:'当社が製造主体である一方、企画・費用・在庫リスクを双方が分担するため、売買・製造委託・ライセンスの構成を個別に整理します。',maker:'当社を中心としつつ、相手方も仕様・費用・在庫リスクの一部を負担します。',role:'製造委託・共同事業・売買・利用許諾の複数の立場が併存する可能性があります。',conditions:['誰が企画・仕様を決定するか','製造費・在庫・販売リスクの分担','知的財産と商標使用の関係','代金の性質と検収・責任分担'],detail:'#appc',compare:'#map',gap:true},
 mixedManufacturing:{code:'要個別設計',title:'製造主体が共同・未確定の取引',phrase:'製造・製造委託の管理主体が一方に定まらないため、スキーム選別の前に製造責任と費用負担を整理する必要があります。',maker:'未確定または双方分担。仕様、発注先、製造費、品質、納期、余剰在庫の責任を項目別に確定してください。',role:'売買・製造委託・共同事業・利用許諾のいずれを中心契約とするか個別設計します。',conditions:['製造仕様の最終決定者','工場等への発注名義と製造費負担','品質・納期・不良品・在庫の責任','IP利用、販売名義、収益配分'],detail:'#appc',compare:'#map',gap:true}
 };
const contractSets={"s1":[{"kind":"主契約","name":"国内IP利用許諾契約","party":"国内の権利者／当社＝ライセンシー","note":"対象IP、商品、地域・販路、ロイヤルティ、監修等を定める","checks":["許諾者が対象IPを単独で許諾できるか","対象IP・商品／媒体・販路・地域・期間・独占性","ロイヤルティ／MG・計算基礎・報告／監査方法","監修・改変・成果物の権利・終了後在庫の取扱い"]},{"kind":"前提","name":"権利確認書・共同権利者同意書","party":"共同著作者、所属会社、権利管理会社等","note":"契約相手が単独で許諾できない場合","checks":["著作権・商標権等の原始帰属と譲渡履歴","共同著作者・所属会社・権利管理会社の同意範囲","第三者素材・肖像・名称等が含まれていないか","権限保証、紛争発生時の協力・補償"]},{"kind":"実行","name":"制作・翻訳・製造委託契約／発注書","party":"翻訳者、制作会社、製造会社／当社＝委託者","note":"当社が制作・製造を外部委託する場合","checks":["成果物・仕様・納期・修正回数・変更手続","請負／準委任の区分、検収・再実施・支払条件","著作権帰属・二次利用・著作者人格権不行使","再委託、秘密保持、支給素材、品質・不良対応"]}],"s5":[{"kind":"主契約","name":"国際IP利用許諾契約（Master＋個別条件書）","party":"海外版元・権利者／当社＝ライセンシー","note":"言語、地域、商品、MG・ロイヤルティ、監修、準拠法等を定める","checks":["契約主体・署名権限・対象IPの許諾権限","言語・地域・商品・媒体・製造権・再許諾の範囲","MG／ロイヤルティ、通貨・税・送金、報告／監査","ローカライズ・改変・監修期限・承認手続","期間・更新・sell-off・準拠法・紛争解決"]},{"kind":"条件付","name":"NDA","party":"海外版元・権利者","note":"本契約前に未発表情報等を開示する場合","checks":["検討目的と秘密情報の定義・除外情報","グループ会社・翻訳者・製造先への共有可否","秘密保持期間、返還・消去、複製物の管理","準拠法、差止め、既存NDAとの優先関係"]},{"kind":"実行","name":"翻訳・制作・製造委託契約／発注書","party":"翻訳者、制作会社、製造会社／当社＝委託者","note":"日本語版の制作・製造を外部委託する場合","checks":["上流契約上の仕様・監修・秘密保持条件を反映したか","成果物・版管理・納期・修正・検収手続","翻訳・デザイン等の権利帰属と人格権不行使","再委託先、支給データ、製造品質・不良時の責任"]}],"spin":[{"kind":"主契約","name":"国内売買基本契約／継続供給契約","party":"国内の製造・供給者／当社＝買主・販売者","note":"商品、価格、納期、検収、不良品、返品等を定める","checks":["供給者の販売権限・製造主体・正規流通品か","商品仕様、価格・税、発注方法、最低発注数量","納期・引渡場所・危険負担・所有権・検収","契約不適合、不良品、返品、リコール・費用負担","価格改定、供給停止、終売通知、在庫・部品対応"]},{"kind":"実行","name":"個別発注書・注文請書","party":"国内の供給者","note":"商品、数量、単価、納期を個別に確定する","checks":["適用する基本契約・文書間の優先順位","品名・仕様／版・数量・単価・消費税","納期・納品場所・検収期限・請求／支払日","変更・キャンセル・不足／過納時の処理"]},{"kind":"条件付","name":"独占販売契約／ブランド利用許諾","party":"販売権限・ブランド権限を持つ相手","note":"独占販売または販促素材の利用を伴う場合","checks":["付与者が独占販売権・ブランド利用権を付与できるか","対象地域・販路・顧客・商品・独占期間","直販・他社供給・最低購入数量・販売開始期限","利用可能な商標・素材、承認手続、終了後の削除"]}],"s4":[{"kind":"主契約","name":"国際売買・継続供給契約／ディストリビューション契約","party":"海外の製造・供給者／当社＝買主・輸入者・販売者","note":"商品、価格、MOQ、貿易条件、検収、不良品等を定める","checks":["供給者の販売権限・製造主体・サプライチェーン","商品仕様、MOQ・予測、価格・通貨・税・関税","Incoterms、所有権・危険移転、保険・通関書類","納期、到着後検収、潜在欠陥、不良補充・リコール","供給継続、価格改定、終売・部品／交換品の確保"]},{"kind":"条件付","name":"独占販売契約／独占条項","party":"海外版元または正当な販売権限を持つ供給者","note":"日本・特定チャネルで独占販売する場合","checks":["独占権の付与権限と既存代理店・販売店の有無","地域・言語・販路・顧客・オンライン販売の範囲","直販・他社供給・最低購入量・販売開始期限","競争法上の制約、受動的販売・並行流通の扱い","期間、非独占化・解除、終了後在庫の販売"]},{"kind":"条件付","name":"商標・販促素材利用許諾","party":"IP・商標権者／当社＝利用者","note":"ロゴ・画像等を広告に利用する場合","checks":["権利者・許諾権限と対象商標／素材の特定","媒体・地域・期間・翻訳／編集・広告出稿の範囲","ブランドガイド、事前承認、クレジット表示","広告代理店・EC・SNS事業者への共有可否","終了後の掲載停止・データ削除・在庫販促物の扱い"]}],"s7":[{"kind":"主契約","name":"国内IP利用許諾契約","party":"国内の利用者・商品化事業者／当社＝ライセンサーまたはサブライセンサー","note":"商品、販路、ロイヤルティ、監修、報告等を定める","checks":["当社の権利保有・管理権限または転許諾権限","対象IP・商品・媒体・販路・地域・期間","独占性、MRG、販売開始期限、競合許諾との重複","ロイヤルティ、報告・証憑・監査、税の扱い","監修・品質・回収、再許諾・製造委託、sell-off"]},{"kind":"前提","name":"転許諾同意書／上流契約の変更覚書","party":"元のライセンサー／当社＝ライセンシー","note":"上流から利用許諾を受けたIPを再許諾する場合","checks":["再許諾先・商品・販路・地域・期間を特定したか","上流への追加ロイヤルティ・報告・承認条件","監修・品質・表示等を下流契約へ転嫁できるか","下流違反時の当社責任と上流への補償","上流契約終了時の下流契約・在庫の処理"]},{"kind":"条件付","name":"NDA","party":"許諾先候補","note":"未発表商品・販売計画等を契約前に開示する場合","checks":["検討目的・秘密情報・開示範囲","役職員・委託先への共有と管理義務","秘密保持期間・返還／廃棄・公表可否","本契約不成立時の企画・サンプル利用禁止"]}],"s2":[{"kind":"主契約","name":"国際IP利用許諾契約（Master＋個別条件書）","party":"海外の利用者・現地版元／当社＝ライセンサーまたはサブライセンサー","note":"地域・言語、商品、MG・ロイヤルティ、監修、準拠法等を定める","checks":["当社の権利・転許諾権限と相手方の契約主体／信用","地域・言語・商品・媒体・販路・製造／再許諾範囲","独占性、発売期限、MG・ロイヤルティ、Net Sales定義","報告・監査、源泉税・送金・通貨／為替の扱い","監修・品質・現地規制、競争法・制裁／輸出管理","期間・sell-off・準拠法・仲裁・判決／仲裁判断の執行"]},{"kind":"前提","name":"転許諾同意書／上流契約の変更覚書","party":"元のライセンサー／当社＝ライセンシー","note":"上流から利用許諾を受けたIPを海外へ再許諾する場合","checks":["対象国・言語・再許諾先・商品・販売経路","追加対価、為替・税、上流への報告・監査","現地版の監修・品質・クレジット条件","下流契約への必須条項・責任転嫁","上流終了時の下流契約・在庫・素材の処理"]},{"kind":"条件付","name":"NDA","party":"海外候補先","note":"秘密情報を開示して交渉する場合","checks":["検討目的・秘密情報・許可された利用","関連会社・専門家・製造候補への共有範囲","秘密保持期間、返還／削除、残存情報の扱い","準拠法・差止め・公表／プレスリリース"]},{"kind":"条件付","name":"交渉代理・エージェント契約","party":"現地エージェント／当社＝委託者","note":"第三者に候補先探索・交渉・契約事務を委ねる場合","checks":["権限範囲（紹介・交渉・署名権限の有無）","対象地域・案件、独占性、競業・利益相反","報酬・成功報酬の算定基礎と支払時期","秘密保持、法令遵守、再委託、活動報告","契約終了後のテール報酬・顧客帰属"]}],"s6":[{"kind":"主契約","name":"国内売買基本契約／継続供給・販売店契約","party":"国内の販売先・卸先／当社＝売主・供給者","note":"商品、卸価格、発注、検収、返品、販路等を定める","checks":["商品・卸価格・発注単位・支払条件・与信","引渡し、危険負担・所有権、検収・不良品・返品","販売地域・販路・再卸・EC／マーケットプレイスの可否","販促・価格表示の運用は独禁法上の制約を法務確認","終売・契約終了・残存在庫・リコール時の協力"]},{"kind":"実行","name":"個別発注書・注文請書","party":"国内の販売先","note":"商品、数量、単価、納期を個別に確定する","checks":["基本契約の特定と個別条件の優先順位","商品・仕様／版・数量・単価・消費税","納期・納品場所・請求／支払日","変更・キャンセル・分納・欠品時の処理"]},{"kind":"条件付","name":"OEM・製造受託契約","party":"仕様・数量を指定する国内委託者／当社＝受託製造者","note":"相手方起点の商品を当社が製造する場合","checks":["仕様決定、設計・材料・金型・支給品の責任分担","発注数量・予測・キャンセル・仕様変更の手続","委託料・材料費・価格改定、検収・契約不適合","知財・金型／データの帰属、再委託・秘密保持","製造物責任・表示規制・リコール・保険","取適法・フリーランス法等の適用と書面／支払条件"]},{"kind":"条件付","name":"商標・販促素材利用許諾","party":"販売先／当社＝ライセンサーまたは権限付与者","note":"販売先が当社ブランド素材を利用する場合","checks":["当社が許諾できる商標・画像・商品情報の範囲","利用媒体・店舗／EC・期間・改変可否","ブランドガイド・事前承認・表示義務","第三者制作会社への共有と素材管理","終了・違反時の掲載停止・データ削除"]}],"s3":[{"kind":"主契約","name":"国際OEM・製造供給契約／製造業務委託契約","party":"海外の発注者・委託者／当社＝受託製造者・供給者","note":"仕様、数量、製造費、納期、検収、貿易条件等を定める","checks":["売買／製造委託の性質と当社・相手方の責任範囲","仕様・サンプル・変更管理、材料・金型・支給品","予測・MOQ・確定発注・キャンセル・余剰在庫","価格・前払金・通貨／税、Incoterms・危険／所有権移転","検収・潜在欠陥・補充、製造物責任・リコール","IP・再委託・認証／表示規制・制裁／輸出管理","準拠法・仲裁・責任制限・保険"]},{"kind":"実行","name":"個別仕様書・発注書・注文請書","party":"海外の委託者","note":"仕様、数量、価格、納期、認証等を個別に確定する","checks":["適用するMaster契約と文書間の優先順位","仕様書番号・版、数量、単価・通貨・税","製造／出荷日、Incoterms、梱包・表示・必要書類","検収基準・サンプル承認・変更／キャンセル手続"]},{"kind":"前提","name":"製造目的のIP利用許諾","party":"相手方またはIP権利者／当社＝製造目的の利用者","note":"相手方IP・データ・商標を製造に利用する場合","checks":["許諾者の権限と製造対象IP・データの特定","製造目的・工場／再委託先・地域・期間の限定","複製・保管・データセキュリティ・監修／承認","製造以外の利用禁止、余剰品・データの返還／廃棄"]},{"kind":"前提","name":"転許諾同意書／上流契約の変更覚書","party":"元のライセンサー","note":"当社が上流IPを載せた完成品を供給する場合","checks":["供給先・販売地域・商品・数量・販売権限の範囲","追加ロイヤルティ、販売報告、サンプル・監修","下流への品質・表示・禁止事項の転嫁","上流契約終了時の供給・在庫・下流販売の処理"]}],"domesticCommission":[{"kind":"主契約","name":"国内OEM・製造受託契約","party":"国内の発注者・委託者／当社＝受託製造者","note":"仕様、数量、委託料、検収、知財、製造物責任等を定める","checks":["成果物・仕様・材料／金型・支給品の責任分担","数量・納期・仕様変更・キャンセル・余剰在庫","委託料・材料費・支払期日・価格改定","検収・契約不適合・製造物責任・リコール","知財・データ・金型の帰属、再委託・秘密保持","取適法・フリーランス法等の適用と書面交付"]},{"kind":"実行","name":"個別仕様書・発注書・注文請書","party":"国内の委託者","note":"案件ごとの仕様・数量・価格・納期を確定する","checks":["基本契約・仕様書の版と優先順位","品名・仕様・数量・単価・材料費・消費税","納期・納品場所・検収期限・支払日","変更・キャンセル・追加費用の承認方法"]},{"kind":"前提","name":"製造目的のIP利用許諾","party":"相手方またはIP権利者","note":"相手方IPを製造に利用する場合","checks":["権利者・許諾権限と対象素材の特定","製造目的・委託工場・期間・数量の範囲","複製・保管・秘密保持・承認手続","余剰品・データ・版下の返還／廃棄"]}],"overseasWholesale":[{"kind":"主契約","name":"国際売買・ディストリビューション契約","party":"海外の販売店・ディストリビューター／当社＝売主・供給者","note":"地域、販路、価格、MOQ、貿易条件、検収等を定める","checks":["販売店の信用・輸入資格・地域／販路・独占性","商品、価格・通貨・税、MOQ・予測・発注確定","Incoterms・危険／所有権移転・保険・通関","検収・保証・返品・リコール・現地顧客対応","再販売先・オンライン販売・商標使用・販売報告","競争法・制裁／輸出管理、準拠法・紛争解決"]},{"kind":"実行","name":"個別発注書・注文請書","party":"海外の販売店","note":"商品、数量、価格、納期を個別に確定する","checks":["Master契約・価格表・仕様版の特定","商品・数量・単価・通貨・税","出荷日、Incoterms、納品先・梱包／書類","変更・キャンセル・欠品・分納の処理"]},{"kind":"条件付","name":"商標・販促素材利用許諾","party":"海外の販売店","note":"当社ブランド素材を現地販促に利用する場合","checks":["対象商標・画像・商品情報と当社の許諾権限","現地言語化・編集、媒体・地域・期間","ブランドガイド、事前承認、法定表示","代理店・小売店・広告会社への再提供範囲","終了後の掲載停止・素材削除・ドメイン／SNS処理"]}],"mixedProduct":[{"kind":"主契約","name":"共同商品化・共同開発契約","party":"共同事業者／当社＝共同事業当事者","note":"企画、費用、製造、在庫、知財、収益、撤退条件を定める","checks":["当事者・意思決定権・承認事項・プロジェクト責任者","企画・開発・製造・販売の役割と費用超過の負担","既存IP・新規成果物・商標・データの帰属／利用権","品質・検収・不良品・在庫・製造物責任","売上計上・収益配分・経費・監査・税務処理","デッドロック、撤退・終了、残在庫・成果物の処理"]},{"kind":"実行","name":"個別条件書・製造供給契約・利用許諾契約","party":"役割に応じた各当事者","note":"主契約で整理した役割ごとに個別条件を確定する","checks":["共同事業基本契約との整合・文書間の優先順位","案件ごとの当事者・役割・対象商品／IP","仕様・数量・価格・納期・承認／検収","変更・中止・追加費用・責任の連動条件"]}],"mixedManufacturing":[{"kind":"主契約","name":"取引基本合意書／共同事業基本契約","party":"製造・販売・権利関係に関与する当事者","note":"製造主体、費用、品質、在庫、IP、販売名義を先に整理する","checks":["仕様・工場選定・発注名義・最終決定者の責任表","製造費・追加費用・在庫・物流・保険の負担","品質・納期・不良品・リコール・第三者責任","IP利用・成果物・商標・販売名義・顧客対応","収益配分・会計・税、意思決定・デッドロック","確定契約への移行条件・終了時の処理"]},{"kind":"実行","name":"利用許諾・売買・製造委託の各契約","party":"整理後の各担当当事者","note":"確定した役割に応じて必要契約を分割または一体化する","checks":["確定した役割ごとに契約類型を選択したか","当事者・対象・対価・履行内容の漏れ／重複がないか","各契約の優先順位・相互条件・クロスデフォルト","主契約の終了が他契約・在庫・許諾に与える影響"]}]};
function determine(){
 if(state.flow==='mixed-manufacturing')return 'mixedManufacturing';
 if(state.flow==='license-in')return state.region==='domestic'?'s1':'s5';
 if(state.flow==='product-in')return state.region==='domestic'?'spin':'s4';
 if(state.flow==='license-out')return state.region==='domestic'?'s7':'s2';
 if(state.flow==='product-out'){
  if(state.extra==='mixedProduct')return 'mixedProduct';
  if(state.region==='domestic')return state.extra==='commissioned'?'domesticCommission':'s6';
  return state.extra==='wholesale'?'overseasWholesale':'s3';
 }
 return null;
}
function extraWarnings(key){const w=[];
 if(state.flow==='license-out'&&(state.extra==='licensed'||state.extra==='borrowed'))w.push('<strong>転許諾の確認が必須です。</strong> 元のライセンサーとの契約で、第三者へのサブライセンスが許可されているか確認してください。');
 if(state.flow==='license-out'&&state.extra==='unknown')w.push('<strong>IPの権利関係が未確認です。</strong> 自社IPか、他社から利用許諾を受けたIPかを確定し、後者の場合は転許諾権限を確認してください。');
 if(state.flow==='product-in'&&state.extra==='exclusive')w.push('<strong>独占販売権は製品購入だけでは付いてきません。</strong> 販売地域・チャネル、直販、並行輸入、最低購入数量を別途合意してください。');
 if(state.flow==='product-in'&&state.extra==='undecided')w.push('<strong>独占性が未定です。</strong> 法務相談前に、非独占仕入れか独占販売かを決めてください。');
 if(baseResults[key].gap)w.push('<strong>現行テンプレート・S番号に完全一致しない取引です。</strong> 製造責任、費用負担、IP利用、完成品供給の関係を法務で個別に設計してください。');
 return w;
}
function reasonText(){return [labels[state.maker],labels[state.flow],labels[state.region],labels[state.extra]].filter(Boolean).join(' × ');}
function memoText(r,key){const cs=contractSets[key]||[];return ['法務相談用メモ','・想定スキーム：'+r.code+' '+r.title,'・取引分類：'+reasonText(),'・製造・製造委託の主体：'+r.maker,'・契約上の立場：'+r.role,'・必要契約：'+cs.map(c=>c.name+'（'+c.party+'）').join('／'),'・契約別確認事項：'+cs.map(c=>c.name+'：'+c.checks.join('、')).join('／'),'・対象商品・IP：未入力','・契約相手：未入力','・主な条件：未入力','・発売・納品予定：未入力'].join('\n');}
function renderResult(){
 const key=determine(),r=baseResults[key];if(!r)return;
 const warnings=extraWarnings(key);
 el.result.innerHTML='<div class="result-head"><div class="result-eyebrow">推奨スキーム</div><h3><span class="scode">'+r.code+'</span>'+r.title+'</h3><p>'+r.phrase+'</p></div><div class="result-body">'+
 '<div class="result-reason"><strong>この結果になった理由：</strong> '+reasonText()+'</div>'+
 '<div class="result-grid"><div class="result-panel"><h4>製造・製造委託の主体</h4><p>'+r.maker+'</p></div><div class="result-panel"><h4>契約上の立場</h4><p>'+r.role+'</p></div><div class="result-panel full"><h4>必要な契約と締結相手</h4><div class="tw"><table class="result-contract-table"><thead><tr><th>区分</th><th>契約</th><th>締結相手・当社の立場</th><th>目的</th><th>契約前の確認事項</th></tr></thead><tbody>'+(contractSets[key]||[]).map(c=>'<tr><td>'+c.kind+'</td><td><strong>'+c.name+'</strong></td><td>'+c.party+'</td><td>'+c.note+'</td><td><ul class="contract-checks">'+c.checks.map(x=>'<li>'+x+'</li>').join('')+'</ul></td></tr>').join('')+'</tbody></table></div></div><div class="result-panel full"><h4>法務相談前に決めること</h4><ul>'+r.conditions.map(x=>'<li>'+x+'</li>').join('')+'</ul></div></div>'+
 warnings.map(x=>'<div class="result-alert">'+x+'</div>').join('')+
 '<div class="result-note"><strong>売主・買主は結果として確認：</strong> まず製造主体とIPの利用関係を確定し、その後に完成品供給に伴う売買上の立場を整理してください。</div>'+
 '<div class="result-actions"><a class="primary-action" href="'+r.detail+'">'+r.title+'の詳細を見る</a><a class="secondary-action" href="'+r.compare+'">類似スキームと比較</a><button type="button" class="secondary-action" id="memo-toggle">法務相談用メモ</button><button type="button" class="secondary-action" id="result-reset">選び直す</button></div>'+
 '<div class="result-memo" id="result-memo"><pre id="memo-text">'+memoText(r,key)+'</pre><div class="result-actions"><button type="button" class="secondary-action" id="memo-copy">メモをコピー</button></div></div></div>';
 el.result.querySelector('#result-reset').addEventListener('click',reset);
 el.result.querySelector('#memo-toggle').addEventListener('click',()=>document.getElementById('result-memo').classList.toggle('open'));
 el.result.querySelector('#memo-copy').addEventListener('click',async e=>{try{await navigator.clipboard.writeText(document.getElementById('memo-text').textContent);e.currentTarget.textContent='コピーしました';}catch(_){document.getElementById('result-memo').classList.add('open');e.currentTarget.textContent='上のメモを選択してコピー';}});
 showStep(5);
}
function selectMaker(v){pushHistory();state.maker=v;state.flow=state.region=state.extra=null;if(v==='mixed'){state.flow='mixed-manufacturing';showStep(3);}else{secondQuestion();showStep(2);}}
function selectFlow(v){pushHistory();state.flow=v;state.region=state.extra=null;showStep(3);}
function selectRegion(v){pushHistory();state.region=v;state.extra=null;if(fourthQuestion())showStep(4);else renderResult();}
function reset(){state.maker=state.flow=state.region=state.extra=null;historyStack.length=0;showStep(1);}
function back(){if(!historyStack.length){reset();return;}const prev=historyStack.pop();Object.assign(state,prev);if(!state.maker)showStep(1);else if(!state.flow){secondQuestion();showStep(2);}else if(!state.region)showStep(3);else if(!state.extra&&fourthQuestion())showStep(4);else renderResult();}
document.querySelectorAll('[data-maker]').forEach(b=>b.addEventListener('click',()=>selectMaker(b.dataset.maker)));
document.querySelectorAll('[data-region]').forEach(b=>b.addEventListener('click',()=>selectRegion(b.dataset.region)));
el.reset.addEventListener('click',reset);el.back.addEventListener('click',back);
const examples={s5:['company','license-in','overseas',null],s4:['counterparty','product-in','overseas','nonexclusive'],s7:['counterparty','license-out','domestic','own'],s2:['counterparty','license-out','overseas','own'],s6:['company','product-out','domestic','wholesale'],s3:['company','product-out','overseas','commissioned']};
document.querySelectorAll('[data-example]').forEach(b=>b.addEventListener('click',()=>{const x=examples[b.dataset.example];state.maker=x[0];state.flow=x[1];state.region=x[2];state.extra=x[3];historyStack.length=0;renderResult();}));
const p=new URLSearchParams(location.search),f=p.get('flow'),r=p.get('region'),rawX=p.get('extra'),x=rawX==='borrowed'?'licensed':rawX;
let m=p.get('maker');
if(!m&&f){if(f==='license-in'||f==='product-out')m='company';else if(f==='license-out'||f==='product-in')m='counterparty';else if(f==='mixed-manufacturing')m='mixed';}
if(['company','counterparty','mixed'].includes(m))state.maker=m;
if(['license-in','product-in','license-out','product-out','mixed-manufacturing'].includes(f))state.flow=f;
if(['domestic','overseas'].includes(r))state.region=r;
if(x)state.extra=x;
if(state.maker&&state.flow&&state.region){if(['license-out','product-in','product-out'].includes(state.flow)&&!state.extra){fourthQuestion();showStep(4);}else renderResult();}
else if(state.maker&&state.flow)showStep(3);
else if(state.maker){if(state.maker==='mixed'){state.flow='mixed-manufacturing';showStep(3);}else{secondQuestion();showStep(2);}}
else showStep(1);
const links=[...document.querySelectorAll('#sidebar a[href^="#"]')];
const sections=links.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);
const obs=new IntersectionObserver(entries=>{entries.forEach(en=>{if(en.isIntersecting){links.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+en.target.id));}});},{rootMargin:'-20% 0px -70% 0px'});sections.forEach(s=>obs.observe(s));
})();
</script>
</body></html>$g_bg$, 'seed 0095 (from services/api/guides)', 'seed')
    RETURNING id INTO vid;
  UPDATE portal_guides
     SET current_version_id = vid, status = 'published', updated_at = now()
   WHERE id = gid;
END
$seed_bg$;

-- ── clause ──────────────────────────────────────────────
DO $seed_clause$
DECLARE gid INTEGER; vid INTEGER;
BEGIN
  SELECT id INTO gid FROM portal_guides WHERE guide_key = 'clause';
  IF gid IS NULL THEN
    RAISE NOTICE 'skip clause: portal_guides にメタ行なし(0094 を先に適用)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM portal_guide_versions WHERE guide_id = gid) THEN
    RETURN; -- 既に版あり。再適用しない(冪等)。
  END IF;
  INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
    VALUES (gid, 1, $g_clause$<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>法務部 実務ガイド</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Hiragino Sans','Noto Sans JP',sans-serif;font-size:13.5px;line-height:1.7;color:#212529;background:#fff}
#topnav{position:fixed;top:0;left:0;right:0;height:48px;background:#1d3557;z-index:2000;display:flex;align-items:center;gap:2px;padding:0 14px;box-shadow:0 2px 6px rgba(0,0,0,.25)}
#topnav .tn-brand{font-size:11px;font-weight:700;color:rgba(255,255,255,.45);letter-spacing:.08em;text-transform:uppercase;padding-right:14px;border-right:1px solid rgba(255,255,255,.15);margin-right:6px;white-space:nowrap}
#topnav .tn-btn{padding:5px 13px;border-radius:5px;font-size:12px;font-weight:600;color:rgba(255,255,255,.65);cursor:pointer;border:none;background:none;transition:all .15s;white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center}
#topnav .tn-back:hover{background:rgba(255,255,255,.1);color:#fff}
#topnav .tn-btn:hover{background:rgba(255,255,255,.1);color:#fff}
#topnav .tn-btn.active{background:rgba(255,255,255,.18);color:#fff}
.guide-wrap{display:block}
#guide-portal{display:none;padding-top:48px;min-height:100vh;background:#f8f9fa}
#guide-portal.active{display:block}
.portal-inner{max-width:620px;margin:0 auto;padding:48px 20px 60px;display:flex;flex-direction:column;align-items:center}
.portal-header{text-align:center;margin-bottom:36px}
.portal-label{font-size:11px;font-weight:700;color:#6c757d;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px}
.portal-title{font-size:22px;font-weight:700;color:#1d3557}
.portal-sub{font-size:13px;color:#6c757d;margin-top:6px}
.portal-cards{width:100%;display:grid;gap:12px}
.portal-card{display:flex;align-items:center;gap:16px;background:#fff;border:1px solid #dee2e6;border-left:4px solid #1d3557;border-radius:10px;padding:18px 22px;cursor:pointer;transition:all .15s}
.portal-card:hover{background:#f0f4ff;box-shadow:0 2px 8px rgba(29,53,87,.1)}
.portal-card-num{font-size:11px;font-weight:700;color:#6c757d;letter-spacing:.06em;white-space:nowrap}
.portal-card-body{flex:1}
.portal-card-title{font-size:15px;font-weight:700;color:#1d3557;margin-bottom:3px}
.portal-card-desc{font-size:12px;color:#6c757d}
.portal-card-arrow{font-size:20px;color:#adb5bd}
.portal-footer{margin-top:36px;font-size:11px;color:#adb5bd;text-align:center}
h1.dt{font-size:22px;font-weight:700;color:#1d3557;border-bottom:3px solid #1d3557;padding-bottom:10px;margin-bottom:6px}
.dm{font-size:12px;color:#6c757d;margin-bottom:32px}

/* ── CLAUSE GUIDE (guide-clause) ───────────────────── */
:root{--cv:#2f4d8a;--cv-l:#4265a8;--cv-d:#1e3462;--cv-s:#eaf0fb;--cv-m:#c5d4f0;
  --ls:#0a5e4a;--ls-l:#0d7a61;--ls-d:#07402f;--ls-s:#e0f5ef;--ls-m:#a8dfd2;
  --sw-c:230px}
.g-sidebar-clause{position:fixed;top:48px;left:0;width:var(--sw-c);
  height:calc(100vh - 48px);background:var(--cv-d);overflow-y:auto;
  display:flex;flex-direction:column;z-index:100}
.g-sh-clause{padding:16px 14px 12px;border-bottom:1px solid rgba(255,255,255,.1)}
.g-sh-clause h1{font-size:9px;font-weight:700;color:rgba(255,255,255,.45);letter-spacing:.08em;text-transform:uppercase}
.g-sh-clause p{font-size:11.5px;color:rgba(255,255,255,.92);font-weight:600;margin-top:3px;line-height:1.4}
.cv-switcher{display:flex;margin:10px 12px 4px;gap:6px}
.cv-sw-btn{flex:1;padding:5px 4px;border-radius:5px;font-size:10px;font-weight:700;
  cursor:pointer;border:none;text-align:center;transition:all .15s;line-height:1.3}
.cv-sw-btn.sv{background:#eaf0fb;color:var(--cv-d)}
.cv-sw-btn.lc{background:#e0f5ef;color:var(--ls-d)}
.cv-sw-btn.active-sv{background:var(--cv-l);color:#fff}
.cv-sw-btn.active-lc{background:var(--ls-l);color:#fff}
.cv-nl{display:block;padding:3px 14px;font-size:11px;color:rgba(255,255,255,.7);
  text-decoration:none;border-left:2px solid transparent;transition:all .15s;line-height:1.4}
.cv-nl:hover,.cv-nl.active{color:#fff;background:rgba(255,255,255,.09);border-left-color:#e63946}
.cv-ns{display:block;padding:4px 14px 2px;font-size:9px;font-weight:700;
  color:rgba(255,255,255,.32);letter-spacing:.07em;text-transform:uppercase;margin-top:8px}
.g-main-clause{margin-left:var(--sw-c);padding:32px 46px 80px;
  max-width:calc(var(--sw-c) + 860px);background:#fff}
/* contract panel */
.clause-panel{display:none}
.clause-panel.active{display:block}
/* article block */
.art{border-left:4px solid;border-radius:0 8px 8px 0;
  border:1px solid #ddd;border-left-width:4px;
  padding:16px 20px 12px;margin-bottom:16px;
  background:#fff;scroll-margin-top:22px}
.art.sv{border-left-color:var(--cv)}
.art.lc{border-left-color:var(--ls)}
.art-no{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px}
.art.sv .art-no{color:var(--cv)}
.art.lc .art-no{color:var(--ls)}
.art-ttl{font-size:14px;font-weight:700;padding-bottom:8px;margin-bottom:10px;border-bottom:1px solid #e5e5e5}
.art.sv .art-ttl{color:var(--cv-d)}
.art.lc .art-ttl{color:var(--ls-d)}
.art-lead{font-size:12.5px;color:#333;line-height:1.8;margin-bottom:10px}
.art dt{font-size:11.5px;font-weight:700;padding:4px 10px;margin:8px 0 3px;border-radius:0 3px 3px 0}
.art.sv dt{background:var(--cv-s);color:var(--cv-d);border-left:3px solid var(--cv)}
.art.lc dt{background:var(--ls-s);color:var(--ls-d);border-left:3px solid var(--ls)}
.art dd{font-size:12px;color:#444;padding:4px 10px 4px 14px;margin:0 0 3px;line-height:1.75}
.art dd li{margin-bottom:2px}
/* group header */
.art-grp{border-radius:7px;padding:11px 18px;margin:24px 0 12px;scroll-margin-top:16px}
.art-grp.sv{background:var(--cv-d)}
.art-grp.lc{background:var(--ls-d)}
.art-grp .gn{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  color:rgba(255,255,255,.4);margin-bottom:2px}
.art-grp h2{font-size:14px;font-weight:700;color:#fff;margin:0;border:none;padding:0}
.art-grp .gd{font-size:11px;color:rgba(255,255,255,.6);margin-top:3px}
/* callouts */
.cl-w{border-left:3px solid #e63946;background:#fde8ea;padding:7px 11px;border-radius:0 4px 4px 0;margin:8px 0;font-size:12px}
.cl-i{border-left:3px solid #378add;background:#e8f1fb;padding:7px 11px;border-radius:0 4px 4px 0;margin:8px 0;font-size:12px}
.cl-t{border-left:3px solid #1d9e75;background:#e4f7f1;padding:7px 11px;border-radius:0 4px 4px 0;margin:8px 0;font-size:12px}
.cl-n{border-left:3px solid #c47d1a;background:#fef3e2;padding:7px 11px;border-radius:0 4px 4px 0;margin:8px 0;font-size:12px}
/* index table */
.art-idx{width:100%;border-collapse:collapse;font-size:12px;margin:10px 0 22px}
.art-idx thead th{padding:6px 10px;text-align:left;font-size:11px;color:#fff}
.art-idx.sv thead th{background:var(--cv-d)}
.art-idx.lc thead th{background:var(--ls-d)}
.art-idx tbody td{padding:5px 10px;border-bottom:1px solid #eee;vertical-align:middle}
.art-idx tbody tr:nth-child(even){background:#f8f8f8}
.art-idx a{text-decoration:none;font-weight:600}
.art-idx.sv a{color:var(--cv)}
.art-idx.lc a{color:var(--ls)}
/* tag */
.law-tag{display:inline-block;font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;
  background:#e6effa;color:#0c447c;margin:2px 3px 2px 0}
.rel-tag{display:inline-block;font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;
  background:#f3f3f3;color:#374151;margin:2px 3px 2px 0}


/* ── DOWNLOAD BANNER ───────────────────────────── */
.dl-banner{
  background:linear-gradient(135deg,#1e3462 0%,#2f4d8a 50%,#085041 100%);
  border-radius:10px;padding:22px 28px;margin-bottom:28px;
  display:flex;align-items:center;gap:20px;flex-wrap:wrap;
}
.dl-banner-text{flex:1;min-width:200px;}
.dl-banner-title{font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;font-family:Arial,sans-serif;}
.dl-banner-sub{font-size:12px;color:rgba(255,255,255,.7);font-family:Arial,sans-serif;}
.dl-btns{display:flex;gap:10px;flex-wrap:wrap;}
.dl-btn{
  display:inline-flex;align-items:center;gap:7px;
  padding:9px 16px;border-radius:7px;text-decoration:none;
  font-size:12px;font-weight:700;white-space:nowrap;
  transition:opacity .15s;cursor:pointer;border:none;
}
.dl-btn:hover{opacity:.85;}
.dl-btn-sv{background:#fff;color:#2f4d8a;}
.dl-btn-lc{background:#a8dfd2;color:#07402f;}
.dl-icon{font-size:14px;}


/* === Ver badge ====================================== */
.art{position:relative}
.art-ver{
  position:absolute;top:12px;right:14px;
  display:inline-block;font-size:9px;font-weight:700;
  letter-spacing:.06em;padding:2px 7px;border-radius:10px;
  font-family:'SF Mono',Consolas,Menlo,monospace;
  border:1px solid;
}
.art.sv .art-ver{background:#eaf0fb;color:var(--cv-d);border-color:var(--cv-m)}
.art.lc .art-ver{background:#e0f5ef;color:var(--ls-d);border-color:var(--ls-m)}
/* === Panel version bar ============================== */
.panel-ver-bar{
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  background:#f8f9fa;border:1px solid #dee2e6;
  padding:10px 14px;border-radius:7px;
  font-size:11.5px;color:#495057;
  margin:14px 0 22px;
}
.panel-ver-bar strong{font-weight:700;font-size:12.5px}
.panel-ver-bar.sv strong{color:var(--cv-d)}
.panel-ver-bar.lc strong{color:var(--ls-d)}
.panel-ver-pill{
  display:inline-block;padding:3px 11px;border-radius:11px;
  font-family:'SF Mono',Consolas,Menlo,monospace;
  font-weight:700;font-size:11.5px;letter-spacing:.04em;
  border:1px solid;
}
.panel-ver-bar.sv .panel-ver-pill{background:#eaf0fb;color:var(--cv-d);border-color:var(--cv-m)}
.panel-ver-bar.lc .panel-ver-pill{background:#e0f5ef;color:var(--ls-d);border-color:var(--ls-m)}
.panel-ver-meta{color:#6c757d;font-size:10.5px;margin-left:auto}

</style>

<style id="gas-portal-back-style">
.portal-back-button{position:fixed;right:16px;bottom:16px;z-index:3000;display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:999px;background:#1d3557;color:#fff;text-decoration:none;font-size:12px;font-weight:700;box-shadow:0 3px 12px rgba(0,0,0,.22);opacity:.92;transition:opacity .15s,transform .15s}
.portal-back-button:hover{opacity:1;transform:translateY(-1px)}
@media print{.portal-back-button{display:none}}
</style>

</head>
<body>
  <?!= include('common_top_tabs', { appUrl: appUrl, currentPage: currentPage }); ?>
<nav id="topnav">
  <span class="tn-brand">法務部</span>
  <a class="tn-btn tn-back" href="./">← ポータルへ戻る</a>
  <span class="tn-btn active">GUIDE 04 ｜ 契約書 条文解説</span>
</nav>

<div id="guide-clause">
<aside class="g-sidebar-clause">
  <div class="g-sh-clause">
    <h1>法務部</h1>
    <p>契約書<br>条文解説ガイド</p>
  </div>
  <div class="cv-switcher">
    <button class="cv-sw-btn sv active-sv" onclick="switchContract('sv')">業務委託</button>
    <button class="cv-sw-btn lc" onclick="switchContract('lc')">ライセンス</button>
  </div>
  <nav id="sv-nav" style="padding:4px 0 20px;">
<span class="cv-ns">基本構造</span>
<a class="cv-nl" href="#sv-1">第1条 目的</a>
<a class="cv-nl" href="#sv-2">第2条 契約形態</a>
<a class="cv-nl" href="#sv-3">第3条 業務の委託</a>
<a class="cv-nl" href="#sv-4">第4条 発注書の記載事項</a>
<a class="cv-nl" href="#sv-5">第5条 業務の遂行</a>
<span class="cv-ns">履行・検収・支払</span>
<a class="cv-nl" href="#sv-6">第6条 成果物の納品</a>
<a class="cv-nl" href="#sv-7">第7条 契約不適合・修正</a>
<a class="cv-nl" href="#sv-8">第8条 報酬の支払</a>
<span class="cv-ns">知的財産・情報管理</span>
<a class="cv-nl" href="#sv-9">第9条 知的財産権</a>
<a class="cv-nl" href="#sv-10">第10条 資料の取扱い</a>
<a class="cv-nl" href="#sv-11">第11条 秘密保持</a>
<a class="cv-nl" href="#sv-12">第12条 個人情報</a>
<span class="cv-ns">変更・終了・解除</span>
<a class="cv-nl" href="#sv-13">第13条 届出事項の変更</a>
<a class="cv-nl" href="#sv-14">第14条 契約期間・解約</a>
<a class="cv-nl" href="#sv-15">第15条 契約の解除</a>
<span class="cv-ns">責任・雑則</span>
<a class="cv-nl" href="#sv-16">第16条 損害賠償</a>
<a class="cv-nl" href="#sv-17">第17条 権利義務の譲渡禁止</a>
<a class="cv-nl" href="#sv-18">第18条 取適法・フリーランス法</a>
<a class="cv-nl" href="#sv-19">第19条 反社会的勢力</a>
<a class="cv-nl" href="#sv-20">第20条 準拠法・合意管轄</a>
<a class="cv-nl" href="#sv-21">第21条 協議解決</a>
<a class="cv-nl" href="#sv-22">第22条 従前契約の包括</a>
</nav>
  <nav id="lc-nav" style="padding:4px 0 20px;display:none;">
<span class="cv-ns">基本構造</span>
<a class="cv-nl" href="#lc-1">第1条 目的</a>
<a class="cv-nl" href="#lc-2">第2条 定義</a>
<a class="cv-nl" href="#lc-3">第3条 個別条件の成立</a>
<a class="cv-nl" href="#lc-4">第4条 権利の許諾</a>
<a class="cv-nl" href="#lc-5">第5条 サブライセンス</a>
<span class="cv-ns">履行・対価</span>
<a class="cv-nl" href="#lc-6">第6条 開発・製造・販売</a>
<a class="cv-nl" href="#lc-7">第7条 対価</a>
<span class="cv-ns">期間・IP・追加</span>
<a class="cv-nl" href="#lc-8">第8条 契約期間</a>
<a class="cv-nl" href="#lc-9">第9条 知的財産の帰属</a>
<a class="cv-nl" href="#lc-10">第10条 追加作品</a>
<a class="cv-nl" href="#lc-11">第11条 契約終了後の措置</a>
<span class="cv-ns">責任・雑則</span>
<a class="cv-nl" href="#lc-12">第12条 解除</a>
<a class="cv-nl" href="#lc-13">第13条 機密保持</a>
<a class="cv-nl" href="#lc-14">第14条 個人情報</a>
<a class="cv-nl" href="#lc-15">第15条 権利義務の譲渡禁止</a>
<a class="cv-nl" href="#lc-16">第16条 表明保証</a>
<a class="cv-nl" href="#lc-17">第17条 損害賠償</a>
<a class="cv-nl" href="#lc-18">第18条 反社会的勢力</a>
<a class="cv-nl" href="#lc-19">第19条 協議事項</a>
<a class="cv-nl" href="#lc-20">第20条 旧契約の包括統合</a>
<a class="cv-nl" href="#lc-21">第21条 準拠法・合意管轄</a>
<a class="cv-nl" href="#lc-22">第22条 存続</a>
</nav>
</aside>
<main class="g-main-clause">
  
<div class="clause-panel active" id="panel-sv">
  <h1 class="dt" style="color:#1e3462;border-bottom-color:#2f4d8a">業務委託基本契約書 条文解説</h1>
  <p class="dm">作成：法務部　｜　各条項の法的趣旨・要点・実務上の注意を整理した担当者向け解説</p>
  <div class="cl-i">本ガイドは業務委託基本契約書（<code>template_service_basic</code>）の各条項を解説します。発注書の作成フロー・取引先登録手続きは<strong>取引適正化ガイド</strong>および<strong>取引先登録ガイド</strong>を参照してください。</div>

  <div class="panel-ver-bar sv">
    <span>📑 適用契約書テンプレート：</span>
    <strong>業務委託基本契約書</strong>
    <span class="panel-ver-pill">Ver001</span>
    <span class="panel-ver-meta">本ガイドの解説対象バージョン</span>
  </div>

 <div class="dl-banner">
  <div class="dl-banner-text">
    <div class="dl-banner-title">📄 読み方ガイド（要約資料）をダウンロード</div>
    <div class="dl-banner-sub">各契約書の主要条項・実務ポイントをまとめた資料です</div>
  </div>

  <div class="dl-btns">
    <a class="dl-btn dl-btn-sv"
       href="<?= serviceGuideUrl ?>"
       target="_blank"
       rel="noopener">
      <span class="dl-icon">⬇</span> 業務委託基本契約書
    </a>

    <a class="dl-btn dl-btn-lc"
       href="<?= licenseGuideUrl ?>"
       target="_blank"
       rel="noopener">
      <span class="dl-icon">⬇</span> ライセンス利用許諾基本契約書
    </a>
  </div>
</div>

  <div class="art-grp sv"><div class="gn">Chapter 1</div><h2>基本構造（第1条〜第5条）</h2><div class="gd">契約の骨格・取引の開始方法・個別業務の発注手続き</div></div>
<div class="art sv" id="sv-1">
<span class="art-ver">Ver001</span>
<div class="art-no">第1条</div>
<div class="art-ttl">第1条（目的）</div>
<p class="art-lead">本契約書は「共通ルールを定める基本契約」と「個別業務の条件を定める発注書」の<strong>二層構造</strong>をとることを宣言する条文です。基本契約を一度締結すれば、以後は発注書を発行するだけで個別の業務委託契約が成立します。</p>
<dl>
<dt>発注書優先の原則（2項）</dt><dd>発注書の内容が本契約書と矛盾・抵触する場合は<strong>発注書が優先</strong>します。特殊な支払条件・成果物仕様など、基本契約と異なる条件は発注書に明記することで対応できます。</dd>
<dt>実務上のポイント</dt><dd>発注書優先を活用するには、変更したい条件を発注書に明示的に記載する必要があります。「別途協議」のような記載は後日のトラブルになります。</dd>
</dl>
<div style="margin-top:8px"><span class="rel-tag">→ 第3条（発注書の発行）</span><span class="rel-tag">→ 第4条（記載事項）</span></div>
</div>
<div class="art sv" id="sv-2">
<span class="art-ver">Ver001</span>
<div class="art-no">第2条</div>
<div class="art-ttl">第2条（契約形態）</div>
<p class="art-lead">個別業務ごとに<strong>請負・準委任・委任</strong>のいずれの形態で取引するかを定める条文です。形態によって義務の内容・報酬の発生条件・瑕疵担保の有無が大きく異なるため、<strong>発注書への明示が必須</strong>です。</p>
<dl>
<dt>請負契約（2項）</dt><dd>乙は<strong>成果物の完成義務</strong>を負います。完成・引渡しをもって報酬が発生し、不合格時は無償修正義務が生じます。損害賠償の上限は原則として実際に支払った報酬額（第16条）。</dd>
<dt>準委任契約（3項）</dt><dd>乙は<strong>善管注意義務をもって誠実に遂行</strong>する義務を負いますが、成果物の完成義務はありません。業務提供の期間に応じた報酬が発生します。</dd>
<dt>明示なき場合の自動分類（1項ただし書き）</dt><dd>発注書に記載がない場合、「成果物の完成を目的とする」→請負、「それ以外」→準委任 として自動的に分類されます。意図と異なる分類にならないよう<strong>必ず発注書に明示</strong>してください。</dd>
</dl>
<div class="cl-w">契約形態の違いは「やり直し義務の有無」に直結します。請負では乙に完成義務があるため不合格時は無償修正が原則ですが、準委任では重大な義務違反がある場合でも協議を経ての減額となります（第7条）。</div>
<div style="margin-top:8px"><span class="rel-tag">→ 第6条（納品・完了の区別）</span><span class="rel-tag">→ 第7条（契約不適合）</span><span class="rel-tag">→ 第16条（損害賠償の上限）</span></div>
</div>
<div class="art sv" id="sv-3">
<span class="art-ver">Ver001</span>
<div class="art-no">第3条</div>
<div class="art-ttl">第3条（業務の委託）</div>
<p class="art-lead">個別業務を発注する手続き（発注書の交付→受託者の承諾→契約成立）を規定します。<strong>「発注書の送付だけでは契約は成立しない」</strong>点が重要で、受託者の承諾または着手があって初めて成立します。</p>
<dl>
<dt>契約成立の3つのルート（2項）</dt><dd>①書面または電磁的記録による承諾通知　②業務の着手（作業開始の事実）　③その他明確な承諾の意思表示　―のいずれかで成立します。</dd>
<dt>「着手が承諾」のリスク</dt><dd>発注書送付前に受託者が作業を始めた場合でも発注書記載の条件で契約が成立したとみなされます。条件未合意のまま着手させないよう、<strong>発注書は事前に交付</strong>してください。</dd>
<dt>電磁的方法での交付</dt><dd>メール・クラウドストレージ等でも発注書を交付できます。クラウドサインによる電子交付が推奨運用です。</dd>
</dl>
<div class="cl-w">口頭のみで発注・着手させることは厳禁です。条件の証拠がなければ、報酬額・納期・仕様をめぐるトラブル発生時に当社を守れません。</div>
<div style="margin-top:8px"><span class="law-tag">取適法3条 書面交付義務</span><span class="law-tag">フリーランス法3条</span></div>
</div>
<div class="art sv" id="sv-4">
<span class="art-ver">Ver001</span>
<div class="art-no">第4条</div>
<div class="art-ttl">第4条（発注書の記載事項）</div>
<p class="art-lead">発注書に何を記載しなければならないかを定めます。取適法・フリーランス法の法定明示事項を網羅した設計であり、<strong>記載漏れは法令違反</strong>になる可能性があります。</p>
<dl>
<dt>基本的な必須記載事項</dt><dd>業務の内容（具体的な作業・仕様）／報酬額・算定方法（税別・税込の別も）／納期／成果物の仕様・納品場所</dd>
<dt>取適法・フリ法適用時の追加必須事項</dt><dd>支払期日（受領日から60日以内）／検収期間・方法／再委託の可否／経費負担の有無・内容／業務遂行場所・就業時間（該当する場合）</dd>
<dt>保存義務（2項）</dt><dd>発注書の記載内容は<strong>作成日から3年間保存</strong>する義務があります。電磁的保存も可。</dd>
</dl>
<div class="cl-n">発注書の記載内容が後の検収・支払・瑕疵担保の基準になります。「一式」「詳細は別途」のような記載は避け、できる限り具体的に記載してください。</div>
<div style="margin-top:8px"><span class="law-tag">取適法3条</span><span class="law-tag">フリーランス法3条</span></div>
</div>
<div class="art sv" id="sv-5">
<span class="art-ver">Ver001</span>
<div class="art-no">第5条</div>
<div class="art-ttl">第5条（業務の遂行）</div>
<p class="art-lead">受託者が<strong>独立した事業者</strong>として業務を遂行することを確認し、指揮命令関係・再委託・設備利用等のルールを定めます。雇用契約との区別を法的に明確にする重要な規定です。</p>
<dl>
<dt>独立性の確認（1項）</dt><dd>本契約の締結により、当社と受託者の間に<strong>雇用・代理・合弁等の特別な法律関係は生じない</strong>ことを明示しています。偽装請負リスクを回避するための宣言条項です。</dd>
<dt>指揮命令の制限（2項）</dt><dd>準委任業務では、当社は業務遂行の「手順等」について具体的な指示を行いません。ただし<strong>仕様・品質・納期についての協議は妨げない</strong>とされており、品質管理は可能です。</dd>
<dt>再委託の制限（5項）</dt><dd>受託者が業務を第三者に再委託する場合は<strong>当社の書面による事前承諾</strong>が必要です。無断再委託は契約違反。再委託先の行為への責任は受託者が全面的に負います。</dd>
</dl>
<div class="cl-w">偽装請負リスク：「毎日〇時から作業開始」「当社の指示通りに動く」等の指揮命令は雇用関係とみなされる可能性があります。発注書の作業内容・場所・時間拘束の有無を定期的に確認してください。</div>
</div>
<div class="art-grp sv"><div class="gn">Chapter 2</div><h2>履行・検収・支払（第6条〜第8条）</h2><div class="gd">成果物の引渡し・不適合への対応・報酬の支払条件</div></div>
<div class="art sv" id="sv-6">
<span class="art-ver">Ver001</span>
<div class="art-no">第6条</div>
<div class="art-ttl">第6条（成果物の納品および業務の完了）</div>
<p class="art-lead">業務の「完了」をどう確認するかを、請負契約と準委任契約のそれぞれについて定めます。<strong>「検収合格＝引渡し完了＝所有権移転」</strong>という一連のプロセスが規定されています。</p>
<dl>
<dt>請負契約の場合（2項）</dt><dd>①乙が発注書の納期・形式で成果物を納入　②当社が検収し、不合格なら修正・追完を要求　③検収合格通知の時点で<strong>引渡し完了・所有権移転</strong>　④納入時点で危険負担が乙から当社に移転します。</dd>
<dt>準委任契約の場合（3項）</dt><dd>「業務提供が完了した時点」で完了。完了の確認方法（報告書提出・当社承認等）は発注書で定めます。</dd>
<dt>「納入」の意味</dt><dd>甲が指定する場所または方法により成果物が甲に到達したこと。データ納品なら「受信完了」、郵送なら「到着」が起点です。</dd>
<dt>検収期間の設定</dt><dd>取適法・フリーランス法対象の取引では受領後<strong>20日以内</strong>の通知が義務（第18条1項②）。通知がない場合は「検収済みとみなし」となります。</dd>
</dl>
<div style="margin-top:8px"><span class="rel-tag">→ 第7条（不合格時の対応）</span><span class="rel-tag">→ 第8条（報酬支払のタイミング）</span></div>
</div>
<div class="art sv" id="sv-7">
<span class="art-ver">Ver001</span>
<div class="art-no">第7条</div>
<div class="art-ttl">第7条（契約不適合および修正対応）</div>
<p class="art-lead">成果物や業務の結果が発注内容を満たさない場合（「契約不適合」）の処理手順と当社が選択できる対応手段を定めます。<strong>「まず協議」という段階的アプローチ</strong>が特徴です。</p>
<dl>
<dt>対応の手順（1〜2項）</dt><dd>①乙に対し<strong>書面で具体的な不適合内容を通知</strong>し、合理的な期間を定めて協議を求める　②協議で解決しない場合に：成果物の修正または業務の再実施 ／ 報酬の減額 ／ 契約の解除 ／ 報酬の支払拒否　から選択できます。</dd>
<dt>請負契約の通知期限（3項①）</dt><dd><strong>成果物の納品後1年以内</strong>に不適合内容を乙に通知しなければなりません。1年を過ぎると原則として追及できなくなります。</dd>
<dt>準委任契約の対応（3項②）</dt><dd>「重大な義務違反」がある場合に協議のうえで報酬の全部または一部の支払拒否・減額が可能。「重大」かどうかは客観的に判断する必要があります。</dd>
</dl>
<div class="cl-i">不適合の通知は口頭ではなく<strong>書面またはメール</strong>で行い、具体的にどの部分がどの仕様を満たしていないかを明記してください。漠然とした「クオリティが低い」という通知は根拠として不十分です。</div>
</div>
<div class="art sv" id="sv-8">
<span class="art-ver">Ver001</span>
<div class="art-no">第8条</div>
<div class="art-ttl">第8条（報酬の支払）</div>
<p class="art-lead">報酬の支払方法・支払期日・インボイス対応・遅延ペナルティを規定します。取適法・フリーランス法が適用される場合は<strong>法定の60日以内支払が優先</strong>されます。</p>
<dl>
<dt>請負契約の支払タイミング（2項）</dt><dd>原則：検収完了後、請求書受領月の翌月末日まで　｜　取適法・フリ法適用時：成果物受領日から起算して<strong>60日以内</strong>の、発注書に定める支払期日まで</dd>
<dt>準委任・委任契約の支払（3項）</dt><dd>原則：毎月末日締め翌月末日払い　｜　取適法・フリ法適用時：給付受領日から<strong>60日以内</strong></dd>
<dt>振込手数料（3項後段）</dt><dd>振込手数料は<strong>当社（甲）負担</strong>です。受託者に負担させることは取適法上の「不当な利益の強制」に該当する可能性があります。</dd>
<dt>遅延損害金（4項）</dt><dd>支払期日翌日から支払済まで<strong>年14.6%</strong>の遅延損害金が発生します（民法年3%より大幅に高い）。当事者間の合意があっても原則として免除不可です。</dd>
<dt>不可抗力時の注意（5項）</dt><dd>天災等の不可抗力による遅延でも、取適法・フリーランス法適用時は<strong>不可抗力を理由とする免責は認められません</strong>。60日ルールは絶対的義務です。</dd>
</dl>
<div class="cl-w">支払期日の超過は自動的に年14.6%の損害金を発生させます。社内カレンダーで支払期日を管理し、超過が起きない体制を整えてください。</div>
<div style="margin-top:8px"><span class="law-tag">取適法4条1項2号（支払遅延の禁止）</span><span class="law-tag">フリーランス法6条</span></div>
</div>
<div class="art-grp sv"><div class="gn">Chapter 3</div><h2>知的財産・情報管理（第9条〜第12条）</h2><div class="gd">成果物IP・資料・秘密・個人情報の管理</div></div>
<div class="art sv" id="sv-9">
<span class="art-ver">Ver001</span>
<div class="art-no">第9条</div>
<div class="art-ttl">第9条（知的財産権）</div>
<p class="art-lead">業務の成果物に関する<strong>著作権・特許権等のIP帰属・譲渡・著作者人格権の不行使</strong>・第三者権利侵害への対処を定めます。当社が委託したコンテンツを自由に活用できるよう設計されています。</p>
<dl>
<dt>成果物のIPは原則として当社帰属（1項）</dt><dd>著作権（著作権法27条・28条の翻訳権・二次的著作物利用権を含む）、特許権、意匠権、商標権その他一切のIPが成果物完成と同時に当社に帰属します。受託者は完成と同時に当社に権利を譲渡したものとなります。</dd>
<dt>受託者の既存IPの留保（2項）</dt><dd>受託者が本件業務以前から保有していた技術・ノウハウ・著作物等（「乙既存知的財産」）は受託者に留保されます。ただし成果物の一部として使用された場合は当社に<strong>非独占的な使用許諾</strong>が付与されます。</dd>
<dt>著作者人格権の不行使（3項）</dt><dd>受託者は成果物に関する著作者人格権を原則として行使しません。これにより当社は成果物を<strong>修正・改変・他商品への転用等を受託者の許諾なしに行える</strong>ようになります。ただし「乙の名誉または声望を害する態様での使用」の場合はこの限りではありません。</dd>
<dt>第三者IP侵害への対処（4項）</dt><dd>成果物が第三者のIPを侵害することが判明した場合、受託者が自己責任・費用負担で処理します。ただし<strong>当社の指示に基づく部分については当社が責任を負います</strong>。</dd>
</dl>
<div class="cl-i">成果物に受託者の既存ツール・フォント・フォトライブラリ等が含まれる場合は、発注書の特記事項に明記してもらってください。</div>
</div>
<div class="art sv" id="sv-10">
<span class="art-ver">Ver001</span>
<div class="art-no">第10条</div>
<div class="art-ttl">第10条（資料の取扱い）</div>
<p class="art-lead">業務遂行のために当社が受託者に提供した資料（データ・書類・素材等）の<strong>管理義務・使用範囲・返却義務</strong>を定めます。情報漏洩や目的外流用を防ぐための規定です。</p>
<dl>
<dt>善管注意義務での管理（2項）</dt><dd>受託者は提供資料を「善良なる管理者の注意義務」（同種業務の通常の専門家として要求される注意の程度）をもって取り扱わなければなりません。</dd>
<dt>複製・第三者提供の制限（2項）</dt><dd>当社の書面による事前承諾なしに、提供資料を複製または第三者に提供することはできません。</dd>
<dt>目的外使用の禁止（3項）</dt><dd>提供資料は本件業務の遂行のみに使用できます。<strong>他の業務・他のクライアントへの流用は明示的に禁止</strong>されています。</dd>
<dt>返却・破棄義務（4項）</dt><dd>契約終了時または当社の指示があった場合、受託者は速やかに資料を返却または破棄しなければなりません。電子データの場合は「完全消去」が返却に相当します。</dd>
</dl>
<div class="cl-i">個人情報を含む資料を提供する場合は第12条（個人情報）も併せて適用されます。</div>
</div>
<div class="art sv" id="sv-11">
<span class="art-ver">Ver001</span>
<div class="art-no">第11条</div>
<div class="art-ttl">第11条（秘密保持）</div>
<p class="art-lead">契約に関連して知り得た相手方の秘密情報の保持義務を定めます。<strong>双方向の義務</strong>であり、当社側も受託者の秘密情報を守る義務を負います。</p>
<dl>
<dt>秘密情報の定義と範囲（1項）</dt><dd>書面・口頭・電磁的記録を問わず、表示の有無にかかわらず「秘匿性を有する一切の情報」が対象です。</dd>
<dt>秘密情報の例外（1項各号）</dt><dd>①開示を受けた時点で既に公知な情報　②開示後に受領者の責によらず公知となった情報　③開示前から受領者が適法に保有していた情報　④正当な第三者から適法に入手した情報　⑤受領者が独自に開発した情報</dd>
<dt>5年間の存続（3項）</dt><dd>秘密保持義務は<strong>契約終了後も5年間継続</strong>します。契約が終了・解除されても5年間は相手方の秘密情報を守り続ける義務があります。</dd>
<dt>法令による開示（2項）</dt><dd>法令・裁判所・行政機関からの命令による開示が必要な場合は、可能な限り事前に相手方に通知し、意向を尊重するよう努めます。</dd>
</dl>
<div class="cl-t">別途NDAを締結している場合でも本条の義務は重複して適用されます。NDAと本条の内容が矛盾する場合は発注書優先の原則（第1条2項）または別途の合意で整理してください。</div>
</div>
<div class="art sv" id="sv-12">
<span class="art-ver">Ver001</span>
<div class="art-no">第12条</div>
<div class="art-ttl">第12条（個人情報の取扱い）</div>
<p class="art-lead">業務上取り扱う個人情報（顧客情報・従業員情報等）の管理義務を<strong>個人情報保護法に基づいて</strong>定めます。</p>
<dl>
<dt>目的外利用の禁止（2項）</dt><dd>個人情報は本件業務の範囲内のみに使用しなければなりません。受託者が取得した顧客情報を他の営業活動に使用することは禁止されます。</dd>
<dt>安全管理措置の義務（3項）</dt><dd>漏洩・滅失・毀損の防止のため、個情法・個情保護委員会のガイドラインに従った「必要かつ適切な措置」を講じる義務があります。</dd>
<dt>事故発生時の通知義務（4項）</dt><dd>個人情報漏洩等の事故が発生した場合は<strong>直ちに相手方に通知</strong>し、原因調査と再発防止措置を講じなければなりません。</dd>
<dt>再委託の制限（5項）</dt><dd>個人情報の取扱いを第三者に委託することは<strong>相手方の書面による事前承諾がある場合を除き禁止</strong>されています。</dd>
</dl>
<div class="cl-w">個人情報漏洩が発生した場合、個人情報保護委員会への報告義務（個情法26条）が生じる可能性があります。事故発生時は法務部に即報してください。</div>
<div style="margin-top:8px"><span class="law-tag">個人情報保護法2条1項・26条</span></div>
</div>
<div class="art-grp sv"><div class="gn">Chapter 4</div><h2>変更・終了・解除（第13条〜第15条）</h2><div class="gd">受託者情報の変更・契約の終了方法・解除の条件</div></div>
<div class="art sv" id="sv-13">
<span class="art-ver">Ver001</span>
<div class="art-no">第13条</div>
<div class="art-ttl">第13条（届出事項の変更）</div>
<p class="art-lead">受託者が当社に届け出た情報（住所・口座・インボイス登録状況等）に変更が生じた場合の<strong>通知義務</strong>を定めます。特にインボイス登録番号の変更は消費税処理に直結するため即時通知が求められます。</p>
<dl>
<dt>通知が必要な届出事項（1項）</dt><dd>商号（氏名）・代表者　／　住所（居所）・連絡先　／　振込先銀行口座　／　事業者区分（法人・個人の別）　／　インボイス登録番号の取得または廃止</dd>
<dt>未通知の不利益は受託者の責任（2〜3項）</dt><dd>通知を怠ったことにより当社からの通知・書類・報酬の支払いが延着・不能となっても当社は遅滞の責任を負いません。また、未通知に起因して生じた損害も当社は一切の責任を負いません。</dd>
</dl>
<div class="cl-n">口座変更・インボイス廃止の通知を受けた場合は経理部・法務部の双方に即時共有し、支払処理を一時停止してから確認・更新作業を行ってください。</div>
</div>
<div class="art sv" id="sv-14">
<span class="art-ver">Ver001</span>
<div class="art-no">第14条</div>
<div class="art-ttl">第14条（契約期間および中途解約）</div>
<p class="art-lead">基本契約の有効期間・自動更新ルール・中途解約の手続き、および<strong>基本契約終了後の個別業務の継続</strong>について定めます。基本契約が終了しても進行中の個別業務は継続する点が重要です。</p>
<dl>
<dt>契約期間と自動更新（1項）</dt><dd>期間：締結日から<strong>1年間</strong>。期間満了1か月前までに書面による解約の意思表示がない限り<strong>同一条件で1年間自動延長</strong>。以後も同様。</dd>
<dt>中途解約（2項）</dt><dd>やむを得ない事由がある場合、<strong>30日前までに書面で通知</strong>することで解約できます。</dd>
<dt>基本契約終了後の個別業務の継続（3項）</dt><dd>基本契約が終了しても、終了時点で進行中または未着手の個別業務は完了・終了まで本契約の関連条項が適用され続けます。基本契約の終了を理由に業務を中断することはできません。</dd>
<dt>長期個別業務の中途解約（4項）</dt><dd>個別業務の履行期間が基本契約終了日から6か月以上ある場合は<strong>1か月前に書面通知</strong>することで当該個別業務を中途解約できます。</dd>
<dt>存続条項（5項）</dt><dd>秘密保持義務・知的財産権・損害賠償等は契約終了後も継続して有効です。</dd>
</dl>
<div class="cl-n">自動更新を止める場合は<strong>期間満了1か月前</strong>に書面で解約通知を送る必要があります。契約管理台帳で更新期日を管理してください。</div>
</div>
<div class="art sv" id="sv-15">
<span class="art-ver">Ver001</span>
<div class="art-no">第15条</div>
<div class="art-ttl">第15条（契約の解除）</div>
<p class="art-lead">契約違反や相手方の信用不安等を理由として契約を解除する条件・手続きを定めます。<strong>「催告を要する解除」と「催告不要の即時解除」</strong>を使い分ける設計です。</p>
<dl>
<dt>催告後の解除（1項）</dt><dd>相手方が契約に違反した場合、<strong>相当の期間を定めて書面で是正を催告</strong>し、期間内に是正されない場合に解除できます。違反があれば即解除ではなく、是正の機会を与えるのが原則です。</dd>
<dt>催告不要の即時解除事由（2項）</dt><dd>①履行不能または履行拒否　②差押え・仮差押え等の処分　③不渡り・支払停止・破産等の申立て　④解散または事業の重要部分の譲渡　⑤信用不安が生じたと認められるとき</dd>
<dt>解除権と損害賠償の関係（3〜4項）</dt><dd>解除権の行使自体は損害賠償責任を生じさせません（3項）。ただし解除によって相手方に生じた損害を請求することはできます（4項）。</dd>
</dl>
<div class="cl-w">即時解除事由（財産差押え・破産申立て等）を把握した場合は速やかに法務部に報告してください。解除通知は書面で行い、証拠を保全することを推奨します。</div>
<div style="margin-top:8px"><span class="rel-tag">→ 第19条（反社会的勢力による即時解除）</span></div>
</div>
<div class="art-grp sv"><div class="gn">Chapter 5</div><h2>責任・雑則（第16条〜第22条）</h2><div class="gd">損害賠償・権利譲渡・法令対応・反社・管轄・雑則</div></div>
<div class="art sv" id="sv-16">
<span class="art-ver">Ver001</span>
<div class="art-no">第16条</div>
<div class="art-ttl">第16条（損害賠償）</div>
<p class="art-lead">相手方の故意または過失により損害が生じた場合の賠償責任と、請負契約における<strong>損害賠償の上限額</strong>を定めます。</p>
<dl>
<dt>賠償の範囲</dt><dd>弁護士費用・人件費・逸失利益等を含む損害を賠償する責任を負います（故意または過失が前提）。</dd>
<dt>請負契約における上限（1項ただし書き）</dt><dd>請負契約の場合、乙（受託者）の責任は<strong>原則として甲が実際に支払った業務委託料が上限</strong>となります。これは受託者の過大なリスク負担を防ぐための規定です。</dd>
<dt>注意点</dt><dd>準委任契約には上限の明示的な定めがありません。また、甲（当社）が損害を与えた場合の賠償責任にも上限の規定はありません。</dd>
</dl>
<div class="cl-i">大型案件で想定損害が報酬額を大幅に超える場合は、発注書の特記事項で別途損害賠償の上限額を設定することを検討してください。</div>
</div>
<div class="art sv" id="sv-17">
<span class="art-ver">Ver001</span>
<div class="art-no">第17条</div>
<div class="art-ttl">第17条（権利義務の譲渡禁止）</div>
<p class="art-lead">甲乙双方が、相手方の<strong>書面による事前承諾なく</strong>、本契約に基づく地位・権利義務を第三者に譲渡・承継・担保設定することを禁止します。</p>
<dl>
<dt>譲渡禁止の対象</dt><dd>契約上の地位の全部譲渡（会社売却等）／個別の権利の譲渡（報酬請求権の担保への供出等）／義務の引受けによる承継</dd>
<dt>M&A時の注意</dt><dd>M&Aや事業承継により受託者の経営主体が変わる場合、当社の書面承諾が必要です。受託者から吸収合併等の情報を得た場合は法務部に報告してください。</dd>
</dl>
<div style="margin-top:8px"><span class="rel-tag">→ 第14条（契約期間・解約）</span></div>
</div>
<div class="art sv" id="sv-18">
<span class="art-ver">Ver001</span>
<div class="art-no">第18条</div>
<div class="art-ttl">第18条（中小受託取引適正化法および特定受託事業者法等の適用）</div>
<p class="art-lead">取適法（中小受託取引適正化法）およびフリーランス法（特定受託事業者に係る取引の適正化等に関する法律）が適用される場合に、当社（甲）が履行すべき<strong>6項目の義務</strong>を明記した条文です。<strong>他条項に優先して適用</strong>されます（3項）。</p>
<dl>
<dt>対象者の判断（2項）</dt><dd>取適法：資本金・従業員数基準により中小受託事業者に該当する場合。フリーランス法：個人として業務委託を受ける特定受託事業者（主にフリーランス・個人事業主）。判断が難しい場合は法務部に確認してください。</dd>
<dt>当社が履行すべき6項目の義務（1項①〜⑥）</dt><dd><ol style='margin:4px 0 0;padding-left:18px'><li>①業務内容・報酬・納期・仕様・再委託可否等の書面明示</li><li>②受領後20日以内の検収結果通知（通知なしで検収済みとみなし）</li><li>③給付受領日から60日以内の報酬支払</li><li>④ハラスメント防止措置・相談窓口の設置・通知（KADOKAWAグループホットライン）</li><li>⑤取引記録の3年間保存</li><li>⑥価格の一方的決定・報酬不当減額・買いたたき・手形払い強制等の禁止行為の遵守</li></ol></dd>
<dt>他条項への優先（3項）</dt><dd>本条の内容は他条項に<strong>優先して適用</strong>されます。他条項と矛盾・重複が生じた場合は本条が優先します。</dd>
<dt>ハラスメント相談窓口</dt><dd>名称：KADOKAWAグループホットライン　｜　電話：0120-996-206（平日8:30〜19:00、土曜8:30〜17:00）　｜　相談を理由とした不利益取扱いは禁止です。</dd>
</dl>
<div style="margin-top:8px"><span class="law-tag">取適法（旧下請法）</span><span class="law-tag">フリーランス法（2024年11月施行）</span></div>
</div>
<div class="art sv" id="sv-19">
<span class="art-ver">Ver001</span>
<div class="art-no">第19条</div>
<div class="art-ttl">第19条（反社会的勢力の排除）</div>
<p class="art-lead">甲乙双方が反社会的勢力ではないこと・関係を持たないことを<strong>表明・確約</strong>し、違反した場合の即時解除権および損害賠償権を定めます。</p>
<dl>
<dt>表明保証の内容（1項①〜⑤）</dt><dd>自らが暴力団等でないこと／役員が反社会的勢力でないこと／反社会的勢力に名義を利用させないこと／脅迫・暴力を用いないこと／偽計・威力を用いて業務を妨害しないこと</dd>
<dt>即時解除権（2項）</dt><dd>相手方が反社会的勢力に該当した場合、<strong>催告なしに直ちに解除</strong>できます。</dd>
<dt>解除による損害賠償（3項）</dt><dd>解除により相手方に生じた損害の賠償責任を負いません。逆に、解除により自らに生じた損害は相手方に請求できます。</dd>
<dt>報告義務（4項）</dt><dd>自らまたは役員が反社会的勢力との関係を有することが判明した場合には直ちに相手方に報告しなければなりません。</dd>
</dl>
<div class="cl-w">受託者選定前に社内の反社チェックフローを実施してください。チェックを怠って問題が発覚した場合のリスクは当社にも及びます。</div>
</div>
<div class="art sv" id="sv-20">
<span class="art-ver">Ver001</span>
<div class="art-no">第20条</div>
<div class="art-ttl">第20条（準拠法および合意管轄）</div>
<p class="art-lead">本契約に関する紛争が生じた場合の<strong>適用法律と専属管轄裁判所</strong>を定めます。</p>
<dl>
<dt>準拠法（1項）</dt><dd>本契約は<strong>日本法</strong>に準拠して解釈されます。</dd>
<dt>専属的合意管轄（2項）</dt><dd>訴訟・調停その他の法的手続きが必要な場合は<strong>東京地方裁判所を第一審の専属的合意管轄裁判所</strong>とします。「専属的」とは、他の裁判所に提起することができないことを意味します。</dd>
</dl>
</div>
<div class="art sv" id="sv-21">
<span class="art-ver">Ver001</span>
<div class="art-no">第21条</div>
<div class="art-ttl">第21条（協議解決）</div>
<p class="art-lead">本契約に定めのない事項や解釈に疑義が生じた事項については、<strong>甲乙誠意をもって協議</strong>のうえ円満に解決することを定めます。</p>
<dl>
<dt>実務上の意義</dt><dd>本条は「白紙」になっている事態に対する一般的なフォールバック条項です。第20条（専属的合意管轄）の前段として、まず訴訟ではなく協議で解決することを原則としています。</dd>
</dl>
</div>
<div class="art sv" id="sv-22">
<span class="art-ver">Ver001</span>
<div class="art-no">第22条</div>
<div class="art-ttl">第22条（従前契約の包括および解除）</div>
<p class="art-lead">本契約書の締結以前に甲乙間で締結されていたすべての業務委託に関する契約を<strong>本契約書に統合し解除</strong>する条文です。過去の個別契約が点在する状態を整理・一本化する機能を持ちます。</p>
<dl>
<dt>包括統合の仕組み（1〜2項）</dt><dd>本契約締結日以前の業務委託に関する契約・合意書・覚書等（「従前契約」）をすべて本契約に統合し、締結と同時に合意により解除します。</dd>
<dt>進行中業務の継続（3項）</dt><dd>締結時点で従前契約に基づき履行中または未着手の個別業務は、<strong>新たな発注書なしで本契約に基づく業務として継続</strong>します。業務内容・報酬・納期等は従前契約の定めによります。</dd>
<dt>債権債務の承継（4項）</dt><dd>従前契約に基づく未払い報酬・損害賠償債務等の債権債務は本契約に承継されます。</dd>
<dt>存続する義務（5項）</dt><dd>秘密保持義務・知的財産権に関する義務・資料の返却義務等は本契約の対応条項に基づき引き続き有効です。</dd>
<dt>「従前契約」の一覧表（8項）</dt><dd>「従前契約」の範囲は別途作成する一覧表に記載される契約です。一覧表は本契約の一部を構成します。ただし、一覧表に記載がない契約も本条第1項により包括されます。</dd>
</dl>
<div class="cl-n">従前契約がある受託者と本契約書を締結する場合は、事前に過去の契約・覚書の一覧を作成してください。見落としがあると想定外の権利義務関係が残ります。</div>
</div>

</div>

  
<div class="clause-panel" id="panel-lc">
  <h1 class="dt" style="color:#07402f;border-bottom-color:#0a5e4a">ライセンス利用許諾基本契約書 条文解説</h1>
  <p class="dm">作成：法務部　｜　各条項の法的趣旨・要点・実務上の注意を整理した担当者向け解説</p>
  <div class="cl-i" style="border-color:#0a5e4a;background:#e0f5ef">本ガイドはライセンス利用許諾基本契約書（<code>template_license_basic</code>）の各条項を解説します。本契約では甲＝ライセンサー（権利者）、乙＝アークライト（ライセンシー）です。業務委託基本契約書とは甲乙の立場が逆である点に注意してください。</div>

  <div class="panel-ver-bar lc">
    <span>📑 適用契約書テンプレート：</span>
    <strong>ライセンス利用許諾基本契約書</strong>
    <span class="panel-ver-pill">Ver001</span>
    <span class="panel-ver-meta">本ガイドの解説対象バージョン</span>
  </div>

<div class="dl-banner">
  <div class="dl-banner-text">
    <div class="dl-banner-title">📄 読み方ガイド（要約資料）をダウンロード</div>
    <div class="dl-banner-sub">各契約書の主要条項・実務ポイントを4スライドにまとめたPPTX資料です</div>
  </div>
  <div class="dl-btns">
    <a class="dl-btn dl-btn-sv"
       href="{{GDRIVE_URL_SERVICE}}"
       download="業務委託基本契約書_読み方ガイド.pptx">
      <span class="dl-icon">⬇</span> 業務委託基本契約書
    </a>
    <a class="dl-btn dl-btn-lc"
       href="{{GDRIVE_URL_LICENSE}}"
       download="ライセンス利用許諾基本契約書_読み方ガイド.pptx">
      <span class="dl-icon">⬇</span> ライセンス利用許諾基本契約書
    </a>
  </div>
</div>

  <div class="art-grp lc"><div class="gn">Chapter 1</div><h2>基本構造（第1条〜第5条）</h2><div class="gd">契約の目的・定義・個別条件・権利の許諾・サブライセンス</div></div>
<div class="art lc" id="lc-1">
<span class="art-ver">Ver001</span>
<div class="art-no">第1条</div>
<div class="art-ttl">第1条（目的）</div>
<p class="art-lead">甲（ライセンサー）が保有する原著作物に係る知的財産権について、乙（アークライト）による<strong>アナログゲームとしての商業的利用を許諾</strong>するにあたり、その利用条件および権利義務関係を定めることを目的とします。</p>
<dl>
<dt>ライセンス契約の基本構造</dt><dd>本契約は<strong>「基本契約＋個別利用許諾条件（別紙）」</strong>の二層構造をとります。基本契約が共通ルールを定め、タイトルごとの個別条件（ロイヤルティ率・許諾地域・許諾期間等）は別紙に記載します。</dd>
<dt>業務委託との違い</dt><dd>ライセンス契約では当社が「ライセンシー（権利を使用する側）」として<strong>ロイヤルティを支払います</strong>。業務委託基本契約書とは甲乙の立場が逆です（本契約では甲＝ライセンサー、乙＝アークライト）。</dd>
</dl>
<div style="margin-top:8px"><span class="rel-tag">→ 第3条（個別条件の成立）</span><span class="rel-tag">→ 第7条（対価・ロイヤルティ）</span></div>
</div>
<div class="art lc" id="lc-2">
<span class="art-ver">Ver001</span>
<div class="art-no">第2条</div>
<div class="art-ttl">第2条（定義）</div>
<p class="art-lead">本契約で使用する9つの重要用語を定義する条文です。<strong>「原著作物」「アナログゲーム」「対象アナログゲーム」</strong>等の定義は契約の適用範囲に直接影響するため、正確に把握してください。</p>
<dl>
<dt>原著作物（1号）</dt><dd>甲が著作権・意匠権・商標権等を有する、アニメーション・ゲーム・イラスト・キャラクター・世界観・ルール説明書・カードデザイン等の創作物。甲が<strong>将来において正当に権利を保有する関連作品・関連素材を含む</strong>。</dd>
<dt>アナログゲーム（2号）</dt><dd>カードゲーム・ボードゲーム・TRPG等の非デジタル形式のゲーム製品。さらに<strong>デジタル実装（スマホアプリ・PCソフト等）も派生物として含まれる</strong>。デジタルゲームの権利も本契約に含まれる点に注意。</dd>
<dt>対象アナログゲーム（3号）</dt><dd>甲の原著作物を基にして乙が企画・開発・製造・販売または<strong>デジタル実装</strong>を行う製品であって、甲が本契約に基づき許諾するもの。</dd>
<dt>二次著作物（4号）</dt><dd>原著作物を素材として乙が創作した翻案・翻訳・イラスト・ルール記載等。著作権法上の保護対象となるものを含む。→ 第9条（帰属は乙）</dd>
<dt>乙制作素材（5号）</dt><dd>乙が独自に制作または第三者に委託して制作した情報・データ・部品・素材等のうち、二次著作物に該当しないもの。</dd>
<dt>ライセンス種別（6号）</dt><dd><strong>非独占的・専属的・独占的</strong>のいずれかを別紙個別条件に定めます。種別により転ライセンス（サブライセンス）の可否等が変わります。</dd>
<dt>許諾地域（7号）</dt><dd>乙による利用が認められる国または地域。別紙個別条件に明記されます。地域外での販売は許諾違反となります（越境EC例外は第6条8項参照）。</dd>
<dt>甲の監修（8号）</dt><dd>製造または販促に際し、甲が原著作物の表現内容・外装・ルール記載等について確認・指摘を行う権利。監修手続きは第6条4項参照。</dd>
</dl>
</div>
<div class="art lc" id="lc-3">
<span class="art-ver">Ver001</span>
<div class="art-no">第3条</div>
<div class="art-ttl">第3条（個別条件の成立）</div>
<p class="art-lead">タイトルごとの具体的な利用許諾条件（ロイヤルティ率・許諾地域・許諾期間等）を記載する<strong>「別紙個別利用許諾条件」</strong>の成立・運用方法を定めます。</p>
<dl>
<dt>個別条件の成立要件（1項）</dt><dd>甲乙の合意のうえ、当該内容が<strong>別紙に記載された時点</strong>で効力が生じます。書面・電磁的記録（両当事者の確認が取れたもの）が有効な個別条件として認められます。</dd>
<dt>暫定的利用許諾（2〜3項）</dt><dd>商業条件が未確定な段階でも、「本件は暫定的利用許諾に基づく」旨を明記することで<strong>暫定的な許諾が成立</strong>します。解除条件・解除期限を明記することで条件確定前のリスクを管理できます。</dd>
</dl>
<div class="cl-n">実務上、発売スケジュールが先行してロイヤルティ率が未確定のケースがあります。そのような場合は暫定許諾を活用しつつ、解除期限を設定して交渉を完了させてください。</div>
</div>
<div class="art lc" id="lc-4">
<span class="art-ver">Ver001</span>
<div class="art-no">第4条</div>
<div class="art-ttl">第4条（権利の許諾）</div>
<p class="art-lead">本契約の核心となる<strong>利用許諾（ライセンス）の内容</strong>を定めます。甲が乙に許諾する権利の範囲は、著作権法上の権利行為（複製・公衆送信・展示・頒布・翻案等）を含む広範なものです。</p>
<dl>
<dt>許諾の内容（1項）</dt><dd>本許諾の目的は「対象アナログゲームの<strong>製造・販売・販促</strong>」です。この目的の範囲を超えた使用は許諾の対象外となります。</dd>
<dt>許諾の具体的範囲（2項）</dt><dd>著作権法21条〜28条に基づく：複製権・公衆送信権・展示権・頒布権・<strong>翻案権および二次的著作物の利用権</strong>（27条・28条）を含みます。具体的条件は別紙個別条件に定めます。</dd>
<dt>独占的・非独占的の区別</dt><dd>許諾の種別（第2条6号「ライセンス種別」）により、乙が独占的な権利を持つか非独占的な権利にとどまるかが決まります。独占的許諾を受けている場合、甲は第三者に同一権利を許諾できません。</dd>
</dl>
<div style="margin-top:8px"><span class="rel-tag">→ 第2条6号（ライセンス種別の定義）</span><span class="rel-tag">→ 第5条（サブライセンス）</span></div>
</div>
<div class="art lc" id="lc-5">
<span class="art-ver">Ver001</span>
<div class="art-no">第5条</div>
<div class="art-ttl">第5条（サブライセンス）</div>
<p class="art-lead">乙（アークライト）が許諾された利用行為の全部または一部を<strong>第三者に再許諾（サブライセンス）</strong>できる条件と手続きを定めます。甲の書面による事前承諾が必須です。</p>
<dl>
<dt>サブライセンスの2種類（1項）</dt><dd>①<strong>国内・海外パブリッシャーへの再許諾</strong>：海外での販売・流通を目的として第三者に再許諾するケース（例：海外展開先への転ライセンス）　②<strong>OEM委託者への再許諾</strong>：製品の製造・供給を委託する際に行う再許諾（例：OEM製造パートナーへの権利付与）</dd>
<dt>サブライセンス先への義務の流下（2項）</dt><dd>サブライセンス先に対して<strong>本契約と同等以上の義務</strong>を課さなければなりません。乙はサブライセンス先の行為について甲に対して責任を負います。</dd>
<dt>サブライセンス料（2項後段・3項）</dt><dd>サブライセンスにより乙が受領する対価（サブライセンス料）の料率・支払方法・条件は別紙個別条件に定めます。</dd>
</dl>
<div class="cl-w">甲の書面による事前承諾なしのサブライセンスは本契約違反です。海外展開・OEM委託を行う前に必ず法務部で甲への承諾申請手続きを確認してください。</div>
<div style="margin-top:8px"><span class="rel-tag">→ BG事業部契約スキームガイド（場面1・場面4）</span></div>
</div>
<div class="art-grp lc"><div class="gn">Chapter 2</div><h2>履行・対価（第6条〜第7条）</h2><div class="gd">製造・販売・監修・越境EC・ロイヤルティ・帳簿監査</div></div>
<div class="art lc" id="lc-6">
<span class="art-ver">Ver001</span>
<div class="art-no">第6条</div>
<div class="art-ttl">第6条（開発、製造および販売）</div>
<p class="art-lead">乙（アークライト）が対象アナログゲームを開発・製造・販売するにあたっての<strong>権利・義務・手続き・監修ルール</strong>を包括的に定める条文です。ライセンス契約の中でも最も実務と直結する条項群です。</p>
<dl>
<dt>開発行為は乙の責任・費用（1項）</dt><dd>企画・設計・翻案・ルール構築・ローカライズ等の開発行為は<strong>乙の責任および費用</strong>で行います。甲の協力・監修が必要な場合は別途協議します。</dd>
<dt>甲への業務委託（2項）</dt><dd>乙は甲に対してイラスト制作・グラフィック素材作成・販促イベント登壇等（「受託業務」）を委託することができます。受託業務の内容・報酬等は<strong>発注書・電子メール等による合意</strong>で定めます。<br>＊甲が業務委託を受ける立場になる特殊な規定です。</dd>
<dt>委託成果物のIP帰属（3項）</dt><dd>甲が受託業務で制作した成果物のIP：甲の従前IPは甲に帰属。<strong>新たに創作された部分は原則として乙に譲渡</strong>されます。従前IPが本質的要素を構成する場合は乙に非独占的ライセンスが付与されます。</dd>
<dt>製造前の通知・サンプル提供（4項）</dt><dd>製造に先立ち予定製造数量・製造開始予定日等を甲に通知し、<strong>試作サンプルを提供</strong>します。個別条件に甲の監修が求められている場合は監修を受ける義務があります。</dd>
<dt>品質基準・クレジット表示（5項）</dt><dd>印刷品質・資材仕様・製品安全性については甲が別途指定する基準を遵守し、<strong>著作権表示・ライセンス表記・クレジット情報を適切に表示</strong>しなければなりません。</dd>
<dt>製造・販売の再委託（6〜7項）</dt><dd>製造の第三者再委託は乙の責任において可能。販売方法・チャネル・価格設定は乙の裁量で決定できます。</dd>
<dt>越境ECの例外（8項）</dt><dd>許諾地域で販売した製品が越境ECを通じて地域外に流通しても、<strong>乙が直接意図・助長していない場合は許諾地域の制限違反とはみなしません</strong>（越境EC例外）。</dd>
<dt>販売開始前の通知（9項）</dt><dd>販売開始に先立ち、甲に対して販売予定日・対象地域・販売方法の概要を通知しなければなりません。甲が調整を求めた場合は誠意をもって協議します。</dd>
<dt>クレーム・紛争への一次対応（10項）</dt><dd>製造または販売に関連して第三者との間に発生する瑕疵・クレーム・紛争は<strong>乙が第一次的に対応</strong>します。</dd>
</dl>
<div class="cl-i">越境EC例外（8項）は、日本国内向けに販売した製品が海外の消費者にAmazon等を通じて渡った場合に乙が責任を問われないための重要な規定です。ただし「積極的に海外販売を促進した場合」は例外の対象外となります。</div>
</div>
<div class="art lc" id="lc-7">
<span class="art-ver">Ver001</span>
<div class="art-no">第7条</div>
<div class="art-ttl">第7条（対価）</div>
<p class="art-lead">乙が甲に支払う<strong>ロイヤルティの算定方法・支払条件・帳簿監査権</strong>を定めます。算定方式は「製造数量ベース」または「売上高ベース」のいずれかが別紙個別条件で指定されます。</p>
<dl>
<dt>ロイヤルティの算定基準（1項）</dt><dd>別紙個別利用許諾条件に定める基準価格・ロイヤルティ料率・算定方法・地域別条件に基づいて算定します。</dd>
<dt>業務委託報酬との区別（1項後段）</dt><dd>甲に対して業務を委託した場合（第6条2項の受託業務）の報酬は、ロイヤルティとは別に、合意した金額・支払条件に従って支払われます。この部分に取適法・フリーランス法が適用される場合は<strong>年14.6%の遅延損害金</strong>（非適用時は年3%）が生じます。</dd>
<dt>算定方式の2類型（2項）</dt><dd><strong>①製造数量ベース：</strong>製造完了時点または第三者への引渡し時点のいずれか早い時点で支払。<strong>②売上高ベース：</strong>実際の売上数量に応じて計算期間・支払時期に従って支払。</dd>
<dt>明細書の提出義務（3項）</dt><dd>支払時に対象期間における<strong>数量・価格・地域別売上・控除項目・算定基準等を記載した明細書</strong>を甲に提出しなければなりません。</dd>
<dt>帳簿監査権（4項）</dt><dd>甲は<strong>年1回を限度として</strong>乙の帳簿および関連書類の監査を行うことができます。監査費用は原則甲負担ですが、<strong>過少支払いが判明した場合は乙が負担</strong>します。</dd>
<dt>支払方法（5項）</dt><dd>契約書冒頭の特約・特記事項欄に記載された甲の銀行口座への振込で行います。</dd>
</dl>
<div class="cl-n">製造数量ベースと売上高ベースでは資金管理の負荷が大きく異なります。製造数量ベースは製造時に確定するため管理が簡易ですが、在庫が多く残った場合の負担が大きくなります。別紙個別条件での算定方式の選択は事業計画に合わせて慎重に行ってください。</div>
<div style="margin-top:8px"><span class="rel-tag">→ 第6条2項（甲への業務委託・報酬）</span></div>
</div>
<div class="art-grp lc"><div class="gn">Chapter 3</div><h2>期間・IP・追加（第8条〜第11条）</h2><div class="gd">契約期間・IP帰属・追加作品・契約終了後の措置</div></div>
<div class="art lc" id="lc-8">
<span class="art-ver">Ver001</span>
<div class="art-no">第8条</div>
<div class="art-ttl">第8条（契約期間）</div>
<p class="art-lead">本契約の有効期間と自動更新ルールを定めます。業務委託基本契約書の1年更新とは異なり、<strong>5年間の長期契約</strong>を基本としています。</p>
<dl>
<dt>契約期間（1項）</dt><dd>契約締結日から起算して<strong>5年間</strong>。</dd>
<dt>自動更新（2項）</dt><dd>期間満了の<strong>1か月前</strong>までにいずれかの当事者から書面による更新拒絶の通知がない場合、同一条件で<strong>5年間自動更新</strong>されます。</dd>
<dt>業務委託契約書との比較</dt><dd>業務委託基本契約書は1年更新（第14条）。ライセンス契約の5年更新はタイトルの長期運用を前提とした設計です。</dd>
</dl>
<div class="cl-n">自動更新を止める場合は期間満了の<strong>1か月前</strong>に書面で通知が必要です。タイトルごとに更新期日が異なるため、個別条件と合わせて契約管理台帳で管理してください。</div>
<div style="margin-top:8px"><span class="rel-tag">→ 第10条（追加作品の許諾期間）</span></div>
</div>
<div class="art lc" id="lc-9">
<span class="art-ver">Ver001</span>
<div class="art-no">第9条</div>
<div class="art-ttl">第9条（知的財産の帰属）</div>
<p class="art-lead">本契約に基づき乙が創作した<strong>二次著作物・乙制作素材のIP帰属</strong>を定めます。業務委託基本契約書(成果物IPは当社帰属)とは逆に、<strong>二次著作物のIPは乙(アークライト)に帰属</strong>します。</p>
<dl>
<dt>二次著作物は乙に帰属（1項）</dt><dd>乙が甲の原著作物を利用して創作した翻案物・翻訳テキスト・デザイン・ルール等の著作物（「二次著作物」）に係る著作権は<strong>乙に帰属</strong>します。</dd>
<dt>二次著作物の使用制限（2項）</dt><dd>二次著作物は本契約に定める<strong>目的および範囲に限り</strong>使用されます。甲の原著作物に係る権利を不当に侵害することはできません。</dd>
<dt>乙制作素材は乙に帰属（3項）</dt><dd>乙が製造・販売・翻訳・ローカライズ等に関連して制作した素材・部品・印刷物・仕様書・プレイシート等（「乙制作素材」）は<strong>乙に帰属</strong>します（当該素材が乙に権利帰属する場合に限る）。</dd>
<dt>業務委託基本契約書との違い</dt><dd>業務委託基本契約書では成果物のIPは当社に帰属しますが（第9条1項）、ライセンス基本契約書では乙が創作した二次著作物・素材は乙に帰属します。これはライセンス契約の本質（原著作物の利用許諾）を反映した規定です。</dd>
</dl>
<div class="cl-i">契約終了後に乙が制作した二次著作物・乙制作素材を再利用する場合で、甲の原著作物・原作アートと一体的に構成されていたときは<strong>甲の書面による事前承諾が必要</strong>です（第11条2項）。</div>
<div style="margin-top:8px"><span class="rel-tag">→ 第11条（契約終了後の措置）</span><span class="rel-tag">→ 第6条3項（委託成果物のIP）</span></div>
</div>
<div class="art lc" id="lc-10">
<span class="art-ver">Ver001</span>
<div class="art-no">第10条</div>
<div class="art-ttl">第10条（追加作品に関する合意）</div>
<p class="art-lead">本契約の枠組みを既存タイトル以外の<strong>新たな原著作物に拡張・追加適用</strong>する手続きを定めます。タイトルが増えるたびに新しい契約書を締結するのではなく、追加合意書と別紙の更新で対応できます。</p>
<dl>
<dt>追加合意書の手続き（1〜2項）</dt><dd>新たな原著作物を追加する場合、<strong>追加合意書を締結</strong>し別紙個別利用許諾条件を追加・差替えします。追加合意書には対象原著作物名・ライセンス種別・利用範囲・許諾地域・ロイヤルティ条件・許諾期間等を明記します。</dd>
<dt>追加タイトルの許諾期間（3項）</dt><dd>原則として本契約の有効期間と同一。ただし追加時点で本契約の残存期間が<strong>2年未満の場合は、自動更新後の期間全体を含めた期間</strong>を許諾期間とすることができます。</dd>
<dt>追加条件の扱い（4項）</dt><dd>追加された原著作物の利用条件は本契約の各条項に従って取り扱われます。</dd>
</dl>
<div class="cl-t">タイトルを追加するたびに基本契約書を締結し直す手間を省けます。ただし、追加合意書の内容（特にロイヤルティ率・許諾地域・許諾期間）が基本契約と矛盾しないよう法務部で内容を確認してください。</div>
</div>
<div class="art lc" id="lc-11">
<span class="art-ver">Ver001</span>
<div class="art-no">第11条</div>
<div class="art-ttl">第11条（契約終了後の措置）</div>
<p class="art-lead">契約が終了した場合に乙が講じるべき措置（製造中止・在庫処分・資料返還）と、甲の素材買取交渉権・サブライセンス契約の終了義務を定めます。</p>
<dl>
<dt>乙が講じるべき措置（1項①〜③）</dt><dd>①対象アナログゲームの<strong>新規製造を直ちに中止</strong>　②契約終了前に製造された在庫品は消尽するまで販売継続可（甲提供の原作アート等と一体的部分は甲の許諾が必要）　③原著作物・原作アート・甲提供素材等は甲の指示に従い<strong>返還または処分</strong></dd>
<dt>二次著作物・乙制作素材の再利用制限（2項）</dt><dd>契約終了後に甲の原著作物と一体的に構成されていた二次著作物・乙制作素材を再利用する場合は<strong>甲の書面による事前承諾が必要</strong>。</dd>
<dt>甲の買取交渉権（3項）</dt><dd>甲は終了時に乙が制作した主要な二次著作物・乙制作素材について<strong>相当額の対価で譲り受ける交渉を行うことができます</strong>。乙はこれに誠実に応じる義務があります。</dd>
<dt>サブライセンス契約の終了（4項）</dt><dd>乙が締結していたサブライセンス契約は<strong>乙の責任と費用で適切に終了</strong>させなければなりません。</dd>
<dt>未払金等の存続（5項）</dt><dd>契約終了時点までに発生した権利義務（未払金の支払等）は契約終了後もなお存続します。</dd>
</dl>
<div class="cl-n">契約終了が近づいたら、在庫数量・サブライセンス契約の有無・乙制作素材の一覧を整理し、終了後の措置を法務部と事前に確認してください。</div>
</div>
<div class="art-grp lc"><div class="gn">Chapter 4</div><h2>責任・雑則（第12条〜第22条）</h2><div class="gd">解除・機密・個人情報・権利義務・表明保証・損害賠償</div></div>
<div class="art lc" id="lc-12">
<span class="art-ver">Ver001</span>
<div class="art-no">第12条</div>
<div class="art-ttl">第12条（解除）</div>
<p class="art-lead">契約違反や財務上の問題等を理由として契約を解除する条件・手続きを定めます。業務委託基本契約書の第15条に対応しますが、<strong>反社会的勢力（第18条）による即時解除は本条に含まれていない</strong>点が異なります。</p>
<dl>
<dt>催告後の解除（1項）</dt><dd>相手方が契約に違反し、<strong>書面により相当期間を定めて是正を催告</strong>したにもかかわらず是正されないときに解除できます。</dd>
<dt>催告不要の即時解除事由（2項①〜⑦）</dt><dd>①支払停止・不渡り　②破産・民事再生・会社更生等の申立て（または自ら申立て）　③営業の全部譲渡・合併・清算への着手　④仮差押え・差押え・競売の申立て　⑤信用状態の著しい悪化　⑥反社会的勢力への該当・関係　⑦契約目的の達成が不可能または著しく困難な重大事由</dd>
<dt>解除と損害賠償の関係（3項）</dt><dd>解除により当事者に生じた損害について、<strong>解除権を行使した当事者がその責任を負うものではありません</strong>（解除権の行使自体は損害賠償責任を生じさせない）。ただし解除の原因が解除権者に帰責すべき場合はこの限りではありません。</dd>
</dl>
<div style="margin-top:8px"><span class="rel-tag">→ 第18条（反社会的勢力の排除による即時解除）</span></div>
</div>
<div class="art lc" id="lc-13">
<span class="art-ver">Ver001</span>
<div class="art-no">第13条</div>
<div class="art-ttl">第13条（機密保持）</div>
<p class="art-lead">契約の締結・履行に関連して相手方から開示された<strong>秘密情報の保持義務</strong>を定めます。業務委託基本契約書の第11条（5年存続）と比較して、本条は<strong>3年間の存続</strong>という違いがあります。</p>
<dl>
<dt>秘密情報の定義（1項）</dt><dd>「秘密である旨を明示された技術上または営業上の情報」が対象です（業務委託基本契約書では<strong>表示の有無を問わない</strong>点が異なります）。</dd>
<dt>存続期間（2項）</dt><dd>本契約期間中および<strong>契約終了後3年間</strong>有効に存続します（業務委託基本契約書は5年間）。</dd>
<dt>例外情報（3項①〜⑤）</dt><dd>①開示時点で公知　②開示後に自己の責によらず公知　③開示前から保有を証明できる情報　④正当な第三者から適法に入手　⑤独自に開発した情報</dd>
<dt>法令による開示（4項）</dt><dd>法令・裁判所・公的機関からの命令による開示が必要な場合は可能な限り<strong>事前に相手方に通知し協議</strong>します。</dd>
<dt>善管注意義務での管理（5項）</dt><dd>秘密情報の取扱いについて善管注意義務をもって厳重に管理し、漏洩・紛失・盗難等が発生した場合は直ちに相手方に通知します。</dd>
<dt>返還・廃棄義務（6項）</dt><dd>契約終了時または相手方からの要請があった場合、受領した秘密情報およびその<strong>複製物を返還または廃棄</strong>しなければなりません。</dd>
</dl>
<div class="cl-i">業務委託基本契約書では秘密情報の範囲が「表示の有無を問わず」広い一方、本条では「秘密である旨を明示された」情報が対象です。ライセンス交渉段階で重要な情報を開示する際は「CONFIDENTIAL」等の明示を徹底してください。</div>
</div>
<div class="art lc" id="lc-14">
<span class="art-ver">Ver001</span>
<div class="art-no">第14条</div>
<div class="art-ttl">第14条（個人情報の取扱い）</div>
<p class="art-lead">契約の履行に関連して取り扱う個人情報の管理義務を<strong>個人情報保護法</strong>に基づいて定めます。業務委託基本契約書の第12条に対応しますが、<strong>再委託制限の明示的な規定がない</strong>点が異なります。</p>
<dl>
<dt>目的外利用の禁止（2項）</dt><dd>取得した個人情報は本契約の履行に必要な範囲を超えて利用せず、第三者に提供・開示してはなりません。</dd>
<dt>安全管理措置と事故時の対応（3項）</dt><dd>漏洩・滅失・毀損の防止のための安全管理措置を講じ、事故発生時は<strong>速やかに相手方に報告</strong>し必要な措置を講じます。</dd>
</dl>
<div style="margin-top:8px"><span class="law-tag">個人情報保護法</span></div>
</div>
<div class="art lc" id="lc-15">
<span class="art-ver">Ver001</span>
<div class="art-no">第15条</div>
<div class="art-ttl">第15条（権利義務の譲渡禁止）</div>
<p class="art-lead">甲乙双方が、相手方の<strong>書面による事前の承諾なく</strong>、本契約に基づく一切の権利・義務を第三者に譲渡・担保設定・承継させることを禁止します。</p>
<dl>
<dt>譲渡禁止の徹底（1項）</dt><dd>「一切の権利および義務」を対象としており、個別の権利（ロイヤルティ請求権等）の譲渡・担保設定も禁止されます。</dd>
<dt>違反時の効果（2項）</dt><dd>前項に違反してなされた譲渡等は<strong>無効</strong>とします（業務委託基本契約書では違反時の効果の明示がありませんが、本条では明確に無効と規定）。</dd>
</dl>
<div style="margin-top:8px"><span class="rel-tag">→ 業務委託基本契約書 第17条（同趣旨）</span></div>
</div>
<div class="art lc" id="lc-16">
<span class="art-ver">Ver001</span>
<div class="art-no">第16条</div>
<div class="art-ttl">第16条（表明保証）</div>
<p class="art-lead">本契約を締結・履行するにあたって、甲乙双方が相手方に対し<strong>重要な事実の真実性・正確性を保証</strong>する条文です。特に<strong>甲による著作権の正当な保有を保証</strong>する点がライセンス契約特有の重要な規定です。</p>
<dl>
<dt>甲（ライセンサー）の表明保証（1項①〜④）</dt><dd>①<strong>原著作物の著作権等を正当に保有し第三者の権利を侵害していないこと</strong>　②原著作物について第三者からの知的財産権侵害の主張・係争が存在せずおそれもないこと（＊正当利用による紛争・損害は甲の責任と費用で解決し乙に生じた損害を補償）　③本契約の締結・履行に自己の権限があり第三者の承諾を要しないこと　④法令に違反していないこと</dd>
<dt>乙（アークライト）の表明保証（2項①〜③）</dt><dd>①本契約の締結・履行に自己の権限があり第三者の承諾を要しないこと　②法令に違反していないこと　③契約の履行にあたり誠実に対応する意志と能力を有していること</dd>
<dt>甲の著作権保証の重要性</dt><dd>甲が実際には著作権を有していない原著作物についてライセンスを受けた場合、第三者からの差止・損害賠償請求を受けるリスクがあります。<strong>甲の著作権保有の確認（権利調査）は契約締結前に行う必要があります</strong>。</dd>
</dl>
<div class="cl-w">表明保証違反（特に①の著作権非保有）があった場合、甲は乙に生じた損害を補償する義務を負います（第17条の損害賠償制限の例外）。著作権の帰属が複雑な案件では事前に詳細な権利調査を実施してください。</div>
<div style="margin-top:8px"><span class="rel-tag">→ 第17条（損害賠償・表明保証違反は制限の例外）</span></div>
</div>
<div class="art lc" id="lc-17">
<span class="art-ver">Ver001</span>
<div class="art-no">第17条</div>
<div class="art-ttl">第17条（損害賠償）</div>
<p class="art-lead">本契約に違反し、または本契約に関連して相手方に損害を与えた場合の賠償責任を定めます。<strong>「通常損害のみ賠償」という原則</strong>と、<strong>支払遅延・表明保証違反・故意重過失については無制限賠償</strong>という例外の二本立てです。</p>
<dl>
<dt>原則：通常損害の範囲に限定（1項）</dt><dd>「現実に発生した直接かつ通常の範囲に属する損害」（通常損害）のみを賠償します。</dd>
<dt>原則：特別損害等は免責（2項）</dt><dd><strong>特別損害・間接損害・逸失利益・営業機会の喪失等</strong>は賠償責任の対象外とします（通常損害を超える損害は免責）。</dd>
<dt>例外：制限が適用されない場合（3項①〜③）</dt><dd>①<strong>金銭債務の不履行</strong>（支払遅延を含む）　②<strong>表明保証条項の違反</strong>（第16条）　③<strong>故意または重大な過失</strong>による契約違反または不法行為　―これらの場合は一切の損害について全額賠償責任を負います。</dd>
<dt>業務委託基本契約書との比較</dt><dd>業務委託基本契約書（第16条）では請負の場合の損害賠償上限（支払済み報酬額）が明記されていますが、本ライセンス契約では金額上限の定めはありません。</dd>
</dl>
<div class="cl-i">支払遅延（第7条のロイヤルティ遅延を含む）は「金銭債務の不履行」として損害賠償制限の例外に該当します。支払期日の管理を徹底し、遅延が生じた場合は速やかに法務部に相談してください。</div>
</div>
<div class="art lc" id="lc-18">
<span class="art-ver">Ver001</span>
<div class="art-no">第18条</div>
<div class="art-ttl">第18条（反社会的勢力の排除）</div>
<p class="art-lead">甲乙双方が現在および将来にわたり<strong>反社会的勢力ではないこと・関係を持たないこと</strong>を表明・保証し、違反した場合の即時解除権を定めます。</p>
<dl>
<dt>表明・保証の内容（1項①〜⑤）</dt><dd>①暴力団等（反社会的勢力）でないこと　②反社会的勢力と関係を有していないこと　③反社会的勢力を利用しないこと　④反社会的勢力に資金等を提供しないこと　⑤自らまたは第三者を通じて不当な要求行為を行わないこと</dd>
<dt>即時解除と損害賠償の不請求（2項）</dt><dd>前項に違反した場合、相手方は<strong>催告なしに直ちに解除</strong>できます。解除により生じた損害について、<strong>解除された当事者は何ら賠償を請求できません</strong>（業務委託基本契約書と同様）。</dd>
</dl>
<div style="margin-top:8px"><span class="rel-tag">→ 第12条（解除の一般規定）</span></div>
</div>
<div class="art lc" id="lc-19">
<span class="art-ver">Ver001</span>
<div class="art-no">第19条</div>
<div class="art-ttl">第19条（協議事項）</div>
<p class="art-lead">本契約に定めのない事項や解釈に疑義が生じた場合には、<strong>甲乙協議のうえ誠意をもって解決</strong>を図る旨を定めます（業務委託基本契約書の第21条に対応）。</p>
<dl>
<dt>実務上の意義</dt><dd>契約書で予定していなかった事態が生じた場合のフォールバック条項です。「本契約に定めがないから何もできない」という状況を防ぐための規定です。</dd>
</dl>
</div>
<div class="art lc" id="lc-20">
<span class="art-ver">Ver001</span>
<div class="art-no">第20条</div>
<div class="art-ttl">第20条（旧契約の包括統合及び解除）</div>
<p class="art-lead">本契約の発効日をもって、同一の原著作物に関して甲乙間で従前に成立していた<strong>一切の利用許諾契約を本契約に包括統合し解除</strong>する条文です。</p>
<dl>
<dt>包括統合の仕組み（1項）</dt><dd>別紙個別利用許諾条件に記載された原著作物に関する旧契約（書面・口頭その他の形式を問わない）は本契約に包括統合され、包括統合完了と同時に旧契約は解除されます。以後は<strong>本契約のみが当該原著作物に関する唯一の有効な契約</strong>として適用されます。</dd>
<dt>空白期間ゼロの保証（2項）</dt><dd>旧契約の解除は本契約への包括統合を条件として行われるため、当該原著作物に関する<strong>利用条件に空白期間が生じません</strong>。</dd>
<dt>既確定権利義務の存続（3項）</dt><dd>発効日前に旧契約に基づいて既に確定した権利義務は、本契約の枠組みの中で有効のまま引き継がれます。</dd>
</dl>
<div class="cl-i">既存の口頭合意や個別メール合意も「旧契約」として本契約に統合・解除されます。重要な口頭合意がある場合は本契約締結前に内容を明確化し、別紙個別条件に反映させてください。</div>
<div style="margin-top:8px"><span class="rel-tag">→ 業務委託基本契約書 第22条（同趣旨）</span></div>
</div>
<div class="art lc" id="lc-21">
<span class="art-ver">Ver001</span>
<div class="art-no">第21条</div>
<div class="art-ttl">第21条（準拠法および合意管轄）</div>
<p class="art-lead">本契約に関する紛争が生じた場合の<strong>適用法律と管轄裁判所</strong>を定めます。管轄裁判所は変数（{{JURISDICTION}}）で設定可能です。</p>
<dl>
<dt>準拠法（1項）</dt><dd>本契約の準拠法は<strong>日本法</strong>です。</dd>
<dt>合意管轄（2項）</dt><dd>変数 <code>{{JURISDICTION}}</code> で指定された裁判所を第一審の専属的合意管轄裁判所とします。国内取引では東京地方裁判所、海外取引では別途検討が必要な場合があります。</dd>
</dl>
<div class="cl-i">海外のライセンサー（甲）と契約する場合、甲が自国法・自国裁判所を要求することがあります。実務上は<strong>仲裁（JCAA・ICC等）</strong>がお互いにとって執行しやすい場合があります。詳細は法務部に相談してください。</div>
<div style="margin-top:8px"><span class="rel-tag">→ BG事業部契約スキームガイド（場面1・場面2の準拠法・紛争解決）</span></div>
</div>
<div class="art lc" id="lc-22">
<span class="art-ver">Ver001</span>
<div class="art-no">第22条</div>
<div class="art-ttl">第22条（存続）</div>
<p class="art-lead">本契約が終了した場合であっても、<strong>一定の条項が引き続き有効に存続</strong>することを定めます。業務委託基本契約書が「性質上存続すべき条項は存続」という包括的な規定（第14条5項）をとるのに対し、本条は<strong>存続条項を列挙</strong>しています。</p>
<dl>
<dt>存続する条項（1項）</dt><dd>本条（第22条）自身　／　第7条（対価）　／　第9条〜第11条（知的財産の帰属・追加作品・契約終了後の措置）　／　第13条（機密保持）　／　第21条（準拠法および合意管轄）</dd>
<dt>実務上の意義</dt><dd>契約終了後も在庫の売上ロイヤルティ精算・二次著作物の帰属・秘密保持義務・管轄は有効です。特に<strong>第7条（対価）が存続</strong>することで、終了後の在庫販売分のロイヤルティ精算義務が明確になります。</dd>
</dl>
</div>

</div>

</main>
</div>

<script>
function switchContract(type) {
  document.getElementById('panel-sv').classList.toggle('active', type === 'sv');
  document.getElementById('panel-lc').classList.toggle('active', type === 'lc');
  document.getElementById('sv-nav').style.display = type === 'sv' ? 'block' : 'none';
  document.getElementById('lc-nav').style.display = type === 'lc' ? 'block' : 'none';
  document.querySelectorAll('.cv-sw-btn').forEach(b => b.classList.remove('active-sv','active-lc'));
  if (type === 'sv') document.querySelector('.cv-sw-btn.sv').classList.add('active-sv');
  else document.querySelector('.cv-sw-btn.lc').classList.add('active-lc');
}
</script>



</body>
</html>$g_clause$, 'seed 0095 (from services/api/guides)', 'seed')
    RETURNING id INTO vid;
  UPDATE portal_guides
     SET current_version_id = vid, status = 'published', updated_at = now()
   WHERE id = gid;
END
$seed_clause$;

-- ── eventinst ──────────────────────────────────────────────
DO $seed_eventinst$
DECLARE gid INTEGER; vid INTEGER;
BEGIN
  SELECT id INTO gid FROM portal_guides WHERE guide_key = 'eventinst';
  IF gid IS NULL THEN
    RAISE NOTICE 'skip eventinst: portal_guides にメタ行なし(0094 を先に適用)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM portal_guide_versions WHERE guide_id = gid) THEN
    RETURN; -- 既に版あり。再適用しない(冪等)。
  END IF;
  INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
    VALUES (gid, 1, $g_eventinst$<!DOCTYPE html><html lang="ja"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>試遊インストラクション 業務委託 実務ガイド</title>
<style>
:root{--navy:#1d3557;--navy-l:#2a4a6e;--red:#e63946;--red-s:#fde8ea;--gold:#c47d1a;--gold-s:#fef3e2;--green:#1d9e75;--green-s:#e4f7f1;--blue:#378add;--blue-s:#e8f1fb;--teal:#085041;--teal-s:#e1f5ee;--g1:#f8f9fa;--g2:#e9ecef;--g3:#dee2e6;--g5:#6c757d;--tx:#212529;--tx2:#495057;--sw:228px;
--ca:#27500a;--cb:#085041}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;font-size:13.5px;line-height:1.7;color:var(--tx);background:#fff}
#sidebar{position:fixed;top:0;left:0;width:var(--sw);height:100vh;background:var(--navy);overflow-y:auto;display:flex;flex-direction:column;z-index:100}
#sh{padding:16px 14px 12px;border-bottom:1px solid rgba(255,255,255,.1)}
#sh h1{font-size:9px;font-weight:700;color:rgba(255,255,255,.45);letter-spacing:.08em;text-transform:uppercase}
#sh p{font-size:11.5px;color:rgba(255,255,255,.92);font-weight:600;margin-top:3px;line-height:1.4}
nav{padding:6px 0 20px}
.ns{display:block;padding:5px 14px;font-size:9px;font-weight:700;color:rgba(255,255,255,.32);letter-spacing:.07em;text-transform:uppercase;margin-top:9px}
.nl{display:block;padding:4px 14px;font-size:11.5px;color:rgba(255,255,255,.7);text-decoration:none;border-left:2px solid transparent;transition:all .15s;line-height:1.4}
.nl:hover,.nl.active{color:#fff;background:rgba(255,255,255,.09);border-left-color:#e63946}
.nsub{display:block;padding:3px 14px 3px 24px;font-size:10.5px;color:rgba(255,255,255,.45);text-decoration:none;transition:color .15s}
.nsub:hover{color:rgba(255,255,255,.82)}
.bdg{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-size:9px;font-weight:700;margin-right:4px;vertical-align:middle}
.bA{background:#eaf3de;color:var(--ca)}.bB{background:var(--teal-s);color:var(--cb)}.b3{background:#faeeda;color:var(--gold)}
#main{margin-left:var(--sw);padding:36px 46px 80px;max-width:calc(var(--sw) + 850px)}
h1.dt{font-size:21px;font-weight:700;color:var(--navy);border-bottom:3px solid var(--navy);padding-bottom:9px;margin-bottom:5px}
.dm{font-size:12px;color:var(--g5);margin-bottom:28px}
.chap{border-radius:8px;padding:16px 22px;margin:32px 0 14px;scroll-margin-top:16px}
.chap.cA{background:var(--ca)}.chap.cB{background:var(--cb)}.chap.c3{background:var(--navy)}
.chap .cn{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px}
.chap h2{font-size:16px;font-weight:700;color:#fff;margin:0}
.chap .cdesc{font-size:12px;color:rgba(255,255,255,.65);margin-top:5px}
h2.sec{font-size:16px;font-weight:700;color:var(--navy);border-left:4px solid var(--navy);padding-left:10px;margin:28px 0 11px;scroll-margin-top:20px}
h3.sub{font-size:13.5px;font-weight:700;color:var(--navy-l);margin:18px 0 9px;padding-bottom:4px;border-bottom:1px solid var(--g3);scroll-margin-top:20px}
h4.sh4{font-size:12.5px;font-weight:700;color:var(--tx2);margin:11px 0 7px}
p{margin-bottom:9px;color:var(--tx2)}strong{color:var(--tx)}
ul,ol{padding-left:20px;margin-bottom:9px;color:var(--tx2)}li{margin-bottom:3px}
.shb{border-radius:7px;padding:12px 16px;margin-bottom:14px;scroll-margin-top:16px}
.shb h3{font-size:13.5px;font-weight:700;color:#fff;margin:0}
.shb .sn{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:2px}
.sA{background:var(--ca)}.sB{background:var(--cb)}.s3{background:var(--navy)}
.cl{border-left:3px solid;padding:8px 12px;border-radius:0 5px 5px 0;margin:9px 0;font-size:12.5px}
.cl-w{border-color:var(--red);background:var(--red-s)}.cl-i{border-color:var(--blue);background:var(--blue-s)}.cl-t{border-color:var(--green);background:var(--green-s)}.cl-n{border-color:var(--gold);background:var(--gold-s)}
.tw{overflow-x:auto;margin:9px 0}
table{width:100%;border-collapse:collapse;font-size:12px}
thead th{background:var(--navy);color:#fff;padding:7px 9px;text-align:left;font-weight:600;font-size:11.5px;white-space:nowrap}
tbody tr:nth-child(even){background:var(--g1)}
tbody td{padding:6px 9px;border-bottom:1px solid var(--g3);vertical-align:top;line-height:1.55}
tbody tr:hover{background:#f0f4ff}
td.tc{font-weight:600;color:var(--navy);font-size:11.5px;white-space:nowrap}
td.tcr{font-weight:700;color:var(--red)}
td.tcg{font-weight:700;color:var(--green)}
td.law{font-size:11px;color:var(--g5)}
.case-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0}
.case-card{border-radius:7px;padding:16px 18px;border:2px solid}
.case-card.A{border-color:var(--ca);background:#f4f9f0}
.case-card.B{border-color:var(--cb);background:var(--teal-s)}
.case-card h4{font-size:13px;font-weight:700;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid}
.case-card.A h4{color:var(--ca);border-color:var(--ca)}
.case-card.B h4{color:var(--cb);border-color:var(--cb)}
.case-card ul{padding-left:16px;font-size:12px;color:var(--tx2)}
.step-tbl thead th{white-space:normal}
.step-num-cell{font-weight:700;color:#fff;text-align:center;font-size:12px;padding:6px 8px;white-space:nowrap}
.step-A{background:var(--ca)}.step-B{background:var(--cb)}.step-3{background:var(--navy)}
.ck{list-style:none;padding:0;margin:7px 0}
.ck li{padding:7px 10px 7px 30px;position:relative;border-bottom:1px solid var(--g2);font-size:12px;color:var(--tx2)}
.ck li::before{content:"\2610";position:absolute;left:7px;font-size:13px;color:var(--navy);line-height:1.5}
.ck li:last-child{border-bottom:none}
.ck li .why{display:block;color:var(--red);font-weight:700;font-size:10.5px;margin-top:2px}
.badge{display:inline-flex;align-items:center;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:3px}
.b-biz{background:#eaf3de;color:var(--ca)}.b-leg{background:#faeeda;color:var(--gold)}.b-au{background:var(--g2);color:#374151;border:1px solid var(--g3)}
.tag{display:inline-block;font-size:9.5px;font-weight:600;padding:1px 5px;border-radius:3px;margin-right:2px}
.t-A{background:#eaf3de;color:var(--ca)}.t-B{background:var(--teal-s);color:var(--cb)}.t-red{background:var(--red-s);color:var(--red)}.t-law{background:#e6effa;color:var(--navy)}
.ap{background:var(--g1);border-radius:7px;padding:14px 18px;margin-bottom:14px;font-size:12.5px}
hr.sd{border:none;border-top:2px solid var(--g2);margin:30px 0}
.faq-item{margin-bottom:12px}
.faq-q{font-weight:700;color:var(--navy);margin-bottom:4px;font-size:13px}
.faq-a{padding:9px 13px;background:var(--g1);border-radius:4px;font-size:12.5px;color:var(--tx2);border-left:3px solid var(--g3)}
.cta{display:inline-flex;align-items:center;gap:8px;background:var(--navy);color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 20px;border-radius:8px;margin:6px 0;transition:all .15s}
.cta:hover{background:var(--navy-l);transform:translateY(-1px);box-shadow:0 3px 10px rgba(29,53,87,.25)}
/* メール文例ブロック */
.mail{background:#fff;border:1px solid var(--g3);border-radius:7px;overflow:hidden;margin:12px 0}
.mail .mh{background:var(--g1);padding:9px 16px;border-bottom:1px solid var(--g3);font-size:11.5px;color:var(--tx2)}
.mail .mh strong{color:var(--navy)}
.mail .mb{padding:14px 18px;font-size:12.5px;color:var(--tx2)}
.mail .mb ol{padding-left:18px}
.mail .mb ol li{margin-bottom:6px}
</style>

<style id="gas-portal-back-style">
.portal-back-button{position:fixed;right:16px;bottom:16px;z-index:3000;display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:999px;background:#1d3557;color:#fff;text-decoration:none;font-size:12px;font-weight:700;box-shadow:0 3px 12px rgba(0,0,0,.22);opacity:.92;transition:opacity .15s,transform .15s}
.portal-back-button:hover{opacity:1;transform:translateY(-1px)}
@media print{.portal-back-button{display:none}}
</style>

</head>
<body>
  <?!= include('common_top_tabs', { appUrl: appUrl, currentPage: currentPage }); ?>
<aside id="sidebar">
<div id="sh"><h1>法務部</h1><p>試遊インストラクション<br>業務委託 実務ガイド</p></div>
<nav>
<a class="nl" href="#top">概要</a>
<a class="nl" href="#principle">大原則（実態判断）</a>
<span class="ns">手順</span>
<a class="nl" href="#flow"><span class="bdg b3">順</span>進め方（フロー）</a>
<a class="nl" href="#prohibit"><span class="bdg bA">禁</span>やってはいけないこと</a>
<a class="nl" href="#shiyu"><span class="bdg bB">試</span>試遊特有の対策</a>
<span class="ns">理解</span>
<a class="nl" href="#compare">アルバイトとの違い</a>
<a class="nl" href="#freelance">フリーランス新法</a>
<span class="ns">募集</span>
<a class="nl" href="#mail">募集メール文例</a>
<a class="nsub" href="#mail-words">言い換えの基本</a>
<span class="ns">参考</span>
<a class="nl" href="#faq">Q&amp;A</a>
</nav>
</aside>

<main id="main">
<h1 class="dt" id="top">試遊インストラクション 業務委託 実務ガイド</h1>
<p class="dm">作成：法務部　｜　来場者へのボードゲーム試遊インストラクションを、個人へ直接 業務委託で依頼する場合の運営部門向けガイド</p>

<div class="cl cl-i">このガイドは、ゲームマーケット等のイベントで<strong>試遊インストラクション</strong>（来場者に遊び方を説明・進行する役務）を<strong>個人へ直接 業務委託</strong>するときに、偽装請負（無許可派遣）に転ばないための実務ルールです。試遊インストラクションは物を完成させる「請負」ではなく<strong>役務の提供（準委任）</strong>で、時間と結びつきやすいぶん、設計を誤ると最も偽装請負に転びやすい類型です。迷ったら現場で判断せず法務へ。</div>

<div class="cl cl-n"><strong>本ガイドは例外運用です。</strong> 本来おすすめは運営業者へ一括委託し、業者が自社スタッフを指揮する形です。個人に直接お願いする本ガイドの形は、以下のルールを<strong>すべて</strong>守れる場合に限って採用してください。</div>

<hr class="sd">

<!-- 大原則 -->
<h2 class="sec" id="principle">押さえるべき大原則</h2>
<p>業務委託は<strong>「人を働かせる」契約ではなく、「業務をお願いする」契約</strong>です。現場でスタッフに直接あれこれ指示したり、勤務時間を管理した瞬間に、契約書が業務委託でも法律上は<strong>雇用</strong>と扱われ、偽装請負になります。</p>
<div class="cl cl-w"><strong>判断は名称ではなく実態で行われます。</strong> 「呼び方」を整えても、現場の運用が雇用なら評価は変わりません。是正指導・労働契約申込みみなし等のリスクがある重い違反です。<strong>「誰がその時間・作業を支配しているか」</strong>が分かれ目です。</div>

<hr class="sd">

<!-- フロー -->
<div class="chap c3" id="flow">
  <div class="cn">Step Flow</div>
  <h2>進め方（フロー）</h2>
  <div class="cdesc">担当の事前割当 → 条件明示 → 契約 → 資料提供 → 当日 → 支払（60日以内）。</div>
</div>
<div class="tw"><table>
<thead><tr><th style="width:140px">ステップ</th><th>内容</th></tr></thead>
<tbody>
<tr><td class="step-num-cell step-3">① 事前割当</td><td>担当ゲーム・担当卓・担当時間帯（目安）を事前に決める。<strong>時間で拘束しない</strong>。</td></tr>
<tr><td class="step-num-cell step-3">② 条件明示</td><td>委託内容・委託料・支払期日などを書面／メールで明示（フリーランス新法の義務）。</td></tr>
<tr><td class="step-num-cell step-3">③ 募集・打診</td><td>後掲のメール文例を使用。</td></tr>
<tr><td class="step-num-cell step-3">④ 契約</td><td>業務委託契約書＋取引条件明示書面を取り交わし（法務確認）。</td></tr>
<tr><td class="step-num-cell step-3">⑤ 資料提供</td><td>インストラクション資料・ルールマニュアルを事前提供（＝仕様の提供）。当日逐一直すのはNG。</td></tr>
<tr><td class="step-num-cell step-3">⑥ 当日</td><td>仕様どおり各自で遂行。<strong>個別指示・差配・時間管理はしない</strong>。</td></tr>
<tr><td class="step-num-cell step-3">⑦ 支払</td><td>全日程の業務完了日から<strong>60日以内</strong>に支払（フリーランス新法の義務）。</td></tr>
</tbody></table></div>

<hr class="sd">

<!-- 禁止チェックリスト -->
<div class="chap cA" id="prohibit">
  <div class="cn">Checklist</div>
  <h2>やってはいけないこと</h2>
  <div class="cdesc">1つでも当てはまると「雇用」と判断されやすくなる。総合判断なので積み重なるほど黒に近づく。</div>
</div>
<ul class="ck">
<li>当社担当が当日「次あの人に説明して」「ここ立ってて」と個別に差配している<span class="why">⚠ 指揮命令 ── 最も危険</span></li>
<li>「◯時〜◯時拘束」「出勤・退勤」「シフト」で時間を管理している<span class="why">⚠ 時間的拘束</span></li>
<li>当社が「12〜13時は休憩」と休憩を一律指定している<span class="why">⚠ 時間管理</span></li>
<li>報酬を「時給」「拘束時間×単価」で決めている<span class="why">⚠ 労務対償性</span></li>
<li>依頼を断れない・他社の仕事を受けられない建付けにしている<span class="why">⚠ 諾否の自由なし／専属性</span></li>
<li>当社の勤怠システムに打刻させている／指揮系統図に組み込んでいる<span class="why">⚠ 労務管理への組込み</span></li>
<li>イベントTシャツ等の着用を強制している<span class="why">⚠ 労働者性を補強</span></li>
<li>募集や契約に「採用」「勤務」「残業代」「有給」「通勤手当」と書いている<span class="why">⚠ 雇用用語</span></li>
</ul>

<hr class="sd">

<!-- 試遊特有 -->
<div class="chap cB" id="shiyu">
  <div class="cn">Game Demo Specific</div>
  <h2>試遊インストラクション特有の対策</h2>
  <div class="cdesc">役務（準委任）ゆえの労働者性リスクを、設計で消す。</div>
</div>
<h3 class="sub">① 当日の差配を当社がしない</h3>
<p>担当ゲーム・担当卓・担当時間帯（目安）を事前に割り当て、当日は各自が仕様どおり遂行する形にします。当日その場で「次はこのゲーム」と振るのは指揮命令になります。</p>
<h3 class="sub">② 品質確保は「事前の資料提供」で行う</h3>
<p>正しいルールで説明してほしいという要請は、<strong>インストラクション資料・ルールマニュアルを事前に渡す（＝仕様の提供）</strong>ことでクリアできます。これは指揮命令ではありません（翻訳者に原文を渡すのと同じ理屈）。当日横について逐一直すのはNGです。</p>
<h3 class="sub">③ 休憩・離席は受託者の裁量</h3>
<div class="cl cl-t">稼働／非稼働の線引きはしません。<strong>休憩・離席は受託者の裁量で、委託料は一式のため取得の有無で増減しません。</strong>手すきの際の離席も自由（場所的拘束をかけない）。複数名の場合は受託者間で調整してもらいます。</div>
<h3 class="sub">④ 服装・名札</h3>
<p>来場者対応上、当社用意の名札を配るのは可。ただしイベントTシャツ等の<strong>着用強制は労働者性を補強</strong>するため「貸与・着用は任意」に留めます。</p>

<hr class="sd">

<!-- アルバイトとの違い -->
<h2 class="sec" id="compare">アルバイト（雇用）との違い</h2>
<div class="case-grid">
  <div class="case-card A">
    <h4>業務委託（今回）</h4>
    <ul>
      <li>当社からの<strong>個別の指揮命令なし</strong>（仕様で伝える）</li>
      <li>休憩は本人裁量／時間管理しない</li>
      <li>報酬は<strong>業務単位の委託料</strong>（本イベント一式）</li>
      <li>労働時間・残業・最低賃金の概念なし</li>
    </ul>
  </div>
  <div class="case-card B">
    <h4>アルバイト（雇用）</h4>
    <ul>
      <li>当社が<strong>直接指示できる</strong></li>
      <li>休憩付与義務あり／時間管理する</li>
      <li>報酬は<strong>時給・日給</strong>（時間対価）</li>
      <li>労働時間・残業・最低賃金の規制あり</li>
    </ul>
  </div>
</div>
<div class="tw"><table>
<thead><tr><th>論点</th><th>アルバイト</th><th>業務委託</th></tr></thead>
<tbody>
<tr><td class="tc">指揮命令</td><td>当社が直接指示できる</td><td>不可（成果・仕様で伝える）</td></tr>
<tr><td class="tc">労働時間・残業</td><td>上限・割増あり</td><td>なし。委託料で完結</td></tr>
<tr><td class="tc">休憩</td><td>付与義務あり</td><td>義務なし。本人裁量</td></tr>
<tr><td class="tc">最低賃金</td><td>適用あり</td><td>適用なし</td></tr>
<tr><td class="tc">報酬</td><td>時給・日給（時間対価）</td><td>業務単位の委託料</td></tr>
<tr><td class="tc">交通費</td><td>通勤手当として支給可</td><td>経費の取決め（実費精算／委託料込み）</td></tr>
<tr><td class="tc">社会保険・労災</td><td>要件該当で加入</td><td>原則なし</td></tr>
<tr><td class="tc">中途解約</td><td>解雇規制</td><td>契約条項に従う</td></tr>
</tbody></table></div>
<div class="cl cl-i"><strong>ポイント：</strong> 休憩も交通費も「会社の義務」ではなく「契約でどう決めるか」の話です。<strong>払ってはいけないのではなく</strong>、雇用の言葉を使わず取引条件として書くだけです。</div>

<hr class="sd">

<!-- フリーランス新法 -->
<h2 class="sec" id="freelance">フリーランス新法（個人に頼むなら必須）</h2>
<p>個人へ委託する場合、以下は単発・複数日イベントでもかかります。</p>
<div class="tw"><table>
<thead><tr><th style="width:170px">義務</th><th>内容</th></tr></thead>
<tbody>
<tr><td class="tc">取引条件の明示</td><td>委託内容・報酬額・支払期日などを書面／メールで明示</td></tr>
<tr><td class="tc">支払期日</td><td>役務提供を受けた日（全日程の業務完了日）から<strong>60日以内</strong></td></tr>
<tr><td class="tc">募集情報の的確表示</td><td>募集文に嘘・誤解を与える表示をしない（実際の条件と揃える）</td></tr>
</tbody></table></div>
<div class="cl cl-n">「買いたたき・報酬減額の禁止」等は<strong>継続的な委託</strong>向けの規制で、単発・スポットのイベントは基本対象外。ただし不当に安い値決めはトラブルの元なので避けてください。</div>

<hr class="sd">

<!-- 募集メール -->
<h2 class="sec" id="mail">募集案内（条件案内）メール文例 ── 個人宛</h2>

<h3 class="sub" id="mail-words">言い換えの基本</h3>
<div class="tw"><table>
<thead><tr><th>✕ 雇用を推認させる語</th><th>○ 業務委託の表現</th></tr></thead>
<tbody>
<tr><td class="tcr">時給／日給</td><td class="tcg">委託料（本イベント一式 ◯円）</td></tr>
<tr><td class="tcr">勤務時間／シフト／出勤</td><td class="tcg">稼働日・作業時間の目安</td></tr>
<tr><td class="tcr">休憩◯分付与</td><td class="tcg">受託者の判断で適宜休憩</td></tr>
<tr><td class="tcr">交通費支給／通勤手当</td><td class="tcg">旅費は実費別途精算／委託料に含む</td></tr>
<tr><td class="tcr">残業代／有給</td><td class="tcg">（記載しない）</td></tr>
<tr><td class="tcr">採用／面接</td><td class="tcg">受託者の選定／顔合わせ</td></tr>
<tr><td class="tcr">当社スタッフの指示のもと</td><td class="tcg">インストラクション資料に基づき遂行</td></tr>
</tbody></table></div>

<h3 class="sub">メール文例</h3>
<div class="mail">
<div class="mh"><strong>件名：</strong>【業務委託】ゲームマーケット◯◯ 試遊インストラクション業務の受託者募集のご案内</div>
<div class="mb">
<p>◯◯様</p>
<p>平素お世話になっております。株式会社アークライト◯◯部です。<br>標記イベントにおける試遊インストラクション業務につき、業務委託にて受託いただける方を募集しております。下記をご確認のうえご検討ください。</p>
<ol>
<li><strong>委託業務の内容</strong>：来場者へのボードゲーム試遊インストラクション（遊び方の説明・進行補助）。担当ゲーム・担当卓は事前に割り当て、別途お渡しするインストラクション資料に基づき遂行いただきます。</li>
<li><strong>契約形態</strong>：業務委託（雇用ではありません。当社からの個別の指揮命令は行いません）</li>
<li><strong>稼働日・時間帯の目安</strong>：2026年◯月◯日〜◯日／各日 9:00頃〜18:00頃（拘束ではなく作業の目安）</li>
<li><strong>委託料</strong>：本イベント（◯月◯日〜◯日）の試遊インストラクション業務一式 ◯◯円（税込／別）</li>
<li><strong>報酬支払期日</strong>：全日程の業務完了日から60日以内に指定口座へお振込</li>
<li><strong>休憩・離席</strong>：受託者の判断で適宜お取りいただけます。委託料は一式のため取得の有無で増減しません（複数名の場合は受託者間でご調整ください）</li>
<li><strong>旅費</strong>：会場までの交通費は実費を委託料とは別に精算します（または委託料に含みます）</li>
<li><strong>服装・持ち物</strong>：動きやすい服装。名札は当社にて用意します（イベントTシャツは貸与・着用は任意）</li>
<li><strong>再委託</strong>：事前の書面承諾があれば可（守秘・品質基準の遵守が条件）</li>
<li><strong>その他</strong>：源泉徴収・保険の取扱い 等</li>
</ol>
<p>ご受託いただける場合は、別途「業務委託契約書」および「取引条件明示書面」を取り交わします。<br>ご不明点はお問い合わせください。</p>
</div>
</div>

<hr class="sd">

<!-- FAQ -->
<h2 class="sec" id="faq">よくある疑問（Q&amp;A）</h2>
<div class="faq-item">
<div class="faq-q">Q1. 交通費は払ってはいけないのか？</div>
<div class="faq-a">払って構いません。禁止されているのは「通勤手当」「交通費支給」といった雇用用語と、それを当然の手当として制度化することです。業務委託では経費の取決めとして「会場までの交通費は実費を委託料とは別に精算する」または「委託料に含む」と取引条件として書きます。</div>
</div>
<div class="faq-item">
<div class="faq-q">Q2. 休憩を「12〜13時」と会社で決めてよいか？ 「非稼働時間」と呼べば大丈夫？</div>
<div class="faq-a">どちらもNGです。当社が時間帯を一律に決める＝時間管理で、労働者性に働きます。判断は実態で行われるため、「非稼働時間」と呼び替えても、当社が時間を支配していれば評価は同じです。委託料が一式である以上そもそも稼働／非稼働を区別する実益がなく、区別を持ち込むとかえって時間管理的な色がつきます。休憩・離席は受託者裁量とし、委託料は一式で増減しない、と書いてください。</div>
</div>
<div class="faq-item">
<div class="faq-q">Q3. 正しいルールで説明してほしい。これは「指示」にならないか？</div>
<div class="faq-a">なりません。インストラクション資料・ルールマニュアルを事前に渡すのは「仕様の提供」であって指揮命令ではありません（翻訳者に原文を渡すのと同じ）。NGになるのは、当日横について一つひとつのやり方を逐次指示することです。品質は事前の資料と顔合わせで担保してください。</div>
</div>
<div class="faq-item">
<div class="faq-q">Q4. 当日、現場で「次はこのゲームを説明して」と頼むのは？</div>
<div class="faq-a">NGです。当日の差配（誰が何をいつやるか）を当社が指示するのは指揮命令にあたります。担当ゲーム・担当卓・担当時間帯を事前に割り当て、当日は各自が仕様どおり遂行する形にしてください。</div>
</div>
<div class="faq-item">
<div class="faq-q">Q5. 報酬は「1日◯円」でよいか？</div>
<div class="faq-a">複数日イベントは「本イベント一式 ◯円」が安全です。「時給」「拘束時間×単価」という見せ方は時間対価＝労働者性につながるため避けます。業務（イベント）単位の委託料として書いてください。</div>
</div>

<div style="background:var(--navy);border-radius:8px;padding:18px 22px;margin-top:28px;text-align:center">
<div style="font-size:10px;color:rgba(255,255,255,.45);margin-bottom:5px">お問い合わせ先</div>
<div style="font-size:17px;font-weight:700;color:#fff;margin-bottom:3px">Arclight Inc. 経営管理本部 法務部</div>
<div style="font-size:12px;color:rgba(255,255,255,.65)">当日どこまで声をかけてよいか・報酬の決め方・トラブル対応など、迷う場面は現場で判断せずご相談ください</div>
</div>
</main>

</body></html>$g_eventinst$, 'seed 0095 (from services/api/guides)', 'seed')
    RETURNING id INTO vid;
  UPDATE portal_guides
     SET current_version_id = vid, status = 'published', updated_at = now()
   WHERE id = gid;
END
$seed_eventinst$;

-- ── knowledge ──────────────────────────────────────────────
DO $seed_knowledge$
DECLARE gid INTEGER; vid INTEGER;
BEGIN
  SELECT id INTO gid FROM portal_guides WHERE guide_key = 'knowledge';
  IF gid IS NULL THEN
    RAISE NOTICE 'skip knowledge: portal_guides にメタ行なし(0094 を先に適用)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM portal_guide_versions WHERE guide_id = gid) THEN
    RETURN; -- 既に版あり。再適用しない(冪等)。
  END IF;
  INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
    VALUES (gid, 1, $g_knowledge$<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>法務ナレッジブック｜契約・取引審査・文書管理の実務基準</title>
  <style>
    :root {
      --bg: #f5f7fb;
      --panel: #ffffff;
      --panel-2: #f9fafb;
      --text: #182033;
      --muted: #64748b;
      --line: #dbe3ef;
      --navy: #183153;
      --blue: #2563eb;
      --teal: #0f766e;
      --green: #15803d;
      --amber: #b45309;
      --red: #b91c1c;
      --purple: #6d28d9;
      --shadow: 0 14px 35px rgba(15, 23, 42, 0.09);
      --radius: 16px;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      color: var(--text);
      background: var(--bg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic", "Yu Gothic UI", Meiryo, sans-serif;
      line-height: 1.75;
    }

    a { color: inherit; text-decoration: none; }
    .layout { display: grid; grid-template-columns: 290px minmax(0, 1fr); min-height: 100vh; }

    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      background: #0f1f35;
      color: #e5eefb;
      padding: 24px 18px;
      border-right: 1px solid rgba(255,255,255,0.08);
    }
    .brand { margin-bottom: 24px; }
    .brand small { display:block; color:#93a4bc; font-size:12px; letter-spacing:.08em; margin-bottom: 8px; }
    .brand h1 { margin:0; font-size:20px; line-height:1.35; }
    .brand .version { display:inline-block; margin-top:10px; padding:3px 9px; border:1px solid rgba(255,255,255,.18); border-radius:999px; color:#bfd0e8; font-size:12px; }
    .nav-group-title { color:#93a4bc; font-size:12px; text-transform:uppercase; letter-spacing:.08em; margin:24px 0 8px; }
    .nav a { display:block; padding:8px 10px; border-radius:10px; color:#e5eefb; font-size:14px; }
    .nav a:hover { background: rgba(255,255,255,0.08); }

    main { min-width: 0; }
    .hero {
      background: linear-gradient(135deg, #10213a 0%, #193b63 55%, #0f766e 100%);
      color: #fff;
      padding: 44px 52px 34px;
    }
    .hero h2 { margin:0; font-size:34px; line-height:1.35; letter-spacing:.02em; }
    .hero p { max-width: 980px; color:#dce9f8; margin: 14px 0 0; }
    .hero-grid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:14px; margin-top:28px; }
    .hero-card { background:rgba(255,255,255,.11); border:1px solid rgba(255,255,255,.16); border-radius:16px; padding:16px; backdrop-filter: blur(6px); }
    .hero-card strong { display:block; font-size:16px; margin-bottom:5px; }
    .hero-card span { color:#cfe0f5; font-size:13px; }

    .toolbar {
      position: sticky;
      top: 0;
      z-index: 20;
      background: rgba(245, 247, 251, .94);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--line);
      padding: 18px 52px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
    }
    .searchbox { position:relative; }
    .searchbox input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 13px 16px 13px 42px;
      font-size: 15px;
      background: #fff;
      outline: none;
      box-shadow: 0 6px 16px rgba(15,23,42,.04);
    }
    .searchbox:before { content:"🔎"; position:absolute; left:15px; top:10px; opacity:.65; }
    .toolbar .meta { color: var(--muted); font-size: 13px; white-space: nowrap; }

    .content { padding: 34px 52px 64px; max-width: 1500px; }
    section { scroll-margin-top: 86px; }
    .section-title { margin: 34px 0 18px; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; }
    .section-title h2 { margin:0; color:var(--navy); font-size:26px; line-height:1.35; }
    .section-title p { margin: 6px 0 0; color:var(--muted); max-width:860px; }

    .panel { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); padding:24px; margin-bottom:20px; }
    .panel.tight { padding:18px; }

    .grid { display:grid; gap:16px; }
    .grid.cols-2 { grid-template-columns: repeat(2, minmax(0,1fr)); }
    .grid.cols-3 { grid-template-columns: repeat(3, minmax(0,1fr)); }
    .grid.cols-4 { grid-template-columns: repeat(4, minmax(0,1fr)); }

    .card { background:#fff; border:1px solid var(--line); border-radius:16px; padding:18px; box-shadow: 0 8px 20px rgba(15,23,42,.05); }
    .card h3 { margin:0 0 8px; color:#10213a; font-size:18px; }
    .card p { margin:0; color:#475569; font-size:14px; }
    .card ul { margin: 10px 0 0; padding-left: 1.2em; color:#334155; font-size:14px; }

    .tag-row { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
    .tag { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; font-size:12px; border:1px solid transparent; background:#eef2ff; color:#3730a3; }
    .tag.type { background:#e0f2fe; color:#075985; border-color:#bae6fd; }
    .tag.law { background:#ecfdf5; color:#166534; border-color:#bbf7d0; }
    .tag.risk { background:#fff7ed; color:#9a3412; border-color:#fed7aa; }
    .tag.high { background:#fef2f2; color:#991b1b; border-color:#fecaca; }
    .tag.ops { background:#f5f3ff; color:#5b21b6; border-color:#ddd6fe; }

    table { width:100%; border-collapse: collapse; margin: 14px 0 4px; font-size:14px; }
    th, td { border:1px solid var(--line); padding:10px 12px; vertical-align: top; }
    th { background:#f1f5f9; color:#183153; text-align:left; font-weight:700; }
    tr:nth-child(even) td { background:#fbfdff; }

    .callout { border-left: 5px solid var(--blue); background:#eff6ff; border-radius:12px; padding:14px 16px; margin:14px 0; }
    .callout strong { color:#1e3a8a; }
    .callout.warn { border-left-color: var(--amber); background:#fffbeb; }
    .callout.danger { border-left-color: var(--red); background:#fef2f2; }
    .callout.good { border-left-color: var(--green); background:#f0fdf4; }

    details { border:1px solid var(--line); border-radius:14px; background:#fff; margin:10px 0; overflow:hidden; }
    summary { cursor:pointer; padding:14px 16px; font-weight:700; color:#183153; background:#f8fafc; }
    details .detail-body { padding: 0 16px 16px; }

    .decision-tree { display:grid; gap:10px; }
    .decision-step { display:grid; grid-template-columns: 44px minmax(0,1fr); gap:12px; align-items:start; background:#fff; border:1px solid var(--line); border-radius:14px; padding:14px; }
    .num { width:34px; height:34px; border-radius:50%; background:#183153; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; }
    .decision-step h3 { margin:0 0 4px; font-size:16px; color:#183153; }
    .decision-step p { margin:0; color:#475569; font-size:14px; }

    .pill-list { display:flex; flex-wrap:wrap; gap:8px; padding:0; margin:0; list-style:none; }
    .pill-list li { background:#f8fafc; border:1px solid var(--line); padding:8px 10px; border-radius:999px; font-size:13px; color:#334155; }

    .risk-low { color:#166534; font-weight:700; }
    .risk-mid { color:#b45309; font-weight:700; }
    .risk-high { color:#b91c1c; font-weight:700; }

    .footer { color:#64748b; font-size:13px; text-align:center; padding:30px 0 10px; }
    .hidden-by-search { display:none !important; }
    .no-results { display:none; background:#fff; border:1px dashed var(--line); border-radius:14px; padding:20px; color:#64748b; margin:20px 0; }

    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { position:relative; height:auto; }
      .hero, .toolbar, .content { padding-left: 22px; padding-right: 22px; }
      .hero-grid, .grid.cols-4, .grid.cols-3, .grid.cols-2 { grid-template-columns: 1fr; }
      .toolbar { grid-template-columns: 1fr; }
    }

    @media print {
      .sidebar, .toolbar { display:none; }
      .layout { display:block; }
      body { background:#fff; }
      .hero { background:#fff; color:#111827; padding:20px 0; }
      .hero p, .hero-card span { color:#334155; }
      .hero-card { border:1px solid #ddd; background:#fff; }
      .content { padding:0; }
      .panel, .card { box-shadow:none; break-inside: avoid; }
      a { text-decoration:none; }
    }
  
    /* 上部タブ(common_top_tabs, position:fixed 48px)との結合用 */
    body{ padding-top:48px; }
    .sidebar{ top:48px !important; height:calc(100vh - 48px) !important; }
  </style>
</head>
<body>
<?!= include('common_top_tabs', { appUrl: appUrl, currentPage: currentPage }); ?>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <small>LEGAL KNOWLEDGE BOOK</small>
        <h1>法務ナレッジブック</h1>
        <span class="version">v0.3 / 著作権法基礎追加版</span>
      </div>
      <a class="sidebar-home" href="<?= appUrl ?>?page=portal" target="_top">← 法務ポータルへ戻る</a>
      <nav class="nav">
        <div class="nav-group-title">全体</div>
        <a href="#purpose">目的と使い方</a>
        <a href="#map">契約類型マップ</a>
        <a href="#selection">契約選択フロー</a>
        <div class="nav-group-title">基礎知識</div>
        <a href="#civil-contracts">民法上の13典型契約</a>
        <a href="#commercial-contracts">商法上の商事契約</a>
        <a href="#atypical-license">非典型契約・ライセンス</a>
        <a href="#copyright-rights">著作権法の権利一覧</a>
        <a href="#ukeoi-inin">請負・委任／準委任</a>
        <div class="nav-group-title">実務重点</div>
        <a href="#practical-contracts">実務契約類型</a>
        <a href="#components">契約の構成要素</a>
        <a href="#component-matrix">構成要素マトリクス</a>
        <a href="#clause-library">条項ライブラリ</a>
        <div class="nav-group-title">運用</div>
        <a href="#laws">法令・リスクマップ</a>
        <a href="#workflow">標準業務フロー</a>
        <a href="#checklists">チェックリスト</a>
        <a href="#templates">テンプレート管理</a>
        <a href="#references">参考法令</a>
      </nav>
    </aside>

    <main>
      <header class="hero">
        <h2>契約・取引審査・文書管理の実務基準</h2>
        <p>本ページは、社内で反復利用する法務判断を共通化するためのナレッジブックです。特に、民法上の13典型契約、商法上の商事契約、非典型契約としてのライセンス契約、著作権法上の権利一覧を基礎知識として整理したうえで、実務契約の構成要素を標準化し、申請フォーム・文書番号・台帳・CloudSign・Google Drive保管と接続することを目的とします。</p>
        <div class="hero-grid">
          <div class="hero-card"><strong>基礎契約類型</strong><span>民法13典型契約、商法上の商事契約、非典型契約の位置づけ</span></div>
          <div class="hero-card"><strong>構成要素</strong><span>請負・委任／準委任、ライセンス、著作権処理、売買等の成立要素と条項構造</span></div>
          <div class="hero-card"><strong>法令リスク</strong><span>取適法、フリーランス法、独禁法、景表法、個人情報、現地法等</span></div>
          <div class="hero-card"><strong>業務接続</strong><span>取引申請、文書作成、押印、検収、支払通知、更新管理</span></div>
        </div>
      </header>

      <div class="toolbar">
        <div class="searchbox"><input id="searchInput" type="search" placeholder="キーワード検索：例）請負、準委任、著作権、著作者人格権、翻案権、二次的著作物、利用許諾、再許諾" /></div>
        <div class="meta">最終更新：2026-06-01｜管理：法務担当</div>
      </div>

      <div class="content" id="contentRoot">
        <div class="no-results" id="noResults">該当する項目が見つかりません。検索語を短くするか、契約類型・法令名・文書名で検索してください。</div>

        <section id="purpose" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>1. 目的と使い方</h2>
              <p>このナレッジブックは、法務判断を属人化させず、各部署が同じ前提で契約・取引・文書管理を進めるための社内基準です。</p>
            </div>
          </div>
          <div class="panel">
            <div class="grid cols-3">
              <div class="card knowledge-card">
                <h3>判断基準の共通化</h3>
                <p>契約レビュー時に、どの論点を、どの順序で、どの深度で確認するかを明確にします。</p>
                <div class="tag-row"><span class="tag ops">レビュー</span><span class="tag ops">一次確認</span></div>
              </div>
              <div class="card knowledge-card">
                <h3>契約構成の標準化</h3>
                <p>基本契約、個別契約、発注書、仕様書、覚書、別紙を使い分け、過不足のない文書構成にします。</p>
                <div class="tag-row"><span class="tag type">典型契約</span><span class="tag type">条項設計</span></div>
              </div>
              <div class="card knowledge-card">
                <h3>業務効率化</h3>
                <p>契約番号・発注番号・検収番号・支払通知番号を連携させ、申請から保管までの追跡性を確保します。</p>
                <div class="tag-row"><span class="tag ops">文書番号</span><span class="tag ops">台帳</span></div>
              </div>
            </div>
            <div class="callout good"><strong>運用原則：</strong>契約書は「全文を毎回読む」だけでなく、「契約類型を選び、必要な構成要素を確認し、法令リスクを重ねる」形でレビューします。</div>
          </div>
        </section>

        <section id="map" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>2. 契約類型マップ</h2>
              <p>取引内容に応じて、使用する文書を選択します。迷う場合は、まず「何を渡すのか」「何をしてもらうのか」「どの権利を使わせるのか」を確認します。</p>
            </div>
          </div>
          <div class="panel">
            <table class="knowledge-card">
              <thead>
                <tr><th>取引・場面</th><th>主文書</th><th>補助文書</th><th>重点論点</th><th>法務確認目安</th></tr>
              </thead>
              <tbody>
                <tr><td>交渉前の情報開示</td><td>NDA</td><td>目的確認メモ</td><td>秘密情報、目的外利用、グループ共有、返還・廃棄</td><td><span class="risk-mid">通常</span></td></tr>
                <tr><td>外部者への業務発注</td><td>業務委託基本契約＋発注書</td><td>仕様書、検収書、支払通知書</td><td>業務範囲、納期、検収、支払、権利帰属、偽装請負</td><td><span class="risk-high">重点</span></td></tr>
                <tr><td>単発・軽量な業務発注</td><td>発注書</td><td>仕様書、特約条項</td><td>取適法・フリーランス法、支払期日、成果物権利</td><td><span class="risk-mid">通常</span></td></tr>
                <tr><td>商品・物品の継続売買</td><td>売買基本契約</td><td>注文書、納品書、検収書</td><td>所有権移転、危険負担、品質保証、返品、支払</td><td><span class="risk-mid">通常</span></td></tr>
                <tr><td>原作品・ゲーム・IPの利用</td><td>ライセンス基本契約</td><td>個別利用許諾条件書、追加作品合意書</td><td>許諾範囲、地域、言語、再許諾、ロイヤリティ、在庫販売</td><td><span class="risk-high">重点</span></td></tr>
                <tr><td>出版・電子・翻訳利用</td><td>出版契約</td><td>個別条件書、商品化許諾条件書</td><td>出版権、二次利用、電子化、翻訳、印税、監修</td><td><span class="risk-high">重点</span></td></tr>
                <tr><td>商品化・映像化・デジタルゲーム化</td><td>個別許諾契約／商品化契約</td><td>別紙仕様、承認フロー</td><td>通常許諾からの除外、個別許諾、監修、収益配分</td><td><span class="risk-high">重点</span></td></tr>
                <tr><td>既存契約の変更・補足</td><td>覚書</td><td>変更対照表、別紙</td><td>変更範囲、優先順位、過去合意統合、清算</td><td><span class="risk-mid">通常〜重点</span></td></tr>
                <tr><td>契約終了・在庫整理</td><td>解除合意書／終了覚書</td><td>在庫一覧、支払一覧</td><td>終了日、残存義務、在庫販売、未払金、素材返還</td><td><span class="risk-high">重点</span></td></tr>
                <tr><td>海外企業・海外個人との取引</td><td>英文契約／英文発注書</td><td>現地法調査シート、税務確認シート</td><td>準拠法、現地強行法規、源泉税、租税条約、制裁、個人情報</td><td><span class="risk-high">重点</span></td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="selection" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>3. 契約選択フロー</h2>
              <p>文書選択を誤ると、契約書本文よりも運用上の不整合が起きます。以下の順で選択します。</p>
            </div>
          </div>
          <div class="panel decision-tree">
            <div class="decision-step knowledge-card"><div class="num">1</div><div><h3>秘密情報だけを渡すか</h3><p>検討・交渉段階で情報開示が中心ならNDA。個人情報や未公表IP資料を含む場合は、目的・管理方法・返還廃棄を厚くします。</p></div></div>
            <div class="decision-step knowledge-card"><div class="num">2</div><div><h3>相手に作業・制作・運営を依頼するか</h3><p>作業依頼なら業務委託基本契約または発注書。成果物がある場合は仕様書、検収、権利帰属、修正対応を必須項目にします。</p></div></div>
            <div class="decision-step knowledge-card"><div class="num">3</div><div><h3>当社または相手方のIPを使うか</h3><p>原作品、ゲーム、ロゴ、キャラクター、翻訳物、二次著作物を使う場合はライセンス契約・個別利用許諾条件書を検討します。</p></div></div>
            <div class="decision-step knowledge-card"><div class="num">4</div><div><h3>商品を売買・供給するだけか</h3><p>物品の供給が中心なら売買契約。ただし、製造委託・ライセンス・品質監修・ローカライズが混在する場合は複合契約にします。</p></div></div>
            <div class="decision-step knowledge-card"><div class="num">5</div><div><h3>既存契約を変えるだけか</h3><p>既存契約の一部変更、対象作品追加、過去合意の統合、清算であれば覚書・追加作品合意書・解除合意書で処理します。</p></div></div>
          </div>
        </section>


        <section id="civil-contracts" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>4. 民法上の13典型契約</h2>
              <p>民法に規定された典型契約（有名契約）は、契約書に明示されていない事項を補充する基礎ルールとして機能します。実務契約は、まず民法上どの契約に近いかを確認し、そのうえで不足する条項を設計します。</p>
            </div>
          </div>
          <div class="panel">
            <div class="callout good"><strong>基礎ルール：</strong>「業務委託契約」「ライセンス契約」「NDA」などの実務名は、民法上の典型契約名とは限りません。実務名ではなく、契約の中身（財産を移転するのか、物を使わせるのか、仕事の完成を求めるのか、事務処理を委託するのか）から法的性質を判断します。</div>
            <table class="knowledge-card">
              <thead>
                <tr><th>類型</th><th>条文目安</th><th>法律上の中核</th><th>実務上の例</th><th>契約構成で見るポイント</th></tr>
              </thead>
              <tbody>
                <tr><td>贈与</td><td>民法549条</td><td>一方が無償で財産を相手方に与える。</td><td>無償提供、協賛品提供、寄付的提供</td><td>無償性、撤回可否、目的外利用、税務処理。</td></tr>
                <tr><td>売買</td><td>民法555条</td><td>財産権の移転と代金支払の交換。</td><td>商品の仕入・卸売、在庫販売、物品供給</td><td>目的物、代金、所有権移転、危険負担、検査、契約不適合。</td></tr>
                <tr><td>交換</td><td>民法586条</td><td>金銭以外の財産権を相互に移転する。</td><td>物々交換、権利交換、相互提供</td><td>交換対象の特定、評価額、差額精算、権利保証。</td></tr>
                <tr><td>消費貸借</td><td>民法587条</td><td>借主が同種・同等・同量の物を返還する。</td><td>金銭貸付、立替金の貸付整理</td><td>貸付額、利息、返済期限、期限の利益、遅延損害金。</td></tr>
                <tr><td>使用貸借</td><td>民法593条</td><td>無償で物を使用収益させ、返還させる。</td><td>サンプル・機材・備品の無償貸与</td><td>無償性、使用目的、返還時期、破損・紛失、転貸禁止。</td></tr>
                <tr><td>賃貸借</td><td>民法601条</td><td>有償で物を使用収益させる。</td><td>会場利用、倉庫、機材レンタル</td><td>賃料、期間、使用目的、原状回復、修繕、解約。</td></tr>
                <tr><td>雇用</td><td>民法623条</td><td>労働に従事し、相手方が報酬を支払う。</td><td>従業員、アルバイト</td><td>労務管理・指揮命令が中心。業務委託・請負との混同に注意。</td></tr>
                <tr><td>請負</td><td>民法632条</td><td>仕事の完成と、その結果に対する報酬支払。</td><td>イラスト制作、DTP、動画制作、ウェブ制作、内装工事</td><td>完成基準、成果物、納品、検収、契約不適合、修正範囲。</td></tr>
                <tr><td>委任</td><td>民法643条</td><td>法律行為をすることを委託し、相手方が承諾する。</td><td>契約締結代理、申請代理、法律行為の代行</td><td>委任事務、代理権の有無、善管注意義務、報告、解除。</td></tr>
                <tr><td>寄託</td><td>民法657条</td><td>物を預かり、保管する。</td><td>在庫保管、サンプル保管、イベント備品預かり</td><td>保管対象、保管方法、返還、滅失・毀損、費用負担。</td></tr>
                <tr><td>組合</td><td>民法667条</td><td>各当事者が出資して共同事業を営む。</td><td>共同企画、共同事業、収益分配プロジェクト</td><td>出資、業務執行、損益分配、脱退、財産帰属、代表権。</td></tr>
                <tr><td>終身定期金</td><td>民法689条</td><td>一方または第三者の終身まで定期に金銭等を給付する。</td><td>企業実務では稀</td><td>期間、給付内容、終了事由。通常の取引契約ではほぼ使わない。</td></tr>
                <tr><td>和解</td><td>民法695条</td><td>互いに譲歩して争いをやめる。</td><td>紛争解決合意、清算合意、解除合意</td><td>紛争対象、譲歩内容、支払、免責、清算条項、秘密保持。</td></tr>
              </tbody>
            </table>
            <div class="callout warn"><strong>実務メモ：</strong>「業務委託」は民法上の典型契約名ではなく、内容により請負・委任・準委任、またはそれらの混合契約として扱います。レビュー時は、契約タイトルではなく、報酬発生条件と責任の内容を確認します。</div>
          </div>
        </section>

        <section id="commercial-contracts" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>5. 商法上の商事契約・営業類型</h2>
              <p>商法上の契約類型は、商人間取引・営業取引の基礎知識として把握します。実務ではすべてを頻繁に使うわけではありませんが、商取引の構成を理解する補助線になります。</p>
            </div>
          </div>
          <div class="panel">
            <div class="callout"><strong>整理方針：</strong>本ナレッジブックでは、基礎として押さえるべき5類型を中心に、商事売買・運送営業・商事寄託・保険を関連類型として補足します。</div>
            <table class="knowledge-card">
              <thead><tr><th>重点5類型</th><th>条文目安</th><th>中核</th><th>実務上の見方</th></tr></thead>
              <tbody>
                <tr><td>交互計算</td><td>商法529条以下</td><td>継続取引から生じる債権債務を一定期間ごとに相殺し、残額を支払う。</td><td>継続的な相互取引・精算の法的構成を理解するための基礎。通常の請求・支払管理とは区別する。</td></tr>
                <tr><td>匿名組合</td><td>商法535条以下</td><td>一方が営業者の営業のために出資し、その営業から生じる利益の分配を受ける。</td><td>投資・収益分配型スキームで問題になる。共同事業・ライセンス収益分配との違いを確認する。</td></tr>
                <tr><td>仲立営業</td><td>商法543条以下</td><td>他人間の商行為の媒介を業とする。</td><td>ブローカー型。原則として契約当事者にはならず、媒介報酬・権限範囲を確認する。</td></tr>
                <tr><td>問屋営業</td><td>商法551条以下</td><td>自己の名をもって、他人のために物品の販売または買入れをする。</td><td>委託販売・代理販売に近い場面で比較対象になる。誰の名で売るか、誰に権利義務が帰属するかを見る。</td></tr>
                <tr><td>運送取扱営業</td><td>商法559条以下</td><td>物品運送の取次・手配を行う営業類型。</td><td>物流・輸出入・イベント搬入で、運送人との違い、責任範囲、保険、危険移転を確認する。</td></tr>
              </tbody>
            </table>
            <details class="knowledge-card">
              <summary>関連して押さえる商法上の類型</summary>
              <div class="detail-body">
                <table>
                  <thead><tr><th>類型</th><th>位置づけ</th><th>実務メモ</th></tr></thead>
                  <tbody>
                    <tr><td>商事売買</td><td>商人間・商行為としての売買に関する特則。</td><td>民法上の売買に商事取引特有の規律が重なる。</td></tr>
                    <tr><td>運送営業</td><td>物品または旅客の運送に関する営業類型。</td><td>配送事故、滅失・毀損、遅延、保険の確認で重要。</td></tr>
                    <tr><td>商事寄託</td><td>商人が営業として物を預かる類型。</td><td>倉庫・保管委託・在庫管理で参照する。</td></tr>
                    <tr><td>保険</td><td>商法上、広義の商事契約類型として整理される。</td><td>イベント・物流・製造物事故では、契約条項と保険付保をセットで確認する。</td></tr>
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </section>

        <section id="atypical-license" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>6. 非典型契約・ライセンス契約</h2>
              <p>ライセンス契約、秘密保持契約、共同開発契約などは、民法上の13典型契約そのものではありません。契約自由の原則により有効に設計できますが、契約書内で権利義務を明確に定義する必要があります。</p>
            </div>
          </div>
          <div class="panel">
            <div class="grid cols-2">
              <div class="card knowledge-card">
                <h3>非典型契約の基本</h3>
                <p>法律に名称・成立要件が直接定められていない契約です。条文上の補充ルールが明確でないため、契約書の設計品質がそのままリスク管理になります。</p>
                <ul>
                  <li>契約の目的を明確にする。</li>
                  <li>当事者の権利義務を列挙する。</li>
                  <li>報酬・対価・費用負担を明確にする。</li>
                  <li>終了時の効果を明確にする。</li>
                  <li>民法上のどの典型契約に近いかを補助的に把握する。</li>
                </ul>
              </div>
              <div class="card knowledge-card">
                <h3>ライセンス契約の法的性質</h3>
                <p>著作権・商標・キャラクター・ゲームシステム・翻訳物等について、一定範囲で利用を許す契約です。売買のように権利を移転する場合と、利用許諾にとどめる場合を明確に区別します。</p>
                <ul>
                  <li>権利移転ではなく利用許諾か。</li>
                  <li>独占か非独占か。</li>
                  <li>再許諾・製造委託・販売委託を認めるか。</li>
                  <li>翻訳・改変・商品化を含めるか。</li>
                  <li>終了後の在庫販売を認めるか。</li>
                </ul>
              </div>
            </div>
            <table class="knowledge-card">
              <thead><tr><th>ライセンス周辺契約</th><th>概要</th><th>重点構成要素</th><th>アークライト実務での注意</th></tr></thead>
              <tbody>
                <tr><td>利用許諾契約</td><td>特定の著作物・商標・素材等の利用を許す。</td><td>許諾対象、利用方法、地域、期間、媒体、対価、終了時処理。</td><td>「何を・どこで・どの媒体で・誰に売れるか」を条件書で変数管理する。</td></tr>
                <tr><td>ライセンス基本契約</td><td>複数作品・複数商品に共通する許諾条件を定める。</td><td>共通条項、個別条件書、優先順位、報告、監査、品質管理。</td><td>個別利用許諾条件書で作品・料率・地域・言語を切り替える。</td></tr>
                <tr><td>サブライセンス契約</td><td>許諾を受けた者が第三者に再許諾する。</td><td>再許諾可否、再許諾先、地域、報告、上流契約との整合。</td><td>上流ライセンスの許諾範囲を超えないことを必ず確認する。</td></tr>
                <tr><td>商品化契約</td><td>IPを用いた商品の企画・製造・販売を許す。</td><td>対象商品、監修、品質基準、製造数、販売チャネル、ロイヤリティ。</td><td>通常の出版・ローカライズ許諾に商品化を不用意に含めない。</td></tr>
                <tr><td>ローカライズ契約</td><td>翻訳版・現地語版の制作・販売を許す。</td><td>言語、地域、翻訳物の権利、監修、販売開始期限、在庫販売。</td><td>翻訳物・DTPデータ・ローカライズ素材の帰属を明確化する。</td></tr>
                <tr><td>プロダクトアウト契約</td><td>権利許諾と商品供給が混在する契約。</td><td>License Schedule、Supply Terms、検査、危険移転、品質保証。</td><td>ライセンス許諾と売買・供給条件をScheduleで分離する。</td></tr>
              </tbody>
            </table>
            <div class="callout warn"><strong>設計上の注意：</strong>ライセンス契約では、「許諾する権利」を広く書きすぎると、商品化・映像化・デジタルゲーム化・二次利用まで含むように読めるおそれがあります。通常許諾と特別許諾を分け、特別許諾は個別条件書または別契約で制御します。</div>
          </div>
        </section>


        <section id="copyright-rights" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>7. 著作権法の基礎知識：権利の一覧</h2>
              <p>ライセンス契約、出版契約、商品化契約、発注書、仕様書、成果物譲渡条項を読むための基礎知識です。著作権は一つの単体権利ではなく、利用行為ごとに分かれる「権利の束」として把握します。</p>
            </div>
          </div>
          <div class="panel">
            <div class="callout good"><strong>実務上の基本：</strong>契約書では、「著作権を譲渡する」「利用を許諾する」とだけ書くのではなく、複製、翻訳・翻案、公衆送信、商品化、二次利用、再許諾、改変、表示の可否を分解して確認します。特に翻案権等・二次的著作物の利用権は明示的に扱います。</div>

            <div class="grid cols-2">
              <div class="card knowledge-card">
                <h3>著作者の権利の二層構造</h3>
                <p>著作者に関する権利は、大きく人格的利益を保護する著作者人格権と、財産的利益を保護する著作権（著作財産権）に分かれます。</p>
                <ul>
                  <li><strong>著作者人格権：</strong>譲渡できない。契約では不行使特約で処理する。</li>
                  <li><strong>著作権（財産権）：</strong>全部または一部の譲渡・利用許諾の対象になる。</li>
                  <li><strong>著作隣接権：</strong>実演家、レコード製作者、放送事業者、有線放送事業者に関する権利。</li>
                  <li><strong>出版権：</strong>出版者に設定される権利。出版契約・電子出版で別途確認する。</li>
                </ul>
              </div>
              <div class="card knowledge-card">
                <h3>契約レビューでの最初の確認</h3>
                <p>成果物やIPを扱う契約では、所有権・著作権・利用許諾・人格権処理を混同しないことが重要です。</p>
                <ul>
                  <li>物の所有権を取得しても、著作権を取得したとは限らない。</li>
                  <li>「買取」「納品」「検収」だけでは、著作権譲渡の合意として不十分になり得る。</li>
                  <li>翻訳・ローカライズ・改変・商品化を行う場合は、翻案権等を確認する。</li>
                  <li>二次的著作物を利用する場合は、原著作物側の許諾も確認する。</li>
                </ul>
              </div>
            </div>

            <h3>1. 著作者人格権</h3>
            <table class="knowledge-card">
              <thead><tr><th>権利</th><th>条文</th><th>内容</th><th>契約実務での確認ポイント</th></tr></thead>
              <tbody>
                <tr><td>公表権</td><td>18条</td><td>未公表の著作物を公表するか、いつ・どの方法で公表するかを決める権利。</td><td>未公表原稿、未発表イラスト、開発中ゲーム、発売前情報を扱う場合に確認する。</td></tr>
                <tr><td>氏名表示権</td><td>19条</td><td>著作者名を表示するか、実名・変名・無名のいずれにするかを決める権利。</td><td>クレジット表記、スタッフロール、商品パッケージ、Web掲載、SNS投稿で確認する。</td></tr>
                <tr><td>同一性保持権</td><td>20条</td><td>著作物または題号を、著作者の意に反して改変されない権利。</td><td>編集、校正、翻訳、ローカライズ、トリミング、色変更、DTP調整、商品化で重要。</td></tr>
              </tbody>
            </table>
            <div class="callout warn"><strong>契約処理：</strong>著作者人格権は譲渡できないため、「譲渡」ではなく、当社、当社グループ、再許諾先、販売先、委託先等に対して行使しない旨を定めます。ただし、不行使特約を広く置く場合でも、著作者の名誉・声望を害する改変まで当然に許されるわけではないため、実務上は監修・承認・改変範囲を併記します。</div>

            <h3>2. 著作権（財産権・支分権）</h3>
            <table class="knowledge-card">
              <thead><tr><th>権利</th><th>条文</th><th>対象行為</th><th>アークライト実務での例</th><th>契約上の処理</th></tr></thead>
              <tbody>
                <tr><td>複製権</td><td>21条</td><td>印刷、複写、録音、録画、データ複製など。</td><td>カード、ルールブック、パッケージ、画像データ、PDF、販促物の複製。</td><td>製造数、部数、媒体、データ保管、バックアップ利用を定める。</td></tr>
                <tr><td>上演権・演奏権</td><td>22条</td><td>著作物を公に上演・演奏する行為。</td><td>イベント、配信番組、ステージ企画、音楽利用。</td><td>イベント利用、収録、再配信、BGM利用の許諾範囲を確認する。</td></tr>
                <tr><td>上映権</td><td>22条の2</td><td>著作物をスクリーン・ディスプレイ等に公に映写する行為。</td><td>PV、映像素材、イベント会場での動画上映。</td><td>会場上映、社内上映、Web公開を分ける。</td></tr>
                <tr><td>公衆送信権・公の伝達権</td><td>23条</td><td>インターネット送信、放送、有線放送、送信可能化、受信装置による公の伝達。</td><td>公式サイト掲載、SNS投稿、EC掲載、YouTube、オンラインルール公開。</td><td>Web掲載、SNS利用、広告配信、配信期間、地域制限を定める。</td></tr>
                <tr><td>口述権</td><td>24条</td><td>言語の著作物を朗読等で公に伝達する行為。</td><td>朗読イベント、読み上げ動画、音声コンテンツ。</td><td>収録・配信・アーカイブ化の有無を確認する。</td></tr>
                <tr><td>展示権</td><td>25条</td><td>美術の著作物または未発行写真の原作品を公に展示する行為。</td><td>原画展示、イベント展示、展示会出展。</td><td>展示場所、期間、撮影可否、二次利用を定める。</td></tr>
                <tr><td>頒布権</td><td>26条</td><td>映画の著作物の複製物を販売・貸与等により頒布する行為。</td><td>映像作品、映画素材、映像化案件。</td><td>映像化・動画コンテンツは別許諾として扱う。</td></tr>
                <tr><td>譲渡権</td><td>26条の2</td><td>映画以外の著作物の原作品・複製物を公衆に譲渡する行為。</td><td>書籍、ゲーム商品、カード、販促物の販売。</td><td>販売地域、販売チャネル、在庫販売、サンプル配布を確認する。</td></tr>
                <tr><td>貸与権</td><td>26条の3</td><td>映画以外の著作物の複製物を公衆に貸与する行為。</td><td>レンタル、貸出、体験用貸与、イベント用貸与。</td><td>販売ではなく貸与・レンタルがある場合に追加確認する。</td></tr>
                <tr><td>翻訳権・翻案権等</td><td>27条</td><td>翻訳、編曲、変形、脚色、映画化、その他翻案により二次的著作物を創作する行為。</td><td>ローカライズ、翻訳版、拡張、キャラクター商品化、ゲーム化、映像化。</td><td><strong>必ず明示。</strong>通常利用と特別許諾を分ける。</td></tr>
                <tr><td>二次的著作物の利用に関する原著作者の権利</td><td>28条</td><td>二次的著作物の利用について、原著作者が二次的著作物の著作者と同種の権利を持つ。</td><td>翻訳版、ローカライズ版、派生ゲーム、商品化デザインの販売・配信。</td><td><strong>必ず明示。</strong>翻訳物・派生物を販売・配信する場合に確認する。</td></tr>
              </tbody>
            </table>
            <div class="callout danger"><strong>重要：</strong>著作権譲渡条項では、27条・28条の権利を譲渡対象として特掲する運用を標準にします。これを落とすと、翻訳・翻案・二次的著作物利用の権利が譲渡人側に残る方向で解釈されるリスクがあります。</div>

            <h3>3. 著作隣接権・出版権</h3>
            <table class="knowledge-card">
              <thead><tr><th>区分</th><th>権利者</th><th>主な対象</th><th>契約実務での確認ポイント</th></tr></thead>
              <tbody>
                <tr><td>実演家の権利</td><td>俳優、声優、演奏者、歌手等</td><td>実演家人格権、録音・録画、放送、有線放送、送信可能化、譲渡、貸与等。</td><td>ボイス、登壇、配信、動画収録、イベント出演では、出演契約・肖像権・パブリシティ権とセットで確認する。</td></tr>
                <tr><td>レコード製作者の権利</td><td>音源を最初に固定した者</td><td>レコードの複製、送信可能化、譲渡、貸与等。</td><td>BGM、音源、PV、配信動画に音楽を使う場合、著作権者と音源権利者の双方を確認する。</td></tr>
                <tr><td>放送事業者・有線放送事業者の権利</td><td>放送・有線放送を行う事業者</td><td>複製、再放送、有線放送、送信可能化等。</td><td>放送番組・配信素材の二次利用、切り抜き、社内外利用で確認する。</td></tr>
                <tr><td>出版権</td><td>出版者</td><td>著作物を文書・図画として出版する権利。電子出版・公衆送信を含む設計も確認。</td><td>出版契約では、紙、電子、オンデマンド、海外版、翻訳版を分けて設計する。</td></tr>
              </tbody>
            </table>

            <h3>4. 契約書に落とすときの構成要素</h3>
            <table class="knowledge-card">
              <thead><tr><th>構成要素</th><th>確認内容</th><th>条項・別紙への落とし込み</th></tr></thead>
              <tbody>
                <tr><td>対象著作物</td><td>原作品、翻訳物、イラスト、ロゴ、写真、映像、ゲームデータ、ルール、テキスト等。</td><td>別紙で作品名・素材名・ファイル名・版数・管理番号を特定する。</td></tr>
                <tr><td>権利処理の型</td><td>著作権譲渡、利用許諾、共同著作、職務著作、既存素材利用のいずれか。</td><td>「譲渡」か「許諾」かを明示し、既存素材・第三者素材を除外または個別許諾にする。</td></tr>
                <tr><td>利用範囲</td><td>媒体、地域、言語、期間、販売チャネル、販売形態、プロモーション利用。</td><td>個別条件書・発注書・仕様書の変数として管理する。</td></tr>
                <tr><td>翻訳・改変・二次利用</td><td>ローカライズ、編集、翻案、商品化、映像化、デジタルゲーム化、派生作品化。</td><td>通常利用と特別許諾を分け、27条・28条を明示する。</td></tr>
                <tr><td>再許諾・委託先利用</td><td>グループ会社、製造委託先、販売先、翻訳者、デザイナー、海外パートナー。</td><td>再許諾の可否、範囲、再許諾先管理、上流契約との整合を定める。</td></tr>
                <tr><td>人格権処理</td><td>公表、氏名表示、改変、監修、クレジット。</td><td>人格権不行使条項、クレジット表記、監修承認、改変範囲を定める。</td></tr>
                <tr><td>対価</td><td>固定報酬、ロイヤリティ、MG、追加報酬、二次利用料。</td><td>支払条件、報告頻度、計算式、控除項目、監査権を定める。</td></tr>
                <tr><td>終了時処理</td><td>在庫販売、データ廃棄、素材返還、Web掲載停止、販売終了後の記録保存。</td><td>Sell-off、販売停止、廃棄証明、報告義務を定める。</td></tr>
              </tbody>
            </table>

            <h3>5. 実務類型別の著作権チェック</h3>
            <table class="knowledge-card">
              <thead><tr><th>実務類型</th><th>主な権利論点</th><th>標準対応</th></tr></thead>
              <tbody>
                <tr><td>イラスト制作・デザイン制作</td><td>複製、譲渡、公衆送信、改変、商品化、人格権。</td><td>成果物の著作権譲渡または広範な利用許諾、人格権不行使、既存素材除外を明記。</td></tr>
                <tr><td>記事執筆・編集・校正</td><td>複製、公衆送信、改変、氏名表示、二次利用。</td><td>Web掲載、紙面掲載、転載、再編集、クレジット表記を定める。</td></tr>
                <tr><td>翻訳・ローカライズ</td><td>翻案権、二次的著作物、原著作物の許諾、翻訳物の帰属。</td><td>上流権利の許諾範囲を確認し、翻訳物・DTPデータの帰属を明示。</td></tr>
                <tr><td>アナログゲーム制作</td><td>ルール、テキスト、アート、図版、パッケージ、ロゴ、派生物。</td><td>素材ごとに権利者を分解し、商品化・拡張・再版・海外版の可否を管理。</td></tr>
                <tr><td>動画・写真・イベント撮影</td><td>著作権、実演家の権利、肖像権、会場・第三者素材。</td><td>撮影範囲、使用範囲、公開媒体、出演者同意、許可外素材の不使用を定める。</td></tr>
                <tr><td>インフルエンサー投稿</td><td>投稿コンテンツの著作権、広告利用、二次利用、ステマ表示。</td><td>投稿の保存・転載・広告利用・修正依頼・削除条件を定める。</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="ukeoi-inin" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>8. 請負・委任／準委任の契約上の構成要件</h2>
              <p>業務委託契約の多くは、民法上は請負・委任・準委任、またはその混合契約として整理します。特に、報酬発生条件、成果物責任、検収、指揮命令の有無を確認します。</p>
            </div>
          </div>
          <div class="panel">
            <div class="callout good"><strong>最初の分岐：</strong>「完成した成果物に対して支払う」なら請負寄り、「専門的な事務処理・助言・運営プロセスに対して支払う」なら準委任寄り、「法律行為そのものを委託する」なら委任です。</div>
            <table class="knowledge-card">
              <thead><tr><th>類型</th><th>成立・構成要件</th><th>債務の中心</th><th>報酬発生の考え方</th><th>契約書で必ず定める事項</th></tr></thead>
              <tbody>
                <tr><td>請負</td><td>①請負人が仕事を完成することを約する。②注文者が仕事の結果に対して報酬を支払うことを約する。</td><td>仕事の完成・成果物の完成責任。</td><td>原則として、完成した仕事の結果に対する報酬。検収・納品と連動させやすい。</td><td>成果物、完成基準、納期、納品方法、検収、契約不適合、修正対応、知財帰属。</td></tr>
                <tr><td>委任</td><td>①法律行為をすることを相手方に委託する。②相手方がこれを承諾する。</td><td>法律行為の遂行。受任者は善管注意義務を負う。</td><td>報酬は当然には発生せず、報酬特約により定める。</td><td>委任事務、代理権の有無、報告義務、費用償還、報酬、解除、成果物・記録の引渡し。</td></tr>
                <tr><td>準委任</td><td>法律行為ではない事務処理の委託に、委任の規定を準用する。</td><td>事務処理の遂行。結果保証ではなく、善管注意義務に基づく履行が中心。</td><td>履行割合型または成果完成型として設計可能。成果完成型でも請負と同一ではない。</td><td>業務範囲、遂行方法、報告、成果定義、報酬算定、途中終了時の精算、指示権限の限定。</td></tr>
              </tbody>
            </table>
            <div class="grid cols-2">
              <div class="card knowledge-card">
                <h3>請負契約で厚くする条項</h3>
                <ul>
                  <li><strong>仕事の完成基準：</strong>完成とは何か、どの仕様を満たせばよいか。</li>
                  <li><strong>成果物の特定：</strong>ファイル形式、数量、納品場所、納品方法。</li>
                  <li><strong>検収：</strong>検収期間、不合格時の修補、再検収、みなし検収。</li>
                  <li><strong>契約不適合：</strong>修補、代替物、減額、損害賠償、期間制限。</li>
                  <li><strong>知財：</strong>著作権譲渡か利用許諾か、移転時期、人格権不行使。</li>
                </ul>
              </div>
              <div class="card knowledge-card">
                <h3>委任・準委任で厚くする条項</h3>
                <ul>
                  <li><strong>事務処理の範囲：</strong>何を行い、何は行わないか。</li>
                  <li><strong>善管注意義務：</strong>専門性・役割に応じた注意義務。</li>
                  <li><strong>報告義務：</strong>進捗報告、成果報告、記録提出。</li>
                  <li><strong>報酬算定：</strong>月額、時間、マイルストーン、履行割合、成果完成型。</li>
                  <li><strong>途中終了時精算：</strong>既履行部分、費用、未了タスクの扱い。</li>
                </ul>
              </div>
            </div>
            <details class="knowledge-card">
              <summary>請負・準委任の判断表</summary>
              <div class="detail-body">
                <table>
                  <thead><tr><th>判断項目</th><th>請負寄り</th><th>準委任寄り</th><th>契約書上の処理</th></tr></thead>
                  <tbody>
                    <tr><td>目的</td><td>成果物・完成物を得る。</td><td>専門的な作業・運営・助言を受ける。</td><td>目的条項と業務内容で明確にする。</td></tr>
                    <tr><td>報酬</td><td>完成・検収後に支払う。</td><td>期間・作業・履行割合・成果定義に応じて支払う。</td><td>支払起算点を曖昧にしない。</td></tr>
                    <tr><td>責任</td><td>完成責任・契約不適合責任が中心。</td><td>善管注意義務違反が中心。</td><td>修補責任と損害賠償の範囲を分ける。</td></tr>
                    <tr><td>検収</td><td>必須。合格・不合格の判断基準が重要。</td><td>成果完成型では設定可能。履行割合型では報告確認が中心。</td><td>検収なのか、報告受領なのかを区別する。</td></tr>
                    <tr><td>指示</td><td>仕様・品質・納期に関する指示。</td><td>目的・前提・必要情報の提示。</td><td>労務管理・勤務時間管理・人事評価指示は避ける。</td></tr>
                  </tbody>
                </table>
              </div>
            </details>
            <div class="callout danger"><strong>偽装請負回避：</strong>契約書上「請負」「準委任」と書いても、実態として発注者が作業者の勤怠・配置・作業手順を直接管理している場合はリスクが残ります。契約条項だけでなく、運用上の指示ルートも設計します。</div>
          </div>
        </section>

        <section id="practical-contracts" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>9. 実務契約類型</h2>
              <p>社内で反復利用する実務上の契約類型です。民法上の典型契約とは区別し、使用場面・文書構成・必須項目・注意点をセットで確認します。</p>
            </div>
          </div>
          <div class="grid cols-2">
            <article class="card knowledge-card">
              <h3>秘密保持契約書（NDA）</h3>
              <div class="tag-row"><span class="tag type">NDA</span><span class="tag risk">交渉前</span><span class="tag ops">情報管理</span></div>
              <p><strong>使用場面：</strong>契約交渉、共同開発検討、ライセンス検討、未公表情報・企画資料の開示。</p>
              <ul>
                <li><strong>基本構成：</strong>目的、秘密情報、除外情報、利用制限、管理義務、第三者開示、返還・廃棄、期間。</li>
                <li><strong>重点：</strong>当社グループ共有、外部専門家共有、目的外利用禁止、成果物への流用禁止。</li>
                <li><strong>注意：</strong>個人情報を含む場合は、秘密保持だけでなく個人情報条項を追加する。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>業務委託基本契約書</h3>
              <div class="tag-row"><span class="tag type">業務委託</span><span class="tag law">取適法</span><span class="tag law">フリーランス法</span><span class="tag high">重点</span></div>
              <p><strong>使用場面：</strong>継続的な制作、編集、DTP、イベント運営、翻訳、デザイン、記事制作、テストプレイ等。</p>
              <ul>
                <li><strong>基本構成：</strong>基本契約＋個別発注書＋仕様書＋検収書＋支払通知書。</li>
                <li><strong>重点：</strong>業務範囲、納期、成果物、検収、支払、知財、再委託、偽装請負回避。</li>
                <li><strong>注意：</strong>労務管理指示を避け、業務目的・成果物・品質基準に関する指示に限定する。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>発注書・仕様書</h3>
              <div class="tag-row"><span class="tag type">発注書</span><span class="tag ops">仕様書</span><span class="tag law">支払条件</span></div>
              <p><strong>使用場面：</strong>個別業務の発注、単発業務、基本契約に基づく個別条件の確定。</p>
              <ul>
                <li><strong>基本構成：</strong>発注番号、相手方、業務内容、納期、報酬、支払日、成果物、権利帰属、特約。</li>
                <li><strong>重点：</strong>業務内容を抽象化しすぎず、仕様書で「何を納品するか」を明確にする。</li>
                <li><strong>注意：</strong>発注書のみの場合は、契約不適合、権利、秘密保持、個人情報、支払条件を必要に応じて補う。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>検収書・業務完了報告受領書</h3>
              <div class="tag-row"><span class="tag ops">検収</span><span class="tag ops">支払通知</span><span class="tag law">取適法</span></div>
              <p><strong>使用場面：</strong>成果物納品後、業務完了後、支払確定前。</p>
              <ul>
                <li><strong>基本構成：</strong>対象発注番号、納品日、検収日、対象成果物、金額、確認依頼、担当者情報。</li>
                <li><strong>重点：</strong>検収日と支払期限を台帳上連携させる。</li>
                <li><strong>注意：</strong>検収書は契約書ではないが、支払根拠として重要な証跡になる。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>売買基本契約書</h3>
              <div class="tag-row"><span class="tag type">売買</span><span class="tag risk">品質保証</span><span class="tag ops">注文書</span></div>
              <p><strong>使用場面：</strong>物品・商品の継続的な売買、仕入、卸売、販売先との取引。</p>
              <ul>
                <li><strong>基本構成：</strong>注文、引渡し、所有権移転、危険負担、検査、契約不適合、代金支払、返品。</li>
                <li><strong>重点：</strong>製造委託が含まれるか、単なる売買かを明確に切り分ける。</li>
                <li><strong>注意：</strong>EXW等のインコタームズがある場合、危険移転と検収時期を分けて設計する。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>ライセンス基本契約書</h3>
              <div class="tag-row"><span class="tag type">ライセンス</span><span class="tag high">IP重点</span><span class="tag risk">ロイヤリティ</span></div>
              <p><strong>使用場面：</strong>原作品、ゲーム、キャラクター、翻訳版、ローカライズ版、商品化に関する権利許諾。</p>
              <ul>
                <li><strong>基本構成：</strong>許諾対象、許諾範囲、地域、言語、期間、独占性、再許諾、報告、監査、終了後処理。</li>
                <li><strong>重点：</strong>商品化・映像化・デジタルゲーム化は通常の個別条件書から除外し、別許諾で制御する。</li>
                <li><strong>注意：</strong>翻訳物・ローカライズ素材・派生物の権利帰属を曖昧にしない。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>個別利用許諾条件書</h3>
              <div class="tag-row"><span class="tag type">条件書</span><span class="tag ops">変数管理</span><span class="tag risk">許諾範囲</span></div>
              <p><strong>使用場面：</strong>基本契約に基づき、作品・商品・地域・料率等を個別に指定する場合。</p>
              <ul>
                <li><strong>基本構成：</strong>原著作名、対象製品、地域、言語、期間、販売チャネル、料率、MG、報告条件。</li>
                <li><strong>重点：</strong>基本契約と個別条件書の優先順位を明確にする。</li>
                <li><strong>注意：</strong>再許諾先、海外プロダクトアウト、適用金銭条件を表形式で管理する。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>出版契約書</h3>
              <div class="tag-row"><span class="tag type">出版</span><span class="tag risk">二次利用</span><span class="tag high">権利範囲</span></div>
              <p><strong>使用場面：</strong>書籍、電子書籍、翻訳出版、原作利用、著作者との出版取引。</p>
              <ul>
                <li><strong>基本構成：</strong>出版対象、媒体、部数、印税、電子化、翻訳、監修、二次利用、契約期間。</li>
                <li><strong>重点：</strong>通常出版と商品化・映像化・ゲーム化を分ける。</li>
                <li><strong>注意：</strong>旧契約・口頭合意・メール合意を包括統合する場合は、覚書で別途処理する。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>追加作品合意書</h3>
              <div class="tag-row"><span class="tag type">追加合意</span><span class="tag risk">作品追加</span><span class="tag ops">基本契約連動</span></div>
              <p><strong>使用場面：</strong>既存の基本契約に新たな作品・商品を追加する場合。</p>
              <ul>
                <li><strong>基本構成：</strong>原契約、追加作品、許諾範囲、経済条件、適用開始日、優先順位。</li>
                <li><strong>重点：</strong>基本契約のどの条項に基づく追加かを明示する。</li>
                <li><strong>注意：</strong>追加作品だけでなく、最低保証額・独占性・地域も再確認する。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>覚書・変更合意書</h3>
              <div class="tag-row"><span class="tag type">覚書</span><span class="tag risk">変更</span><span class="tag risk">過去合意</span></div>
              <p><strong>使用場面：</strong>契約条件変更、過去取引の整理、口頭・メール合意の統合、清算、権利範囲の補正。</p>
              <ul>
                <li><strong>基本構成：</strong>原契約、変更条項、追加条項、適用開始日、清算、優先順位、その他条項の維持。</li>
                <li><strong>重点：</strong>変更対象を限定し、原契約全体を不用意に改変しない。</li>
                <li><strong>注意：</strong>過去分の支払は、遅延損害金・調整金・追加対価の法的性質を整理する。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>解除合意書・終了覚書</h3>
              <div class="tag-row"><span class="tag type">終了</span><span class="tag risk">在庫販売</span><span class="tag high">残存義務</span></div>
              <p><strong>使用場面：</strong>契約終了、途中解除、ライセンス終了後の在庫処理、未払金精算。</p>
              <ul>
                <li><strong>基本構成：</strong>終了日、終了対象、未履行債務、在庫販売、素材返還、秘密保持、権利消滅。</li>
                <li><strong>重点：</strong>終了後も残る義務と、終了により消える権利を明確に分ける。</li>
                <li><strong>注意：</strong>在庫販売を認める場合は、期間・地域・数量・報告を定める。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>誓約書</h3>
              <div class="tag-row"><span class="tag type">誓約書</span><span class="tag risk">撮影素材</span><span class="tag risk">不使用</span></div>
              <p><strong>使用場面：</strong>許可外撮影、素材不使用、秘密情報の削除、違反後の再発防止。</p>
              <ul>
                <li><strong>基本構成：</strong>事実確認、禁止事項、削除・不使用、報告義務、違反時対応、損害賠償。</li>
                <li><strong>重点：</strong>何を使用してはならないかを、別紙または本文で具体化する。</li>
                <li><strong>注意：</strong>謝罪文ではなく、将来の使用防止と証跡化を目的にする。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>個人情報取得同意書</h3>
              <div class="tag-row"><span class="tag law">個人情報</span><span class="tag ops">同意書</span><span class="tag risk">取得目的</span></div>
              <p><strong>使用場面：</strong>イベント、応募、出演、インタビュー、素材提供等で個人情報を取得する場合。</p>
              <ul>
                <li><strong>基本構成：</strong>取得者、取得項目、利用目的、第三者提供、委託、保存期間、問い合わせ先。</li>
                <li><strong>重点：</strong>取得者名称と利用目的を明確にする。</li>
                <li><strong>注意：</strong>社内共通文書として運用する場合、個別承認を不要とする運用も可能。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>インフルエンサー投稿業務委託契約</h3>
              <div class="tag-row"><span class="tag type">販促</span><span class="tag law">景表法</span><span class="tag risk">ステマ規制</span></div>
              <p><strong>使用場面：</strong>SNS投稿、レビュー記事、商品紹介、イベント告知、PR動画。</p>
              <ul>
                <li><strong>基本構成：</strong>投稿内容、公開日、媒体、表示義務、修正、削除、報酬、権利、禁止事項。</li>
                <li><strong>重点：</strong>広告・PRであることの表示、投稿前確認、禁止表現を定める。</li>
                <li><strong>注意：</strong>成果保証や不自然な表現強制は避ける。</li>
              </ul>
            </article>

            <article class="card knowledge-card">
              <h3>国際アナログゲーム契約</h3>
              <div class="tag-row"><span class="tag type">海外契約</span><span class="tag risk">Product-Out</span><span class="tag high">現地法</span></div>
              <p><strong>使用場面：</strong>海外向けローカライズ、ライセンスアウト、商品供給、製造・販売が混在する取引。</p>
              <ul>
                <li><strong>基本構成：</strong>Master Agreement、Detail Sheet、License Schedule、Product-Out Schedule、Additional Terms。</li>
                <li><strong>重点：</strong>ライセンス許諾と商品供給を分離し、適用Scheduleを明示する。</li>
                <li><strong>注意：</strong>準拠法だけでなく、現地強行法規、税務、制裁、輸出入規制を確認する。</li>
              </ul>
            </article>
          </div>
        </section>

        <section id="components" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>10. 契約の構成要素</h2>
              <p>契約書は、契約類型に応じて必要な構成要素を組み合わせます。以下は、社内標準として確認すべき構成要素です。</p>
            </div>
          </div>

          <div class="panel">
            <div class="grid cols-3">
              <div class="card knowledge-card"><h3>1. 頭書・基本条件</h3><p>契約名、文書番号、契約締結日、当事者、担当部署、契約期間、対象取引を整理します。変動項目は本文ではなく頭書・別紙で制御します。</p><div class="tag-row"><span class="tag ops">文書番号</span><span class="tag ops">基本条件</span></div></div>
              <div class="card knowledge-card"><h3>2. 前文・契約目的</h3><p>契約の背景、原契約、取引の目的、当事者の役割を簡潔に示します。覚書では、変更・補足・統合の目的を明示します。</p><div class="tag-row"><span class="tag type">前文</span><span class="tag risk">趣旨</span></div></div>
              <div class="card knowledge-card"><h3>3. 定義</h3><p>対象作品、対象商品、成果物、秘密情報、許諾地域、純売上、製造数、販売開始日等を定義します。後続条項の解釈を安定させる中心要素です。</p><div class="tag-row"><span class="tag type">定義</span><span class="tag high">解釈</span></div></div>
              <div class="card knowledge-card"><h3>4. 対象物・業務範囲</h3><p>何を売るのか、作るのか、使わせるのか、提供するのかを明確にします。曖昧な場合は仕様書・別紙で補完します。</p><div class="tag-row"><span class="tag risk">対象特定</span><span class="tag ops">仕様書</span></div></div>
              <div class="card knowledge-card"><h3>5. 権利付与・発注・履行義務</h3><p>ライセンス契約では許諾範囲、業務委託では業務遂行義務、売買では引渡義務を定めます。契約類型ごとの差が最も出る部分です。</p><div class="tag-row"><span class="tag type">中核条項</span><span class="tag high">重点</span></div></div>
              <div class="card knowledge-card"><h3>6. 金銭条件</h3><p>報酬、売買代金、ロイヤリティ、MG、実費、立替、調整金、支払期限、通貨、消費税、源泉税を整理します。</p><div class="tag-row"><span class="tag risk">支払</span><span class="tag law">税務</span></div></div>
              <div class="card knowledge-card"><h3>7. 納品・検収・報告</h3><p>納品物、納品方法、検収期間、修正対応、業務完了報告、販売報告、ロイヤリティ報告を定めます。支払条件と必ず接続します。</p><div class="tag-row"><span class="tag ops">検収</span><span class="tag ops">報告</span></div></div>
              <div class="card knowledge-card"><h3>8. 知的財産権</h3><p>著作権譲渡、利用許諾、既存素材、翻訳物、派生物、商標、ロゴ、著作者人格権不行使を整理します。</p><div class="tag-row"><span class="tag law">著作権</span><span class="tag law">商標</span></div></div>
              <div class="card knowledge-card"><h3>9. 秘密保持・個人情報</h3><p>秘密情報の管理、目的外利用禁止、第三者開示、返還・廃棄、個人情報の取得・委託・第三者提供を定めます。</p><div class="tag-row"><span class="tag law">個人情報</span><span class="tag ops">情報管理</span></div></div>
              <div class="card knowledge-card"><h3>10. 表明保証・コンプライアンス</h3><p>権利非侵害、権限、法令遵守、制裁、反贈収賄、反社会的勢力、製品安全、広告表示等を定めます。</p><div class="tag-row"><span class="tag risk">表明保証</span><span class="tag law">法令遵守</span></div></div>
              <div class="card knowledge-card"><h3>11. 責任・補償・責任制限</h3><p>損害賠償、第三者請求、権利侵害、製品不具合、間接損害、責任上限を整理します。海外契約ではindemnityを重点確認します。</p><div class="tag-row"><span class="tag high">補償</span><span class="tag risk">責任制限</span></div></div>
              <div class="card knowledge-card"><h3>12. 期間・解除・終了後処理</h3><p>契約期間、自動更新、解除事由、終了後在庫販売、未払金、素材返還、秘密保持残存、権利消滅を定めます。</p><div class="tag-row"><span class="tag risk">解除</span><span class="tag high">在庫販売</span></div></div>
              <div class="card knowledge-card"><h3>13. 優先順位・完全合意</h3><p>基本契約、個別条件書、別紙、Additional Terms、注文書の優先順位を定めます。過去合意統合では特に重要です。</p><div class="tag-row"><span class="tag risk">優先順位</span><span class="tag type">完全合意</span></div></div>
              <div class="card knowledge-card"><h3>14. 準拠法・紛争解決</h3><p>準拠法、裁判管轄、仲裁、言語、執行可能性を定めます。国際契約では、現地強行法規の確認を別途行います。</p><div class="tag-row"><span class="tag type">準拠法</span><span class="tag high">海外契約</span></div></div>
              <div class="card knowledge-card"><h3>15. 署名欄・別紙</h3><p>署名者、法人・個人の区別、印欄、CloudSign送信、別紙の組み込み、添付資料の優先順位を整理します。</p><div class="tag-row"><span class="tag ops">CloudSign</span><span class="tag ops">別紙</span></div></div>
            </div>
          </div>
        </section>

        <section id="component-matrix" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>11. 実務契約類型 × 構成要素マトリクス</h2>
              <p>契約類型ごとに、どの構成要素を厚く書くべきかを示します。</p>
            </div>
          </div>
          <div class="panel">
            <table class="knowledge-card">
              <thead>
                <tr><th>構成要素</th><th>NDA</th><th>業務委託</th><th>発注書</th><th>売買</th><th>ライセンス</th><th>出版</th><th>覚書</th><th>海外契約</th></tr>
              </thead>
              <tbody>
                <tr><td>頭書・基本条件</td><td>中</td><td>高</td><td>高</td><td>高</td><td>高</td><td>高</td><td>高</td><td>高</td></tr>
                <tr><td>目的・前文</td><td>高</td><td>中</td><td>中</td><td>低</td><td>高</td><td>高</td><td>高</td><td>高</td></tr>
                <tr><td>定義</td><td>中</td><td>中</td><td>低</td><td>中</td><td>高</td><td>高</td><td>中</td><td>高</td></tr>
                <tr><td>対象物・業務範囲</td><td>中</td><td>高</td><td>高</td><td>高</td><td>高</td><td>高</td><td>高</td><td>高</td></tr>
                <tr><td>金銭条件</td><td>低</td><td>高</td><td>高</td><td>高</td><td>高</td><td>高</td><td>中〜高</td><td>高</td></tr>
                <tr><td>納品・検収・報告</td><td>低</td><td>高</td><td>高</td><td>高</td><td>高</td><td>高</td><td>中</td><td>高</td></tr>
                <tr><td>知的財産権</td><td>中</td><td>高</td><td>高</td><td>中</td><td>最重要</td><td>最重要</td><td>高</td><td>高</td></tr>
                <tr><td>秘密保持・個人情報</td><td>最重要</td><td>高</td><td>中</td><td>中</td><td>高</td><td>高</td><td>中</td><td>高</td></tr>
                <tr><td>表明保証・法令遵守</td><td>中</td><td>高</td><td>中</td><td>高</td><td>高</td><td>高</td><td>中</td><td>最重要</td></tr>
                <tr><td>責任・補償</td><td>中</td><td>高</td><td>中</td><td>高</td><td>高</td><td>高</td><td>中</td><td>高</td></tr>
                <tr><td>解除・終了後処理</td><td>中</td><td>高</td><td>中</td><td>高</td><td>最重要</td><td>高</td><td>高</td><td>高</td></tr>
                <tr><td>優先順位・完全合意</td><td>中</td><td>高</td><td>中</td><td>中</td><td>最重要</td><td>高</td><td>最重要</td><td>最重要</td></tr>
                <tr><td>準拠法・紛争解決</td><td>中</td><td>中</td><td>低</td><td>中</td><td>高</td><td>高</td><td>中</td><td>最重要</td></tr>
              </tbody>
            </table>
            <div class="callout warn"><strong>注意：</strong>「低」は不要という意味ではありません。契約類型上、簡略化できる場合が多いという意味です。相手方・金額・海外性・個人情報・知財の有無により、重点度は変動します。</div>
          </div>
        </section>

        <section id="clause-library" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>12. 条項ライブラリの設計</h2>
              <p>各契約書に共通して使う条項を、目的・使う場面・修正許容ラインとセットで管理します。</p>
            </div>
          </div>
          <div class="panel">
            <details class="knowledge-card" open>
              <summary>知的財産条項</summary>
              <div class="detail-body">
                <table>
                  <thead><tr><th>条項</th><th>使う場面</th><th>確認ポイント</th></tr></thead>
                  <tbody>
                    <tr><td>著作権譲渡</td><td>成果物制作、イラスト、DTP、記事、仕様書</td><td>支払完了時移転か、納品時移転か。既存素材は除外するか。</td></tr>
                    <tr><td>利用許諾</td><td>成果物を譲渡しない場合、ライセンス取引</td><td>期間、地域、媒体、再許諾、改変、独占性を明示。</td></tr>
                    <tr><td>著作者人格権不行使</td><td>編集・翻訳・改変・商品化</td><td>不行使の相手方範囲にグループ会社・再許諾先を含めるか。</td></tr>
                    <tr><td>第三者権利非侵害</td><td>制作物、投稿、デザイン、商品化</td><td>素材の出所、AI利用、フリー素材、フォント、写真の権利確認。</td></tr>
                  </tbody>
                </table>
              </div>
            </details>
            <details class="knowledge-card">
              <summary>支払・税務条項</summary>
              <div class="detail-body">
                <table>
                  <thead><tr><th>条項</th><th>使う場面</th><th>確認ポイント</th></tr></thead>
                  <tbody>
                    <tr><td>支払条件</td><td>発注書、業務委託、売買、ライセンス</td><td>支払起算点、支払日、請求書要否、検収連動、60日制限。</td></tr>
                    <tr><td>源泉徴収</td><td>個人、印税、講演、原稿、翻訳、海外個人</td><td>国内源泉所得、租税条約、税率、グロスアップの有無。</td></tr>
                    <tr><td>消費税・VAT</td><td>国内外取引、役務提供、ライセンス</td><td>課税・非課税・不課税、インボイス番号、国外事業者。</td></tr>
                    <tr><td>ロイヤリティ報告</td><td>ライセンス、出版、商品化</td><td>計算式、控除項目、報告頻度、監査、為替レート。</td></tr>
                  </tbody>
                </table>
              </div>
            </details>
            <details class="knowledge-card">
              <summary>終了後処理条項</summary>
              <div class="detail-body">
                <table>
                  <thead><tr><th>条項</th><th>使う場面</th><th>確認ポイント</th></tr></thead>
                  <tbody>
                    <tr><td>在庫販売</td><td>ライセンス終了、商品供給終了</td><td>期間、対象在庫、地域、報告、追加製造禁止。</td></tr>
                    <tr><td>秘密情報返還・廃棄</td><td>NDA、業務委託、ライセンス</td><td>複製物、バックアップ、法令保存、証跡報告。</td></tr>
                    <tr><td>素材・データ返還</td><td>制作委託、翻訳、DTP、撮影</td><td>原データ、編集データ、素材データ、第三者素材を区別。</td></tr>
                    <tr><td>残存条項</td><td>全契約</td><td>秘密保持、支払、知財、損害賠償、紛争解決、監査。</td></tr>
                  </tbody>
                </table>
              </div>
            </details>
            <details class="knowledge-card">
              <summary>国際契約条項</summary>
              <div class="detail-body">
                <table>
                  <thead><tr><th>条項</th><th>使う場面</th><th>確認ポイント</th></tr></thead>
                  <tbody>
                    <tr><td>準拠法</td><td>海外企業・海外個人</td><td>日本法、相手国法、第三国法。強行法規は別途確認。</td></tr>
                    <tr><td>紛争解決</td><td>海外契約</td><td>東京地裁、東京仲裁、ICC/JCAA、執行可能性、言語。</td></tr>
                    <tr><td>制裁・輸出管理</td><td>海外販売、海外送金、海外ライセンス</td><td>制裁対象者、輸出入規制、反贈収賄、資金決済。</td></tr>
                    <tr><td>言語優先</td><td>日英契約、翻訳契約</td><td>英文優先か、日本文優先か、参考訳か。</td></tr>
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </section>

        <section id="laws" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>13. 法令・リスクマップ</h2>
              <p>契約類型にかかわらず、以下の法令・リスクが重なる場合は確認深度を上げます。</p>
            </div>
          </div>
          <div class="panel">
            <table class="knowledge-card">
              <thead><tr><th>リスク・法令</th><th>問題になる場面</th><th>契約上の対応</th><th>社内運用</th></tr></thead>
              <tbody>
                <tr><td>取適法・フリーランス法</td><td>個人・小規模事業者への制作・役務委託</td><td>発注条件明示、支払期日、減額・キャンセル制限</td><td>発注書・検収・支払日を台帳連動</td></tr>
                <tr><td>下請法</td><td>製造委託、情報成果物作成委託、役務提供委託</td><td>支払条件、発注書、返品・減額・やり直し条件</td><td>取引類型と資本金要件を確認</td></tr>
                <tr><td>独占禁止法</td><td>販売制限、価格拘束、抱き合わせ、排他条件</td><td>販売地域・価格指定・併売制限を慎重に設計</td><td>高リスク案件は経営報告</td></tr>
                <tr><td>景表法・ステマ規制</td><td>広告、PR投稿、商品紹介、キャンペーン</td><td>表示義務、禁止表現、投稿前確認、修正・削除</td><td>事業部一次確認＋法務確認</td></tr>
                <tr><td>個人情報保護法</td><td>イベント、応募、業務委託、申請フォーム</td><td>利用目的、委託、第三者提供、安全管理</td><td>取得同意書・台帳・保存期間管理</td></tr>
                <tr><td>著作権法・商標法</td><td>作品利用、ロゴ使用、翻訳、商品化</td><td>権利範囲、表示、監修、登録表示の確認</td><td>J-PlatPat等による商標確認</td></tr>
                <tr><td>税務・源泉・租税条約</td><td>印税、海外送金、海外個人、ロイヤリティ</td><td>源泉負担、税率、租税条約、為替、消費税</td><td>経理・税務確認へエスカレーション</td></tr>
                <tr><td>現地強行法規</td><td>海外販売、海外ライセンス、海外個人委託</td><td>準拠法条項だけでなく、現地法確認を別紙化</td><td>国・地域別チェックシートを作成</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="workflow" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>14. 標準業務フロー</h2>
              <p>契約書だけで完結させず、取引申請・文書番号・押印・検収・支払通知・保管まで接続します。</p>
            </div>
          </div>
          <div class="panel">
            <div class="decision-tree">
              <div class="decision-step knowledge-card"><div class="num">1</div><div><h3>案件登録</h3><p>案件名、稟議番号、担当部署、取引目的を登録。案件IDを以後の文書に紐づける。</p></div></div>
              <div class="decision-step knowledge-card"><div class="num">2</div><div><h3>取引先確認</h3><p>取引先マスタを検索し、未登録・変更ありの場合は登録／変更申請を行う。</p></div></div>
              <div class="decision-step knowledge-card"><div class="num">3</div><div><h3>取引申請</h3><p>契約類型、金額、契約期間、海外性、個人情報、知財、支払条件を入力する。</p></div></div>
              <div class="decision-step knowledge-card"><div class="num">4</div><div><h3>法務レビュー・文書作成</h3><p>契約類型に応じて、ひな形、発注書、条件書、覚書を選択し、文書番号を発番する。</p></div></div>
              <div class="decision-step knowledge-card"><div class="num">5</div><div><h3>押印・電子署名</h3><p>CloudSign送信、署名完了、締結済ファイル保管、台帳更新を行う。</p></div></div>
              <div class="decision-step knowledge-card"><div class="num">6</div><div><h3>納品・検収・支払通知</h3><p>発注番号と検収番号を紐づけ、支払通知書を作成。支払日を管理する。</p></div></div>
              <div class="decision-step knowledge-card"><div class="num">7</div><div><h3>更新・終了管理</h3><p>契約終了日、更新期限、解除通知期限、在庫販売期間、報告期限をモニタリングする。</p></div></div>
            </div>
          </div>
        </section>

        <section id="checklists" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>15. チェックリスト</h2>
              <p>事業部の一次確認と法務レビューを分け、確認漏れを防ぎます。</p>
            </div>
          </div>
          <div class="panel">
            <div class="grid cols-2">
              <div class="card knowledge-card">
                <h3>契約レビュー共通チェック</h3>
                <ul>
                  <li>当事者は正しいか。法人・個人・海外事業者の区別はあるか。</li>
                  <li>契約類型は実態に合っているか。</li>
                  <li>対象物・業務内容・許諾範囲は特定されているか。</li>
                  <li>金銭条件、支払日、税務処理は明確か。</li>
                  <li>知的財産権と成果物の帰属は明確か。</li>
                  <li>契約終了後の処理は定められているか。</li>
                </ul>
              </div>
              <div class="card knowledge-card">
                <h3>海外契約チェック</h3>
                <ul>
                  <li>準拠法・紛争解決・言語優先は妥当か。</li>
                  <li>現地強行法規が問題にならないか。</li>
                  <li>源泉税・租税条約・VAT等の確認が必要か。</li>
                  <li>制裁・輸出管理・反贈収賄リスクはないか。</li>
                  <li>個人情報・データ移転が含まれるか。</li>
                  <li>海外個人への業務委託の場合、労務性・税務を確認したか。</li>
                </ul>
              </div>
              <div class="card knowledge-card">
                <h3>業務委託・発注チェック</h3>
                <ul>
                  <li>業務内容と成果物が仕様書で特定されているか。</li>
                  <li>納期・検収・支払日が矛盾していないか。</li>
                  <li>支払条件は取適法・フリーランス法上問題ないか。</li>
                  <li>指揮命令・労務管理に見える記載がないか。</li>
                  <li>権利譲渡・利用許諾のどちらか明確か。</li>
                  <li>再委託、個人情報、秘密情報の取扱いは適切か。</li>
                </ul>
              </div>
              <div class="card knowledge-card">
                <h3>ライセンス契約チェック</h3>
                <ul>
                  <li>許諾対象、地域、言語、媒体、期間、独占性は明確か。</li>
                  <li>再許諾・製造委託・販売委託の可否は定められているか。</li>
                  <li>ロイヤリティ計算式、控除項目、報告時期は明確か。</li>
                  <li>翻訳物・派生物の権利帰属は明確か。</li>
                  <li>商品化・映像化・デジタルゲーム化が不用意に含まれていないか。</li>
                  <li>終了後在庫販売・素材返還・販売停止が定められているか。</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="templates" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>16. テンプレート管理</h2>
              <p>テンプレートは、単なるWord/HTMLファイルではなく、入力項目・生成文書・関連台帳をセットで管理します。</p>
            </div>
          </div>
          <div class="panel">
            <table class="knowledge-card">
              <thead><tr><th>テンプレート</th><th>主な入力項目</th><th>関連台帳</th><th>関連文書</th></tr></thead>
              <tbody>
                <tr><td>NDA</td><td>相手方、目的、開示範囲、期間</td><td>契約台帳</td><td>秘密保持契約書</td></tr>
                <tr><td>業務委託基本契約</td><td>相手方、業務類型、支払条件、権利帰属</td><td>契約台帳、取引先台帳</td><td>発注書、仕様書、検収書</td></tr>
                <tr><td>発注書</td><td>発注番号、業務内容、納期、報酬、支払日</td><td>文書番号台帳、支払予定台帳</td><td>仕様書、検収書、支払通知書</td></tr>
                <tr><td>ライセンス基本契約</td><td>対象作品、地域、言語、期間、料率</td><td>契約台帳、作品台帳</td><td>個別利用許諾条件書、追加作品合意書</td></tr>
                <tr><td>個別利用許諾条件書</td><td>原著作名、対象製品、再許諾先、金銭条件</td><td>作品台帳、ライセンス台帳</td><td>報告書、利用許諾計算書</td></tr>
                <tr><td>覚書</td><td>原契約、変更内容、適用開始日、清算条件</td><td>契約台帳、版管理台帳</td><td>原契約、変更対照表、別紙</td></tr>
                <tr><td>支払通知書</td><td>対象発注番号、検収番号、支払種別、支払額、支払日</td><td>支払予定台帳、経理連携台帳</td><td>検収書、利用許諾計算書</td></tr>
              </tbody>
            </table>
            <div class="callout"><strong>テンプレート化の方針：</strong>契約本文の変数だけでなく、「どの台帳に、どの文書番号で、どの関連文書と紐づくか」までテンプレート定義に含めます。</div>
          </div>
        </section>

        <section id="next" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>17. 次回以降の拡張候補</h2>
              <p>v0.3では基礎契約類型、請負・委任／準委任、ライセンス契約、著作権法上の権利一覧と構成要素を中心にしています。次回以降、以下を追加すると実務ポータルとして完成度が上がります。</p>
            </div>
          </div>
          <div class="panel">
            <ul class="pill-list knowledge-card">
              <li>契約類型別の詳細ページ分割</li>
              <li>条文例の折りたたみ表示</li>
              <li>Google Drive上のひな形リンク接続</li>
              <li>CloudSign送信手順</li>
              <li>Slackワークフローへのリンク</li>
              <li>国別の現地法調査ページ</li>
              <li>リスクレベル別の経営報告基準</li>
              <li>改訂履歴・更新承認フロー</li>
              <li>用語集</li>
              <li>契約レビューFAQ</li>
            </ul>
          </div>
        </section>


        <section id="references" class="knowledge-section">
          <div class="section-title">
            <div>
              <h2>参考法令・確認先</h2>
              <p>法令改正があり得るため、条文番号・内容は運用時点の最新版で確認します。</p>
            </div>
          </div>
          <div class="panel">
            <ul class="knowledge-card">
              <li>民法（e-Gov法令検索）：契約総則、13典型契約、請負、委任、準委任等</li>
              <li>商法（e-Gov法令検索）：商行為、交互計算、匿名組合、仲立営業、問屋営業、運送取扱営業等</li>
              <li>著作権法（e-Gov法令検索）：著作者人格権、著作権、著作隣接権、出版権、譲渡・利用許諾</li>
              <li>著作権情報センター（CRIC）：著作者の権利、著作権Q&A、著作物利用の基礎解説</li>
              <li>商標法：ライセンス、商標使用、登録表示、権利侵害対応</li>
              <li>取適法・フリーランス法・下請法：業務委託、発注書、支払条件</li>
            </ul>
          </div>
        </section>

        <div class="footer">© Internal Legal Knowledge Book. This page is for internal operational reference and does not constitute legal advice to third parties.</div>
      </div>
    </main>
  </div>

  <script>
    const input = document.getElementById('searchInput');
    const cards = Array.from(document.querySelectorAll('.knowledge-card'));
    const sections = Array.from(document.querySelectorAll('.knowledge-section'));
    const noResults = document.getElementById('noResults');

    function normalize(text) {
      return (text || '').toLowerCase().replace(/\s+/g, '');
    }

    input.addEventListener('input', function () {
      const q = normalize(input.value);
      let visibleCount = 0;

      if (!q) {
        cards.forEach(card => card.classList.remove('hidden-by-search'));
        sections.forEach(section => section.classList.remove('hidden-by-search'));
        noResults.style.display = 'none';
        return;
      }

      cards.forEach(card => {
        const hit = normalize(card.innerText).includes(q);
        card.classList.toggle('hidden-by-search', !hit);
        if (hit) visibleCount++;
      });

      sections.forEach(section => {
        const hasVisibleCard = Array.from(section.querySelectorAll('.knowledge-card')).some(card => !card.classList.contains('hidden-by-search'));
        const sectionTitleHit = normalize(section.querySelector('.section-title')?.innerText || '').includes(q);
        section.classList.toggle('hidden-by-search', !(hasVisibleCard || sectionTitleHit));
      });

      noResults.style.display = visibleCount === 0 ? 'block' : 'none';
    });
  </script>
</body>
</html>$g_knowledge$, 'seed 0095 (from services/api/guides)', 'seed')
    RETURNING id INTO vid;
  UPDATE portal_guides
     SET current_version_id = vid, status = 'published', updated_at = now()
   WHERE id = gid;
END
$seed_knowledge$;

-- ── privacy ──────────────────────────────────────────────
DO $seed_privacy$
DECLARE gid INTEGER; vid INTEGER;
BEGIN
  SELECT id INTO gid FROM portal_guides WHERE guide_key = 'privacy';
  IF gid IS NULL THEN
    RAISE NOTICE 'skip privacy: portal_guides にメタ行なし(0094 を先に適用)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM portal_guide_versions WHERE guide_id = gid) THEN
    RETURN; -- 既に版あり。再適用しない(冪等)。
  END IF;
  INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
    VALUES (gid, 1, $g_privacy$<!DOCTYPE html><html lang="ja"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>個人情報 運用ガイド｜事業部向け</title>
<style>
:root{--navy:#1d3557;--navy-l:#2a4a6e;--red:#e63946;--red-s:#fde8ea;--gold:#c47d1a;--gold-s:#fef3e2;--green:#1d9e75;--green-s:#e4f7f1;--blue:#378add;--blue-s:#e8f1fb;--teal:#085041;--teal-s:#e1f5ee;--g1:#f8f9fa;--g2:#e9ecef;--g3:#dee2e6;--g5:#6c757d;--tx:#212529;--tx2:#495057;--sw:228px;
--ca:#27500a;--cb:#085041}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;font-size:13.5px;line-height:1.7;color:var(--tx);background:#fff}
#sidebar{position:fixed;top:0;left:0;width:var(--sw);height:100vh;background:var(--navy);overflow-y:auto;display:flex;flex-direction:column;z-index:100}
#sh{padding:16px 14px 12px;border-bottom:1px solid rgba(255,255,255,.1)}
#sh h1{font-size:9px;font-weight:700;color:rgba(255,255,255,.45);letter-spacing:.08em;text-transform:uppercase}
#sh p{font-size:11.5px;color:rgba(255,255,255,.92);font-weight:600;margin-top:3px;line-height:1.4}
nav{padding:6px 0 20px}
.ns{display:block;padding:5px 14px;font-size:9px;font-weight:700;color:rgba(255,255,255,.32);letter-spacing:.07em;text-transform:uppercase;margin-top:9px}
.nl{display:block;padding:4px 14px;font-size:11.5px;color:rgba(255,255,255,.7);text-decoration:none;border-left:2px solid transparent;transition:all .15s;line-height:1.4}
.nl:hover,.nl.active{color:#fff;background:rgba(255,255,255,.09);border-left-color:#e63946}
.nl.urg{color:#ffd9dd}
.nsub{display:block;padding:3px 14px 3px 24px;font-size:10.5px;color:rgba(255,255,255,.45);text-decoration:none;transition:color .15s}
.nsub:hover{color:rgba(255,255,255,.82)}
.bdg{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-size:10px;font-weight:700;margin-right:5px;vertical-align:middle}
.bA{background:#eaf3de;color:var(--ca)}.bB{background:var(--teal-s);color:var(--cb)}.b3{background:#faeeda;color:var(--gold)}.bR{background:var(--red-s);color:var(--red)}
#main{margin-left:var(--sw);padding:36px 46px 80px;max-width:calc(var(--sw) + 850px)}
h1.dt{font-size:21px;font-weight:700;color:var(--navy);border-bottom:3px solid var(--navy);padding-bottom:9px;margin-bottom:5px}
.dm{font-size:12px;color:var(--g5);margin-bottom:28px}
.chap{border-radius:8px;padding:16px 22px;margin:32px 0 14px;scroll-margin-top:16px}
.chap.cA{background:var(--ca)}.chap.cB{background:var(--cb)}.chap.c3{background:var(--navy)}
.chap.cR{background:var(--red)}
.chap .cn{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px}
.chap h2{font-size:16px;font-weight:700;color:#fff;margin:0;display:flex;align-items:center}
.chap .cdesc{font-size:12px;color:rgba(255,255,255,.65);margin-top:5px}
.chap .pno{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:15px;font-weight:700;margin-right:11px;flex-shrink:0}
h2.sec{font-size:16px;font-weight:700;color:var(--navy);border-left:4px solid var(--navy);padding-left:10px;margin:28px 0 11px;scroll-margin-top:20px}
h3.sub{font-size:13.5px;font-weight:700;color:var(--navy-l);margin:18px 0 9px;padding-bottom:4px;border-bottom:1px solid var(--g3);scroll-margin-top:20px}
h4.sh4{font-size:12.5px;font-weight:700;color:var(--tx2);margin:11px 0 7px}
p{margin-bottom:9px;color:var(--tx2)}strong{color:var(--tx)}
ul,ol{padding-left:20px;margin-bottom:9px;color:var(--tx2)}li{margin-bottom:3px}
.shb{border-radius:7px;padding:12px 16px;margin-bottom:14px;scroll-margin-top:16px}
.shb h3{font-size:13.5px;font-weight:700;color:#fff;margin:0}
.shb .sn{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:2px}
.sA{background:var(--ca)}.sB{background:var(--cb)}.sR{background:var(--red)}
.cl{border-left:3px solid;padding:8px 12px;border-radius:0 5px 5px 0;margin:9px 0;font-size:12.5px}
.cl-w{border-color:var(--red);background:var(--red-s)}.cl-i{border-color:var(--blue);background:var(--blue-s)}.cl-t{border-color:var(--green);background:var(--green-s)}.cl-n{border-color:var(--gold);background:var(--gold-s)}
.tw{overflow-x:auto;margin:9px 0}
table{width:100%;border-collapse:collapse;font-size:12px}
thead th{background:var(--navy);color:#fff;padding:7px 9px;text-align:left;font-weight:600;font-size:11.5px;white-space:nowrap}
tbody tr:nth-child(even){background:var(--g1)}
tbody td{padding:6px 9px;border-bottom:1px solid var(--g3);vertical-align:top;line-height:1.55}
tbody tr:hover{background:#f0f4ff}
td.tc{font-weight:600;color:var(--navy);font-size:11.5px;white-space:nowrap}
td.law{font-size:11px;color:var(--g5)}
.case-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0}
.case-card{border-radius:7px;padding:16px 18px;border:2px solid}
.case-card.A{border-color:var(--ca);background:#f4f9f0}
.case-card.B{border-color:var(--cb);background:var(--teal-s)}
.case-card h4{font-size:13px;font-weight:700;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid}
.case-card.A h4{color:var(--ca);border-color:var(--ca)}
.case-card.B h4{color:var(--cb);border-color:var(--cb)}
.case-card ul{padding-left:16px;font-size:12px;color:var(--tx2)}
.ck{list-style:none;padding:0;margin:7px 0}
.ck li{padding:7px 10px 7px 30px;position:relative;border-bottom:1px solid var(--g2);font-size:12px;color:var(--tx2)}
.ck li::before{content:"\2610";position:absolute;left:7px;font-size:13px;color:var(--navy);line-height:1.5}
.ck li:last-child{border-bottom:none}
.ck.ng li::before{content:"\2715";color:var(--red);font-weight:700}
.badge{display:inline-flex;align-items:center;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:3px}
.b-biz{background:#eaf3de;color:var(--ca)}.b-leg{background:#faeeda;color:var(--gold)}.b-au{background:var(--g2);color:#374151;border:1px solid var(--g3)}
.lg{display:inline-flex;align-items:center;font-size:11px;color:var(--tx2)}
.lg i{width:12px;height:12px;border-radius:3px;margin-right:5px;flex-shrink:0;display:inline-block}
.tag{display:inline-block;font-size:9.5px;font-weight:600;padding:1px 5px;border-radius:3px;margin-right:2px}
.t-A{background:#eaf3de;color:var(--ca)}.t-B{background:var(--teal-s);color:var(--cb)}.t-red{background:var(--red-s);color:var(--red)}.t-law{background:#e6effa;color:var(--navy)}
.flow-wrap{background:var(--g1);border:1px solid var(--g3);border-radius:6px;padding:12px 12px 9px;margin:9px 0}
.pillars{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin:14px 0}
.pillar{border:1px solid var(--g3);border-top:4px solid var(--ca);border-radius:8px;padding:12px 12px;background:#fff;position:relative}
.pillar.pe{border-top-color:var(--red)}
.pillar .pn{font-size:9px;font-weight:700;color:var(--g5);letter-spacing:.06em}
.pillar .pt{font-size:12.5px;font-weight:700;color:var(--navy);margin:3px 0 4px;line-height:1.35}
.pillar.pe .pt{color:var(--red)}
.pillar .pd{font-size:10.5px;color:var(--tx2);line-height:1.5}
.faq-item{margin-bottom:12px}
.faq-q{font-weight:700;color:var(--navy);margin-bottom:4px;font-size:13px}
.faq-a{padding:9px 13px;background:var(--g1);border-radius:4px;font-size:12.5px;color:var(--tx2);border-left:3px solid var(--g3)}
hr.sd{border:none;border-top:2px solid var(--g2);margin:30px 0}
@media (max-width:820px){.pillars{grid-template-columns:1fr 1fr}.case-grid{grid-template-columns:1fr}}
</style>

<style id="gas-portal-back-style">
.portal-back-button{position:fixed;right:16px;bottom:16px;z-index:3000;display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:999px;background:#1d3557;color:#fff;text-decoration:none;font-size:12px;font-weight:700;box-shadow:0 3px 12px rgba(0,0,0,.22);opacity:.92;transition:opacity .15s,transform .15s}
.portal-back-button:hover{opacity:1;transform:translateY(-1px)}
@media print{.portal-back-button{display:none}}
</style>

</head>
<body>
  <?!= include('common_top_tabs', { appUrl: appUrl, currentPage: currentPage }); ?>
<aside id="sidebar">
<div id="sh"><h1>法務部</h1><p>個人情報 運用ガイド<br>（事業部向け）</p></div>
<nav>
<a class="nl" href="#top">概要</a>
<a class="nl" href="#scope">このガイドの対象範囲</a>
<a class="nl" href="#what">事業部が扱う個人情報</a>
<a class="nl" href="#flow">5つの工程（全体像）</a>
<span class="ns">運用 ｜ 日々まわす5工程</span>
<a class="nl" href="#p1"><span class="bdg bA">1</span>情報の取得同意</a>
<a class="nsub" href="#p1-format">フォーマットの準備・申請</a>
<a class="nsub" href="#p1-consent">同意の取り方（Web／対面）</a>
<a class="nl" href="#p2"><span class="bdg bA">2</span>情報の取得</a>
<a class="nsub" href="#p2-get">受付・取得の手順</a>
<a class="nsub" href="#p2-ledger">台帳に記録</a>
<a class="nl" href="#p3"><span class="bdg bA">3</span>情報の保管</a>
<a class="nl" href="#p4"><span class="bdg bA">4</span>情報の利用と管理（廃棄）</a>
<a class="nsub" href="#p4-use">利用（目的の範囲内）</a>
<a class="nsub" href="#p4-manage">管理（本人請求・外部提供）</a>
<a class="nsub" href="#p4-dispose">廃棄運用</a>
<span class="ns">横断・緊急</span>
<a class="nl urg" href="#p5"><span class="bdg bR">5</span>情報漏洩（エスカレーション）</a>
<span class="ns">導入 ｜ 最初に一度だけ</span>
<a class="nl" href="#setup"><span class="bdg bB">◎</span>棚卸と一括登録</a>
<a class="nsub" href="#setup-inv">① 棚卸（洗い出し）</a>
<a class="nsub" href="#setup-pick">② 対象を絞る</a>
<a class="nsub" href="#setup-reg">③ 一括登録</a>
<span class="ns">参考</span>
<a class="nl" href="#byscene">業務シーン別 早見表</a>
<a class="nl" href="#ng">やってはいけないこと</a>
<a class="nl" href="#faq">Q&amp;A</a>
<a class="nl" href="#contact">連絡先</a>
<a class="nl" href="#laws">関連法令</a>
</nav>
</aside>

<main id="main">
<h1 class="dt" id="top">個人情報 運用ガイド</h1>
<p class="dm">作成：法務部　｜　対象：事業部の業務担当者　｜　お客様・参加者の個人情報を「同意 → 取得 → 保管 → 利用・管理（廃棄）」の流れで安全に回し、漏洩には即報で備えるための実務ガイド</p>

<div class="cl cl-i">このガイドは、事業部が日々の業務で扱う<strong>お客様・参加者の個人情報</strong>に絞っています。中身は2部構成です——<strong>前半＝日々まわす「運用」</strong>（5つの工程）、<strong>後半＝立ち上げ時に一度だけの「導入」</strong>（棚卸と一括登録）。<strong>日常の作業はとてもシンプル</strong>で、①取得同意 → ②取得 → ③保管 → ④利用と管理（廃棄）を回し、⑤漏洩だけは横断・緊急で即報。同意文言やフォームは法務・管理部が用意するので、事業部は「承認済みのものを使う」のが前提です。</div>
<div class="cl cl-t"><strong>まず運用から読んでOK。</strong> 後半の「導入」は、最初に一度だけ行う棚卸・登録の作業です。導入を済ませておけば、登録済みフォーマットが揃うので、日々の運用は<strong>「承認済みのものを使って記録するだけ」</strong>で回ります。</div>

<div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">
  <span class="badge b-biz">事業部</span><span style="font-size:12px;color:var(--tx2)">現場（あなた）の作業</span>
  <span class="badge b-leg">法務・管理部</span><span style="font-size:12px;color:var(--tx2)">取り次げばOK</span>
  <span class="badge b-au">本人・顧客</span><span style="font-size:12px;color:var(--tx2)">情報の持ち主</span>
</div>

<hr class="sd">

<!-- 対象範囲 -->
<h2 class="sec" id="scope">このガイドの対象範囲</h2>
<div class="case-grid">
  <div class="case-card A">
    <h4>対象（事業部が扱う情報）</h4>
    <ul>
      <li><strong>イベント受付</strong>（ゲームマーケット等の出展者・参加者）</li>
      <li><strong>キャンペーン応募</strong>（懸賞・アンケート等）</li>
      <li><strong>会員登録</strong>（店舗・EC・オンラインの会員情報）</li>
      <li><strong>中古買取</strong>（店頭・宅配の買取相手の情報）</li>
    </ul>
  </div>
  <div class="case-card B">
    <h4>対象外（管理部が運用）</h4>
    <ul>
      <li><strong>契約</strong>（取引先・クリエイター・業務委託）→ 法務・経理</li>
      <li><strong>採用・労務</strong>（応募者・従業員情報）→ 人事</li>
      <li>これらは管理部側のフロー・台帳で運用するため、事業部はその指示に従う</li>
    </ul>
  </div>
</div>
<div class="cl cl-n"><strong>一部のアルバイト採用について：</strong> 採用・労務は人事（管理部）の運用が原則です。ただし店舗等で<strong>事業部が直接アルバイトの応募者・従業員情報を扱う</strong>場面では、本ガイドの5工程（取得同意・取得・保管・利用と管理〔廃棄〕・漏洩エスカレーション）に準じて取り扱ってください。判断に迷う場合は人事または法務へ。</div>

<hr class="sd">

<!-- 事業部が扱う個人情報 -->
<h2 class="sec" id="what">事業部が扱う個人情報（具体例）</h2>
<div class="tw"><table>
<thead><tr><th>業務シーン</th><th>個人情報の例</th></tr></thead>
<tbody>
<tr><td class="tc">イベント受付</td><td>出展者・参加者の氏名・連絡先・所属（所属団体、会社名等）</td></tr>
<tr><td class="tc">キャンペーン応募</td><td>氏名・住所・メール・電話・SNSアカウント</td></tr>
<tr><td class="tc">会員登録</td><td>会員ID・氏名・連絡先・購入／利用履歴（店舗・EC・オンライン）</td></tr>
<tr><td class="tc">中古買取</td><td>買取相手の本人確認情報（氏名・住所・年齢等）※古物営業法の帳簿記録を兼ねる</td></tr>
</tbody></table></div>
<div class="cl cl-w"><strong>要配慮個人情報に注意：</strong> 病歴・障害・信条など特にデリケートな情報は、取得に<strong>原則として本人の同意が必須</strong>です（個情法20条2項）。アンケート等で意図せず集めてしまわないよう、設問づくりの段階で法務に相談してください。</div>

<hr class="sd">

<!-- 5つの工程（全体像） -->
<h2 class="sec" id="flow">5つの工程（全体像）</h2>
<p>個人情報は <strong>①取得同意 → ②取得 → ③保管 → ④利用と管理（廃棄）</strong> の順に流れます。これに、どの工程でも起こりうる横断・緊急対応として <strong>⑤情報漏洩</strong> が重なります。事業部は各工程で決まった動作を行います。</p>
<div class="flow-wrap"><svg viewBox="0 0 740 116" style="width:100%;display:block"><defs><marker id="flov" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#9CA3AF"></polygon></marker></defs>
<rect x="0" y="1" width="174" height="58" rx="5" fill="#27500a"></rect><text x="87" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">① 取得同意</text><text x="87" y="38" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.75)">承認済フォーム・同意文言</text>
<line x1="176" y1="30" x2="188" y2="30" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flov)"></line>
<rect x="188" y="1" width="174" height="58" rx="5" fill="#27500a"></rect><text x="275" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">② 取得</text><text x="275" y="38" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.75)">受付・台帳に記録</text>
<line x1="364" y1="30" x2="376" y2="30" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flov)"></line>
<rect x="376" y="1" width="174" height="58" rx="5" fill="#27500a"></rect><text x="463" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">③ 保管</text><text x="463" y="38" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.75)">権限内・安全に持つ</text>
<line x1="552" y1="30" x2="564" y2="30" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flov)"></line>
<rect x="564" y="1" width="174" height="58" rx="5" fill="#27500a"></rect><text x="651" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">④ 利用と管理</text><text x="651" y="38" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.75)">目的内利用・廃棄</text>
<rect x="0" y="74" width="738" height="38" rx="5" fill="#e63946"></rect><text x="369" y="91" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">⑤ 情報漏洩（横断・緊急）</text><text x="369" y="105" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.85)">全工程で起こりうる ── 気づいたら「止める・すぐ報告」</text>
</svg></div>
<div class="flow-wrap" style="padding:11px 14px">
<div style="font-size:11px;font-weight:700;color:var(--navy);margin-bottom:7px">配色の意味（凡例）── 各フロー共通</div>
<div style="display:flex;flex-wrap:wrap;gap:7px 18px">
<span class="lg"><i style="background:#27500a"></i>事業部の作業</span>
<span class="lg"><i style="background:#c47d1a"></i>法務・管理部・総務人事（申請・登録・審査・判断）</span>
<span class="lg"><i style="background:#495057"></i>本人（顧客）の動作・中立の起点</span>
<span class="lg"><i style="background:#1d3557"></i>全社で行う対応（漏洩時など）</span>
<span class="lg"><i style="background:#e63946"></i>緊急（止める・即報）</span>
<span class="lg"><i style="background:#085041"></i>導入（最初に一度だけ）</span>
</div>
</div>
<div class="pillars">
  <div class="pillar"><div class="pn">工程 1</div><div class="pt">情報の取得同意</div><div class="pd">承認済フォーム・同意文言で利用目的を明示し、同意を取る。新フォーマットは事前申請。</div></div>
  <div class="pillar"><div class="pn">工程 2</div><div class="pt">情報の取得</div><div class="pd">受付・取得し、当日中に台帳へ記録。該当台帳がなければ法務へ申請。</div></div>
  <div class="pillar"><div class="pn">工程 3</div><div class="pt">情報の保管</div><div class="pd">権限のある人だけが見られる場所に安全に持つ。私物端末に入れない。</div></div>
  <div class="pillar"><div class="pn">工程 4</div><div class="pt">利用と管理（廃棄）</div><div class="pd">目的の範囲内だけで利用。本人請求・外部提供は法務へ。期限到来で廃棄。</div></div>
  <div class="pillar pe"><div class="pn">工程 5</div><div class="pt">情報漏洩</div><div class="pd">気づいたら止めて、上長＋法務へ即報。自分で処理しない。</div></div>
</div>
<div class="cl cl-t"><strong>このあと前半（運用）で①〜⑤を1つずつ説明します。</strong> 日々の作業は「承認済みのものを使って記録するだけ」。各工程に出てくる<strong>台帳登録・申請は、後半の「導入」で一括登録を済ませておけば原則不要</strong>になります（→ <a href="#setup" style="color:var(--green)">導入：棚卸と一括登録</a>）。</div>

<hr class="sd">

<!-- ========== 工程① 情報の取得同意 ========== -->
<div class="chap cA" id="p1">
  <div class="cn">Phase 1</div>
  <h2><span class="pno">1</span>情報の取得同意</h2>
  <div class="cdesc">集め始める前が勝負。利用目的を明示し、承認済みフォーマットで同意を取る。新しい様式・文言が必要なら、使う前に法務へ申請（公開前審査）。</div>
</div>
<p>個人情報を取得しようとするときは、いきなり集め始めず、まず<strong>「使えるフォーマット（同意の仕組み）があるか」を確認</strong>します。そのうえで、本人に利用目的を明示し、同意を取得します。承認前の取得・未承認フォームでの取得はできません。</p>
<div class="cl cl-w"><strong>原則：承認前に取得を始めない。</strong> 同意文言・フォームは法務が用意した<strong>承認済みのもの</strong>を使います。要配慮個人情報（病歴・障害・信条等）は、原則として<strong>本人の同意が必須</strong>です（個情法20条2項）。</div>

<!-- 1-A フォーマットの準備・申請 -->
<div class="shb sA" id="p1-format"><div class="sn">Phase 1 — A</div><h3>フォーマットの準備・申請（公開前審査）　<span class="badge b-biz" style="background:rgba(255,255,255,.85)">事業部がやる</span></h3></div>
<p>登録済みフォーマットがあればそのまま同意取得に進めます。<strong>無い／変更が必要なときだけ</strong>、使う前に法務へ台帳登録申請（公開前審査）を行います。まず「フォーマットとは何か」と「申請が必要か」を押さえましょう。</p>

<h4 class="sh4" id="format">「フォーマット」とは（＝申請の判断基準）</h4>
<p>このガイドで言う<strong>「フォーマット」</strong>とは、個人情報を取得するための<strong>様式・仕組みの総称</strong>です。新しいフォーマットを使うときは、原則として事前に<strong>個人情報保護台帳への登録申請（公開前審査）</strong>が必要になります。フォーマットに当たるものは、たとえば次のとおりです。</p>
<div class="tw"><table>
<thead><tr><th style="width:200px">フォーマットの例</th><th>具体例</th></tr></thead>
<tbody>
<tr><td class="tc">Web・オンラインのフォーム</td><td>応募フォーム・会員登録フォーム・イベント事前予約フォーム・アンケート</td></tr>
<tr><td class="tc">紙の様式</td><td>申込書・同意書・店頭買取の本人確認書・当日受付名簿</td></tr>
<tr><td class="tc">データ取得様式</td><td>取得項目を定めたシート・受付台帳のテンプレート</td></tr>
<tr><td class="tc">同意文言</td><td>上記フォームや様式に載せる利用目的・同意の文言</td></tr>
</tbody></table></div>
<div class="cl cl-i"><strong>原則：</strong> 個人情報は、法務が承認した<strong>「登録済みフォーマット」</strong>を使って取得します。自作の未承認フォームで集めないでください。</div>

<h4 class="sh4">フォーマットの必須要件 ── 取得記録を残せること</h4>
<p>すべてのフォーマットは、<strong>あとから「取得記録」（いつ・誰から・何を・何の目的で・どの同意方法で取得したか）を残せる要素を備えていること</strong>を必須要件とします。これがないと工程②の台帳記録ができないため、<strong>この要件を満たさないフォーマットは承認されません</strong>。</p>
<ul class="ck">
<li><strong>取得日時</strong>（いつ取得したか）を記録・特定できること</li>
<li><strong>取得項目</strong>（氏名・連絡先など、何を取得したか）が様式上に明示されていること</li>
<li><strong>利用目的</strong>が本人に示され、記録として残せること</li>
<li><strong>同意の取得方法・証憑</strong>を残せること（Web＝送信ログ／同意確認URL、対面・紙＝署名済み同意書 等）</li>
<li><strong>取得チャネル・業務シーン</strong>が判別できること</li>
<li><strong>管理番号</strong>等で個人情報保護台帳（取得台帳）と<strong>紐づけられる</strong>こと</li>
</ul>
<div class="cl cl-t"><strong>設計のヒント：</strong> Webフォームは回答に取得日時・回答URLが自動で残るよう設計し、台帳へのGAS連携で自動記録できると確実。紙の様式は、取得日・利用目的・同意署名欄・管理番号欄を様式に組み込んでおく。記録すべき項目の一覧は工程② <a href="#p2-ledger" style="color:var(--green)">台帳に記録</a> を参照。</div>

<h4 class="sh4">台帳への申請が必要か（判断基準）</h4>
<div class="tw"><table>
<thead><tr><th>ケース</th><th>個人情報保護台帳への申請</th></tr></thead>
<tbody>
<tr><td>新しいキャンペーン・イベントで、<strong>新しいフォーム／様式を作る</strong></td><td class="tc" style="color:var(--red)">✅ 必要（使用・公開の前に申請＝公開前審査）</td></tr>
<tr><td><strong>取得項目・同意文言・保管先を変更</strong>する（重要変更）</td><td class="tc" style="color:var(--red)">✅ 必要</td></tr>
<tr><td>表示ラベルやデザインだけの<strong>軽微変更</strong>（取得項目・同意文言は不変）</td><td class="tc" style="color:var(--gold)">△ 法務確認のみ（STEP1）</td></tr>
<tr><td><strong>既存の登録済みフォーマットをそのまま使う</strong></td><td class="tc" style="color:var(--green)">— 不要（取得の都度、台帳に記録）</td></tr>
</tbody></table></div>
<div class="cl cl-n"><strong>迷ったら申請。</strong> 新しい取得場面・新しい取得項目・新しい同意文言が一つでもあれば、使い始める前にまず法務へ相談してください。なお、後半の <a href="#setup" style="color:var(--ca)">導入（棚卸と一括登録）</a> を済ませていれば、既存フォーマットは登録済みなので、日々の申請はほとんど発生しません。</div>

<h4 class="sh4" id="p1-store">あわせて確認：保管先も用意できているか（取得の前に）</h4>
<p>フォーマットには<strong>「取得した情報をどこに入れるか（保管先）」</strong>も含まれます。取得を始める前に、<strong>登録済みの保管先があるか</strong>を確認し、<strong>無ければ取得前に個人情報保護台帳へ保管先を登録</strong>しておきます。これにより、取得した情報をすぐ正しい場所に入れられます（保管の運用ルールは工程③）。</p>
<div class="flow-wrap"><svg viewBox="0 0 740 150" style="width:100%;display:block"><defs><marker id="flp3" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#9CA3AF"></polygon></marker></defs>
<!-- start -->
<rect x="0" y="53" width="128" height="44" rx="5" fill="#495057"></rect><text x="64" y="79" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="700" fill="#fff">情報を入れる先</text>
<line x1="130" y1="75" x2="150" y2="75" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flp3)"></line>
<!-- decision -->
<rect x="152" y="44" width="150" height="62" rx="5" fill="#c47d1a"></rect><text x="227" y="70" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#fff">保管先フォーマット</text><text x="227" y="86" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#fff">は あるか？</text>
<!-- branch: ある (up) -->
<polyline points="302,62 331,62 331,32 356,32" fill="none" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flp3)"></polyline>
<text x="338" y="52" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="#27500a">ある</text>
<rect x="358" y="8" width="380" height="48" rx="5" fill="#27500a"></rect><text x="548" y="29" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">そのまま使う</text><text x="548" y="44" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="rgba(255,255,255,.8)">既存の登録済み保管先へ（台帳登録は不要）</text>
<!-- branch: ない (down) -->
<polyline points="302,90 331,90 331,120 356,120" fill="none" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flp3)"></polyline>
<text x="338" y="112" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="#e63946">ない</text>
<rect x="358" y="96" width="186" height="48" rx="5" fill="#c47d1a"></rect><text x="451" y="117" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#fff">保護台帳に登録</text><text x="451" y="132" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.8)">取得前に保管先を登録</text>
<line x1="546" y1="120" x2="564" y2="120" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flp3)"></line>
<rect x="566" y="96" width="172" height="48" rx="5" fill="#27500a"></rect><text x="652" y="124" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">登録後に使う</text>
</svg></div>
<div class="cl cl-n"><strong>ポイント：</strong> 「登録済みの保管先があるか」で、<span class="badge b-leg" style="margin:0 2px">台帳への保管先フォーマット登録</span>という作業が入るかどうかが決まります。新しい保管先は<strong>取得を始める前に登録</strong>するのが原則。導入（棚卸と一括登録）で主要な保管先を登録済みにしておけば、ここはほぼ「そのまま使う」になります。</div>

<h4 class="sh4">取得を始めるときの手順（1本の流れ）</h4>
<p>取得は <strong>①整理 → ②登録済みフォーマットがあるか確認 →（無ければ）③申請・④審査 → ⑤取得</strong> という1本の流れです。<strong>登録済みフォーマットがあれば③④は飛ばして</strong>、確認のあとすぐ取得（工程②）へ進みます。新しく作る・変えるときだけ③④の申請に入ります。</p>
<div class="flow-wrap"><svg viewBox="0 0 740 64" style="width:100%;display:block"><defs><marker id="flp0a" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#9CA3AF"></polygon></marker></defs>
<rect x="0" y="1" width="138" height="62" rx="5" fill="#27500a"></rect><text x="69" y="26" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#fff">1. 取得内容を整理</text><text x="69" y="43" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="7.5" fill="rgba(255,255,255,.78)">目的・項目・チャネル</text>
<line x1="140" y1="32" x2="148" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flp0a)"></line>
<rect x="150" y="1" width="138" height="62" rx="5" fill="#27500a"></rect><text x="219" y="26" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#fff">2. フォーマット確認</text><text x="219" y="43" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="7.5" fill="rgba(255,255,255,.78)">登録済みがあるか</text>
<line x1="290" y1="32" x2="298" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flp0a)"></line>
<rect x="300" y="1" width="138" height="62" rx="5" fill="#c47d1a"></rect><text x="369" y="26" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#fff">3. 法務へ申請</text><text x="369" y="43" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="7.5" fill="rgba(255,255,255,.85)">無い・変えるときだけ</text>
<line x1="440" y1="32" x2="448" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flp0a)"></line>
<rect x="450" y="1" width="138" height="62" rx="5" fill="#c47d1a"></rect><text x="519" y="26" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#fff">4. 審査・承認</text><text x="519" y="43" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="7.5" fill="rgba(255,255,255,.85)">公開前審査</text>
<line x1="590" y1="32" x2="598" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flp0a)"></line>
<rect x="600" y="1" width="138" height="62" rx="5" fill="#27500a"></rect><text x="669" y="26" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#fff">5. 取得開始</text><text x="669" y="43" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="7.5" fill="rgba(255,255,255,.78)">台帳に記録→工程②</text>
</svg></div>
<div class="cl cl-t"><strong>分かれ目は②：</strong> 登録済みフォーマットが<strong>ある</strong>＝③④をスキップしてすぐ <a href="#p2" style="color:var(--green)">工程② 取得</a> へ。<strong>無い・変える</strong>（応募フォーム・受付様式・同意文言などを新規／変更）＝公開・配布の前に③④の申請へ。承認されてはじめて取得を開始できます。</div>
<div class="cl cl-i"><strong>③申請（公開前審査）に出すもの：</strong> ①フォーム設計書（用途・取得項目・利用目的・保管先・アクセス権・廃棄予定、および<strong>取得記録を残せる要素</strong>）②同意文言案 ③台帳登録内容。入口は Slack <code>/法務依頼</code>（または #法務相談）。</div>
<div class="cl cl-t"><strong>④審査期間の目安：</strong> 国内のみ 5営業日／GDPR対象（海外居住者を含む）10営業日／軽微変更 3営業日。緊急時は事前に法務部へ相談。</div>

<!-- 1-B 同意の取り方 -->
<div class="shb sA" id="p1-consent"><div class="sn">Phase 1 — B</div><h3>同意の取り方（チャネル別）　<span class="badge b-biz" style="background:rgba(255,255,255,.85)">事業部がやる</span></h3></div>
<p>同意の取り方は<strong>取得の入口（チャネル）</strong>で変わります。いずれも、承認済みの同意文言・フォームを使うことが前提です。</p>

<h4 class="sh4">取得前のチェック（3点）</h4>
<ul class="ck">
<li>利用目的を本人に明示しているか（フォーム直下／口頭／書面）</li>
<li>要配慮個人情報を取得する場合、本人の同意取得または適正な例外事由に該当するか</li>
<li>保管場所・廃棄時期・廃棄方法を決めているか（→ 工程③・④）</li>
</ul>

<h3 class="sub" style="margin-top:18px">【A】Web・オンライン（応募フォーム・会員登録・イベント事前予約 等）</h3>
<div class="cl cl-i"><strong>法令の根拠：</strong> 送信ボタン直下に利用目的・同意文が明示されていれば、送信ボタンの押下を同意の意思表示として扱えます（利用目的の明示／個情法21条）。文言は「送信します」ではなく<strong>「送信することでプライバシーポリシーに同意します」</strong>が必須です。</div>

<h3 class="sub" style="margin-top:18px">【B】対面・紙・電話（店頭買取・イベント当日受付・電話受付 等）</h3>
<div class="cl cl-i"><strong>法令の根拠：</strong> システム外のチャネルでは「みなし同意」は使えません。情報を受け取るタイミングで、利用目的を口頭または書面で伝えて同意を取得してください（個情法21条）。署名済みの同意書はそのまま証憑になります。</div>
<div class="cl cl-n"><strong>中古買取の特記：</strong> 店頭・宅配買取の本人確認は、古物営業法上の帳簿記録（氏名・住所・年齢・取引内容等）を兼ねます。個人情報保護法上の取得記録としても扱うため、台帳・帳簿の双方で漏れなく記録してください（記録の手順は工程②）。</div>

<hr class="sd">

<!-- ========== 工程② 情報の取得 ========== -->
<div class="chap cA" id="p2">
  <div class="cn">Phase 2</div>
  <h2><span class="pno">2</span>情報の取得</h2>
  <div class="cdesc">同意が取れたら実際に受け取り、その日のうちに台帳へ記録する。記録は証拠であり、後工程（保管・廃棄）の起点になる。</div>
</div>

<!-- 2-A 受付・取得の手順 -->
<div class="shb sA" id="p2-get"><div class="sn">Phase 2 — A</div><h3>受付・取得の手順　<span class="badge b-biz" style="background:rgba(255,255,255,.85)">事業部がやる</span></h3></div>

<p>取得の入口（チャネル）は2通りです。<strong>【A】ウェブフォーム</strong>（お客様ご本人に入力してもらう）と、<strong>【B】対面・紙・電話</strong>（その場で直接受け取る）。どちらも、法務が承認した様式・同意文言を使います。</p>

<h3 class="sub">【A】ウェブフォームで受け取る（承認済みフォームに入力してもらう）</h3>
<p>お客様・参加者<strong>ご本人に、法務が承認したウェブフォームへ入力・送信してもらう</strong>方法です。事業部の作業は、<strong>そのフォームを案内し、集まった回答を保管して記録する</strong>こと。フォームを新しく作る・変える場合は、先に工程①の申請を済ませます。</p>
<div class="flow-wrap"><svg viewBox="0 0 740 64" style="width:100%;display:block"><defs><marker id="flgA" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#9CA3AF"></polygon></marker></defs>
<rect x="0" y="1" width="174" height="62" rx="5" fill="#27500a"></rect><text x="87" y="22" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">1. フォームを案内</text><text x="87" y="40" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.78)">承認済みフォームのリンク・QRを掲示</text>
<line x1="176" y1="32" x2="188" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flgA)"></line>
<rect x="188" y="1" width="174" height="62" rx="5" fill="#495057"></rect><text x="275" y="22" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">2. 本人が入力・送信</text><text x="275" y="40" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.78)">送信ボタン＝同意</text>
<line x1="364" y1="32" x2="376" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flgA)"></line>
<rect x="376" y="1" width="174" height="62" rx="5" fill="#27500a"></rect><text x="463" y="22" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">3. 回答を確認・保管</text><text x="463" y="40" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.78)">回答シート・格納先を控える</text>
<line x1="552" y1="32" x2="564" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flgA)"></line>
<rect x="564" y="1" width="174" height="62" rx="5" fill="#27500a"></rect><text x="651" y="22" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">4. 記録する</text><text x="651" y="40" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.78)">取得記録シート・台帳へ</text>
</svg></div>
<div class="cl cl-t"><strong>記入のコツ：</strong> 管理番号は <code>PI-YYYYMMDD-001</code> 形式にすると検索しやすい。「同意確認URL」欄にフォーム回答URL等を記録（証拠になる）。フォーム→台帳のGAS連携がある場合、3〜4は自動で記録されます。</div>

<h3 class="sub" style="margin-top:18px">【B】対面・紙・電話で受け取る（その場で直接受け取る）</h3>
<p>店頭・イベント当日・電話など、<strong>その場で直接</strong>受け取る方法です。受け取るときに利用目的を伝えて同意をもらい、受け取った情報を記録します（紙はそのまま施錠保管へ）。</p>
<div class="flow-wrap"><svg viewBox="0 0 740 64" style="width:100%;display:block"><defs><marker id="flgB" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#9CA3AF"></polygon></marker></defs>
<rect x="0" y="1" width="237" height="62" rx="5" fill="#27500a"></rect><text x="118.5" y="22" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">1. 説明・同意取得</text><text x="118.5" y="40" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="rgba(255,255,255,.78)">利用目的を口頭・書面で伝える</text>
<line x1="239" y1="32" x2="251" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flgB)"></line>
<rect x="251" y="1" width="237" height="62" rx="5" fill="#27500a"></rect><text x="369.5" y="22" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">2. 取得台帳へ記入</text><text x="369.5" y="40" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="rgba(255,255,255,.78)">チャネル・同意方法を記録</text>
<line x1="490" y1="32" x2="502" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flgB)"></line>
<rect x="502" y="1" width="237" height="62" rx="5" fill="#27500a"></rect><text x="620.5" y="22" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">3. 書類を施錠保管</text><text x="620.5" y="40" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="rgba(255,255,255,.78)">署名済み同意書を保管場所へ（工程③）</text>
</svg></div>
<div class="cl cl-n"><strong>中古買取の特記：</strong> 古物営業法上の帳簿記録を兼ねるため、個人情報保護台帳と古物台帳・帳簿の<strong>双方で漏れなく</strong>記録してください。</div>

<!-- 2-B 台帳に記録 -->
<div class="shb sA" id="p2-ledger"><div class="sn">Phase 2 — B</div><h3>台帳に記録　<span class="badge b-biz" style="background:rgba(255,255,255,.85)">事業部がやる</span></h3></div>
<p>取得した情報は、<strong>取得当日中（遅くとも翌営業日）</strong>に個人情報取得台帳へ記録します（使うフォーマットの申請要否は工程①で判断済みの前提）。Webフォーム→台帳のGAS連携がある場合は自動で記録されます。</p>
<h4 class="sh4">台帳に記録する項目（取得台帳）</h4>
<div class="tw"><table>
<thead><tr><th style="width:180px">記録項目</th><th>例</th></tr></thead>
<tbody>
<tr><td class="tc">管理番号</td><td>PI-20260601-001（取得記録シートと統一）</td></tr>
<tr><td class="tc">受付日／業務シーン</td><td>イベント受付／キャンペーン応募／会員登録／中古買取</td></tr>
<tr><td class="tc">取得チャネル</td><td>A: Web・オンライン ／ B: 対面・紙・電話</td></tr>
<tr><td class="tc">取得した項目</td><td>氏名・メール・電話 など</td></tr>
<tr><td class="tc">利用目的</td><td>応募受付・当選連絡（プライバシーポリシーの表現に合わせる）</td></tr>
<tr><td class="tc">同意の取得状況・方法</td><td>取得済（フォーム送信／口頭説明／書面署名）</td></tr>
<tr><td class="tc">同意確認URL・証憑</td><td>フォーム回答URL、署名済み同意書の保管場所</td></tr>
<tr><td class="tc">保管場所</td><td>共有ドライブの該当フォルダ等、具体的に</td></tr>
<tr><td class="tc">保存期間／廃棄予定日</td><td>キャンペーン終了後◯か月 など</td></tr>
</tbody></table></div>
<div class="cl cl-n"><strong>該当する台帳・フォームがまだ無いときは：</strong> 記録の前に、工程① <a href="#p1-format" style="color:var(--gold)">フォーマットの準備・申請</a> の手順で法務へ台帳登録申請（公開前審査）してください。</div>

<hr class="sd">

<!-- ========== 工程③ 情報の保管 ========== -->
<div class="chap cA" id="p3">
  <div class="cn">Phase 3</div>
  <h2><span class="pno">3</span>情報の保管</h2>
  <div class="cdesc">取得した情報を、用意しておいた保管先に安全に置き続ける。権限のある人だけ・私物端末に入れない・机に放置しない。</div>
</div>
<div class="cl cl-t"><strong>保管先は取得の前に用意済みの前提です。</strong> 「保管先フォーマットがあるか／なければ台帳に登録」という準備は、取得より前の工程①で行います（→ <a href="#p1-store" style="color:var(--green)">保管先も用意できているか</a>）。この工程③は、<strong>取得した情報を安全に持ち続ける運用</strong>に集中します。</div>

<h4 class="sh4">保管時の共通ルール</h4>
<ul>
<li>決められた保管場所（権限管理された共有ドライブ等）に置く。紙は<strong>施錠</strong>し、机に放置しない（クリアデスク）。</li>
<li>個人情報を<strong>私物のPC・スマホ・USB・個人クラウド</strong>に入れない。</li>
<li>閲覧・編集は<strong>業務上必要な人だけ</strong>。共有リンクを安易に広げない。担当異動・案件終了時に不要な共有・権限を外す。</li>
</ul>
<div class="cl cl-i"><strong>保管は次工程の土台：</strong> ここで「どこに・誰の権限で・いつまで」を正しく持っておくことが、工程④の<strong>適正な利用</strong>と<strong>確実な廃棄</strong>、そして万一の<strong>漏洩時の範囲特定</strong>につながります。</div>

<hr class="sd">

<!-- ========== 工程④ 情報の利用と管理（廃棄） ========== -->
<div class="chap cA" id="p4">
  <div class="cn">Phase 4</div>
  <h2><span class="pno">4</span>情報の利用と管理（廃棄）</h2>
  <div class="cdesc">利用は「取得時に示した目的の範囲内」だけ。本人請求・外部提供は法務へ。そして必要な間だけ持ち、期限が来たら確実に廃棄する。</div>
</div>

<!-- 4-A 利用 -->
<div class="shb sA" id="p4-use"><div class="sn">Phase 4 — A</div><h3>利用（目的の範囲内）　<span class="badge b-biz" style="background:rgba(255,255,255,.85)">事業部がやる</span></h3></div>
<p>利用できるのは、取得時に本人へ示した<strong>利用目的の範囲内</strong>だけです。範囲を超えそうなときは、使う前に法務に相談してください。</p>
<div class="cl cl-w"><strong>目的外利用になりやすい例：</strong> 応募者リストを後日の新商品案内に流用／会員情報を別キャンペーンの集客に転用／イベント参加者名簿を別イベントに使い回す。いずれも当初の目的を超えるため、追加の同意か目的の見直しが必要です（個情法18条）。判断は法務へ。</div>

<!-- 4-B 管理 -->
<div class="shb sA" id="p4-manage"><div class="sn">Phase 4 — B</div><h3>管理（本人からの請求・外部提供／委託）　<span class="badge b-leg" style="background:rgba(255,255,255,.85)">法務・管理部に任せる</span></h3></div>
<h4 class="sh4">本人からの請求があったら</h4>
<p>「見せてほしい（開示）」「直してほしい（訂正）」「消してほしい・使わないでほしい（利用停止・削除）」といった請求が<span class="badge b-au">本人</span>から来た場合、会社は法令に基づき<strong>遅滞なく対応</strong>する義務があります（個情法33条以下）。現場で自己判断で回答せず、<strong>速やかに法務・個人情報保護管理者へ取り次ぐ</strong>（請求の日付・内容を控える）。</p>
<h4 class="sh4">外部に渡す・委託する</h4>
<p>個人情報を社外の第三者に渡す（第三者提供）・外部業者に処理を任せる（委託：発送代行・データ入力・印刷など）のは、<strong>契約と安全管理の確認が必要な管理部マター</strong>です。事業部だけで進めず、<strong>必ず法務に相談</strong>してください（個情法25条・27条）。名簿の社外共有・外注は Slack <code>/法務依頼</code> から起票を。</p>

<!-- 4-C 廃棄 -->
<div class="shb sA" id="p4-dispose"><div class="sn">Phase 4 — C</div><h3>廃棄運用　<span class="badge b-leg" style="background:rgba(255,255,255,.85)">総務人事</span> <span class="badge b-biz" style="background:rgba(255,255,255,.85)">事業部</span></h3></div>
<p>個人情報は「必要な間だけ持つ」が原則です。廃棄は、<strong>総務人事が「セキュアナビ」から出す定期アラートを起点</strong>に運用します。事業部は、自分で期限を探しにいくのではなく、<strong>届いたアラートを受けて廃棄を実行</strong>します。</p>
<div class="flow-wrap"><svg viewBox="0 0 740 64" style="width:100%;display:block"><defs><marker id="fldp" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#9CA3AF"></polygon></marker></defs>
<rect x="0" y="1" width="174" height="62" rx="5" fill="#c47d1a"></rect><text x="87" y="18" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" font-weight="700" fill="rgba(255,255,255,.6)">総務人事</text><text x="87" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">1. 定期アラート</text><text x="87" y="47" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.78)">セキュアナビが期限通知</text>
<line x1="176" y1="32" x2="188" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fldp)"></line>
<rect x="188" y="1" width="174" height="62" rx="5" fill="#27500a"></rect><text x="275" y="18" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" font-weight="700" fill="rgba(255,255,255,.55)">事業部</text><text x="275" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">2. 対象を確認</text><text x="275" y="47" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.78)">台帳で廃棄対象を特定</text>
<line x1="364" y1="32" x2="376" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fldp)"></line>
<rect x="376" y="1" width="174" height="62" rx="5" fill="#27500a"></rect><text x="463" y="18" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" font-weight="700" fill="rgba(255,255,255,.55)">事業部</text><text x="463" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">3. 廃棄実行</text><text x="463" y="47" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.78)">電子削除・紙シュレッダー</text>
<line x1="552" y1="32" x2="564" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fldp)"></line>
<rect x="564" y="1" width="174" height="62" rx="5" fill="#27500a"></rect><text x="651" y="18" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" font-weight="700" fill="rgba(255,255,255,.55)">事業部</text><text x="651" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">4. 廃棄記録</text><text x="651" y="47" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.78)">対象・日付・方法・確認者</text>
</svg></div>
<ul>
<li><strong>総務人事</strong>がセキュアナビから保存期限の定期アラート（期限超過・期限間近）を配信する。</li>
<li>事業部は<strong>アラートを受けたら速やかに廃棄を実行</strong>する（放置しない）。電子データは確実に削除、紙はシュレッダー処理。</li>
<li>廃棄したら<strong>廃棄記録</strong>（対象・日付・方法・確認者）を残し、台帳のステータスを「廃棄済」に更新する。原則2名立会いまたは記録を残す。</li>
</ul>
<div class="cl cl-n"><strong>役割分担：</strong> 期限の検知・アラート配信は<span class="badge b-leg">総務人事（セキュアナビ）</span>が担います。事業部は<span class="badge b-biz">受け取って廃棄を実行する側</span>です。アラートが来ない＝廃棄不要ではないので、台帳の保存期限欄も折に触れて確認してください。</div>
<div class="cl cl-i"><strong>保存期間の目安：</strong> 問い合わせ対応は完了後1〜3年／注文は配送完了後5年が目安（法務に確認）。法令で保存義務がある書類（古物台帳など）はその期間を守ること。むやみに「念のため保管」を続けないのが安全管理につながります。</div>

<hr class="sd">

<!-- ========== 工程⑤ 情報漏洩 ========== -->
<div class="chap cR" id="p5">
  <div class="cn">Phase 5 ／ Emergency</div>
  <h2><span class="pno">5</span>🚨 情報漏洩（エスカレーション）</h2>
  <div class="cdesc">全工程で起こりうる横断・緊急対応。まず「止めて」「すぐ報告」。隠さない・自分で処理しない。初動の速さが被害を左右します。</div>
</div>
<div class="cl cl-w"><strong>メール誤送信、書類・USBの紛失、不正アクセスの疑い、会員データの流出</strong>——どんなに小さく見えても、気づいたら<strong>ただちに上長と法務・個人情報保護管理者へ報告</strong>してください。</div>
<div class="flow-wrap"><svg viewBox="0 0 745 64" style="width:100%;display:block"><defs><marker id="fle" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#9CA3AF"></polygon></marker></defs>
<rect x="0" y="1" width="137" height="62" rx="5" fill="#e63946"></rect><text x="68.5" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.5)">すぐ</text><text x="68.5" y="34" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11" font-weight="700" fill="#fff">止める</text><text x="68.5" y="48" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.8)">送信取消・遮断</text>
<line x1="139" y1="32" x2="151" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fle)"></line>
<rect x="151" y="1" width="137" height="62" rx="5" fill="#e63946"></rect><text x="219.5" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.5)">すぐ</text><text x="219.5" y="34" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11" font-weight="700" fill="#fff">報告する</text><text x="219.5" y="48" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.8)">上長＋法務へ即報</text>
<line x1="290" y1="32" x2="302" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fle)"></line>
<rect x="302" y="1" width="137" height="62" rx="5" fill="#1d3557"></rect><text x="370.5" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)">会社</text><text x="370.5" y="34" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11" font-weight="700" fill="#fff">範囲特定</text><text x="370.5" y="48" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.7)">件数・原因・証拠保全</text>
<line x1="441" y1="32" x2="453" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fle)"></line>
<rect x="453" y="1" width="137" height="62" rx="5" fill="#1d3557"></rect><text x="521.5" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)">会社</text><text x="521.5" y="34" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11" font-weight="700" fill="#fff">報告・通知</text><text x="521.5" y="48" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.7)">委員会報告・本人通知</text>
<line x1="592" y1="32" x2="604" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fle)"></line>
<rect x="604" y="1" width="137" height="62" rx="5" fill="#1d3557"></rect><text x="672.5" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)">会社</text><text x="672.5" y="34" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11" font-weight="700" fill="#fff">再発防止</text><text x="672.5" y="48" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8" fill="rgba(255,255,255,.7)">原因分析・改善</text>
</svg></div>
<div class="cl cl-i"><strong>法令上の期限は会社（法務・保護管理者）が対応します：</strong> 一定の漏えいが起きた場合、個人情報保護委員会への報告（速報＋確報〔原則30日以内〕）や本人への通知が法令で義務付けられています（個情法26条）。海外在住者の情報が絡む場合はGDPR（72時間以内）が関係することもあります。<strong>事業部がやることは「すぐ止める・すぐ報告する」だけ</strong>です。</div>

<hr class="sd">

<!-- ========== 導入（最初に一度だけ） ========== -->
<div class="chap cB" id="setup">
  <div class="cn">Setup ／ 導入（最初に一度だけ）</div>
  <h2><span class="pno">◎</span>導入：棚卸と一括登録</h2>
  <div class="cdesc">立ち上げ時に一度だけ。いま扱っている個人情報のフォーマットを棚卸しして、まとめて個人情報保護台帳に登録する。これが済めば、あとは前半の運用を回すだけ。</div>
</div>
<p>前半の運用がシンプルなのは、<strong>使うフォーマットがあらかじめ台帳に登録されている</strong>からです。その「登録済みの状態」をつくるのが導入です。やることは2つ——<strong>棚卸（いま使っているものを洗い出す）</strong>と<strong>一括登録（まとめて台帳に載せる）</strong>。事業部にお願いするのは、主に<strong>登録の対象を絞り込む</strong>ところです。</p>
<div class="flow-wrap"><svg viewBox="0 0 740 64" style="width:100%;display:block"><defs><marker id="flset" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#9CA3AF"></polygon></marker></defs>
<rect x="0" y="1" width="237" height="62" rx="5" fill="#085041"></rect><text x="118.5" y="22" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">① 棚卸（洗い出し）</text><text x="118.5" y="40" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="rgba(255,255,255,.78)">いま使うフォーム・名簿・保管先を全部出す</text>
<line x1="239" y1="32" x2="251" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flset)"></line>
<rect x="251" y="1" width="237" height="62" rx="5" fill="#085041"></rect><text x="369.5" y="22" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">② 対象を絞る</text><text x="369.5" y="40" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="rgba(255,255,255,.78)">個人情報を含む／継続利用のものに限定</text>
<line x1="490" y1="32" x2="502" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flset)"></line>
<rect x="502" y="1" width="237" height="62" rx="5" fill="#085041"></rect><text x="620.5" y="22" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">③ 一括登録</text><text x="620.5" y="40" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="rgba(255,255,255,.78)">個人情報保護台帳へまとめて登録</text>
</svg></div>

<!-- 棚卸 -->
<div class="shb sB" id="setup-inv"><div class="sn">Setup — ①</div><h3>棚卸（洗い出し）　<span class="badge b-biz" style="background:rgba(255,255,255,.85)">事業部がやる</span></h3></div>
<p>いま事業部で使っている<strong>フォーム・様式・名簿・保管先</strong>を、棚卸シートに書き出します。完璧を目指さず、<strong>まず主要なものから</strong>で構いません。</p>
<div class="tw"><table>
<thead><tr><th style="width:160px">棚卸シートの項目</th><th>例</th></tr></thead>
<tbody>
<tr><td class="tc">フォーマット名</td><td>◯◯キャンペーン応募フォーム、当日受付名簿、店頭買取 本人確認書</td></tr>
<tr><td class="tc">業務シーン</td><td>イベント受付／キャンペーン応募／会員登録／中古買取</td></tr>
<tr><td class="tc">取得項目</td><td>氏名・メール・電話・住所 など</td></tr>
<tr><td class="tc">取得チャネル</td><td>A: Web・オンライン ／ B: 対面・紙・電話</td></tr>
<tr><td class="tc">保管先</td><td>共有ドライブの該当フォルダ、施錠キャビネット 等</td></tr>
<tr><td class="tc">保存期間（目安）</td><td>キャンペーン終了後◯か月／配送完了後◯年 など</td></tr>
</tbody></table></div>

<!-- 対象を絞る -->
<div class="shb sB" id="setup-pick"><div class="sn">Setup — ②</div><h3>対象を絞る　<span class="badge b-biz" style="background:rgba(255,255,255,.85)">事業部がやる</span></h3></div>
<p>洗い出したもののうち、<strong>台帳に登録する対象を選びます</strong>。ここが事業部に主にお願いする作業です。</p>
<div class="case-grid">
  <div class="case-card B">
    <h4>登録する（対象に含める）</h4>
    <ul>
      <li><strong>個人情報を含む</strong>フォーム・名簿・保管先</li>
      <li><strong>継続して使う</strong>もの（恒常的な会員・受付・買取など）</li>
      <li>すでに運用中で、これからも残るもの</li>
    </ul>
  </div>
  <div class="case-card A">
    <h4>登録しない（対象から外す）</h4>
    <ul>
      <li>個人情報を含まないもの（集計のみ・匿名データ等）</li>
      <li>一過性で<strong>廃止予定</strong>のもの、テスト・下書き</li>
      <li>契約・採用など<strong>管理部運用</strong>のもの（→ 対象外）</li>
    </ul>
  </div>
</div>
<div class="cl cl-n"><strong>迷ったら「含める」。</strong> 個人情報が入るか判断しづらいものは、いったん対象に入れて法務に相談してください。除外しすぎて<strong>登録漏れ</strong>になる方がリスクです。</div>

<!-- 一括登録 -->
<div class="shb sB" id="setup-reg"><div class="sn">Setup — ③</div><h3>一括登録　<span class="badge b-biz" style="background:rgba(255,255,255,.85)">事業部</span> <span class="badge b-leg" style="background:rgba(255,255,255,.85)">法務</span></h3></div>
<p>絞り込んだ対象を、<strong>個人情報保護台帳にまとめて登録</strong>します。1件ずつではなく、棚卸シートの単位で一括で台帳化します。</p>
<ul>
<li><strong>事業部：</strong> 棚卸シート（対象を絞ったもの）を法務へ提出する。Slack <code>/法務依頼</code> から。</li>
<li><strong>法務：</strong> 登録様式・同意文言・保管先・保存期間を確認し、台帳へ一括で登録する。要修正があれば事業部に差し戻す。</li>
<li>登録が完了すれば、それらは<strong>「登録済みフォーマット」</strong>となり、前半の運用でそのまま使える。</li>
</ul>
<div class="cl cl-t"><strong>導入が済んだら、あとは運用だけ。</strong> 登録済みフォーマットが揃うので、日々は <a href="#p1" style="color:var(--green)">①取得同意</a> 〜 <a href="#p4-dispose" style="color:var(--green)">④廃棄</a> を回すだけになります。導入後に<strong>新しく出てきたフォーマット</strong>は、運用の <a href="#p1-format" style="color:var(--green)">工程①（準備・申請）</a>・<a href="#p3" style="color:var(--green)">工程③（保管先の登録）</a> で都度登録すれば大丈夫です。</div>

<hr class="sd">

<!-- ========== 参考 ========== -->
<div class="chap c3" id="byscene">
  <div class="cn">Reference</div>
  <h2>業務シーン別 早見表</h2>
  <div class="cdesc">自分の業務がどのシーンかを確認。新しい取得場面が出てきたら、フォーム公開前に法務へ台帳登録申請を（工程①）。</div>
</div>
<div class="tw"><table>
<thead><tr><th>業務シーン</th><th>主な取得チャネル</th><th>特に注意する点</th></tr></thead>
<tbody>
<tr><td class="tc">イベント受付</td><td>Web事前予約／当日紙受付</td><td>出展者と参加者で取得項目・目的を区別。当日運用の記録漏れに注意。文言は全イベントで統一</td></tr>
<tr><td class="tc">キャンペーン応募</td><td>Web応募フォーム</td><td>景品表示法の表示（賞品・当選条件）と同意文言の整合。応募情報の保存期間を決めておく</td></tr>
<tr><td class="tc">会員登録</td><td>Web・EC・店頭</td><td>会員データの目的外流用に注意。退会・休眠データの保存期間と削除ルールを台帳で管理</td></tr>
<tr><td class="tc">中古買取</td><td>店頭・宅配（対面・紙）</td><td>古物営業法の本人確認・帳簿記録を兼ねる。書類は施錠保管。台帳・帳簿の双方で記録</td></tr>
</tbody></table></div>

<h2 class="sec" id="ng">やってはいけないこと（NG集）</h2>
<ul class="ck ng">
<li>承認されていない自作フォームで個人情報を集める（公開前審査・台帳登録申請が必要）</li>
<li>利用目的を示さずに個人情報を集める</li>
<li>会員・応募者情報を、当初の目的と違う用途に無断で使う・使い回す</li>
<li>名簿や個人情報を私物PC・スマホ・個人クラウドに保存する</li>
<li>買取・受付の書類を机に放置する（施錠保管が必要）</li>
<li>共有ドライブのリンクを必要以上に広く共有する</li>
<li>本人からの開示・削除請求にその場で自己判断で回答する</li>
<li>漏えい・紛失を自分で処理しようとして報告を遅らせる</li>
<li>保存期限が過ぎた個人情報を「念のため」と放置し続ける</li>
</ul>

<h2 class="sec" id="faq">よくある疑問（Q&amp;A）</h2>
<div class="faq-item">
<div class="faq-q">Q1. 新しいキャンペーン用に応募フォームを作りたい。すぐ公開していい？</div>
<div class="faq-a">公開前に法務へ「台帳登録申請（公開前審査）」を出してください（工程①）。フォーム設計書・同意文言案・台帳登録内容を提出します。審査の目安は国内のみ5営業日、GDPR対象は10営業日です。承認済みのフォームを使うのが原則です。</div>
</div>
<div class="faq-item">
<div class="faq-q">Q2. 取得した情報を入れる台帳がまだ無い場合は？</div>
<div class="faq-a">その時点で法務へ台帳登録申請をしてください。台帳・受付フォームが整うまでの間は、取得した情報を施錠・権限管理された場所に保管し、いつ・何を・何の目的で受け取ったかを控えておきます。</div>
</div>
<div class="faq-item">
<div class="faq-q">Q3. 会員情報を別キャンペーンの告知に使ってもいい？</div>
<div class="faq-a">取得時に示した目的の範囲を超える可能性が高く、そのままでは使えません（工程④）。追加の同意か利用目的の見直しが必要です。流用したい場合は事前に法務へ相談してください。</div>
</div>
<div class="faq-item">
<div class="faq-q">Q4. 買取のお客様の書類はどう保管する？</div>
<div class="faq-a">古物営業法の帳簿記録を兼ねるため、施錠できる場所に保管し、台帳・帳簿の双方に記録します。机上放置は禁止です。保存期間は法令の定めに従い、期限が来たら廃棄記録を残して処分します。</div>
</div>
<div class="faq-item">
<div class="faq-q">Q5. メールを誤送信してしまいました。どうすれば？</div>
<div class="faq-a">まず送信取消など可能な手当てを行い、ただちに上長と法務・個人情報保護管理者へ報告してください（工程⑤）。件数や内容にかかわらず、自分で抱え込まず即報するのが正解です。報告の手続きや委員会対応は会社側で行います。</div>
</div>

<h2 class="sec" id="contact">困ったときの連絡先</h2>
<div class="tw"><table>
<thead><tr><th>こんなとき</th><th>連絡先</th></tr></thead>
<tbody>
<tr><td>新しいフォームの公開・台帳登録申請</td><td>Slack <code>/法務依頼</code>（または #法務相談）</td></tr>
<tr><td>同意文言・フォームの公開前チェック</td><td>法務部 #法務相談</td></tr>
<tr><td>名簿の社外共有・外注（委託）の相談</td><td>法務部 #法務相談（管理部マター）</td></tr>
<tr><td>本人からの開示・訂正・削除請求</td><td>法務部／個人情報保護管理者へ取り次ぎ</td></tr>
<tr><td>漏えい・紛失（緊急）</td><td>上長＋法務／個人情報保護管理者へ即報</td></tr>
</tbody></table></div>

<h2 class="sec" id="laws">主な関連法令</h2>
<div class="tw"><table>
<thead><tr><th>法令名</th><th>本ガイドに関連する主な規制内容</th></tr></thead>
<tbody>
<tr><td class="tc">個人情報保護法</td><td>利用目的の特定・通知（17・21条）、適正取得・要配慮個人情報（20条）、利用目的による制限（18条）、安全管理措置（23条）、漏えい等の報告・本人通知（26条）、開示・訂正・利用停止等への対応（33条以下）</td></tr>
<tr><td class="tc">古物営業法<br><span style="font-size:10px;font-weight:400">※中古買取</span></td><td>買取時の本人確認義務と帳簿（取引記録）への記載・保存。個人情報保護法上の取得記録を兼ねる</td></tr>
<tr><td class="tc">景品表示法<br><span style="font-size:10px;font-weight:400">※キャンペーン</span></td><td>懸賞・景品の表示規制。応募フォームの同意文言と賞品・当選条件の表示の整合確認が必要</td></tr>
</tbody></table></div>

<div style="background:var(--navy);border-radius:8px;padding:18px 22px;margin-top:28px;text-align:center">
<div style="font-size:10px;color:rgba(255,255,255,.45);margin-bottom:5px">お問い合わせ先</div>
<div style="font-size:17px;font-weight:700;color:#fff;margin-bottom:3px">株式会社アークライト 経営管理本部 法務部</div>
<div style="font-size:12px;color:rgba(255,255,255,.65)">判断に迷う場合は自己判断せず法務へご相談ください（#法務相談）</div>
</div>
</main>

</body></html>$g_privacy$, 'seed 0095 (from services/api/guides)', 'seed')
    RETURNING id INTO vid;
  UPDATE portal_guides
     SET current_version_id = vid, status = 'published', updated_at = now()
   WHERE id = gid;
END
$seed_privacy$;

-- ── pub ──────────────────────────────────────────────
DO $seed_pub$
DECLARE gid INTEGER; vid INTEGER;
BEGIN
  SELECT id INTO gid FROM portal_guides WHERE guide_key = 'pub';
  IF gid IS NULL THEN
    RAISE NOTICE 'skip pub: portal_guides にメタ行なし(0094 を先に適用)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM portal_guide_versions WHERE guide_id = gid) THEN
    RETURN; -- 既に版あり。再適用しない(冪等)。
  END IF;
  INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
    VALUES (gid, 1, $g_pub$<!DOCTYPE html><html lang="ja"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>出版契約・書類発行フローガイド</title>
<style>
:root{--navy:#1d3557;--navy-l:#2a4a6e;--red:#e63946;--red-s:#fde8ea;--gold:#c47d1a;--gold-s:#fef3e2;--green:#1d9e75;--green-s:#e4f7f1;--blue:#378add;--blue-s:#e8f1fb;--teal:#085041;--teal-s:#e1f5ee;--g1:#f8f9fa;--g2:#e9ecef;--g3:#dee2e6;--g5:#6c757d;--tx:#212529;--tx2:#495057;--sw:228px;
--ca:#27500a;--cb:#085041}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;font-size:13.5px;line-height:1.7;color:var(--tx);background:#fff}
#sidebar{position:fixed;top:0;left:0;width:var(--sw);height:100vh;background:var(--navy);overflow-y:auto;display:flex;flex-direction:column;z-index:100}
#sh{padding:16px 14px 12px;border-bottom:1px solid rgba(255,255,255,.1)}
#sh h1{font-size:9px;font-weight:700;color:rgba(255,255,255,.45);letter-spacing:.08em;text-transform:uppercase}
#sh p{font-size:11.5px;color:rgba(255,255,255,.92);font-weight:600;margin-top:3px;line-height:1.4}
nav{padding:6px 0 20px}
.ns{display:block;padding:5px 14px;font-size:9px;font-weight:700;color:rgba(255,255,255,.32);letter-spacing:.07em;text-transform:uppercase;margin-top:9px}
.nl{display:block;padding:4px 14px;font-size:11.5px;color:rgba(255,255,255,.7);text-decoration:none;border-left:2px solid transparent;transition:all .15s;line-height:1.4}
.nl:hover,.nl.active{color:#fff;background:rgba(255,255,255,.09);border-left-color:#e63946}
.nsub{display:block;padding:3px 14px 3px 24px;font-size:10.5px;color:rgba(255,255,255,.45);text-decoration:none;transition:color .15s}
.nsub:hover{color:rgba(255,255,255,.82)}
.bdg{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-size:9px;font-weight:700;margin-right:4px;vertical-align:middle}
.bA{background:#eaf3de;color:var(--ca)}.bB{background:var(--teal-s);color:var(--cb)}.b3{background:#faeeda;color:var(--gold)}
#main{margin-left:var(--sw);padding:36px 46px 80px;max-width:calc(var(--sw) + 850px)}
h1.dt{font-size:21px;font-weight:700;color:var(--navy);border-bottom:3px solid var(--navy);padding-bottom:9px;margin-bottom:5px}
.dm{font-size:12px;color:var(--g5);margin-bottom:28px}
.chap{border-radius:8px;padding:16px 22px;margin:32px 0 14px;scroll-margin-top:16px}
.chap.cA{background:var(--ca)}.chap.cB{background:var(--cb)}.chap.c3{background:var(--navy)}
.chap .cn{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px}
.chap h2{font-size:16px;font-weight:700;color:#fff;margin:0}
.chap .cdesc{font-size:12px;color:rgba(255,255,255,.65);margin-top:5px}
h2.sec{font-size:16px;font-weight:700;color:var(--navy);border-left:4px solid var(--navy);padding-left:10px;margin:28px 0 11px;scroll-margin-top:20px}
h3.sub{font-size:13.5px;font-weight:700;color:var(--navy-l);margin:18px 0 9px;padding-bottom:4px;border-bottom:1px solid var(--g3);scroll-margin-top:20px}
h4.sh4{font-size:12.5px;font-weight:700;color:var(--tx2);margin:11px 0 7px}
p{margin-bottom:9px;color:var(--tx2)}strong{color:var(--tx)}
ul,ol{padding-left:20px;margin-bottom:9px;color:var(--tx2)}li{margin-bottom:3px}
/* STEP HEADER */
.shb{border-radius:7px;padding:12px 16px;margin-bottom:14px;scroll-margin-top:16px}
.shb h3{font-size:13.5px;font-weight:700;color:#fff;margin:0}
.shb .sn{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:2px}
.sA{background:var(--ca)}.sB{background:var(--cb)}
/* CALLOUT */
.cl{border-left:3px solid;padding:8px 12px;border-radius:0 5px 5px 0;margin:9px 0;font-size:12.5px}
.cl-w{border-color:var(--red);background:var(--red-s)}.cl-i{border-color:var(--blue);background:var(--blue-s)}.cl-t{border-color:var(--green);background:var(--green-s)}.cl-n{border-color:var(--gold);background:var(--gold-s)}
/* TABLE */
.tw{overflow-x:auto;margin:9px 0}
table{width:100%;border-collapse:collapse;font-size:12px}
thead th{background:var(--navy);color:#fff;padding:7px 9px;text-align:left;font-weight:600;font-size:11.5px;white-space:nowrap}
tbody tr:nth-child(even){background:var(--g1)}
tbody td{padding:6px 9px;border-bottom:1px solid var(--g3);vertical-align:top;line-height:1.55}
tbody tr:hover{background:#f0f4ff}
td.tc{font-weight:600;color:var(--navy);font-size:11.5px;white-space:nowrap}
td.tcr{font-weight:700;color:var(--red)}
td.tcg{font-weight:700;color:var(--green)}
td.law{font-size:11px;color:var(--g5)}
/* CASE COMPARE */
.case-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0}
.case-card{border-radius:7px;padding:16px 18px;border:2px solid}
.case-card.A{border-color:var(--ca);background:#f4f9f0}
.case-card.B{border-color:var(--cb);background:var(--teal-s)}
.case-card h4{font-size:13px;font-weight:700;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid}
.case-card.A h4{color:var(--ca);border-color:var(--ca)}
.case-card.B h4{color:var(--cb);border-color:var(--cb)}
.case-card ul{padding-left:16px;font-size:12px;color:var(--tx2)}
/* STEP TABLE */
.step-tbl thead th{white-space:normal}
.step-num-cell{font-weight:700;color:#fff;text-align:center;font-size:12px;padding:6px 8px;white-space:nowrap}
.step-A{background:var(--ca)}.step-B{background:var(--cb)}
/* CHECKLIST */
.ck{list-style:none;padding:0;margin:7px 0}
.ck li{padding:7px 10px 7px 30px;position:relative;border-bottom:1px solid var(--g2);font-size:12px;color:var(--tx2)}
.ck li::before{content:"☐";position:absolute;left:7px;font-size:13px;color:var(--navy);line-height:1.5}
.ck li:last-child{border-bottom:none}
/* BADGE */
.badge{display:inline-flex;align-items:center;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:3px}
.b-biz{background:#eaf3de;color:var(--ca)}.b-leg{background:#faeeda;color:var(--gold)}.b-au{background:var(--g2);color:#374151;border:1px solid var(--g3)}
.tag{display:inline-block;font-size:9.5px;font-weight:600;padding:1px 5px;border-radius:3px;margin-right:2px}
.t-A{background:#eaf3de;color:var(--ca)}.t-B{background:var(--teal-s);color:var(--cb)}.t-red{background:var(--red-s);color:var(--red)}.t-law{background:#e6effa;color:var(--navy)}
/* DOC BADGE */
.doc-badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;border:1px solid;margin-right:3px;white-space:nowrap}
.doc-A{background:#eaf3de;color:var(--ca);border-color:var(--ca)}.doc-B{background:var(--teal-s);color:var(--cb);border-color:var(--cb)}.doc-both{background:#fef3e2;color:var(--gold);border-color:var(--gold)}
/* MISC */
.ap{background:var(--g1);border-radius:7px;padding:14px 18px;margin-bottom:14px;font-size:12.5px}
hr.sd{border:none;border-top:2px solid var(--g2);margin:30px 0}
.faq-item{margin-bottom:12px}
.faq-q{font-weight:700;color:var(--navy);margin-bottom:4px;font-size:13px}
.faq-a{padding:9px 13px;background:var(--g1);border-radius:4px;font-size:12.5px;color:var(--tx2);border-left:3px solid var(--g3)}
</style>

<style id="gas-portal-back-style">
.portal-back-button{position:fixed;right:16px;bottom:16px;z-index:3000;display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:999px;background:#1d3557;color:#fff;text-decoration:none;font-size:12px;font-weight:700;box-shadow:0 3px 12px rgba(0,0,0,.22);opacity:.92;transition:opacity .15s,transform .15s}
.portal-back-button:hover{opacity:1;transform:translateY(-1px)}
@media print{.portal-back-button{display:none}}
</style>

</head>
<body>
  <?!= include('common_top_tabs', { appUrl: appUrl, currentPage: currentPage }); ?>
<aside id="sidebar">
<div id="sh"><h1>法務部</h1><p>出版事業部<br>契約・書類発行フローガイド</p></div>
<nav>
<a class="nl" href="#top">概要</a>
<a class="nl" href="#classify">ケース分類の考え方</a>
<span class="ns">ケースA：執筆依頼あり</span>
<a class="nl" href="#caseA"><span class="bdg bA">A</span>フロー概要</a>
<a class="nsub" href="#A1">Step 1 条件検討・合意形成</a>
<a class="nsub" href="#A2">Step 2 発注書交付</a>
<a class="nsub" href="#A3">Step 3 執筆着手・作業中</a>
<a class="nsub" href="#A4">Step 4 納品・受領</a>
<a class="nsub" href="#A5">Step 5 検収</a>
<a class="nsub" href="#A6">Step 6 支払</a>
<a class="nsub" href="#A-check">書類チェックリスト</a>
<span class="ns">ケースB：既成原稿あり</span>
<a class="nl" href="#caseB"><span class="bdg bB">B</span>フロー概要</a>
<a class="nsub" href="#B1">Step 1 条件検討・合意形成</a>
<a class="nsub" href="#B2">Step 2 出版契約書の締結</a>
<a class="nsub" href="#B3">Step 3 納品・原稿受領</a>
<a class="nsub" href="#B4">Step 4 支払</a>
<a class="nsub" href="#B-check">書類チェックリスト</a>
<span class="ns">参考</span>
<a class="nl" href="#docs">各書類の記載事項</a>
<a class="nl" href="#faq">Q&amp;A</a>
<a class="nl" href="#laws">関連法令</a>
</nav>
</aside>

<main id="main">
<h1 class="dt" id="top">出版事業部 契約・書類発行フローガイド</h1>
<p class="dm">作成：法務部　｜　著者への執筆依頼から支払いまでの整理</p>

<div class="cl cl-i">このガイドは、出版事業部における<strong>著者との取引を2ケースに分類</strong>し、それぞれの書類発行フローと法令上の義務を整理したものです。まず<a href="#classify" style="color:var(--blue)">ケース分類</a>で自分の取引がどちらかを確認してからフローに進んでください。</div>

<hr class="sd">

<!-- ケース分類 -->
<h2 class="sec" id="classify">ケース分類の考え方</h2>
<p>著者（作家）との取引は、<strong>「執筆を依頼するかどうか」</strong>によって、法的性質・必要書類・支払構造が大きく異なります。</p>

<div class="case-grid">
  <div class="case-card A">
    <h4>ケースA：執筆依頼あり（業務委託）</h4>
    <ul>
      <li><strong>執筆の有無：</strong>当社の依頼に基づいて著者が新たに執筆する</li>
      <li><strong>支払の構造：</strong>①委託報酬（執筆料）＋②利用許諾料（出版契約）の両方が発生</li>
      <li><strong>フリーランス法：</strong>業務委託に該当するため、<strong>発注書交付義務あり</strong></li>
      <li><strong>必要書類：</strong>発注書・検収書・出版契約書・支払通知書</li>
    </ul>
  </div>
  <div class="case-card B">
    <h4>ケースB：既成原稿あり（利用許諾のみ）</h4>
    <ul>
      <li><strong>執筆の有無：</strong>原稿はすでに存在し、当社は出版権・利用許諾のみを得る</li>
      <li><strong>支払の構造：</strong>②利用許諾料のみが発生</li>
      <li><strong>フリーランス法：</strong>業務委託ではないため、発注書交付義務は<strong>原則なし</strong></li>
      <li><strong>必要書類：</strong>出版契約書・支払通知書</li>
    </ul>
  </div>
</div>

<div class="cl cl-w"><strong>加筆修正が生じた場合はケースAとして別処理：</strong> 既成原稿であっても、編集・加筆修正等の作業を当社が依頼する場合、その作業部分は業務委託（ケースA）に該当します。加筆修正が発生した時点でその作業について<strong>発注書（→検収書）を別途発行</strong>し、ケースAのフローで処理してください。</div>

<div class="tw"><table>
<thead><tr><th></th><th>ケース区分</th><th>執筆（制作）の有無</th><th>支払の構造</th></tr></thead>
<tbody>
<tr><td class="tc"><span class="tag t-A">A</span></td><td><strong>執筆依頼あり（業務委託）</strong></td><td>当社の依頼に基づいて著者が新たに執筆する</td><td>①委託報酬（執筆料）＋②利用許諾料（出版契約）</td></tr>
<tr><td class="tc"><span class="tag t-B">B</span></td><td><strong>既成原稿あり（利用許諾のみ）</strong></td><td>原稿はすでに存在し、当社は出版権・利用許諾のみを得る</td><td>②利用許諾料のみ（出版契約）</td></tr>
</tbody></table></div>

<hr class="sd">

<!-- ========== ケースA ========== -->
<div class="chap cA" id="caseA">
  <div class="cn">Case A</div>
  <h2>執筆依頼あり（業務委託）のフロー</h2>
  <div class="cdesc">著者に執筆を依頼する場合。業務委託契約（準委任または請負）と出版利用許諾契約の二層構造。</div>
</div>

<div class="cl cl-n"><strong>支払は：</strong>①執筆料（委託報酬）＋②利用許諾料の<strong>両方</strong>が発生します。</div>

<h3 class="sub">ケースA フロー概要</h3>
<div class="dw" style="background:var(--g1);border:1px solid var(--g3);border-radius:6px;padding:12px 12px 9px;margin:9px 0"><div id="dg-caseA"><svg viewBox="0 0 740 64" style="width: 100%; display: block;"><defs><marker id="fl0a" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#9CA3AF"></polygon></marker></defs><rect x="0" y="1" width="111" height="62" rx="5" fill="#27500a"></rect><text x="55.5" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)">Step 1</text><text x="55.5" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="700" fill="#fff">条件検討・合意形成</text><line x1="113" y1="32" x2="125" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fl0a)"></line><rect x="125" y="1" width="111" height="62" rx="5" fill="#27500a"></rect><text x="180.5" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)">Step 2</text><text x="180.5" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="700" fill="#fff">発注書交付</text><text x="180.5" y="47" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="rgba(255,255,255,.7)">★発注書</text><line x1="238" y1="32" x2="250" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fl0a)"></line><rect x="250" y="1" width="111" height="62" rx="5" fill="#27500a"></rect><text x="305.5" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)">Step 3</text><text x="305.5" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="700" fill="#fff">執筆着手・作業中</text><line x1="363" y1="32" x2="375" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fl0a)"></line><rect x="375" y="1" width="111" height="62" rx="5" fill="#27500a"></rect><text x="430.5" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)">Step 4</text><text x="430.5" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="700" fill="#fff">納品・受領</text><line x1="488" y1="32" x2="500" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fl0a)"></line><rect x="500" y="1" width="111" height="62" rx="5" fill="#27500a"></rect><text x="555.5" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)">Step 5</text><text x="555.5" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="700" fill="#fff">検収</text><text x="555.5" y="47" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="rgba(255,255,255,.7)">★検収書・出版契約書</text><line x1="613" y1="32" x2="625" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fl0a)"></line><rect x="625" y="1" width="111" height="62" rx="5" fill="#27500a"></rect><text x="680.5" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)">Step 6</text><text x="680.5" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="700" fill="#fff">支払</text><text x="680.5" y="47" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="rgba(255,255,255,.7)">★支払通知書</text></svg></div></div>

<div class="tw"><table>
<thead><tr><th style="width:60px">Step</th><th>フェーズ</th><th>発行書類</th><th>担当</th></tr></thead>
<tbody>
<tr><td class="step-num-cell step-A">1</td><td>条件検討・合意形成</td><td>（書類なし）</td><td><span class="badge b-biz">事業部</span></td></tr>
<tr><td class="step-num-cell step-A">2</td><td>発注書交付 <span class="t-red tag">必須</span></td><td><span class="doc-badge doc-A">★ 発注書</span></td><td><span class="badge b-biz">事業部</span> / <span class="badge b-leg">法務</span></td></tr>
<tr><td class="step-num-cell step-A">3</td><td>執筆着手・作業中</td><td>変更が生じた場合：変更合意書</td><td><span class="badge b-biz">事業部</span></td></tr>
<tr><td class="step-num-cell step-A">4</td><td>納品（成果物受領）</td><td>（書類なし）</td><td><span class="badge b-biz">事業部</span></td></tr>
<tr><td class="step-num-cell step-A">5</td><td>検収 <span class="t-red tag">必須</span></td><td><span class="doc-badge doc-A">★ 検収書</span> <span class="doc-badge doc-both">★ 出版契約書</span></td><td><span class="badge b-biz">事業部</span> / <span class="badge b-leg">法務</span></td></tr>
<tr><td class="step-num-cell step-A">6</td><td>支払 <span class="t-red tag">必須</span></td><td><span class="doc-badge doc-A">★ 支払通知書</span></td><td><span class="badge b-biz">事業部</span> / <span class="badge b-leg">法務</span></td></tr>
</tbody></table></div>

<!-- A Step 1 -->
<div class="shb sA" id="A1"><div class="sn">Case A / Step 1</div><h3>条件検討・合意形成</h3></div>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th><th>法令上のポイント</th></tr></thead>
<tbody>
<tr>
  <td><span class="badge b-biz">事業部</span></td>
  <td>執筆内容・分量・納期・報酬額（執筆料・利用許諾料）を協議する。<strong>口頭のみで進めない</strong>（書面化必須）</td>
  <td class="law">フリーランス法第3条：発注前に条件を書面で明示する義務あり。口頭合意後に書面化は法令違反になりうる</td>
</tr>
</tbody></table></div>
<div class="cl cl-w"><strong>口頭のみで条件を決めて進めることは禁止。</strong> 発注書交付（Step 2）まで、発注行為を行わないこと。</div>

<!-- A Step 2 -->
<div class="shb sA" id="A2"><div class="sn">Case A / Step 2</div><h3>発注書交付【必須】</h3></div>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th></tr></thead>
<tbody>
<tr>
  <td style="white-space:nowrap"><span class="badge b-biz">事業部</span></td>
  <td>
    Slackにて <strong><code>/法務依頼</code></strong> から <strong>「発注書（purchase_order）」</strong> を選択し作成依頼を申請する<br>
    <div style="background:#fff;border:1px solid var(--g3);border-radius:5px;padding:10px 14px;margin-top:8px;font-size:11.5px;">
      <strong style="font-size:11px;color:var(--g5)">📝 入力フォームの記入項目</strong>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;">
        <div>・依頼種別：<strong>発注書 (purchase_order)</strong></div>
        <div>・件名：案件名（著作物タイトル等）</div>
        <div>・希望納期（文書作成等）：発注書が必要な日</div>
        <div>・相手方名称：著者の氏名（正式名称）</div>
        <div>・区分：個人 / 法人を選択</div>
        <div>・法人番号 / 社内個人コード：13桁の番号または社内コード</div>
        <div style="grid-column:1/-1">・相談・依頼詳細：執筆内容・分量・納期・報酬額（執筆料）・支払条件・検収期間等を記載</div>
      </div>
    </div>
  </td>
</tr>
<tr>
  <td style="white-space:nowrap"><span class="badge b-leg">法務部</span></td>
  <td>依頼内容に応じて発注書を作成。事業部が著者に内容確認後、<strong>クラウドサインで著者へ送信</strong>（正式な書面交付）</td>
</tr>
<tr>
  <td style="white-space:nowrap"><span class="badge b-au">著者</span></td>
  <td>クラウドサインで発注書を確認・署名（受領・承諾）</td>
</tr>
</tbody></table></div>
<div class="cl cl-w"><strong>発注書の交付は発注前または発注と同時に行うこと。</strong> 受領後の一方的変更は原則禁止。変更時は変更合意書が必要。</div>
<div class="cl cl-i"><strong>【フリーランス法第3条】発注書の必須記載事項：</strong> ①業務内容・②報酬額（執筆料）・③支払期日（受領日から60日以内）・④納期/納品方法・⑤検収期間</div>

<!-- A Step 3 -->
<div class="shb sA" id="A3"><div class="sn">Case A / Step 3</div><h3>執筆着手・作業中</h3></div>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th><th>法令上のポイント</th></tr></thead>
<tbody>
<tr>
  <td><span class="badge b-au">著者</span></td>
  <td>執筆を開始する</td>
  <td class="law">フリーランス法第4条：受託後の不当な変更・キャンセル禁止</td>
</tr>
<tr>
  <td><span class="badge b-biz">事業部</span></td>
  <td>途中変更が必要な場合は<strong>変更合意書を発行</strong>する。条件の一方的変更は禁止</td>
  <td class="law">やむを得ない場合も著者の同意が必要</td>
</tr>
</tbody></table></div>

<!-- A Step 4 -->
<div class="shb sA" id="A4"><div class="sn">Case A / Step 4</div><h3>納品（成果物受領）</h3></div>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th><th>法令上のポイント</th></tr></thead>
<tbody>
<tr>
  <td><span class="badge b-au">著者</span></td>
  <td>原稿・成果物を納品する</td>
  <td class="law">—</td>
</tr>
<tr>
  <td><span class="badge b-biz">事業部</span></td>
  <td>成果物を受領し、<strong>受領日を必ず記録する</strong>（60日ルールの起算日）</td>
  <td class="law">フリーランス法第3条・第5条：受領日が支払期限の起算日。検収期間内に合否通知がない場合は「みなし合格」</td>
</tr>
</tbody></table></div>
<div class="cl cl-n"><strong>受領日の記録は必須。</strong> 受領日から60日以内に支払を完了する義務が発生します。</div>

<!-- A Step 5 -->
<div class="shb sA" id="A5"><div class="sn">Case A / Step 5</div><h3>検収【必須】</h3></div>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th></tr></thead>
<tbody>
<tr>
  <td style="white-space:nowrap"><span class="badge b-biz">事業部</span></td>
  <td>
    発注書の仕様と成果物を照合し、合否を判断する<br>
    <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px;background:var(--green-s);border-left:3px solid var(--green);padding:8px 12px;border-radius:0 4px 4px 0;font-size:12px;">
        <strong style="color:var(--green)">合格の場合</strong><br>
        Slackの <code>/法務依頼</code> から<strong>「納品 / 検収書（delivery_inspec）」</strong>作成依頼を送信する
        <div style="background:#fff;border:1px solid var(--g3);border-radius:5px;padding:8px 12px;margin-top:6px;font-size:11px;">
          <strong style="color:var(--g5)">📝 入力フォームの記入項目</strong><br>
          ・依頼種別：<strong>納品 / 検収書 (delivery_inspec)</strong><br>
          ・件名：案件名（著作物タイトル等）<br>
          ・相手方名称・区分・法人番号<br>
          ・相談・依頼詳細：発注番号・納品内容・合格日等
        </div>
      </div>
      <div style="flex:1;min-width:200px;background:var(--red-s);border-left:3px solid var(--red);padding:8px 12px;border-radius:0 4px 4px 0;font-size:12px;">
        <strong style="color:var(--red)">不合格の場合</strong><br>
        理由と是正指示を<strong>書面（メール等）</strong>で著者へ通知し再納品を求める<br>
        <span style="font-size:10.5px;color:var(--g5)">※ 期限内に通知がない場合はみなし合格（フリ法第5条第2項）</span>
      </div>
    </div>
  </td>
</tr>
<tr>
  <td style="white-space:nowrap"><span class="badge b-leg">法務部</span></td>
  <td>検収書を作成し、<strong>支払申請用Excelファイルを添付して</strong>事業部へ共有する。あわせて<strong>出版契約書</strong>を作成・クラウドサインで送信する</td>
</tr>
<tr>
  <td style="white-space:nowrap"><span class="badge b-biz">事業部</span></td>
  <td>共有された検収書を著者へ送信する</td>
</tr>
</tbody></table></div>
<div class="cl cl-i"><strong>出版契約書の締結タイミング：</strong> 原則として検収完了後が最も安全。ただし条件が確定しているなら「検収完了を停止条件とした出版契約書の締結」として検収前に締結することも可能（→ <a href="#faq" style="color:var(--blue)">Q&amp;A Q2</a> 参照）。</div>

<!-- A Step 6 -->
<div class="shb sA" id="A6"><div class="sn">Case A / Step 6</div><h3>支払【必須】</h3></div>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th><th>法令上のポイント</th></tr></thead>
<tbody>
<tr>
  <td><span class="badge b-biz">事業部</span></td>
  <td>①執筆料（委託報酬）と②利用許諾料をそれぞれ支払申請する。受領日から原則<strong>60日以内</strong>に完了</td>
  <td class="law">フリーランス法第6条：支払期日は受領日から60日以内。超える期日は無効。遅延損害金は年14.6%</td>
</tr>
<tr>
  <td><span class="badge b-leg">法務部</span></td>
  <td>支払通知書（利用許諾料報告書）を発行し著者へ交付する<br>
  <span style="font-size:11.5px;color:var(--g5)">※ 著者から請求書が届いていなくても支払通知書を根拠に支払可能</span></td>
  <td class="law">インボイス制度：著者が適格請求書発行事業者か確認要。源泉徴収義務（10.21%）に注意</td>
</tr>
</tbody></table></div>

<!-- A チェックリスト -->
<h3 class="sub" id="A-check">ケースA 書類チェックリスト</h3>
<ul class="ck">
<li><span class="doc-badge doc-A">発注書（業務委託発注書）</span> → 発注前または発注時にクラウドサインで交付</li>
<li><span class="doc-badge doc-A">検収書</span> → 納品受領・検収完了時に <code>/法務依頼</code> から依頼</li>
<li><span class="doc-badge doc-both">出版契約書（利用許諾契約）</span> → 検収完了時（または条件確定後）にクラウドサインで締結</li>
<li><span class="doc-badge doc-A">支払通知書（利用許諾料報告書）</span> → 支払時に発行・著者へ交付</li>
</ul>

<hr class="sd">

<!-- ========== ケースB ========== -->
<div class="chap cB" id="caseB">
  <div class="cn">Case B</div>
  <h2>既成原稿あり（利用許諾のみ）のフロー</h2>
  <div class="cdesc">著者がすでに執筆を完了している原稿について、当社が出版権・利用許諾を得るケース。</div>
</div>

<div class="cl cl-t"><strong>支払は：</strong>②利用許諾料<strong>のみ</strong>が発生します。発注書交付義務は原則なし。</div>

<h3 class="sub">ケースB フロー概要</h3>
<div class="dw" style="background:var(--g1);border:1px solid var(--g3);border-radius:6px;padding:12px 12px 9px;margin:9px 0"><div id="dg-caseB"><svg viewBox="0 0 740 64" style="width: 100%; display: block;"><defs><marker id="fl1a" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#9CA3AF"></polygon></marker></defs><rect x="0" y="1" width="174" height="62" rx="5" fill="#085041"></rect><text x="87" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)">Step 1</text><text x="87" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="700" fill="#fff">条件検討・合意形成</text><line x1="176" y1="32" x2="188" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fl1a)"></line><rect x="188" y="1" width="174" height="62" rx="5" fill="#085041"></rect><text x="275" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)">Step 2</text><text x="275" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="700" fill="#fff">出版契約書の締結</text><text x="275" y="47" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="rgba(255,255,255,.7)">★出版契約書</text><line x1="364" y1="32" x2="376" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fl1a)"></line><rect x="376" y="1" width="174" height="62" rx="5" fill="#085041"></rect><text x="463" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)">Step 3</text><text x="463" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="700" fill="#fff">納品（原稿受領）</text><line x1="552" y1="32" x2="564" y2="32" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#fl1a)"></line><rect x="564" y="1" width="174" height="62" rx="5" fill="#085041"></rect><text x="651" y="20" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)">Step 4</text><text x="651" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="700" fill="#fff">支払</text><text x="651" y="47" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="rgba(255,255,255,.7)">★支払通知書</text></svg></div></div>

<div class="tw"><table>
<thead><tr><th style="width:60px">Step</th><th>フェーズ</th><th>発行書類</th><th>担当</th></tr></thead>
<tbody>
<tr><td class="step-num-cell step-B">1</td><td>条件検討・合意形成</td><td>（書類なし）</td><td><span class="badge b-biz">事業部</span></td></tr>
<tr><td class="step-num-cell step-B">2</td><td>出版契約書の締結 <span class="t-red tag">必須</span></td><td><span class="doc-badge doc-both">★ 出版契約書</span></td><td><span class="badge b-biz">事業部</span> / <span class="badge b-leg">法務</span></td></tr>
<tr><td class="step-num-cell step-B">3</td><td>納品（原稿・データ受領）</td><td>（受領記録のみ・社内管理）</td><td><span class="badge b-biz">事業部</span></td></tr>
<tr><td class="step-num-cell step-B">4</td><td>支払</td><td><span class="doc-badge doc-B">★ 支払通知書</span></td><td><span class="badge b-biz">事業部</span> / <span class="badge b-leg">法務</span></td></tr>
</tbody></table></div>

<!-- B Step 1 -->
<div class="shb sB" id="B1"><div class="sn">Case B / Step 1</div><h3>条件検討・合意形成</h3></div>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th><th>法令上のポイント</th></tr></thead>
<tbody>
<tr>
  <td><span class="badge b-biz">事業部</span></td>
  <td>出版条件（利用許諾の範囲・印税率・利用許諾料等）を著者と協議する</td>
  <td class="law">ケースBは業務委託ではなく利用許諾契約のため、フリーランス法の「発注書交付義務」は原則として適用されない。ただし加筆修正等の作業依頼が含まれる場合は発注書が必要</td>
</tr>
</tbody></table></div>
<div class="cl cl-w"><strong>加筆修正の依頼が発生した瞬間に、その作業部分は業務委託（ケースA）に該当します。</strong> ケースBのままでは処理できないため、即座に発注書（→検収書）の発行へ切り替えること。</div>

<!-- B Step 2 -->
<div class="shb sB" id="B2"><div class="sn">Case B / Step 2</div><h3>出版契約書（利用許諾契約）の締結</h3></div>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th><th>法令上のポイント</th></tr></thead>
<tbody>
<tr>
  <td style="white-space:nowrap"><span class="badge b-biz">事業部</span></td>
  <td>条件が確定したら法務部へ出版契約書の作成を依頼する（<code>/法務依頼</code>）</td>
  <td class="law">著作権法第63条：利用許諾は書面で行うことが望ましい（口頭でも有効だが証明困難）</td>
</tr>
<tr>
  <td style="white-space:nowrap"><span class="badge b-leg">法務部</span></td>
  <td>出版契約書を作成し、<strong>クラウドサインで著者へ送信</strong>する</td>
  <td class="law">発注書がないため、<strong>本契約書が取引条件の唯一の根拠</strong>となる。許諾範囲（電子書籍・翻訳・二次利用等）を明示すること</td>
</tr>
<tr>
  <td style="white-space:nowrap"><span class="badge b-au">著者</span></td>
  <td>クラウドサインで出版契約書を確認・署名（締結完了）</td>
  <td class="law">著作権の譲渡と利用許諾は異なる。著作権者が著者のまま残る（許諾）ことを確認</td>
</tr>
</tbody></table></div>

<!-- B Step 3 -->
<div class="shb sB" id="B3"><div class="sn">Case B / Step 3</div><h3>納品（原稿・データ受領）</h3></div>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th><th>法令上のポイント</th></tr></thead>
<tbody>
<tr>
  <td><span class="badge b-au">著者</span></td>
  <td>原稿データを納品する</td>
  <td class="law">—</td>
</tr>
<tr>
  <td><span class="badge b-biz">事業部</span></td>
  <td>著者から原稿データを受領し、<strong>受領日を必ず記録する</strong>（社内記録で足りる）</td>
  <td class="law">ケースBは利用許諾のみのため、フリーランス法上の検収義務は発生しない。<strong>検収書は不要</strong></td>
</tr>
</tbody></table></div>
<div class="cl cl-w"><strong>この段階で加筆修正依頼が生じた場合は、その作業部分についてケースAのフロー（発注書→検収書）を別途実施すること。</strong></div>

<!-- B Step 4 -->
<div class="shb sB" id="B4"><div class="sn">Case B / Step 4</div><h3>支払</h3></div>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th><th>法令上のポイント</th></tr></thead>
<tbody>
<tr>
  <td><span class="badge b-biz">事業部</span></td>
  <td>利用許諾料（印税等）を支払申請する。支払サイクルは出版契約書の定めに従う</td>
  <td class="law">フリーランス法の60日ルールは業務委託のみに適用されるが、遅延は信頼関係を損なうため適切に管理すること</td>
</tr>
<tr>
  <td><span class="badge b-leg">法務部</span></td>
  <td>支払通知書（利用許諾料報告書）を発行し著者へ交付する</td>
  <td class="law">インボイス制度：著者が適格請求書発行事業者か確認要。源泉徴収義務（10.21%）に注意</td>
</tr>
</tbody></table></div>

<!-- B チェックリスト -->
<h3 class="sub" id="B-check">ケースB 書類チェックリスト</h3>
<ul class="ck">
<li><span class="doc-badge doc-both">出版契約書（利用許諾契約）</span> → 条件確定・合意時にクラウドサインで締結</li>
<li><span class="doc-badge doc-B">支払通知書（利用許諾料報告書）</span> → 支払時に発行・著者へ交付</li>
</ul>
<div class="cl cl-w"><strong>加筆修正依頼が生じた場合は、その作業分についてケースAのフロー（発注書・検収書）を別途実施すること。</strong></div>

<hr class="sd">

<!-- 各書類の記載事項 -->
<h2 class="sec" id="docs">各書類の主な記載事項</h2>
<div class="tw"><table>
<thead><tr><th>書類名</th><th>主な必須記載事項</th><th>法令根拠・備考</th></tr></thead>
<tbody>
<tr>
  <td class="tc"><span class="doc-badge doc-A">発注書</span><br>業務委託発注書</td>
  <td>①業務内容（執筆テーマ・仕様・分量）②報酬額（執筆料）および消費税額③納期・納品方法④支払期日（受領日から60日以内）⑤検収期間と検収方法⑥契約不適合時の対応⑦再委託の可否⑧キャンセル・変更条件</td>
  <td class="law">フリーランス法第3条に基づく書面交付義務。電磁的方法（PDFメール等）での交付も可。発注前または発注と同時に交付</td>
</tr>
<tr>
  <td class="tc"><span class="doc-badge doc-A">検収書</span></td>
  <td>①発注書番号との紐付け②成果物の内容・数量③受領日④検収結果（合格/不合格）⑤合格の場合：確定した委託報酬額⑥不合格の場合：理由と是正要求内容</td>
  <td class="law">フリーランス法第5条：受領日から60日以内に検収完了・合否通知。通知なき場合はみなし合格（著者に有利）</td>
</tr>
<tr>
  <td class="tc"><span class="doc-badge doc-both">出版契約書</span><br>利用許諾契約</td>
  <td>①著作物の特定（タイトル・内容等）②利用許諾の範囲（紙・電子・翻訳等）③許諾期間・地域④利用許諾料の算定方法（印税率・部数連動等）⑤支払時期・方法⑥著作者人格権の扱い⑦改訂・絶版の条件⑧著作権侵害時の対応</td>
  <td class="law">著作権法第63条。著作権の「譲渡」と「利用許諾」を明確に区別すること。本契約が利用許諾料支払の根拠</td>
</tr>
<tr>
  <td class="tc"><span class="doc-badge doc-A">支払通知書</span><span class="doc-badge doc-B" style="margin-top:3px;display:inline-block">利用許諾料報告書</span></td>
  <td>①支払対象期間・対象著作物②販売部数・販売金額（部数連動の場合）③利用許諾料算定内訳④支払金額（税込・税抜）⑤源泉徴収額（10.21%）⑥実際の振込額⑦支払予定日</td>
  <td class="law">請求書なしでも支払い可能な根拠書類。インボイス制度対応：著者が適格請求書発行事業者か確認要</td>
</tr>
</tbody></table></div>

<hr class="sd">

<!-- FAQ -->
<h2 class="sec" id="faq">よくある疑問（Q&amp;A）</h2>
<div class="faq-item">
<div class="faq-q">Q1. 納期の記載を拒む著者や、納期が事前から不明確な場合の対応は？</div>
<div class="faq-a">納期はフリーランス法の必須記載事項ではありませんが、業務内容・報酬額・支払期日は必須です。納期を明示できない場合は「別途協議の上定める」と記載し、合意した時点で変更合意書を発行する方法が現実的です。支払期日は受領日から起算するため、納品が遅れても支払期日はその受領日から60日以内となります。可能な限り目安を記載することを推奨します。</div>
</div>
<div class="faq-item">
<div class="faq-q">Q2. 出版契約書を締結するタイミングはいつが適切か？</div>
<div class="faq-a">原則として「検収完了後」が最も安全です。検収前に出版契約書を締結すると、成果物が発注内容を満たさない場合でも利用許諾が先行して成立するリスクがあります。ただし著者が早期に契約確保を希望する場合は、「検収または原稿受領を停止条件とした出版契約書の締結」として対応することが可能です。ケースBであれば発注書がないため、出版契約書が主要な合意書類となり、条件確定後に速やかに締結することが推奨されます。</div>
</div>
<div class="faq-item">
<div class="faq-q">Q3. 支払通知書は、著者から請求書が届いている場合も発行が必要か？</div>
<div class="faq-a">請求書と支払通知書は目的が異なります。請求書は著者側からの支払請求であり、支払通知書は当社側からの支払内容の通知・明細です。特に部数連動の印税計算がある場合は報告書の発行が実務上の標準です。請求書が届いていない著者への支払も、支払通知書を根拠に行うことができます。</div>
</div>
<div class="faq-item">
<div class="faq-q">Q4. 既成原稿でも加筆修正がある場合、発注書は必要か？</div>
<div class="faq-a">加筆修正作業を当社が依頼する場合、その作業部分はフリーランス法上の「業務委託」に該当し、発注書の交付義務が生じます。実務上は「出版契約書＋修正作業に関する発注書」の二本立てで対応するか、修正作業が軽微な場合は出版契約書の中に修正作業の条件（報酬・期限・仕様）を明記するかたちで対応してください。不明な場合は法務部に相談してください。</div>
</div>

<hr class="sd">

<!-- 関連法令 -->
<h2 class="sec" id="laws">主な関連法令</h2>
<div class="tw"><table>
<thead><tr><th>法令名</th><th>本フローに関連する主な規制内容</th></tr></thead>
<tbody>
<tr><td class="tc">フリーランス保護法<br><span style="font-size:10px;font-weight:400">2024年11月施行</span></td><td>業務委託時の書面交付義務（第3条）、報酬の支払期日（受領日から60日以内、第6条）、一方的な業務内容変更・キャンセルの禁止（第4条）、みなし合格（第5条）、遅延損害金（年14.6%、第10条）</td></tr>
<tr><td class="tc">著作権法</td><td>著作権の利用許諾（第63条）、著作者人格権（第18〜20条）、職務著作（第15条）。著作権の譲渡と利用許諾の区別が重要</td></tr>
<tr><td class="tc">所得税法・<br>インボイス制度</td><td>著者への支払時、源泉徴収義務（10.21%）が発生する場合がある。インボイス制度（2023年10月〜）：著者が適格請求書発行事業者でない場合、仕入税額控除に影響</td></tr>
</tbody></table></div>

<div style="background:var(--navy);border-radius:8px;padding:18px 22px;margin-top:28px;text-align:center">
<div style="font-size:10px;color:rgba(255,255,255,.45);margin-bottom:5px">お問い合わせ先</div>
<div style="font-size:17px;font-weight:700;color:#fff;margin-bottom:3px">Arclight Inc. 経営管理本部 法務部</div>
<div style="font-size:12px;color:rgba(255,255,255,.65)">個別事案についてはお気軽にご相談ください</div>
</div>
</main>




</body></html>$g_pub$, 'seed 0095 (from services/api/guides)', 'seed')
    RETURNING id INTO vid;
  UPDATE portal_guides
     SET current_version_id = vid, status = 'published', updated_at = now()
   WHERE id = gid;
END
$seed_pub$;

-- ── tetsuzuki ──────────────────────────────────────────────
DO $seed_tetsuzuki$
DECLARE gid INTEGER; vid INTEGER;
BEGIN
  SELECT id INTO gid FROM portal_guides WHERE guide_key = 'tetsuzuki';
  IF gid IS NULL THEN
    RAISE NOTICE 'skip tetsuzuki: portal_guides にメタ行なし(0094 を先に適用)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM portal_guide_versions WHERE guide_id = gid) THEN
    RETURN; -- 既に版あり。再適用しない(冪等)。
  END IF;
  INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
    VALUES (gid, 1, $g_tetsuzuki$<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ライセンス契約・業務委託契約 取引社内手続きガイド</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;font-size:13.5px;line-height:1.7;color:#212529;background:#fff}
a{color:inherit}
@media print{
  .g-sidebar-torihiki{display:none!important}
  .g-main-torihiki{margin-left:0!important;max-width:none!important;padding:20px!important}
}

/* == torihiki == */

:root{--navy:#1d3557;--navy-l:#2a4a6e;--red:#e63946;--red-s:#fde8ea;--gold:#c47d1a;--gold-s:#fef3e2;--green:#1d9e75;--green-s:#e4f7f1;--blue:#378add;--blue-s:#e8f1fb;--teal:#085041;--teal-s:#e1f5ee;--g1:#f8f9fa;--g2:#e9ecef;--g3:#dee2e6;--g5:#6c757d;--tx:#212529;--tx2:#495057;--sw:228px;
--ph1:#27500a;--ph2:#0c447c;--ph3:#633806;--ph4:#1d9e75;--ph5:#6b1f7a;--ph6:#a32d2d}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;font-size:13.5px;line-height:1.7;color:var(--tx);background:#fff}
.g-sidebar-torihiki{position:fixed;top:0;left:0;width:var(--sw);height:100vh;background:var(--navy);overflow-y:auto;display:flex;flex-direction:column;z-index:100}
.g-sh-torihiki{padding:16px 14px 12px;border-bottom:1px solid rgba(255,255,255,.1)}
.g-sh-torihiki h1{font-size:9px;font-weight:700;color:rgba(255,255,255,.45);letter-spacing:.08em;text-transform:uppercase}
.g-sh-torihiki p{font-size:11.5px;color:rgba(255,255,255,.92);font-weight:600;margin-top:3px;line-height:1.4}
nav{padding:6px 0 20px}
.ns{display:block;padding:5px 14px;font-size:9px;font-weight:700;color:rgba(255,255,255,.32);letter-spacing:.07em;text-transform:uppercase;margin-top:9px}
.nl{display:block;padding:4px 14px;font-size:11.5px;color:rgba(255,255,255,.7);text-decoration:none;border-left:2px solid transparent;transition:all .15s;line-height:1.4}
.nl:hover,.nl.active{color:#fff;background:rgba(255,255,255,.09);border-left-color:#e63946}
.nsub{display:block;padding:3px 14px 3px 24px;font-size:10.5px;color:rgba(255,255,255,.45);text-decoration:none;transition:color .15s}
.nsub:hover{color:rgba(255,255,255,.82)}
.bdg{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-size:9px;font-weight:700;margin-right:4px;vertical-align:middle}
.b1{background:#eaf3de;color:var(--ph1)}.b2{background:#e8f1fb;color:var(--ph2)}.b3{background:#faeeda;color:var(--ph3)}
.g-main-torihiki{margin-left:var(--sw);padding:36px 46px 80px;max-width:calc(var(--sw) + 850px)}
h1.dt{font-size:21px;font-weight:700;color:var(--navy);border-bottom:3px solid var(--navy);padding-bottom:9px;margin-bottom:5px}
.dm{font-size:12px;color:var(--g5);margin-bottom:28px}
/* CHAPTER HEADER */
.chap{border-radius:8px;padding:16px 22px;margin:36px 0 16px;scroll-margin-top:16px}
.chap.c1{background:var(--ph1)}.chap.c2{background:var(--ph2)}.chap.c3{background:var(--teal)}
.chap .cn{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px}
.chap h2{font-size:16px;font-weight:700;color:#fff;margin:0}
.chap .cdesc{font-size:12px;color:rgba(255,255,255,.65);margin-top:5px}
/* SECTION */
h2.sec{font-size:16px;font-weight:700;color:var(--navy);border-left:4px solid var(--navy);padding-left:10px;margin:28px 0 11px;scroll-margin-top:20px}
h3.sub{font-size:13.5px;font-weight:700;color:var(--navy-l);margin:18px 0 9px;padding-bottom:4px;border-bottom:1px solid var(--g3);scroll-margin-top:20px}
h4.sh4{font-size:12.5px;font-weight:700;color:var(--tx2);margin:11px 0 7px}
p{margin-bottom:9px;color:var(--tx2)}strong{color:var(--tx)}
ul,ol{padding-left:20px;margin-bottom:9px;color:var(--tx2)}li{margin-bottom:3px}
/* PHASE STEP HEADER */
.shb{border-radius:7px;padding:12px 16px;margin-bottom:14px;scroll-margin-top:16px}
.shb h3{font-size:13.5px;font-weight:700;color:#fff;margin:0}
.shb .sn{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:2px}
.ph1s{background:var(--ph1)}.ph2s{background:var(--ph2)}.ph3s{background:var(--ph3)}.ph4s{background:var(--ph4)}.ph5s{background:var(--ph5)}.ph6s{background:var(--ph6)}
/* CALLOUT */
.cl{border-left:3px solid;padding:8px 12px;border-radius:0 5px 5px 0;margin:9px 0;font-size:12.5px}
.cl-w{border-color:var(--red);background:var(--red-s)}.cl-i{border-color:var(--blue);background:var(--blue-s)}.cl-t{border-color:var(--green);background:var(--green-s)}.cl-n{border-color:var(--gold);background:var(--gold-s)}.cl-tl{border-color:var(--teal);background:var(--teal-s)}
/* TABLE */
.tw{overflow-x:auto;margin:9px 0}
table{width:100%;border-collapse:collapse;font-size:12px}
thead th{background:var(--navy);color:#fff;padding:7px 9px;text-align:left;font-weight:600;font-size:11.5px;white-space:nowrap}
tbody tr:nth-child(even){background:var(--g1)}
tbody td{padding:6px 9px;border-bottom:1px solid var(--g3);vertical-align:top;line-height:1.55}
tbody tr:hover{background:#f0f4ff}
td.tc{font-weight:600;color:var(--navy);font-size:11.5px}
td.tcr{font-weight:700;color:var(--red)}
td.tcg{font-weight:700;color:var(--green)}
td.tco{font-weight:700;color:var(--gold)}
/* STEP BOX */
.step-box{background:var(--g1);border:1px solid var(--g3);border-left:4px solid var(--navy);border-radius:0 6px 6px 0;padding:12px 15px;margin:8px 0}
.step-num{display:inline-block;background:var(--navy);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;margin-bottom:6px;letter-spacing:.04em}
/* COMPARE 2-COL */
.cmp{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
.cmp-card{border-radius:6px;padding:14px 16px}
.cmp-card.law{background:var(--navy);color:#fff}
.cmp-card.fl{background:var(--teal);color:#fff}
.cmp-card h4{font-size:12.5px;font-weight:700;margin-bottom:7px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,.2)}
.cmp-card ul{padding-left:16px;font-size:11.5px;line-height:1.75;color:rgba(255,255,255,.88)}
.cmp-card strong{color:#fff}.cmp-card li{color:rgba(255,255,255,.88)}
.cmp-label{font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px}
/* SELL/CONSIGN 2-COL */
.sc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
.sc-card{border-radius:6px;padding:14px 16px;border:1px solid}
.sc-card.sell{background:var(--g1);border-color:var(--g3)}
.sc-card.consign{background:var(--red-s);border-color:#f5c6cb}
.sc-card h4{font-size:12.5px;font-weight:700;margin-bottom:8px}
.sc-card ul{padding-left:16px;font-size:11.5px;line-height:1.75;color:var(--tx2)}
/* PHASE FLOW BAR */
.phase-flow{display:flex;gap:0;margin:12px 0;overflow-x:auto}
.pf-item{flex:1;min-width:0;text-align:center}
.pf-box{padding:8px 3px;font-size:10.5px;font-weight:700;color:#fff;border-radius:4px;margin:0 2px;line-height:1.35}
.pf-box .pnum{font-size:13px;font-weight:700;opacity:.45;display:block}
/* BADGE / TAG */
.badge{display:inline-flex;align-items:center;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:3px}
.b-law{background:#e6effa;color:var(--navy)}.b-fl{background:var(--teal-s);color:var(--teal)}.b-red{background:var(--red-s);color:var(--red)}
.tag{display:inline-block;font-size:9.5px;font-weight:600;padding:1px 5px;border-radius:3px;margin-right:2px}
.t-law{background:#e6effa;color:var(--navy)}.t-fl{background:var(--teal-s);color:var(--teal)}.t-gold{background:#fef3e2;color:var(--gold)}.t-red{background:var(--red-s);color:var(--red)}
/* TIMELINE */
.timeline{display:flex;margin:12px 0;border:1px solid var(--g3);border-radius:6px;overflow:hidden}
.tl-item{flex:1;padding:10px 8px;text-align:center;font-size:11px}
.tl-item:not(:last-child){border-right:1px solid var(--g3)}
.tl-item.ts{background:var(--navy);color:#fff}
.tl-item.tm{background:#faeeda;color:#633806}
.tl-item.te{background:var(--red-s);color:var(--red)}
.tl-item .tll{font-size:9px;font-weight:700;opacity:.65;margin-bottom:3px}
.tl-item .tlv{font-size:13px;font-weight:700}
/* CHECK LIST */
.ck{list-style:none;padding:0;margin:7px 0}
.ck li{padding:7px 10px 7px 30px;position:relative;border-bottom:1px solid var(--g2);font-size:12px;color:var(--tx2)}
.ck li::before{content:"☐";position:absolute;left:7px;font-size:13px;color:var(--navy);line-height:1.5}
.ck li:last-child{border-bottom:none}
.pl{list-style:none;padding:0;margin:7px 0}
.pl li{padding:6px 10px 6px 26px;position:relative;border-bottom:1px solid var(--g2);font-size:12px;color:var(--tx2)}
.pl li::before{content:"⚠";position:absolute;left:6px;font-size:11px}
.pl li:last-child{border-bottom:none}
.ap{background:var(--g1);border-radius:7px;padding:14px 18px;margin-bottom:14px}
hr.sd{border:none;border-top:2px solid var(--g2);margin:30px 0}
.dw{background:var(--g1);border:1px solid var(--g3);border-radius:6px;padding:12px 12px 9px;margin:9px 0}
.faq-item{margin-bottom:11px}
.faq-q{font-weight:700;color:var(--navy);margin-bottom:4px;font-size:13px}
.faq-a{padding:8px 12px;background:var(--g1);border-radius:4px;font-size:12.5px;color:var(--tx2)}
.act{display:flex;align-items:stretch;border:1px solid var(--g3);border-radius:6px;overflow:hidden;margin:7px 0;background:#fff}
.act-l{flex:0 0 78px;display:flex;align-items:center;justify-content:center;text-align:center;padding:9px 5px;font-weight:700;font-size:13px;line-height:1.3}
.act-b{flex:1;padding:9px 13px;font-size:13.5px;line-height:1.65}
.act-jg{background:#eaf3de;color:var(--ph1)}
.act-kn{background:#faeeda;color:var(--ph3)}
.act-tr{background:#eef0f2;color:#495057}
.act-ar{text-align:center;color:#9aa1a8;font-size:14px;line-height:1;margin:-1px 0 4px}
</style>
</head>
<body>
 <?!= include('common_top_tabs', { appUrl: appUrl, currentPage: currentPage }); ?>
<aside class="g-sidebar-torihiki">
<div class="g-sh-torihiki"><h1>法務部</h1><p>ライセンス契約・業務委託契約<br>取引社内手続きガイド</p></div>
<nav>
<a class="nl" href="#top">概要</a>
<a class="nsub" href="#access">アクセス・入口</a>
<span class="ns">手続きステップ</span>
<a class="nl" href="#s1"><span class="bdg b1">1</span>取引の決定</a>
<a class="nl" href="#s2"><span class="bdg b2">2</span>取引先検索</a>
<a class="nl" href="#s3"><span class="bdg b3">3</span>文書作成・審査依頼</a>
<a class="nsub" href="#form">依頼フォームの記入</a>
<a class="nl" href="#s4"><span class="bdg b1">4</span>締結手続き</a>
<a class="nl" href="#s5"><span class="bdg b2">5</span>支払</a>
<a class="nsub" href="#paydoc">支払文書の作成依頼</a>
<a class="nsub" href="#payapply">支払申請</a>
</nav>
</aside>

<main class="g-main-torihiki">
<h1 class="dt" id="top">ライセンス契約・業務委託契約 取引社内手続きガイド</h1>
<p class="dm">v2.5　Arclight Inc. 経営管理本部 法務部　2026年6月29日　｜　LegalBridge 運用編　｜　法的根拠は「業務委託取引 法解釈ガイド」を参照</p>

<div class="cl cl-i">取引が決まったら、<strong>下の5ステップを上から順に進める</strong>だけです。各作業の頭に<strong>担当（<span class="tag" style="background:#eaf3de;color:var(--ph1);font-weight:700;margin-right:4px">事業部</span>/<span class="tag" style="background:#faeeda;color:var(--ph3);font-weight:700;margin-right:4px">管理部</span>）</strong>を付けています。「この取引は法律の対象か？」などの法的判断は別冊「<strong>業務委託取引 法解釈ガイド</strong>」を参照してください。</div>
<div class="cl cl-n" style="font-size:11.5px"><strong>凡例：</strong><span class="tag" style="background:#eaf3de;color:var(--ph1);font-weight:700;margin-right:4px">事業部</span> 現場の作業　／　<span class="tag" style="background:#faeeda;color:var(--ph3);font-weight:700;margin-right:4px">管理部</span> 法務・経理等の作業　／　<span class="tag" style="background:#eef0f2;color:#495057;font-weight:700;margin-right:4px">取引先</span> 相手方の作業</div>

<div class="cl cl-w"><strong>⚠ 売買取引について：</strong>売買取引は、本ガイドのうち <strong>基本契約書の作成</strong> と <strong>他社文書のレビュー依頼</strong> のみが対象です。<strong>支払申請の方法は従来どおり</strong>です（本ガイドの STEP 5「支払文書の作成・支払申請」は対象外）。</div>

<h2 class="sec" id="access">アクセス・入口</h2>
<div class="tw"><table>
<thead><tr><th>用途</th><th>入口</th></tr></thead>
<tbody>
<tr><td class="tc">取引先・契約の検索</td><td>次のいずれかから検索する：<br>・Slack <code>/法務検索 [取引先名]</code><br>・ポータル <strong>https://legalbridge.arclight.co.jp/</strong> を開いて直接検索（Google Workspace でログイン）</td></tr>
<tr><td class="tc">文書作成・審査依頼</td><td>Slack <code>/法務依頼</code></td></tr>
</tbody></table></div>

<hr class="sd">
<h2 class="sec">取引から支払までのステップ</h2>
<div class="phase-flow">
  <div class="pf-item"><div class="pf-box" style="background:var(--ph1)"><span class="pnum">1</span>取引の決定</div></div>
  <div class="pf-item"><div class="pf-box" style="background:var(--ph2)"><span class="pnum">2</span>取引先検索</div></div>
  <div class="pf-item"><div class="pf-box" style="background:var(--ph3)"><span class="pnum">3</span>文書作成・審査依頼</div></div>
  <div class="pf-item"><div class="pf-box" style="background:var(--ph4)"><span class="pnum">4</span>締結手続き</div></div>
  <div class="pf-item"><div class="pf-box" style="background:var(--ph5)"><span class="pnum">5</span>支払</div></div>
</div>


<h3 class="sub" style="margin-top:18px">担当別レーン（全体の流れ）</h3>
<p style="font-size:11.5px;color:var(--g5);margin-bottom:6px">矢印は受け渡しを示します。取引中は、<strong>取引先からの納品</strong>（→検収書）または<strong>ライセンス契約に基づく事業部の権利実施</strong>（→利用許諾計算書）が、支払文書作成の<strong>契機</strong>になります。</p>
<div class="dw" style="overflow-x:auto"><svg viewBox="0 0 760 678" style="width:100%;display:block" xmlns="http://www.w3.org/2000/svg"><defs><marker id="lane-arrow" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#9aa1a8"></polygon></marker></defs><rect x="0" y="30" width="253" height="648" fill="#faf2e6"></rect><rect x="253" y="30" width="254" height="648" fill="#f1f7e8"></rect><rect x="507" y="30" width="253" height="648" fill="#eef0f2"></rect><path d="M 380 90 V 104" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><path d="M 380 134 V 148" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><path d="M 380 178 V 185.0 H 126.5 V 192" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><path d="M 126.5 222 V 229.0 H 380 V 236" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><path d="M 380 266 V 273.0 H 633.5 V 280" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><path d="M 633.5 310 V 317.0 H 380 V 324" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><path d="M 380 354 V 361.0 H 126.5 V 368" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><path d="M 126.5 398 V 405.0 H 633.5 V 412" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><path d="M 633.5 442 V 486" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><path d="M 633.5 442 V 480 H 380 V 486" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><path d="M 633.5 526 V 536 H 380 V 546" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><path d="M 380 526 V 546" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><path d="M 380 576 V 583.0 H 126.5 V 590" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><path d="M 126.5 620 V 627.0 H 380 V 634" fill="none" stroke="#9aa1a8" stroke-width="1.5" marker-end="url(#lane-arrow)"></path><rect x="0" y="0" width="253" height="28" rx="4" fill="#633806"></rect><text x="126.5" y="19" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="12.5" font-weight="700" fill="#fff">管理部</text><rect x="253" y="0" width="254" height="28" rx="4" fill="#27500a"></rect><text x="380.0" y="19" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="12.5" font-weight="700" fill="#fff">事業部</text><rect x="507" y="0" width="253" height="28" rx="4" fill="#495057"></rect><text x="633.5" y="19" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="12.5" font-weight="700" fill="#fff">取引先</text><rect x="0" y="32" width="760" height="22" rx="4" fill="#1d3557"></rect><text x="380.0" y="47.0" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11" font-weight="700" fill="#fff" letter-spacing="1">取引前 ― 締結フェーズ</text><rect x="0" y="452" width="760" height="22" rx="4" fill="#b06a1e"></rect><text x="380.0" y="467.0" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11" font-weight="700" fill="#fff" letter-spacing="1">取引中 ― 納品・利用の実施 〜 支払</text><rect x="270.0" y="60" width="220" height="30" rx="6" fill="#27500a"></rect><text x="380" y="78.5" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="600" fill="#fff">① 取引の決定</text><rect x="270.0" y="104" width="220" height="30" rx="6" fill="#27500a"></rect><text x="380" y="122.5" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="600" fill="#fff">② 取引先検索</text><rect x="270.0" y="148" width="220" height="30" rx="6" fill="#27500a"></rect><text x="380" y="166.5" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="600" fill="#fff">③ 文書作成・審査依頼（/法務依頼）</text><rect x="16.5" y="192" width="220" height="30" rx="6" fill="#633806"></rect><text x="126.5" y="210.5" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="600" fill="#fff">④ 文書作成・審査 → 返却</text><rect x="270.0" y="236" width="220" height="30" rx="6" fill="#27500a"></rect><text x="380" y="254.5" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="600" fill="#fff">⑤ 担当者（事業部）が内容確認</text><rect x="523.5" y="280" width="220" height="30" rx="6" fill="#495057"></rect><text x="633.5" y="298.5" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="600" fill="#fff">⑥ 相手方確認</text><rect x="270.0" y="324" width="220" height="30" rx="6" fill="#27500a"></rect><text x="380" y="342.5" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="600" fill="#fff">⑦ 押印申請</text><rect x="16.5" y="368" width="220" height="30" rx="6" fill="#633806"></rect><text x="126.5" y="386.5" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="600" fill="#fff">⑧ クラウドサイン送信</text><rect x="523.5" y="412" width="220" height="30" rx="6" fill="#495057"></rect><text x="633.5" y="430.5" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="600" fill="#fff">⑨ 署名・締結完了</text><rect x="523.5" y="486" width="220" height="40" rx="6" fill="#ffffff" stroke="#495057" stroke-width="1.8"></rect><text x="633.5" y="503" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#495057">【契機】納品（取引先）</text><text x="633.5" y="517" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#666">→ 検収書を作成</text><rect x="270.0" y="486" width="220" height="40" rx="6" fill="#ffffff" stroke="#27500a" stroke-width="1.8"></rect><text x="380" y="503" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#27500a">【契機】権利実施（ライセンス）</text><text x="380" y="517" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#666">→ 利用許諾計算書を作成</text><rect x="270.0" y="546" width="220" height="30" rx="6" fill="#27500a"></rect><text x="380" y="564.5" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="600" fill="#fff">⑩ 支払文書の作成依頼（/法務依頼）</text><rect x="16.5" y="590" width="220" height="30" rx="6" fill="#633806"></rect><text x="126.5" y="608.5" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="600" fill="#fff">⑪ 支払文書作成・Excel共有</text><rect x="270.0" y="634" width="220" height="30" rx="6" fill="#27500a"></rect><text x="380" y="652.5" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10" font-weight="600" fill="#fff">⑫ サイボウズで支払申請</text></svg></div>

<hr class="sd">

<!-- STEP 1 -->
<div class="shb ph1s" id="s1"><div class="sn">STEP 1</div><h3>取引の決定</h3></div>
<div class="act"><div class="act-l act-jg">事業部</div><div class="act-b">どの取引先と、どんな取引（委託・利用許諾・売買・NDA 等）を行うかを決める</div></div>

<!-- STEP 2 -->
<div class="shb ph2s" id="s2" style="margin-top:24px"><div class="sn">STEP 2</div><h3>取引先検索</h3></div>
<div class="act"><div class="act-l act-jg">事業部</div><div class="act-b">Slackの <code>/法務検索</code>、または <strong>LegalBridge 検索ポータル</strong>から直接、取引先を検索する</div></div>
<div class="tw"><table>
<thead><tr><th>検索結果</th><th>判定</th><th>次にやること</th></tr></thead>
<tbody>
<tr><td class="tc">結果がない</td><td><strong>新規取引先</strong></td><td><span class="tag" style="background:#eaf3de;color:var(--ph1);font-weight:700;margin-right:4px">事業部</span><strong>新規取引先申請フロー</strong>を実施する（<a href="<?= appUrl ?>?page=vendor" style="color:var(--blue)">取引先登録手続きガイド</a>）</td></tr>
<tr><td class="tc">結果がある</td><td><strong>既存取引先</strong></td><td><span class="tag" style="background:#eaf3de;color:var(--ph1);font-weight:700;margin-right:4px">事業部</span>検索結果から<strong>取引先番号をコピー</strong>しておく（次の依頼フォームで使う）</td></tr>
</tbody></table></div>

<!-- STEP 3 -->
<div class="shb ph3s" id="s3" style="margin-top:24px"><div class="sn">STEP 3</div><h3>文書作成・審査依頼</h3></div>
<p>締結する文書について、<strong>自社文書のドラフト作成</strong>または<strong>他社文書のレビュー</strong>を、Slackの <code>/法務依頼</code> から依頼する。</p>
<div class="act"><div class="act-l act-jg">事業部</div><div class="act-b">Slackで <code>/法務依頼</code> を実行し、依頼フォームに記入して送信する</div></div>
<div class="act-ar">▼</div>
<div class="act"><div class="act-l act-kn">管理部</div><div class="act-b">依頼を受けて文書を作成／審査し、Slackで返却する</div></div>

<div style="border:1px solid var(--g3);border-left:4px solid var(--navy);border-radius:0 6px 6px 0;padding:12px 16px;margin:10px 0;background:var(--g1)">
  <h4 class="sh4" style="margin-top:0">契約の基本構造と依頼のポイント</h4>
  <p style="font-size:12px;margin:4px 0 8px">当社の契約は <strong>「基本契約 ＋ 個別契約」</strong> を基本としています。</p>
  <div class="tw" style="margin:0 0 8px"><table>
  <thead><tr><th>区分</th><th>内容</th></tr></thead>
  <tbody>
  <tr><td class="tc">基本契約</td><td>取引全体に共通するルール（取引先ごとに一度締結し、継続して使う土台）</td></tr>
  <tr><td class="tc">個別契約</td><td>個々の取引の中身（＝今回取引したい内容そのもの）</td></tr>
  </tbody></table></div>
  <div class="act"><div class="act-l act-jg">事業部</div><div class="act-b">基本契約か個別契約かの<strong>判断は不要</strong>。<strong>取引したい内容（＝個別契約の部分）</strong>を、そのまま依頼に記載すればOK</div></div>
  <div class="act"><div class="act-l act-kn">管理部</div><div class="act-b">基本契約の要否は<strong>法務側で判断</strong>。必要な場合は、法務が<strong>基本契約締結の案内</strong>や<strong>個人情報取得同意などの付属書類</strong>を作成・手配する</div></div>
  <div class="cl cl-i" style="margin-top:8px;font-size:11.5px">※ <strong>継続的な取引が見込まれる場合</strong>は、<strong>基本契約の締結が必要</strong>になります（要否の判断は法務が行います）。</div>
</div>

<div style="border:1px solid #c8d9f5;border-radius:6px;padding:12px 16px;margin:10px 0;background:#f3f7ff">
  <h4 class="sh4" style="margin-top:0;color:var(--navy)">ひな形（テンプレート）一覧 ― Slack Canvas</h4>
  <p style="font-size:12px;margin:4px 0 6px">各種ひな形は、Slackの <strong>「法務部 実務ポータル」Canvas</strong> に掲載しています。 → <a href="https://kadokawa.enterprise.slack.com/docs/TGE3Z137Y/F09180VHAE9" style="color:var(--blue)">ひな型ライブラリを開く</a></p>
  <p style="font-size:11.5px;margin:0 0 6px;color:var(--g5)">分類：発注・検収／基本契約／個別契約・別紙／法務文書 など（各項目にプレビュー・PDFあり）</p>
  <div class="cl cl-w" style="margin:0;font-size:11.5px">※ ひな形は Google ドライブで管理しています。<strong>ひな形を直接編集して使用することは禁止</strong>です。内容を確認のうえ、<code>/法務依頼</code> から作成を依頼してください。</div>
</div>

<h4 class="sh4" id="form">依頼フォームの記入事項</h4>
<div class="tw"><table>
<thead><tr><th>項目</th><th>記入内容</th></tr></thead>
<tbody>
<tr><td class="tc">部署名</td><td>自分の部署名を入力（店舗の場合は<strong>店舗名</strong>を入力）</td></tr>
<tr><td class="tc">依頼種別</td><td><strong>自社文書</strong>を作る場合 → <strong>「文書作成」</strong>を選択<br><strong>他社文書</strong>を審査する場合 → <strong>「法務相談」</strong>を選択</td></tr>
<tr><td class="tc">件名</td><td>取引の名称（例：「タイトル（イベント名）」イラスト制作業務依頼、審判業務依頼 等）</td></tr>
<tr><td class="tc">希望納期</td><td>文書作成（審査）を終えてほしい日（<strong>最短3営業日</strong>。急ぎは法務まで直接問い合わせ）</td></tr>
<tr><td class="tc">取引先情報</td><td>相手方の名称／区分（法人・個人）／<strong>取引番号</strong>（取引先検索で表示される番号）</td></tr>
<tr><td class="tc">相談・依頼詳細</td><td>下記のとおり、文書の種類に応じて記入</td></tr>
</tbody></table></div>

<div style="border:1px solid var(--g3);border-left:4px solid var(--navy);border-radius:0 6px 6px 0;padding:12px 16px;margin:10px 0;background:var(--g1)">
  <h4 class="sh4" style="margin-top:0">相談・依頼詳細 ―― a. 自社文書（＝作成依頼）</h4>
  <div class="tw" style="margin:6px 0 0"><table>
  <thead><tr><th>文書種別</th><th>記入内容</th></tr></thead>
  <tbody>
  <tr><td class="tc">発注書</td><td>依頼内容の概要的な名称（例：イラスト制作業務、審判業務 など）／詳細（仕様等を細かく）／支払方法（一括・分割・ロイヤリティ計算に基づく歩合・月/四半期/年払い）／支払期日（日付指定）／業務納期（日付指定）</td></tr>
  <tr><td class="tc">ライセンス契約</td><td>法務ポータルの<strong>「BG事業部 契約スキーム実務ガイド」</strong>を参照 → <a href="https://script.google.com/a/macros/arclight.co.jp/s/AKfycbx3YGrrS18-qOZWKktu57IcThsD4QxgSH4-tWa15ui05gu6sNwd8i5ydw12ro_j_R6I4Q/exec" style="color:var(--blue)">ガイドを開く</a></td></tr>
  <tr><td class="tc">出版契約</td><td>法務ポータルの<strong>「出版事業部 契約・書類発行フローガイド」</strong>を参照 → <a href="https://script.google.com/a/arclight.co.jp/macros/s/AKfycbx3YGrrS18-qOZWKktu57IcThsD4QxgSH4-tWa15ui05gu6sNwd8i5ydw12ro_j_R6I4Q/exec?page=pub" style="color:var(--blue)">ガイドを開く</a></td></tr>
  <tr><td class="tc">売買契約</td><td>特約に入れたい固有の条件 等</td></tr>
  <tr><td class="tc">NDA</td><td>特約に入れたい固有の条件 等</td></tr>
  </tbody></table></div>
</div>

<div style="border:1px solid #d8b96a;border-left:4px solid var(--gold);border-radius:0 6px 6px 0;padding:12px 16px;margin:10px 0;background:var(--gold-s)">
  <h4 class="sh4" style="margin-top:0;color:var(--gold)">相談・依頼詳細 ―― b. 他社文書（＝レビュー依頼）</h4>
  <div class="act"><div class="act-l act-jg">事業部</div><div class="act-b">契約の概要を記入する</div></div>
  <div class="act"><div class="act-l act-jg">事業部</div><div class="act-b">任意の Google ドライブに <strong>フォルダを作成</strong>し、<strong>レビュー対象の文書</strong>と、<strong>レビューポイント（確認してほしい点）をまとめた文書</strong>を格納する</div></div>
  <div class="act"><div class="act-l act-jg">事業部</div><div class="act-b">フォームに <strong>フォルダリンク</strong> を記載する</div></div>
  <div class="cl cl-w" style="margin-top:8px;font-size:11.5px">※ 必ず<strong>法務が閲覧できるようアクセス権限を付与</strong>してください。</div>
  <details style="margin-top:10px;border:1px solid var(--g3);border-radius:6px;background:#fff">
<summary style="cursor:pointer;padding:10px 14px;font-weight:700;color:var(--navy);font-size:12.5px">📄 サンプルを見る：レビューポイントをまとめた文書（例・マスキング済）</summary>
<div style="padding:8px 16px 16px;border-top:1px solid var(--g3)">
<div class="cl cl-n" style="font-size:11px;margin-top:0">記入例です。相手方名・タイトル・グループ名などの固有情報はマスキングしています。</div>
<p style="font-weight:700;font-size:13px;color:var(--navy);margin:10px 0 2px">ARTICLE 24 – ADDITIONAL TERMS ／ 追加条項（第24条 新設）・修正案</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 4px">【取引先】共同生産契約 3件（基本ゲーム／【拡張①】／【拡張②】）共通の追加条項案</p>
<p style="font-weight:700;font-size:12px;color:var(--navy);margin:12px 0 3px">24.1　優先順位（Precedence）</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">This Article 24 sets out additional terms agreed between the Parties. Notwithstanding Article 23.1, in the event of any conflict or inconsistency between this Article 24 and any other provision of the Agreement (including the Standard Terms and the Special Terms), this Article 24 shall prevail.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕本第24条は両当事者が合意する追加条項を定める。第23.1条にかかわらず、本第24条と本契約の他の規定（標準条項および特別条項を含む）との間に矛盾または不一致がある場合、本第24条が優先する。</p>
<p style="font-weight:700;font-size:12px;color:var(--navy);margin:12px 0 3px">24.2　支払保全・不引渡し時の救済（Payment Security and Non-Delivery）</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">The second installment under PAYMENT TERMS shall become payable only against [Supplier]'s documentary confirmation that the print run of THE WORK is completed and ready for collection.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕PAYMENT TERMS に定める第2回支払は、THE WORK の印刷が完了し引取り可能な状態にある旨の【取引先】による書面確認と引換えにのみ支払期限が到来する。</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">If [Supplier] fails to make the printed copies available for collection within thirty (30) days after its receipt of the full amount under PAYMENT TERMS, the Partner may terminate the Agreement by written notice, and [Supplier] shall refund to the Partner all sums paid within thirty (30) days of such notice.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕【取引先】が PAYMENT TERMS の全額を受領した後30日以内に印刷部数を引取り可能な状態にしない場合、Partner は書面通知により本契約を解除でき、【取引先】は当該通知後30日以内に既払金の全額を Partner に返金する。</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">Notwithstanding Articles 4.5 and 5.5, the aggregate of any storage charges and delay penalties charged to the Partner shall not exceed 10% of the value of the relevant order.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕第4.5条および第5.5条にかかわらず、Partner に課される倉庫費および遅延ペナルティの合計は、当該注文額の10%を超えないものとする。</p>
<p style="font-weight:700;font-size:12px;color:var(--navy);margin:12px 0 3px">24.3　瑕疵・リコール費用分担（Defects and Recall）</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">[Supplier] warrants that the copies of THE WORK supplied to the Partner conform to the validated Eproofs and the agreed specifications and are free from defects in materials and workmanship.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕【取引先】は、Partner に供給する THE WORK の各部数が、承認済み Eproof および合意仕様に適合し、材料および製造上の瑕疵がないことを保証する。</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">Where a defect, product recall, or regulatory action affecting THE WORK in the TERRITORIES arises from the manufacturing, the materials, or the original design originating with [Supplier], [Supplier] shall bear the reasonable costs directly associated therewith, including the cost of replacement copies and reasonable recall costs.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕TERRITORIES における THE WORK の瑕疵、製品リコールまたは行政措置が、【取引先】に起因する製造・材料・原デザインから生じた場合、【取引先】は、これに直接関連する合理的費用（交換部数の費用および合理的なリコール費用を含む）を負担する。</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">In such case, [Supplier] shall supply replacement copies beyond the one per cent (1%) allowance set out in Article 4.6 to the extent reasonably necessary to remedy the defect.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕この場合、【取引先】は、瑕疵の是正に合理的に必要な範囲で、第4.6条の1%枠を超えて交換部数を供給する。</p>
<p style="font-weight:700;font-size:12px;color:var(--navy);margin:12px 0 3px">24.4　知的財産権侵害補償（Intellectual Property Indemnity）</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">[Supplier] shall defend, indemnify and hold harmless the Partner from and against any third-party claim alleging that THE ORIGINAL WORK or the ILLUSTRATIONS, as supplied by [Supplier], infringe any intellectual property right, together with reasonable resulting damages, settlement amounts and legal costs. The limitations in Article 11.1 ("to its best knowledge" and "under Dutch law only") shall not apply to this indemnity.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕【取引先】は、【取引先】が供給する THE ORIGINAL WORK または ILLUSTRATIONS が知的財産権を侵害する旨の第三者の請求から Partner を防御・補償・免責し、これに起因する合理的な損害・和解額・弁護士費用を負担する。第11.1条の限定（「最善の知識の範囲で」「オランダ法に関してのみ」）は本補償には適用されない。</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">The Partner shall promptly notify [Supplier] of any such claim and shall have the right to participate in the defense with its own counsel at its own cost. Neither Party shall settle any such claim in a manner imposing any obligation or admission on the other Party without that Party's prior written consent, which shall not be unreasonably withheld.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕Partner は当該請求を速やかに【取引先】に通知し、自己の費用で自己の代理人により防御に参加する権利を有する。いずれの当事者も、相手方に義務または認諾を課す態様で当該請求を和解するには、相手方の事前の書面による同意（不合理に留保されない）を要する。</p>
<p style="font-weight:700;font-size:12px;color:var(--navy);margin:12px 0 3px">24.5　責任の制限（Limitation of Liability）</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">Except in respect of (a) the indemnity under Article 24.4, (b) breach of confidentiality, and (c) willful misconduct or gross negligence, neither Party shall be liable to the other for any indirect, incidental, special or consequential damages, or for loss of profit, arising under or in connection with the Agreement.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕(a) 第24.4条の補償、(b) 秘密保持義務違反、(c) 故意または重過失の場合を除き、いずれの当事者も、本契約に基づきまたは関連して生じる間接的・付随的・特別または結果的損害、および逸失利益について、相手方に対し責任を負わない。</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">Except for the matters listed in Article 24.5.1(a)-(c), the aggregate liability of each Party under the Agreement shall not exceed the total amounts paid by the Partner under the Agreement.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕第24.5.1条(a)〜(c)に掲げる事項を除き、本契約に基づく各当事者の責任の総額は、本契約に基づき Partner が実際に支払った金額の総額を超えない。</p>
<p style="font-weight:700;font-size:12px;color:var(--navy);margin:12px 0 3px">24.6　秘密保持の双務化（Mutual Confidentiality）</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">The confidentiality obligations set out in Article 23.2 shall apply mutually to both Parties on equivalent terms, such that each Party shall protect the Confidential Information of the other Party to the same standard set out therein.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕第23.2条に定める秘密保持義務は、同等の条件で両当事者に相互に適用され、各当事者は同条に定める基準と同一の基準で相手方の秘密情報を保護する。</p>
<p style="font-weight:700;font-size:12px;color:var(--navy);margin:12px 0 3px">24.7　支配権変動の除外（Change of Control Exception）</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">For the purposes of Article 16.2, a transfer of shares, a merger, or a corporate reorganization occurring within the Partner's corporate group (including the [Group] group), or any transfer to an affiliate of the Partner, shall not constitute a ground for termination, provided that the transferee assumes the Partner's obligations under the Agreement.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕第16.2条の適用上、Partner の企業グループ（【当社グループ】を含む）内で生じる株式譲渡・合併・組織再編、または Partner の関連会社への移転は、譲受人が本契約上の Partner の義務を承継することを条件として、解除事由を構成しない。</p>
<p style="font-weight:700;font-size:12px;color:var(--navy);margin:12px 0 3px">24.8　売り切り・在庫処分（Sell-Off and Inventory）</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">The sell-off period referred to in Article 17.2 shall be twelve (12) months from the effective date of termination.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕第17.2条にいう売り切り期間は、解除の効力発生日から12か月とする。</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">Notwithstanding Article 17.3, in lieu of destroying the remaining copies the Partner may, at its option, require [Supplier] to repurchase the remaining inventory at the Partner's cost price, or [Supplier] may permit non-commercial disposition of such copies. The Partner shall not be required to destroy paid-for inventory without compensation.</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕第17.3条にかかわらず、Partner は、残部の廃棄に代えて、自己の選択により、【取引先】に対し原価での残在庫の買戻しを求めることができ、または【取引先】は当該残部の非商業的処分を許諾することができる。Partner は、対価なくして既払いの在庫を廃棄することを要しない。</p>
<p style="font-weight:700;font-size:12px;color:var(--navy);margin:12px 0 3px">24.9　Partner による解除権（Termination by the Partner）</p>
<p style="font-size:11.5px;margin:0 0 2px;line-height:1.6">The Partner may terminate the Agreement for cause by written notice if [Supplier] (i) commits a material breach of the Agreement (including repeated failure to deliver THE WORK), (ii) becomes insolvent or subject to insolvency proceedings, or (iii) fails to cure a remediable breach within thirty (30) days after written notice from the Partner. Article 16.3 shall apply mutatis mutandis, save that sums paid by the Partner in respect of undelivered copies shall be refunded by [Supplier].</p>
<p style="font-size:11px;color:var(--g5);margin:0 0 6px;line-height:1.6">〔参考訳〕Partner は、【取引先】が (i) 本契約の重大な違反（THE WORK の反復的な不引渡しを含む）を行ったとき、(ii) 支払不能となりまたは倒産手続の対象となったとき、または (iii) 是正可能な違反を Partner の書面通知後30日以内に是正しないときは、書面通知により本契約を解除できる。第16.3条を準用する。ただし、未引渡しの部数に関し Partner が支払った金額は【取引先】が返金する。</p>
<div class="cl cl-w" style="font-size:11px;margin-top:10px">※ 本サンプルはマスキング済みの記入例です。実依頼では、相手方名・タイトル・数値等を記載し、<strong>確認してほしい点を明示</strong>してください。</div>
</div>
</details>
</div>

<!-- STEP 4 -->
<div class="shb ph4s" id="s4" style="margin-top:24px"><div class="sn">STEP 4</div><h3>締結手続き</h3></div>
<p>依頼の送信後は、Slack／クラウドサイン上で次の順に進みます。担当は各行のとおりです。</p>
<div class="act"><div class="act-l act-jg">事業部</div><div class="act-b">担当者が内容を確認する</div></div>
<div class="act-ar">▼</div>
<div class="act"><div class="act-l act-tr">取引先</div><div class="act-b">送付された内容を確認し、合意する</div></div>
<div class="act-ar">▼</div>
<div class="act"><div class="act-l act-jg">事業部</div><div class="act-b">押印申請を行う</div></div>
<div class="act-ar">▼</div>
<div class="act"><div class="act-l act-kn">管理部</div><div class="act-b">クラウドサインで送信する</div></div>
<div class="act-ar">▼</div>
<div class="act"><div class="act-l act-tr">取引先</div><div class="act-b">署名し、締結完了</div></div>
<div class="cl cl-w" style="font-size:11.5px"><strong>締結完了（相手方の署名・自社押印）まで、業務に着手しないこと。</strong></div>

<!-- STEP 5 -->
<div class="shb ph5s" id="s5" style="margin-top:24px"><div class="sn">STEP 5</div><h3>支払</h3></div>
<p>支払は、サイボウズで支払申請を提出するために、<strong>① 支払文書の作成依頼</strong> と <strong>② 支払申請の提出</strong> の2フェーズに分かれます。</p>

<h4 class="sh4" id="paydoc">① 支払文書の作成依頼</h4>
<p style="font-size:12px;margin-bottom:6px">支払文書は次の2種類。それぞれ締結文書に対応し、作成の契機が異なります。</p>
<div class="tw"><table>
<thead><tr><th>支払文書</th><th>対応する締結文書</th><th>作成の契機</th></tr></thead>
<tbody>
<tr><td class="tc">検収書</td><td>発注書</td><td>納品を受けて検収が終わった</td></tr>
<tr><td class="tc">利用許諾計算書</td><td>個別利用許諾条件書・出版等利用許諾条件書</td><td>ロイヤリティの支払が決まった</td></tr>
</tbody></table></div>
<div class="act"><div class="act-l act-jg">事業部</div><div class="act-b"><code>/法務依頼</code> → 依頼種別の <strong>「支払書類作成」</strong> から <strong>「納品 / 検収書」</strong> または <strong>「利用許諾計算書」</strong> を選び、フォームに入力して送信する</div></div>
<div class="act-ar">▼</div>
<div class="act"><div class="act-l act-kn">管理部</div><div class="act-b">依頼を受けて支払文書を作成し、<strong>支払申請用Excel</strong> とあわせて事業部へ共有する</div></div>

<div style="border:1px solid var(--g3);border-left:4px solid var(--navy);border-radius:0 6px 6px 0;padding:12px 16px;margin:10px 0;background:var(--g1)">
  <h4 class="sh4" style="margin-top:0">「納品 / 検収書」を選んだとき ― 検収書作成用データ</h4>
  <ul class="ck" style="margin:0">
    <li>納品回数（第n回納品）― 分割納品でなければ <strong>「1」</strong> を記載。分割納品の場合は<strong>今回が第何回目か</strong>を記載</li>
    <li>金額（税抜）</li>
    <li>納品日（YYYY-MM-DD）</li>
    <li>検収期限（YYYY-MM-DD）</li>
  </ul>
</div>

<div style="border:1px solid #f5c6cb;border-left:4px solid var(--red);border-radius:0 6px 6px 0;padding:12px 16px;margin:10px 0;background:var(--red-s)">
  <h4 class="sh4" style="margin-top:0;color:var(--red)">「利用許諾計算書」を選んだとき ― 相談・依頼詳細欄に記載</h4>
  <ul class="ck" style="margin:0">
    <li>利用許諾条件に応じて、<strong>生産数・売上金額 等</strong>を相談・依頼詳細欄に記載する</li>
    <li><strong>サブライセンス料の分配</strong>も同様に、詳細欄に記載する</li>
  </ul>
</div>

<h4 class="sh4" id="payapply" style="margin-top:14px">② 支払申請の提出</h4>
<p style="font-size:12px;margin-bottom:6px">法務から支払文書・Excelファイルを受け取ったら、サイボウズで支払申請を提出する。</p>

<div style="border:1px solid var(--g3);border-left:4px solid var(--navy);border-radius:0 6px 6px 0;padding:12px 16px;margin:10px 0;background:var(--g1)">
  <h4 class="sh4" style="margin-top:0">申請前の準備 ― 添付ファイル</h4>
  <p style="font-size:11.5px;margin-bottom:4px">サイボウズの支払申請には、<strong>法務発行の次の2点</strong>を添付する。</p>
  <ul class="ck" style="margin:0">
    <li>法務発行の<strong>支払文書</strong>（検収書 または 利用許諾計算書）</li>
    <li>法務発行の<strong>支払申請用Excelファイル</strong></li>
  </ul>
</div>

<div class="act"><div class="act-l act-jg">事業部</div><div class="act-b">上記2点を添付し、<strong>サイボウズ</strong>で支払申請を提出する（<strong>受領日から60日以内</strong>）　<span class="badge b-fl">サイボウズ</span></div></div>

<div class="cl cl-w">
  <strong>⚠ 金額入力の注意（源泉徴収）：</strong>サイボウズの「<strong>支払総額（消費税込）</strong>」欄には、<strong>源泉所得税を差し引く前の税込合計金額</strong>を入力してください。法務発行の<strong>検収書・利用許諾計算書では「源泉徴収税計算前」</strong>と表示されている税込合計金額がこれにあたります（先方発行の請求書の場合は税込合計金額）。<strong>金額が相違すると差し戻し・再申請の対象</strong>になります。申請前に支払文書・請求書と必ず照合してください。
  <div style="margin-top:4px;font-size:11px;color:var(--g5)">※ 金額の右側のボックスは通貨単位欄です。日本円以外のときは書き換えてください。</div>
</div>

<div class="cl cl-n" style="margin-top:10px"><strong>期日の鉄則：</strong>支払は<strong>受領日から60日以内</strong>。遅延すると年14.6%の損害金が自動発生します（計算例・免除可否などの詳細は「法解釈ガイド」へ）。</div>

<!-- ▼▼ 参考資料：サイボウズ支払申請 入力ガイド 要約 ▼▼ -->
<div style="border:1px solid #c8d9f5;border-radius:6px;padding:12px 16px;margin:14px 0;background:#f3f7ff">
  <h4 class="sh4" style="margin-top:0;color:var(--navy)">📎 参考資料：サイボウズ支払申請 入力ガイド（要約）</h4>
  <p style="font-size:11.5px;margin:0 0 8px;color:var(--g5)">サイボウズの入力項目・承認経路・申請後の保存までの要点。詳細は経営管理本部「サイボウズ支払申請 入力ガイド」を参照（※海外払いは整備中）。</p>

  <h4 class="sh4">申請の開始</h4>
  <p style="font-size:12px;margin:0 0 8px">サイボウズ トップ ＞ <strong>ワークフロー</strong> ＞「申請する」→ フォームを選択。<br>・<strong>支払申請（外注・仕入ほか）</strong>＝国内払い用（支払先が国内銀行）<br>・<strong>海外払：支払申請（外注・仕入ほか）</strong>＝海外払い用（支払先が海外銀行。<strong>円建てでも海外口座ならこちら</strong>）</p>

  <h4 class="sh4">主な入力項目（国内払い）</h4>
  <div class="tw" style="margin:0 0 8px"><table>
  <thead><tr><th>項目</th><th>記入内容</th></tr></thead>
  <tbody>
  <tr><td class="tc">標題 <span class="tag t-red">必須</span></td><td>一覧に表示される。何の申請か分かる名称にする</td></tr>
  <tr><td class="tc">部署 <span class="tag t-red">必須</span></td><td><strong>費用を計上する部署</strong>を選択（所属部署ではない）。ゲームマーケット・DMGP関係は<strong>イベント名</strong>を選択。店舗は「その他」に店名を入力</td></tr>
  <tr><td class="tc">支払先 <span class="tag t-red">必須</span></td><td>手入力</td></tr>
  <tr><td class="tc">支払総額（消費税込） <span class="tag t-red">必須</span></td><td><strong>源泉所得税を差し引く前</strong>の税込金額。<strong>法務発行の検収書・利用許諾計算書＝源泉徴収税計算前の税込合計金額</strong>／先方請求書＝税込合計金額。<strong>金額相違は差し戻し対象</strong></td></tr>
  <tr><td class="tc">個人チェック</td><td>源泉徴収が必要な<strong>個人</strong>への支払（商品仕入を除く）はチェック。→支払は原則<strong>毎月20日</strong></td></tr>
  <tr><td class="tc">支払日 <span class="tag t-red">必須</span></td><td>請求書・検収書の<strong>支払期日以前の定期支払日</strong>（法人＝月末／源泉個人＝20日）。定期支払日が非営業日なら<strong>前営業日</strong>を入力</td></tr>
  <tr><td class="tc">振込手数料 <span class="tag t-red">必須</span></td><td>原則「<strong>当方負担</strong>」のまま。先方負担は店舗・営業物流の仕入で契約に明記がある場合のみ</td></tr>
  <tr><td class="tc">添付資料 <span class="tag t-red">必須</span></td><td>下記「添付資料」参照（最大5件、超過はzip化／ドライブ格納＋経理権限付与）</td></tr>
  <tr><td class="tc">備考</td><td>一部金額のみの申請・支払日の後ろ倒し（取適法非抵触）・期日外申請などは<strong>事前に記載</strong>すると差し戻しを防げる</td></tr>
  <tr><td class="tc">稟議/商品企画番号</td><td>関連があれば入力。BDG・出版の商品原価は商品企画申請番号</td></tr>
  <tr><td class="tc">PJコード・按分比</td><td>原価部門・PJ管理部門のみ。複数PJ按分は％合計100％／金額合計＝支払総額</td></tr>
  </tbody></table></div>

  <details style="border:1px solid var(--g3);border-radius:6px;background:#fff">
  <summary style="cursor:pointer;padding:9px 14px;font-weight:700;color:var(--navy);font-size:12.5px">添付資料・承認経路・申請後の保存・期限（詳細）</summary>
  <div style="padding:6px 16px 14px;border-top:1px solid var(--g3)">

    <h4 class="sh4">添付資料（個人・法務発行案件）</h4>
    <ul class="ck" style="margin:0 0 8px">
      <li><strong>委託契約</strong>：検収書＋発注書＋支払申請用Excel（いずれも法務発行）</li>
      <li><strong>利用許諾契約</strong>：利用許諾計算書＋発注書＋支払申請用Excel（いずれも法務発行）</li>
      <li>先方作成の請求書を受領した場合は、それも添付</li>
    </ul>

    <h4 class="sh4">経路の決定（承認者）</h4>
    <p style="font-size:12px;margin:0 0 8px">申請内容・<strong>金額に応じて承認者が変わる</strong>。決裁権限図表／承認・決裁ルートに従って設定する。<strong>決裁ルートに入っている人しか申請を参照できない</strong>ため、後から共有したい人は「経路の決定」＞決裁後確認者に追加（経理・役員は削除不要）。</p>

    <h4 class="sh4">申請後の電子データ保存</h4>
    <p style="font-size:12px;margin:0 0 4px">起票後に<strong>5桁の支払申請No</strong>が発番される（送信一覧で確認）。添付した請求書／検収書をリネームのうえ「請求書格納フォルダ」（部署別＞月別）に格納する。</p>
    <div class="cl cl-tl" style="font-size:11.5px;margin:0 0 8px"><strong>リネーム：</strong>支払申請No5桁＿費用計上月の末日＿取引金額（税抜）＿取引先名＿（自由項目）<br><span style="color:var(--g5)">費用計上月＝役務提供・納品など費用の原因となる取引が発生した月（不明なら請求書日付に合わせる）</span></div>

    <h4 class="sh4">定期支払タイミングと申請期限</h4>
    <div class="tw" style="margin:0 0 6px"><table>
    <thead><tr><th>支払対象</th><th>定期支払日</th><th>承認完了期限</th></tr></thead>
    <tbody>
    <tr><td class="tc">国内・法人／源泉なし個人</td><td>月末日</td><td>毎月 第5営業日</td></tr>
    <tr><td class="tc">国内・源泉する個人</td><td>20日</td><td>毎月 第5営業日</td></tr>
    <tr><td class="tc">海外・15日支払</td><td>15日</td><td>毎月 10日</td></tr>
    <tr><td class="tc">海外・月末支払</td><td>月末日</td><td>毎月 25日</td></tr>
    </tbody></table></div>
    <p style="font-size:11.5px;margin:0 0 8px;color:var(--g5)">期限は「最終承認者の決裁完了」まで。最新の期日はSlack <strong>#all-通知_経営管理本部</strong> を参照。</p>

    <h4 class="sh4">期日外申請（QA）</h4>
    <p style="font-size:12px;margin:0">①期限超過 ②定期外支払 の場合は、承認フロー上の確認者・承認者・決裁者と<strong>経理部（keiri@arclight.co.jp）</strong>へメール連絡してから申請する（件名に【期限超過】／【定期外支払】）。支払まで<strong>5営業日を切る</strong>場合は事前に経理へ相談。</p>

  </div>
  </details>
</div>
<!-- ▲▲ 参考資料ここまで ▲▲ -->

<div style="background:var(--navy);border-radius:8px;padding:18px 22px;margin-top:28px;text-align:center">
<div style="font-size:10px;color:rgba(255,255,255,.45);margin-bottom:5px">お問い合わせ先</div>
<div style="font-size:17px;font-weight:700;color:#fff;margin-bottom:3px">Arclight Inc. 経営管理本部 法務部</div>
<div style="font-size:12px;color:rgba(255,255,255,.65)">営業時間：平日 10:00〜18:00</div>
<div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:4px;font-style:italic">記録の管理を、現場の当たり前に。</div>
</div>
</main>
</body>
</html>$g_tetsuzuki$, 'seed 0095 (from services/api/guides)', 'seed')
    RETURNING id INTO vid;
  UPDATE portal_guides
     SET current_version_id = vid, status = 'published', updated_at = now()
   WHERE id = gid;
END
$seed_tetsuzuki$;

-- ── torihiki ──────────────────────────────────────────────
DO $seed_torihiki$
DECLARE gid INTEGER; vid INTEGER;
BEGIN
  SELECT id INTO gid FROM portal_guides WHERE guide_key = 'torihiki';
  IF gid IS NULL THEN
    RAISE NOTICE 'skip torihiki: portal_guides にメタ行なし(0094 を先に適用)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM portal_guide_versions WHERE guide_id = gid) THEN
    RETURN; -- 既に版あり。再適用しない(冪等)。
  END IF;
  INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
    VALUES (gid, 1, $g_torihiki$<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>取引適正化・フリーランス法 実務ガイド</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;font-size:13.5px;line-height:1.7;color:#212529;background:#fff}
a{color:inherit}
@media print{
  .g-sidebar-torihiki{display:none!important}
  .g-main-torihiki{margin-left:0!important;max-width:none!important;padding:20px!important}
}

/* == torihiki == */

:root{--navy:#1d3557;--navy-l:#2a4a6e;--red:#e63946;--red-s:#fde8ea;--gold:#c47d1a;--gold-s:#fef3e2;--green:#1d9e75;--green-s:#e4f7f1;--blue:#378add;--blue-s:#e8f1fb;--teal:#085041;--teal-s:#e1f5ee;--g1:#f8f9fa;--g2:#e9ecef;--g3:#dee2e6;--g5:#6c757d;--tx:#212529;--tx2:#495057;--sw:228px;
--ph1:#27500a;--ph2:#0c447c;--ph3:#633806;--ph4:#1d9e75;--ph5:#6b1f7a;--ph6:#a32d2d}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;font-size:13.5px;line-height:1.7;color:var(--tx);background:#fff}
.g-sidebar-torihiki{position:fixed;top:0;left:0;width:var(--sw);height:100vh;background:var(--navy);overflow-y:auto;display:flex;flex-direction:column;z-index:100}
.g-sh-torihiki{padding:16px 14px 12px;border-bottom:1px solid rgba(255,255,255,.1)}
.g-sh-torihiki h1{font-size:9px;font-weight:700;color:rgba(255,255,255,.45);letter-spacing:.08em;text-transform:uppercase}
.g-sh-torihiki p{font-size:11.5px;color:rgba(255,255,255,.92);font-weight:600;margin-top:3px;line-height:1.4}
nav{padding:6px 0 20px}
.ns{display:block;padding:5px 14px;font-size:9px;font-weight:700;color:rgba(255,255,255,.32);letter-spacing:.07em;text-transform:uppercase;margin-top:9px}
.nl{display:block;padding:4px 14px;font-size:11.5px;color:rgba(255,255,255,.7);text-decoration:none;border-left:2px solid transparent;transition:all .15s;line-height:1.4}
.nl:hover,.nl.active{color:#fff;background:rgba(255,255,255,.09);border-left-color:#e63946}
.nsub{display:block;padding:3px 14px 3px 24px;font-size:10.5px;color:rgba(255,255,255,.45);text-decoration:none;transition:color .15s}
.nsub:hover{color:rgba(255,255,255,.82)}
.bdg{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-size:9px;font-weight:700;margin-right:4px;vertical-align:middle}
.b1{background:#eaf3de;color:var(--ph1)}.b2{background:#e8f1fb;color:var(--ph2)}.b3{background:#faeeda;color:var(--ph3)}
.g-main-torihiki{margin-left:var(--sw);padding:36px 46px 80px;max-width:calc(var(--sw) + 850px)}
h1.dt{font-size:21px;font-weight:700;color:var(--navy);border-bottom:3px solid var(--navy);padding-bottom:9px;margin-bottom:5px}
.dm{font-size:12px;color:var(--g5);margin-bottom:28px}
/* CHAPTER HEADER */
.chap{border-radius:8px;padding:16px 22px;margin:36px 0 16px;scroll-margin-top:16px}
.chap.c1{background:var(--ph1)}.chap.c2{background:var(--ph2)}.chap.c3{background:var(--teal)}
.chap .cn{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px}
.chap h2{font-size:16px;font-weight:700;color:#fff;margin:0}
.chap .cdesc{font-size:12px;color:rgba(255,255,255,.65);margin-top:5px}
/* SECTION */
h2.sec{font-size:16px;font-weight:700;color:var(--navy);border-left:4px solid var(--navy);padding-left:10px;margin:28px 0 11px;scroll-margin-top:20px}
h3.sub{font-size:13.5px;font-weight:700;color:var(--navy-l);margin:18px 0 9px;padding-bottom:4px;border-bottom:1px solid var(--g3);scroll-margin-top:20px}
h4.sh4{font-size:12.5px;font-weight:700;color:var(--tx2);margin:11px 0 7px}
p{margin-bottom:9px;color:var(--tx2)}strong{color:var(--tx)}
ul,ol{padding-left:20px;margin-bottom:9px;color:var(--tx2)}li{margin-bottom:3px}
/* PHASE STEP HEADER */
.shb{border-radius:7px;padding:12px 16px;margin-bottom:14px;scroll-margin-top:16px}
.shb h3{font-size:13.5px;font-weight:700;color:#fff;margin:0}
.shb .sn{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:2px}
.ph1s{background:var(--ph1)}.ph2s{background:var(--ph2)}.ph3s{background:var(--ph3)}.ph4s{background:var(--ph4)}.ph5s{background:var(--ph5)}.ph6s{background:var(--ph6)}
/* CALLOUT */
.cl{border-left:3px solid;padding:8px 12px;border-radius:0 5px 5px 0;margin:9px 0;font-size:12.5px}
.cl-w{border-color:var(--red);background:var(--red-s)}.cl-i{border-color:var(--blue);background:var(--blue-s)}.cl-t{border-color:var(--green);background:var(--green-s)}.cl-n{border-color:var(--gold);background:var(--gold-s)}.cl-tl{border-color:var(--teal);background:var(--teal-s)}
/* TABLE */
.tw{overflow-x:auto;margin:9px 0}
table{width:100%;border-collapse:collapse;font-size:12px}
thead th{background:var(--navy);color:#fff;padding:7px 9px;text-align:left;font-weight:600;font-size:11.5px;white-space:nowrap}
tbody tr:nth-child(even){background:var(--g1)}
tbody td{padding:6px 9px;border-bottom:1px solid var(--g3);vertical-align:top;line-height:1.55}
tbody tr:hover{background:#f0f4ff}
td.tc{font-weight:600;color:var(--navy);font-size:11.5px}
td.tcr{font-weight:700;color:var(--red)}
td.tcg{font-weight:700;color:var(--green)}
td.tco{font-weight:700;color:var(--gold)}
/* STEP BOX */
.step-box{background:var(--g1);border:1px solid var(--g3);border-left:4px solid var(--navy);border-radius:0 6px 6px 0;padding:12px 15px;margin:8px 0}
.step-num{display:inline-block;background:var(--navy);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;margin-bottom:6px;letter-spacing:.04em}
/* COMPARE 2-COL */
.cmp{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
.cmp-card{border-radius:6px;padding:14px 16px}
.cmp-card.law{background:var(--navy);color:#fff}
.cmp-card.fl{background:var(--teal);color:#fff}
.cmp-card h4{font-size:12.5px;font-weight:700;margin-bottom:7px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,.2)}
.cmp-card ul{padding-left:16px;font-size:11.5px;line-height:1.75;color:rgba(255,255,255,.88)}
.cmp-card strong{color:#fff}.cmp-card li{color:rgba(255,255,255,.88)}
.cmp-label{font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px}
/* SELL/CONSIGN 2-COL */
.sc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
.sc-card{border-radius:6px;padding:14px 16px;border:1px solid}
.sc-card.sell{background:var(--g1);border-color:var(--g3)}
.sc-card.consign{background:var(--red-s);border-color:#f5c6cb}
.sc-card h4{font-size:12.5px;font-weight:700;margin-bottom:8px}
.sc-card ul{padding-left:16px;font-size:11.5px;line-height:1.75;color:var(--tx2)}
/* PHASE FLOW BAR */
.phase-flow{display:flex;gap:0;margin:12px 0;overflow-x:auto}
.pf-item{flex:1;min-width:0;text-align:center}
.pf-box{padding:8px 3px;font-size:10.5px;font-weight:700;color:#fff;border-radius:4px;margin:0 2px;line-height:1.35}
.pf-box .pnum{font-size:13px;font-weight:700;opacity:.45;display:block}
/* BADGE / TAG */
.badge{display:inline-flex;align-items:center;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:3px}
.b-law{background:#e6effa;color:var(--navy)}.b-fl{background:var(--teal-s);color:var(--teal)}.b-red{background:var(--red-s);color:var(--red)}
.tag{display:inline-block;font-size:9.5px;font-weight:600;padding:1px 5px;border-radius:3px;margin-right:2px}
.t-law{background:#e6effa;color:var(--navy)}.t-fl{background:var(--teal-s);color:var(--teal)}.t-gold{background:#fef3e2;color:var(--gold)}.t-red{background:var(--red-s);color:var(--red)}
/* TIMELINE */
.timeline{display:flex;margin:12px 0;border:1px solid var(--g3);border-radius:6px;overflow:hidden}
.tl-item{flex:1;padding:10px 8px;text-align:center;font-size:11px}
.tl-item:not(:last-child){border-right:1px solid var(--g3)}
.tl-item.ts{background:var(--navy);color:#fff}
.tl-item.tm{background:#faeeda;color:#633806}
.tl-item.te{background:var(--red-s);color:var(--red)}
.tl-item .tll{font-size:9px;font-weight:700;opacity:.65;margin-bottom:3px}
.tl-item .tlv{font-size:13px;font-weight:700}
/* CHECK LIST */
.ck{list-style:none;padding:0;margin:7px 0}
.ck li{padding:7px 10px 7px 30px;position:relative;border-bottom:1px solid var(--g2);font-size:12px;color:var(--tx2)}
.ck li::before{content:"☐";position:absolute;left:7px;font-size:13px;color:var(--navy);line-height:1.5}
.ck li:last-child{border-bottom:none}
.pl{list-style:none;padding:0;margin:7px 0}
.pl li{padding:6px 10px 6px 26px;position:relative;border-bottom:1px solid var(--g2);font-size:12px;color:var(--tx2)}
.pl li::before{content:"⚠";position:absolute;left:6px;font-size:11px}
.pl li:last-child{border-bottom:none}
.ap{background:var(--g1);border-radius:7px;padding:14px 18px;margin-bottom:14px}
hr.sd{border:none;border-top:2px solid var(--g2);margin:30px 0}
.dw{background:var(--g1);border:1px solid var(--g3);border-radius:6px;padding:12px 12px 9px;margin:9px 0}
.faq-item{margin-bottom:11px}
.faq-q{font-weight:700;color:var(--navy);margin-bottom:4px;font-size:13px}
.faq-a{padding:8px 12px;background:var(--g1);border-radius:4px;font-size:12.5px;color:var(--tx2)}
</style>
</head>
<body>
 <?!= include('common_top_tabs', { appUrl: appUrl, currentPage: currentPage }); ?>
<aside class="g-sidebar-torihiki">
<div class="g-sh-torihiki"><h1>法務部</h1><p>業務委託取引<br>法解釈ガイド</p></div>
<nav>
<a class="nl" href="#top">概要</a>

<span class="ns">1. 該当取引の選別</span>
<a class="nl" href="#judge"><span class="bdg b1">1</span>取引種別の判断フロー</a>
<a class="nsub" href="#type4">委託区分5類型</a>
<a class="nsub" href="#sale-vs">売買 vs 委託</a>
<a class="nsub" href="#selector">属性別 適用法律</a>

<span class="ns">2. 法律の詳細</span>
<a class="nl" href="#law"><span class="bdg b2">2</span>法律の基本構造</a>
<a class="nsub" href="#law-comp">取適法 vs フリ法</a>
<a class="nsub" href="#po">発注書8必須項目</a>
<a class="nsub" href="#inspection">検収フェーズ詳細</a>
<a class="nsub" href="#payment">支払フェーズ詳細</a>
</nav>
</aside>

<main class="g-main-torihiki">
<h1 class="dt" id="top">業務委託取引 法解釈ガイド</h1>
<p class="dm">v2.0　Arclight Inc. 経営管理本部 法務部　2026年6月2日改訂　｜　取引適正化法（旧下請法）・フリーランス保護法 対応　｜　社内手続フローは LegalBridge に分離</p>

<div class="cl cl-i">このガイドは、業務委託取引にかかる<strong>法解釈のナレッジ集</strong>です。<strong>「この取引は法律の対象か？」（第1章）</strong>と<strong>「その根拠はどこにあるか？」（第2章）</strong>の2段階で理解できるよう構成しています。<br>発注書交付・検収・支払などの<strong>実際の社内手続フローは LegalBridge に分離</strong>しました。「どう動けばいいか」は LegalBridge 側の取引手続ガイドを参照してください。</div>

<hr class="sd">

<!-- ========================================== -->
<!-- 1. 該当取引の選別 -->
<!-- ========================================== -->
<div class="chap c1" id="judge">
  <div class="cn">Chapter 1</div>
  <h2>該当取引とはどのように選別されるか？</h2>
  <div class="cdesc">まずここで「この取引が法律の対象かどうか」を判断する</div>
</div>

<h2 class="sec" id="type4">委託区分5類型と Arclight 業務の対応</h2>
<div class="cl cl-i"><strong>2026年1月改正で「特定運送委託」が新設。</strong> 当社グッズ等の購入者への運送を中小運送事業者に委託している場合は該当し得る。対象取引の洗い出しと発注書交付の確認を実施すること。</div>
<div class="tw"><table>
<thead><tr><th>委託区分</th><th>Arclight での具体的な業務例</th><th>従業員数基準</th><th>適用法律</th></tr></thead>
<tbody>
<tr>
  <td class="tc" style="color:var(--red);">情報成果物<br>作成委託<br><span style="font-size:9px;background:var(--red-s);color:var(--red);padding:1px 4px;border-radius:2px;">★最頻出</span></td>
  <td>
    <strong style="font-size:11px;color:var(--navy)">プログラム：</strong> ゲームアプリ・デジタル版の開発委託<br>
    <strong style="font-size:11px;color:var(--navy)">プログラム以外：</strong> イラスト・カードアート・パッケージデザイン制作／ルールブック・カードテキストのライティング／翻訳・ローカライズ（英語版・多言語版）／グラフィックデザイン・DTPレイアウト／プロモーション映像・紹介動画制作／ウェブサイト・SNS用コンテンツ制作
  </td>
  <td style="font-size:11px;">プログラム：<strong>300人</strong><br>それ以外：<strong>100人</strong></td>
  <td><span class="tag t-law">取適法</span><br><span class="tag t-fl">フリ法</span>（個人）</td>
</tr>
<tr>
  <td class="tc">役務提供<br>委託</td>
  <td>
    <strong style="font-size:11px;color:var(--navy)">300人基準：</strong> 物流・発送業務委託（運送・倉庫保管・情報処理）<br>
    <strong style="font-size:11px;color:var(--navy)">100人基準：</strong> Game Market等イベントの運営スタッフ・設営委託／ゲーム体験会ファシリテーター委託／カスタマーサポート委託／撮影・配信・実況委託
  </td>
  <td style="font-size:11px;">運送・倉庫・情報処理：<strong>300人</strong><br>それ以外：<strong>100人</strong></td>
  <td><span class="tag t-law">取適法</span><br><span class="tag t-fl">フリ法</span>（個人）</td>
</tr>
<tr>
  <td class="tc">製造委託</td>
  <td>ボードゲームコンポーネントの製造委託（カード・ボード・コマ・トークン等）／パッケージ・化粧箱の製造・印刷委託／グッズ・販促物（アクリルスタンド・缶バッジ等）の製造委託／海外メーカーへのOEM製造委託<br><span style="font-size:10.5px;color:var(--g5)">※2026年改正で金型・木型・治具・特殊工具の製造委託も対象に追加</span></td>
  <td style="font-size:11px;"><strong>300人</strong></td>
  <td><span class="tag t-law">取適法</span></td>
</tr>
<tr>
  <td class="tc tcr" style="font-size:11.5px;">特定運送委託<br><span style="font-size:9px;background:var(--red-s);color:var(--red);padding:1px 4px;border-radius:2px;">2026年1月 新設</span></td>
  <td>当社グッズ・ゲーム等の購入者への運送を中小運送事業者に委託する場合（販売商品の最終消費者への配送）<br><span style="font-size:10.5px;color:var(--g5)">※景品・DM・サンプル品・取引書類の輸送は原則対象外</span></td>
  <td style="font-size:11px;"><strong>300人</strong></td>
  <td><span class="tag t-law">取適法</span></td>
</tr>
<tr>
  <td class="tc" style="color:var(--g5)">修理委託<br><span style="font-size:9px">発生頻度低</span></td>
  <td>展示用什器・備品の修理委託／イベント備品・機器の保守・修繕委託</td>
  <td style="font-size:11px;"><strong>300人</strong></td>
  <td><span class="tag t-law">取適法</span></td>
</tr>
</tbody></table></div>

<h2 class="sec" id="sale-vs">「売買契約」と「委託契約」の判断基準</h2>
<div class="sc-grid">
  <div class="sc-card sell">
    <h4 style="color:var(--navy)">✅ 売買契約（取適法の対象外）</h4>
    <ul>
      <li>既製品・カタログ品の単純購入</li>
      <li>市販のボードゲームを仕入れて販売する場合</li>
      <li>既存の汎用コンポーネント（サイコロ・コインチップ等）の購入</li>
      <li>メーカーのカタログ品そのままの仕入れ</li>
    </ul>
    <div style="margin-top:8px;padding:6px 8px;background:#e9ecef;border-radius:4px;font-size:11px;color:var(--g5)">振込手数料：契約で合意すれば相手方負担も可</div>
  </div>
  <div class="sc-card consign">
    <h4 style="color:var(--red)">⚠ 委託契約（取適法の対象）</h4>
    <ul>
      <li>自社の仕様・要件に基づく制作・製造</li>
      <li>Arclightのゲームとして販売するコンポーネントの製造</li>
      <li>仕様書・デザインデータを渡して作成させるイラスト</li>
      <li>ルールブック・カードテキストのライティング</li>
      <li>当社指定の翻訳仕様に基づくローカライズ</li>
    </ul>
    <div style="margin-top:8px;padding:6px 8px;background:#fde8ea;border-radius:4px;font-size:11px;color:var(--red);font-weight:600">振込手数料：必ず発注者（Arclight）負担。受注者に負担させると違反（2026年1月改正で明確化）</div>
  </div>
</div>

<h2 class="sec" id="selector">発注先の属性と適用法律の組み合わせ</h2>
<div class="tw"><table>
<thead><tr><th>発注先の属性</th><th>取引適正化法（取適法）</th><th>フリーランス保護法</th><th>実務上の注意点</th></tr></thead>
<tbody>
<tr><td class="tc">フリーランス・個人事業主（一人で事業）</td><td>資本金基準または<strong style="color:var(--red)">従業員数基準（100人or300人）</strong>を満たす場合に適用</td><td class="tcr"><strong>必ず適用</strong>（資本金・従業員数不問）</td><td>両法が重複する場合は<strong>厳しい方を適用</strong>。育児・介護配慮義務（フリ法6条）も必要</td></tr>
<tr><td class="tc">一人法人（実質一人で運営する法人）</td><td>資本金基準または従業員数基準を満たす場合に適用</td><td class="tco">フリーランスに準じて適用される可能性あり</td><td>判断が難しい場合は法務部に相談</td></tr>
<tr><td class="tc">中小法人（常時従業員100人or300人以下）</td><td class="tcr"><strong>従業員数基準（新設）で新たに対象になった場合あり</strong></td><td>原則として適用外</td><td>資本金基準を満たさない場合でも<strong>従業員数基準で対象になるケースに注意</strong></td></tr>
<tr><td class="tc">大手法人（資本金3億円超かつ従業員300人超）</td><td>当社が発注側の場合、取適法の対象外となる場合あり</td><td>適用外</td><td>ただし民法・商法上の一般的な義務は引き続き適用</td></tr>
</tbody></table></div><h2 class="sec">取引種別の判断フロー（3STEP）</h2>
<div class="cl cl-n"><strong>用語の改称（2026年1月施行）：</strong> 旧「親事業者」→ 新「<strong>委託事業者</strong>」（Arclightはこちら）／ 旧「下請事業者」→ 新「<strong>中小受託事業者</strong>」（発注先）</div>

<div class="step-box">
  <div class="step-num">STEP 1　まず相手方の属性を確認する</div>
  <p><strong>相手方はフリーランス・個人事業主・一人法人か？</strong></p>
  <p>
    <span class="tag t-fl">YES →</span> <strong>フリーランス保護法が必ず適用</strong>される（資本金・従業員数不問）。取適法との重複適用も STEP 2 で確認する。<br>
    <span class="tag" style="background:#f3f3f3;color:#374151">NO →</span> STEP 2 へ進む
  </p>
</div>

<div class="step-box">
  <div class="step-num">STEP 2　資本金基準 または 従業員数基準を確認する（2026年1月改正で従業員数基準が新設）</div>
  <p><strong>Arclight（委託事業者）と発注先（中小受託事業者）が、下記のいずれかの基準を満たすか？</strong></p>
  <p style="font-size:11.5px;color:var(--g5);margin-bottom:8px">※ まず資本金基準を確認する。資本金基準を満たさない場合に従業員数基準を補完的に適用。<br>　従業員数の判定タイミングは<strong>個別発注の都度</strong>（基本契約締結時の一度きりの確認では不十分）</p>
  <div class="tw" style="margin:0 0 10px"><table>
  <thead><tr>
    <th>委託類型</th>
    <th>Arclight側の基準<br><span style="font-weight:400;font-size:10px">（委託事業者）</span></th>
    <th>発注先側の基準<br><span style="font-weight:400;font-size:10px">（中小受託事業者）</span></th>
    <th>Arclight の主な業務例</th>
  </tr></thead>
  <tbody>
  <tr>
    <td style="font-size:11.5px;">製造委託・修理委託<br>情報成果物作成委託（<strong>プログラムのみ</strong>）<br>役務提供委託（<strong>運送・倉庫保管・情報処理のみ</strong>）<br><strong>特定運送委託（2026年1月 新設）</strong></td>
    <td style="text-align:center;"><strong>資本金3億円超</strong><br><span style="color:var(--g5);font-size:10.5px">または</span><br><strong style="color:var(--red)">常時従業員 300人超</strong></td>
    <td style="text-align:center;">資本金3億円以下<br><span style="color:var(--g5);font-size:10.5px">または</span><br><strong style="color:var(--red)">常時従業員 300人以下</strong><br><span style="font-size:10px;color:var(--g5)">（個人含む）</span></td>
    <td style="font-size:11px;">コンポーネント製造委託<br>ゲームアプリ開発委託<br>物流・発送業務委託<br>購入者への運送委託</td>
  </tr>
  <tr>
    <td style="font-size:11.5px;">情報成果物作成委託（上記<strong>プログラム以外</strong>）<br>役務提供委託（上記<strong>3類型以外</strong>）</td>
    <td style="text-align:center;"><strong>資本金1,000万円超</strong><br><span style="color:var(--g5);font-size:10.5px">または</span><br><strong style="color:var(--red)">常時従業員 100人超</strong></td>
    <td style="text-align:center;">資本金1,000万円以下<br><span style="color:var(--g5);font-size:10.5px">または</span><br><strong style="color:var(--red)">常時従業員 100人以下</strong><br><span style="font-size:10px;color:var(--g5)">（個人含む）</span></td>
    <td style="font-size:11px;">イラスト・翻訳・デザイン<br>ライティング・DTP<br>イベントスタッフ委託</td>
  </tr>
  </tbody></table></div>
  <p>
    <span class="tag t-law">いずれかの基準に該当 →</span> <strong>取引適正化法（取適法）が適用</strong>。STEP 3 へ進む。<br>
    <span class="tag" style="background:#f3f3f3;color:#374151">どちらも非該当 →</span> 取適法の対象外。ただし民法・商法上の義務は引き続き適用。
  </p>
  <div class="cl cl-n" style="margin-top:8px;font-size:11.5px;"><strong>従業員数の確認方法：</strong> ① 賃金台帳の調製対象となる労働者の人数（労基法108条・109条）を基準とする。② 受託者に回答義務はないが、見積依頼書等に「常時使用する従業員数は○○人以下です」のチェックボックスを設けて回答させることが実務上の推奨対応。</div>
</div>

<div class="step-box">
  <div class="step-num">STEP 3　委託の内容を確認する（2026年1月改正で特定運送委託が追加）</div>
  <p><strong>委託の内容が下記5類型のどれかに該当するか？</strong></p>
  <p>
    ① 情報成果物作成委託　② 役務提供委託　③ 製造委託　④ 修理委託　⑤ <strong style="color:var(--red)">特定運送委託（新設）</strong><br>
    該当する → 取適法の対象取引として発注書交付等の法的義務が発生する。
  </p>
  <p style="font-size:11.5px;color:var(--g5);">※ 単なる「既製品の購入（売買契約）」は取適法の対象外。ただし仕様を指定した段階で委託契約になる場合あり（次項参照）</p>
</div>
<div class="cl cl-w"><strong>判断に迷う場合は必ず法務部に相談してください。</strong> 不明確なまま進めると書面交付義務違反のリスクがあります。</div>

<hr class="sd">

<!-- ========================================== -->
<!-- 3. 法律の詳細 -->
<!-- ========================================== -->
<div class="chap c3" id="law">
  <div class="cn">Chapter 2</div>
  <h2>法律の詳細</h2>
  <div class="cdesc">「なぜそのルールがあるか」を知りたいときに参照する</div>
</div>

<h2 class="sec" id="law-comp">取引適正化法 vs フリーランス保護法</h2>
<div class="cmp">
  <div class="cmp-card law">
    <div class="cmp-label">取引適正化法（旧下請法）</div>
    <h4>下請中小企業振興法に基づく取引適正化促進法<br><span style="font-size:10px;font-weight:400">2026年1月改正施行</span></h4>
    <ul>
      <li><strong>適用対象：</strong>資本金・従業員数基準により親事業者・下請事業者を規定。製造委託・修理委託・情報成果物委託・役務提供委託が対象</li>
      <li>Arclightは<strong>「親事業者」</strong>として規制を受ける側</li>
      <li><strong>主な義務・禁止行為：</strong>書面交付義務（3条書面）・支払期日設定義務・60日ルール・遅延損害金（年14.6%）・減額禁止・買いたたき禁止・返品禁止 ほか</li>
      <li><strong>違反時：</strong>公正取引委員会・中小企業庁による勧告・公表・罰則（50万円以下の罰金）</li>
    </ul>
  </div>
  <div class="cmp-card fl">
    <div class="cmp-label">フリーランス保護法</div>
    <h4>特定受託事業者に係る取引の適正化等に関する法律<br><span style="font-size:10px;font-weight:400">2024年11月施行</span></h4>
    <ul>
      <li><strong>適用対象：</strong>「特定受託事業者」＝業務委託を受ける個人・一人法人（フリーランス・個人事業主）。発注側の資本金規模は問わない</li>
      <li><strong>Arclightからの発注すべてが対象</strong></li>
      <li><strong>主な義務・禁止行為：</strong>書面・電磁的方法による条件明示義務（3条）・給付受領義務・60日以内支払・禁止行為（報酬減額・返品・買いたたき・不当な経済上の利益提供要請・育児介護配慮義務（6条））</li>
      <li><strong>違反時：</strong>公正取引委員会・厚生労働省による勧告・公表・罰則</li>
    </ul>
  </div>
</div>
<div class="tw"><table>
<thead><tr><th>区分</th><th>適用法律</th><th>Arclightの対応</th></tr></thead>
<tbody>
<tr><td class="tc">資本金基準を満たす法人への委託</td><td><span class="tag t-law">取引適正化法</span> が主に適用</td><td>発注書＋検収書テンプレートで対応（支払が業績連動・利用許諾の場合は利用許諾報告書テンプレートも併用）</td></tr>
<tr><td class="tc">フリーランス・個人事業主への委託</td><td><span class="tag t-fl">フリーランス保護法</span> が追加的に適用</td><td>同テンプレート＋育児介護配慮義務に注意</td></tr>
<tr><td class="tc">両方該当する場合</td><td>両法の<strong>厳しい方の義務が優先</strong></td><td><strong>より厳格な要件を採用すること</strong></td></tr>
</tbody></table></div>

<h2 class="sec" id="po">発注書（PO）8必須記載事項</h2>
<div class="cl cl-i"><strong>取引適正化法3条・フリーランス法3条：</strong>発注時に書面または電磁的方法で必ず交付しなければならない</div>
<div class="tw"><table>
<thead><tr><th>No</th><th>記載欄</th><th>記載すべき内容</th><th>省略した場合のリスク</th></tr></thead>
<tbody>
<tr><td class="tc">① 給付内容</td><td>業務内容・成果物仕様</td><td>委託する業務の内容・成果物の仕様・品質基準を具体的に記載</td><td class="tcr">「一式」等の曖昧な記載は書面交付義務違反とみなされる可能性。後の仕様争いの元になる</td></tr>
<tr><td class="tc">② 委託金額</td><td>金額（税抜・税率・税込）</td><td>税抜金額・税率・税込合計を明示。業績連動の場合は算式も記載</td><td class="tcr">金額未記載・「別途協議」は3条書面要件を充足しない</td></tr>
<tr><td class="tc">③ 支払期日</td><td>支払条件</td><td>具体的な支払期日または「受領日から○日以内」の形で記載。60日超過禁止</td><td class="tcr">支払期日が60日を超える場合は法令違反。期日末記載は義務不履行</td></tr>
<tr><td class="tc">④ 支払方法</td><td>振込・手形等</td><td>銀行振込か手形かを明記。手形の場合はサイト日数も記載</td><td class="tcr">割引困難な手形の交付は禁止行為。現金払いが原則</td></tr>
<tr><td class="tc">⑤ 検収期間</td><td>異議期限</td><td>受領から検収完了までの期間を営業日数で明記</td><td>期間末記載の場合もみなし合格ルールは適用される可能性あり</td></tr>
<tr><td class="tc">⑥ 瑕疵担保期間</td><td>瑕疵担保期間</td><td>成果物引渡後の瑕疵担保責任の期間を明記</td><td>未記載の場合、法定期間や民法規定が適用されトラブルの原因に</td></tr>
<tr><td class="tc">⑦ 特約事項</td><td>業績連動・責任制限等</td><td>ロイヤルティ・承認例外・責任制限など標準条件と異なる事項</td><td class="tcr">特約を口頭で定めると後の争いになる。書面記載が必須</td></tr>
<tr><td class="tc">⑧ 発注日・発注番号</td><td>ORDER_NO / PO-AL-xxxx等</td><td>発注書の発行日と発注番号を記載</td><td class="tcr">番号がないと関連文書（検収書・支払記録）と紐づけができない</td></tr>
</tbody></table></div>

<h2 class="sec" id="inspection">検収フェーズの法的ルール</h2>
<h3 class="sub">60日ルールと検収の関係</h3>
<div class="timeline">
  <div class="tl-item ts"><div class="tll">受領日</div><div class="tlv">Day 0</div><div style="font-size:10px;margin-top:2px">起算点</div></div>
  <div class="tl-item tm"><div class="tll">検収期間（例：10営業日）</div><div class="tlv">合否判断</div></div>
  <div class="tl-item te"><div class="tll">支払期日（60日以内）</div><div class="tlv">法定上限</div></div>
</div>
<div class="cl cl-tl"><strong>【みなし合格ルール（フリーランス法4条2項）】</strong><br>・検収書に記載の異議期限内に不合格通知がない場合 → 給付（成果物）が完了したものとみなされる<br>・みなし合格後は支払拒否・減額はできない</div>
<h3 class="sub">検収フェーズの禁止行為</h3>
<div class="tw"><table>
<thead><tr><th>禁止行為</th><th>根拠条文</th><th>違反した場合</th></tr></thead>
<tbody>
<tr><td class="tc">受領拒否（正当理由なし）</td><td>取適法4条1項1号 / フリ法5条</td><td class="tcr">勧告・公表。既払い報酬の返還請求の可能性</td></tr>
<tr><td class="tc">検収期間の不当な引き延ばし</td><td>取適法2条の2 / フリ法4条1項</td><td class="tcr">60日ルール違反として遅延損害金（年14.6%）発生</td></tr>
<tr><td class="tc">不合格通知の期限超過の拒否</td><td>フリ法4条2項（みなし完了）</td><td class="tcr">支払義務が確定しており、拒否・減額は減額禁止違反</td></tr>
<tr><td class="tc">理由なき再提出要求・無償修正強要</td><td>取適法4条1項6号 / フリ法5条6号</td><td class="tcr">「不当なやり直しの要求」として禁止行為に該当</td></tr>
<tr><td class="tc">検収後の減額・値引き要求</td><td>取適法4条1項3号 / フリ法5条2号</td><td class="tcr">減額禁止に違反。刑事罰（50万円以下の罰金）</td></tr>
</tbody></table></div>

<h2 class="sec" id="payment">支払フェーズの法的ルール</h2>
<div class="tw"><table>
<thead><tr><th>項目</th><th>内容</th></tr></thead>
<tbody>
<tr><td class="tc">遅延損害金率</td><td><strong style="color:var(--red)">年14.6%</strong>（民法上の年3%より大幅に高い）</td></tr>
<tr><td class="tc">起算日</td><td>支払期日の翌日から支払完了日まで</td></tr>
<tr><td class="tc">計算方法</td><td>未払金額 × 14.6% ÷ 365 × 遅延日数</td></tr>
<tr><td class="tc">免除の可否</td><td class="tcr"><strong>当事者間の合意があっても原則として免除不可</strong></td></tr>
<tr><td class="tc">支払義務の発生</td><td><strong>遅延の理由（資金繰り等）を問わず自動的に発生</strong></td></tr>
</tbody></table></div>
<div class="cl cl-w" style="margin-top:12px;"><strong>受領日から60日以内に支払を完了することが法定義務。</strong> 遅延した場合は<strong>年14.6%の損害金が自動発生</strong>します（当事者間の合意があっても免除不可）。</div>
<div class="ap" style="font-size:12px;">遅延損害金の計算例：未払金100万円、遅延30日の場合<br><strong style="color:var(--red);font-size:14px;">1,000,000円 × 14.6% ÷ 365日 × 30日 ≒ 12,000円</strong><br><span style="color:var(--g5);font-size:11px;">※ 遅延が長期化するほど損害金が膨らむ。期日管理が最重要</span></div>
<h3 class="sub">支払フェーズの禁止行為一覧</h3>
<div class="tw"><table>
<thead><tr><th>禁止行為</th><th>根拠条文</th><th>実務上の注意点</th></tr></thead>
<tbody>
<tr><td class="tc">報酬の減額（合意なき値引き）</td><td>取適法4条1項3号 / フリ法5条2号</td><td class="tcr">「売上が下がったから減額」も違反。変更は書面で合意し直す</td></tr>
<tr><td class="tc">事前合意のない費用控除（振込手数料等）</td><td>取適法4条1項3号（実質的減額）</td><td class="tcr">控除項目を発注書に明記しない場合、一方的控除は減額禁止に抵触</td></tr>
<tr><td class="tc">支払の遅延</td><td>取適法4条1項2号 / フリ法4条（60日）</td><td class="tcr">資金繰りを理由にした支払遅延も違反。年14.6%の損害金が発生</td></tr>
<tr><td class="tc">割引困難な手形の交付</td><td>取適法4条1項4号</td><td>現金払いが原則。手形サイトが長い場合は減額とみなされる場合あり</td></tr>
<tr><td class="tc">不当な経済上の利益提供要請</td><td>フリ法5条4号</td><td class="tcr">「協賛金」「謝礼」「無償提供」等の名目での負担強制は禁止</td></tr>
<tr><td class="tc">報復的な取引停止</td><td>フリ法16条 / フリ法5条5号</td><td class="tcr">権利行使（申告・相談）に対する報復的行為は明示的に禁止</td></tr>
</tbody></table></div>

<div style="background:var(--navy);border-radius:8px;padding:18px 22px;margin-top:28px;text-align:center">
<div style="font-size:10px;color:rgba(255,255,255,.45);margin-bottom:5px">お問い合わせ先</div>
<div style="font-size:17px;font-weight:700;color:#fff;margin-bottom:3px">Arclight Inc. 経営管理本部 法務部</div>
<div style="font-size:12px;color:rgba(255,255,255,.65)">営業時間：平日 10:00〜18:00</div>
<div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:4px;font-style:italic">正しい法解釈を、すべての取引判断の出発点に。</div>
</div>
</main>
</body>
</html>$g_torihiki$, 'seed 0095 (from services/api/guides)', 'seed')
    RETURNING id INTO vid;
  UPDATE portal_guides
     SET current_version_id = vid, status = 'published', updated_at = now()
   WHERE id = gid;
END
$seed_torihiki$;

-- ── vendor ──────────────────────────────────────────────
DO $seed_vendor$
DECLARE gid INTEGER; vid INTEGER;
BEGIN
  SELECT id INTO gid FROM portal_guides WHERE guide_key = 'vendor';
  IF gid IS NULL THEN
    RAISE NOTICE 'skip vendor: portal_guides にメタ行なし(0094 を先に適用)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM portal_guide_versions WHERE guide_id = gid) THEN
    RETURN; -- 既に版あり。再適用しない(冪等)。
  END IF;
  INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
    VALUES (gid, 1, $g_vendor$<!DOCTYPE html><html lang="ja"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>新規取引先登録手続きガイド</title>
<style>
:root{--navy:#1d3557;--navy-l:#2a4a6e;--red:#e63946;--red-s:#fde8ea;--gold:#c47d1a;--gold-s:#fef3e2;--green:#1d9e75;--green-s:#e4f7f1;--blue:#378add;--blue-s:#e8f1fb;--g1:#f8f9fa;--g2:#e9ecef;--g3:#dee2e6;--g5:#6c757d;--tx:#212529;--tx2:#495057;--sw:220px;
--c1:#27500a;--c2:#0c447c;--c3:#633806;--c4:#085041}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;font-size:13.5px;line-height:1.7;color:var(--tx);background:#fff}
/* SIDEBAR */
#sidebar{position:fixed;top:0;left:0;width:var(--sw);height:100vh;background:var(--navy);overflow-y:auto;display:flex;flex-direction:column;z-index:100}
#sh{padding:18px 16px 14px;border-bottom:1px solid rgba(255,255,255,.1)}
#sh h1{font-size:10px;font-weight:700;color:rgba(255,255,255,.5);letter-spacing:.08em;text-transform:uppercase}
#sh p{font-size:12px;color:rgba(255,255,255,.9);font-weight:600;margin-top:4px;line-height:1.4}
nav{padding:8px 0 20px}
.ns{display:block;padding:5px 16px;font-size:10px;font-weight:700;color:rgba(255,255,255,.35);letter-spacing:.07em;text-transform:uppercase;margin-top:10px}
.nl{display:block;padding:5px 16px;font-size:12px;color:rgba(255,255,255,.72);text-decoration:none;border-left:2px solid transparent;transition:all .15s;line-height:1.4}
.nl:hover,.nl.active{color:#fff;background:rgba(255,255,255,.1);border-left-color:#e63946}
.nsub{display:block;padding:3px 16px 3px 26px;font-size:11px;color:rgba(255,255,255,.48);text-decoration:none;transition:color .15s}
.nsub:hover{color:rgba(255,255,255,.85)}
.sbdg{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-size:9px;font-weight:700;margin-right:5px;vertical-align:middle}
.sb1{background:#eaf3de;color:var(--c1)}.sb2{background:#e8f1fb;color:var(--c2)}.sb3{background:#faeeda;color:var(--c3)}.sb4{background:#e1f5ee;color:var(--c4)}
/* MAIN */
#main{margin-left:var(--sw);padding:40px 48px 80px;max-width:calc(var(--sw) + 820px)}
h1.dt{font-size:22px;font-weight:700;color:var(--navy);border-bottom:3px solid var(--navy);padding-bottom:10px;margin-bottom:6px}
.dm{font-size:12px;color:var(--g5);margin-bottom:32px}
h2.sec{font-size:17px;font-weight:700;color:var(--navy);border-left:4px solid var(--navy);padding-left:10px;margin:36px 0 14px;scroll-margin-top:20px}
h3.sub{font-size:14px;font-weight:700;color:var(--navy-l);margin:22px 0 10px;padding-bottom:4px;border-bottom:1px solid var(--g3);scroll-margin-top:20px}
h4.sh4{font-size:13px;font-weight:700;color:var(--tx2);margin:14px 0 8px}
p{margin-bottom:10px;color:var(--tx2)}strong{color:var(--tx)}
ul,ol{padding-left:20px;margin-bottom:10px;color:var(--tx2)}li{margin-bottom:4px}
/* STEP HEADER */
.shb{border-radius:8px;padding:14px 20px;margin-bottom:18px;scroll-margin-top:16px}
.shb.s1{background:var(--c1)}.shb.s2{background:var(--c2)}.shb.s3{background:var(--c3)}.shb.s4{background:var(--c4)}
.shb .sn{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:3px}
.shb h2{font-size:15px;font-weight:700;color:#fff;border:none;padding:0;margin:0}
.shb .sdesc{font-size:12px;color:rgba(255,255,255,.7);margin-top:5px}
/* CALLOUT */
.cl{border-left:3px solid;padding:9px 13px;border-radius:0 5px 5px 0;margin:10px 0;font-size:13px}
.cl-w{border-color:var(--red);background:var(--red-s)}.cl-i{border-color:var(--blue);background:var(--blue-s)}.cl-t{border-color:var(--green);background:var(--green-s)}.cl-n{border-color:var(--gold);background:var(--gold-s)}
/* TABLE */
.tw{overflow-x:auto;margin:10px 0}
table{width:100%;border-collapse:collapse;font-size:12.5px}
thead th{background:var(--navy);color:#fff;padding:7px 10px;text-align:left;font-weight:600;font-size:12px;white-space:nowrap}
tbody tr:nth-child(even){background:var(--g1)}
tbody td{padding:7px 10px;border-bottom:1px solid var(--g3);vertical-align:top;line-height:1.55}
tbody tr:hover{background:#f0f4ff}
td.tc{font-weight:600;white-space:nowrap;color:var(--navy);font-size:12px}
td.tcr{font-weight:700;color:var(--red)}
/* BADGES */
.badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;padding:3px 10px;border-radius:4px}
.biz{background:#eaf3de;color:var(--c1)}.leg{background:#faeeda;color:var(--c3)}.acc{background:#e8f1fb;color:var(--c2)}.ctr{background:#f3f3f3;color:#374151;border:1px solid var(--g3)}
.tag{display:inline-block;font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;margin-right:3px}
.t-biz{background:#eaf3de;color:var(--c1)}.t-leg{background:#faeeda;color:var(--c3)}.t-acc{background:#e8f1fb;color:var(--c2)}.t-ctr{background:#f3f3f3;color:#374151}
/* CHECKLIST */
.check-list{list-style:none;padding:0;margin:8px 0}
.check-list li{padding:8px 10px 8px 32px;position:relative;border-bottom:1px solid var(--g2);font-size:12.5px;color:var(--tx2)}
.check-list li::before{content:"☐";position:absolute;left:8px;font-size:14px;color:var(--navy);line-height:1.5}
.check-list li:last-child{border-bottom:none}
/* PITFALL */
.pl{list-style:none;padding:0;margin:7px 0}
.pl li{padding:6px 10px 6px 28px;position:relative;border-bottom:1px solid var(--g2);font-size:12.5px;color:var(--tx2)}
.pl li::before{content:"⚠";position:absolute;left:7px;font-size:11px}
.pl li:last-child{border-bottom:none}
/* OVERVIEW GRID */
.ov-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}
.ov-card{border-radius:8px;padding:14px 12px;text-decoration:none;display:block;transition:transform .15s,box-shadow .15s}
.ov-card:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.12)}
.ov-card.s1{background:var(--c1)}.ov-card.s2{background:var(--c2)}.ov-card.s3{background:var(--c3)}.ov-card.s4{background:var(--c4)}
.ov-num{font-size:22px;font-weight:700;opacity:.35;margin-bottom:4px;color:#fff}
.ov-title{font-size:12px;font-weight:700;line-height:1.4;color:#fff}
.ov-sub{font-size:10px;color:rgba(255,255,255,.65);margin-top:4px;line-height:1.4}
/* BADGE ROW */
.bdg-row{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap}
/* FLOW DIAGRAM WRAPPER */
.dw{background:var(--g1);border:1px solid var(--g3);border-radius:6px;padding:14px 14px 10px;margin:10px 0}
.dtitle{font-size:10px;font-weight:700;color:var(--g5);letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px}
/* MISC */
.ap{background:var(--g1);border-radius:8px;padding:16px 20px;margin-bottom:18px;font-size:12.5px;line-height:1.8}
hr.sd{border:none;border-top:2px solid var(--g2);margin:36px 0}
</style>

<style id="gas-portal-back-style">
.portal-back-button{position:fixed;right:16px;bottom:16px;z-index:3000;display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:999px;background:#1d3557;color:#fff;text-decoration:none;font-size:12px;font-weight:700;box-shadow:0 3px 12px rgba(0,0,0,.22);opacity:.92;transition:opacity .15s,transform .15s}
.portal-back-button:hover{opacity:1;transform:translateY(-1px)}
@media print{.portal-back-button{display:none}}
</style>

</head>
<body>
<?!= include('common_top_tabs', { appUrl: appUrl, currentPage: currentPage }); ?>
<!-- SIDEBAR -->
<aside id="sidebar">
<div id="sh"><h1>法務部</h1><p>新規取引先登録<br>手続きガイド</p></div>
<nav>
<a class="nl" href="#overview">手続き概要</a>
<a class="nl" href="#roles">担当者と凡例</a>
<a class="nl" href="#flowcomp">新旧フロー比較</a>
<span class="ns">手続きステップ</span>
<a class="nl" href="#step1"><span class="sbdg sb1">1</span>取引先の検索</a>
<a class="nl" href="#step2"><span class="sbdg sb2">2</span>情報提供と契約確認</a>
<a class="nsub" href="#checklist">事業部チェックリスト</a>
<a class="nl" href="#step3"><span class="sbdg sb3">3</span>締結と情報連携</a>
<a class="nl" href="#step4"><span class="sbdg sb4">4</span>締結完了の共有</a>
<span class="ns">参考</span>
<a class="nl" href="#target">対象契約と取得情報</a>
<a class="nl" href="#change">登録情報の変更</a>
<a class="nl" href="#notes">注意事項</a>
</nav>
</aside>

<!-- MAIN -->
<main id="main">
<h1 class="dt">新規取引先登録手続きガイド</h1>
<p class="dm">作成日：2026年4月　法務部次長 倉持達也　｜　対象：BG事業部担当者　｜　適用：2026年5月〜</p>

<!-- 概要 -->
<h2 class="sec" id="overview">手続き概要</h2>
<p><strong>登録情報欄付き契約書</strong>を活用することで、従来の「執筆者登録ファイル」の別途送付・回収を廃止し、契約確認と取引先登録を同時に完結します。</p>
<div class="ov-grid">
  <a class="ov-card s1" href="#step1"><div class="ov-num">01</div><div class="ov-title">取引先の検索</div><div class="ov-sub">既存登録の有無を確認</div></a>
  <a class="ov-card s2" href="#step2"><div class="ov-num">02</div><div class="ov-title">情報提供と<br>契約内容の確認</div><div class="ov-sub">取引先へ契約書送付・返送確認</div></a>
  <a class="ov-card s3" href="#step3"><div class="ov-num">03</div><div class="ov-title">基本契約の締結と<br>取引先情報連携</div><div class="ov-sub">法務→取引先・経理</div></a>
  <a class="ov-card s4" href="#step4"><div class="ov-num">04</div><div class="ov-title">締結完了情報の共有</div><div class="ov-sub">法務→事業部 Slack連携</div></a>
</div>
<div class="cl cl-t"><strong>効果：</strong> ファイルやり取りの削減・登録漏れ／遅延の防止・クラウドサイン送信の簡素化</div>

<!-- 担当者凡例 -->
<h2 class="sec" id="roles">担当者と凡例</h2>
<div class="bdg-row">
  <span class="badge biz">事業部</span>
  <span class="badge leg">法務部</span>
  <span class="badge acc">経理部</span>
  <span class="badge ctr">取引先</span>
</div>
<div class="tw"><table>
<thead><tr><th>担当</th><th>役割</th></tr></thead>
<tbody>
<tr><td><span class="badge biz">事業部</span></td><td>取引先の発掘・連絡窓口・内容確認・法務への橋渡し</td></tr>
<tr><td><span class="badge leg">法務部</span></td><td>契約書の最終確認・クラウドサインによる送信・経理部への情報連携・締結完了の事業部通知</td></tr>
<tr><td><span class="badge acc">経理部</span></td><td>登録情報入り契約書（写し）を受領し、取引先マスタへ登録</td></tr>
<tr><td><span class="badge ctr">取引先</span></td><td>契約条件の確認・登録情報欄への記入・返送・クラウドサインで署名</td></tr>
</tbody></table></div>

<!-- 新旧フロー比較 -->
<h2 class="sec" id="flowcomp">新旧フロー比較</h2>
<div class="tw"><table>
<thead><tr><th style="width:50%">❌ 従来のフロー（廃止）</th><th style="width:50%">✅ 新しいフロー（2026年5月〜）</th></tr></thead>
<tbody><tr>
<td style="vertical-align:top;font-size:12px;line-height:2">
① <span class="tag t-biz">事業部</span>「執筆者登録」ファイルを取引先へ送付<br>
② <span class="tag t-ctr">取引先</span>ファイルを編集・記入して返送<br>
③ <span class="tag t-biz">事業部</span>登録ファイルを経理部へ提出<br>
④ <span class="tag t-biz">事業部</span>法務部へ契約書作成を依頼<br>
⑤ <span class="tag t-leg">法務部</span>契約書を作成<br>
⑥ <span class="tag t-biz">事業部</span>法務作成の契約書を取引先へ確認依頼<br>
⑦ <span class="tag t-ctr">取引先</span>内容を確認・OKを返答<br>
⑧ <span class="tag t-biz">事業部</span>法務部へOKの旨を連絡<br>
⑨ <span class="tag t-leg">法務部</span>クラウドサイン（または郵送）で送信
</td>
<td style="vertical-align:top;font-size:12px;line-height:2">
① <span class="tag t-biz">事業部</span>登録情報欄付き契約書ドラフトを取引先へ送付（記入も依頼）<br>
② <span class="tag t-ctr">取引先</span>契約条件の確認＋登録情報欄に記入して返送<br>
③ <span class="tag t-biz">事業部</span>返送内容を確認（契約条件＋登録情報の不備）<br>
④ <span class="tag t-biz">事業部</span>確認済み契約書を法務部へ送付<br>
⑤ <span class="tag t-leg">法務部</span>クラウドサインで取引先へ送信（締結完了）<br>
⑥ <span class="tag t-leg">法務部</span>登録情報入り契約書（写し）を経理部へ連携<br>
⑦ <span class="tag t-leg">法務部</span>締結完了を事業部へSlack通知
</td>
</tr></tbody></table></div>

<hr class="sd">

<!-- ===== STEP 1 ===== -->
<div class="shb s1" id="step1">
  <div class="sn">Step 01</div>
  <h2>取引先の検索</h2>
  <div class="sdesc">担当：<strong style="color:#fff">事業部</strong></div>
</div>
<h4 class="sh4">フロー</h4>
<div class="dw"><div id="dg-s1"><svg viewBox="0 0 700 150" style="width: 100%; display: block;"><defs><marker id="v0grn" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#1d9e75"></polygon></marker><marker id="v0nvy" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#1d3557"></polygon></marker><marker id="v0gld" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#c47d1a"></polygon></marker><marker id="v0red" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#e63946"></polygon></marker><marker id="v0blu" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#378add"></polygon></marker><marker id="v0gry" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#9CA3AF"></polygon></marker></defs><rect x="10" y="52" width="88" height="40" rx="6" fill="#27500a"></rect><text x="54" y="76" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="12" font-weight="600" fill="#fff">事業部</text><rect x="148" y="40" width="136" height="56" rx="6" fill="#fff" stroke="#9CA3AF" stroke-width="1.2"></rect><text x="216" y="64" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11.5" font-weight="600" fill="#374151">社内システムで検索</text><text x="216" y="78" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#9CA3AF">Slack: /法務検索 を実行</text><polygon points="394,26 448,68 394,110 340,68" fill="#fff" stroke="#374151" stroke-width="1.4"></polygon><text x="394" y="72" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11" font-weight="600" fill="#374151">登録あり？</text><rect x="504" y="16" width="178" height="36" rx="6" fill="rgba(0,0,0,.02)" stroke="#B5C6D4" stroke-width="1.2" stroke-dasharray="4,2"></rect><text x="593" y="30" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11.5" font-weight="600" fill="#374151">登録あり</text><text x="593" y="44" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#9CA3AF">案件番号を確認</text><rect x="504" y="92" width="178" height="38" rx="6" fill="#0c447c"></rect><text x="593" y="115" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="12" font-weight="600" fill="#fff">登録なし → Step 2</text><line x1="100" y1="72" x2="146" y2="72" stroke="#1d9e75" stroke-width="1.5" marker-end="url(#v0grn)"></line><text x="123" y="67" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#1d9e75">検索実行</text><line x1="286" y1="68" x2="338" y2="68" stroke="#1d3557" stroke-width="1.5" marker-end="url(#v0nvy)"></line><polyline points="448,60 480,60 480,34 502,34" stroke="#1d9e75" stroke-width="1.5" fill="none" marker-end="url(#v0grn)"></polyline><text x="460" y="50" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#1d9e75">あり</text><polyline points="448,76 480,76 480,111 502,111" stroke="#378add" stroke-width="1.5" fill="none" marker-end="url(#v0blu)"></polyline><text x="460" y="96" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#378add">なし</text></svg></div></div>
<h3 class="sub">実施内容</h3>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th><th>確認ポイント</th></tr></thead>
<tbody>
<tr><td><span class="badge biz">事業部</span></td><td>社内システムで取引先名・屋号等を検索する<br><span style="font-size:11px;color:var(--g5);">💬 Slackで <code>/法務検索</code> を実行</span></td><td>正式商号・屋号・旧社名の複数パターンで検索する</td></tr>
<tr><td colspan="3" style="background:#f0f7ee;font-size:12px;line-height:1.8">
  <strong>✅ 検索結果あり：</strong> 既存の契約番号・案件番号を確認する。追加取引の場合はStep 2〜4が不要になる場合がある<br>
  <strong>➡ 検索結果なし：</strong> 新規登録が必要。Step 2 へ進む
</td></tr>
</tbody></table></div>
<div class="cl cl-n"><strong>注意：</strong> 個人事業主は屋号だけでなく本名でも検索すること。法人は「株式会社」等の法人格を含む正式名称で検索する。</div>

<hr class="sd">

<!-- ===== STEP 2 ===== -->
<div class="shb s2" id="step2">
  <div class="sn">Step 02</div>
  <h2>情報提供と契約内容の確認</h2>
  <div class="sdesc">担当：<strong style="color:#fff">事業部 ⇔ 取引先</strong></div>
</div>
<h4 class="sh4">フロー</h4>
<div class="dw"><div id="dg-s2"><svg viewBox="0 0 680 210" style="width: 100%; display: block;"><defs><marker id="v1grn" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#1d9e75"></polygon></marker><marker id="v1nvy" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#1d3557"></polygon></marker><marker id="v1gld" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#c47d1a"></polygon></marker><marker id="v1red" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#e63946"></polygon></marker><marker id="v1blu" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#378add"></polygon></marker><marker id="v1gry" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#9CA3AF"></polygon></marker></defs><rect x="10" y="62" width="88" height="44" rx="6" fill="#27500a"></rect><text x="54" y="88" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="12" font-weight="600" fill="#fff">事業部</text><rect x="150" y="62" width="100" height="44" rx="6" fill="#fff" stroke="#9CA3AF" stroke-width="1.2"></rect><text x="200" y="80" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11.5" font-weight="600" fill="#374151">取引先</text><text x="200" y="94" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#9CA3AF">記入・返送</text><polygon points="358,40 412,84 358,128 304,84" fill="#fff" stroke="#374151" stroke-width="1.4"></polygon><text x="358" y="88" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11" font-weight="600" fill="#374151">不備確認</text><rect x="474" y="44" width="116" height="40" rx="6" fill="#1d9e75"></rect><text x="532" y="60" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="12" font-weight="600" fill="#fff">不備なし</text><text x="532" y="74" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="rgba(255,255,255,.55)">Step 3 へ</text><rect x="304" y="158" width="108" height="38" rx="6" fill="#fff" stroke="#9CA3AF" stroke-width="1.2"></rect><text x="358" y="173" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11.5" font-weight="600" fill="#374151">不備あり</text><text x="358" y="187" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#9CA3AF">取引先へ確認依頼</text><line x1="98" y1="80" x2="148" y2="80" stroke="#c47d1a" stroke-width="1.5" marker-end="url(#v1gld)"></line><text x="123" y="74" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#c47d1a">送付</text><line x1="148" y1="88" x2="98" y2="88" stroke="#1d3557" stroke-width="1.5" marker-end="url(#v1nvy)"></line><text x="123" y="101" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#1d3557">返送</text><line x1="252" y1="84" x2="302" y2="84" stroke="#1d3557" stroke-width="1.5" marker-end="url(#v1nvy)"></line><polyline points="412,70 444,70 444,64 472,64" stroke="#1d9e75" stroke-width="1.5" fill="none" marker-end="url(#v1grn)"></polyline><text x="420" y="61" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#1d9e75">不備なし</text><line x1="358" y1="128" x2="358" y2="156" stroke="#e63946" stroke-width="1.5" marker-end="url(#v1red)"></line><text x="368" y="143" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#e63946">不備あり</text><polyline points="302,177 120,177 120,84 148,84" stroke="#9CA3AF" stroke-width="1.5" fill="none" marker-end="url(#v1gry)" stroke-dasharray="5,3"></polyline><text x="208" y="185" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#9CA3AF">修正依頼・再確認</text></svg></div></div>
<h3 class="sub">実施内容</h3>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th><th>ポイント</th></tr></thead>
<tbody>
<tr><td><span class="badge biz">事業部</span></td><td>登録情報欄付き契約書ドラフトを取引先へ送付。契約条件の確認と登録情報欄の記入を依頼</td><td>送付時は下記の依頼文例を添える</td></tr>
<tr><td><span class="badge ctr">取引先</span></td><td>契約条件を確認 ＋ 登録情報欄に記入して返送</td><td>基本情報・振込先口座・インボイス情報の3点を記入</td></tr>
<tr><td><span class="badge biz">事業部</span></td><td>返送内容の確認（契約条件 ＋ 登録情報の不備）</td><td>下記チェックリスト参照</td></tr>
<tr><td><span class="badge biz">事業部</span></td><td><strong>不備なし：</strong> 確認済み契約書を法務部へ送付 → Step 3 へ</td><td></td></tr>
<tr><td><span class="badge biz">事業部</span></td><td><strong>不備あり：</strong> 不備内容を取引先へ確認・修正依頼。修正完了後に再確認</td><td>修正依頼は具体的に（例：「口座番号の桁数不足」「T+13桁の登録番号未記載」など）</td></tr>
</tbody></table></div>

<h4 class="sh4">取引先への送付時の依頼文例</h4>
<div class="ap">
本契約書は、契約条件の確認とあわせて取引先登録にも使用します。<br>
冒頭の「相手方情報」「振込先銀行口座」「インボイス制度関連情報」をご確認いただき、必要事項のご記入・修正をお願いいたします。<br>
ご確認後、本ファイルをご返送いただければ幸いです。
</div>

<div class="cl cl-w">
<strong>役割の違いに注意：</strong><br>
・業務委託契約：相手方は「<strong>乙（受託者）</strong>」欄<br>
・ライセンス契約：相手方は「<strong>甲（ライセンサー）</strong>」欄<br>
送付前に登録対象がどちらの欄に入るか必ず確認すること。
</div>

<h3 class="sub" id="checklist">事業部チェックリスト（法務送付前に確認）</h3>
<ul class="check-list">
<li><strong>相手方基本情報：</strong> 会社名（正式名称）・住所・代表者名・電話番号・メールアドレスが記載されているか</li>
<li><strong>銀行口座情報：</strong> 銀行名・支店名・口座種別・口座番号・口座名義（カナ）がすべて揃っているか。口座名義と契約当事者名が一致しているか</li>
<li><strong>インボイス情報：</strong> 適格請求書発行事業者か否かが明確か。登録事業者の場合は登録番号（T＋13桁）が記載されているか</li>
<li><strong>当事者表示の一致：</strong> 契約本文の当事者欄と登録情報欄の名称が一致しているか（業務委託＝乙欄 / ライセンス＝甲欄）</li>
</ul>

<hr class="sd">

<!-- ===== STEP 3 ===== -->
<div class="shb s3" id="step3">
  <div class="sn">Step 03</div>
  <h2>基本契約の締結と取引先情報連携</h2>
  <div class="sdesc">担当：<strong style="color:#fff">法務部</strong></div>
</div>
<h4 class="sh4">フロー</h4>
<div class="dw"><div id="dg-s3"><svg viewBox="0 0 700 190" style="width: 100%; display: block;"><defs><marker id="v2grn" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#1d9e75"></polygon></marker><marker id="v2nvy" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#1d3557"></polygon></marker><marker id="v2gld" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#c47d1a"></polygon></marker><marker id="v2red" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#e63946"></polygon></marker><marker id="v2blu" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#378add"></polygon></marker><marker id="v2gry" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#9CA3AF"></polygon></marker></defs><rect x="10" y="66" width="90" height="44" rx="6" fill="#633806"></rect><text x="55" y="92" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="12" font-weight="600" fill="#fff">法務部</text><rect x="152" y="50" width="130" height="64" rx="6" fill="#fff" stroke="#9CA3AF" stroke-width="1.2"></rect><text x="217" y="78" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11.5" font-weight="600" fill="#374151">クラウドサインで</text><text x="217" y="92" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#9CA3AF">電子契約送信（案内資料付き）</text><rect x="340" y="66" width="100" height="44" rx="6" fill="rgba(0,0,0,.02)" stroke="#B5C6D4" stroke-width="1.2" stroke-dasharray="4,2"></rect><text x="390" y="84" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11.5" font-weight="600" fill="#374151">取引先</text><text x="390" y="98" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#9CA3AF">署名・締結</text><rect x="494" y="18" width="130" height="38" rx="6" fill="#1d9e75"></rect><text x="559" y="41" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="12" font-weight="600" fill="#fff">締結完了</text><rect x="494" y="134" width="130" height="38" rx="6" fill="#0c447c"></rect><text x="559" y="149" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="12" font-weight="600" fill="#fff">経理部</text><text x="559" y="163" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="rgba(255,255,255,.55)">取引先登録</text><line x1="102" y1="88" x2="150" y2="88" stroke="#c47d1a" stroke-width="1.5" marker-end="url(#v2gld)"></line><line x1="282" y1="80" x2="338" y2="80" stroke="#1d3557" stroke-width="1.5" marker-end="url(#v2nvy)"></line><text x="310" y="74" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#1d3557">署名依頼</text><line x1="338" y1="90" x2="282" y2="90" stroke="#1d9e75" stroke-width="1.5" marker-end="url(#v2grn)"></line><text x="310" y="103" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#1d9e75">締結完了</text><polyline points="390,64 390,37 492,37" stroke="#1d9e75" stroke-width="1.5" fill="none" marker-end="url(#v2grn)"></polyline><text x="438" y="30" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#1d9e75">締結完了通知</text><polyline points="390,112 390,153 492,153" stroke="#c47d1a" stroke-width="1.5" fill="none" marker-end="url(#v2gld)"></polyline><text x="438" y="163" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#c47d1a">契約書写しを連携</text></svg></div></div>
<h3 class="sub">実施内容</h3>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th><th>ポイント</th></tr></thead>
<tbody>
<tr><td><span class="badge leg">法務部</span></td><td>事業部から受領した確認済み契約書の内容を最終確認</td><td>不備があれば事業部へ差し戻し</td></tr>
<tr><td><span class="badge leg">法務部</span></td><td><strong>クラウドサインで取引先へ電子契約を送信</strong>（クラウドサイン利用案内を添付）</td><td>取引先が電子契約に不慣れな場合は事前に電話等でフォローする</td></tr>
<tr><td><span class="badge ctr">取引先</span></td><td>クラウドサインで契約書に署名・締結完了</td><td></td></tr>
<tr><td><span class="badge leg">法務部</span></td><td><strong>登録情報入り契約書（写し）を経理部へ連携</strong></td><td>旧「執筆者登録」ファイルは使用しない。契約書写しで一本化</td></tr>
<tr><td><span class="badge acc">経理部</span></td><td>契約書写しをもとに取引先マスタへ登録</td><td></td></tr>
</tbody></table></div>
<div class="cl cl-t"><strong>クラウドサイン送信時は「クラウドサイン利用案内」を必ず添付すること。</strong></div>

<hr class="sd">

<!-- ===== STEP 4 ===== -->
<div class="shb s4" id="step4">
  <div class="sn">Step 04</div>
  <h2>締結完了情報の共有</h2>
  <div class="sdesc">担当：<strong style="color:#fff">法務部 → 事業部</strong></div>
</div>
<h4 class="sh4">フロー</h4>
<div class="dw"><div id="dg-s4"><svg viewBox="0 0 560 108" style="width: 100%; display: block;"><defs><marker id="v3grn" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#1d9e75"></polygon></marker><marker id="v3nvy" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#1d3557"></polygon></marker><marker id="v3gld" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#c47d1a"></polygon></marker><marker id="v3red" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#e63946"></polygon></marker><marker id="v3blu" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#378add"></polygon></marker><marker id="v3gry" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#9CA3AF"></polygon></marker></defs><rect x="8" y="32" width="96" height="40" rx="6" fill="#085041"></rect><text x="56" y="56" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="12" font-weight="600" fill="#fff">法務部</text><rect x="160" y="26" width="148" height="52" rx="6" fill="#fff" stroke="#9CA3AF" stroke-width="1.2"></rect><text x="234" y="48" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11.5" font-weight="600" fill="#374151">Slack通知</text><text x="234" y="62" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#9CA3AF">取引先名・契約番号・締結日等</text><rect x="368" y="32" width="120" height="40" rx="6" fill="#27500a"></rect><text x="428" y="48" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="12" font-weight="600" fill="#fff">事業部</text><text x="428" y="62" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="rgba(255,255,255,.55)">確認・業務開始</text><line x1="106" y1="52" x2="158" y2="52" stroke="#1d9e75" stroke-width="1.5" marker-end="url(#v3grn)"></line><text x="132" y="47" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#1d9e75">通知送信</text><line x1="310" y1="52" x2="366" y2="52" stroke="#1d9e75" stroke-width="1.5" marker-end="url(#v3grn)"></line><text x="338" y="47" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#1d9e75">通知受信</text></svg></div></div>
<h3 class="sub">実施内容</h3>
<div class="tw"><table>
<thead><tr><th>担当</th><th>作業</th><th>通知内容</th></tr></thead>
<tbody>
<tr><td><span class="badge leg">法務部</span></td><td>締結完了を事業部へ <strong>Slack で通知</strong></td><td>取引先名・契約種別・契約番号・締結日・経理部連携済みの旨</td></tr>
<tr><td><span class="badge biz">事業部</span></td><td>Slack通知を確認し、発注・業務開始の手続きへ移行</td><td>Slack通知受信前の発注・業務開始は不可</td></tr>
</tbody></table></div>
<div class="cl cl-w"><strong>注意：</strong> 締結完了のSlack通知を受け取るまで、発注書の発行・業務の開始・報酬の支払いを行わないこと。</div>

<hr class="sd">

<!-- 対象契約と取得情報 -->
<h2 class="sec" id="target">対象契約と取得する登録情報</h2>
<div class="cl cl-i">対象は<strong>業務委託契約書・ライセンス利用許諾基本契約書のみ</strong>。他の契約種別は従来の手続きによる。</div>
<div class="tw"><table>
<thead><tr><th>区分</th><th>業務委託基本契約書（乙欄）</th><th>ライセンス利用許諾基本契約書（甲欄）</th><th>確認ポイント</th></tr></thead>
<tbody>
<tr><td class="tc">基本情報</td><td>住所・商号・代表者<br>電話番号・メール</td><td>住所・商号・代表者<br>電話番号・メール</td><td>正式名称・住所表記・代表者肩書を契約本文と一致させる</td></tr>
<tr><td class="tc">振込先口座</td><td>銀行名・支店名・口座種別<br>口座番号・口座名義（カナ）</td><td>銀行名・支店名・口座種別<br>口座番号・口座名義（カナ）</td><td>桁数・カナ漏れ・法人/個人の受取名義違いを確認</td></tr>
<tr><td class="tc">インボイス</td><td>適格事業者か否か・登録番号</td><td>適格事業者か否か・登録番号</td><td>未登録の場合もその旨を明確に。登録番号（T＋13桁）の記載漏れに注意</td></tr>
</tbody></table></div>

<!-- 登録情報の変更 -->
<h2 class="sec" id="change">登録情報の変更が生じた場合</h2>
<div class="tw"><table>
<thead><tr><th>Step</th><th>対応</th><th>内容</th></tr></thead>
<tbody>
<tr><td>1</td><td><strong>既存情報の確認</strong></td><td>既存の契約番号・案件番号を確認する</td></tr>
<tr><td>2</td><td><strong>変更内容の分類</strong></td><td>当事者情報 ／ 口座情報 ／ インボイス情報のいずれかを確認する</td></tr>
<tr><td>3</td><td><strong>社内共有</strong></td><td>経理部・法務部に変更内容を共有する</td></tr>
<tr><td>4</td><td><strong>書類対応</strong></td><td>必要に応じて契約書差替え・覚書・登録情報更新を行う</td></tr>
<tr><td>5</td><td class="tcr"><strong>旧情報での処理禁止</strong></td><td>口座変更・インボイス変更は優先確認。旧情報のまま支払処理を進めない</td></tr>
</tbody></table></div>

<!-- 注意事項 -->
<h2 class="sec" id="notes">注意事項</h2>
<ul class="pl">
<li>本手続きは<strong>業務委託契約書・ライセンス契約書のみ対象</strong>。売買契約等の他の契約種別は従来の手続きによる</li>
<li>取引先からの変更連絡は必ず経理部・法務部の双方へ共有すること。片方のみへの連絡は登録情報のずれを招く</li>
<li>登録番号（T＋13桁）の確認は国税庁の<strong>インボイス制度適格請求書発行事業者公表サイト</strong>で必ず照合すること</li>
<li>口座情報の変更は詐欺被害の対象になりやすい。電話等で取引先本人に確認してから処理すること</li>
<li>ご不明点は<strong>法務部（倉持）</strong>まで</li>
</ul>

</main>




</body></html>$g_vendor$, 'seed 0095 (from services/api/guides)', 'seed')
    RETURNING id INTO vid;
  UPDATE portal_guides
     SET current_version_id = vid, status = 'published', updated_at = now()
   WHERE id = gid;
END
$seed_vendor$;

