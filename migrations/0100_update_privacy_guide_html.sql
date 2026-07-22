-- 0100_update_privacy_guide_html.sql  (GENERATED — do not edit by hand)
-- 生成元: services/api/guides/privacy.html
-- 個人情報 運用ガイド(privacy)に「個人情報管理台帳」ガイドの要素を追記した再構築版を
-- 新しい版として投入し、portal_guides.current_version_id を貼り替える(公開)。
-- 冪等: 現行版が本ファイルと同一なら何もしない。sync-guides-to-db.mjs と整合。

DO $upd_privacy$
DECLARE
  gid INTEGER;
  vid INTEGER;
  cur TEXT;
  nextver INTEGER;
  newhtml TEXT := $g_privacy$<!DOCTYPE html><html lang="ja"><head>
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
<a class="nl" href="#daicho">個人情報保護台帳とは</a>
<a class="nsub" href="#daicho-what">人の一覧ではなく取扱いの一覧</a>
<a class="nsub" href="#daicho-image">台帳の実物イメージ</a>
<a class="nsub" href="#daicho-life">台帳のライフサイクル</a>
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
<a class="nl" href="#cases">ケース別の判断例</a>
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
<div class="cl cl-n"><strong>「台帳」がピンとこない方へ：</strong> 工程①以降で何度も出てくる<strong>「個人情報保護台帳」</strong>を、実物イメージつきで先に説明しています（→ <a href="#daicho" style="color:var(--gold)">個人情報保護台帳とは</a>）。ここを読んでおくと、以降がぐっと分かりやすくなります。</div>

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

<!-- ========== 個人情報保護台帳とは（基礎） ========== -->
<h2 class="sec" id="daicho">個人情報保護台帳とは（このガイドの土台）</h2>
<div class="cl cl-i">工程①以降で何度も出てくる<strong>「個人情報保護台帳」（以下、台帳）</strong>を先に押さえておきましょう。台帳は、社内で扱う個人情報の<strong>「取扱単位」を一覧化した管理表</strong>です。<strong>個人一人ひとりを並べた“名簿”ではなく</strong>、フォーム・名簿・システムなど<strong>取得の“器”ごとに、その取扱条件</strong>（利用目的・取得項目・保存先・保存期間など）を登録します。ここが分かると、以降の「フォーマット」「台帳登録」「申請」がスッと読めます。</div>

<h3 class="sub" id="daicho-what">「人の一覧」ではなく「取扱いの一覧」</h3>
<div class="case-grid">
  <div class="case-card A" style="border-color:var(--red);background:var(--red-s)">
    <h4 style="color:var(--red);border-color:var(--red)">× 台帳ではないもの（＝名簿）</h4>
    <ul>
      <li>顧客A　氏名／住所／電話番号</li>
      <li>顧客B　氏名／住所／電話番号</li>
      <li>顧客C　氏名／住所／電話番号</li>
    </ul>
    <p style="font-size:11.5px;margin-top:7px;color:var(--tx2)">これは<strong>「個人情報そのもの」や「名簿」</strong>です。台帳には載せません。</p>
  </div>
  <div class="case-card B">
    <h4>○ 台帳に登録するもの（＝取扱い単位）</h4>
    <ul>
      <li>イベント申込フォーム</li>
      <li>キャンペーン応募者リスト</li>
      <li>従業員緊急連絡先シート</li>
    </ul>
    <p style="font-size:11.5px;margin-top:7px;color:var(--tx2)">これは<strong>「個人情報の取扱い単位」</strong>です。1件ごとに、下の4点を登録します。</p>
  </div>
</div>
<div class="pillars" style="grid-template-columns:repeat(4,1fr)">
  <div class="pillar"><div class="pn">何のために使うか</div><div class="pt" style="font-size:12.5px">利用目的</div><div class="pd">例：参加受付・連絡、抽選・賞品発送</div></div>
  <div class="pillar"><div class="pn">何を取得するか</div><div class="pt" style="font-size:12.5px">取得項目</div><div class="pd">例：氏名・メール・住所・年齢区分</div></div>
  <div class="pillar"><div class="pn">どこに保存するか</div><div class="pt" style="font-size:12.5px">保存先</div><div class="pd">例：申込システム・共有フォルダ</div></div>
  <div class="pillar"><div class="pn">いつ削除するか</div><div class="pt" style="font-size:12.5px">保存期間・削除</div><div class="pd">例：終了後6か月、発送後3か月</div></div>
