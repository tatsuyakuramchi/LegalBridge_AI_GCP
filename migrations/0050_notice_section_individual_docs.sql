-- 0050_notice_section_individual_docs.sql
-- 個別条件明細文書(個別利用許諾条件書 / 出版等利用許諾条件書 / 発注書)に「通知先」を追加:
--   - 頭書き/ヘッダに通知先(両当事者の担当者・電話・メール)。当社側は担当者(STAFF_*)を引用、相手方は連絡先
--   - 本文に短い通知条文(通知は基本契約の通知条項に従い、本書記載の通知先に行う旨)
--   - 相手方連絡先の入力欄を追加(individual=Licensor_担当者/電話/メール, pub=許諾者担当者/電話/メール,
--     purchase_order=VENDOR_CONTACT_PHONE)
-- document_templates(db モード)を現行 disk テンプレ + 更新後 field_schema の新版へ更新(0044方式)。

-- ===== individual_license_terms =====
WITH t AS (SELECT id FROM document_templates WHERE template_key='individual_license_terms'), nv AS (
  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  SELECT t.id, COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id=t.id),0)+1,
         $html_individual_license_terms$<!--
================================================================================
  個別利用許諾条件テンプレート v6 (Phase 22.21.15)
  v5 ベース (legalbrigde-proto_GCP/templates/template_ledger_v5.html) に
  Phase 22.21.x の改善を統合:
    - work_id 表示 (台帳ID → ワークID にラベル変更、{{work_id}} 参照)
    - financial_conditions[] 動的ループ + legacy 金銭条件1/2/3 fallback
    - 概要行 (condition_no ベースのデフォルト文)
    - 計算式 重複表示の解消 (yellow formula-panel のみ)
    - 基準価格ラベル → 基準価格
    - サブライセンシー一覧 動的テーブル (empty state 対応)
    - 代表者印 行を削除 (会社印のみ残す)
    - 承認条件/時期 を if-helper で原作デフォルト引用
