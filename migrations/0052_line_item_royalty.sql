-- 0052_line_item_royalty.sql
-- 業務明細(capability_line_items)に料率(rate_pct)を追加し、ROYALTY 計算に対応。
--   小計 = ⌈ 単価(基準価格) × 数量 × 料率% ⌉ (フォーム LineItemTable で算出)。
-- 発注書テンプレ(purchase_order)に ROYALTY 行の料率表示を追加(db モード反映)。

ALTER TABLE capability_line_items
  ADD COLUMN IF NOT EXISTS rate_pct DECIMAL(7, 4);

-- 発注書テンプレ(document_templates)を現行 disk テンプレ + field_schema の新版へ更新。
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
          {{#if (eq calc_method "ROYALTY")}}
          <div style="font-size:7pt; color:#666; margin-top:2px;">料率 {{rate_pct}}%（単価×数量×料率）</div>
          {{/if}}
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
$html_purchase_order$, $schema_purchase_order$[{"name": "ORDER_NO", "label": "発注番号", "group": "I. 発注概要", "dbField": "auto.docNumber", "helpText": "生成時に自動採番されます"}, {"name": "ORDER_DATE", "label": "発行日", "group": "I. 発注概要", "type": "date", "required": true, "dbField": "auto.today", "helpText": "PDF には YYYY年MM月DD日 で表示。年月日は自動分解"}, {"name": "発注日", "label": "発注日", "group": "I. 発注概要", "type": "date", "helpText": "実際に発注を行った日付。空欄なら PDF では発行日 で代替表示"}, {"name": "PROJECT_TITLE", "label": "件名", "group": "I. 発注概要", "required": true, "dbField": "backlog.summary", "placeholder": "例: ノートPC 5台調達"}, {"name": "VENDOR_NAME", "label": "発注先 名称", "group": "II. 発注先 (取引先)", "required": true, "helpText": "[取引先] ボタンで自動入力"}, {"name": "VENDOR_IS_CORPORATION", "label": "発注先区分", "group": "II. 発注先 (取引先)", "type": "select", "options": ["法人", "個人"], "helpText": "[取引先] ボタンで vendor.entity_type から自動判定。法人は敬称『御中』+ 代表者『様』、個人は『様』のみ"}, {"name": "VENDOR_SUFFIX", "label": "敬称", "group": "II. 発注先 (取引先)", "type": "select", "options": ["御中", "様", "殿"], "placeholder": "御中", "helpText": "発注先区分から自動設定。手動上書きも可"}, {"name": "VENDOR_ADDRESS", "label": "発注先 住所", "group": "II. 発注先 (取引先)", "type": "textarea", "required": true}, {"name": "VENDOR_REPRESENTATIVE_SAMA", "label": "代表者名 (＋様)", "group": "II. 発注先 (取引先)", "placeholder": "例: 代表取締役 山田 太郎 様"}, {"name": "VENDOR_CONTACT_DEPARTMENT", "label": "担当部署", "group": "II. 発注先 (取引先)"}, {"name": "VENDOR_CONTACT_NAME", "label": "担当者名", "group": "II. 発注先 (取引先)"}, {"name": "VENDOR_EMAIL", "label": "E-mail", "group": "II. 発注先 (取引先)"}, {"name": "PARTY_A_NAME", "label": "発注元 名称", "group": "III. 発注元 (自社)", "required": true, "helpText": "[自社] ボタンで自動入力"}, {"name": "PARTY_A_ADDRESS", "label": "発注元 住所", "group": "III. 発注元 (自社)", "type": "textarea", "required": true}, {"name": "PARTY_A_REP", "label": "発注元 代表者", "group": "III. 発注元 (自社)", "required": true}, {"name": "STAFF_NAME", "label": "担当者名", "group": "III. 発注元 (自社)", "dbField": "staff.staff_name", "helpText": "[Sync Staff] で自動入力"}, {"name": "STAFF_DEPARTMENT", "label": "担当部署", "group": "III. 発注元 (自社)", "dbField": "staff.department"}, {"name": "STAFF_PHONE", "label": "TEL", "group": "III. 発注元 (自社)", "dbField": "staff.phone"}, {"name": "STAFF_EMAIL", "label": "E-mail", "group": "III. 発注元 (自社)", "dbField": "staff.email"}, {"name": "grandTotalExTax", "label": "合計金額 (税抜)", "group": "IV. 金額・納期", "type": "number", "required": true, "placeholder": "1000000", "helpText": "明細から自動集計 (単価×数量の合計)"}, {"name": "summaryDeliveryDate", "label": "納期 (自動: 明細から集計)", "group": "IV. 金額・納期", "type": "hidden", "helpText": "明細の delivery_date を自動集計するので入力不要"}, {"name": "summaryPaymentDate", "label": "支払日 (自動: 明細から集計)", "group": "IV. 金額・納期", "type": "hidden", "helpText": "明細の payment_date を自動集計するので入力不要"}, {"name": "summaryPaymentTerms", "label": "支払条件 (廃止予定)", "group": "IV-z. 単一明細用 (任意・上級者向け)", "type": "hidden", "helpText": "明細の payment_terms に置換予定。旧テンプレ互換のため残置"}, {"name": "itemsSubtotalExTax", "label": "業務委託小計 (税抜・自動集計)", "group": "IV. 金額・納期", "type": "hidden", "helpText": "明細から自動集計"}, {"name": "otherFeesTotal", "label": "手数料小計 (税抜・自動集計)", "group": "IV. 金額・納期", "type": "hidden", "helpText": "その他手数料テーブルから自動集計"}, {"name": "other_fees", "label": "その他手数料 (動的配列)", "group": "_DYNAMIC", "type": "hidden", "helpText": "OtherFeesTable から編集"}, {"name": "ITEM_NAME", "label": "品目名 (単一明細フォールバック)", "group": "IV-z. 単一明細用 (任意・上級者向け)", "helpText": "明細表が空のときだけ参照される互換用入力。通常は IV. 明細表を使用"}, {"name": "CALC_METHOD", "label": "計算方式 (単一明細)", "group": "IV-z. 単一明細用 (任意・上級者向け)", "type": "select", "options": ["FIXED", "SUBSCRIPTION", "ROYALTY"], "helpText": "FIXED=固定額 / SUBSCRIPTION=サブスク / ROYALTY=業績連動"}, {"name": "PAYMENT_TERMS", "label": "支払条件 (単一明細)", "group": "IV-z. 単一明細用 (任意・上級者向け)", "placeholder": "例: 翌月末"}, {"name": "PAYMENT_METHOD", "label": "支払方法 (レガシー)", "group": "IV-z. 単一明細用 (任意・上級者向け)", "helpText": "Phase 13 で CALC_METHOD + PAYMENT_TERMS に分離。後方互換のため残置"}, {"name": "BANK_NAME", "label": "金融機関名", "group": "V. 振込先 (取引先口座)", "dbField": "vendor.bank_name", "helpText": "[取引先] ボタンで自動入力"}, {"name": "BRANCH_NAME", "label": "支店名", "group": "V. 振込先 (取引先口座)", "dbField": "vendor.branch_name"}, {"name": "ACCOUNT_TYPE", "label": "口座種別", "group": "V. 振込先 (取引先口座)", "type": "select", "options": ["普通", "当座"], "dbField": "vendor.account_type"}, {"name": "ACCOUNT_NUMBER", "label": "口座番号", "group": "V. 振込先 (取引先口座)", "dbField": "vendor.account_number"}, {"name": "ACCOUNT_HOLDER_KANA", "label": "口座名義 (カナ)", "group": "V. 振込先 (取引先口座)", "dbField": "vendor.account_holder_kana"}, {"name": "INVOICE_REGISTRATION_NUMBER", "label": "インボイス登録番号 (T-)", "group": "V. 振込先 (取引先口座)", "dbField": "vendor.invoice_registration_number"}, {"name": "TRANSFER_FEE_PAYER", "label": "振込手数料 負担", "group": "V. 振込先 (取引先口座)", "type": "select", "options": ["当社", "取引先"]}, {"name": "SPECIAL_TERMS", "label": "特約事項", "group": "VI. 特約・備考 (任意)", "type": "textarea"}, {"name": "REMARKS_FIXED", "label": "定型備考", "group": "VI. 特約・備考 (任意)", "type": "textarea"}, {"name": "REMARKS_FREE", "label": "自由備考", "group": "VI. 特約・備考 (任意)", "type": "textarea"}, {"name": "documentNumberOverride", "label": "発注番号 手動上書き (任意)", "group": "VII. 契約・署名 (任意)", "helpText": "空欄なら自動採番。社内修正版を外部に出す場合、再発行リビジョン (_001 等) ではなく任意の番号を指定可能 (例: 元番号 ARC-PO-2026-0001 をそのまま使い続ける、A 案 / B 案でサフィックスを変える等)"}, {"name": "showReissueBanner", "label": "PDF に再発行版バナーを表示", "group": "VII. 契約・署名 (任意)", "type": "boolean", "helpText": "ON (デフォルト): 再発行版のとき PDF タイトル下に黄色バナーを表示。OFF: 社内修正のみで相手方には初版に見せたいとき。リビジョン番号は DB 側で常に管理されます"}, {"name": "HAS_BASE_CONTRACT", "label": "基本契約あり", "group": "VII. 契約・署名 (任意)", "type": "hidden"}, {"name": "MASTER_CONTRACT_REF", "label": "基本契約名 / 番号", "group": "VII. 契約・署名 (任意)", "type": "hidden", "helpText": "「0. 業務委託基本契約を選ぶ」のピッカーで自動入力"}, {"name": "SHOW_ORDER_SIGN_SECTION", "label": "発注署名欄を表示", "group": "VII. 契約・署名 (任意)", "type": "boolean"}, {"name": "ACCEPT_METHOD", "label": "承諾方法", "group": "VII. 契約・署名 (任意)", "type": "textarea"}, {"name": "ACCEPT_REPLY_DUE_DATE", "label": "承諾返信期限", "group": "VII. 契約・署名 (任意)", "type": "date"}, {"name": "ACCEPT_BY_PERFORMANCE", "label": "履行による承諾", "group": "VII. 契約・署名 (任意)", "type": "boolean"}, {"name": "SHOW_SIGN_SECTION", "label": "承諾署名欄を表示", "group": "VII. 契約・署名 (任意)", "type": "boolean"}, {"name": "VENDOR_ACCEPT_DATE", "label": "受注者承諾日", "group": "VII. 契約・署名 (任意)", "type": "date"}, {"name": "VENDOR_ACCEPT_NAME", "label": "受注者署名", "group": "VII. 契約・署名 (任意)"}, {"name": "VENDOR_CONTACT_PHONE", "type": "text", "label": "TEL", "group": "II. 発注先 (取引先)", "helpText": "発注先 通知先 電話"}]$schema_purchase_order$::jsonb, '業務明細 ROYALTY 料率表示を追加 (0052)', 'migration-0052'
    FROM t RETURNING id, template_id)
UPDATE document_templates dt SET current_version_id=nv.id, updated_at=now() FROM nv WHERE dt.id=nv.template_id;