</div>
<div class="cl cl-t"><strong>台帳の目的：</strong> <strong>どの部門が・どの個人情報を・どの条件で扱っているか</strong>を、会社として把握できる状態にすること。だから台帳には「人」ではなく「取扱いの器」を登録します。</div>

<h3 class="sub" id="daicho-image">台帳の実物イメージ（Excel・スプレッドシートの一覧表）</h3>
<p>台帳は、たとえば次のような一覧表をイメージしてください。1行が「取扱い単位」1件で、先頭に<strong>台帳ID</strong>が振られます。</p>
<div class="tw"><table>
<thead><tr><th>台帳ID</th><th>取扱名称</th><th>対象者</th><th>利用目的</th><th>取得項目</th><th>保存先</th><th>保存期間</th><th>管理部門</th><th>状態</th></tr></thead>
<tbody>
<tr><td class="tc">PI-001</td><td>イベント申込フォーム</td><td>イベント参加者</td><td>参加受付・連絡</td><td>氏名／メール／年齢区分</td><td>申込管理システム</td><td>終了後6か月</td><td>イベント事業部</td><td><span class="tag t-B">利用中</span></td></tr>
<tr><td class="tc">PI-002</td><td>キャンペーン応募者リスト</td><td>応募者</td><td>抽選・賞品発送</td><td>氏名／住所／メール</td><td>共有ドライブ</td><td>発送後3か月</td><td>営業企画部</td><td><span class="tag t-B">利用中</span></td></tr>
<tr><td class="tc">PI-003</td><td>従業員緊急連絡先</td><td>従業員</td><td>緊急時の連絡</td><td>氏名／電話／続柄</td><td>人事システム</td><td>在籍中＋5年</td><td>総務人事部</td><td><span class="tag t-B">利用中</span></td></tr>
</tbody></table></div>
<h4 class="sh4">「PI-001」を開くと確認できる詳細情報</h4>
<div class="tw"><table>
<tbody>
<tr><td class="tc" style="width:130px">取得方法</td><td>Web申込フォーム</td><td class="tc" style="width:130px">本人への表示</td><td>プライバシー通知をフォームに表示</td></tr>
<tr><td class="tc">アクセス権限</td><td>イベント担当者・台帳事務局</td><td class="tc">削除方法</td><td>システムから削除し完了記録</td></tr>
<tr><td class="tc">外部委託</td><td>申込システム運営会社</td><td class="tc">責任者</td><td>イベント事業部長</td></tr>
<tr><td class="tc">第三者提供</td><td>なし</td><td class="tc">最終確認日</td><td>2026年7月1日</td></tr>
</tbody></table></div>
<div class="cl cl-n"><strong>ポイント：</strong> フォームや名簿を使うときは、そのフォーム等に対応する<strong>「台帳ID」を確認</strong>します。台帳IDは、<strong>承認済みの取扱条件</strong>と<strong>現場の作業</strong>をつなぐ“背番号”。工程②で台帳へ記録するときも、このIDを起点にします。</div>