================================================================================
-->
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>別紙 個別利用許諾条件 - {{#if work_id}}{{work_id}}{{else}}{{台帳ID}}{{/if}}</title>
  <style>
    /* ── ページ・基本 ── */
    @page { size: A4; margin: 11mm 13mm; }

    :root {
      --ink:   #111;
      --muted: #555;
      --line:  #cfcfcf;
      --panel: #f2f2f2;
      --panel2:#fafafa;
    }

    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    body {
      font-family: "Noto Sans CJK JP", "Noto Sans JP", sans-serif;
      font-size: 8.8pt;
      line-height: 1.42;
      color: var(--ink);
      margin: 0;
      padding: 0;
      background: white;
    }

    /* ── ヘッダー ── */
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2px solid var(--ink);
      padding-bottom: 5px;
      margin-bottom: 5px;
    }
    h1 { font-size: 13pt; margin: 0; letter-spacing: .6px; flex-shrink: 0; }
    .top-right-info { text-align: right; font-size: 9pt; line-height: 1.6; color: var(--muted); }
    .doc-subtitle   { font-size: 10.5pt; font-weight: 900; margin: 2px 0 7px 0; }

    /* ── メタボックス（横割り） ── */
    .meta-box {
      border: 1px solid var(--line);
      padding: 6px 9px;
      margin: 5px 0 6px 0;
      background: var(--panel2);
      page-break-inside: avoid;
    }
    .meta-row-v    { display: table; width: 100%; border-collapse: collapse; }
    .meta-row-item { display: table-row; }
    .meta-label-h  {
      display: table-cell; width: 22%;
      font-weight: 900; font-size: 9pt; color: var(--muted);
      padding: 2px 8px 2px 0; white-space: nowrap; vertical-align: top;
    }
    .meta-val-h    { display: table-cell; font-size: 9pt; padding: 2px 0; vertical-align: top; line-height: 1.45; }
    .meta-note     { font-size: 8.5pt; color: var(--muted); margin-top: 6px; }

    /* ── セクション ── */
    .section       { margin-top: 8px; page-break-inside: auto; break-inside: auto; }
    .section-title {
      font-weight: 900; font-size: 10.5pt;
      border-left: 4px solid var(--ink); padding-left: 8px;
      margin-bottom: 6px; page-break-after: avoid;
    }

    /* ── ボックス・行 ── */
    .box      { border: 1px solid var(--line); padding: 6px 10px; margin-bottom: 5px; page-break-inside: avoid; }
    .row-info { display: flex; margin-bottom: 3px; }
    .row-label{ width: 25%; flex-shrink: 0; color: var(--muted); }
    .row-val  { width: 75%; }

    /* ── テーブル ── */
    table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 9pt; page-break-inside: auto; }
    th, td { border: 1px solid var(--line); padding: 4px 7px; text-align: left; vertical-align: top; line-height: 1.5; }
    th { background: var(--panel); font-weight: 900; }
    thead { display: table-header-group; }
    tbody tr { page-break-inside: avoid; }

    /* ── callout ── */
    .callout { background: var(--panel2); border: 1px solid var(--line); padding: 7px 10px; margin: 5px 0; line-height: 1.65; }

    /* ── 金銭条件 ── */
    .payment-box   { margin-top: 4px; padding: 6px 9px; border: 1px solid var(--line); background: #fff; page-break-inside: avoid; }
    .formula-panel { background: #e8f4ff; border: 1px solid #b3d9ff; padding: 6px 10px; margin: 5px 0; border-radius: 4px; }
    .formula-main  { font-size: 9pt; color: #004499; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
    .formula-note  { font-size: 8pt; color: #666; margin-top: 4px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .payment-grid  { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 10px; margin: 5px 0; }
    .payment-grid-item { display: flex; margin-bottom: 2px; }
    .payment-chip  { margin-top: 3px; padding: 4px 8px; line-height: 1.4; }
    .payment-body  { line-height: 1.4; word-break: break-word; }
    .payment-terms    { background: #fff8dc; border: 1px solid #daa520; }
    .payment-guarantee{ background: #f2f2f2; border: 1px solid var(--line); }
    .payment-note-chip{ background: #f7f7f7; border: 1px dashed #999; }

    /* ── 署名 ── */
    .signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; page-break-inside: avoid; }
    .sig-box   { border: 1px solid var(--line); padding: 12px; }
    .sig-title { font-weight: 900; margin-bottom: 10px; }
    .sig-line  { border-bottom: 1px solid var(--ink); height: 16px; margin: 6px 0 4px 0; }

    /* ── フッター ── */
    .footer { margin-top: 14px; text-align: center; font-size: 9pt; color: var(--muted); border-top: 1px solid var(--line); padding-top: 10px; }

    /* ── ユーティリティ ── */
    .center { text-align: center; }
    .small  { font-size: 9pt; }
    .muted  { color: var(--muted); }
    .bold   { font-weight: 900; }
    .mono   { font-family: monospace; }
    .page-break { page-break-before: always; }
  </style>
</head>
<body>

  <!-- ヘッダー -->
  <div class="header-row">
    <div>
      <h1>別紙 個別利用許諾条件</h1>
      {{!-- Phase 23.1: 再発行版バッジ (REVISION >= 1 で表示)。 --}}
      {{#if (gt REVISION 0)}}
      <div style="display:inline-block; margin-top:4px; padding:2px 10px; background:#fef2f2; border:1.5px solid #b91c1c; color:#b91c1c; font-size:9pt; font-weight:bold; letter-spacing:0.05em;">
        修正版 Rev. {{REVISION}} — 元契約: {{BASE_DOC_NO}}
      </div>
      {{/if}}
    </div>
    <div class="top-right-info">
      発行日: <strong>{{発行日}}</strong><br>
      契約書番号: <strong class="mono">{{契約書番号}}</strong><br>
      {{!-- Phase 22.21.8: 台帳ID → ワークID 表示。work_id があれば優先。 --}}
      ワークID: <strong class="mono">{{#if work_id}}{{work_id}}{{else}}{{台帳ID}}{{/if}}</strong>
    </div>
  </div>

  <!-- サブタイトル -->
  <div class="doc-subtitle">{{ライセンス種別名}}</div>

  <!-- メタ情報ボックス -->
  <div class="meta-box">
    <div class="meta-row-v">
      <div class="meta-row-item">
        <span class="meta-label-h">基本契約</span>
        <span class="meta-val-h">{{基本契約名}}</span>
      </div>
      <div class="meta-row-item">
        <span class="meta-label-h">当事者</span>
        <span class="meta-val-h">
          Licensor: {{#if Licensor_氏名会社名}}{{Licensor_氏名会社名}}{{else}}{{Licensor_名称}}{{/if}}<br>
          Licensee: {{#if Licensee_氏名会社名}}{{Licensee_氏名会社名}}{{else}}{{Licensee_名称}}{{/if}}
        </span>
      </div>
      <div class="meta-row-item">
        <span class="meta-label-h">期間</span>
        <span class="meta-val-h">
          契約開始日：{{許諾開始日}}
          {{#if 許諾期間注記}}<div style="font-size:8pt; color:#666; margin-top:2px;">{{許諾期間注記}}</div>{{/if}}
        </span>
      </div>
      <div class="meta-row-item">
        <span class="meta-label-h">通知先</span>
        <span class="meta-val-h">
          Licensor: 担当 {{Licensor_担当者}} ／ TEL {{Licensor_電話}} ／ Email {{Licensor_メール}}<br>
          Licensee: 担当 {{STAFF_NAME}} ／ TEL {{STAFF_PHONE}} ／ Email {{STAFF_EMAIL}}
        </span>
      </div>
    </div>
    <div class="meta-note">本別紙の定めと基本契約の定めが抵触する場合、本別紙の定めが優先する。</div>
  </div>

  <!-- 1. 許諾の内容 -->
  <div class="section">
    <div class="section-title">1. 許諾の内容（Grant）</div>
    <div class="box">
      <div class="row-info">
        <span class="row-label">原著作物</span>
        <span class="row-val">{{原著作物名}}{{#if 原著作物補記}}（{{原著作物補記}}。以下「対象作品」という。）{{else}}（以下「対象作品」という。）{{/if}}</span>
      </div>
      <div class="row-info">
        <span class="row-label">対象製品の定義</span>
        <span class="row-val">LicenseeがLicensorより許諾を受け、対象作品を利用して企画・開発・製造・販売するボードゲーム製品（以下「対象製品」という。）</span>
      </div>
      <div class="row-info">
        <span class="row-label">対象製品予定名</span>
        <span class="row-val">{{対象製品予定名}}</span>
      </div>
      <div class="row-info">
        <span class="row-label">独占性</span>
        <span class="row-val">
          {{#if 独占性}}<strong>{{独占性}}</strong>{{else}}<strong>独占的</strong>（排他的独占：Licensorは第三者への再許諾を自ら行わない）{{/if}}
        </span>
      </div>

      <div style="margin-top:6px; border:1px solid var(--line); padding:8px 10px; background:#fff;">
        <div style="font-weight:900; margin-bottom:6px; border-bottom:1px solid var(--line); padding-bottom:3px;">ボードゲーム（開発・製造・販売）</div>

        <div style="margin-bottom:5px;">
          <div style="font-weight:900;">（A）許諾範囲（Scope）</div>
          <div class="small" style="margin-top:3px;">
            全世界（日本国内を含む）において、全言語（日本語版を含む）により、対象作品のゲームルール、テーマ、文面、記号、名称その他一切の著作権（著作権法第27条・第28条に規定される権利を含む）を利用して、ボードゲーム製品を企画・開発・製造・販売・広告宣伝するために必要な範囲で許諾する。
          </div>
        </div>

        <div style="margin-bottom:5px;">
          <div style="font-weight:900;">（B）許諾権利（Rights）</div>
          <ul class="small" style="margin:4px 0 0 16px; padding:0;">
            <li><strong>複製・翻案：</strong>対象作品をボードゲーム構成物（パッケージ、カード、ボード、マニュアル等）に複製および翻案（キャラクターのデフォルメ化、トリミング等を含む）する権利</li>
            <li><strong>譲渡：</strong>製造した製品を譲渡により公衆に提供する権利（全世界・全言語）</li>
            <li><strong>公衆送信・上映：</strong>製品の広告宣伝のために対象作品またはその複製物を公衆送信（送信可能化を含む）および上映する権利</li>
            <li><strong>著作者人格権の不行使：</strong>Licensorは、本契約に定める場合またはLicensor・Licensee書面合意の場合を除き、契約期間中、著作者人格権（著作権法第27条・第28条に規定される権利を含む）を行使しないことを確認する（Licensorの被用者・使用人による権利行使を含む）</li>
          </ul>
        </div>

        <div>
          <div style="font-weight:900;">（C）再許諾（Sub-license）条件</div>
          <div class="small" style="margin-top:3px;">
            Licensorの事前書面承認を得た場合に限り、Licenseeは第三者に対しサブライセンスを行うことができる。サブライセンスの対価配分は第4条および金銭条件2に定める通りとする。
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 2. 提供素材・監修・承認 -->
  <div class="section">
    <div class="section-title">2. 提供素材・監修・承認（Materials &amp; Approval）</div>
    <table>
      <thead>
        <tr>
          <th style="width:24%">素材番号</th>
          <th style="width:20%">素材名</th>
          <th style="width:13%">権利者</th>
          <th style="width:10%">区分</th>
          <th style="width:8%">監修</th>
          <th>備考</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="mono small">{{素材番号}}</td>
          <td>{{素材名}}</td>
          <td>{{素材権利者}}</td>
          <td class="center">{{#if 素材区分}}{{素材区分}}{{else}}ORIGINAL{{/if}}</td>
          <td class="center bold">{{#if 監修要否}}{{監修要否}}{{else}}有{{/if}}</td>
          <td class="small">{{#if 素材備考}}{{素材備考}}{{else}}—{{/if}}</td>
        </tr>
      </tbody>
    </table>

    <div class="box payment-box">
      <div style="font-weight:900; margin-bottom:5px;">承認条件</div>
      <div class="row-info">
        <span class="row-label">承認対象</span>
        <span class="row-val">{{#if 承認対象}}{{承認対象}}{{else}}ゲームルール・テーマ・文面・記号・名称の変更、追加、削除、商品としての仕様変更、パッケージ・広告宣伝材料{{/if}}</span>
      </div>
      <div class="row-info">
        <span class="row-label">承認時期</span>
        <span class="row-val">{{#if 承認時期}}{{承認時期}}{{else}}製造前・変更前（書面による事前承諾）{{/if}}</span>
      </div>
      <div class="row-info">
        <span class="row-label">監修者</span>
        <span class="row-val">{{監修者}}</span>
      </div>
      <div class="row-info">
        <span class="row-label">クレジット表示</span>
        <span class="row-val">{{#if クレジット表示}}{{クレジット表示}}{{else}}製品に適切と思われる箇所に著者名を明記する{{/if}}</span>
      </div>
      <div class="row-info">
        <span class="row-label">見本提供</span>
        <span class="row-val">{{#if 見本提供}}{{見本提供}}{{else}}初回生産時：生産完了後すみやかに3個をLicensorに提供。{{/if}}</span>
      </div>
    </div>
  </div>

  <!-- 3. 金銭条件 -->
  <div class="section">
    <div class="section-title">3. 金銭条件（Payment）</div>

    {{!--
      Phase 22.21.x: financial_conditions[] 配列ループで N 件描画。
      legacy 後方互換: 配列が無いときは 金銭条件1_* / 金銭条件2_* / 金銭条件3_* に fallback。
      Phase 22.21.15: v5 デザイン (formula-panel + payment-grid + payment-chip 3 種) を採用。
    --}}
    {{#if financial_conditions.length}}
      {{#each financial_conditions}}
      <div class="box payment-box">
        <div style="font-weight:900; margin-bottom:5px;">
          金銭条件 {{condition_no}}：{{#if condition_name}}{{condition_name}}{{else}}{{#if title}}{{title}}{{else}}{{#if (eq condition_no 1)}}自社製造・直接販売{{/if}}{{#if (eq condition_no 2)}}国内・海外展開（ライセンスアウト型）{{/if}}{{#if (eq condition_no 3)}}海外展開（プロダクトアウト型）{{/if}}{{/if}}{{/if}}{{#if region_language_label}}（{{region_language_label}}）{{/if}}
        </div>
        <div class="row-info">
          <span class="row-label">計算方式</span>
          <span class="row-val" style="font-weight:900;">{{#if calc_type}}{{#if (eq calc_type "BASE_QTY_RATE")}}基準価格 × 個数 × 料率{{/if}}{{#if (eq calc_type "BASE_RATE")}}基準価格 × 料率{{/if}}{{#if (eq calc_type "FIXED")}}固定値（{{#if (eq fixed_kind "INSTALLMENT")}}分割{{else}}一括{{/if}}）{{/if}}{{#if (eq calc_type "SUBSCRIPTION")}}サブスクリプション（{{#if (eq subscription_cycle "ANNUAL")}}年払い{{else}}月払い{{/if}}）{{/if}}{{else}}{{#if calc_method}}{{calc_method}}{{else}}—{{/if}}{{/if}}</span>
        </div>
        {{!-- 概要: row.summary を優先、なければ condition_no ベースのデフォルト文 --}}
        {{#if summary}}
        <div class="row-info">
          <span class="row-label">概要</span>
          <span class="row-val small">{{summary}}</span>
        </div>
        {{else}}
        {{#if (eq condition_no 1)}}
        <div class="row-info">
          <span class="row-label">概要</span>
          <span class="row-val small">Licensee 自らが販売する国内販売において、基準価格に料率と販売数を乗じた金額をロイヤリティとして支払います。</span>
        </div>
        {{/if}}
        {{#if (eq condition_no 2)}}
        <div class="row-info">
          <span class="row-label">概要</span>
          <span class="row-val small">国内・海外パートナーにサブライセンスし、Licensee が受領したサブライセンス料を料率に応じて分配します。</span>
        </div>
        {{/if}}
        {{#if (eq condition_no 3)}}
        <div class="row-info">
          <span class="row-label">概要</span>
          <span class="row-val small">海外パートナーからの委託により Licensee がローカライズ版を製造・出荷し、海外パートナーが現地で販売元となる形式。海外パートナーから Licensee が受領する製造代金および利用許諾料を含む取引額に対して料率を乗じた金額を、Licensor へロイヤリティとして支払います。</span>
        </div>
        {{/if}}
        {{/if}}
        {{#if formula_text}}
        <div class="formula-panel">
          <div style="font-weight:900; color:#0066cc; margin-bottom:2px;">計算式</div>
          <div class="formula-main">{{formula_text}}</div>
          {{#if formula_note}}<div class="formula-note">{{formula_note}}</div>{{/if}}
        </div>
        {{/if}}
        <div class="payment-grid">
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">基準価格</span>
            <span style="width:60%; font-weight:500;">{{#if base_price_label}}{{base_price_label}}{{else}}—{{/if}}</span>
          </div>
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">料率</span>
            <span style="width:60%; font-weight:500;">{{formatPct rate_pct}}</span>
          </div>
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">計算期間</span>
            <span style="width:60%; font-weight:500;">{{#if calc_period}}{{calc_period}}{{else}}—{{/if}}</span>
          </div>
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">通貨</span>
            <span style="width:60%; font-weight:500;">{{#if currency}}{{currency}}{{else}}JPY{{/if}}</span>
          </div>
        </div>
        {{#if payment_terms}}
        <div class="payment-chip payment-terms">
          <div style="font-weight:900; color:#b8860b; margin-bottom:1px;">支払条件</div>
          <div class="small payment-body">{{payment_terms}}</div>
        </div>
        {{/if}}
        <div class="payment-chip payment-guarantee">
          <div style="font-weight:900; color:#333; margin-bottom:1px;">MG/AG・最低保証等</div>
          <div class="small payment-body">{{#if (eq guarantee_type "AG")}}AG（前払い保証・累積消化）：{{#if ag_amount}}{{formatYen ag_amount}}{{else}}（別途定めなし）{{/if}}{{else}}{{#if (eq guarantee_type "MG")}}MG（最低保証）：{{#if mg_amount}}{{formatYen mg_amount}}{{else}}（別途定めなし）{{/if}}{{else}}{{#if mg_amount}}{{#if (gt mg_amount 0)}}{{formatYen mg_amount}}{{else}}（別途定めなし）{{/if}}{{else}}{{#if mg_text}}{{mg_text}}{{else}}（別途定めなし）{{/if}}{{/if}}{{/if}}{{/if}}</div>
        </div>
        {{#if calc_note}}
        <div class="payment-chip payment-note-chip">
          <div style="font-weight:900; color:#333; margin-bottom:1px;">補足条件・計算メモ</div>
          <div class="small payment-body">{{calc_note}}</div>
        </div>
        {{/if}}
      </div>
      {{/each}}
    {{else}}
      {{!-- Legacy fallback (flat 金銭条件N_*) — v5 デザイン適用 --}}
      <div class="box payment-box">
        <div style="font-weight:900; margin-bottom:5px;">
          金銭条件 1：自社製造・直接販売{{#if 金銭条件1_地域言語ラベル}}（{{金銭条件1_地域言語ラベル}}）{{/if}}
        </div>
        <div class="row-info">
          <span class="row-label">計算方式</span>
          <span class="row-val" style="font-weight:900;">{{金銭条件1_計算方式}}</span>
        </div>
        <div class="row-info">
          <span class="row-label">概要</span>
          <span class="row-val small">{{#if 金銭条件1_概要}}{{金銭条件1_概要}}{{else}}Licensee 自らが販売する国内販売において、基準価格に料率と販売数を乗じた金額をロイヤリティとして支払います。{{/if}}</span>
        </div>
        {{#if 金銭条件1_計算式}}
        <div class="formula-panel">
          <div style="font-weight:900; color:#0066cc; margin-bottom:2px;">計算式</div>
          <div class="formula-main">{{金銭条件1_計算式}}</div>
        </div>
        {{/if}}
        <div class="payment-grid">
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">基準価格</span>
            <span style="width:60%; font-weight:500;">{{金銭条件1_基準価格ラベル}}</span>
          </div>
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">料率</span>
            <span style="width:60%; font-weight:500;">{{金銭条件1_料率}}</span>
          </div>
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">計算期間</span>
            <span style="width:60%; font-weight:500;">{{金銭条件1_計算期間}}</span>
          </div>
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">通貨</span>
            <span style="width:60%; font-weight:500;">{{金銭条件1_通貨}}</span>
          </div>
        </div>
        {{#if 金銭条件1_支払条件}}
        <div class="payment-chip payment-terms">
          <div style="font-weight:900; color:#b8860b; margin-bottom:1px;">支払条件</div>
          <div class="small payment-body">{{金銭条件1_支払条件}}</div>
        </div>
        {{/if}}
        <div class="payment-chip payment-guarantee">
          <div style="font-weight:900; color:#333; margin-bottom:1px;">MG/AG・最低保証等</div>
          <div class="small payment-body">{{#if 金銭条件1_MG_AG}}{{金銭条件1_MG_AG}}{{else}}（別途定めなし）{{/if}}</div>
        </div>
      </div>

      {{#if 金銭条件2_計算方式}}
      <div class="box payment-box">
        <div style="font-weight:900; margin-bottom:5px;">
          金銭条件 2：国内・海外展開（ライセンスアウト型）{{#if 金銭条件2_地域言語ラベル}}（{{金銭条件2_地域言語ラベル}}）{{/if}}
        </div>
        <div class="row-info">
          <span class="row-label">計算方式</span>
          <span class="row-val" style="font-weight:900;">{{金銭条件2_計算方式}}</span>
        </div>
        <div class="row-info">
          <span class="row-label">概要</span>
          <span class="row-val small">{{#if 金銭条件2_概要}}{{金銭条件2_概要}}{{else}}国内・海外パートナーにサブライセンスし、Licensee が受領したサブライセンス料を料率に応じて分配します。{{/if}}</span>
        </div>
        {{#if 金銭条件2_計算式}}
        <div class="formula-panel">
          <div style="font-weight:900; color:#0066cc; margin-bottom:2px;">計算式</div>
          <div class="formula-main">{{金銭条件2_計算式}}</div>
        </div>
        {{/if}}
        <div class="payment-grid">
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">基準価格</span>
            <span style="width:60%; font-weight:500;">{{金銭条件2_基準価格ラベル}}</span>
          </div>
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">料率</span>
            <span style="width:60%; font-weight:500;">{{金銭条件2_料率}}</span>
          </div>
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">計算期間</span>
            <span style="width:60%; font-weight:500;">{{金銭条件2_計算期間}}</span>
          </div>
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">通貨</span>
            <span style="width:60%; font-weight:500;">{{金銭条件2_通貨}}</span>
          </div>
        </div>
        {{#if 金銭条件2_支払条件}}
        <div class="payment-chip payment-terms">
          <div style="font-weight:900; color:#b8860b; margin-bottom:1px;">支払条件</div>
          <div class="small payment-body">{{金銭条件2_支払条件}}</div>
        </div>
        {{/if}}
        <div class="payment-chip payment-guarantee">
          <div style="font-weight:900; color:#333; margin-bottom:1px;">MG/AG・最低保証等</div>
          <div class="small payment-body">{{#if 金銭条件2_MG_AG}}{{金銭条件2_MG_AG}}{{else}}（別途定めなし）{{/if}}</div>
        </div>
      </div>
      {{/if}}

      {{#if 金銭条件3_計算方式}}
      <div class="box payment-box">
        <div style="font-weight:900; margin-bottom:5px;">
          金銭条件 3：海外展開（プロダクトアウト型）{{#if 金銭条件3_地域言語ラベル}}（{{金銭条件3_地域言語ラベル}}）{{/if}}
        </div>
        <div class="row-info">
          <span class="row-label">計算方式</span>
          <span class="row-val" style="font-weight:900;">{{金銭条件3_計算方式}}</span>
        </div>
        <div class="row-info">
          <span class="row-label">概要</span>
          <span class="row-val small">{{#if 金銭条件3_概要}}{{金銭条件3_概要}}{{else}}海外パートナーからの委託により Licensee がローカライズ版を製造・出荷し、海外パートナーが現地で販売元となる形式。海外パートナーから Licensee が受領する製造代金および利用許諾料を含む取引額に対して料率を乗じた金額を、Licensor へロイヤリティとして支払います。{{/if}}</span>
        </div>
        {{#if 金銭条件3_計算式}}
        <div class="formula-panel">
          <div style="font-weight:900; color:#0066cc; margin-bottom:2px;">計算式</div>
          <div class="formula-main">{{金銭条件3_計算式}}</div>
        </div>
        {{/if}}
        <div class="payment-grid">
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">基準価格</span>
            <span style="width:60%; font-weight:500;">{{金銭条件3_基準価格ラベル}}</span>
          </div>
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">料率</span>
            <span style="width:60%; font-weight:500;">{{金銭条件3_料率}}</span>
          </div>
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">計算期間</span>
            <span style="width:60%; font-weight:500;">{{金銭条件3_計算期間}}</span>
          </div>
          <div class="payment-grid-item">
            <span style="width:40%; color:var(--muted); font-size:9pt;">通貨</span>
            <span style="width:60%; font-weight:500;">{{金銭条件3_通貨}}</span>
          </div>
        </div>
        {{#if 金銭条件3_支払条件}}
        <div class="payment-chip payment-terms">
          <div style="font-weight:900; color:#b8860b; margin-bottom:1px;">支払条件</div>
          <div class="small payment-body">{{金銭条件3_支払条件}}</div>
        </div>
        {{/if}}
        <div class="payment-chip payment-guarantee">
          <div style="font-weight:900; color:#333; margin-bottom:1px;">MG/AG・最低保証等</div>
          <div class="small payment-body">{{#if 金銭条件3_MG_AG}}{{金銭条件3_MG_AG}}{{else}}（別途定めなし）{{/if}}</div>
        </div>
      </div>
      {{/if}}
    {{/if}}
  </div>

  <!-- 4. 再許諾 -->
  <div class="section">
    <div class="section-title">4. 再許諾（Sub-license）</div>
    <table>
      <thead>
        <tr>
          <th style="width:8%">区分</th>
          <th style="width:14%">相手先</th>
          <th style="width:8%">地域</th>
          <th style="width:8%">言語</th>
          <th style="width:13%">適用金銭条件</th>
          <th style="width:10%">MG/AG</th>
          <th style="width:7%">個別料率</th>
          <th style="width:9%">契約締結日</th>
          <th>備考</th>
        </tr>
      </thead>
      <tbody>
        {{#if サブライセンシー一覧.length}}
          {{#each サブライセンシー一覧}}
          <tr>
            <td>{{#if 区分}}{{区分}}{{else}}—{{/if}}</td>
            <td>{{#if 名称}}<strong>{{名称}}</strong>{{else}}{{#if 相手先}}<strong>{{相手先}}</strong>{{else}}—{{/if}}{{/if}}</td>
            <td>{{#if 地域}}{{地域}}{{else}}—{{/if}}</td>
            <td>{{#if 言語}}{{言語}}{{else}}—{{/if}}</td>
            <td>{{#if 金銭条件}}{{金銭条件}}{{else}}{{#if 適用金銭条件}}{{適用金銭条件}}{{else}}—{{/if}}{{/if}}</td>
            <td>{{#if MGAG}}{{MGAG}}{{else}}なし{{/if}}</td>
            <td>{{#if 料率}}{{料率}}{{else}}{{#if 個別料率}}{{個別料率}}{{else}}—{{/if}}{{/if}}</td>
            <td>{{#if 契約締結日}}{{契約締結日}}{{else}}{{#if 締結日}}{{締結日}}{{else}}—{{/if}}{{/if}}</td>
            <td>{{#if 備考}}{{備考}}{{else}}なし{{/if}}</td>
          </tr>
          {{/each}}
        {{else}}
          <tr>
            <td colspan="9" class="center muted small">（登録なし）</td>
          </tr>
        {{/if}}
      </tbody>
    </table>
    <div class="callout" style="margin-top:5px;">
      <div style="font-weight:900;">補足</div>
      <div class="small muted" style="margin-top:3px;">{{#if 再許諾補足}}{{再許諾補足}}{{else}}再許諾先の追加は、Licensorの事前書面承認を取得の上、本台帳を更新する。{{/if}}</div>
    </div>
  </div>

  <!-- 5. 報告・監査条件 -->
  <div class="section">
    <div class="section-title">5. 報告・監査条件</div>
    <div class="box">
      <div class="row-info">
        <span class="row-label">報告トリガー</span>
        <span class="row-val">{{#if 報告トリガー}}{{報告トリガー}}{{else}}製造（印刷）ベース{{/if}}</span>
      </div>
      <div class="row-info">
        <span class="row-label">報告頻度</span>
        <span class="row-val">{{#if 報告頻度}}{{報告頻度}}{{else}}製造都度（初回・再生産ごと）{{/if}}</span>
      </div>
      <div class="row-info">
        <span class="row-label">報告内容</span>
        <span class="row-val">{{#if 報告内容}}{{報告内容}}{{else}}言語別製造数、希望小売価格（MSRP）、ロイヤリティ計算明細（販促・サンプル等の除外数を含む）{{/if}}</span>
      </div>
      <div class="row-info">
        <span class="row-label">税・源泉徴収</span>
        <span class="row-val">{{#if 税源泉徴収}}{{税源泉徴収}}{{else}}源泉徴収税は基本契約の定めに準ずる（支払時に控除のうえ支払い、源泉徴収票を発行する）{{/if}}</span>
      </div>
    </div>
  </div>

  <!-- 6. 特記事項 -->
  <div class="section">
    <div class="section-title">6. 特記事項</div>
    <div class="box" style="line-height:1.8;">
      １．基本契約に基づく個別利用許諾条件であり、当該基本契約と一体的に効力を有する。<br><br>
      ２．本書に関する通知その他の連絡は、基本契約の通知条項に従い、頭書き「通知先」に記載の宛先に対して行う。<br><br>
      {{#if 特記事項_本文}}{{{特記事項_本文}}}{{else}}{{#if 特記事項}}{{特記事項}}{{/if}}{{/if}}
    </div>
  </div>

  <!-- 7. 署名 -->
  <div class="section" style="page-break-inside: avoid; margin-top:16px;">
    <div class="section-title">7. 署名</div>
    <div class="small muted" style="margin-bottom:10px; line-height:1.7;">ライセンサーおよびライセンシーは、上記の通り利用許諾に関する個別条件を確認し、合意した。</div>
    <div class="signature-grid">

      <!-- Licensor署名欄 -->
      <div class="sig-box">
        <div class="sig-title">Licensor（許諾者）</div>
        <div style="margin-bottom:8px;">
          <div class="small muted">住所</div>
          <div class="small" style="margin-top:2px; margin-bottom:2px;">{{Licensor_住所}}</div>
          <div class="sig-line"></div>
        </div>
        {{!-- Phase 22.21.8: 代表者印 行を削除。会社印 (会社名横の 電子印影) のみ残す --}}
        {{#if LICENSOR_IS_CORPORATION}}
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
          <div style="flex:1;">
            <div class="small muted">会社名</div>
            <div class="small" style="margin-top:2px; margin-bottom:2px;">{{Licensor_氏名会社名}}</div>
            <div class="sig-line"></div>
          </div>
          <div style="width:64px; height:64px; border:1.5px solid var(--line); flex-shrink:0; display:flex; align-items:center; justify-content:center;">
            <span class="small muted" style="font-size:7.5pt; text-align:center; line-height:1.4;">電子<br>印影</span>
          </div>
        </div>
        <div style="margin-bottom:8px;">
          <div class="small muted">代表者名</div>
          <div class="small" style="margin-top:2px; margin-bottom:2px;">{{Licensor_代表者名}}</div>
          <div class="sig-line"></div>
        </div>
        {{else}}
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
          <div style="flex:1;">
            <div class="small muted">氏名</div>
            <div class="small" style="margin-top:2px; margin-bottom:2px;">{{Licensor_氏名会社名}}</div>
            <div class="sig-line"></div>
          </div>
          <div style="width:64px; height:64px; border:1.5px solid var(--line); flex-shrink:0; display:flex; align-items:center; justify-content:center;">
            <span class="small muted" style="font-size:7.5pt; text-align:center; line-height:1.4;">電子<br>印影</span>
          </div>
        </div>
        {{/if}}
      </div>

      <!-- Licensee署名欄 -->
      <div class="sig-box">
        <div class="sig-title">Licensee（被許諾者）</div>
        <div style="margin-bottom:8px;">
          <div class="small muted">住所</div>
          <div class="small" style="margin-top:2px; margin-bottom:2px;">{{Licensee_住所}}</div>
          <div class="sig-line"></div>
        </div>
        {{#if LICENSEE_IS_CORPORATION}}
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
          <div style="flex:1;">
            <div class="small muted">会社名</div>
            <div class="small" style="margin-top:2px; margin-bottom:2px;">{{Licensee_氏名会社名}}</div>
            <div class="sig-line"></div>
          </div>
          <div style="width:64px; height:64px; border:1.5px solid var(--line); flex-shrink:0; display:flex; align-items:center; justify-content:center;">
            <span class="small muted" style="font-size:7.5pt; text-align:center; line-height:1.4;">電子<br>印影</span>
          </div>
        </div>
        <div style="margin-bottom:8px;">
          <div class="small muted">代表者名</div>
          <div class="small" style="margin-top:2px; margin-bottom:2px;">{{Licensee_代表者名}}</div>
          <div class="sig-line"></div>
        </div>
        {{else}}
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
          <div style="flex:1;">
            <div class="small muted">氏名</div>
            <div class="small" style="margin-top:2px; margin-bottom:2px;">{{Licensee_氏名会社名}}</div>
            <div class="sig-line"></div>
          </div>
          <div style="width:64px; height:64px; border:1.5px solid var(--line); flex-shrink:0; display:flex; align-items:center; justify-content:center;">
            <span class="small muted" style="font-size:7.5pt; text-align:center; line-height:1.4;">電子<br>印影</span>
          </div>
        </div>
        {{/if}}
      </div>

    </div>
  </div>

  <!-- フッター -->
  <div class="footer">
    発行日: {{発行日}}　／　契約書番号: {{契約書番号}}　／　ワークID: {{#if work_id}}{{work_id}}{{else}}{{台帳ID}}{{/if}}<br>
    ※ 本別紙は、{{基本契約名}}（{{契約書番号}}）に付随する個別条件を定めるものです。
  </div>

</body>
</html>
$html_individual_license_terms$, $schema_individual_license_terms$[{"name": "発行日", "label": "発行日", "group": "I. ヘッダ", "type": "date", "required": true, "dbField": "auto.today"}, {"name": "台帳ID", "label": "台帳ID", "group": "I. ヘッダ", "placeholder": "(空欄で自動採番)", "helpText": "空欄で生成時に LIC-YYYY-NNNN 形式で自動採番。同じ Backlog 課題で再発行する場合は既存の台帳ID を維持"}, {"name": "契約書番号", "label": "契約書番号", "group": "I. ヘッダ", "dbField": "auto.docNumber", "helpText": "生成時に自動採番されます"}, {"name": "基本契約名", "label": "基本契約名", "group": "I. ヘッダ", "type": "textarea", "required": true, "helpText": "上の「マスタ・アーカイブから検索」で選択すると自動入力されます。手入力も可。"}, {"name": "Licensor_名称", "label": "Licensor 名称", "group": "II. Licensor (許諾者)", "required": true, "helpText": "[自社] または [取引先] ボタンで自動入力"}, {"name": "Licensor_住所", "label": "Licensor 住所", "group": "II. Licensor (許諾者)", "type": "textarea", "required": true}, {"name": "Licensor_氏名会社名", "label": "Licensor 氏名/会社名 (PDF表示用)", "group": "II. Licensor (許諾者)", "required": true}, {"name": "Licensor_代表者名", "label": "Licensor 代表者名", "group": "II. Licensor (許諾者)", "helpText": "法人の場合のみ"}, {"name": "LICENSOR_IS_CORPORATION", "label": "Licensor は法人", "group": "II. Licensor (許諾者)", "type": "boolean"}, {"name": "Licensee_名称", "label": "Licensee 名称", "group": "III. Licensee (被許諾者)", "required": true, "helpText": "[自社] または [取引先] ボタンで自動入力"}, {"name": "Licensee_住所", "label": "Licensee 住所", "group": "III. Licensee (被許諾者)", "type": "textarea", "required": true}, {"name": "Licensee_氏名会社名", "label": "Licensee 氏名/会社名 (PDF表示用)", "group": "III. Licensee (被許諾者)", "required": true}, {"name": "Licensee_代表者名", "label": "Licensee 代表者名", "group": "III. Licensee (被許諾者)", "helpText": "法人の場合のみ"}, {"name": "LICENSEE_IS_CORPORATION", "label": "Licensee は法人", "group": "III. Licensee (被許諾者)", "type": "boolean"}, {"name": "許諾開始日", "label": "許諾開始日", "group": "IV. 対象作品・期間", "type": "date", "required": true}, {"name": "許諾期間注記", "label": "許諾期間 注記", "group": "IV. 対象作品・期間", "type": "textarea", "placeholder": "例: 基本契約の満了日まで"}, {"name": "原著作物名", "label": "原著作物名", "group": "IV. 対象作品・期間", "required": true}, {"name": "原著作物補記", "label": "原著作物 補記", "group": "IV. 対象作品・期間", "helpText": "例: 原作および派生作品を含む"}, {"name": "対象製品予定名", "label": "対象製品（予定）名", "group": "IV. 対象作品・期間", "required": true}, {"name": "独占性", "label": "独占性", "group": "IV. 対象作品・期間", "type": "select", "options": ["独占", "非独占"], "required": true}, {"name": "素材番号", "label": "素材番号", "group": "V. 素材・監修", "placeholder": "LIC-01"}, {"name": "素材名", "label": "素材名", "group": "V. 素材・監修"}, {"name": "素材権利者", "label": "素材権利者", "group": "V. 素材・監修"}, {"name": "監修者", "label": "監修者", "group": "V. 素材・監修", "dbField": "staff.staff_name", "helpText": "[Sync Staff] で選択中の担当者を流し込み"}, {"name": "クレジット表示", "label": "クレジット表示", "group": "V. 素材・監修"}, {"name": "承認対象", "label": "承認対象 (承認条件)", "group": "V. 素材・監修", "type": "textarea", "helpText": "原作マスター > 承認条件デフォルトから自動入力 (上書き可)"}, {"name": "承認時期", "label": "承認時期", "group": "V. 素材・監修", "helpText": "原作マスター > 承認時期デフォルトから自動入力 (上書き可)"}, {"name": "金銭条件1_地域言語ラベル", "label": "金銭条件1 地域・言語ラベル", "group": "VI. 金銭条件 1 (自社製造)", "placeholder": "例: 国内・日本語"}, {"name": "金銭条件1_計算方式", "label": "計算方式", "group": "VI. 金銭条件 1 (自社製造)", "placeholder": "ROYALTY / FIXED 等"}, {"name": "金銭条件1_料率", "label": "料率", "group": "VI. 金銭条件 1 (自社製造)", "placeholder": "例: 5.0%"}, {"name": "金銭条件1_基準価格ラベル", "label": "基準価格", "group": "VI. 金銭条件 1 (自社製造)", "placeholder": "例: 上代（MSRP）"}, {"name": "金銭条件1_計算期間", "label": "計算期間", "group": "VI. 金銭条件 1 (自社製造)", "placeholder": "例: 四半期"}, {"name": "金銭条件1_通貨", "label": "通貨", "group": "VI. 金銭条件 1 (自社製造)", "placeholder": "JPY"}, {"name": "金銭条件1_計算式", "label": "計算式", "group": "VI. 金銭条件 1 (自社製造)", "type": "textarea", "placeholder": "例: 上代 × 5.0% × 製造数"}, {"name": "金銭条件1_支払条件", "label": "支払条件", "group": "VI. 金銭条件 1 (自社製造)"}, {"name": "金銭条件2_地域言語ラベル", "label": "金銭条件2 地域・言語ラベル", "group": "VII. 金銭条件 2 (サブライセンス, 任意)"}, {"name": "金銭条件2_計算方式", "label": "計算方式", "group": "VII. 金銭条件 2 (サブライセンス, 任意)"}, {"name": "金銭条件2_料率", "label": "料率", "group": "VII. 金銭条件 2 (サブライセンス, 任意)"}, {"name": "金銭条件2_基準価格ラベル", "label": "基準価格", "group": "VII. 金銭条件 2 (サブライセンス, 任意)"}, {"name": "金銭条件2_計算期間", "label": "計算期間", "group": "VII. 金銭条件 2 (サブライセンス, 任意)"}, {"name": "金銭条件2_通貨", "label": "通貨", "group": "VII. 金銭条件 2 (サブライセンス, 任意)"}, {"name": "金銭条件2_計算式", "label": "計算式", "group": "VII. 金銭条件 2 (サブライセンス, 任意)", "type": "textarea"}, {"name": "金銭条件2_支払条件", "label": "支払条件", "group": "VII. 金銭条件 2 (サブライセンス, 任意)"}, {"name": "金銭条件3_地域言語ラベル", "label": "金銭条件3 地域・言語ラベル", "group": "VIII. 金銭条件 3 (プロダクトアウト, 任意)"}, {"name": "金銭条件3_計算方式", "label": "計算方式", "group": "VIII. 金銭条件 3 (プロダクトアウト, 任意)"}, {"name": "金銭条件3_料率", "label": "料率", "group": "VIII. 金銭条件 3 (プロダクトアウト, 任意)"}, {"name": "金銭条件3_基準価格ラベル", "label": "基準価格", "group": "VIII. 金銭条件 3 (プロダクトアウト, 任意)"}, {"name": "金銭条件3_計算期間", "label": "計算期間", "group": "VIII. 金銭条件 3 (プロダクトアウト, 任意)"}, {"name": "金銭条件3_通貨", "label": "通貨", "group": "VIII. 金銭条件 3 (プロダクトアウト, 任意)"}, {"name": "金銭条件3_計算式", "label": "計算式", "group": "VIII. 金銭条件 3 (プロダクトアウト, 任意)", "type": "textarea"}, {"name": "金銭条件3_支払条件", "label": "支払条件", "group": "VIII. 金銭条件 3 (プロダクトアウト, 任意)"}, {"name": "特記事項_本文", "label": "特記事項", "group": "IX. 特記事項", "type": "textarea", "placeholder": "個別契約に固有の追加条件など"}, {"name": "Licensor_担当者", "type": "text", "label": "Licensor 担当者", "group": "II. Licensor (許諾者)", "helpText": "通知先の担当者(相手方)"}, {"name": "Licensor_電話", "type": "text", "label": "Licensor 電話", "group": "II. Licensor (許諾者)"}, {"name": "Licensor_メール", "type": "text", "label": "Licensor メール", "group": "II. Licensor (許諾者)"}]$schema_individual_license_terms$::jsonb, '通知先セクション+短い通知条文を追加 (0050)', 'migration-0050'
    FROM t RETURNING id, template_id)
UPDATE document_templates dt SET current_version_id=nv.id, updated_at=now() FROM nv WHERE dt.id=nv.template_id;

-- ===== pub_license_terms =====
WITH t AS (SELECT id FROM document_templates WHERE template_key='pub_license_terms'), nv AS (
  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  SELECT t.id, COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id=t.id),0)+1,
         $html_pub_license_terms$<!DOCTYPE html>
<html lang="ja">
<head>
  <base target="_top">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>出版等利用許諾条件書（軽量版） - {{条件書番号}}</title>
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
    h1.contract-title {
      text-align: center;
      font-size: 14pt;
      font-weight: bold;
      letter-spacing: 0.28em;
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
    .tobogaki .col-value       { width: 68%; word-break: break-all; overflow-wrap: break-word; color: #1a1a1a; }
    .tobogaki .col-value-fixed { width: 68%; color: #555; }
    .tobogaki .special-cell    { min-height: 2.5em; word-break: break-all; overflow-wrap: break-word; color: #1a1a1a; white-space: pre-wrap; }
    .tobogaki .retroactive-cell { font-size: 9pt; line-height: 1.65; color: #1a1a1a; text-align: justify; padding: 0.6em 0.7em; }
    .tobogaki .formula-cell { font-size: 8.6pt; line-height: 1.62; color: #1a1a1a; }
    .formula-line { margin: 0.1em 0; padding-left: 1em; text-indent: -1em; }
    .caution-note { margin-top: 0.35em; color: #7a4b00; font-size: 7.8pt; line-height: 1.45; }

    /* ===== 許諾ステータス ===== */
    .perm-choice            { font-size: 9.5pt; letter-spacing: 0.03em; }
    .perm-choice.perm-yes   { font-weight: bold; color: #1a1a1a; }
    .perm-choice.perm-no    { font-weight: normal; color: #aaa; }

    /* 紙媒体（固定許諾）のラベル */
    .perm-choice.perm-fixed { font-weight: bold; color: #555; }

    /* 条件ブロック（許諾する場合のみ表示） */
    .perm-conditions {
      margin-top: 0.4em;
      padding: 0.35em 0.6em;
      border-left: 2.5pt solid #d0d0d0;
      background-color: #fafafa;
    }
    .perm-conditions-fixed {
      margin-top: 0.4em;
      padding: 0.35em 0.6em;
      border-left: 2.5pt solid #aaa;
      background-color: #f5f5f5;
    }
    .perm-cond-item {
      display: flex;
      gap: 0.4em;
      font-size: 8.5pt;
      line-height: 1.55;
      margin-top: 0.1em;
    }
    .perm-cond-item:first-child { margin-top: 0; }
    .perm-cond-label { color: #666; flex-shrink: 0; min-width: 5.5em; }
    .perm-cond-value { color: #1a1a1a; }

    /* ===== 署名欄 ===== */
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
      /* Phase 26.7: 表全体の page-break-inside:avoid は、明細表が1ページ目に
         収まらないとき表全体を2ページ目へ送り、1ページ目に大きな余白を生む。
         署名欄のみ分割禁止とし、表は行単位 (tr) で分割可とすることで1ページ目を
         詰めて余白を解消する。 */
      .head-signature { page-break-inside: avoid; }
      .tobogaki tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
<div class="contract-document">

  <div class="doc-header" style="flex-direction: column; align-items: flex-end; gap: 0.15em;">
    <span>締結日：{{締結日}}</span>
    <span>基本契約番号：{{基本契約番号}}</span>
    <span>個別利用許諾番号：{{条件書番号}}</span>
  </div>

  <h1 class="contract-title">出版等利用許諾条件書</h1>

  <p class="preamble">株式会社アークライト（以下「被許諾者」という）と{{許諾者}}（以下「許諾者」という）は、{{基本契約締結日}}付出版等許諾基本契約書（以下「基本契約」という）第２条に基づき、以下のとおり本著作物の出版等に係る利用許諾条件を定める。</p>

  <table class="tobogaki">
    <tbody>

      <!-- ===== 基本情報 ===== -->
      <tr class="sec-row"><td colspan="2">基　本　情　報</td></tr>
      <tr>
        <td class="col-item">条件書番号</td>
        <td class="col-value">{{条件書番号}}</td>
      </tr>
      <tr>
        <td class="col-item">基本契約番号</td>
        <td class="col-value">{{基本契約番号}}</td>
      </tr>
      <tr>
        <td class="col-item">締結日</td>
        <td class="col-value">{{締結日}}</td>
      </tr>
      <tr>
        <td class="col-item">
          許諾期間
          <span class="sub-note">基本契約と異なる場合は本欄を優先</span>
        </td>
        <td class="col-value">
          許諾開始日：{{許諾開始日}}<br>
          許諾終了日：{{許諾終了日}}<br>
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
        <td class="col-item">対象出版物名</td>
        <td class="col-value">『{{対象出版物名}}』</td>
      </tr>
      <tr>
        <td class="col-item">著作者名<span class="sub-note">共著の場合は複数記載</span></td>
        <td class="col-value" style="white-space: pre-wrap;">{{著作者名}}</td>
      </tr>
      <tr>
        <td class="col-item">著作権者・権限</td>
        <td class="col-value">
          著作権者：{{著作権者}}<br>
          共同著作・第三者権利の有無：{{共同著作第三者権利有無}}<br>
          備考：{{権利関係備考}}
        </td>
      </tr>

      <!-- ===== 許諾内容 ===== -->
      <tr class="sec-row">
        <td colspan="2">
          許　諾　内　容
          <span class="sec-ref">（基本契約第３条・第４条）</span>
        </td>
      </tr>
      <tr>
        <td class="col-item">紙媒体出版</td>
        <td class="col-value-fixed">独占的に許諾する。</td>
      </tr>
      <tr>
        <td class="col-item">電子書籍配信</td>
        <td class="col-value">{{電子書籍配信許諾有無}}{{#if (eq 電子書籍配信許諾有無 "許諾する")}}（条件：{{#if 電子書籍配信条件}}{{電子書籍配信条件}}{{else}}主要電子書籍ストアにて配信。DRM 適用{{/if}}）{{/if}}</td>
      </tr>
      <tr>
        <td class="col-item">翻訳版・海外版出版</td>
        <td class="col-value">{{翻訳海外版許諾有無}}{{#if (eq 翻訳海外版許諾有無 "許諾する")}}（対象地域・言語：{{翻訳海外版対象地域言語}}）{{/if}}</td>
      </tr>
      <tr>
        <td class="col-item">販促・広告利用</td>
        <td class="col-value">本出版物の販売促進、広告宣伝、営業資料、プレスリリース、SNS告知その他これらに準ずる目的に必要な範囲で許諾する。</td>
      </tr>
      <tr>
        <td class="col-item">
          商品化・映像化・ゲーム化等
          <span class="sub-note">通常の条件書では対象外</span>
        </td>
        <td class="col-value">
          本条件書により当然に許諾されるものではない。商品化、映像化、デジタルゲーム化、アプリ化、グッズ化その他本条件書に明示されていない利用については、当事者間で追加条件書、覚書その他の書面により別途合意した場合に限り許諾される。
        </td>
      </tr>

      <!-- ===== 出版条件 ===== -->
      <tr class="sec-row">
        <td colspan="2">
          出　版　条　件
          <span class="sec-ref">（基本契約第３条・第８条・第１０条）</span>
        </td>
      </tr>
      <tr>
        <td class="col-item">許諾地域・言語</td>
        <td class="col-value">許諾地域：{{許諾地域}}<br>言語：{{許諾言語}}</td>
      </tr>
      <tr>
        <td class="col-item">販売形態</td>
        <td class="col-value">{{#if 販売形態}}{{販売形態}}{{else}}紙書籍：小売店販売／EC販売／イベント販売／その他{{#if (eq 電子書籍配信許諾有無 "許諾する")}}<br>電子書籍：主要電子書籍ストアにて配信／自社EC配信／その他{{/if}}{{/if}}</td>
      </tr>

      <!-- ===== 対価・支払条件 ===== -->
      <tr class="sec-row">
        <td colspan="2">
          対　価・支　払　条　件
          <span class="sec-ref">（基本契約第１５条）</span>
        </td>
      </tr>
      <tr>
        <td class="col-item">紙媒体出版</td>
        <td class="formula-cell">
          <div class="formula-line">{{#if 紙媒体計算式}}計算式：{{紙媒体計算式}}{{else}}計算式：税抜定価 × 印税対象部数 × 料率{{/if}}{{#if 紙書籍印税率}}（{{紙書籍印税率}}％）{{/if}}</div>
          {{#if 紙媒体印税対象部数区分}}<div class="formula-line">印税対象部数：{{紙媒体印税対象部数区分}}</div>{{/if}}
          <div class="caution-note">※ サンプル・献本その他の無償配布分は、印税対象部数に含めない。</div>
        </td>
      </tr>
      {{#if (eq 電子書籍配信許諾有無 "許諾する")}}
      <tr>
        <td class="col-item">電子書籍配信</td>
        <td class="formula-cell">{{#if 電子書籍計算式}}計算式：{{電子書籍計算式}}{{else}}計算式：税抜定価 × ダウンロード数 × 料率{{/if}}{{#if 電子書籍印税率}}（{{電子書籍印税率}}％）{{/if}}</td>
      </tr>
      {{/if}}
      {{#if (eq 翻訳海外版許諾有無 "許諾する")}}
      <tr>
        <td class="col-item">翻訳版・海外版出版</td>
        <td class="formula-cell">{{#if 翻訳海外版計算式}}{{翻訳海外版計算式}}{{else}}被許諾者受取ライセンス収益 × 料率{{/if}}{{#if 翻訳海外版料率}}（料率 {{翻訳海外版料率}}％）{{/if}}</td>
      </tr>
      {{/if}}
      <tr>
        <td class="col-item">支払時期・方法</td>
        <td class="col-value">
          紙書籍：都度払い（刊行日を含む月の翌々月{{#if (eq 許諾者種別 "法人")}}末日{{else}}20日{{/if}}払い）。{{#if (eq 電子書籍配信許諾有無 "許諾する")}}<br>
          電子書籍：年1回・6月{{#if (eq 許諾者種別 "法人")}}末日{{else}}20日{{/if}}払い（算定期間：毎年4月1日から翌年3月末日まで、同日締め）。{{/if}}<br>
          報告明細：{{#if 報告明細}}{{報告明細}}{{else}}利用形態別の数量・単価・金額を記載した報告書を提出{{/if}}
        </td>
      </tr>
      <tr>
        <td class="col-item">消費税・源泉徴収</td>
        <td class="col-value">消費税：{{消費税区分}}<br>源泉徴収：{{源泉徴収有無}}<br>インボイス登録番号：{{インボイス登録番号}}</td>
      </tr>
      <tr>
        <td class="col-item">振込口座</td>
        <td class="col-value">
          {{振込先銀行名}}　{{支店名}}<br>
          {{口座種別}}　{{口座番号}}<br>
          口座名義（カナ）：{{口座名義カナ}}
        </td>
      </tr>

      <!-- ===== 第三者知的財産権 ===== -->
      <tr class="sec-row">
        <td colspan="2">
          第　三　者　知　的　財　産　権
          <span class="sec-ref">（基本契約第７条）</span>
        </td>
      </tr>
      <tr>
        <td class="col-item">第三者IPの関与</td>
        <td class="col-value">
          {{第三者IP関与有無}}<br>
          「あり」の場合は、原権利者、原許諾期間、許諾範囲、制限事項、被許諾者による利用可否を別紙または特記事項に記載する。
        </td>
      </tr>

      <!-- ===== 著作権表示 ===== -->
      <tr class="sec-row">
        <td colspan="2">
          著　作　権　表　示
          <span class="sec-ref">（基本契約第２４条）</span>
        </td>
      </tr>
      <tr>
        <td class="col-item">表示内容</td>
        <td class="special-cell">{{著作権表示}}</td>
      </tr>
      <tr>
        <td class="col-item">表示位置・補足</td>
        <td class="col-value">{{表示位置補足}}</td>
      </tr>

      <!-- ===== 旧合意・過去利用 ===== -->
      {{#if (eq 旧合意有無 "あり")}}
      <tr class="sec-row">
        <td colspan="2">
          旧　合　意・過　去　利　用
          <span class="sec-ref">旧契約等の統合</span>
        </td>
      </tr>
      <tr>
        <td colspan="2" class="retroactive-cell">
          {{#if 旧合意過去利用取扱い}}{{旧合意過去利用取扱い}}{{else}}1.許諾者および被許諾者は、本条件書に定める対象著作物および許諾内容に関し、本条件書締結日以前に両当事者間で成立した契約、覚書、条件書、発注書、申込書、請求書、電子メール、チャット、口頭合意、黙示の合意、取引慣行その他形式を問わない一切の合意および取決め（以下「旧契約等」という。）について、本条件書および基本契約に統合されることを確認する。<br><br>2.本条件書、基本契約および旧契約等の内容が相互に矛盾または抵触する場合、本条件書、基本契約、旧契約等の順に優先して適用されるものとする。<br><br>3.前二項にかかわらず、本条件書に明示されていない商品化、映像化、デジタルゲーム化その他の追加利用については、本特約により当然に許諾または統合されるものではなく、当事者間で別途書面または電磁的方法により合意した場合に限り許諾される。{{/if}}
        </td>
      </tr>
      {{/if}}

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

      <!-- ===== 特記事項 ===== -->
      <tr class="sec-row"><td colspan="2">特　記　事　項</td></tr>
      <tr>
        <td colspan="2" class="special-cell">{{特記事項}}</td>
      </tr>

    </tbody>
  </table>

  <p class="closing-note">本個別契約に定めのない事項については、基本契約の定めによるものとする。</p>
  <p class="closing-text">本個別契約の成立を証するため、本書の電磁的記録を作成し、許諾者と被許諾者が合意後、電子署名を施し、各自その電磁的記録を保管する。ただし、書面により締結する場合は本書２通を作成し、記名押印の上各１通を保有する。</p>

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
        <div class="party-label">被　許　諾　者</div>
        <div>{{アークライト住所}}</div>
        <div>株式会社アークライト</div>
        <div class="sig-name-row">
          <span>代表取締役　{{アークライト代表者氏名}}</span>
          <span class="stamp-box">印</span>
        </div>
      </div>
    </div>
  </div>

</div>
</body>
</html>$html_pub_license_terms$, $schema_pub_license_terms$[{"name": "条件書番号", "label": "条件書番号", "group": "I. 基本情報", "dbField": "auto.docNumber", "helpText": "生成時に自動採番されます (ARC-PUBT-YYYY-NNNN)"}, {"name": "基本契約番号", "label": "基本契約番号", "group": "I. 基本情報", "placeholder": "ARC-PUB-2026-0001", "helpText": "紐づく出版基本契約の契約番号"}, {"name": "締結日", "label": "締結日", "group": "I. 基本情報", "required": true, "placeholder": "例: 2026年5月12日"}, {"name": "基本契約締結日", "label": "基本契約 締結日", "group": "I. 基本情報", "placeholder": "例: 2026年4月1日", "helpText": "前文に表示"}, {"name": "許諾者", "label": "許諾者 名称 (氏名/法人名)", "group": "I. 基本情報", "required": true, "dbField": "vendor.vendor_name"}, {"name": "許諾者住所", "label": "許諾者 住所", "group": "I. 基本情報", "type": "textarea", "dbField": "vendor.address"}, {"name": "許諾者種別", "label": "許諾者 種別 (支払日: 法人=末日 / 個人=20日)", "group": "I. 基本情報", "type": "select", "options": ["法人", "個人"], "helpText": "支払時期の支払日 (個人=20日 / 法人=末日) を固定文言に反映します"}, {"name": "許諾開始日", "label": "許諾開始日", "group": "II. 許諾期間", "type": "date"}, {"name": "許諾終了日", "label": "許諾終了日", "group": "II. 許諾期間", "type": "date"}, {"name": "自動更新有無", "label": "自動更新", "group": "II. 許諾期間", "type": "select", "options": ["あり", "なし"]}, {"name": "更新単位", "label": "更新単位", "group": "II. 許諾期間", "placeholder": "例: 1年"}, {"name": "終了通知期限", "label": "終了通知期限", "group": "II. 許諾期間", "placeholder": "例: 期間満了3か月前"}, {"name": "原著作物名", "label": "原著作物名 (原作選択で自動入力)", "group": "III. 対象著作物", "required": true, "readonly": true, "helpText": "上部「0. 原作 (原作マスタ)」で原作を選ぶと正式名称が自動入力されます"}, {"name": "対象出版物名", "label": "対象出版物名", "group": "III. 対象著作物", "required": true}, {"name": "著作者名", "label": "著作者名", "group": "III. 対象著作物", "type": "textarea", "required": true, "helpText": "共著の場合は改行または読点（、）区切りで複数記載できます"}, {"name": "著作権者", "label": "著作権者", "group": "III. 対象著作物", "type": "textarea", "helpText": "共有の場合は複数記載できます"}, {"name": "共同著作第三者権利有無", "label": "共同著作・第三者権利の有無", "group": "III. 対象著作物", "type": "select", "options": ["あり", "なし"]}, {"name": "権利関係備考", "label": "権利関係 備考", "group": "III. 対象著作物", "type": "textarea"}, {"name": "電子書籍配信許諾有無", "label": "電子書籍配信 許諾", "group": "IV. 許諾内容", "type": "select", "options": ["許諾する", "許諾しない"], "helpText": "「許諾しない」の場合は条件・計算式・支払欄を非表示にします"}, {"name": "電子書籍配信条件", "label": "電子書籍配信 条件", "group": "IV. 許諾内容", "type": "textarea", "helpText": "未入力かつ許諾する場合は「主要電子書籍ストアにて配信。DRM 適用」が入ります"}, {"name": "翻訳海外版許諾有無", "label": "翻訳版・海外版 許諾", "group": "IV. 許諾内容", "type": "select", "options": ["許諾する", "許諾しない"], "helpText": "「許諾しない」の場合は地域・言語の括弧書きや計算式を非表示にします"}, {"name": "翻訳海外版対象地域言語", "label": "翻訳版・海外版 対象地域・言語", "group": "IV. 許諾内容"}, {"name": "許諾地域", "label": "許諾地域", "group": "V. 出版条件", "placeholder": "例: 日本国内"}, {"name": "許諾言語", "label": "言語", "group": "V. 出版条件", "placeholder": "例: 日本語"}, {"name": "販売形態", "label": "販売形態", "group": "V. 出版条件", "placeholder": "例: 紙書籍／電子書籍／EC販売", "helpText": "未入力なら「紙書籍：小売店販売／EC販売／イベント販売／その他」(電子書籍=許諾する場合は電子書籍も追加) が入ります"}, {"name": "紙媒体計算式", "label": "紙媒体 印税計算式", "group": "VI. 対価・支払条件", "type": "textarea", "placeholder": "例: 税抜定価 × 印税対象部数 × 料率", "helpText": "未入力なら「税抜定価 × 印税対象部数 × 料率（紙書籍印税率％）」が入ります"}, {"name": "紙書籍印税率", "label": "紙書籍 印税率 (%)", "group": "VI. 対価・支払条件", "placeholder": "10", "helpText": "利用許諾計算書の算定に使用します"}, {"name": "紙媒体印税対象部数区分", "label": "紙媒体 印税対象部数区分", "group": "VI. 対価・支払条件", "placeholder": "例: 実売部数 / 刷部数"}, {"name": "電子書籍計算式", "label": "電子書籍 印税計算式", "group": "VI. 対価・支払条件", "type": "textarea", "placeholder": "例: 税抜定価 × ダウンロード数 × 料率", "helpText": "未入力かつ許諾する場合は「税抜定価 × ダウンロード数 × 料率（電子書籍印税率％）」が入ります"}, {"name": "電子書籍印税率", "label": "電子書籍 印税率/料率 (%)", "group": "VI. 対価・支払条件", "helpText": "利用許諾計算書の算定に使用します"}, {"name": "翻訳海外版計算式", "label": "翻訳・海外版 計算式", "group": "VI. 対価・支払条件", "type": "textarea", "helpText": "未入力かつ許諾する場合は「被許諾者受取ライセンス収益 × 料率」が入ります"}, {"name": "翻訳海外版料率", "label": "翻訳・海外版 料率 (%)", "group": "VI. 対価・支払条件", "helpText": "利用許諾計算書の算定に使用します"}, {"name": "報告明細", "label": "報告明細", "group": "VI. 対価・支払条件", "type": "textarea", "helpText": "未入力なら「利用形態別の数量・単価・金額を記載した報告書を提出」が入ります"}, {"name": "消費税区分", "label": "消費税区分", "group": "VI. 対価・支払条件", "placeholder": "例: 外税10%"}, {"name": "源泉徴収有無", "label": "源泉徴収", "group": "VI. 対価・支払条件", "type": "select", "options": ["あり", "なし"]}, {"name": "インボイス登録番号", "label": "インボイス登録番号 (T-)", "group": "VI. 対価・支払条件", "dbField": "vendor.invoice_registration_number"}, {"name": "振込先銀行名", "label": "金融機関名", "group": "VII. 振込口座", "dbField": "vendor.bank_name"}, {"name": "支店名", "label": "支店名", "group": "VII. 振込口座", "dbField": "vendor.branch_name"}, {"name": "口座種別", "label": "口座種別", "group": "VII. 振込口座", "type": "select", "options": ["普通", "当座"], "dbField": "vendor.account_type"}, {"name": "口座番号", "label": "口座番号", "group": "VII. 振込口座", "dbField": "vendor.account_number"}, {"name": "口座名義カナ", "label": "口座名義 (カナ)", "group": "VII. 振込口座", "dbField": "vendor.account_holder_kana"}, {"name": "第三者IP関与有無", "label": "第三者IPの関与", "group": "VIII. 第三者IP・著作権表示", "type": "select", "options": ["あり", "なし"]}, {"name": "著作権表示", "label": "著作権表示 内容", "group": "VIII. 第三者IP・著作権表示", "type": "textarea"}, {"name": "表示位置補足", "label": "表示位置・補足", "group": "VIII. 第三者IP・著作権表示", "type": "textarea"}, {"name": "旧合意有無", "label": "旧合意・過去利用の統合", "group": "IX. 旧合意・特記", "type": "select", "options": ["なし", "あり"], "helpText": "「あり」を選ぶと旧契約等の統合条項を本条件書に記載します"}, {"name": "旧合意過去利用取扱い", "label": "旧合意・過去利用の取扱い (任意・上書き)", "group": "IX. 旧合意・特記", "type": "textarea", "helpText": "空欄かつ「あり」の場合は標準の統合条項が自動で入ります"}, {"name": "特記事項", "label": "特記事項", "group": "IX. 旧合意・特記", "type": "textarea", "helpText": "削除した刊行期限・発行予定日など必要な事項はこちらに記載"}, {"name": "アークライト住所", "label": "アークライト 住所", "group": "X. アークライト", "type": "textarea", "helpText": "[自社] ボタンで自動入力", "dbField": "company.address"}, {"name": "アークライト代表者氏名", "label": "アークライト 代表者氏名", "group": "X. アークライト", "dbField": "company.rep"}, {"name": "許諾者担当者", "type": "text", "label": "許諾者 担当者", "group": "8. 通知先 (許諾者)", "helpText": "通知先の担当者(相手方)"}, {"name": "許諾者電話", "type": "text", "label": "許諾者 電話", "group": "8. 通知先 (許諾者)"}, {"name": "許諾者メール", "type": "text", "label": "許諾者 メール", "group": "8. 通知先 (許諾者)"}]$schema_pub_license_terms$::jsonb, '通知先セクション+短い通知条文を追加 (0050)', 'migration-0050'
    FROM t RETURNING id, template_id)
UPDATE document_templates dt SET current_version_id=nv.id, updated_at=now() FROM nv WHERE dt.id=nv.template_id;

-- ===== purchase_order =====
WITH t AS (SELECT id FROM document_templates WHERE template_key='purchase_order'), nv AS (
  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  SELECT t.id, COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id=t.id),0)+1,
         $html_purchase_order$<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>発注書</title>
  <style>
    @page { size: A4; margin: 12mm 15mm; }

    * { box-sizing: border-box; }
    body {
      font-family: "Noto Sans CJK JP", "Noto Sans JP", "IPAexGothic", "IPAGothic", sans-serif;
      font-size: 10pt;
      line-height: 1.5;
      color: #111;
      margin: 0;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2px solid #111;
      padding-bottom: 6px;
      margin-bottom: 14px;
    }

    .title-box h1 {
      font-size: 20pt;
      margin: 0;
      letter-spacing: 1.5px;
    }

    .doc-info {
      text-align: right;
      font-size: 9pt;
      line-height: 1.6;
      color: #555;
      white-space: nowrap;
    }

    .party-grid {
      display: table;
      width: 100%;
      table-layout: fixed;
      margin-bottom: 10px;
    }

    .vendor-section {
      display: table-cell;
      vertical-align: top;
      font-size: 10pt;
      min-width: 0;
      padding-right: 12px;
    }

    .vendor-name {
      font-size: 13pt;
      font-weight: 800;
      border-bottom: 1px solid #111;
      display: inline-block;
      min-width: 0;
      width: 100%;
      max-width: 100%;
      padding-bottom: 2px;
    }

    .company-section {
      display: table-cell;
      vertical-align: top;
      font-size: 9pt;
      background: #fafafa;
      padding: 10px;
      border: 1px solid #cfcfcf;
      overflow-wrap: anywhere;
      width: 300px;
      margin-top: 2px;
    }

    .section-mark {
      color: #111;
      padding: 2px 0 2px 10px;
      font-weight: 800;
      font-size: 10pt;
      margin-top: 12px;
      margin-bottom: 6px;
      display: inline-block;
      border-left: 4px solid #111;
    }

    table.summary,
    table.items,
    table.sign-table {
      width: 100%;
      border-collapse: collapse;
    }

    table.summary {
      margin-bottom: 12px;
      font-size: 10pt;
    }

    table.summary th,
    table.summary td,
    table.items th,
    table.items td,
    table.sign-table th,
    table.sign-table td {
      border: 1px solid #cfcfcf;
      padding: 7px 8px;
      vertical-align: top;
    }

    table.summary th,
    table.sign-table th,
    table.items th {
      background: #f3f3f3;
      text-align: left;
    }

    table.summary th {
      width: 26%;
    }

    table.items {
      margin-top: 4px;
      font-size: 9pt;
    }

    table.items th {
      text-align: center;
      font-weight: 800;
    }

    .right { text-align: right; }
    .center { text-align: center; }

    .item-name-block {
      font-weight: 800;
      font-size: 10pt;
      margin-bottom: 3px;
      display: inline-block;
    }

    .item-spec-block {
      font-size: 8.5pt;
      color: #555;
      white-space: pre-wrap;
      line-height: 1.4;
    }

    /* Phase 17n / 22.8.1 / 22.21.53 / 22.21.58: 仕様を独立した「明細詳細行」
       として描画。これにより仕様の文章量が多くても narrow 列 (数量・単価等)
       が縦方向に間延びしない。
       Phase 22.21.58: 旧 <td></td><td colspan="7"> の 2 セル構成では No 列下に
       空の小さなセルが残って境界線が「切れて」見えていた問題を解消するため、
       template 側を <td colspan="8"> の単一セルに統一。CSS で左パディングを
       業務内容列の開始位置に揃える。 */
    table.items tr.detail-row > td {
      border-top: 0;          /* 直前の本行と継続的に見える */
      border-left: 1px solid #cfcfcf;   /* 外枠は普通の table border を踏襲 */
      border-right: 1px solid #cfcfcf;
      padding-top: 0;
      padding-bottom: 6px;
      /* 左パディングを No 列幅 (6mm) + 業務内容列の通常パディング (8px) に
         合わせて、品目名の文字位置から自然につながるよう揃える。 */
      padding-left: calc(6mm + 8px);
      padding-right: 8px;
    }
    table.items tr.detail-row .detail-cell {
      background: transparent;
      border-left: none;
      padding: 0;
      font-size: 8.5pt;
      color: #333;
      white-space: pre-wrap;
      line-height: 1.35;
    }
    /* 本行と詳細行は連続したものなので、間の境界線を消す。
       次の明細との境界は次行 (`tr` 単体) の border-bottom で確保される。 */
    table.items tr.has-detail > td {
      border-bottom: 0;
    }
    table.items tr.detail-row .item-spec-block {
      font-size: 8.5pt;
      color: #333;
      line-height: 1.35;
      white-space: pre-wrap;
    }

    .pay-method-badge {
      display: inline-block;
      font-size: 7.5pt;
      padding: 2px 6px;
      border-radius: 2px;
      font-weight: 800;
      border: 1px solid #111;
      background: #fff;
      color: #111;
      white-space: nowrap;
    }

    .category-label {
      display: inline-block;
      font-size: 7.5pt;
      padding: 1px 5px;
      border: 1px solid #cfcfcf;
      background: #fff;
      border-radius: 2px;
      color: #111;
      white-space: nowrap;
      margin-right: 4px;
      margin-bottom: 4px;
    }

    .amount-note,
    .small-muted {
      font-size: 8.5pt;
      color: #555;
    }

    .total-amount {
      font-size: 13pt;
      font-weight: 900;
      letter-spacing: 0.2px;
    }

    .terms-section,
    .callout {
      margin-top: 12px;
      font-size: 9pt;
      border: 1px solid #cfcfcf;
      background: #fff;
    }

    .terms-section {
      padding: 10px;
    }

    .terms-title {
      font-weight: 900;
      margin-bottom: 6px;
      border-bottom: 1px solid #111;
      padding-bottom: 3px;
    }

    .callout {
      border-left: 4px solid #111;
      padding: 8px 10px;
    }

    .sign-box {
      height: 22mm;
      border: 1px dashed #cfcfcf;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="header-row">
    <div class="title-box">
      <h1>発 注 書</h1>
      {{!-- Phase 22.10: 再発行版バナー。
           Phase 22.11.2: showReissueBanner=false なら表示しない (社内修正版を
           対外的には初版に見せたい場合)。default は表示。
           Phase 23.1: 条件を isReissue (生成瞬間のみ true) から (gt REVISION 0)
           に変更。再発行版 PDF を後日再生成しても Rev. N が継続表示される。 --}}
      {{#if (gt REVISION 0)}}
      {{#unless (eq showReissueBanner false)}}
      <div style="display:inline-block; margin-top:4px; padding:2px 8px; background:#fff3cd; border:1px solid #ffc107; color:#856404; font-size:9pt; font-weight:bold;">
        修正版 Rev. {{REVISION}} — 元発注書: {{BASE_DOC_NO}}
      </div>
      {{/unless}}
      {{/if}}
    </div>
    <div class="doc-info">
      発注番号: <strong>{{ORDER_NO}}</strong><br>
      {{#if isReissue}}
      {{#unless (eq showReissueBanner false)}}
      <span style="font-size:8pt; color:#666;">(元: {{BASE_DOC_NO}})</span><br>
      {{/unless}}
      {{/if}}
      発行日: {{formatDate (or ORDER_DATE (concat ORDER_DATE_YEAR "-" ORDER_DATE_MONTH "-" ORDER_DATE_DAY))}}
    </div>
  </div>

  <div class="party-grid">
    <div class="vendor-section">
      <div class="vendor-name">{{VENDOR_NAME}}{{#if VENDOR_SUFFIX}} {{VENDOR_SUFFIX}}{{/if}}</div>
      {{#if VENDOR_REPRESENTATIVE_SAMA}}
      <div style="margin-top:6px; font-size:9pt;">{{VENDOR_REPRESENTATIVE_SAMA}}</div>
      {{/if}}
      {{#if VENDOR_ADDRESS}}
      <div style="margin-top:8px; font-size:9pt; color:#555;">{{VENDOR_ADDRESS}}</div>
      {{/if}}
      {{#if VENDOR_EMAIL}}
      <div style="margin-top:4px; font-size:9pt; color:#555;">E-mail: {{VENDOR_EMAIL}}</div>
      {{/if}}
      {{#if VENDOR_CONTACT_NAME}}
      <div style="margin-top:6px; font-size:9pt;">
        {{#if VENDOR_CONTACT_DEPARTMENT}}{{VENDOR_CONTACT_DEPARTMENT}} {{/if}}{{VENDOR_CONTACT_NAME}} 様
      </div>
      {{/if}}
      <div style="margin-top:10px;">下記内容にて発注いたします。ご確認をお願いいたします。</div>
      <div style="margin-top:14px; font-size:10pt;">件名: <strong>{{PROJECT_TITLE}}</strong></div>
    </div>

    <div class="company-section">
      <div style="font-size:8pt; font-weight:800; color:#555; margin-bottom:4px;">発注者</div>
      <div style="font-weight:900; font-size:12pt; margin-bottom:5px;">{{PARTY_A_NAME}}</div>
      <div style="white-space: pre-wrap;">{{PARTY_A_ADDRESS}}</div>
      <div style="margin-top:2px;">{{PARTY_A_REP}}</div>
      {{#if STAFF_NAME}}
      <div style="margin-top:8px; padding-top:6px; border-top:1px dashed #cfcfcf; font-size:9pt;">
        {{#if STAFF_DEPARTMENT}}<strong>部署:</strong> {{STAFF_DEPARTMENT}}<br>{{/if}}
        <strong>担当:</strong> {{STAFF_NAME}}<br>
        {{#if STAFF_PHONE}}TEL: {{STAFF_PHONE}}<br>{{/if}}
        {{#if STAFF_EMAIL}}E-mail: {{STAFF_EMAIL}}{{/if}}
      </div>
      {{/if}}
    </div>
  </div>

  <div class="section-mark">■ 発注概要</div>
  <table class="summary">
    <tr>
      <th>発注合計金額（税抜）</th>
      <td>
        <div class="total-amount">¥ {{formatCurrency grandTotalExTax}}</div>
        <div class="amount-note">※ 消費税等の精算は、支払通知または請求処理にて行います。</div>
      </td>
    </tr>
    {{!-- Phase 22.21.30: 発注日 行を追加。
         formData.発注日 / order_date が空のときは「発行日」へ fallback、
         それも空なら "—" 表示。 --}}
    <tr>
      <th>発注日</th>
      <td>{{#if 発注日}}{{発注日}}{{else}}{{#if order_date}}{{order_date}}{{else}}{{#if 発行日}}{{発行日}}{{else}}—{{/if}}{{/if}}{{/if}}</td>
    </tr>
    <tr>
      <th>納期<br><span style="font-size:8pt;color:#888;font-weight:400;">(または役務提供期間)</span></th>
      <td>{{or summaryDeliveryDate "—"}}</td>
    </tr>
    <tr>
      <th>支払日</th>
      {{!-- Phase 22.7: 明細から自動集計した summaryPaymentDate を表示。
           後方互換のため、空のときは旧 summaryPaymentTerms にフォールバック。 --}}
      <td>{{or summaryPaymentDate summaryPaymentTerms "—"}}</td>
    </tr>
  </table>

  <div class="section-mark">■ 業務明細</div>
  <table class="items">
    <thead>
      <tr>
        <th style="width:6mm;">No</th>
        <th>業務内容・成果物</th>
        <th style="width:18mm;">支払方法</th>
        <th style="width:22mm;">納期</th>
        <th style="width:22mm;">支払日</th>
        <th style="width:13mm;">数量</th>
        <th style="width:20mm;">単価</th>
        <th style="width:22mm;">金額（税抜）</th>
      </tr>
    </thead>
    <tbody>
      {{#if items}}
      {{#each items}}
      {{!-- Phase 17n: 仕様の文章量に影響されず narrow 列が間延びしないよう、
           本行（数値・日付など）と仕様詳細行を分けて描画。 --}}
      {{!-- Phase 17n: spec か detailText があるときだけ detail-row を表示 --}}
      <tr class="{{#if (or spec detailText)}}has-detail{{/if}}">
        <td class="center">{{or line_no (index1 @index)}}</td>
        <td>
          {{#if category}}<span class="category-label">{{category}}</span>{{/if}}
          <div class="item-name-block">{{item_name}}</div>
        </td>
        <td class="center">
          {{!-- Phase 13: 計算方式バッジ + 支払条件
               Phase 22.8: SUBSCRIPTION は周期ラベル "月次" 等を補足表示 --}}
          <span class="pay-method-badge">{{or calc_method payment_method_display payment_method "FIXED"}}</span>
          {{#if (eq calc_method "SUBSCRIPTION")}}
          <div style="font-size:7pt; color:#666; margin-top:2px;">{{cycleLabel cycle}}</div>
          {{else}}
          {{#if payment_terms}}
          <div style="font-size:7pt; color:#666; margin-top:2px;">{{payment_terms}}</div>
          {{else}}
          {{#if payment_method}}
          <div style="font-size:7pt; color:#666; margin-top:2px;">{{payment_method}}</div>
          {{/if}}
          {{/if}}
          {{/if}}
        </td>
        {{!-- Phase 17h: 業務明細ごとの納期 (delivery_date) と支払日 (payment_date) を別列で
             Phase 22.8: SUBSCRIPTION のときは納期=支払日サマリ ("毎月25日") /
                         支払日=期間サマリ ("2026/01/01 〜 2026/12/31") に切替 --}}
        <td class="center">
          {{#if (eq calc_method "SUBSCRIPTION")}}
            {{billingDayLabel billing_day cycle}}
          {{else}}
            {{formatDate delivery_date}}
          {{/if}}
        </td>
        <td class="center">
          {{#if (eq calc_method "SUBSCRIPTION")}}
            {{!-- Phase 22.8.1: 期間はコンパクト日付 (2026/04/01) で 1 行ずつ。
                 折返し時も "〜" を独立行に出さないよう nowrap で各端日付を確保。 --}}
            <div style="font-size:8pt; line-height:1.4; white-space:nowrap;">
              {{#if term_start}}{{formatDateCompact term_start}}{{else}}—{{/if}}
            </div>
            <div style="font-size:7pt; color:#999; line-height:1; margin:1px 0;">〜</div>
            <div style="font-size:8pt; line-height:1.4; white-space:nowrap;">
              {{#if term_end}}{{formatDateCompact term_end}}{{else}}<span style="color:#666;">継続中</span>{{/if}}
            </div>
          {{else}}
            {{formatDate payment_date}}
          {{/if}}
        </td>
        <td class="right">{{or quantity qty}}</td>
        <td class="right">{{formatYen (or unit_price unitPrice)}}</td>
        <td class="right">{{formatYen (or amount_ex_tax amount)}}</td>
      </tr>
      {{#if (or spec detailText)}}
      {{!-- Phase 17n / 22.8.1 / 22.21.53 / 22.21.58: 仕様 / 詳細行。
           本行 (.has-detail) と border を共有して同じ明細の一部に見せる。
           Phase 22.21.58: 旧 2-cell 構成 (空 td + colspan=7) では No 列下に
           空セルが残って境界線が分断されていた問題を解消するため、
           colspan=8 の単一セルに統一。CSS の padding-left で業務内容列の
           開始位置に文字を揃える。 --}}
      <tr class="detail-row">
        <td colspan="8">
          <div class="detail-cell">
            {{#if spec}}<div class="item-spec-block">{{spec}}</div>{{/if}}
            {{#if detailText}}<div class="item-spec-block"{{#if spec}} style="margin-top:2px;"{{/if}}>{{detailText}}</div>{{/if}}
          </div>
        </td>
      </tr>
      {{/if}}
      {{#if payment_schedule}}
      <tr class="detail-row">
        <td colspan="8">
          <div class="detail-cell">
            <div style="font-weight:700;margin-bottom:2px;">支払スケジュール</div>
            <table style="width:100%;border-collapse:collapse;font-size:8.5pt;">
              <tr><th style="text-align:left;width:8%;">回</th><th style="text-align:left;">支払予定日</th><th style="text-align:right;width:30%;">金額</th></tr>
              {{#each payment_schedule}}
              <tr>
                <td style="text-align:center;">{{index1 @index}}</td>
                <td>{{date}}</td>
                <td style="text-align:right;">{{#if amount}}{{formatYen amount}}{{/if}}</td>
              </tr>
              {{/each}}
            </table>
          </div>
        </td>
      </tr>
      {{/if}}
      {{/each}}
      {{else}}
      {{!-- 単一明細フォールバック (items[] が空のとき) — Phase 13: CALC_METHOD + PAYMENT_TERMS 統一 --}}
      <tr>
        <td class="center">1</td>
        <td><div class="item-name-block">{{ITEM_NAME}}</div></td>
        <td class="center">
          <span class="pay-method-badge">{{or CALC_METHOD PAYMENT_METHOD "FIXED"}}</span>
          {{#if PAYMENT_TERMS}}
          <div style="font-size:7pt; color:#666; margin-top:2px;">{{PAYMENT_TERMS}}</div>
          {{else}}
          {{#if PAYMENT_METHOD}}
          <div style="font-size:7pt; color:#666; margin-top:2px;">{{PAYMENT_METHOD}}</div>
          {{/if}}
          {{/if}}
        </td>
        <td class="center">{{formatDate DELIVERY_DATE}}</td>
        <td class="center">{{summaryPaymentTerms}}</td>
        <td class="right">1</td>
        <td class="right">-</td>
        <td class="right">¥ {{formatCurrency grandTotalExTax}}</td>
      </tr>
      {{/if}}
      <tr>
        <td colspan="7" class="right"><strong>業務委託 小計（税抜)</strong></td>
        <td class="right"><strong>¥ {{formatCurrency (or itemsSubtotalExTax grandTotalExTax)}}</strong></td>
      </tr>
    </tbody>
  </table>

  {{!-- Phase 22.21.56: その他手数料 (税抜・合計に加算)。コーディネート費・
       振込手数料 等、業務委託報酬とは別の手数料項目。経費 (税込・別精算) とは
       明確に区別され、本表の合計 grandTotalExTax に加算済み。 --}}
  {{#if other_fees}}
  {{#if (gt (length other_fees) 0)}}
  <div class="section-mark">■ その他手数料（税抜・合計に加算）</div>
  <table class="items">
    <thead>
      <tr>
        <th style="width:6mm;">No</th>
        <th>項目名</th>
        <th style="width:30mm;">金額（税抜）</th>
        <th>摘要</th>
      </tr>
    </thead>
    <tbody>
      {{#each other_fees}}
      <tr>
        <td class="center">{{or line_no (index1 @index)}}</td>
        <td><div class="item-name-block">{{fee_name}}</div></td>
        <td class="right">{{formatYen amount}}</td>
        <td>{{remarks}}</td>
      </tr>
      {{/each}}
      <tr>
        <td colspan="2" class="right"><strong>手数料 小計（税抜)</strong></td>
        <td class="right"><strong>¥ {{formatCurrency otherFeesTotal}}</strong></td>
        <td></td>
      </tr>
    </tbody>
  </table>

  {{!-- 合計 (業務委託 + その他手数料) を再掲。上部「発注概要」テーブルの
       合計とも一致するが、明細表 + 手数料表 の直後に再表示することで読み手が
       支払総額をすぐ把握できる。 --}}
  <table class="summary" style="margin-top:6px;">
    <tr>
      <th>発注合計（税抜・業務委託 + 手数料）</th>
      <td>
        <div class="total-amount">¥ {{formatCurrency grandTotalExTax}}</div>
        <div class="amount-note">
          ※ 業務委託 ¥{{formatCurrency (or itemsSubtotalExTax grandTotalExTax)}}
          ＋ 手数料 ¥{{formatCurrency otherFeesTotal}}
        </div>
      </td>
    </tr>
  </table>
  {{/if}}
  {{/if}}

  {{!-- Phase 17i: 経費 (交通費等・税込み額表示) --}}
  {{#if expenses}}
  {{#if (gt (length expenses) 0)}}
  <div class="section-mark">■ 経費（交通費等／税込み額）</div>
  <table class="items">
    <thead>
      <tr>
        <th style="width:6mm;">No</th>
        <th>費目</th>
        <th style="width:24mm;">発生日</th>
        <th style="width:26mm;">金額（税込）</th>
        <th>摘要</th>
      </tr>
    </thead>
    <tbody>
      {{#each expenses}}
      <tr>
        <td class="center">{{or line_no (index1 @index)}}</td>
        <td>
          <div class="item-name-block">{{expense_name}}</div>
          {{#if spec}}<div class="item-spec-block">{{spec}}</div>{{/if}}
        </td>
        <td class="center">{{formatDate spent_date}}</td>
        <td class="right">{{formatYen amount_inc_tax}}</td>
        <td>{{remarks}}</td>
      </tr>
      {{/each}}
      <tr>
        <td colspan="3" class="right"><strong>経費合計（税込)</strong></td>
        <td class="right"><strong>¥ {{formatCurrency expensesTotalIncTax}}</strong></td>
        <td></td>
      </tr>
    </tbody>
  </table>
  <div class="small-muted" style="margin-top:4px;">※ 経費は税込み額にて精算します。本発注書に記載の各項目の領収書原本またはそのコピーを添付してください。</div>
  {{/if}}
  {{/if}}

  {{#if SPECIAL_TERMS}}
  <div class="terms-section">
    <div class="terms-title">特約事項</div>
    <div style="white-space: pre-wrap;">{{SPECIAL_TERMS}}</div>
  </div>
  {{/if}}

  {{#if REMARKS}}
  <div class="terms-section">
    <div class="terms-title">備考</div>
    {{#if REMARKS_FIXED}}
    <div style="white-space: pre-wrap;">{{REMARKS_FIXED}}</div>
    {{/if}}
    {{#if REMARKS_FREE}}
    <div style="white-space: pre-wrap; margin-top:{{#if REMARKS_FIXED}}8px{{else}}0{{/if}};">{{REMARKS_FREE}}</div>
    {{/if}}
  </div>
  {{/if}}

  {{#if HAS_BASE_CONTRACT}}
  <div class="callout">
    <strong>準拠契約:</strong> 本発注書は、甲乙間で締結済みの基本契約（{{MASTER_CONTRACT_REF}}）に基づき発行されるものであり、
    本発注書に定めのない事項については当該基本契約の定めによるものとします。
  </div>
  {{else}}
  <div class="callout">
    <strong>適用約款:</strong> 本発注書には別紙「業務委託基本契約約款（スポット契約用・2026年改正法対応版）」が適用されます。
    受注者は本発注書を承諾することにより、当該約款にも同意したものとみなします。
  </div>
  {{/if}}

  {{#if BANK_NAME}}
  <div class="terms-section">
    <div class="terms-title">支払先情報</div>
    <table class="summary" style="margin-bottom:6px;">
      <tr><th>金融機関</th><td>{{BANK_NAME}} {{BRANCH_NAME}}</td></tr>
      <tr><th>口座</th><td>{{ACCOUNT_TYPE}} {{ACCOUNT_NUMBER}}</td></tr>
      <tr><th>口座名義</th><td>{{ACCOUNT_HOLDER_KANA}}</td></tr>
      {{#if INVOICE_REGISTRATION_NUMBER}}
      <tr><th>適格請求書発行事業者</th><td>登録番号: T{{INVOICE_REGISTRATION_NUMBER}}</td></tr>
      {{/if}}
    </table>
    {{#if TRANSFER_FEE_PAYER}}
    <div class="small-muted">※ 振込手数料: {{TRANSFER_FEE_PAYER}}負担</div>
    {{/if}}
  </div>
  {{else}}
  {{#if BANK_INFO}}
  <div class="terms-section">
    <div class="terms-title">支払先情報</div>
    <div style="white-space: pre-wrap;">{{BANK_INFO}}</div>
    {{#if TRANSFER_FEE_PAYER}}
    <div class="small-muted" style="margin-top:4px;">※ 振込手数料: {{TRANSFER_FEE_PAYER}}負担</div>
    {{/if}}
  </div>
  {{/if}}
  {{/if}}

  {{#if SHOW_ORDER_SIGN_SECTION}}
  <div class="section-mark">■ 通知先</div>
  <table class="summary">
    <tr>
      <th style="width:30%;">発注先（受注者）</th>
      <td>担当：{{VENDOR_CONTACT_NAME}}　／　TEL：{{VENDOR_CONTACT_PHONE}}　／　E-mail：{{VENDOR_EMAIL}}</td>
    </tr>
    <tr>
      <th>発注元（当社）</th>
      <td>担当：{{STAFF_NAME}}　／　TEL：{{STAFF_PHONE}}　／　E-mail：{{STAFF_EMAIL}}</td>
    </tr>
  </table>
  <div style="margin-top:6px; font-size:9pt; color:#555;">本発注に関する通知その他の連絡は、上記の通知先に対して行うものとします。基本契約がある場合は、その通知条項に従います。</div>

  <div class="section-mark">■ 署名欄</div>
  <table class="sign-table" style="margin-top: 6px;">
    <tr>
      <th style="width:50%;">発注者（甲）</th>
      <th style="width:50%;">受注者（乙）</th>
    </tr>
    <tr>
      <td>
        <div>{{PARTY_A_NAME}}</div>
        <div class="small-muted">{{PARTY_A_ADDRESS}}</div>
        <div style="margin-top:4px;">{{PARTY_A_REP}}</div>
        <div class="sign-box"></div>
      </td>
      <td>
        <div>{{VENDOR_NAME}}</div>
        <div class="small-muted">{{VENDOR_ADDRESS}}</div>
        <div style="margin-top:4px;">{{#if VENDOR_REPRESENTATIVE_SAMA}}{{VENDOR_REPRESENTATIVE_SAMA}}{{else}}{{VENDOR_CONTACT_NAME}}{{/if}}</div>
        <div class="sign-box"></div>
      </td>
    </tr>
  </table>
  {{/if}}

  {{!-- Phase 17l: 承諾セクションは ACCEPT_METHOD と SHOW_SIGN_SECTION を
       それぞれ独立に評価する。これまでは SHOW_SIGN_SECTION が ACCEPT_METHOD
       の {{#if}} 配下にネストされていたため、ユーザーが「承諾署名欄を表示」
       を TRUE にしても、承諾方法が空だと署名欄ごと消えてしまっていた。 --}}
  {{#if (or ACCEPT_METHOD SHOW_SIGN_SECTION)}}
  <div class="section-mark">■ 受領確認（承諾）</div>
  {{#if ACCEPT_METHOD}}
  <div class="callout">
    <div style="font-weight:900;">承諾方法</div>
    <div class="small-muted">
      {{ACCEPT_METHOD}}
      {{#if ACCEPT_REPLY_DUE_DATE}}<br>返信期限: {{ACCEPT_REPLY_DUE_DATE}}{{/if}}
    </div>
    {{#if ACCEPT_BY_PERFORMANCE}}
    <div class="small-muted" style="margin-top:6px;">
      なお、受注者が本発注に基づく業務へ着手した場合、その時点で本発注内容に承諾したものとして取り扱うことがあります。
    </div>
    {{/if}}
  </div>
  {{/if}}
  {{#if SHOW_SIGN_SECTION}}
  <table class="sign-table" style="margin-top: 6px;">
    <tr>
      <th style="width:30%;">受領日（承諾日）</th>
      <td>{{formatDate VENDOR_ACCEPT_DATE}}</td>
    </tr>
    {{!-- Phase 22.21.44: 取引先が法人 (VENDOR_IS_CORPORATION='法人') のときは
         会社名を 受領者署名行の前に自動表示する。VENDOR_NAME はフォームの
         [取引先] ボタンで vendor マスタから自動補完される。
         個人事業主の場合はこの行を省略し、氏名のみで完結させる。 --}}
    {{#if (eq VENDOR_IS_CORPORATION "法人")}}
    <tr>
      <th>会社名（受注者）</th>
      <td>{{VENDOR_NAME}}{{#if VENDOR_SUFFIX}} {{VENDOR_SUFFIX}}{{/if}}</td>
    </tr>
    {{/if}}
    <tr>
      <th>受領者（承諾者）</th>
      <td>
        {{VENDOR_ACCEPT_NAME}}
        <div class="sign-box"></div>
        <div class="small-muted">
          ※ 記名押印（または署名）欄{{#if (eq VENDOR_IS_CORPORATION "法人")}} — 受注者の権限ある代表者または担当者の記名押印をお願いします{{/if}}
        </div>
      </td>
    </tr>
  </table>
  {{/if}}
  {{/if}}

  {{!-- Phase 17i: 基本契約なしの場合は標準約款（terms_spot_2026）を別紙としてPDF末尾に添付 --}}
  {{#unless HAS_BASE_CONTRACT}}
  {{> terms_spot_2026}}
  {{/unless}}
</body>
</html>
$html_purchase_order$, $schema_purchase_order$[{"name": "ORDER_NO", "label": "発注番号", "group": "I. 発注概要", "dbField": "auto.docNumber", "helpText": "生成時に自動採番されます"}, {"name": "ORDER_DATE", "label": "発行日", "group": "I. 発注概要", "type": "date", "required": true, "dbField": "auto.today", "helpText": "PDF には YYYY年MM月DD日 で表示。年月日は自動分解"}, {"name": "発注日", "label": "発注日", "group": "I. 発注概要", "type": "date", "helpText": "実際に発注を行った日付。空欄なら PDF では発行日 で代替表示"}, {"name": "PROJECT_TITLE", "label": "件名", "group": "I. 発注概要", "required": true, "dbField": "backlog.summary", "placeholder": "例: ノートPC 5台調達"}, {"name": "VENDOR_NAME", "label": "発注先 名称", "group": "II. 発注先 (取引先)", "required": true, "helpText": "[取引先] ボタンで自動入力"}, {"name": "VENDOR_IS_CORPORATION", "label": "発注先区分", "group": "II. 発注先 (取引先)", "type": "select", "options": ["法人", "個人"], "helpText": "[取引先] ボタンで vendor.entity_type から自動判定。法人は敬称『御中』+ 代表者『様』、個人は『様』のみ"}, {"name": "VENDOR_SUFFIX", "label": "敬称", "group": "II. 発注先 (取引先)", "type": "select", "options": ["御中", "様", "殿"], "placeholder": "御中", "helpText": "発注先区分から自動設定。手動上書きも可"}, {"name": "VENDOR_ADDRESS", "label": "発注先 住所", "group": "II. 発注先 (取引先)", "type": "textarea", "required": true}, {"name": "VENDOR_REPRESENTATIVE_SAMA", "label": "代表者名 (＋様)", "group": "II. 発注先 (取引先)", "placeholder": "例: 代表取締役 山田 太郎 様"}, {"name": "VENDOR_CONTACT_DEPARTMENT", "label": "担当部署", "group": "II. 発注先 (取引先)"}, {"name": "VENDOR_CONTACT_NAME", "label": "担当者名", "group": "II. 発注先 (取引先)"}, {"name": "VENDOR_EMAIL", "label": "E-mail", "group": "II. 発注先 (取引先)"}, {"name": "PARTY_A_NAME", "label": "発注元 名称", "group": "III. 発注元 (自社)", "required": true, "helpText": "[自社] ボタンで自動入力"}, {"name": "PARTY_A_ADDRESS", "label": "発注元 住所", "group": "III. 発注元 (自社)", "type": "textarea", "required": true}, {"name": "PARTY_A_REP", "label": "発注元 代表者", "group": "III. 発注元 (自社)", "required": true}, {"name": "STAFF_NAME", "label": "担当者名", "group": "III. 発注元 (自社)", "dbField": "staff.staff_name", "helpText": "[Sync Staff] で自動入力"}, {"name": "STAFF_DEPARTMENT", "label": "担当部署", "group": "III. 発注元 (自社)", "dbField": "staff.department"}, {"name": "STAFF_PHONE", "label": "TEL", "group": "III. 発注元 (自社)", "dbField": "staff.phone"}, {"name": "STAFF_EMAIL", "label": "E-mail", "group": "III. 発注元 (自社)", "dbField": "staff.email"}, {"name": "grandTotalExTax", "label": "合計金額 (税抜)", "group": "IV. 金額・納期", "type": "number", "required": true, "placeholder": "1000000", "helpText": "明細から自動集計 (単価×数量の合計)"}, {"name": "summaryDeliveryDate", "label": "納期 (自動: 明細から集計)", "group": "IV. 金額・納期", "type": "hidden", "helpText": "明細の delivery_date を自動集計するので入力不要"}, {"name": "summaryPaymentDate", "label": "支払日 (自動: 明細から集計)", "group": "IV. 金額・納期", "type": "hidden", "helpText": "明細の payment_date を自動集計するので入力不要"}, {"name": "summaryPaymentTerms", "label": "支払条件 (廃止予定)", "group": "IV-z. 単一明細用 (任意・上級者向け)", "type": "hidden", "helpText": "明細の payment_terms に置換予定。旧テンプレ互換のため残置"}, {"name": "itemsSubtotalExTax", "label": "業務委託小計 (税抜・自動集計)", "group": "IV. 金額・納期", "type": "hidden", "helpText": "明細から自動集計"}, {"name": "otherFeesTotal", "label": "手数料小計 (税抜・自動集計)", "group": "IV. 金額・納期", "type": "hidden", "helpText": "その他手数料テーブルから自動集計"}, {"name": "other_fees", "label": "その他手数料 (動的配列)", "group": "_DYNAMIC", "type": "hidden", "helpText": "OtherFeesTable から編集"}, {"name": "ITEM_NAME", "label": "品目名 (単一明細フォールバック)", "group": "IV-z. 単一明細用 (任意・上級者向け)", "helpText": "明細表が空のときだけ参照される互換用入力。通常は IV. 明細表を使用"}, {"name": "CALC_METHOD", "label": "計算方式 (単一明細)", "group": "IV-z. 単一明細用 (任意・上級者向け)", "type": "select", "options": ["FIXED", "SUBSCRIPTION", "ROYALTY"], "helpText": "FIXED=固定額 / SUBSCRIPTION=サブスク / ROYALTY=業績連動"}, {"name": "PAYMENT_TERMS", "label": "支払条件 (単一明細)", "group": "IV-z. 単一明細用 (任意・上級者向け)", "placeholder": "例: 翌月末"}, {"name": "PAYMENT_METHOD", "label": "支払方法 (レガシー)", "group": "IV-z. 単一明細用 (任意・上級者向け)", "helpText": "Phase 13 で CALC_METHOD + PAYMENT_TERMS に分離。後方互換のため残置"}, {"name": "BANK_NAME", "label": "金融機関名", "group": "V. 振込先 (取引先口座)", "dbField": "vendor.bank_name", "helpText": "[取引先] ボタンで自動入力"}, {"name": "BRANCH_NAME", "label": "支店名", "group": "V. 振込先 (取引先口座)", "dbField": "vendor.branch_name"}, {"name": "ACCOUNT_TYPE", "label": "口座種別", "group": "V. 振込先 (取引先口座)", "type": "select", "options": ["普通", "当座"], "dbField": "vendor.account_type"}, {"name": "ACCOUNT_NUMBER", "label": "口座番号", "group": "V. 振込先 (取引先口座)", "dbField": "vendor.account_number"}, {"name": "ACCOUNT_HOLDER_KANA", "label": "口座名義 (カナ)", "group": "V. 振込先 (取引先口座)", "dbField": "vendor.account_holder_kana"}, {"name": "INVOICE_REGISTRATION_NUMBER", "label": "インボイス登録番号 (T-)", "group": "V. 振込先 (取引先口座)", "dbField": "vendor.invoice_registration_number"}, {"name": "TRANSFER_FEE_PAYER", "label": "振込手数料 負担", "group": "V. 振込先 (取引先口座)", "type": "select", "options": ["当社", "取引先"]}, {"name": "SPECIAL_TERMS", "label": "特約事項", "group": "VI. 特約・備考 (任意)", "type": "textarea"}, {"name": "REMARKS_FIXED", "label": "定型備考", "group": "VI. 特約・備考 (任意)", "type": "textarea"}, {"name": "REMARKS_FREE", "label": "自由備考", "group": "VI. 特約・備考 (任意)", "type": "textarea"}, {"name": "documentNumberOverride", "label": "発注番号 手動上書き (任意)", "group": "VII. 契約・署名 (任意)", "helpText": "空欄なら自動採番。社内修正版を外部に出す場合、再発行リビジョン (_001 等) ではなく任意の番号を指定可能 (例: 元番号 ARC-PO-2026-0001 をそのまま使い続ける、A 案 / B 案でサフィックスを変える等)"}, {"name": "showReissueBanner", "label": "PDF に再発行版バナーを表示", "group": "VII. 契約・署名 (任意)", "type": "boolean", "helpText": "ON (デフォルト): 再発行版のとき PDF タイトル下に黄色バナーを表示。OFF: 社内修正のみで相手方には初版に見せたいとき。リビジョン番号は DB 側で常に管理されます"}, {"name": "HAS_BASE_CONTRACT", "label": "基本契約あり", "group": "VII. 契約・署名 (任意)", "type": "hidden"}, {"name": "MASTER_CONTRACT_REF", "label": "基本契約名 / 番号", "group": "VII. 契約・署名 (任意)", "type": "hidden", "helpText": "「0. 業務委託基本契約を選ぶ」のピッカーで自動入力"}, {"name": "SHOW_ORDER_SIGN_SECTION", "label": "発注署名欄を表示", "group": "VII. 契約・署名 (任意)", "type": "boolean"}, {"name": "ACCEPT_METHOD", "label": "承諾方法", "group": "VII. 契約・署名 (任意)", "type": "textarea"}, {"name": "ACCEPT_REPLY_DUE_DATE", "label": "承諾返信期限", "group": "VII. 契約・署名 (任意)", "type": "date"}, {"name": "ACCEPT_BY_PERFORMANCE", "label": "履行による承諾", "group": "VII. 契約・署名 (任意)", "type": "boolean"}, {"name": "SHOW_SIGN_SECTION", "label": "承諾署名欄を表示", "group": "VII. 契約・署名 (任意)", "type": "boolean"}, {"name": "VENDOR_ACCEPT_DATE", "label": "受注者承諾日", "group": "VII. 契約・署名 (任意)", "type": "date"}, {"name": "VENDOR_ACCEPT_NAME", "label": "受注者署名", "group": "VII. 契約・署名 (任意)"}, {"name": "VENDOR_CONTACT_PHONE", "type": "text", "label": "TEL", "group": "II. 発注先 (取引先)", "helpText": "発注先 通知先 電話"}]$schema_purchase_order$::jsonb, '通知先セクション+短い通知条文を追加 (0050)', 'migration-0050'
    FROM t RETURNING id, template_id)
UPDATE document_templates dt SET current_version_id=nv.id, updated_at=now() FROM nv WHERE dt.id=nv.template_id;
