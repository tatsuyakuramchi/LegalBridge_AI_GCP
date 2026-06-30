-- 0099_seed_portal_guide_html.sql  (GENERATED — do not edit by hand)
-- 生成: migrations/gen-portal-guide-seed.mjs <- services/api/guides/*.html
-- 未seed の各ガイドの現行版(version 1)を投入し status='published' にする。
-- 既に版があるガイドはスキップ(冪等)。本文の更新は新版追加(sync-guides-to-db.mjs)で。

-- ── template_preview ──────────────────────────────────────────────
DO $seed_template_preview$
DECLARE gid INTEGER; vid INTEGER;
BEGIN
  SELECT id INTO gid FROM portal_guides WHERE guide_key = 'template_preview';
  IF gid IS NULL THEN
    RAISE NOTICE 'skip template_preview: portal_guides にメタ行なし(0094 を先に適用)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM portal_guide_versions WHERE guide_id = gid) THEN
    RETURN; -- 既に版あり。再適用しない(冪等)。
  END IF;
  INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
    VALUES (gid, 1, $g_template_preview$<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ひな型プレビュー｜法務ポータル</title>
<style>
:root{--navy:#1d3557;--navy-l:#2a4a6e;--red:#e63946;--red-s:#fde8ea;--gold:#c47d1a;--gold-s:#fef3e2;--green:#1d9e75;--green-s:#e4f7f1;--blue:#378add;--blue-s:#e8f1fb;--g1:#f8f9fa;--g2:#e9ecef;--g3:#dee2e6;--g5:#6c757d;--tx:#212529;--tx2:#495057;--sw:220px;--c4:#085041}
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
#main{margin-left:var(--sw);padding:40px 48px 80px;max-width:calc(var(--sw) + 820px)}
h1.dt{font-size:22px;font-weight:700;color:var(--navy);border-bottom:3px solid var(--navy);padding-bottom:10px;margin-bottom:6px}
.dm{font-size:12px;color:var(--g5);margin-bottom:28px}
h2.sec{font-size:17px;font-weight:700;color:var(--navy);border-left:4px solid var(--navy);padding-left:10px;margin:34px 0 14px;scroll-margin-top:20px}
p{margin-bottom:10px;color:var(--tx2)}strong{color:var(--tx)}
ul,ol{padding-left:20px;margin-bottom:10px;color:var(--tx2)}li{margin-bottom:4px}
.cl{border-left:3px solid;padding:9px 13px;border-radius:0 5px 5px 0;margin:10px 0;font-size:13px}
.cl-w{border-color:var(--red);background:var(--red-s)}.cl-i{border-color:var(--blue);background:var(--blue-s)}.cl-t{border-color:var(--green);background:var(--green-s)}.cl-n{border-color:var(--gold);background:var(--gold-s)}
.tw{overflow-x:auto;margin:10px 0}
table{width:100%;border-collapse:collapse;font-size:12.5px}
thead th{background:var(--navy);color:#fff;padding:7px 10px;text-align:left;font-weight:600;font-size:12px;white-space:nowrap}
tbody tr:nth-child(even){background:var(--g1)}
tbody td{padding:7px 10px;border-bottom:1px solid var(--g3);vertical-align:top;line-height:1.55}
td.tc{font-weight:600;white-space:nowrap;color:var(--navy);font-size:12px}
.cta{display:inline-flex;align-items:center;gap:8px;background:var(--navy);color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 20px;border-radius:8px;margin:6px 0;transition:all .15s}
.cta:hover{background:var(--navy-l);transform:translateY(-1px);box-shadow:0 3px 10px rgba(29,53,87,.25)}
.tpl-cat{font-size:12px;font-weight:700;color:#fff;background:var(--c4);border-radius:6px;padding:7px 13px;margin:22px 0 10px}
.tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.tpl-card{border:1px solid var(--g3);border-left:4px solid var(--c4);border-radius:9px;padding:13px 15px;background:#fff}
.tpl-name{font-size:13.5px;font-weight:700;color:var(--navy);margin-bottom:3px;line-height:1.4}
.tpl-type{font-size:10.5px;color:var(--g5);font-family:'SFMono-Regular',Consolas,monospace;margin-bottom:9px}
.tpl-btns{display:flex;gap:7px;flex-wrap:wrap}
.tpl-btns a{font-size:11px;font-weight:700;text-decoration:none;padding:5px 11px;border-radius:6px;border:1px solid var(--g3);color:var(--navy);background:var(--g1);transition:.12s}
.tpl-btns a:hover{border-color:var(--navy);background:#fff}
.tpl-btns a.pdf{color:#8d2630;border-color:#f0c6cd;background:#fdf1f3}
#tplListMsg{font-size:12.5px;color:var(--g5);padding:10px 0}
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
<aside id="sidebar">
<div id="sh"><h1>法務部</h1><p>ひな型プレビュー<br>（テンプレート一覧）</p></div>
<nav>
<a class="nl" href="#overview">概要</a>
<a class="nl" href="#howto">使い方</a>
<a class="nl" href="#library">ひな型ライブラリ</a>
<span class="ns">関連</span>
<a class="nl" href="/search/vendor">取引先・契約検索</a>
</nav>
</aside>

<main id="main">
<h1 class="dt">ひな型プレビュー</h1>
<p class="dm">法務部　｜　各ひな型（テンプレート）をサンプル情報で HTML 表示／PDF 化して確認できます。</p>

<div class="cl cl-i">このページは<strong>現行ひな型の一覧と確認</strong>用です。各ひな型の <strong>HTMLプレビュー</strong>・<strong>PDF</strong> をその場で開けます。実際の文書作成は Slack <code>/法務依頼</code> から（ひな型を直接編集して使うことは禁止）。</div>

<h2 class="sec" id="overview">概要</h2>
<p>発注書・各種契約書・通知書などの<strong>ひな型（テンプレート）</strong>を、サンプルのダミー情報で流し込んだ状態でプレビューできます。条項の体裁・差込項目の確認、Slack 貼付け用リンクの取得に利用してください。</p>
<a class="cta" href="/templates/preview">🖥 プレビューツールを開く（iframe・PDF DL）→</a>

<h2 class="sec" id="howto">使い方</h2>
<div class="tw"><table>
<thead><tr><th>やりたいこと</th><th>操作</th></tr></thead>
<tbody>
<tr><td class="tc">体裁・差込項目を確認</td><td>下の「ひな型ライブラリ」で対象の <strong>HTMLプレビュー</strong> を開く</td></tr>
<tr><td class="tc">PDF で確認・共有</td><td>各ひな型の <strong>PDF</strong> ボタンから生成・ダウンロード</td></tr>
<tr><td class="tc">対話的に切り替えて見る</td><td>上部の <strong>プレビューツール</strong>（<code>/templates/preview</code>）で一覧から選択</td></tr>
<tr><td class="tc">文書を作成・発行する</td><td>Slack <code>/法務依頼</code> から作成依頼（ひな型の直接編集は不可）</td></tr>
</tbody></table></div>

<h2 class="sec" id="library">ひな型ライブラリ</h2>
<p>登録されている現行ひな型の一覧です（カテゴリ別）。各カードから <strong>HTMLプレビュー</strong>・<strong>PDF</strong> を開けます。</p>
<div id="tplListMsg">読み込み中…</div>
<div id="tplList"></div>

<hr class="sd">
<div style="background:var(--navy);border-radius:8px;padding:18px 22px;margin-top:8px;text-align:center">
<div style="font-size:10px;color:rgba(255,255,255,.45);margin-bottom:5px">お問い合わせ先</div>
<div style="font-size:17px;font-weight:700;color:#fff;margin-bottom:3px">株式会社アークライト 経営管理本部 法務部</div>
<div style="font-size:12px;color:rgba(255,255,255,.65)">ひな型・文書作成に関するご相談は #法務相談 まで</div>
</div>
</main>

<script>
(function(){
  function escapeHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  var listEl=document.getElementById('tplList');
  var msgEl=document.getElementById('tplListMsg');
  fetch('/api/template-preview/list').then(function(r){return r.json();}).then(function(data){
    var templates=(data&&data.templates)||[];
    if(!templates.length){ msgEl.textContent='ひな型が見つかりませんでした。'; return; }
    msgEl.style.display='none';
    var byCat={};
    templates.forEach(function(t){ var c=t.category||'その他'; (byCat[c]=byCat[c]||[]).push(t); });
    var html='';
    Object.keys(byCat).sort().forEach(function(cat){
      html+='<div class="tpl-cat">'+escapeHtml(cat)+'</div><div class="tpl-grid">';
      byCat[cat].forEach(function(t){
        var type=encodeURIComponent(t.type);
        html+='<div class="tpl-card">'
            +'<div class="tpl-name">'+escapeHtml(t.label||t.type)+'</div>'
            +'<div class="tpl-type">'+escapeHtml(t.type)+'</div>'
            +'<div class="tpl-btns">'
            +'<a href="/api/template-preview/'+type+'/html" target="_blank" rel="noopener">HTMLプレビュー ↗</a>'
            +'<a class="pdf" href="/api/template-preview/'+type+'/pdf" target="_blank" rel="noopener">PDF ↗</a>'
            +'</div></div>';
      });
      html+='</div>';
    });
    listEl.innerHTML=html;
  }).catch(function(e){ msgEl.textContent='一覧の取得に失敗しました: '+e.message; });

  // サイドバー現在地ハイライト
  var links=[].slice.call(document.querySelectorAll('#sidebar a[href^="#"]'));
  var secs=links.map(function(a){return document.querySelector(a.getAttribute('href'));}).filter(Boolean);
  if(window.IntersectionObserver){
    var obs=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){links.forEach(function(a){a.classList.toggle('active',a.getAttribute('href')==='#'+en.target.id);});}});},{rootMargin:'-20% 0px -70% 0px'});
    secs.forEach(function(s){obs.observe(s);});
  }
})();
</script>
</body>
</html>
$g_template_preview$, 'seed 0099 (from services/api/guides)', 'seed')
    RETURNING id INTO vid;
  UPDATE portal_guides
     SET current_version_id = vid, status = 'published', updated_at = now()
   WHERE id = gid;
END
$seed_template_preview$;