<h3 class="sub" id="daicho-life">台帳のライフサイクル（登録して終わりではない）</h3>
<p>台帳は登録したら終わりではなく、<strong>取扱いの変化に合わせて更新</strong>します。<strong>登録 → 利用 → 変更 → 終了</strong>の流れで管理します。</p>
<div class="flow-wrap"><svg viewBox="0 0 740 88" style="width:100%;display:block"><defs><marker id="fllc" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#1d3557"></polygon></marker></defs>
<rect x="0" y="4" width="165" height="80" rx="6" fill="#e8f1fb" stroke="#378add" stroke-width="1.5"></rect><text x="82.5" y="28" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="13" font-weight="700" fill="#378add">登録</text><text x="82.5" y="52" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#495057">利用目的・項目・保存先</text><text x="82.5" y="67" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#495057">保存期間を確定</text>
<line x1="167" y1="44" x2="189" y2="44" stroke="#1d3557" stroke-width="1.8" marker-end="url(#fllc)"></line>
<rect x="191" y="4" width="165" height="80" rx="6" fill="#e4f7f1" stroke="#1d9e75" stroke-width="1.5"></rect><text x="273.5" y="28" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="13" font-weight="700" fill="#1d9e75">利用</text><text x="273.5" y="52" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#495057">承認条件の範囲内で利用</text><text x="273.5" y="67" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#495057">権限・保管を維持</text>
<line x1="358" y1="44" x2="380" y2="44" stroke="#1d3557" stroke-width="1.8" marker-end="url(#fllc)"></line>
<rect x="382" y="4" width="165" height="80" rx="6" fill="#fef3e2" stroke="#c47d1a" stroke-width="1.5"></rect><text x="464.5" y="28" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="13" font-weight="700" fill="#c47d1a">変更</text><text x="464.5" y="52" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#495057">項目・目的・保存先等を</text><text x="464.5" y="67" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#495057">変える前に変更申請</text>
<line x1="549" y1="44" x2="571" y2="44" stroke="#1d3557" stroke-width="1.8" marker-end="url(#fllc)"></line>
<rect x="573" y="4" width="165" height="80" rx="6" fill="#e9ecef" stroke="#6c757d" stroke-width="1.5"></rect><text x="655.5" y="28" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="13" font-weight="700" fill="#6c757d">終了</text><text x="655.5" y="52" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#495057">収集停止・削除確認</text><text x="655.5" y="67" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#495057">台帳をクローズ</text>
</svg></div>
<div class="cl cl-t"><strong>定期棚卸し：</strong> 継続利用の必要性・保存期間・アクセス権限・委託先を定期的に見直します（総務人事部＝台帳事務局が実施）。</div>
<h4 class="sh4">変更申請が必要となる主なタイミング</h4>
<div class="tw"><table>
<thead><tr><th style="width:150px">変わるもの</th><th>例</th></tr></thead>
<tbody>
<tr><td class="tc">取得項目</td><td>住所・生年月日などを追加する</td></tr>
<tr><td class="tc">利用目的</td><td>案内送付・分析などの目的を追加する</td></tr>
<tr><td class="tc">取得方法</td><td>紙の様式からWebフォームへ変更する</td></tr>
<tr><td class="tc">保存先</td><td>新システム・クラウドへ移行する</td></tr>
<tr><td class="tc">共有・委託</td><td>外部事業者へデータを渡す</td></tr>
<tr><td class="tc">保存期間</td><td>保管期間を延長・短縮する</td></tr>
</tbody></table></div>
<div class="cl cl-i"><strong>この台帳像を頭に置いて、次からの5工程を読んでください。</strong> 工程①の「フォーマット」は<strong>台帳に登録する取扱い単位</strong>のこと、「台帳登録申請」は<strong>この一覧表に新しい行を足す（または変更する）手続き</strong>のことです。</div>

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

<h4 class="sh4" id="p1-unit">何を「1件」として登録するか ── テンプレート＝登録単位</h4>
<p>フォーマットは、言いかえると<strong>テンプレート（個人情報を取得・記録するために繰り返し使う“器”）</strong>です。台帳には、この<strong>テンプレート単位で1件を登録</strong>します。次のようなものが1件の登録単位になります。</p>
<div class="pillars" style="grid-template-columns:repeat(5,1fr)">
  <div class="pillar"><div class="pn">Webフォーム</div><div class="pt" style="font-size:12px">イベント申込</div></div>
  <div class="pillar"><div class="pn">紙の書類</div><div class="pt" style="font-size:12px">出演同意書</div></div>
  <div class="pillar"><div class="pn">Excel・Sheet</div><div class="pt" style="font-size:12px">参加者名簿</div></div>
  <div class="pillar"><div class="pn">システム</div><div class="pt" style="font-size:12px">会員登録画面</div></div>
  <div class="pillar"><div class="pn">メール書式</div><div class="pt" style="font-size:12px">問い合わせ受付</div></div>
</div>
<div class="case-grid">
  <div class="case-card A">
    <h4>同じ台帳IDをそのまま使える</h4>
    <ul>
      <li><strong>利用目的・取得項目・取得方法・保存先・共有先・保存期間</strong>が、登録内容と<strong>すべて同じ</strong></li>
      <li>→ 申請は不要。登録済みの台帳IDを記録して使う</li>
    </ul>
  </div>
  <div class="case-card B" style="border-color:var(--gold);background:var(--gold-s)">
    <h4 style="color:var(--gold);border-color:var(--gold)">新規・変更申請が必要</h4>
    <ul>
      <li><strong>新しいテンプレートを作る</strong>（未登録）→ 新規登録申請</li>
      <li><strong>登録条件のどれかを変える</strong>（項目・目的・保存先など）→ 変更申請</li>
    </ul>
  </div>
