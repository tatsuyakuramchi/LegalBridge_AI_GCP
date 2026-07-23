-- 0147_royalty_statement_fx_deduction_note.sql
-- 利用許諾料計算書(royalty_statement) 多明細モードの調整:
--   ・明細から「外貨売上」列を削除(算定基礎額=円のみ表示)。
--   ・外貨入金時の備考を4項目(実受領額の定義/日本源泉徴収前/外国源泉税と日本源泉税は
--     別建て/異議申立)に差し替え。single / JPY 入金は従来文で不変。
--   ・A案: 明細を親契約(イン側)ごとにグループ化し, 契約見出し(計算方式付) + 契約小計 → 総合計。
--   ・計算方式の混在対応: 契約グループごとに 製造ベース(基準価格×課金数量×料率) と
--     売上ベース(実受領額×料率) を1枚にまとめて表示できる(方式ラベル + 製造ベースは内訳注記)。
--
--   本番 worker/search-api は TEMPLATE_SOURCE=db のため DB 版 current を貼替。
--   disk: services/worker/templates/royalty_statement.html と同一内容。冪等。0146 を踏襲。

DO $mig_rs_note$
DECLARE
  tid INTEGER; cur_html TEXT; cur_schema JSONB; new_html TEXT := $rs_tpl_0147$<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>利用許諾料計算書 {{DOC_NO}}</title>
  <style>
    @page { size: A4; margin: 14mm 16mm 14mm 16mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Noto Sans CJK JP", "Noto Sans JP", "IPAexGothic", "IPAGothic", "MS Gothic", sans-serif;
      font-size: 10pt;
      color: #111;
      line-height: 1.55;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    /* ── ヘッダー (purchase_order と同形) ── */
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
      line-height: 1.7;
      color: #555;
      white-space: nowrap;
    }
    .doc-info strong { color: #111; }

    /* ── 当事者 (2 列 + 挨拶文) ── */
    .party-grid {
      display: table;
      width: 100%;
      table-layout: fixed;
      margin-bottom: 12px;
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
      width: 290px;
    }

    /* ── セクション見出し ── */
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

    /* ── テーブル共通 ── */
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    th {
      background: #f3f3f3;
      border: 1px solid #cfcfcf;
      padding: 6px 8px;
      font-weight: bold;
      text-align: center;
    }
    td { border: 1px solid #cfcfcf; padding: 6px 8px; }
    td.right { text-align: right; }
    td.center { text-align: center; }
    td.label { background: #f7f7f7; font-weight: bold; width: 160px; }

    /* ── 計算結果ハイライト ── */
    .result-box {
      border: 2px solid #111;
      padding: 12px 16px;
      margin: 14px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .result-item { flex: 1; text-align: center; }
    .result-item .label-sm { font-size: 8pt; color: #444; }
    .result-item .value-lg { font-size: 16pt; font-weight: bold; }
    .result-item .value-md { font-size: 13pt; font-weight: bold; }
    .result-divider { border-left: 1px solid #cfcfcf; height: 48px; }

    /* ── AG 進捗バー ── */
    .mg-bar-wrap {
      border: 1px solid #cfcfcf;
      padding: 8px 10px;
      margin-bottom: 12px;
    }
    .mg-bar-title { font-size: 8pt; color: #555; margin-bottom: 4px; }
    .mg-bar-track {
      height: 14px;
      background: #e8e8e8;
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 4px;
    }
    .mg-bar-fill { height: 100%; background: #444; }
    .mg-bar-labels {
      display: flex;
      justify-content: space-between;
      font-size: 7.5pt;
      color: #555;
    }

    /* ── 計算明細テーブルの行スタイル ── */
    tr.total-row td {
      background: #f0f0f0;
      font-weight: bold;
      font-size: 11pt;
    }
    tr.mg-row td { background: #fafafa; font-style: italic; color: #444; }
    tr.zero-row td { color: #888; }

    /* ── 備考ボックス ── */
    .notes-box {
      border: 1px solid #cfcfcf;
      background: #fff;
      padding: 8px 11px;
      font-size: 8.5pt;
      margin-top: 10px;
      line-height: 1.65;
    }

    /* ── フッター ── */
    .doc-footer {
      border-top: 1px solid #cfcfcf;
      padding-top: 6px;
      font-size: 7.5pt;
      color: #666;
      text-align: center;
      margin-top: 12px;
    }

    /* ── バッジ ── */
    .badge-consumed {
      display: inline-block;
      background: #222;
      color: #fff;
      font-size: 7.5pt;
      padding: 1px 6px;
      border-radius: 2px;
      margin-left: 6px;
      vertical-align: middle;
    }
    .badge-zero {
      display: inline-block;
      background: #888;
      color: #fff;
      font-size: 7.5pt;
      padding: 1px 6px;
      border-radius: 2px;
      margin-left: 6px;
      vertical-align: middle;
    }
  </style>
</head>
<body>

  {{!-- Phase 22.21.96: 発注書テンプレと同じ「挨拶形式」レイアウトに刷新。
        ・左にライセンサー名 + 担当者 + T番号 + 件名 + 拝啓〜の挨拶文
        ・右に発行元 (= ライセンシー = 自社) + 担当者情報をグレーボックスで
        ・ヘッダー右上に 文書番号 / 契約番号 / 発行日 --}}
  <div class="header-row">
    <div class="title-box">
      <h1>利用許諾料計算書</h1>
    </div>
    <div class="doc-info">
      文書番号: <strong>{{DOC_NO}}</strong><br>
      {{#if linked_contract_number}}契約番号: {{linked_contract_number}}<br>{{/if}}
      発行日: {{documentDate}}
    </div>
  </div>

  <div class="party-grid">
    {{!-- 左: ライセンサー (取引先) ──────────────────── --}}
    {{!-- Phase 22.21.97:
          ・LICENSOR_SUFFIX = 取引先 entity_type から判定 (法人→御中 / 個人→様)
          ・T番号 (licensor_t_number) は実 Backlog 課題キーのときだけ表示
            合成キー (LEGAL-* / IMPORT-* 等) は worker で空文字化される --}}
    <div class="vendor-section">
      {{!-- Phase 22.21.100: LICENSOR_SUFFIX はフォームで必ず set されるので
            旧 fallback (御中) を廃止。万一未 set の場合は何も付けない。 --}}
      <div class="vendor-name">{{licensor}}{{#if LICENSOR_SUFFIX}} {{LICENSOR_SUFFIX}}{{/if}}</div>
      {{#if VENDOR_REPRESENTATIVE_SAMA}}
      <div style="margin-top:6px; font-size:9.5pt;">{{VENDOR_REPRESENTATIVE_SAMA}}</div>
      {{/if}}
      {{#if licensor_t_number}}
      <div style="margin-top:6px; font-size:9pt; color:#555;">T番号: {{licensor_t_number}}</div>
      {{/if}}

      <div style="margin-top:12px; font-size:10.5pt;">
        件名: <strong>{{#if originalWork}}{{originalWork}} {{/if}}利用許諾料のご報告</strong>
      </div>

      <div style="margin-top:10px; line-height:1.8;">
        拝啓　平素は格別のお引き立てを賜り、厚く御礼申し上げます。<br>
        下記の通り利用許諾料を計算いたしましたので、ご査収のほどよろしくお願い申し上げます。
      </div>
    </div>

    {{!-- 右: ライセンシー = 発行元 (自社) ──────────── --}}
    <div class="company-section">
      <div style="font-size:8pt; font-weight:800; color:#555; margin-bottom:4px;">発行元 (ライセンシー)</div>
      <div style="font-weight:900; font-size:12pt; margin-bottom:5px;">{{licensee}}</div>
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

  {{#if (eq statementMode "multi")}}
  {{!-- ══ Phase 29: 多明細モード (サブライセンス受領 → イン側料率で支払) ══ --}}
  {{!-- ── 受領情報 (アウト側入金) ── --}}
  <div class="section-mark">■ 受領情報（サブライセンス入金）</div>
  <table style="margin-bottom:12px;">
    <tr>
      <td class="label">入金企業</td>
      <td>{{payerCompany}}</td>
      <td class="label" style="width:120px;">カテゴリー</td>
      <td class="center" style="width:170px;">{{royaltyCategory}}</td>
    </tr>
    <tr>
      <td class="label">デザイナー / 権利者</td>
      <td>{{designerName}}</td>
      <td class="label">入金通貨</td>
      <td class="center">{{intakeCurrency}}{{#unless (eq intakeCurrency "JPY")}}（入金日レート: {{fxRate}}）{{/unless}}</td>
    </tr>
    {{#if desiredDeadline}}
    <tr>
      <td class="label">希望納期</td>
      <td colspan="3">{{desiredDeadline}}</td>
    </tr>
    {{/if}}
  </table>

  {{!-- ── 利用許諾料計算明細 (多明細) ── --}}
  <div class="section-mark">■ 利用許諾料計算明細</div>
  <table style="margin-bottom:12px;">
    <thead>
      <tr>
        <th style="text-align:left;">製品名</th>
        <th style="width:26%;">算定基礎額（円）</th>
        <th style="width:12%;">料率</th>
        <th style="width:24%;">支払額（税抜）</th>
      </tr>
    </thead>
    <tbody>
      {{!-- A案: 親契約(イン側)ごとにグループ化。見出し(計算方式付) + 明細 + 契約小計。
            方式が契約ごとに異なっても(製造ベース/売上ベース)1枚にまとめられる。 --}}
      {{#each lineGroups}}
      <tr>
        <td colspan="4" style="background:#eef1f5; font-weight:bold; border-top:2px solid #999;">
          対象契約: {{#if this.contractTitle}}{{this.contractTitle}}{{else}}（契約未指定）{{/if}}{{#if this.contractNumber}}　［{{this.contractNumber}}］{{/if}}{{#if this.methodLabel}}　／　{{this.methodLabel}}{{/if}}
        </td>
      </tr>
      {{#each this.lines}}
      <tr>
        <td>{{this.productName}}</td>
        <td class="right">¥{{this.salesJpyStr}}{{#if this.basisNote}}<div style="font-size:8pt; color:#777;">{{this.basisNote}}</div>{{/if}}</td>
        <td class="center">{{this.ratePctResolved}}%</td>
        <td class="right">¥{{this.paymentJpyStr}}</td>
      </tr>
      {{/each}}
      <tr class="mg-row">
        <td class="right" colspan="3">小計{{#if this.contractTitle}}（{{this.contractTitle}}）{{/if}}　※算定基礎額小計（円） ¥{{this.subtotalSalesStr}}</td>
        <td class="right">¥{{this.subtotalPaymentStr}}</td>
      </tr>
      {{/each}}
      <tr class="total-row">
        <td class="right" colspan="3">支払合計（税抜）　※算定基礎額合計（円） ¥{{linesTotalSalesStr}}</td>
        <td class="right">¥{{linesTotalPaymentStr}}</td>
      </tr>
      <tr>
        <td class="right" colspan="3">消費税（{{taxRate}}%）</td>
        <td class="right">¥{{linesTaxStr}}</td>
      </tr>
      <tr class="total-row">
        <td class="right" colspan="3">源泉徴収税計算前　お支払予定額合計（税込）</td>
        <td class="right">¥{{linesTotalIncTaxStr}}</td>
      </tr>
    </tbody>
  </table>
  {{else}}
  {{!-- ── 利用概要 ── --}}
  <div class="section-mark">■ 利用概要</div>
  <table style="margin-bottom:12px;">
    <tr>
      <td class="label">製品名</td>
      <td>{{productName}}{{#if edition}}（{{edition}}）{{/if}}</td>
      <td class="label" style="width:120px;">製造完了日</td>
      <td class="center" style="width:130px;"><strong>{{completionDate}}</strong></td>
    </tr>
    {{!-- Phase 28: 製造/印刷契機のみ数量系を表示。売上報告ベースは金額表記 --}}
    {{#if (eq calcType "manufacturing")}}
    <tr>
      <td class="label">製造数量（総数）</td>
      <td class="right">{{quantity}} 個</td>
      <td class="label">販促サンプル数</td>
      <td class="right">{{sampleQuantity}} 個（計算対象外）</td>
    </tr>
    <tr>
      <td class="label">課税対象数量</td>
      <td class="right"><strong>{{billableQuantity}} 個</strong></td>
      <td class="label">基準価格（税抜）</td>
      <td class="right">¥{{msrpStr}}</td>
    </tr>
    {{else}}
    <tr>
      <td class="label">{{#if (eq calcType "sublicense")}}被許諾者受領額{{else}}報告売上高{{/if}}（税抜）</td>
      <td class="right"><strong>¥{{msrpStr}}</strong></td>
      <td class="label">料率</td>
      <td class="right">{{royaltyRatePct}}%</td>
    </tr>
    {{/if}}
  </table>

  {{!-- ── 利用許諾料計算明細 ── --}}
  <div class="section-mark">■ 利用許諾料計算明細</div>
  <table style="margin-bottom:12px;">
    <thead>
      <tr>
        <th style="width:40%;">項目</th>
        <th style="width:30%;">計算式</th>
        <th style="width:30%;">金額（税抜）</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>当期利用許諾料（グロス）</td>
        <td class="center">
          {{#if (eq calcType "manufacturing")}}
            {{billableQuantity}}個 × ¥{{msrpStr}} × {{royaltyRatePct}}%
          {{else if (eq calcType "sales")}}
            売上高 ¥{{msrpStr}} × {{royaltyRatePct}}%
          {{else if (eq calcType "sublicense")}}
            受領額 ¥{{msrpStr}} × {{royaltyRatePct}}%
          {{else}}
            固定額
          {{/if}}
        </td>
        <td class="right">¥{{grossRoyaltyStr}}</td>
      </tr>

      {{!-- Phase 22.21.95: MG (最低保証) = floor。グロス < MG のみ出す --}}
      {{#if mgTopupApplied}}
      <tr class="mg-row">
        <td>
          MG（最低保証）適用
          <span class="badge-consumed">FLOOR</span>
        </td>
        <td class="center">グロス ¥{{grossRoyaltyStr}} &lt; MG ¥{{mgAmountStr}} → MG を採用</td>
        <td class="right" style="color:#444;">+¥{{mgTopupThisTimeStr}}</td>
      </tr>
      {{/if}}

      {{!-- Phase 22.21.95: AG (前払い保証) = 消化型。ag_amount > 0 のみ出す --}}
      {{#if agApplied}}
      <tr class="mg-row">
        <td>
          AG（前払い保証金）充当
          {{#if agFullyConsumed}}<span class="badge-consumed">消化完了</span>{{/if}}
        </td>
        <td class="center">AG残高 ¥{{agConsumedBeforeStr}} → 今回 ▲¥{{agConsumedThisTimeStr}}</td>
        <td class="right" style="color:#444;">▲¥{{agConsumedThisTimeStr}}</td>
      </tr>
      {{/if}}

      <tr class="{{#if (eq actualRoyalty 0)}}zero-row{{else}}total-row{{/if}}">
        <td colspan="2">
          実支払利用許諾料
          {{#if (eq actualRoyalty 0)}}
            <span class="badge-zero">AG充当のため今期支払なし</span>
          {{/if}}
        </td>
        <td class="right">¥{{actualRoyaltyStr}}</td>
      </tr>

      {{#if actualRoyalty}}
      <tr>
        <td colspan="2" class="right">消費税（{{taxRate}}%）</td>
        <td class="right">¥{{taxAmount}}</td>
      </tr>
      <tr class="total-row">
        <td colspan="2" class="right">源泉徴収税計算前　お支払予定額合計（税込）</td>
        <td class="right">¥{{totalPaymentStr}}</td>
      </tr>
      {{/if}}
    </tbody>
  </table>

  {{!-- AG 進捗バー (AG > 0 のときのみ) --}}
  {{#if agApplied}}
  <div class="mg-bar-wrap">
    <div class="mg-bar-title">AG消化進捗（今回処理後）</div>
    <div class="mg-bar-track">
      <div class="mg-bar-fill" style="width: {{agProgressPct}}%;"></div>
    </div>
    <div class="mg-bar-labels">
      <span>消化済: ¥{{agConsumedAfterStr}} / AG総額: ¥{{agAmountStr}}</span>
      <span>残高: ¥{{agRemainingStr}}</span>
    </div>
  </div>
  {{/if}}
  {{/if}}

  {{!-- ── 支払条件・日程 ── --}}
  <div class="section-mark">■ 支払条件・日程</div>
  <table style="margin-bottom:12px;">
    <tr>
      <td class="label">支払条件</td>
      <td colspan="3">{{paymentConditionSummary}}</td>
    </tr>
    <tr>
      <td class="label">報告期限</td>
      <td><strong>{{reportingDeadline}}</strong></td>
      <td class="label" style="width:120px;">支払期日</td>
      <td class="center" style="width:140px;"><strong>{{paymentDueDate}}</strong></td>
    </tr>
    <tr>
      <td class="label">通貨</td>
      <td>{{currency}}</td>
      <td class="label">税率</td>
      <td class="center">{{taxRate}}%</td>
    </tr>
  </table>

  {{!-- Phase 22.21.103: 振込先口座 (取引先マスタから自動補完)。
        bankName / branchName / accountType / accountNo / accountHolder
        のいずれかが set されていればセクション全体を出す。 --}}
  {{#if (or bankName accountNo accountHolder)}}
  <div class="section-mark">■ 振込先口座 (取引先指定)</div>
  <table style="margin-bottom:12px;">
    <tr>
      <td class="label">金融機関</td>
      <td>{{bankName}}{{#if branchName}} {{branchName}}{{/if}}</td>
      <td class="label" style="width:120px;">口座種別</td>
      <td class="center" style="width:140px;">{{accountType}}</td>
    </tr>
    <tr>
      <td class="label">口座番号</td>
      <td><strong>{{accountNo}}</strong></td>
      <td class="label">口座名義 (カナ)</td>
      <td>{{accountHolder}}</td>
    </tr>
    {{#if invoiceRegistrationNumber}}
    <tr>
      <td class="label">インボイス登録番号</td>
      <td colspan="3">{{invoiceRegistrationNumber}}</td>
    </tr>
    {{/if}}
  </table>
  {{/if}}

  {{!-- ── 支払金額サマリー ── --}}
  {{#if (eq statementMode "multi")}}
  <div class="result-box">
    <div class="result-item">
      <div class="label-sm">源泉徴収税計算前　お支払予定額合計（税込）</div>
      <div class="value-lg">¥ {{linesTotalIncTaxStr}}</div>
    </div>
    <div class="result-divider"></div>
    <div class="result-item">
      <div class="label-sm">支払期日</div>
      <div class="value-md">{{paymentDueDate}}</div>
    </div>
    <div class="result-divider"></div>
    <div class="result-item">
      <div class="label-sm">希望納期</div>
      <div class="value-md">{{desiredDeadline}}</div>
    </div>
  </div>
  {{else}}
  {{#if actualRoyalty}}
  <div class="result-box">
    <div class="result-item">
      <div class="label-sm">源泉徴収税計算前　お支払予定額（税込）</div>
      <div class="value-lg">¥ {{totalPaymentStr}}</div>
    </div>
    <div class="result-divider"></div>
    <div class="result-item">
      <div class="label-sm">支払期日</div>
      <div class="value-md">{{paymentDueDate}}</div>
    </div>
    <div class="result-divider"></div>
    <div class="result-item">
      <div class="label-sm">報告期限</div>
      <div class="value-md">{{reportingDeadline}}</div>
    </div>
  </div>
  {{else}}
  <div class="result-box" style="background:#f8f8f8;">
    <div class="result-item">
      <div class="label-sm">今期実支払額</div>
      <div class="value-lg" style="color:#666;">¥ 0</div>
      <div class="label-sm" style="margin-top:4px;">AG充当のため今期のお支払はありません</div>
    </div>
    {{#if agApplied}}
    <div class="result-divider"></div>
    <div class="result-item">
      <div class="label-sm">AG残高</div>
      <div class="value-md">¥ {{agRemainingStr}}</div>
    </div>
    {{/if}}
  </div>
  {{/if}}
  {{/if}}

  {{!-- ── 備考 / みなし合意 / 連絡先 ── --}}
  <div class="notes-box">
    <div style="font-weight:bold; margin-bottom:4px;">備考</div>
    {{#if (eq statementMode "multi")}}{{#unless (eq intakeCurrency "JPY")}}
    <div>
      ※ 本計算書に記載する売上額は、サブライセンシーが外貨で支払った金額から、送金手数料、為替換算に伴う差額、サブライセンシーの所在国その他の関係国の法令に基づき当該国において徴収された源泉徴収税その他の控除額を差し引いた後に、当社が実際に受領した金額（以下「実受領額」といいます。）を基準として算出しています。
    </div>
    <div style="margin-top:3px;">
      ※ 本計算書に記載する利用許諾料は、実受領額を基準として算出した、日本における源泉徴収前の金額です。当社から受領者に対する支払について、日本の法令に基づく源泉徴収が必要となる場合、実際の支払額は、本計算書に記載する利用許諾料から当該源泉徴収税額を控除した後の金額となります。
    </div>
    <div style="margin-top:3px;">
      ※ サブライセンシーの所在国その他の関係国において、サブライセンシーから当社への支払時に徴収された源泉徴収税と、当社から受領者への支払時に日本において徴収する源泉徴収税は、それぞれ異なる支払関係に基づくものです。
    </div>
    <div style="margin-top:3px;">
      ※ 本計算書の内容に異議がある場合は、本計算書の到達後5営業日以内に、下記連絡先まで具体的な異議の内容をご連絡ください。期限内にご連絡がない場合、当社は、本計算書に記載した内容に基づき支払その他の処理を行います。
    </div>
    {{else}}
    <div>※ 支払額は源泉徴収税引き後の金額になります。</div>
    <div style="margin-top:3px;">
      ※ 本計算書の内容に異議がある場合は、本書到達後 5 営業日以内に下記連絡先までご連絡ください。
      期限内にご連絡がない場合は、内容にご同意いただいたものとみなします。
    </div>
    {{/unless}}{{else}}
    <div>※ 支払額は源泉徴収税引き後の金額になります。</div>
    <div style="margin-top:3px;">
      ※ 本計算書の内容に異議がある場合は、本書到達後 5 営業日以内に下記連絡先までご連絡ください。
      期限内にご連絡がない場合は、内容にご同意いただいたものとみなします。
    </div>
    {{/if}}
    <div style="margin-top:3px;">
      ※ 連絡先:
      {{#if STAFF_NAME}}{{STAFF_NAME}}{{else}}（担当者未設定）{{/if}}{{#if STAFF_DEPARTMENT}} ／ {{STAFF_DEPARTMENT}}{{/if}}{{#if STAFF_EMAIL}} ／ {{STAFF_EMAIL}}{{/if}}{{#if STAFF_PHONE}} ／ TEL {{STAFF_PHONE}}{{/if}}
    </div>
    {{#if notes}}
    <div style="margin-top:6px; padding-top:6px; border-top:1px dashed #ccc;">{{notes}}</div>
    {{/if}}
  </div>

  {{!-- Phase 22.21.99: 「LegalBridge により自動生成」フッターを削除
        (ユーザー要望)。doc-footer の CSS は他テンプレで使う可能性が
        あるため style ブロックには残置。 --}}

</body>
</html>
$rs_tpl_0147$; vid INTEGER;
BEGIN
  SELECT dt.id, v.html_source, v.field_schema INTO tid, cur_html, cur_schema
    FROM document_templates dt
    LEFT JOIN document_template_versions v ON v.id = dt.current_version_id
   WHERE dt.template_key = 'royalty_statement';
  IF tid IS NULL THEN RAISE NOTICE '0147: royalty_statement template not found, skipping'; RETURN; END IF;
  IF cur_html IS NOT NULL AND cur_html = new_html THEN RAISE NOTICE '0147: already up to date, skipping'; RETURN; END IF;
  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  VALUES (tid,
          COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id = tid),0)+1,
          new_html, cur_schema,
          '0147: 利用許諾料計算書 多明細 外貨列削除＋控除注意書き4項目＋親契約グループ化＋計算方式混在',
          'migration-0147')
  RETURNING id INTO vid;
  UPDATE document_templates SET current_version_id = vid, updated_at = now() WHERE id = tid;
  RAISE NOTICE '0147: royalty_statement applied (new version_id=%)', vid;
END $mig_rs_note$;
