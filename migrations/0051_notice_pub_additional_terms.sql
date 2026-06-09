-- 0051_notice_pub_additional_terms.sql
-- 出版追加利用許諾条件書(pub_additional_terms)に通知先を追加(pub_license_terms と同様):
--   頭書きに通知先 sec-row(許諾者=相手方 / 被許諾者=当社=STAFF_*) + 短い通知条文 +
--   相手方連絡先の入力欄(許諾者担当者/電話/メール)。
-- document_templates(db モード)を現行 disk テンプレ + 更新後 field_schema の新版へ更新。

WITH t AS (SELECT id FROM document_templates WHERE template_key='pub_additional_terms'), nv AS (
  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  SELECT t.id, COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id=t.id),0)+1,
         $html_pub_additional_terms$<!DOCTYPE html>
<html lang="ja">
<head>
  <base target="_top">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>追加利用許諾条件書（商品化・映像化・デジタルゲーム化） - {{追加条件書番号}}</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 20mm 22mm 25mm;
      @bottom-center {
        content: "- " counter(page) " -";
        font-size: 8.5pt;
        font-family: "Noto Serif CJK JP", "IPAMincho", serif;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Noto Serif CJK JP", "IPAMincho", "MS Mincho", serif;
      font-size: 10pt;
      line-height: 1.75;
      color: #000;
      background-color: #fff;
    }
    .contract-document {
      max-width: 210mm;
      margin: 0 auto;
      background-color: #fff;
      padding: 18mm 20mm 22mm 25mm;
    }
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 0.5em;
      font-size: 8.5pt;
      color: #555;
      letter-spacing: 0.05em;
    }
    .doc-header .header-no { font-size: 10pt; font-weight: bold; color: #1a1a1a; letter-spacing: 0.1em; }
    .doc-header .header-right { display: flex; gap: 0.45em; align-items: baseline; }
    .doc-header .header-separator { color: #aaa; }
    .revision-notice {
      margin: 0.25em 0 0.9em;
      padding: 0.35em 0.75em;
      border: 0.8pt solid #b8a05a;
      color: #6f5600;
      background: #fffdf2;
      font-size: 8.8pt;
      font-weight: bold;
      text-align: center;
      letter-spacing: 0.03em;
    }
    h1.contract-title {
      text-align: center;
      font-size: 14pt;
      font-weight: bold;
      letter-spacing: 0.18em;
      margin-bottom: 0.9em;
      text-decoration: underline;
      text-underline-offset: 0.22em;
    }
    .preamble {
      font-size: 9.5pt;
      text-indent: 1em;
      margin-bottom: 0.9em;
      line-height: 1.7;
      text-align: justify;
    }
    .tobogaki {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.15em;
      font-size: 9pt;
      line-height: 1.6;
      border-top: 1.5pt solid #1a1a1a;
      border-bottom: 1.5pt solid #1a1a1a;
    }
    .tobogaki th, .tobogaki td {
      border: none;
      border-bottom: 0.5pt solid #d8d8d8;
      padding: 0.45em 0.7em;
      vertical-align: top;
    }
    .tobogaki .sec-row td {
      padding-top: 0.9em;
      padding-bottom: 0.25em;
      border-bottom: 0.5pt solid #888;
      font-size: 7.5pt;
      font-weight: bold;
      letter-spacing: 0.25em;
      color: #555;
    }
    .tobogaki .sec-row .sec-ref {
      font-weight: normal;
      letter-spacing: 0;
      color: #999;
      font-size: 7pt;
      margin-left: 0.5em;
    }
    .tobogaki .col-item {
      width: 32%;
      font-weight: bold;
      color: #1a1a1a;
      padding-left: 0.5em;
    }
    .tobogaki .col-item .sub-note {
      display: block;
      font-size: 7.5pt;
      font-weight: normal;
      color: #888;
      margin-top: 0.1em;
    }
    .tobogaki .col-value       { width: 68%; word-break: break-word; overflow-wrap: break-word; color: #1a1a1a; }
    .tobogaki .special-cell    { min-height: 2.5em; word-break: break-word; overflow-wrap: break-word; color: #1a1a1a; white-space: pre-wrap; }
    .formula-cell { font-size: 8.6pt; line-height: 1.62; color: #1a1a1a; }
    .formula-line { margin: 0.1em 0; padding-left: 1em; text-indent: -1em; }
    .scope-note { margin-top: 0.35em; color: #555; font-size: 7.8pt; line-height: 1.45; }
    .caution-note { margin-top: 0.35em; color: #7a4b00; font-size: 7.8pt; line-height: 1.45; }
    .type-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.4pt;
      line-height: 1.5;
      margin-top: 0.2em;
    }
    .type-table th,
    .type-table td {
      border: 0.5pt solid #d4d4d4;
      padding: 0.35em 0.45em;
      vertical-align: top;
    }
    .type-table th { background: #f7f7f7; font-weight: bold; text-align: left; }
    .type-table .narrow { width: 20%; }
    .type-table .wide { width: 80%; }
    .check-row { line-height: 1.65; }
    .check-row span { display: inline-block; margin-right: 1.3em; white-space: nowrap; }
    .head-signature { margin: 0.5em 0 1em; page-break-inside: avoid; font-size: 9.2pt; line-height: 1.55; }
    .head-signature .sig-date { text-align: right; margin-bottom: 0.8em; }
    .head-signature .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2em; }
    .head-signature .sig-party { border-top: 1pt solid #1a1a1a; padding-top: 0.5em; }
    .head-signature .party-label { font-weight: bold; margin-bottom: 0.3em; }
    .head-signature .sig-name-row { display: flex; align-items: center; justify-content: space-between; gap: 0.8em; margin-top: 0.3em; }
    .head-signature .stamp-box { width: 52px; height: 52px; border: 1pt solid #1a1a1a; display: flex; justify-content: center; align-items: center; font-size: 11pt; background-color: #fff; flex-shrink: 0; }
    .closing-note { font-size: 9.5pt; text-indent: 1em; margin: 1em 0 0.5em; line-height: 1.7; text-align: justify; }
    .closing-text { font-size: 9.5pt; text-indent: 1em; margin: 0.5em 0; line-height: 1.7; text-align: justify; }
    @media print {
      body { background-color: #fff; }
      .contract-document { box-shadow: none; margin: 0; width: 100%; max-width: none; padding: 0; }
      .head-signature, .tobogaki { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
<div class="contract-document">

  <div class="doc-header">
    <span class="header-no">第　{{追加条件書番号}}　号</span>
    <div class="header-right">
      <span>基本契約番号：{{基本契約番号}}</span>
      <span class="header-separator">｜</span>
      <span>締結日：{{締結日}}</span>
    </div>
  </div>

  {{#if 再発行フラグ}}
  <div class="revision-notice">再発行版 (Rev. {{改訂番号}}) — 元条件書: {{元契約番号}}</div>
  {{/if}}

  <h1 class="contract-title">追加利用許諾条件書</h1>

  <p class="preamble">株式会社アークライト（以下「被許諾者」という）と{{許諾者}}（以下「許諾者」という）は、{{基本契約締結日}}付出版等許諾基本契約書（以下「基本契約」という）および{{通常条件書締結日}}付出版等利用許諾条件書（以下「通常条件書」という）に関連して、通常条件書では許諾対象外とされた商品化、映像化、デジタルゲーム化その他の追加利用について、以下のとおり個別の利用許諾条件を定める。</p>

  <table class="tobogaki">
    <tbody>

      <!-- ===== 基本情報 ===== -->
      <tr class="sec-row"><td colspan="2">基　本　情　報</td></tr>
      <tr>
        <td class="col-item">追加条件書番号</td>
        <td class="col-value">{{追加条件書番号}}</td>
      </tr>
      <tr>
        <td class="col-item">基本契約番号</td>
        <td class="col-value">{{基本契約番号}}</td>
      </tr>
      <tr>
        <td class="col-item">関連する通常条件書</td>
        <td class="col-value">条件書番号：{{通常条件書番号}}<br>対象出版物名：『{{対象出版物名}}』</td>
      </tr>
      <tr>
        <td class="col-item">締結日・効力発生日</td>
        <td class="col-value">締結日：{{締結日}}<br>効力発生日：{{効力発生日}}</td>
      </tr>
      <tr>
        <td class="col-item">
          追加許諾期間
          <span class="sub-note">通常条件書と異なる場合は本欄を優先</span>
        </td>
        <td class="col-value">
          許諾開始日：{{追加許諾開始日}}<br>
          許諾終了日：{{追加許諾終了日}}<br>
          自動更新：{{自動更新有無}}（更新単位：{{更新単位}}／終了通知期限：{{終了通知期限}}）
        </td>
      </tr>

      <!-- ===== 対象著作物 ===== -->
      <tr class="sec-row"><td colspan="2">対　象　著　作　物</td></tr>
      <tr>
        <td class="col-item">原著作物名</td>
        <td class="col-value">『{{原著作物名}}』</td>
      </tr>
      <tr>
        <td class="col-item">対象キャラクター・設定等</td>
        <td class="col-value">{{対象キャラクター設定等}}</td>
      </tr>
      <tr>
        <td class="col-item">著作者名・著作権者</td>
        <td class="col-value" style="white-space: pre-wrap;">著作者名：{{著作者名}}<br>著作権者：{{著作権者}}</td>
      </tr>
      <tr>
        <td class="col-item">第三者権利の有無</td>
        <td class="col-value">{{第三者権利有無}}<br>備考：{{第三者権利備考}}</td>
      </tr>

      <!-- ===== 追加許諾の対象 ===== -->
      <tr class="sec-row">
        <td colspan="2">
          追　加　許　諾　の　対　象
          <span class="sec-ref">（基本契約第４条）</span>
        </td>
      </tr>
      <tr>
        <td class="col-item">
          追加利用類型
          <span class="sub-note">選択した類型のみ有効</span>
        </td>
        <td class="col-value">
          <div class="check-row">
            <span>{{#if 商品化}}☑{{else}}□{{/if}} 商品化</span>
            <span>{{#if 映像化}}☑{{else}}□{{/if}} 映像化</span>
            <span>{{#if デジタルゲーム化}}☑{{else}}□{{/if}} デジタルゲーム化</span>
            <span>{{#if その他追加利用}}☑{{else}}□{{/if}} その他（{{その他利用類型}}）</span>
          </div>
          <div class="scope-note">上記で選択されていない利用類型は、本条件書によって許諾されない。</div>
        </td>
      </tr>
      <tr>
        <td class="col-item">許諾の性質</td>
        <td class="col-value">{{独占非独占区分}}（独占／非独占／優先交渉権のみ／その他：{{許諾性質補足}}）</td>
      </tr>
      <tr>
        <td class="col-item">許諾地域・言語</td>
        <td class="col-value">許諾地域：{{追加利用許諾地域}}<br>許諾言語：{{追加利用許諾言語}}</td>
      </tr>
      <tr>
        <td class="col-item">再許諾・委託先利用</td>
        <td class="col-value">
          再許諾：{{再許諾可否}}<br>
          製造委託先・制作会社・配信事業者・広告代理店その他の委託先による利用：{{委託先利用可否}}<br>
          承認済み再許諾先・委託先：{{承認済再許諾先委託先}}
        </td>
      </tr>
      <tr>
        <td class="col-item">許諾対象外</td>
        <td class="col-value">本条件書に明示された利用類型、媒体、商品、地域、期間および方法を超える利用は、被許諾者に許諾されない。著作権の譲渡、出版権の設定、商標権その他の登録権利の移転または設定は、本条件書に明示された場合を除き行われない。</td>
      </tr>

      <!-- ===== 利用類型別条件 ===== -->
      <tr class="sec-row">
        <td colspan="2">
          利　用　類　型　別　条　件
          <span class="sec-ref">選択した類型のみ記載</span>
        </td>
      </tr>
      {{#if 商品化}}
      <tr>
        <td class="col-item">商品化</td>
        <td class="col-value">
          <table class="type-table">
            <tr><th class="narrow">対象商品</th><td class="wide">{{商品化対象商品}}</td></tr>
            <tr><th>製造・販売条件</th><td>{{商品化製造販売条件}}（例：製造数量、販売チャネル、販売開始予定日、販売終了予定日）</td></tr>
            <tr><th>監修・承認</th><td>{{商品化監修承認条件}}（例：商品仕様、サンプル、パッケージ、広告物の事前確認）</td></tr>
            <tr><th>サンプル・献本</th><td>{{商品化サンプル条件}}</td></tr>
          </table>
        </td>
      </tr>
      {{/if}}
      {{#if 映像化}}
      <tr>
        <td class="col-item">映像化</td>
        <td class="col-value">
          <table class="type-table">
            <tr><th class="narrow">対象媒体</th><td class="wide">{{映像化対象媒体}}（例：PV、CM、配信番組、アニメーション、実写映像、イベント上映）</td></tr>
            <tr><th>制作条件</th><td>{{映像化制作条件}}（例：制作会社、公開予定日、公開媒体、尺、地域）</td></tr>
            <tr><th>改変・脚色</th><td>{{映像化改変脚色条件}}（例：構成、脚本、キャラクター表現、世界観変更の承認要否）</td></tr>
            <tr><th>監修・承認</th><td>{{映像化監修承認条件}}</td></tr>
          </table>
        </td>
      </tr>
      {{/if}}
      {{#if デジタルゲーム化}}
      <tr>
        <td class="col-item">デジタルゲーム化</td>
        <td class="col-value">
          <table class="type-table">
            <tr><th class="narrow">対象プラットフォーム</th><td class="wide">{{ゲーム化対象プラットフォーム}}（例：iOS、Android、Steam、家庭用ゲーム機、ブラウザゲーム）</td></tr>
            <tr><th>対象ゲーム・機能</th><td>{{ゲーム化対象ゲーム機能}}（例：ゲームタイトル、ゲームジャンル、DLC、追加シナリオ、アプリ内課金、広告収益）</td></tr>
            <tr><th>運営条件</th><td>{{ゲーム化運営条件}}（例：配信開始予定日、サービス終了、アップデート、追加コンテンツ）</td></tr>
            <tr><th>監修・承認</th><td>{{ゲーム化監修承認条件}}</td></tr>
          </table>
        </td>
      </tr>
      {{/if}}
      {{#if その他追加利用}}
      <tr>
        <td class="col-item">その他追加利用</td>
        <td class="col-value">{{その他追加利用条件}}</td>
      </tr>
      {{/if}}

      <!-- ===== 共通利用条件 ===== -->
      <tr class="sec-row">
        <td colspan="2">
          共　通　利　用　条　件
          <span class="sec-ref">追加利用全般に適用</span>
        </td>
      </tr>
      <tr>
        <td class="col-item">監修・承認手続</td>
        <td class="col-value">
          監修対象：{{監修対象}}<br>
          提出物：{{監修提出物}}<br>
          承認期限：{{承認期限}}<br>
          承認方法：{{承認方法}}
          <div class="caution-note">※ 明示的に承認不要とする場合を除き、最終的な商品仕様、映像素材、ゲーム内容、広告宣伝物、著作権表示は、事前確認の対象とする。</div>
        </td>
      </tr>
      <tr>
        <td class="col-item">禁止事項・制限事項</td>
        <td class="col-value">{{禁止事項制限事項}}<br>本著作物または許諾者の名誉・声望を害する態様、法令・公序良俗に反する態様、基本契約および本条件書の範囲を超える態様での利用はできない。</td>
      </tr>
      <tr>
        <td class="col-item">成果物・派生素材の権利帰属</td>
        <td class="col-value">{{派生素材権利帰属}}<br>本条件書に明示のない限り、追加利用のために被許諾者またはその委託先が作成した商品デザイン、映像素材、ゲームプログラム、UI、広告素材その他の新規成果物に係る権利は、当該成果物の制作主体または被許諾者に帰属する。ただし、原著作物に係る許諾者の権利は許諾者に留保される。</td>
      </tr>
      <tr>
        <td class="col-item">表示・クレジット</td>
        <td class="special-cell">{{追加利用著作権表示}}</td>
      </tr>

      <!-- ===== 対価・支払条件 ===== -->
      <tr class="sec-row">
        <td colspan="2">
          対　価・報　告・支　払　条　件
          <span class="sec-ref">（基本契約第１５条）</span>
        </td>
      </tr>
      <tr>
        <td class="col-item">対価区分</td>
        <td class="col-value">
          <div class="check-row">
            <span>{{#if 対価区分固定}}☑{{else}}□{{/if}} 固定対価</span>
            <span>{{#if 対価区分売上連動}}☑{{else}}□{{/if}} 売上連動</span>
            <span>{{#if 対価区分ライセンス収益分配}}☑{{else}}□{{/if}} ライセンス収益分配</span>
            <span>{{#if 対価区分MG前払}}☑{{else}}□{{/if}} MG／前払金あり</span>
            <span>{{#if 対価区分無償}}☑{{else}}□{{/if}} 無償</span>
          </div>
        </td>
      </tr>
      <tr>
        <td class="col-item">計算式</td>
        <td class="formula-cell">
          {{#if 商品化}}<div class="formula-line">商品化：{{商品化対価計算式}}</div>{{/if}}
          {{#if 映像化}}<div class="formula-line">映像化：{{映像化対価計算式}}</div>{{/if}}
          {{#if デジタルゲーム化}}<div class="formula-line">デジタルゲーム化：{{ゲーム化対価計算式}}</div>{{/if}}
          <div class="formula-line">控除項目・為替：{{控除項目為替条件}}</div>
        </td>
      </tr>
      <tr>
        <td class="col-item">MG・前払金</td>
        <td class="col-value">{{MG前払金条件}}<br>充当方法：{{MG前払金充当方法}}</td>
      </tr>
      <tr>
        <td class="col-item">報告・支払条件</td>
        <td class="col-value">
          報告対象期間：{{報告対象期間}}<br>
          報告期限：{{報告期限}}<br>
          支払期日：{{支払期日}}<br>
          報告明細：{{報告明細}}
        </td>
      </tr>
      <tr>
        <td class="col-item">消費税・源泉徴収</td>
        <td class="col-value">消費税：{{消費税区分}}<br>源泉徴収：{{源泉徴収有無}}<br>インボイス登録番号：{{インボイス登録番号}}</td>
      </tr>

      <!-- ===== 優先関係・終了後処理 ===== -->
      <tr class="sec-row">
        <td colspan="2">
          優　先　関　係・終　了　後　処　理
        </td>
      </tr>
      <tr>
        <td class="col-item">通常条件書との関係</td>
        <td class="col-value">本条件書は、通常条件書では許諾対象外とされた追加利用についてのみ適用される。本条件書と基本契約または通常条件書の内容が抵触する場合、当該追加利用に関する範囲に限り、本条件書の定めが優先する。</td>
      </tr>
      <tr>
        <td class="col-item">終了後処理</td>
        <td class="col-value">{{終了後処理}}<br>本条件書に基づく追加許諾が終了した場合、被許諾者は、未販売在庫、制作中素材、公開済み映像、配信中ゲーム、広告素材その他の終了後取扱いについて、本欄または別途合意に従う。</td>
      </tr>
      <!-- ===== 通知先 ===== -->
      <tr class="sec-row"><td colspan="2">通　知　先</td></tr>
      <tr>
        <td class="col-item">許諾者 通知先</td>
        <td class="col-value">担当：{{許諾者担当者}}　／　TEL：{{許諾者電話}}　／　Email：{{許諾者メール}}</td>
      </tr>
      <tr>
        <td class="col-item">被許諾者 通知先<span class="sub-note">当社担当者（担当者選択から引用）</span></td>
        <td class="col-value">担当：{{STAFF_NAME}}　／　TEL：{{STAFF_PHONE}}　／　Email：{{STAFF_EMAIL}}</td>
      </tr>
      <tr>
        <td colspan="2" class="col-value" style="font-size:8.6pt;color:#555;">本書に関する通知その他の連絡は、基本契約の通知条項に従い、上記の通知先に対して行う。</td>
      </tr>

      <tr>
        <td class="col-item">特記事項</td>
        <td class="special-cell">{{特記事項}}</td>
      </tr>

    </tbody>
  </table>

  <p class="closing-note">本条件書に定めのない事項については、基本契約および通常条件書の定めによるものとする。</p>
  <p class="closing-text">本条件書の成立を証するため、本書の電磁的記録を作成し、許諾者と被許諾者が合意後、電子署名を施し、各自その電磁的記録を保管する。ただし、書面により締結する場合は本書２通を作成し、記名押印の上各１通を保有する。</p>

  <div class="head-signature">
    <div class="sig-date">{{締結日}}</div>
    <div class="sig-grid">
      <div class="sig-party">
        <div class="party-label">許　諾　者</div>
        <div>{{許諾者住所}}</div>
        <div class="sig-name-row">
          <span>{{著作者名}}（法人の場合は法人名・代表者名）</span>
          <span class="stamp-box">印</span>
        </div>
      </div>
      <div class="sig-party">
        <div class="party-label">株式会社アークライト</div>
        <div>{{アークライト住所}}</div>
        <div class="sig-name-row">
          <span>代表取締役　{{アークライト代表者氏名}}</span>
          <span class="stamp-box">印</span>
        </div>
      </div>
    </div>
  </div>

</div>
</body>
</html>
$html_pub_additional_terms$, $schema_pub_additional_terms$[{"name": "追加条件書番号", "label": "追加条件書番号", "group": "I. 基本情報", "dbField": "auto.docNumber", "helpText": "生成時に自動採番されます (ARC-PUBA-YYYY-NNNN)"}, {"name": "基本契約番号", "label": "基本契約番号", "group": "I. 基本情報", "placeholder": "ARC-PUB-2026-0001"}, {"name": "通常条件書番号", "label": "関連する通常条件書 番号", "group": "I. 基本情報", "placeholder": "ARC-PUBT-2026-0001"}, {"name": "対象出版物名", "label": "対象出版物名", "group": "I. 基本情報", "required": true}, {"name": "締結日", "label": "締結日", "group": "I. 基本情報", "required": true, "placeholder": "例: 2026年5月12日"}, {"name": "効力発生日", "label": "効力発生日", "group": "I. 基本情報", "type": "date"}, {"name": "基本契約締結日", "label": "基本契約 締結日", "group": "I. 基本情報", "placeholder": "例: 2026年4月1日"}, {"name": "通常条件書締結日", "label": "通常条件書 締結日", "group": "I. 基本情報", "placeholder": "例: 2026年4月15日"}, {"name": "許諾者", "label": "許諾者 名称", "group": "I. 基本情報", "required": true, "dbField": "vendor.vendor_name"}, {"name": "許諾者住所", "label": "許諾者 住所", "group": "I. 基本情報", "type": "textarea", "dbField": "vendor.address"}, {"name": "追加許諾開始日", "label": "追加許諾 開始日", "group": "I. 基本情報", "type": "date"}, {"name": "追加許諾終了日", "label": "追加許諾 終了日", "group": "I. 基本情報", "type": "date"}, {"name": "自動更新有無", "label": "自動更新", "group": "I. 基本情報", "type": "select", "options": ["あり", "なし"]}, {"name": "更新単位", "label": "更新単位", "group": "I. 基本情報", "placeholder": "例: 1年"}, {"name": "終了通知期限", "label": "終了通知期限", "group": "I. 基本情報", "placeholder": "例: 満了3か月前"}, {"name": "原著作物名", "label": "原著作物名", "group": "II. 対象著作物", "required": true}, {"name": "対象キャラクター設定等", "label": "対象キャラクター・設定等", "group": "II. 対象著作物", "type": "textarea"}, {"name": "著作者名", "label": "著作者名", "group": "II. 対象著作物", "type": "textarea", "required": true, "helpText": "共著の場合は改行または読点（、）区切りで複数記載できます"}, {"name": "著作権者", "label": "著作権者", "group": "II. 対象著作物", "type": "textarea", "helpText": "共有の場合は複数記載できます"}, {"name": "第三者権利有無", "label": "第三者権利の有無", "group": "II. 対象著作物", "type": "select", "options": ["あり", "なし"]}, {"name": "第三者権利備考", "label": "第三者権利 備考", "group": "II. 対象著作物", "type": "textarea"}, {"name": "商品化", "label": "商品化を許諾する", "group": "III. 追加利用類型 (選択)", "type": "boolean", "helpText": "ON にすると PDF に商品化のチェック☑と条件表が表示されます"}, {"name": "映像化", "label": "映像化を許諾する", "group": "III. 追加利用類型 (選択)", "type": "boolean"}, {"name": "デジタルゲーム化", "label": "デジタルゲーム化を許諾する", "group": "III. 追加利用類型 (選択)", "type": "boolean"}, {"name": "その他追加利用", "label": "その他の追加利用を許諾する", "group": "III. 追加利用類型 (選択)", "type": "boolean"}, {"name": "その他利用類型", "label": "その他 利用類型 (名称)", "group": "III. 追加利用類型 (選択)"}, {"name": "独占非独占区分", "label": "許諾の性質", "group": "III. 追加利用類型 (選択)", "type": "select", "options": ["独占", "非独占", "優先交渉権のみ", "その他"]}, {"name": "許諾性質補足", "label": "許諾性質 補足", "group": "III. 追加利用類型 (選択)"}, {"name": "追加利用許諾地域", "label": "許諾地域", "group": "III. 追加利用類型 (選択)", "placeholder": "例: 全世界 / 日本国内"}, {"name": "追加利用許諾言語", "label": "許諾言語", "group": "III. 追加利用類型 (選択)"}, {"name": "再許諾可否", "label": "再許諾", "group": "III. 追加利用類型 (選択)", "type": "select", "options": ["可", "不可"]}, {"name": "委託先利用可否", "label": "委託先利用", "group": "III. 追加利用類型 (選択)", "type": "select", "options": ["可", "不可"]}, {"name": "承認済再許諾先委託先", "label": "承認済み再許諾先・委託先", "group": "III. 追加利用類型 (選択)", "type": "textarea"}, {"name": "商品化対象商品", "label": "商品化 対象商品", "group": "IV. 商品化条件 (商品化=ON時)", "type": "textarea"}, {"name": "商品化製造販売条件", "label": "商品化 製造・販売条件", "group": "IV. 商品化条件 (商品化=ON時)", "type": "textarea"}, {"name": "商品化監修承認条件", "label": "商品化 監修・承認", "group": "IV. 商品化条件 (商品化=ON時)", "type": "textarea"}, {"name": "商品化サンプル条件", "label": "商品化 サンプル・献本", "group": "IV. 商品化条件 (商品化=ON時)"}, {"name": "映像化対象媒体", "label": "映像化 対象媒体", "group": "V. 映像化条件 (映像化=ON時)", "type": "textarea"}, {"name": "映像化制作条件", "label": "映像化 制作条件", "group": "V. 映像化条件 (映像化=ON時)", "type": "textarea"}, {"name": "映像化改変脚色条件", "label": "映像化 改変・脚色条件", "group": "V. 映像化条件 (映像化=ON時)", "type": "textarea"}, {"name": "映像化監修承認条件", "label": "映像化 監修・承認", "group": "V. 映像化条件 (映像化=ON時)", "type": "textarea"}, {"name": "ゲーム化対象プラットフォーム", "label": "ゲーム化 対象プラットフォーム", "group": "VI. ゲーム化条件 (ゲーム化=ON時)", "type": "textarea"}, {"name": "ゲーム化対象ゲーム機能", "label": "ゲーム化 対象ゲーム・機能", "group": "VI. ゲーム化条件 (ゲーム化=ON時)", "type": "textarea"}, {"name": "ゲーム化運営条件", "label": "ゲーム化 運営条件", "group": "VI. ゲーム化条件 (ゲーム化=ON時)", "type": "textarea"}, {"name": "ゲーム化監修承認条件", "label": "ゲーム化 監修・承認", "group": "VI. ゲーム化条件 (ゲーム化=ON時)", "type": "textarea"}, {"name": "その他追加利用条件", "label": "その他追加利用 条件", "group": "VI. ゲーム化条件 (ゲーム化=ON時)", "type": "textarea"}, {"name": "監修対象", "label": "監修対象", "group": "VII. 共通利用条件", "type": "textarea"}, {"name": "監修提出物", "label": "監修 提出物", "group": "VII. 共通利用条件", "type": "textarea"}, {"name": "承認期限", "label": "承認期限", "group": "VII. 共通利用条件"}, {"name": "承認方法", "label": "承認方法", "group": "VII. 共通利用条件"}, {"name": "禁止事項制限事項", "label": "禁止事項・制限事項", "group": "VII. 共通利用条件", "type": "textarea"}, {"name": "派生素材権利帰属", "label": "成果物・派生素材の権利帰属", "group": "VII. 共通利用条件", "type": "textarea"}, {"name": "追加利用著作権表示", "label": "表示・クレジット", "group": "VII. 共通利用条件", "type": "textarea"}, {"name": "対価区分固定", "label": "対価: 固定対価", "group": "VIII. 対価・支払条件", "type": "boolean"}, {"name": "対価区分売上連動", "label": "対価: 売上連動", "group": "VIII. 対価・支払条件", "type": "boolean"}, {"name": "対価区分ライセンス収益分配", "label": "対価: ライセンス収益分配", "group": "VIII. 対価・支払条件", "type": "boolean"}, {"name": "対価区分MG前払", "label": "対価: MG／前払金あり", "group": "VIII. 対価・支払条件", "type": "boolean"}, {"name": "対価区分無償", "label": "対価: 無償", "group": "VIII. 対価・支払条件", "type": "boolean"}, {"name": "商品化対価計算式", "label": "商品化 対価計算式", "group": "VIII. 対価・支払条件", "type": "textarea"}, {"name": "映像化対価計算式", "label": "映像化 対価計算式", "group": "VIII. 対価・支払条件", "type": "textarea"}, {"name": "ゲーム化対価計算式", "label": "ゲーム化 対価計算式", "group": "VIII. 対価・支払条件", "type": "textarea"}, {"name": "控除項目為替条件", "label": "控除項目・為替", "group": "VIII. 対価・支払条件", "type": "textarea"}, {"name": "MG前払金条件", "label": "MG・前払金 条件", "group": "VIII. 対価・支払条件", "type": "textarea"}, {"name": "MG前払金充当方法", "label": "MG・前払金 充当方法", "group": "VIII. 対価・支払条件"}, {"name": "報告対象期間", "label": "報告対象期間", "group": "VIII. 対価・支払条件", "placeholder": "例: 四半期"}, {"name": "報告期限", "label": "報告期限", "group": "VIII. 対価・支払条件"}, {"name": "支払期日", "label": "支払期日", "group": "VIII. 対価・支払条件"}, {"name": "報告明細", "label": "報告明細", "group": "VIII. 対価・支払条件", "type": "textarea"}, {"name": "消費税区分", "label": "消費税区分", "group": "VIII. 対価・支払条件", "placeholder": "例: 外税10%"}, {"name": "源泉徴収有無", "label": "源泉徴収", "group": "VIII. 対価・支払条件", "type": "select", "options": ["あり", "なし"]}, {"name": "インボイス登録番号", "label": "インボイス登録番号 (T-)", "group": "VIII. 対価・支払条件", "dbField": "vendor.invoice_registration_number"}, {"name": "終了後処理", "label": "終了後処理", "group": "IX. 終了後・特記・発行オプション", "type": "textarea"}, {"name": "特記事項", "label": "特記事項", "group": "IX. 終了後・特記・発行オプション", "type": "textarea"}, {"name": "再発行フラグ", "label": "再発行版バナーを表示", "group": "IX. 終了後・特記・発行オプション", "type": "boolean"}, {"name": "改訂番号", "label": "改訂番号 (Rev.)", "group": "IX. 終了後・特記・発行オプション", "placeholder": "1"}, {"name": "元契約番号", "label": "元条件書番号", "group": "IX. 終了後・特記・発行オプション", "placeholder": "ARC-PUBA-2026-0001"}, {"name": "アークライト住所", "label": "アークライト 住所", "group": "X. アークライト", "type": "textarea", "helpText": "[自社] ボタンで自動入力", "dbField": "company.address"}, {"name": "アークライト代表者氏名", "label": "アークライト 代表者氏名", "group": "X. アークライト", "dbField": "company.rep"}, {"name": "許諾者担当者", "type": "text", "label": "許諾者 担当者", "group": "8. 通知先 (許諾者)", "helpText": "通知先の担当者(相手方)"}, {"name": "許諾者電話", "type": "text", "label": "許諾者 電話", "group": "8. 通知先 (許諾者)"}, {"name": "許諾者メール", "type": "text", "label": "許諾者 メール", "group": "8. 通知先 (許諾者)"}]$schema_pub_additional_terms$::jsonb, '通知先セクション+短い通知条文を追加 (0051)', 'migration-0051'
    FROM t RETURNING id, template_id)
UPDATE document_templates dt SET current_version_id=nv.id, updated_at=now() FROM nv WHERE dt.id=nv.template_id;