</div>
<div class="cl cl-n"><strong>例：</strong> 登録済み「イベント申込フォーム」（<strong>氏名・メールのみ</strong>取得）に<strong>住所欄を追加</strong>する場合 → <strong>「取得項目」が登録内容と異なる</strong>ため、使い始める前に<strong>変更申請</strong>を行います。</div>

<h4 class="sh4" id="p1-judgeflow">取得するときの基本フロー（登録済みか → 条件は同じか）</h4>
<p>個人情報を取得する場面では、いつも<strong>①登録済みか → ②条件が登録内容と同じか</strong>を順番に確認します。どちらも満たせばそのまま取得へ、満たさなければ承認を得てから取得します。</p>
<div class="flow-wrap"><svg viewBox="0 0 700 470" style="width:100%;display:block">
<defs>
<marker id="pf-n" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#1d3557"></polygon></marker>
<marker id="pf-o" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#c47d1a"></polygon></marker>
<marker id="pf-g" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#1d9e75"></polygon></marker>
</defs>
<!-- process chain -->
<rect x="125" y="8" width="250" height="44" rx="6" fill="#e8f1fb" stroke="#378add" stroke-width="1.5"></rect><text x="250" y="35" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11.5" font-weight="700" fill="#1d3557">個人情報を取得する業務が発生</text>
<line x1="250" y1="52" x2="250" y2="74" stroke="#1d3557" stroke-width="1.8" marker-end="url(#pf-n)"></line>
<rect x="125" y="74" width="250" height="44" rx="6" fill="#e8f1fb" stroke="#378add" stroke-width="1.5"></rect><text x="250" y="101" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11.5" font-weight="700" fill="#1d3557">使うフォーム・名簿・システムを決める</text>
<line x1="250" y1="118" x2="250" y2="140" stroke="#1d3557" stroke-width="1.8" marker-end="url(#pf-n)"></line>
<rect x="125" y="140" width="250" height="44" rx="6" fill="#e8f1fb" stroke="#378add" stroke-width="1.5"></rect><text x="250" y="167" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11.5" font-weight="700" fill="#1d3557">台帳を検索する（名称・台帳ID）</text>
<line x1="250" y1="184" x2="250" y2="198" stroke="#1d3557" stroke-width="1.8" marker-end="url(#pf-n)"></line>
<!-- decision 1 -->
<polygon points="250,198 360,232 250,266 140,232" fill="#fef3e2" stroke="#c47d1a" stroke-width="1.5"></polygon><text x="250" y="236" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11" font-weight="700" fill="#633806">台帳に登録済みか？</text>
<!-- D1 -> D2 (登録済み) -->
<line x1="250" y1="266" x2="250" y2="296" stroke="#1d9e75" stroke-width="1.8" marker-end="url(#pf-g)"></line>
<text x="258" y="285" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#1d9e75">登録済み</text>
<!-- D1 -> APP (未登録) -->
<line x1="360" y1="232" x2="468" y2="232" stroke="#c47d1a" stroke-width="1.8" marker-end="url(#pf-o)"></line>
<text x="378" y="224" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#c47d1a">未登録</text>
<!-- decision 2 -->
<polygon points="250,296 380,330 250,364 120,330" fill="#fef3e2" stroke="#c47d1a" stroke-width="1.5"></polygon><text x="250" y="327" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#633806">今回の条件が</text><text x="250" y="343" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#633806">登録内容と同じか？</text>
<!-- D2 -> APP (異なる) -->
<polyline points="380,330 440,330 440,250 468,250" fill="none" stroke="#c47d1a" stroke-width="1.8" marker-end="url(#pf-o)"></polyline>
<text x="388" y="322" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#c47d1a">異なる</text>
<!-- D2 -> FINAL (同じ) -->
<line x1="250" y1="364" x2="250" y2="388" stroke="#1d9e75" stroke-width="1.8"></line>
<text x="258" y="382" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9.5" font-weight="700" fill="#1d9e75">同じ</text>
<!-- application box -->
<rect x="470" y="205" width="200" height="58" rx="6" fill="#fef3e2" stroke="#c47d1a" stroke-width="1.5"></rect><text x="570" y="228" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11.5" font-weight="700" fill="#b3670f">新規／変更 申請</text><text x="570" y="247" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#8a5a12">未登録→新規・条件変更→変更</text>
<line x1="570" y1="263" x2="570" y2="300" stroke="#1d3557" stroke-width="1.8" marker-end="url(#pf-n)"></line>
<!-- approval box -->
<rect x="470" y="300" width="200" height="58" rx="6" fill="#e4f7f1" stroke="#1d9e75" stroke-width="1.5"></rect><text x="570" y="323" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11.5" font-weight="700" fill="#157a5b">審査・承認</text><text x="570" y="342" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="8.5" fill="#157a5b">台帳IDを発行／台帳を更新</text>
<!-- approval -> merge -->
<polyline points="570,358 570,388 250,388" fill="none" stroke="#1d9e75" stroke-width="1.8"></polyline>
<!-- merge drop to final -->
<line x1="250" y1="388" x2="250" y2="418" stroke="#1d3557" stroke-width="1.8" marker-end="url(#pf-n)"></line>
<!-- final box -->
<rect x="40" y="418" width="420" height="46" rx="6" fill="#e4f7f1" stroke="#1d9e75" stroke-width="2"></rect><text x="250" y="440" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="11.5" font-weight="700" fill="#157a5b">承認済みの条件で取得・利用を開始</text><text x="250" y="456" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="9" fill="#157a5b">（フォーム等に台帳IDを表示・記録）</text>
</svg></div>
<div class="cl cl-w"><strong>この順番を飛ばさない：</strong> ①承認前に取得を開始しない ②未登録のフォームを先に公開しない ③個人情報を仮のExcel等へ先に保存しない。<strong>承認（台帳ID）が出てから</strong>取得を始めます。</div>

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

<h4 class="sh4">登録手続きの流れと各部門の役割</h4>
<p>台帳への登録（新規・変更）は、<strong>事業部門の申請</strong>を起点に、管理部門が<strong>役割を分けて確認</strong>してから登録します。事業部が行うのは主に<strong>申請</strong>の部分です。</p>
<div class="flow-wrap"><svg viewBox="0 0 740 56" style="width:100%;display:block"><defs><marker id="flreg" markerWidth="7" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#9CA3AF"></polygon></marker></defs>
<rect x="0" y="4" width="164" height="48" rx="5" fill="#085041"></rect><text x="82" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">1. 事業部門が申請</text>
<line x1="166" y1="28" x2="178" y2="28" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flreg)"></line>
<rect x="180" y="4" width="164" height="48" rx="5" fill="#085041"></rect><text x="262" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">2. 管理部門が確認</text>
<line x1="346" y1="28" x2="358" y2="28" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flreg)"></line>
<rect x="360" y="4" width="164" height="48" rx="5" fill="#085041"></rect><text x="442" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">3. 台帳へ登録</text>
<line x1="526" y1="28" x2="538" y2="28" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#flreg)"></line>
<rect x="540" y="4" width="200" height="48" rx="5" fill="#27500a"></rect><text x="640" y="33" text-anchor="middle" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="10.5" font-weight="700" fill="#fff">4. 取得・利用開始</text>
</svg></div>
<div class="tw"><table>
<thead><tr><th style="width:190px">部門</th><th>主な確認・作業</th></tr></thead>
<tbody>
<tr><td class="tc">事業部門（申請者）<br><span class="badge b-biz" style="margin-top:3px">事業部</span></td><td>目的・対象者・取得項目を入力／使用するフォーム等を添付／保存先・利用期間を決める／承認済み条件を守って運用</td></tr>
<tr><td class="tc">総務人事部（台帳事務局）<br><span class="badge b-leg" style="margin-top:3px">管理部</span></td><td>申請受付・記載内容の確認／台帳IDを採番して登録／担当部門・状態を管理／定期棚卸しを実施</td></tr>
<tr><td class="tc">法務部<br><span class="badge b-leg" style="margin-top:3px">管理部</span></td><td>利用目的・表示文言を確認／同意・第三者提供を確認／委託契約・共同利用を確認／法令・規程上の論点を整理</td></tr>
<tr><td class="tc">システム管理部<br><span class="badge b-leg" style="margin-top:3px">管理部</span></td><td>保存先とアクセス権限を確認／クラウド・外部サービスを審査／安全管理措置を確認／削除・バックアップ方法を確認</td></tr>
</tbody></table></div>
<div class="cl cl-i"><strong>申請時の最低限の情報：</strong> 利用目的／対象者／取得項目／取得方法／保存先・権限／外部提供・委託／保存期間・削除方法／責任部門。これらが揃っていると審査がスムーズです。</div>

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

<h2 class="sec" id="cases">ケース別の判断例</h2>
<p>迷ったときは<strong>「登録の有無」と「条件の一致」</strong>で判断します。下の表で自分のケースに近いものを確認してください。</p>
<div class="tw"><table>
<thead><tr><th>ケース</th><th>台帳の確認結果</th><th>必要な対応</th><th>利用開始の時点</th></tr></thead>
<tbody>
<tr><td>登録済みのイベント申込フォームを<strong>同じ条件</strong>で使用</td><td>登録済み・条件も同じ</td><td>登録済み台帳IDを記録して使用</td><td class="tc" style="color:var(--green)">そのまま使用可</td></tr>
<tr><td>新しいキャンペーン用アンケートを作成</td><td>台帳に未登録</td><td>新規登録申請</td><td class="tc" style="color:var(--red)">承認・台帳ID発行後</td></tr>
<tr><td>既存フォームに<strong>住所欄を追加</strong></td><td>取得項目が異なる</td><td>変更申請</td><td class="tc" style="color:var(--red)">変更承認後</td></tr>
<tr><td>保存先を共有ドライブから<strong>外部クラウド</strong>へ変更</td><td>保存先・安全管理が異なる</td><td>変更申請＋システム確認</td><td class="tc" style="color:var(--red)">変更承認後</td></tr>
<tr><td>発送業者へ<strong>応募者名簿を渡す</strong></td><td>外部委託・共有条件が異なる</td><td>変更申請＋法務確認</td><td class="tc" style="color:var(--red)">契約・承認完了後</td></tr>
<tr><td>業務終了後に個人情報を削除</td><td>取扱い終了</td><td>削除確認・完了記録・台帳クローズ</td><td class="tc" style="color:var(--gold)">削除確認後に完了</td></tr>
</tbody></table></div>
<h4 class="sh4">取得前の最終チェック</h4>
<ul class="ck">
<li>使用するフォーム等の<strong>台帳ID</strong>を確認した</li>
<li><strong>利用目的・取得項目</strong>が登録内容と同じ</li>
<li><strong>保存先・共有先・保存期間</strong>が同じ</li>
<li>未登録・変更ありは<strong>承認後に開始</strong>する</li>
</ul>
<div class="cl cl-n">判断に迷う場合は、個人情報の<strong>取得を開始する前に</strong>、総務人事部（台帳事務局）または法務へ確認してください。</div>

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

</body></html>$g_privacy$;
BEGIN
  SELECT id INTO gid FROM portal_guides WHERE guide_key = 'privacy';
  IF gid IS NULL THEN
    RAISE NOTICE 'skip privacy: portal_guides にメタ行なし(0094 を先に適用)';
    RETURN;
  END IF;

  SELECT pv.html_source INTO cur
    FROM portal_guides g
    LEFT JOIN portal_guide_versions pv ON pv.id = g.current_version_id
   WHERE g.id = gid;

  IF cur IS NOT DISTINCT FROM newhtml THEN
    RETURN; -- 既に現行版が同一。再適用しない(冪等)。
  END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO nextver
    FROM portal_guide_versions WHERE guide_id = gid;

  INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
    VALUES (gid, nextver, newhtml, '個人情報管理台帳ガイドの要素を追記(現場向けフロー再構築)', 'migration-0100')
    RETURNING id INTO vid;

  UPDATE portal_guides
     SET current_version_id = vid, status = 'published', updated_at = now()
   WHERE id = gid;

  RAISE NOTICE 'privacy updated to v% (published)', nextver;
END
$upd_privacy$;
