-- 0112_po_payment_day_clarify_templates.sql
-- 発注書(purchase_order)/海外発注書(intl_purchase_order)テンプレのサブスク明細行を修正:
--   - 「納期」に支払日ラベル・「支払日」に契約期間が出ていた逆転を解消
--     (納期→役務提供期間(期間表示)、支払日→支払サイクル表記)
--   - billingDayLabel/billingDayLabelEn の第3引数 billing_timing で
--     当月/翌月/翌々月払いを明示 (「月末払い」の当月/翌月あいまいさを解消)
--   disk: services/worker/templates/*.html と同一内容。TEMPLATE_SOURCE=db の
--   worker / search-api(プレビュー) はこの DB 版を読むため新版を current に。
--   field_schema は現行版から引き継ぐ (フォーム項目は不変)。
--   ※ ラベル表示は旧 worker でも壊れない (billingDayLabel の第3引数は旧実装では無視される)。

DO $mig_po$
DECLARE
  tid INTEGER;
  cur_html TEXT;
  cur_schema JSONB;
  vid INTEGER;
BEGIN
  SELECT dt.id, v.html_source, v.field_schema
    INTO tid, cur_html, cur_schema
    FROM document_templates dt
    LEFT JOIN document_template_versions v ON v.id = dt.current_version_id
   WHERE dt.template_key = 'purchase_order';

  IF tid IS NULL THEN
    RAISE NOTICE '0112: purchase_order template not found, skipping';
    RETURN;
  END IF;

  IF cur_html IS NOT DISTINCT FROM $po_html$<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>発注書</title>
<style>
  body { font-family:'Noto Sans CJK JP','Meiryo',sans-serif; font-size:10pt; line-height:1.5; color:#111; margin:0; padding:16px; }
  h1.doc-title { font-size:22pt; margin:0 0 4px; letter-spacing:2px; }
  .doc-head { text-align:center; margin-bottom:8px; }
  .doc-sub { font-size:9pt; color:#555; }
  hr.rule { border:none; border-top:2px solid #111; margin:0 0 14px; }
  table { border-collapse:collapse; }
  .party { width:100%; margin-bottom:14px; }
  .party td { vertical-align:top; }
  .party .vlabel { font-size:8pt; font-weight:700; color:#555; margin-bottom:3px; }
  .vendor-name { font-size:13pt; font-weight:800; border-bottom:1px solid #111; padding-bottom:3px; margin-bottom:6px; }
  .muted { font-size:9pt; color:#555; }
  .section-mark { font-size:10pt; font-weight:800; margin:12px 0 6px; border-left:4px solid #111; padding-left:8px; }
  table.summary { width:100%; margin-bottom:12px; font-size:10pt; }
  table.summary th { width:30%; background:#f3f3f3; border:1px solid #cfcfcf; padding:7px 8px; text-align:left; }
  table.summary td { border:1px solid #cfcfcf; padding:7px 8px; }
  .total-amount { font-size:13pt; font-weight:800; }
  .amount-note { font-size:8.5pt; color:#555; }
  table.items { width:100%; font-size:9pt; margin-top:4px; table-layout:fixed; }
  table.items th { background:#f3f3f3; border:1px solid #cfcfcf; padding:7px 8px; }
  table.items td { border:1px solid #cfcfcf; padding:7px 8px; vertical-align:top; }
  table.items th.l, table.items td.l { text-align:left; }
  .center { text-align:center; }
  .right { text-align:right; }
  .item-main td { border-bottom:none; padding:8px 8px 4px; }
  .item-detail td { border-top:1px dashed #cfcfcf; padding:3px 8px 8px; font-size:8.5pt; color:#555; }
  .item-detail ul { margin:4px 0 0; padding-left:16px; color:#333; line-height:1.55; }
  .tag { display:inline-block; font-size:7.5pt; font-weight:800; background:#eef; color:#334; border-radius:3px; padding:1px 5px; margin-right:4px; }
  .royalty-tag { background:#fef3c7; color:#92400e; }
  .royalty-aside { color:#92400e; font-size:8pt; }
  .callout { border:1px solid #cfcfcf; border-left:4px solid #111; padding:8px 10px; font-size:9pt; margin-top:12px; }
  .terms-box { border:1px solid #cfcfcf; padding:10px; margin-top:12px; }
  .terms-title { display:block; border-bottom:1px solid #111; padding-bottom:3px; margin-bottom:6px; font-weight:800; }
  .sign-box { height:22mm; border:1px solid #cfcfcf; margin-top:4px; }
  .incl-note { font-size:7.5pt; color:#92400e; }
</style>
</head>
<body>

<!-- ===== ヘッダ ===== -->
<div class="doc-head">
  <h1 class="doc-title">発注書</h1>
  <div class="doc-sub">
    発注日: {{#if 発注日}}{{発注日}}{{else}}{{#if order_date}}{{order_date}}{{else}}{{formatDate (or ORDER_DATE (concat ORDER_DATE_YEAR "-" ORDER_DATE_MONTH "-" ORDER_DATE_DAY))}}{{/if}}{{/if}}
    　／　書類番号: {{ORDER_NO}}{{#if isReissue}}{{#unless (eq showReissueBanner false)}}　（元: {{BASE_DOC_NO}}）{{/unless}}{{/if}}
  </div>
</div>
<hr class="rule">

<!-- ===== 宛先 ＋ 発注者 ===== -->
<table class="party">
  <tr>
    <td style="width:50%; padding-right:12px;">
      <div class="vlabel">発注先（受注者）</div>
      <div class="vendor-name">{{VENDOR_NAME}}{{#if VENDOR_SUFFIX}}　{{VENDOR_SUFFIX}}{{else}}　御中{{/if}}</div>
      {{#if VENDOR_ADDRESS}}<div class="muted">{{VENDOR_ADDRESS}}</div>{{/if}}
      {{#if VENDOR_EMAIL}}<div class="muted" style="margin-top:2px;">E-mail: {{VENDOR_EMAIL}}</div>{{/if}}
      {{#if VENDOR_CONTACT_NAME}}
      <div style="margin-top:4px; font-size:9pt;">{{#if VENDOR_CONTACT_DEPARTMENT}}{{VENDOR_CONTACT_DEPARTMENT}}　{{/if}}{{VENDOR_CONTACT_NAME}} 様</div>
      {{/if}}
      <div style="margin-top:10px; font-size:9pt;">下記内容にて発注いたします。ご確認をお願いいたします。</div>
      {{#if PROJECT_TITLE}}<div style="margin-top:8px; font-size:10pt;">件名: <strong>{{PROJECT_TITLE}}</strong></div>{{/if}}
    </td>
    <td style="width:50%; padding-left:12px; border-left:1px solid #cfcfcf;">
      <div class="vlabel">発注者</div>
      <div style="font-weight:900; font-size:12pt; margin-bottom:4px;">{{PARTY_A_NAME}}</div>
      <div style="white-space:pre-wrap;">{{PARTY_A_ADDRESS}}</div>
      {{#if PARTY_A_REP}}<div style="margin-top:2px;">{{PARTY_A_REP}}</div>{{/if}}
      {{#if STAFF_NAME}}
      <div style="margin-top:8px; padding-top:6px; border-top:1px solid #cfcfcf; font-size:9pt;">
        {{#if STAFF_DEPARTMENT}}<strong>部署:</strong> {{STAFF_DEPARTMENT}}<br>{{/if}}
        <strong>担当:</strong> {{STAFF_NAME}}<br>
        {{#if STAFF_PHONE}}TEL: {{STAFF_PHONE}}<br>{{/if}}
        {{#if STAFF_EMAIL}}E-mail: {{STAFF_EMAIL}}{{/if}}
      </div>
      {{/if}}
    </td>
  </tr>
</table>

<!-- ===== 発注概要 ===== -->
<div class="section-mark">■ 発注概要</div>
<table class="summary">
  <tr>
    <th>確定額 小計（税抜）</th>
    <td>
      {{#if (gt grandTotalExTax 0)}}
      <strong class="total-amount">¥ {{formatCurrency grandTotalExTax}}</strong><br>
      <span class="amount-note">※ 消費税等の精算は、支払通知または請求処理にて行います。</span>
      {{else}}
      <strong style="color:#92400e;">報酬は利用許諾料に含む</strong>
      <span class="amount-note">／ 算定方法は明細記載の計算方法の通り</span>
      {{/if}}
    </td>
  </tr>
  <tr>
    <th>利用許諾料</th>
    <td>
      {{#if has_seller_owned_license}}
      <strong style="color:#92400e;">別途算定</strong>
      <span style="font-size:8pt; color:#666;">／ 利用許諾計算書による（明細の ROYALTY 各行・計算式方法のとおり）</span>
      {{else}}
      <span style="color:#888;">—</span>
      {{/if}}
    </td>
  </tr>
  <tr>
    <th>発注日</th>
    <td>{{#if 発注日}}{{発注日}}{{else}}{{#if order_date}}{{order_date}}{{else}}{{#if 発行日}}{{発行日}}{{else}}—{{/if}}{{/if}}{{/if}}</td>
  </tr>
  <tr>
    <th>納期<br><span style="font-size:8pt;color:#888;font-weight:400;">(または役務提供期間)</span></th>
    <td>明細のとおり</td>
  </tr>
  <tr>
    <th>支払日</th>
    <td>明細のとおり</td>
  </tr>
</table>

<!-- ===== 業務明細（2行レイアウト） ===== -->
<div class="section-mark">■ 業務明細</div>
<table class="items">
  <thead>
    <tr>
      <th style="width:5%;">No</th>
      <th class="l" style="width:47%;">品目名・成果物</th>
      <th class="center" style="width:10%;">数量</th>
      <th class="right" style="width:18%;">単価</th>
      <th class="right" style="width:20%;">金額（税抜）</th>
    </tr>
  </thead>
  <tbody>
    {{#if items}}
    {{#each items}}
    <!-- 1行目：核心情報 -->
    <tr class="item-main">
      <td class="center">{{or line_no (index1 @index)}}</td>
      <td class="l">
        {{#if category}}<span class="tag">{{category}}</span>{{/if}}
        <strong style="font-size:10pt;">{{item_name}}</strong>
      </td>
      <td class="right">{{or quantity qty}}</td>
      <td class="right">{{#if (eq calc_method "ROYALTY")}}{{#if (gt (or amount_ex_tax amount) 0)}}{{formatYen (or unit_price unitPrice)}}{{else}}<span style="color:#888;">-</span>{{/if}}{{else}}{{formatYen (or unit_price unitPrice)}}{{/if}}</td>
      <td class="right">{{#if (eq calc_method "ROYALTY")}}{{#if (gt (or amount_ex_tax amount) 0)}}<strong>{{formatYen (or amount_ex_tax amount)}}</strong><div class="incl-note">執筆料（利用許諾料は別途）</div>{{else}}<div class="incl-note">報酬は<br>利用許諾料に含む</div>{{/if}}{{else}}<strong>{{formatYen (or amount_ex_tax amount)}}</strong>{{/if}}</td>
    </tr>
    <!-- 2行目：詳細情報 -->
    <tr class="item-detail">
      <td></td>
      <td colspan="4">
        【IP帰属】{{#if (eq deliverable_ownership "受注者")}}受注者（利用許諾型）{{else}}発注者（譲渡型）{{/if}}
        　／　支払方法：{{or calc_method payment_method_display payment_method "FIXED"}}{{#if payment_terms}}（{{payment_terms}}）{{else}}{{#if payment_method}}（{{payment_method}}）{{/if}}{{/if}}
        　／　{{#if (eq calc_method "SUBSCRIPTION")}}役務提供期間{{else}}納期{{/if}}：{{#if (eq calc_method "SUBSCRIPTION")}}{{#if term_start}}{{formatDateCompact term_start}}{{else}}—{{/if}} 〜 {{#if term_end}}{{formatDateCompact term_end}}{{else}}継続中{{/if}}{{else}}{{formatDate delivery_date}}{{/if}}
        　／　支払日：{{#if (eq calc_method "SUBSCRIPTION")}}{{or (billingDayLabel billing_day cycle billing_timing) "支払日未設定"}}{{else}}{{#if (eq calc_method "ROYALTY")}}{{#unless (gt (or amount_ex_tax amount) 0)}}利用許諾料計算書の通り{{else}}{{formatDate payment_date}}{{/unless}}{{else}}{{formatDate payment_date}}{{/if}}{{/if}}
        {{#if (eq calc_method "ROYALTY")}}
        <div style="margin-top:4px;"><span class="tag royalty-tag">利用許諾</span>{{#if (eq royalty_calc_basis "manufacturing")}}個数 × 基準価格 × 料率{{else}}{{#if (eq royalty_calc_basis "sales")}}売上高 × 料率{{else}}{{#if (eq royalty_calc_basis "sublicense")}}受領額 × 料率{{else}}{{#if (eq royalty_calc_basis "fixed")}}固定額{{else}}個数 × 基準価格 × 料率{{/if}}{{/if}}{{/if}}{{/if}}{{#if rate_pct}} ・料率 {{rate_pct}}%{{/if}}<span class="royalty-aside">／ 利用許諾料は別途（利用許諾計算書による算定）</span></div>
        {{/if}}
        {{#if (or spec detailText)}}
        <ul>
          {{#if spec}}<li>{{spec}}</li>{{/if}}
          {{#if detailText}}<li>{{detailText}}</li>{{/if}}
        </ul>
        {{/if}}
        {{#if payment_schedule}}
        <div style="margin-top:4px; font-weight:700;">支払スケジュール</div>
        <table style="width:100%; border-collapse:collapse; font-size:8.5pt;">
          <tr><th class="l" style="width:8%;">回</th><th class="l">支払予定日</th><th class="right" style="width:30%;">金額</th></tr>
          {{#each payment_schedule}}
          <tr>
            <td class="center">{{index1 @index}}</td>
            <td>{{date}}</td>
            <td class="right">{{#if amount}}{{formatYen amount}}{{/if}}</td>
          </tr>
          {{/each}}
        </table>
        {{/if}}
      </td>
    </tr>
    {{/each}}
    {{else}}
    <!-- 単一明細フォールバック (items[] が空のとき) -->
    <tr class="item-main">
      <td class="center">1</td>
      <td class="l"><strong style="font-size:10pt;">{{ITEM_NAME}}</strong></td>
      <td class="right">1</td>
      <td class="right">-</td>
      <td class="right"><strong>¥ {{formatCurrency grandTotalExTax}}</strong></td>
    </tr>
    <tr class="item-detail">
      <td></td>
      <td colspan="4">
        支払方法：{{or CALC_METHOD PAYMENT_METHOD "FIXED"}}{{#if PAYMENT_TERMS}}（{{PAYMENT_TERMS}}）{{else}}{{#if PAYMENT_METHOD}}（{{PAYMENT_METHOD}}）{{/if}}{{/if}}
        　／　納期：{{formatDate DELIVERY_DATE}}
        　／　支払日：{{summaryPaymentTerms}}
      </td>
    </tr>
    {{/if}}
    <!-- 合計 -->
    <tr>
      <td colspan="4" class="right"><strong>確定額 小計（税抜）</strong></td>
      <td class="right">{{#if (gt (or itemsSubtotalExTax grandTotalExTax) 0)}}<strong>¥ {{formatCurrency (or itemsSubtotalExTax grandTotalExTax)}}</strong>{{else}}<span style="color:#888;">—</span>{{/if}}</td>
    </tr>
  </tbody>
</table>

{{#if has_license_conditions}}
<p style="margin-top:4px; font-size:8.5pt; color:#555;">※ 上記は本発注の利用許諾料（ROYALTY）明細に適用される条件です。発注の確定額（小計）には含まれず、別途、利用許諾料計算書により算定・支払われます。</p>
{{/if}}

<!-- ===== 利用許諾条件（利用許諾料・確定額外） ===== -->
{{#if has_license_conditions}}
<div class="section-mark">■ 利用許諾条件（利用許諾料・確定額外）</div>
<table class="items">
  <thead>
    <tr>
      <th style="width:4%;">#</th>
      <th class="l" style="width:26%;">条件名称 / 区分</th>
      <th class="l" style="width:34%;">計算式</th>
      <th class="l" style="width:18%;">料率 / 基準</th>
      <th class="right" style="width:18%;">MG / AG</th>
    </tr>
  </thead>
  <tbody>
    {{#if financial_conditions.length}}
    {{#each financial_conditions}}
    <tr>
      <td class="center">{{or condition_no (index1 @index)}}</td>
      <td class="l">{{#if condition_name}}{{condition_name}}{{else}}利用許諾条件{{/if}}{{#if region_language_label}}<div style="font-size:7.5pt;color:#666;">{{region_language_label}}</div>{{/if}}</td>
      <td class="l">{{#if (eq calc_type "BASE_QTY_RATE")}}基準価格 × 個数 × 料率{{/if}}{{#if (eq calc_type "BASE_RATE")}}基準価格 × 料率{{/if}}{{#if (eq calc_type "FIXED")}}固定値（{{#if (eq fixed_kind "INSTALLMENT")}}分割{{else}}一括{{/if}}）{{/if}}{{#if (eq calc_type "SUBSCRIPTION")}}サブスク（{{#if (eq subscription_cycle "ANNUAL")}}年払い{{else}}月払い{{/if}}）{{/if}}{{#if formula_text}}<div style="font-size:7.5pt;color:#666;">{{formula_text}}</div>{{/if}}</td>
      <td class="l">{{#if rate_pct}}<div>料率：{{rate_pct}}%</div>{{/if}}{{#if base_price_label}}<div style="font-size:7.5pt;color:#666;">基準価格：{{base_price_label}}</div>{{/if}}</td>
      <td class="right">{{#if (eq guarantee_type "MG")}}MG {{formatYen mg_amount}}{{/if}}{{#if (eq guarantee_type "AG")}}AG {{formatYen ag_amount}}{{/if}}</td>
    </tr>
    {{#if applies_scope}}
    <tr><td style="border-top:0;"></td><td colspan="4" class="l" style="border-top:0; font-size:7.5pt; color:#444;"><strong>適用範囲:</strong> {{applies_scope}}</td></tr>
    {{/if}}
    {{/each}}
    {{else}}
    {{#each items}}
    {{#if (eq calc_method "ROYALTY")}}
    <tr>
      <td class="center">{{or line_no (index1 @index)}}</td>
      <td class="l">{{#if condition_name}}{{condition_name}}{{else}}{{item_name}}{{/if}}{{#if region_language_label}}<div style="font-size:7.5pt;color:#666;">{{region_language_label}}</div>{{/if}}</td>
      <td class="l">{{#if (eq calc_type "BASE_QTY_RATE")}}基準価格 × 個数 × 料率{{/if}}{{#if (eq calc_type "BASE_RATE")}}基準価格 × 料率{{/if}}{{#if (eq calc_type "FIXED")}}固定値（{{#if (eq fixed_kind "INSTALLMENT")}}分割{{else}}一括{{/if}}）{{/if}}{{#if (eq calc_type "SUBSCRIPTION")}}サブスク（{{#if (eq subscription_cycle "ANNUAL")}}年払い{{else}}月払い{{/if}}）{{/if}}{{#if formula_text}}<div style="font-size:7.5pt;color:#666;">{{formula_text}}</div>{{/if}}</td>
      <td class="l">{{#if rate_pct}}<div>料率：{{rate_pct}}%</div>{{/if}}{{#if base_price_label}}<div style="font-size:7.5pt;color:#666;">基準価格：{{base_price_label}}</div>{{/if}}</td>
      <td class="right">{{#if (eq guarantee_type "MG")}}MG {{formatYen mg_amount}}{{/if}}{{#if (eq guarantee_type "AG")}}AG {{formatYen ag_amount}}{{/if}}</td>
    </tr>
    {{/if}}
    {{/each}}
    {{/if}}
  </tbody>
</table>
<div style="margin-top:4px; font-size:8.5pt; color:#555;">※ 上記は本発注の利用許諾料（ROYALTY）明細に適用される条件です。発注の確定額（小計）には含まれず、別途、利用許諾料計算書により算定・支払われます。</div>
{{/if}}

<!-- ===== その他手数料 ===== -->
{{#if other_fees}}
{{#if (gt (length other_fees) 0)}}
<div class="section-mark">■ その他手数料（税抜・合計に加算）</div>
<table class="items">
  <thead>
    <tr>
      <th style="width:6mm;">No</th>
      <th class="l">項目名</th>
      <th class="right" style="width:30mm;">金額（税抜）</th>
      <th class="l">摘要</th>
    </tr>
  </thead>
  <tbody>
    {{#each other_fees}}
    <tr>
      <td class="center">{{or line_no (index1 @index)}}</td>
      <td class="l"><strong>{{fee_name}}</strong></td>
      <td class="right">{{formatYen amount}}</td>
      <td class="l">{{remarks}}</td>
    </tr>
    {{/each}}
    <tr>
      <td colspan="2" class="right"><strong>手数料 小計（税抜）</strong></td>
      <td class="right"><strong>¥ {{formatCurrency otherFeesTotal}}</strong></td>
      <td></td>
    </tr>
  </tbody>
</table>

<table class="summary" style="margin-top:6px;">
  <tr>
    <th style="width:40%;">発注合計（税抜・業務委託 + 手数料）</th>
    <td>
      <strong class="total-amount">¥ {{formatCurrency grandTotalExTax}}</strong><br>
      <span class="amount-note">※ 業務委託 ¥{{formatCurrency (or itemsSubtotalExTax grandTotalExTax)}} ＋ 手数料 ¥{{formatCurrency otherFeesTotal}}</span>
    </td>
  </tr>
</table>
{{/if}}
{{/if}}

<!-- ===== 経費 ===== -->
{{#if expenses}}
{{#if (gt (length expenses) 0)}}
<div class="section-mark">■ 経費（交通費等／税込み額）</div>
<table class="items">
  <thead>
    <tr>
      <th style="width:6mm;">No</th>
      <th class="l">費目</th>
      <th class="center" style="width:24mm;">発生日</th>
      <th class="right" style="width:26mm;">金額（税込）</th>
      <th class="l">摘要</th>
    </tr>
  </thead>
  <tbody>
    {{#each expenses}}
    <tr>
      <td class="center">{{or line_no (index1 @index)}}</td>
      <td class="l"><strong>{{expense_name}}</strong>{{#if spec}}<div style="font-size:8pt;color:#666;">{{spec}}</div>{{/if}}</td>
      <td class="center">{{formatDate spent_date}}</td>
      <td class="right">{{formatYen amount_inc_tax}}</td>
      <td class="l">{{remarks}}</td>
    </tr>
    {{/each}}
    <tr>
      <td colspan="3" class="right"><strong>経費合計（税込）</strong></td>
      <td class="right"><strong>¥ {{formatCurrency expensesTotalIncTax}}</strong></td>
      <td></td>
    </tr>
  </tbody>
</table>
<p style="margin-top:4px; font-size:8.5pt; color:#555;">※ 経費は税込み額にて精算します。本発注書に記載の各項目の領収書原本またはそのコピーを添付してください。</p>
{{/if}}
{{/if}}

<!-- ===== 特約事項 ===== -->
{{#if SPECIAL_TERMS}}
<div class="terms-box">
  <strong class="terms-title">特約事項</strong>
  <div style="white-space:pre-wrap;">{{SPECIAL_TERMS}}</div>
</div>
{{/if}}

<!-- ===== 備考 ===== -->
{{#if REMARKS}}
<div class="terms-box">
  <strong class="terms-title">備考</strong>
  {{#if REMARKS_FIXED}}<div style="white-space:pre-wrap;">{{REMARKS_FIXED}}</div>{{/if}}
  {{#if REMARKS_FREE}}<div style="white-space:pre-wrap; margin-top:{{#if REMARKS_FIXED}}8px{{else}}0{{/if}};">{{REMARKS_FREE}}</div>{{/if}}
</div>
{{/if}}

<!-- ===== 準拠契約 / 適用約款 ===== -->
{{#if HAS_BASE_CONTRACT}}
<div class="callout">
  <strong>準拠契約:</strong> 本発注書は、甲乙間で締結済みの基本契約（{{MASTER_CONTRACT_REF}}）に基づき発行されるものであり、本発注書に定めのない事項については当該基本契約の定めによるものとします。
</div>
{{else}}
<div class="callout">
  <strong>適用約款:</strong> 本発注書には別紙「業務委託基本契約約款（スポット契約用・2026年改正法対応版）」が適用されます。受注者は本発注書を承諾することにより、当該約款にも同意したものとみなします。
</div>
{{/if}}

<!-- ===== 支払先情報 ===== -->
{{#if BANK_NAME}}
<div class="terms-box">
  <strong class="terms-title">支払先情報</strong>
  <table class="summary" style="margin-bottom:6px;">
    <tr><th>金融機関</th><td>{{BANK_NAME}} {{BRANCH_NAME}}</td></tr>
    <tr><th>口座</th><td>{{ACCOUNT_TYPE}} {{ACCOUNT_NUMBER}}</td></tr>
    <tr><th>口座名義</th><td>{{ACCOUNT_HOLDER_KANA}}</td></tr>
    {{#if INVOICE_REGISTRATION_NUMBER}}
    <tr><th>適格請求書発行事業者</th><td>登録番号: T{{INVOICE_REGISTRATION_NUMBER}}</td></tr>
    {{/if}}
  </table>
  {{#if TRANSFER_FEE_PAYER}}<span style="font-size:8.5pt; color:#555;">※ 振込手数料: {{TRANSFER_FEE_PAYER}}負担</span>{{/if}}
</div>
{{else}}
{{#if BANK_INFO}}
<div class="terms-box">
  <strong class="terms-title">支払先情報</strong>
  <div style="white-space:pre-wrap;">{{BANK_INFO}}</div>
  {{#if TRANSFER_FEE_PAYER}}<div style="font-size:8.5pt; color:#555; margin-top:4px;">※ 振込手数料: {{TRANSFER_FEE_PAYER}}負担</div>{{/if}}
</div>
{{/if}}
{{/if}}

<!-- ===== 通知先 ＋ 署名欄 ===== -->
{{#if SHOW_ORDER_SIGN_SECTION}}
<div class="section-mark">■ 通知先</div>
<table class="summary">
  <tr>
    <th>発注先（受注者）</th>
    <td>担当：{{VENDOR_CONTACT_NAME}}　／　TEL：{{VENDOR_CONTACT_PHONE}}　／　E-mail：{{VENDOR_EMAIL}}</td>
  </tr>
  <tr>
    <th>発注元（当社）</th>
    <td>担当：{{STAFF_NAME}}　／　TEL：{{STAFF_PHONE}}　／　E-mail：{{STAFF_EMAIL}}</td>
  </tr>
</table>
<p style="font-size:9pt; color:#555;">本発注に関する通知その他の連絡は、上記の通知先に対して行うものとします。基本契約がある場合は、その通知条項に従います。</p>

<div class="section-mark">■ 署名欄</div>
<table class="summary" style="margin-top:6px;">
  <tr>
    <th style="width:50%;">発注者（甲）</th>
    <th style="width:50%;">受注者（乙）</th>
  </tr>
  <tr>
    <td>
      <div>{{PARTY_A_NAME}}</div>
      <div style="font-size:8.5pt; color:#555;">{{PARTY_A_ADDRESS}}</div>
      <div style="margin-top:4px;">{{PARTY_A_REP}}</div>
      <div class="sign-box"></div>
    </td>
    <td>
      <div>{{VENDOR_NAME}}</div>
      <div style="font-size:8.5pt; color:#555;">{{VENDOR_ADDRESS}}</div>
      <div style="margin-top:4px;">{{#if VENDOR_REPRESENTATIVE_SAMA}}{{VENDOR_REPRESENTATIVE_SAMA}}{{else}}{{VENDOR_CONTACT_NAME}}{{/if}}</div>
      <div class="sign-box"></div>
    </td>
  </tr>
</table>
{{/if}}

<!-- ===== 受領確認（承諾） ===== -->
{{#if (or ACCEPT_METHOD SHOW_SIGN_SECTION)}}
<div class="section-mark">■ 受領確認（承諾）</div>
{{#if ACCEPT_METHOD}}
<div class="callout">
  <strong>承諾方法</strong><br>
  <span style="color:#555;">{{ACCEPT_METHOD}}{{#if ACCEPT_REPLY_DUE_DATE}}<br>返信期限: {{ACCEPT_REPLY_DUE_DATE}}{{/if}}</span>
  {{#if ACCEPT_BY_PERFORMANCE}}<span style="color:#555; margin-top:6px; display:block;">なお、受注者が本発注に基づく業務へ着手した場合、その時点で本発注内容に承諾したものとして取り扱うことがあります。</span>{{/if}}
</div>
{{/if}}
{{#if SHOW_SIGN_SECTION}}
<table class="summary" style="margin-top:6px;">
  <tr>
    <th>受領日（承諾日）</th>
    <td>{{formatDate VENDOR_ACCEPT_DATE}}</td>
  </tr>
  {{#if (eq VENDOR_IS_CORPORATION "法人")}}
  <tr>
    <th>会社名（受注者）</th>
    <td>{{VENDOR_NAME}}{{#if VENDOR_SUFFIX}} {{VENDOR_SUFFIX}}{{/if}}</td>
  </tr>
  {{/if}}
  <tr>
    <th style="vertical-align:top;">受領者（承諾者）</th>
    <td>
      {{VENDOR_ACCEPT_NAME}}
      <div class="sign-box"></div>
      <div style="font-size:8.5pt; color:#555; margin-top:4px;">※ 記名押印（または署名）欄{{#if (eq VENDOR_IS_CORPORATION "法人")}} — 受注者の権限ある代表者または担当者の記名押印をお願いします{{/if}}</div>
    </td>
  </tr>
</table>
{{/if}}
{{/if}}

{{!-- 基本契約なしの場合は標準約款（terms_spot_2026）を別紙としてPDF末尾に添付 --}}
{{#unless HAS_BASE_CONTRACT}}
{{> terms_spot_2026}}
{{/unless}}
</body>
</html>
$po_html$ THEN
    RAISE NOTICE '0112: purchase_order already up to date, skipping';
    RETURN;
  END IF;

  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  VALUES (tid,
          COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id = tid), 0) + 1,
          $po_html$<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>発注書</title>
<style>
  body { font-family:'Noto Sans CJK JP','Meiryo',sans-serif; font-size:10pt; line-height:1.5; color:#111; margin:0; padding:16px; }
  h1.doc-title { font-size:22pt; margin:0 0 4px; letter-spacing:2px; }
  .doc-head { text-align:center; margin-bottom:8px; }
  .doc-sub { font-size:9pt; color:#555; }
  hr.rule { border:none; border-top:2px solid #111; margin:0 0 14px; }
  table { border-collapse:collapse; }
  .party { width:100%; margin-bottom:14px; }
  .party td { vertical-align:top; }
  .party .vlabel { font-size:8pt; font-weight:700; color:#555; margin-bottom:3px; }
  .vendor-name { font-size:13pt; font-weight:800; border-bottom:1px solid #111; padding-bottom:3px; margin-bottom:6px; }
  .muted { font-size:9pt; color:#555; }
  .section-mark { font-size:10pt; font-weight:800; margin:12px 0 6px; border-left:4px solid #111; padding-left:8px; }
  table.summary { width:100%; margin-bottom:12px; font-size:10pt; }
  table.summary th { width:30%; background:#f3f3f3; border:1px solid #cfcfcf; padding:7px 8px; text-align:left; }
  table.summary td { border:1px solid #cfcfcf; padding:7px 8px; }
  .total-amount { font-size:13pt; font-weight:800; }
  .amount-note { font-size:8.5pt; color:#555; }
  table.items { width:100%; font-size:9pt; margin-top:4px; table-layout:fixed; }
  table.items th { background:#f3f3f3; border:1px solid #cfcfcf; padding:7px 8px; }
  table.items td { border:1px solid #cfcfcf; padding:7px 8px; vertical-align:top; }
  table.items th.l, table.items td.l { text-align:left; }
  .center { text-align:center; }
  .right { text-align:right; }
  .item-main td { border-bottom:none; padding:8px 8px 4px; }
  .item-detail td { border-top:1px dashed #cfcfcf; padding:3px 8px 8px; font-size:8.5pt; color:#555; }
  .item-detail ul { margin:4px 0 0; padding-left:16px; color:#333; line-height:1.55; }
  .tag { display:inline-block; font-size:7.5pt; font-weight:800; background:#eef; color:#334; border-radius:3px; padding:1px 5px; margin-right:4px; }
  .royalty-tag { background:#fef3c7; color:#92400e; }
  .royalty-aside { color:#92400e; font-size:8pt; }
  .callout { border:1px solid #cfcfcf; border-left:4px solid #111; padding:8px 10px; font-size:9pt; margin-top:12px; }
  .terms-box { border:1px solid #cfcfcf; padding:10px; margin-top:12px; }
  .terms-title { display:block; border-bottom:1px solid #111; padding-bottom:3px; margin-bottom:6px; font-weight:800; }
  .sign-box { height:22mm; border:1px solid #cfcfcf; margin-top:4px; }
  .incl-note { font-size:7.5pt; color:#92400e; }
</style>
</head>
<body>

<!-- ===== ヘッダ ===== -->
<div class="doc-head">
  <h1 class="doc-title">発注書</h1>
  <div class="doc-sub">
    発注日: {{#if 発注日}}{{発注日}}{{else}}{{#if order_date}}{{order_date}}{{else}}{{formatDate (or ORDER_DATE (concat ORDER_DATE_YEAR "-" ORDER_DATE_MONTH "-" ORDER_DATE_DAY))}}{{/if}}{{/if}}
    　／　書類番号: {{ORDER_NO}}{{#if isReissue}}{{#unless (eq showReissueBanner false)}}　（元: {{BASE_DOC_NO}}）{{/unless}}{{/if}}
  </div>
</div>
<hr class="rule">

<!-- ===== 宛先 ＋ 発注者 ===== -->
<table class="party">
  <tr>
    <td style="width:50%; padding-right:12px;">
      <div class="vlabel">発注先（受注者）</div>
      <div class="vendor-name">{{VENDOR_NAME}}{{#if VENDOR_SUFFIX}}　{{VENDOR_SUFFIX}}{{else}}　御中{{/if}}</div>
      {{#if VENDOR_ADDRESS}}<div class="muted">{{VENDOR_ADDRESS}}</div>{{/if}}
      {{#if VENDOR_EMAIL}}<div class="muted" style="margin-top:2px;">E-mail: {{VENDOR_EMAIL}}</div>{{/if}}
      {{#if VENDOR_CONTACT_NAME}}
      <div style="margin-top:4px; font-size:9pt;">{{#if VENDOR_CONTACT_DEPARTMENT}}{{VENDOR_CONTACT_DEPARTMENT}}　{{/if}}{{VENDOR_CONTACT_NAME}} 様</div>
      {{/if}}
      <div style="margin-top:10px; font-size:9pt;">下記内容にて発注いたします。ご確認をお願いいたします。</div>
      {{#if PROJECT_TITLE}}<div style="margin-top:8px; font-size:10pt;">件名: <strong>{{PROJECT_TITLE}}</strong></div>{{/if}}
    </td>
    <td style="width:50%; padding-left:12px; border-left:1px solid #cfcfcf;">
      <div class="vlabel">発注者</div>
      <div style="font-weight:900; font-size:12pt; margin-bottom:4px;">{{PARTY_A_NAME}}</div>
      <div style="white-space:pre-wrap;">{{PARTY_A_ADDRESS}}</div>
      {{#if PARTY_A_REP}}<div style="margin-top:2px;">{{PARTY_A_REP}}</div>{{/if}}
      {{#if STAFF_NAME}}
      <div style="margin-top:8px; padding-top:6px; border-top:1px solid #cfcfcf; font-size:9pt;">
        {{#if STAFF_DEPARTMENT}}<strong>部署:</strong> {{STAFF_DEPARTMENT}}<br>{{/if}}
        <strong>担当:</strong> {{STAFF_NAME}}<br>
        {{#if STAFF_PHONE}}TEL: {{STAFF_PHONE}}<br>{{/if}}
        {{#if STAFF_EMAIL}}E-mail: {{STAFF_EMAIL}}{{/if}}
      </div>
      {{/if}}
    </td>
  </tr>
</table>

<!-- ===== 発注概要 ===== -->
<div class="section-mark">■ 発注概要</div>
<table class="summary">
  <tr>
    <th>確定額 小計（税抜）</th>
    <td>
      {{#if (gt grandTotalExTax 0)}}
      <strong class="total-amount">¥ {{formatCurrency grandTotalExTax}}</strong><br>
      <span class="amount-note">※ 消費税等の精算は、支払通知または請求処理にて行います。</span>
      {{else}}
      <strong style="color:#92400e;">報酬は利用許諾料に含む</strong>
      <span class="amount-note">／ 算定方法は明細記載の計算方法の通り</span>
      {{/if}}
    </td>
  </tr>
  <tr>
    <th>利用許諾料</th>
    <td>
      {{#if has_seller_owned_license}}
      <strong style="color:#92400e;">別途算定</strong>
      <span style="font-size:8pt; color:#666;">／ 利用許諾計算書による（明細の ROYALTY 各行・計算式方法のとおり）</span>
      {{else}}
      <span style="color:#888;">—</span>
      {{/if}}
    </td>
  </tr>
  <tr>
    <th>発注日</th>
    <td>{{#if 発注日}}{{発注日}}{{else}}{{#if order_date}}{{order_date}}{{else}}{{#if 発行日}}{{発行日}}{{else}}—{{/if}}{{/if}}{{/if}}</td>
  </tr>
  <tr>
    <th>納期<br><span style="font-size:8pt;color:#888;font-weight:400;">(または役務提供期間)</span></th>
    <td>明細のとおり</td>
  </tr>
  <tr>
    <th>支払日</th>
    <td>明細のとおり</td>
  </tr>
</table>

<!-- ===== 業務明細（2行レイアウト） ===== -->
<div class="section-mark">■ 業務明細</div>
<table class="items">
  <thead>
    <tr>
      <th style="width:5%;">No</th>
      <th class="l" style="width:47%;">品目名・成果物</th>
      <th class="center" style="width:10%;">数量</th>
      <th class="right" style="width:18%;">単価</th>
      <th class="right" style="width:20%;">金額（税抜）</th>
    </tr>
  </thead>
  <tbody>
    {{#if items}}
    {{#each items}}
    <!-- 1行目：核心情報 -->
    <tr class="item-main">
      <td class="center">{{or line_no (index1 @index)}}</td>
      <td class="l">
        {{#if category}}<span class="tag">{{category}}</span>{{/if}}
        <strong style="font-size:10pt;">{{item_name}}</strong>
      </td>
      <td class="right">{{or quantity qty}}</td>
      <td class="right">{{#if (eq calc_method "ROYALTY")}}{{#if (gt (or amount_ex_tax amount) 0)}}{{formatYen (or unit_price unitPrice)}}{{else}}<span style="color:#888;">-</span>{{/if}}{{else}}{{formatYen (or unit_price unitPrice)}}{{/if}}</td>
      <td class="right">{{#if (eq calc_method "ROYALTY")}}{{#if (gt (or amount_ex_tax amount) 0)}}<strong>{{formatYen (or amount_ex_tax amount)}}</strong><div class="incl-note">執筆料（利用許諾料は別途）</div>{{else}}<div class="incl-note">報酬は<br>利用許諾料に含む</div>{{/if}}{{else}}<strong>{{formatYen (or amount_ex_tax amount)}}</strong>{{/if}}</td>
    </tr>
    <!-- 2行目：詳細情報 -->
    <tr class="item-detail">
      <td></td>
      <td colspan="4">
        【IP帰属】{{#if (eq deliverable_ownership "受注者")}}受注者（利用許諾型）{{else}}発注者（譲渡型）{{/if}}
        　／　支払方法：{{or calc_method payment_method_display payment_method "FIXED"}}{{#if payment_terms}}（{{payment_terms}}）{{else}}{{#if payment_method}}（{{payment_method}}）{{/if}}{{/if}}
        　／　{{#if (eq calc_method "SUBSCRIPTION")}}役務提供期間{{else}}納期{{/if}}：{{#if (eq calc_method "SUBSCRIPTION")}}{{#if term_start}}{{formatDateCompact term_start}}{{else}}—{{/if}} 〜 {{#if term_end}}{{formatDateCompact term_end}}{{else}}継続中{{/if}}{{else}}{{formatDate delivery_date}}{{/if}}
        　／　支払日：{{#if (eq calc_method "SUBSCRIPTION")}}{{or (billingDayLabel billing_day cycle billing_timing) "支払日未設定"}}{{else}}{{#if (eq calc_method "ROYALTY")}}{{#unless (gt (or amount_ex_tax amount) 0)}}利用許諾料計算書の通り{{else}}{{formatDate payment_date}}{{/unless}}{{else}}{{formatDate payment_date}}{{/if}}{{/if}}
        {{#if (eq calc_method "ROYALTY")}}
        <div style="margin-top:4px;"><span class="tag royalty-tag">利用許諾</span>{{#if (eq royalty_calc_basis "manufacturing")}}個数 × 基準価格 × 料率{{else}}{{#if (eq royalty_calc_basis "sales")}}売上高 × 料率{{else}}{{#if (eq royalty_calc_basis "sublicense")}}受領額 × 料率{{else}}{{#if (eq royalty_calc_basis "fixed")}}固定額{{else}}個数 × 基準価格 × 料率{{/if}}{{/if}}{{/if}}{{/if}}{{#if rate_pct}} ・料率 {{rate_pct}}%{{/if}}<span class="royalty-aside">／ 利用許諾料は別途（利用許諾計算書による算定）</span></div>
        {{/if}}
        {{#if (or spec detailText)}}
        <ul>
          {{#if spec}}<li>{{spec}}</li>{{/if}}
          {{#if detailText}}<li>{{detailText}}</li>{{/if}}
        </ul>
        {{/if}}
        {{#if payment_schedule}}
        <div style="margin-top:4px; font-weight:700;">支払スケジュール</div>
        <table style="width:100%; border-collapse:collapse; font-size:8.5pt;">
          <tr><th class="l" style="width:8%;">回</th><th class="l">支払予定日</th><th class="right" style="width:30%;">金額</th></tr>
          {{#each payment_schedule}}
          <tr>
            <td class="center">{{index1 @index}}</td>
            <td>{{date}}</td>
            <td class="right">{{#if amount}}{{formatYen amount}}{{/if}}</td>
          </tr>
          {{/each}}
        </table>
        {{/if}}
      </td>
    </tr>
    {{/each}}
    {{else}}
    <!-- 単一明細フォールバック (items[] が空のとき) -->
    <tr class="item-main">
      <td class="center">1</td>
      <td class="l"><strong style="font-size:10pt;">{{ITEM_NAME}}</strong></td>
      <td class="right">1</td>
      <td class="right">-</td>
      <td class="right"><strong>¥ {{formatCurrency grandTotalExTax}}</strong></td>
    </tr>
    <tr class="item-detail">
      <td></td>
      <td colspan="4">
        支払方法：{{or CALC_METHOD PAYMENT_METHOD "FIXED"}}{{#if PAYMENT_TERMS}}（{{PAYMENT_TERMS}}）{{else}}{{#if PAYMENT_METHOD}}（{{PAYMENT_METHOD}}）{{/if}}{{/if}}
        　／　納期：{{formatDate DELIVERY_DATE}}
        　／　支払日：{{summaryPaymentTerms}}
      </td>
    </tr>
    {{/if}}
    <!-- 合計 -->
    <tr>
      <td colspan="4" class="right"><strong>確定額 小計（税抜）</strong></td>
      <td class="right">{{#if (gt (or itemsSubtotalExTax grandTotalExTax) 0)}}<strong>¥ {{formatCurrency (or itemsSubtotalExTax grandTotalExTax)}}</strong>{{else}}<span style="color:#888;">—</span>{{/if}}</td>
    </tr>
  </tbody>
</table>

{{#if has_license_conditions}}
<p style="margin-top:4px; font-size:8.5pt; color:#555;">※ 上記は本発注の利用許諾料（ROYALTY）明細に適用される条件です。発注の確定額（小計）には含まれず、別途、利用許諾料計算書により算定・支払われます。</p>
{{/if}}

<!-- ===== 利用許諾条件（利用許諾料・確定額外） ===== -->
{{#if has_license_conditions}}
<div class="section-mark">■ 利用許諾条件（利用許諾料・確定額外）</div>
<table class="items">
  <thead>
    <tr>
      <th style="width:4%;">#</th>
      <th class="l" style="width:26%;">条件名称 / 区分</th>
      <th class="l" style="width:34%;">計算式</th>
      <th class="l" style="width:18%;">料率 / 基準</th>
      <th class="right" style="width:18%;">MG / AG</th>
    </tr>
  </thead>
  <tbody>
    {{#if financial_conditions.length}}
    {{#each financial_conditions}}
    <tr>
      <td class="center">{{or condition_no (index1 @index)}}</td>
      <td class="l">{{#if condition_name}}{{condition_name}}{{else}}利用許諾条件{{/if}}{{#if region_language_label}}<div style="font-size:7.5pt;color:#666;">{{region_language_label}}</div>{{/if}}</td>
      <td class="l">{{#if (eq calc_type "BASE_QTY_RATE")}}基準価格 × 個数 × 料率{{/if}}{{#if (eq calc_type "BASE_RATE")}}基準価格 × 料率{{/if}}{{#if (eq calc_type "FIXED")}}固定値（{{#if (eq fixed_kind "INSTALLMENT")}}分割{{else}}一括{{/if}}）{{/if}}{{#if (eq calc_type "SUBSCRIPTION")}}サブスク（{{#if (eq subscription_cycle "ANNUAL")}}年払い{{else}}月払い{{/if}}）{{/if}}{{#if formula_text}}<div style="font-size:7.5pt;color:#666;">{{formula_text}}</div>{{/if}}</td>
      <td class="l">{{#if rate_pct}}<div>料率：{{rate_pct}}%</div>{{/if}}{{#if base_price_label}}<div style="font-size:7.5pt;color:#666;">基準価格：{{base_price_label}}</div>{{/if}}</td>
      <td class="right">{{#if (eq guarantee_type "MG")}}MG {{formatYen mg_amount}}{{/if}}{{#if (eq guarantee_type "AG")}}AG {{formatYen ag_amount}}{{/if}}</td>
    </tr>
    {{#if applies_scope}}
    <tr><td style="border-top:0;"></td><td colspan="4" class="l" style="border-top:0; font-size:7.5pt; color:#444;"><strong>適用範囲:</strong> {{applies_scope}}</td></tr>
    {{/if}}
    {{/each}}
    {{else}}
    {{#each items}}
    {{#if (eq calc_method "ROYALTY")}}
    <tr>
      <td class="center">{{or line_no (index1 @index)}}</td>
      <td class="l">{{#if condition_name}}{{condition_name}}{{else}}{{item_name}}{{/if}}{{#if region_language_label}}<div style="font-size:7.5pt;color:#666;">{{region_language_label}}</div>{{/if}}</td>
      <td class="l">{{#if (eq calc_type "BASE_QTY_RATE")}}基準価格 × 個数 × 料率{{/if}}{{#if (eq calc_type "BASE_RATE")}}基準価格 × 料率{{/if}}{{#if (eq calc_type "FIXED")}}固定値（{{#if (eq fixed_kind "INSTALLMENT")}}分割{{else}}一括{{/if}}）{{/if}}{{#if (eq calc_type "SUBSCRIPTION")}}サブスク（{{#if (eq subscription_cycle "ANNUAL")}}年払い{{else}}月払い{{/if}}）{{/if}}{{#if formula_text}}<div style="font-size:7.5pt;color:#666;">{{formula_text}}</div>{{/if}}</td>
      <td class="l">{{#if rate_pct}}<div>料率：{{rate_pct}}%</div>{{/if}}{{#if base_price_label}}<div style="font-size:7.5pt;color:#666;">基準価格：{{base_price_label}}</div>{{/if}}</td>
      <td class="right">{{#if (eq guarantee_type "MG")}}MG {{formatYen mg_amount}}{{/if}}{{#if (eq guarantee_type "AG")}}AG {{formatYen ag_amount}}{{/if}}</td>
    </tr>
    {{/if}}
    {{/each}}
    {{/if}}
  </tbody>
</table>
<div style="margin-top:4px; font-size:8.5pt; color:#555;">※ 上記は本発注の利用許諾料（ROYALTY）明細に適用される条件です。発注の確定額（小計）には含まれず、別途、利用許諾料計算書により算定・支払われます。</div>
{{/if}}

<!-- ===== その他手数料 ===== -->
{{#if other_fees}}
{{#if (gt (length other_fees) 0)}}
<div class="section-mark">■ その他手数料（税抜・合計に加算）</div>
<table class="items">
  <thead>
    <tr>
      <th style="width:6mm;">No</th>
      <th class="l">項目名</th>
      <th class="right" style="width:30mm;">金額（税抜）</th>
      <th class="l">摘要</th>
    </tr>
  </thead>
  <tbody>
    {{#each other_fees}}
    <tr>
      <td class="center">{{or line_no (index1 @index)}}</td>
      <td class="l"><strong>{{fee_name}}</strong></td>
      <td class="right">{{formatYen amount}}</td>
      <td class="l">{{remarks}}</td>
    </tr>
    {{/each}}
    <tr>
      <td colspan="2" class="right"><strong>手数料 小計（税抜）</strong></td>
      <td class="right"><strong>¥ {{formatCurrency otherFeesTotal}}</strong></td>
      <td></td>
    </tr>
  </tbody>
</table>

<table class="summary" style="margin-top:6px;">
  <tr>
    <th style="width:40%;">発注合計（税抜・業務委託 + 手数料）</th>
    <td>
      <strong class="total-amount">¥ {{formatCurrency grandTotalExTax}}</strong><br>
      <span class="amount-note">※ 業務委託 ¥{{formatCurrency (or itemsSubtotalExTax grandTotalExTax)}} ＋ 手数料 ¥{{formatCurrency otherFeesTotal}}</span>
    </td>
  </tr>
</table>
{{/if}}
{{/if}}

<!-- ===== 経費 ===== -->
{{#if expenses}}
{{#if (gt (length expenses) 0)}}
<div class="section-mark">■ 経費（交通費等／税込み額）</div>
<table class="items">
  <thead>
    <tr>
      <th style="width:6mm;">No</th>
      <th class="l">費目</th>
      <th class="center" style="width:24mm;">発生日</th>
      <th class="right" style="width:26mm;">金額（税込）</th>
      <th class="l">摘要</th>
    </tr>
  </thead>
  <tbody>
    {{#each expenses}}
    <tr>
      <td class="center">{{or line_no (index1 @index)}}</td>
      <td class="l"><strong>{{expense_name}}</strong>{{#if spec}}<div style="font-size:8pt;color:#666;">{{spec}}</div>{{/if}}</td>
      <td class="center">{{formatDate spent_date}}</td>
      <td class="right">{{formatYen amount_inc_tax}}</td>
      <td class="l">{{remarks}}</td>
    </tr>
    {{/each}}
    <tr>
      <td colspan="3" class="right"><strong>経費合計（税込）</strong></td>
      <td class="right"><strong>¥ {{formatCurrency expensesTotalIncTax}}</strong></td>
      <td></td>
    </tr>
  </tbody>
</table>
<p style="margin-top:4px; font-size:8.5pt; color:#555;">※ 経費は税込み額にて精算します。本発注書に記載の各項目の領収書原本またはそのコピーを添付してください。</p>
{{/if}}
{{/if}}

<!-- ===== 特約事項 ===== -->
{{#if SPECIAL_TERMS}}
<div class="terms-box">
  <strong class="terms-title">特約事項</strong>
  <div style="white-space:pre-wrap;">{{SPECIAL_TERMS}}</div>
</div>
{{/if}}

<!-- ===== 備考 ===== -->
{{#if REMARKS}}
<div class="terms-box">
  <strong class="terms-title">備考</strong>
  {{#if REMARKS_FIXED}}<div style="white-space:pre-wrap;">{{REMARKS_FIXED}}</div>{{/if}}
  {{#if REMARKS_FREE}}<div style="white-space:pre-wrap; margin-top:{{#if REMARKS_FIXED}}8px{{else}}0{{/if}};">{{REMARKS_FREE}}</div>{{/if}}
</div>
{{/if}}

<!-- ===== 準拠契約 / 適用約款 ===== -->
{{#if HAS_BASE_CONTRACT}}
<div class="callout">
  <strong>準拠契約:</strong> 本発注書は、甲乙間で締結済みの基本契約（{{MASTER_CONTRACT_REF}}）に基づき発行されるものであり、本発注書に定めのない事項については当該基本契約の定めによるものとします。
</div>
{{else}}
<div class="callout">
  <strong>適用約款:</strong> 本発注書には別紙「業務委託基本契約約款（スポット契約用・2026年改正法対応版）」が適用されます。受注者は本発注書を承諾することにより、当該約款にも同意したものとみなします。
</div>
{{/if}}

<!-- ===== 支払先情報 ===== -->
{{#if BANK_NAME}}
<div class="terms-box">
  <strong class="terms-title">支払先情報</strong>
  <table class="summary" style="margin-bottom:6px;">
    <tr><th>金融機関</th><td>{{BANK_NAME}} {{BRANCH_NAME}}</td></tr>
    <tr><th>口座</th><td>{{ACCOUNT_TYPE}} {{ACCOUNT_NUMBER}}</td></tr>
    <tr><th>口座名義</th><td>{{ACCOUNT_HOLDER_KANA}}</td></tr>
    {{#if INVOICE_REGISTRATION_NUMBER}}
    <tr><th>適格請求書発行事業者</th><td>登録番号: T{{INVOICE_REGISTRATION_NUMBER}}</td></tr>
    {{/if}}
  </table>
  {{#if TRANSFER_FEE_PAYER}}<span style="font-size:8.5pt; color:#555;">※ 振込手数料: {{TRANSFER_FEE_PAYER}}負担</span>{{/if}}
</div>
{{else}}
{{#if BANK_INFO}}
<div class="terms-box">
  <strong class="terms-title">支払先情報</strong>
  <div style="white-space:pre-wrap;">{{BANK_INFO}}</div>
  {{#if TRANSFER_FEE_PAYER}}<div style="font-size:8.5pt; color:#555; margin-top:4px;">※ 振込手数料: {{TRANSFER_FEE_PAYER}}負担</div>{{/if}}
</div>
{{/if}}
{{/if}}

<!-- ===== 通知先 ＋ 署名欄 ===== -->
{{#if SHOW_ORDER_SIGN_SECTION}}
<div class="section-mark">■ 通知先</div>
<table class="summary">
  <tr>
    <th>発注先（受注者）</th>
    <td>担当：{{VENDOR_CONTACT_NAME}}　／　TEL：{{VENDOR_CONTACT_PHONE}}　／　E-mail：{{VENDOR_EMAIL}}</td>
  </tr>
  <tr>
    <th>発注元（当社）</th>
    <td>担当：{{STAFF_NAME}}　／　TEL：{{STAFF_PHONE}}　／　E-mail：{{STAFF_EMAIL}}</td>
  </tr>
</table>
<p style="font-size:9pt; color:#555;">本発注に関する通知その他の連絡は、上記の通知先に対して行うものとします。基本契約がある場合は、その通知条項に従います。</p>

<div class="section-mark">■ 署名欄</div>
<table class="summary" style="margin-top:6px;">
  <tr>
    <th style="width:50%;">発注者（甲）</th>
    <th style="width:50%;">受注者（乙）</th>
  </tr>
  <tr>
    <td>
      <div>{{PARTY_A_NAME}}</div>
      <div style="font-size:8.5pt; color:#555;">{{PARTY_A_ADDRESS}}</div>
      <div style="margin-top:4px;">{{PARTY_A_REP}}</div>
      <div class="sign-box"></div>
    </td>
    <td>
      <div>{{VENDOR_NAME}}</div>
      <div style="font-size:8.5pt; color:#555;">{{VENDOR_ADDRESS}}</div>
      <div style="margin-top:4px;">{{#if VENDOR_REPRESENTATIVE_SAMA}}{{VENDOR_REPRESENTATIVE_SAMA}}{{else}}{{VENDOR_CONTACT_NAME}}{{/if}}</div>
      <div class="sign-box"></div>
    </td>
  </tr>
</table>
{{/if}}

<!-- ===== 受領確認（承諾） ===== -->
{{#if (or ACCEPT_METHOD SHOW_SIGN_SECTION)}}
<div class="section-mark">■ 受領確認（承諾）</div>
{{#if ACCEPT_METHOD}}
<div class="callout">
  <strong>承諾方法</strong><br>
  <span style="color:#555;">{{ACCEPT_METHOD}}{{#if ACCEPT_REPLY_DUE_DATE}}<br>返信期限: {{ACCEPT_REPLY_DUE_DATE}}{{/if}}</span>
  {{#if ACCEPT_BY_PERFORMANCE}}<span style="color:#555; margin-top:6px; display:block;">なお、受注者が本発注に基づく業務へ着手した場合、その時点で本発注内容に承諾したものとして取り扱うことがあります。</span>{{/if}}
</div>
{{/if}}
{{#if SHOW_SIGN_SECTION}}
<table class="summary" style="margin-top:6px;">
  <tr>
    <th>受領日（承諾日）</th>
    <td>{{formatDate VENDOR_ACCEPT_DATE}}</td>
  </tr>
  {{#if (eq VENDOR_IS_CORPORATION "法人")}}
  <tr>
    <th>会社名（受注者）</th>
    <td>{{VENDOR_NAME}}{{#if VENDOR_SUFFIX}} {{VENDOR_SUFFIX}}{{/if}}</td>
  </tr>
  {{/if}}
  <tr>
    <th style="vertical-align:top;">受領者（承諾者）</th>
    <td>
      {{VENDOR_ACCEPT_NAME}}
      <div class="sign-box"></div>
      <div style="font-size:8.5pt; color:#555; margin-top:4px;">※ 記名押印（または署名）欄{{#if (eq VENDOR_IS_CORPORATION "法人")}} — 受注者の権限ある代表者または担当者の記名押印をお願いします{{/if}}</div>
    </td>
  </tr>
</table>
{{/if}}
{{/if}}

{{!-- 基本契約なしの場合は標準約款（terms_spot_2026）を別紙としてPDF末尾に添付 --}}
{{#unless HAS_BASE_CONTRACT}}
{{> terms_spot_2026}}
{{/unless}}
</body>
</html>
$po_html$,
          COALESCE(cur_schema, '[]'::jsonb),
          '発注書: サブスク明細の納期/支払日の逆転修正＋当月/翌月/翌々月払いの明示 (0112)', 'migration-0112')
  RETURNING id INTO vid;

  UPDATE document_templates SET current_version_id = vid, updated_at = now() WHERE id = tid;
END $mig_po$;

DO $mig_ipo$
DECLARE
  tid INTEGER;
  cur_html TEXT;
  cur_schema JSONB;
  vid INTEGER;
BEGIN
  SELECT dt.id, v.html_source, v.field_schema
    INTO tid, cur_html, cur_schema
    FROM document_templates dt
    LEFT JOIN document_template_versions v ON v.id = dt.current_version_id
   WHERE dt.template_key = 'intl_purchase_order';

  IF tid IS NULL THEN
    RAISE NOTICE '0112: intl_purchase_order template not found, skipping';
    RETURN;
  END IF;

  IF cur_html IS NOT DISTINCT FROM $ipo_html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Independent Contractor Agreement — Order Form</title>
<style>
  /* Part 1 は国内発注書 (purchase_order.html 新デザイン) と同一構造。
     外貨対応: 金額は formatYen を使わず CURRENCY コード + formatMoney (小数2桁対応)。 */
  body { font-family:'Noto Sans','Helvetica Neue',Arial,'Noto Sans CJK JP','Meiryo',sans-serif; font-size:10pt; line-height:1.5; color:#111; margin:0; padding:16px; word-break:break-word; overflow-wrap:anywhere; }
  h1.doc-title { font-size:22pt; margin:0 0 4px; letter-spacing:2px; }
  .doc-head { text-align:center; margin-bottom:8px; }
  .doc-sub { font-size:9pt; color:#555; }
  hr.rule { border:none; border-top:2px solid #111; margin:0 0 14px; }
  table { border-collapse:collapse; }
  .party { width:100%; margin-bottom:14px; }
  .party td { vertical-align:top; }
  .party .vlabel { font-size:8pt; font-weight:700; color:#555; margin-bottom:3px; }
  .vendor-name { font-size:13pt; font-weight:800; border-bottom:1px solid #111; padding-bottom:3px; margin-bottom:6px; }
  .muted { font-size:9pt; color:#555; }
  .section-mark { font-size:10pt; font-weight:800; margin:12px 0 6px; border-left:4px solid #111; padding-left:8px; }
  table.summary { width:100%; margin-bottom:12px; font-size:10pt; }
  table.summary th { width:30%; background:#f3f3f3; border:1px solid #cfcfcf; padding:7px 8px; text-align:left; }
  table.summary td { border:1px solid #cfcfcf; padding:7px 8px; }
  .total-amount { font-size:13pt; font-weight:800; }
  .amount-note { font-size:8.5pt; color:#555; }
  table.items { width:100%; font-size:9pt; margin-top:4px; table-layout:fixed; }
  table.items th { background:#f3f3f3; border:1px solid #cfcfcf; padding:7px 8px; }
  table.items td { border:1px solid #cfcfcf; padding:7px 8px; vertical-align:top; }
  table.items th.l, table.items td.l { text-align:left; }
  .center { text-align:center; }
  .right { text-align:right; }
  .item-main td { border-bottom:none; padding:8px 8px 4px; }
  .item-detail td { border-top:1px dashed #cfcfcf; padding:3px 8px 8px; font-size:8.5pt; color:#555; }
  .item-detail ul { margin:4px 0 0; padding-left:16px; color:#333; line-height:1.55; }
  .tag { display:inline-block; font-size:7.5pt; font-weight:800; background:#eef; color:#334; border-radius:3px; padding:1px 5px; margin-right:4px; }
  .royalty-tag { background:#fef3c7; color:#92400e; }
  .royalty-aside { color:#92400e; font-size:8pt; }
  .callout { border:1px solid #cfcfcf; border-left:4px solid #111; padding:8px 10px; font-size:9pt; margin-top:12px; }
  .terms-box { border:1px solid #cfcfcf; padding:10px; margin-top:12px; }
  .terms-title { display:block; border-bottom:1px solid #111; padding-bottom:3px; margin-bottom:6px; font-weight:800; }
  .sign-box { height:22mm; border:1px solid #cfcfcf; margin-top:4px; }
  .incl-note { font-size:7.5pt; color:#92400e; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  /* ── Part 2 (Schedule A) 用 ── */
  .terms-wrap { line-height: 1.7; font-size: 10pt; page-break-before: always; }
  .terms-doc-title { text-align: center; font-size: 14pt; font-weight: 700; letter-spacing: 0.05em; margin: 0 0 2mm 0; }
  .terms-ver { text-align: right; font-size: 9pt; color: #444; margin: 0 0 5mm 0; }
  .terms-lead { margin: 0 0 5mm 0; }
  .terms-h { font-size: 10.5pt; font-weight: 700; background: #f2f2f2; padding: 4px 9px; border-left: 4px solid #111; margin: 6mm 0 2.5mm 0; break-after: avoid; page-break-after: avoid; }
  .terms-ol { margin: 0 0 1.5mm 0; padding-left: 18px; }
  .terms-ol > li { margin: 0 0 1.8mm 0; }
  .terms-sub { list-style: none; padding-left: 0; margin: 1mm 0 0 0; }
  .terms-sub li { padding-left: 1.5em; text-indent: -1.5em; margin: 0 0 1.2mm 0; }
  ol, li { break-inside: avoid; page-break-inside: avoid; }
  .prec-table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 4px; }
  .prec-table td { border: 1px solid #cfcfcf; padding: 4px 8px; }
  .prec-table td:first-child { width: 8%; text-align: center; font-weight: 700; background: #f3f3f3; }
</style>
</head>
<body>

<!-- ════════ PART 1 — ORDER FORM ════════ -->

<!-- ===== ヘッダ ===== -->
<div class="doc-head">
  <h1 class="doc-title">ORDER FORM</h1>
  <div class="doc-sub">Independent Contractor Agreement</div>
  <div class="doc-sub">
    Issue Date: {{or OF_DATE "—"}}
    　／　Order Form No.: {{or OF_NO ORDER_NO}}{{#if isReissue}}{{#unless (eq showReissueBanner false)}}　(Orig.: {{BASE_DOC_NO}}){{/unless}}{{/if}}
    　／　Currency: <strong>{{or CURRENCY "—"}}</strong>
  </div>
</div>
<hr class="rule">

<!-- ===== 宛先 ＋ 発注者 ===== -->
<table class="party">
  <tr>
    <td style="width:50%; padding-right:12px;">
      <div class="vlabel">CONTRACTOR</div>
      <div class="vendor-name">{{CONTRACTOR_NAME}}</div>
      {{#if CONTRACTOR_ADDRESS}}<div class="muted" style="white-space:pre-wrap;">{{CONTRACTOR_ADDRESS}}</div>{{/if}}
      {{#if CONTRACTOR_COUNTRY}}<div class="muted">{{CONTRACTOR_COUNTRY}}</div>{{/if}}
      {{#if CONTRACTOR_EMAIL}}<div class="muted" style="margin-top:2px;">E-mail: {{CONTRACTOR_EMAIL}}</div>{{/if}}
      <div style="margin-top:10px; font-size:9pt;">This Order Form, together with <strong>Schedule A</strong> attached hereto, constitutes a binding agreement. Please review and confirm.</div>
      {{#if PROJECT_TITLE}}<div style="margin-top:8px; font-size:10pt;">Project: <strong>{{PROJECT_TITLE}}</strong></div>{{/if}}
    </td>
    <td style="width:50%; padding-left:12px; border-left:1px solid #cfcfcf;">
      <div class="vlabel">COMPANY / CLIENT</div>
      <div style="font-weight:900; font-size:12pt; margin-bottom:4px;">{{COMPANY_NAME}}</div>
      <div style="white-space:pre-wrap;">{{COMPANY_ADDRESS}}</div>
      {{#if COMPANY_REP}}<div style="margin-top:2px;">{{COMPANY_REP}}</div>{{/if}}
      {{#if STAFF_NAME}}
      <div style="margin-top:8px; padding-top:6px; border-top:1px solid #cfcfcf; font-size:9pt;">
        {{#if STAFF_DEPARTMENT}}<strong>Dept.:</strong> {{STAFF_DEPARTMENT}}<br>{{/if}}
        <strong>Contact:</strong> {{STAFF_NAME}}<br>
        {{#if STAFF_PHONE}}Tel: {{STAFF_PHONE}}<br>{{/if}}
        {{#if STAFF_EMAIL}}E-mail: {{STAFF_EMAIL}}{{/if}}
      </div>
      {{/if}}
    </td>
  </tr>
</table>

<!-- ===== 発注概要 ===== -->
<div class="section-mark">■ ORDER SUMMARY</div>
<table class="summary">
  <tr>
    <th>Fixed Fees — Subtotal<br><span style="font-size:8pt;color:#888;font-weight:400;">(Excl. Tax / Withholding)</span></th>
    <td>
      {{#if (gt grandTotalFees 0)}}
      <strong class="total-amount">{{CURRENCY}} {{formatMoney grandTotalFees}}</strong><br>
      <span class="amount-note">* Taxes and withholding are governed by Article 7 of Schedule A.</span>
      {{else}}
      <strong style="color:#92400e;">Fees are included in the license royalties</strong>
      <span class="amount-note">/ calculated as stated in the line items below</span>
      {{/if}}
    </td>
  </tr>
  <tr>
    <th>License Royalties</th>
    <td>
      {{#if has_seller_owned_license}}
      <strong style="color:#92400e;">Calculated separately</strong>
      <span style="font-size:8pt; color:#666;">/ per Royalty Statement (see ROYALTY line items and License Conditions below)</span>
      {{else}}
      <span style="color:#888;">—</span>
      {{/if}}
    </td>
  </tr>
  <tr>
    <th>Currency</th>
    <td><strong>{{or CURRENCY "—"}}</strong>{{#if CURRENCY}} <span class="amount-note">— all amounts in this Order Form are stated in {{CURRENCY}} unless noted otherwise.</span>{{/if}}</td>
  </tr>
  <tr>
    <th>Order Date</th>
    <td>{{or OF_DATE "—"}}</td>
  </tr>
  <tr>
    <th>Completion / Delivery<br><span style="font-size:8pt;color:#888;font-weight:400;">(or Service Period)</span></th>
    <td>{{or summaryCompletionDate "As per line items"}}</td>
  </tr>
  <tr>
    <th>Payment Due Date</th>
    <td>{{or summaryPaymentDate "As per line items"}}</td>
  </tr>
</table>

<!-- ===== 業務明細（2行レイアウト） ===== -->
<div class="section-mark">■ SERVICES &amp; DELIVERABLES</div>
<table class="items">
  <thead>
    <tr>
      <th style="width:5%;">No.</th>
      <th class="l" style="width:45%;">Service / Deliverable</th>
      <th class="center" style="width:10%;">Qty</th>
      <th class="right" style="width:19%;">Unit Fee{{#if CURRENCY}} ({{CURRENCY}}){{/if}}</th>
      <th class="right" style="width:21%;">Amount{{#if CURRENCY}} ({{CURRENCY}}){{/if}}</th>
    </tr>
  </thead>
  <tbody>
    {{#if items}}
    {{#each items}}
    <!-- 1行目：核心情報 -->
    <tr class="item-main">
      <td class="center">{{or line_no (index1 @index)}}</td>
      <td class="l">
        {{#if category}}<span class="tag">{{category}}</span>{{/if}}
        <strong style="font-size:10pt;">{{item_name}}</strong>
      </td>
      <td class="right">{{or quantity qty}}</td>
      <td class="right">{{#if (eq calc_method "ROYALTY")}}{{#if (gt (or amount_ex_tax amount) 0)}}{{formatMoney (or unit_price unitPrice)}}{{else}}<span style="color:#888;">-</span>{{/if}}{{else}}{{formatMoney (or unit_price unitPrice)}}{{/if}}</td>
      <td class="right">{{#if (eq calc_method "ROYALTY")}}{{#if (gt (or amount_ex_tax amount) 0)}}<strong>{{formatMoney (or amount_ex_tax amount)}}</strong><div class="incl-note">Fixed fee (royalties separate)</div>{{else}}<div class="incl-note">Fees included in<br>license royalties</div>{{/if}}{{else}}<strong>{{formatMoney (or amount_ex_tax amount)}}</strong>{{/if}}</td>
    </tr>
    <!-- 2行目：詳細情報 -->
    <tr class="item-detail">
      <td></td>
      <td colspan="4">
        [IP Ownership] {{#if (eq deliverable_ownership "受注者")}}Contractor (license model){{else}}Company (assignment){{/if}}
        　／　Payment: {{or calc_method payment_method_display payment_method "FIXED"}}{{#if payment_terms}} ({{payment_terms}}){{else}}{{#if payment_method}} ({{payment_method}}){{/if}}{{/if}}
        　／　{{#if (eq calc_method "SUBSCRIPTION")}}Service Period{{else}}Delivery{{/if}}: {{#if (eq calc_method "SUBSCRIPTION")}}{{cycleLabelEn cycle interval_unit interval_count}} / {{#if term_start}}{{formatDateCompact term_start}}{{else}}—{{/if}} – {{#if term_end}}{{formatDateCompact term_end}}{{else}}ongoing{{/if}}{{else}}{{#if delivery_date}}{{formatDateCompact delivery_date}}{{else}}—{{/if}}{{/if}}
        　／　Payment Date: {{#if (eq calc_method "SUBSCRIPTION")}}{{or (billingDayLabelEn billing_day cycle billing_timing) "TBD"}}{{else}}{{#if (eq calc_method "ROYALTY")}}{{#unless (gt (or amount_ex_tax amount) 0)}}Per Royalty Statement{{else}}{{#if payment_date}}{{formatDateCompact payment_date}}{{else}}—{{/if}}{{/unless}}{{else}}{{#if payment_date}}{{formatDateCompact payment_date}}{{else}}—{{/if}}{{/if}}{{/if}}
        {{#if (eq calc_method "ROYALTY")}}
        <div style="margin-top:4px;"><span class="tag royalty-tag">ROYALTY</span>{{#if (eq royalty_calc_basis "manufacturing")}}Qty × Base Price × Rate{{else}}{{#if (eq royalty_calc_basis "sales")}}Net Sales × Rate{{else}}{{#if (eq royalty_calc_basis "sublicense")}}Amounts Received × Rate{{else}}{{#if (eq royalty_calc_basis "fixed")}}Fixed amount{{else}}Qty × Base Price × Rate{{/if}}{{/if}}{{/if}}{{/if}}{{#if rate_pct}} ・Rate {{rate_pct}}%{{/if}}<span class="royalty-aside"> / royalties are invoiced and paid separately per Royalty Statement</span></div>
        {{/if}}
        {{#if (or spec detailText)}}
        <ul>
          {{#if spec}}<li>{{spec}}</li>{{/if}}
          {{#if detailText}}<li>{{detailText}}</li>{{/if}}
        </ul>
        {{/if}}
        {{#if acceptance_cond}}
        <div style="margin-top:4px;"><strong>Acceptance:</strong> {{acceptance_cond}}</div>
        {{/if}}
        {{#if payment_schedule}}
        <div style="margin-top:4px; font-weight:700;">Payment Schedule</div>
        <table style="width:100%; border-collapse:collapse; font-size:8.5pt;">
          <tr><th class="l" style="width:8%;">No.</th><th class="l">Payment Date</th><th class="right" style="width:30%;">Amount</th></tr>
          {{#each payment_schedule}}
          <tr>
            <td class="center">{{index1 @index}}</td>
            <td>{{date}}</td>
            <td class="right">{{#if amount}}{{../../CURRENCY}} {{formatMoney amount}}{{/if}}</td>
          </tr>
          {{/each}}
        </table>
        {{/if}}
      </td>
    </tr>
    {{/each}}
    {{else}}
    <!-- 単一明細フォールバック (items[] が空のとき) -->
    <tr class="item-main">
      <td class="center">1</td>
      <td class="l"><strong style="font-size:10pt;">{{ITEM_NAME}}</strong></td>
      <td class="right">1</td>
      <td class="right">-</td>
      <td class="right"><strong>{{formatMoney grandTotalFees}}</strong></td>
    </tr>
    <tr class="item-detail">
      <td></td>
      <td colspan="4">
        Payment: {{or CALC_METHOD PAYMENT_METHOD "FIXED"}}{{#if PAYMENT_TERMS}} ({{PAYMENT_TERMS}}){{else}}{{#if PAYMENT_METHOD}} ({{PAYMENT_METHOD}}){{/if}}{{/if}}
        　／　Delivery: {{or summaryCompletionDate "—"}}
        　／　Payment Date: {{or summaryPaymentDate "—"}}
      </td>
    </tr>
    {{/if}}
    <!-- 合計 -->
    <tr>
      <td colspan="4" class="right"><strong>Subtotal — Fixed Fees (Excl. Tax / Withholding)</strong></td>
      <td class="right">{{#if (gt (or itemsSubtotalExTax grandTotalFees) 0)}}<strong>{{CURRENCY}} {{formatMoney (or itemsSubtotalExTax grandTotalFees)}}</strong>{{else}}<span style="color:#888;">—</span>{{/if}}</td>
    </tr>
  </tbody>
</table>

<!-- ===== 利用許諾条件（利用許諾料・確定額外） ===== -->
{{#if has_license_conditions}}
<div class="section-mark">■ LICENSE CONDITIONS (Royalties — outside Fixed Fees)</div>
<table class="items">
  <thead>
    <tr>
      <th style="width:4%;">#</th>
      <th class="l" style="width:26%;">Condition / Scope</th>
      <th class="l" style="width:34%;">Formula</th>
      <th class="l" style="width:16%;">Rate / Basis</th>
      <th class="right" style="width:20%;">MG / AG</th>
    </tr>
  </thead>
  <tbody>
    {{#if financial_conditions.length}}
    {{#each financial_conditions}}
    <tr>
      <td class="center">{{or condition_no (index1 @index)}}</td>
      <td class="l">{{#if condition_name}}{{condition_name}}{{else}}License condition{{/if}}{{#if region_language_label}}<div style="font-size:7.5pt;color:#666;">{{region_language_label}}</div>{{/if}}</td>
      <td class="l">{{#if (eq calc_type "BASE_QTY_RATE")}}Base Price × Qty × Rate{{/if}}{{#if (eq calc_type "BASE_RATE")}}Base Price × Rate{{/if}}{{#if (eq calc_type "FIXED")}}Fixed ({{#if (eq fixed_kind "INSTALLMENT")}}installments{{else}}lump sum{{/if}}){{/if}}{{#if (eq calc_type "SUBSCRIPTION")}}Subscription ({{#if (eq subscription_cycle "ANNUAL")}}annual{{else}}monthly{{/if}}){{/if}}{{#if formula_text}}<div style="font-size:7.5pt;color:#666;">{{formula_text}}</div>{{/if}}</td>
      <td class="l">{{#if rate_pct}}<div>Rate: {{rate_pct}}%</div>{{/if}}{{#if base_price_label}}<div style="font-size:7.5pt;color:#666;">Base price: {{base_price_label}}</div>{{/if}}</td>
      <td class="right">{{#if (eq guarantee_type "MG")}}MG {{../CURRENCY}} {{formatMoney mg_amount}}{{/if}}{{#if (eq guarantee_type "AG")}}AG {{../CURRENCY}} {{formatMoney ag_amount}}{{/if}}</td>
    </tr>
    {{#if applies_scope}}
    <tr><td style="border-top:0;"></td><td colspan="4" class="l" style="border-top:0; font-size:7.5pt; color:#444;"><strong>Applies to:</strong> {{applies_scope}}</td></tr>
    {{/if}}
    {{/each}}
    {{else}}
    {{#each items}}
    {{#if (eq calc_method "ROYALTY")}}
    <tr>
      <td class="center">{{or line_no (index1 @index)}}</td>
      <td class="l">{{#if condition_name}}{{condition_name}}{{else}}{{item_name}}{{/if}}{{#if region_language_label}}<div style="font-size:7.5pt;color:#666;">{{region_language_label}}</div>{{/if}}</td>
      <td class="l">{{#if (eq calc_type "BASE_QTY_RATE")}}Base Price × Qty × Rate{{/if}}{{#if (eq calc_type "BASE_RATE")}}Base Price × Rate{{/if}}{{#if (eq calc_type "FIXED")}}Fixed ({{#if (eq fixed_kind "INSTALLMENT")}}installments{{else}}lump sum{{/if}}){{/if}}{{#if (eq calc_type "SUBSCRIPTION")}}Subscription ({{#if (eq subscription_cycle "ANNUAL")}}annual{{else}}monthly{{/if}}){{/if}}{{#if formula_text}}<div style="font-size:7.5pt;color:#666;">{{formula_text}}</div>{{/if}}</td>
      <td class="l">{{#if rate_pct}}<div>Rate: {{rate_pct}}%</div>{{/if}}{{#if base_price_label}}<div style="font-size:7.5pt;color:#666;">Base price: {{base_price_label}}</div>{{/if}}</td>
      <td class="right">{{#if (eq guarantee_type "MG")}}MG {{../CURRENCY}} {{formatMoney mg_amount}}{{/if}}{{#if (eq guarantee_type "AG")}}AG {{../CURRENCY}} {{formatMoney ag_amount}}{{/if}}</td>
    </tr>
    {{/if}}
    {{/each}}
    {{/if}}
  </tbody>
</table>
<div style="margin-top:4px; font-size:8.5pt; color:#555;">* The above conditions apply to the ROYALTY line items of this Order Form. Royalties are not included in the Fixed Fees subtotal and are calculated and paid separately per Royalty Statement.</div>
{{/if}}

<!-- ===== 個人データ ===== -->
<div class="callout">
  <strong>Personal Data:</strong>
  No processing of customer, visitor, lead, inquiry, end-user, or other third-party personal data is permitted unless expressly authorized in writing by the Company. Ordinary communications, payment administration, personnel coordination, performance of services, and delivery of deliverables are permitted to the extent necessary for the applicable Order Form.
</div>

<!-- ===== 特約事項 ===== -->
{{#if SPECIAL_TERMS}}
<div class="terms-box">
  <strong class="terms-title">Special Terms</strong>
  <div style="white-space:pre-wrap;">{{SPECIAL_TERMS}}</div>
</div>
{{/if}}

<!-- ===== 備考 ===== -->
{{#if REMARKS}}
<div class="terms-box">
  <strong class="terms-title">Remarks / Notes</strong>
  {{#if REMARKS_FIXED}}<div style="white-space:pre-wrap;">{{REMARKS_FIXED}}</div>{{/if}}
  {{#if REMARKS_FREE}}<div style="white-space:pre-wrap; margin-top:{{#if REMARKS_FIXED}}8px{{else}}0{{/if}};">{{REMARKS_FREE}}</div>{{/if}}
</div>
{{/if}}

<!-- ===== 適用約款 ===== -->
<div class="callout">
  <strong>Applicable Terms:</strong>
  This Order Form is subject to the Independent Contractor Standard Terms set out in <strong>Schedule A</strong>. In the event of any conflict, the order of precedence in Article 1 of Schedule A applies. By signing, electronically accepting, or commencing performance, the Contractor agrees to all terms herein.
</div>

<!-- ===== 準拠法 ===== -->
{{#if GOVERNING_LAW}}
<div class="callout" style="margin-top:6px;">
  <strong>Governing Law:</strong> {{GOVERNING_LAW}}
  {{#if DISPUTE_RESOLUTION}}<br><strong>Dispute Resolution:</strong> {{DISPUTE_RESOLUTION}}{{/if}}
</div>
{{/if}}

<!-- ===== 支払先情報（海外送金） ===== -->
{{#if BANK_NAME}}
<div class="terms-box">
  <strong class="terms-title">Payment Details (Wire Transfer)</strong>
  <table class="summary" style="margin-bottom:6px;">
    <tr><th>Beneficiary Bank</th><td>{{BANK_NAME}}{{#if BRANCH_NAME}}, {{BRANCH_NAME}}{{/if}}</td></tr>
    {{#if SWIFT_BIC}}<tr><th>SWIFT / BIC</th><td><strong>{{SWIFT_BIC}}</strong></td></tr>{{/if}}
    {{#if IBAN}}<tr><th>IBAN</th><td>{{IBAN}}</td></tr>{{/if}}
    {{#if INTERMEDIARY_BANK}}<tr><th>Intermediary Bank</th><td>{{INTERMEDIARY_BANK}}</td></tr>{{/if}}
    {{#if ACCOUNT_TYPE}}<tr><th>Account Type</th><td>{{ACCOUNT_TYPE}}</td></tr>{{/if}}
    {{#if ACCOUNT_NUMBER}}<tr><th>Account No.</th><td>{{ACCOUNT_NUMBER}}</td></tr>{{/if}}
    <tr><th>Account Holder</th><td>{{ACCOUNT_HOLDER}}{{#if ACCOUNT_HOLDER_LOCAL}}<br><span class="amount-note">({{ACCOUNT_HOLDER_LOCAL}})</span>{{/if}}</td></tr>
    {{#if TAX_REGISTRATION_NO}}<tr><th>Tax Reg. No.</th><td>{{TAX_REGISTRATION_NO}}</td></tr>{{/if}}
  </table>
  {{#if TRANSFER_FEE_CODE}}<span style="font-size:8.5pt; color:#555;">* Bank charges: <strong>{{TRANSFER_FEE_CODE}}</strong></span>{{/if}}
</div>
{{/if}}

<!-- ===== 受領確認（承諾） ===== -->
{{#if (or ACCEPT_METHOD SHOW_SIGN_SECTION)}}
<div class="section-mark">■ ACCEPTANCE &amp; SIGNATURE</div>
{{#if ACCEPT_METHOD}}
<div class="callout">
  <strong>Acceptance Procedure</strong><br>
  <span style="color:#555;">{{ACCEPT_METHOD}}{{#if ACCEPT_REPLY_DUE_DATE}}<br>Reply deadline: {{ACCEPT_REPLY_DUE_DATE}}{{/if}}</span>
</div>
{{/if}}
{{#if SHOW_SIGN_SECTION}}
<table class="summary" style="margin-top:6px;">
  <tr>
    <th>Contractor — Acceptance</th>
    <td>
      <div>{{CONTRACTOR_NAME}}</div>
      <div style="font-size:8.5pt; color:#555; white-space:pre-wrap;">{{CONTRACTOR_ADDRESS}}{{#if CONTRACTOR_COUNTRY}}, {{CONTRACTOR_COUNTRY}}{{/if}}</div>
      <div class="sign-box"></div>
      <div style="display:flex; align-items:flex-end; gap:8px; margin-top:8px;">
        <span style="font-size:8.5pt; color:#555; white-space:nowrap;">Date:</span>
        <span style="flex:1; border-bottom:1px solid #aaa; min-width:80px; display:inline-block;">&nbsp;</span>
      </div>
      {{#if CONTRACTOR_ACCEPT_DATE}}<div style="margin-top:3px; font-size:7.5pt; color:#aaa;">* Write date or enter: {{CONTRACTOR_ACCEPT_DATE}}</div>{{/if}}
    </td>
  </tr>
</table>
{{/if}}
{{/if}}


<!-- ════════ PART 2 — SCHEDULE A: INDEPENDENT CONTRACTOR STANDARD TERMS ════════ -->

<div class="terms-wrap">
  <div class="terms-doc-title">Schedule A — Independent Contractor Standard Terms</div>
  <div class="terms-ver">({{TERMS_VERSION_DATE}})</div>

  <div class="terms-lead">
    These Standard Terms, together with each applicable Order Form, any Data Processing Addendum
    ("DPA"), and any incorporated specifications, constitute the entire agreement ("Agreement")
    between the Company and the Contractor.
  </div>

  <div class="terms-h">Article 1 — Order of Precedence</div>
  <ol class="terms-ol">
    <li>Where documents conflict, the following order governs:
      <table class="prec-table">
        <tr><td>(a)</td><td>Special Terms in the Order Form</td></tr>
        <tr><td>(b)</td><td>The Order Form or Statement of Work</td></tr>
        <tr><td>(c)</td><td>Any DPA (data protection matters only)</td></tr>
        <tr><td>(d)</td><td>These Standard Terms</td></tr>
      </table>
    </li>
    <li>No terms proposed by the Contractor — including terms on invoices, emails, or online forms — apply unless expressly accepted in writing by the Company.</li>
  </ol>

  <div class="terms-h">Article 2 — Formation of Agreement</div>
  <ol class="terms-ol">
    <li>Each Order Form becomes binding when the Contractor signs it, confirms acceptance in writing, or commences performance with knowledge of its terms. Silence does not constitute acceptance. The Company may withdraw any Order Form before acceptance.</li>
    <li>Each Order Form shall specify: services, deliverables, fees, payment due date, acceptance criteria, completion date, and any special requirements.</li>
  </ol>

  <div class="terms-h">Article 3 — Independent Contractor Status</div>
  <ol class="terms-ol">
    <li>The Contractor is an independent contractor, not an employee, agent, or partner of the Company. This Agreement does not create an employment relationship.</li>
    <li>The Contractor determines the manner and means of performing the services, subject to the requirements set out in the Order Form.</li>
    <li>The Contractor is solely responsible for all taxes, social security contributions, insurance, and regulatory obligations applicable in the Contractor's jurisdiction, except for taxes the Company is legally required to withhold.</li>
  </ol>

  <div class="terms-h">Article 4 — Services and Deliverables</div>
  <ol class="terms-ol">
    <li>The Contractor shall perform the services and provide the deliverables described in the Order Form with the skill, care, and diligence reasonably expected of a qualified professional in the relevant field.</li>
    <li>Unless the Order Form provides otherwise, the Contractor shall supply its own equipment and working environment at its own cost.</li>
  </ol>

  <div class="terms-h">Article 5 — Service Warranty; Remedies</div>
  <ol class="terms-ol">
    <li>The Contractor expressly warrants that: (i) all services will be performed with the skill, care, and diligence reasonably expected of a qualified professional; and (ii) all deliverables will conform to the description, quality, and specifications in the Order Form (the "<strong>Warranty</strong>").</li>
    <li>If any deliverable or service fails to satisfy the Warranty ("<strong>Non-Conforming Performance</strong>"), the Company may — by written notice within the period in Article 5.4 — elect one or more of the following contractual remedies (independent of any statutory regime): (i) <strong>Cure</strong> — require repair, replacement, or re-performance within a period designated by the Company; (ii) <strong>Fee Reduction</strong> — reduce fees in proportion to the deficiency where cure is unavailable or not timely; or (iii) <strong>Damages</strong> — claim compensation for direct loss, including costs of substitute performance.</li>
    <li>These remedies are cumulative.</li>
    <li>The Company must notify the Contractor in writing of Non-Conforming Performance within <strong>six (6) months</strong> after acceptance of the relevant deliverable or completion of services. This limitation does not apply where the deficiency is attributable to the Contractor's fraud, willful misconduct, or gross negligence.</li>
    <li>The Company shall not unilaterally reduce fees or reject deliverables on grounds outside this Article.</li>
  </ol>

  <div class="terms-h">Article 6 — Fees and Payment</div>
  <ol class="terms-ol">
    <li>The Company shall pay the fees stated in the Order Form (exclusive of taxes and withholding) on the payment due date stated in the Order Form.</li>
    <li>The Company shall not reduce agreed fees or delay payment except in accordance with this Agreement. If mandatory law requires a shorter payment period or stricter terms, such law prevails.</li>
    <li>Payment shall be made by wire transfer or equivalent, with all transfer charges borne by the Company (OUR) unless the Order Form states otherwise.</li>
    <li>Late payment accrues interest at {{LATE_PAYMENT_RATE}} per annum, calculated daily from the day after the due date until actual payment.</li>
  </ol>

  <div class="terms-h">Article 7 — Taxes and Withholding</div>
  <ol class="terms-ol">
    <li>All fees are exclusive of taxes unless the Order Form states otherwise. The Contractor is responsible for all taxes and charges applicable in the Contractor's jurisdiction, except for taxes the Company is legally required to withhold.</li>
    <li>If the Company is required to withhold tax, it shall do so and provide the Contractor with appropriate documentation. The Contractor shall provide any tax residency certificate, treaty form, or other documentation requested for tax compliance or treaty benefit purposes. The Company has no obligation to gross up withheld amounts unless the Order Form expressly provides otherwise.</li>
  </ol>

  <div class="terms-h">Article 8 — Delivery and Acceptance</div>
  <ol class="terms-ol">
    <li>The Contractor shall deliver each deliverable by the deadline and in the manner specified in the Order Form. The Company shall inspect and notify the Contractor of acceptance or rejection in accordance with the acceptance criteria and period in the relevant line item.</li>
    <li>If the Company gives no notification within the inspection period, the deliverable is deemed accepted for defects reasonably discoverable upon inspection — but deemed acceptance does not waive the Company's rights under Article 5 regarding latent defects.</li>
    <li>Acceptance of a deliverable does not limit the Company's rights under Article 5 with respect to latent defects or non-conforming performance not reasonably discoverable during the inspection period. Ownership and license rights in deliverables are governed by Article 9.</li>
  </ol>

  <div class="terms-h">Article 9 — Intellectual Property</div>
  <ol class="terms-ol">
    <li><strong>Assignment.</strong> Unless the Order Form specifies a license model, all IP rights in deliverables created by the Contractor for the Company are assigned to the Company upon full payment. The Contractor shall execute any documents needed to perfect the assignment. Where moral rights cannot be assigned, the Contractor agrees not to assert them against the Company or its licensees.</li>
    <li><strong>Background Materials.</strong> The Contractor retains ownership of pre-existing materials, tools, and know-how developed independently of this Agreement. To the extent Background Materials are incorporated into deliverables, the Contractor grants the Company a worldwide, perpetual, irrevocable, royalty-free, sublicensable license to use them as part of the deliverables.</li>
    <li><strong>Third-Party Materials.</strong> The Contractor shall not incorporate any third-party materials (including AI-generated content, open-source software, stock content, or images) into deliverables without first obtaining all necessary licenses and disclosing such materials to the Company in writing.</li>
  </ol>

  <div class="terms-h">Article 10 — AI Tools and Open-Source Software</div>
  <ol class="terms-ol">
    <li>The Contractor shall not use generative AI, code-generation, or similar tools unless approved in writing by the Company for the relevant Order Form. Where approved, the Contractor shall disclose upon request: the tool name and version; whether Company or personal data was input; and any restrictions on the Company's use of the output.</li>
    <li>The Contractor shall not input any personal data, confidential information, credentials, or non-public Company materials into any AI tool without the Company's prior written consent.</li>
    <li>The Contractor shall not incorporate open-source software into deliverables in any manner that would require the Company's proprietary code or data to be disclosed or licensed under open-source terms, without the Company's prior written approval.</li>
  </ol>

  <div class="terms-h">Article 11 — IP Warranties</div>
  <ol class="terms-ol">
    <li>The Contractor warrants that deliverables do not infringe any third-party intellectual property rights and that no third-party rights prevent the Company from using them as intended. Where third-party materials are incorporated, the Contractor shall hold all necessary licenses before delivery.</li>
    <li>If a third party brings a claim against the Company arising from the Contractor's breach of this Article, the Contractor shall defend and indemnify the Company at its own cost. This indemnity does not apply to claims arising from Company-Designated Materials.</li>
    <li>"<strong>Company-Designated Materials</strong>" are materials provided by or specifically directed by the Company. The Company warrants that it holds the rights needed for the Contractor's use. Claims arising from Company-Designated Materials are the Company's responsibility, except where caused by the Contractor's unauthorized use.</li>
  </ol>

  <div class="terms-h">Article 12 — Confidentiality</div>
  <ol class="terms-ol">
    <li>Each party shall keep the other's confidential information strictly confidential, not disclose it to third parties without prior written consent, and use it only for performance of this Agreement. Standard exceptions apply (public domain, independent development, legal compulsion with prior notice where permitted).</li>
    <li>These obligations survive termination for <strong>{{NDA_SURVIVAL_YEARS}} years</strong>.</li>
    <li>The Contractor shall obtain the Company's prior written consent before displaying any deliverables as portfolio items or on public channels.</li>
  </ol>

  <div class="terms-h">Article 13 — Personal Data Protection</div>
  <ol class="terms-ol">
    <li>The Contractor may process personal data only to the extent necessary for ordinary communications, payment administration, personnel or staff coordination, performance of the services, and delivery of the deliverables under the applicable Order Form.</li>
    <li>The Contractor shall not collect, copy, scan, photograph, export, disclose, transfer, or otherwise process any customer, visitor, lead, inquiry, end-user, or other third-party personal data unless the Company has expressly authorized such processing in writing.</li>
    <li>The Contractor shall implement reasonable technical and organizational measures to protect personal data handled in connection with this Agreement against unauthorized access, disclosure, loss, destruction, alteration, or misuse.</li>
    <li>The Contractor shall not disclose or transfer personal data to any third party, including subcontractors, staffing agencies, or assistants, except to the extent necessary for the performance of the services or with the Company's prior written consent.</li>
    <li>If the Contractor becomes aware of any actual or suspected unauthorized access, disclosure, loss, or misuse of personal data, the Contractor shall notify the Company promptly and cooperate in taking reasonable remedial measures.</li>
    <li>Upon completion of the services or upon the Company's request, the Contractor shall return or securely delete personal data received from or processed on behalf of the Company, unless retention is required by applicable law.</li>
    <li>If the Contractor is required to process customer data, visitor data, lead information, end-user data, or other personal data beyond the scope of Article 13.1, the parties shall agree in writing on additional data protection terms, including a data processing addendum where required by applicable law.</li>
  </ol>

  <div class="terms-h">Article 14 — Customer Flow-Down Requirements</div>
  <div>The Contractor shall comply with any customer-specific security, confidentiality, data protection, or compliance requirements notified by the Company in writing. If the Contractor cannot comply, it shall notify the Company before commencing the affected services.</div>

  <div class="terms-h">Article 15 — No Assignment</div>
  <div>The Contractor may not assign or transfer any rights or obligations under this Agreement without the Company's prior written consent. Any change of control of the Company does not give the Contractor a right to terminate.</div>

  <div class="terms-h">Article 16 — Subcontracting</div>
  <ol class="terms-ol">
    <li>The Contractor shall not engage any third party — including crowd-workers or AI-based agents — to perform any material part of the services without the Company's prior written consent.</li>
    <li>Approved subcontractors must be bound by obligations at least as protective as those in this Agreement. The Contractor remains fully liable for its subcontractors' acts and omissions.</li>
  </ol>

  <div class="terms-h">Article 17 — Sanctions; Anti-Corruption</div>
  <div>The Contractor warrants that it is not subject to any applicable sanctions list and has not violated any anti-bribery or anti-corruption law in connection with this Agreement. Breach of this Article entitles the Company to terminate immediately without compensation, and the Contractor shall indemnify the Company for resulting losses.</div>

  <div class="terms-h">Article 18 — Termination; Liability</div>
  <ol class="terms-ol">
    <li>The Company may terminate for the Contractor's material breach not cured within <strong>14 days</strong> of written notice. The Contractor may terminate for the Company's material breach not cured within <strong>30 days</strong> of written notice.</li>
    <li>Except for Excluded Claims, the Contractor's total liability under an Order Form shall not exceed the total fees paid or payable under that Order Form.</li>
    <li>Neither party shall be liable to the other for indirect, incidental, special, punitive, or consequential damages, including loss of profits, revenue, data, or business opportunity, except to the extent arising from Excluded Claims.</li>
    <li>"<strong>Excluded Claims</strong>" — to which no cap applies — means the Contractor's liability for: (i) fraud, willful misconduct, or gross negligence; (ii) breach of confidentiality; (iii) breach of data protection obligations; (iv) IP infringement or misappropriation; (v) breach of sanctions or anti-corruption obligations; or (vi) unauthorized subcontracting.</li>
  </ol>

  <div class="terms-h">Article 19 — Force Majeure</div>
  <ol class="terms-ol">
    <li>A party affected by an event genuinely beyond its reasonable control (excluding economic conditions, currency movements, cost increases, and personal circumstances of the Contractor) is excused from affected obligations during the event, provided it notifies the other party in writing within <strong>5 business days</strong> and uses reasonable efforts to mitigate.</li>
    <li>Fees for work performed or deliverables accepted before the event remain payable. If a Force Majeure Event affecting the Contractor persists for more than <strong>30 consecutive days</strong>, the Company may terminate immediately without compensation for unperformed work.</li>
  </ol>

  <div class="terms-h">Article 20 — Entire Agreement; Amendments</div>
  <div>This Agreement is the entire agreement on its subject matter and supersedes all prior representations and understandings. Amendments require written signatures of both parties, except that the Company may issue written instructions that supplement scope without altering fees or payment terms. No waiver of breach constitutes a waiver of future breaches.</div>

  <div class="terms-h">Article 21 — Settlement on Early Termination</div>
  <div>On early termination, fees shall be settled on a pro-rata basis reflecting work completed and accepted up to the termination date.</div>

  <div class="terms-h">Article 22 — Governing Law and Dispute Resolution</div>
  <div>The governing law and dispute resolution mechanism applicable to this Agreement shall be as stated in the Order Form. Where the Order Form does not specify, the parties shall agree in writing before commencing any dispute resolution process.</div>

  <div class="terms-h">Article 23 — Miscellaneous</div>
  <div>Unaddressed matters shall be resolved by good-faith discussion. If any provision is held invalid, the remainder continues in full force. These Terms prevail over any conflicting Contractor terms unless expressly agreed otherwise in writing.</div>

</div>
</body>
</html>
$ipo_html$ THEN
    RAISE NOTICE '0112: intl_purchase_order already up to date, skipping';
    RETURN;
  END IF;

  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  VALUES (tid,
          COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id = tid), 0) + 1,
          $ipo_html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Independent Contractor Agreement — Order Form</title>
<style>
  /* Part 1 は国内発注書 (purchase_order.html 新デザイン) と同一構造。
     外貨対応: 金額は formatYen を使わず CURRENCY コード + formatMoney (小数2桁対応)。 */
  body { font-family:'Noto Sans','Helvetica Neue',Arial,'Noto Sans CJK JP','Meiryo',sans-serif; font-size:10pt; line-height:1.5; color:#111; margin:0; padding:16px; word-break:break-word; overflow-wrap:anywhere; }
  h1.doc-title { font-size:22pt; margin:0 0 4px; letter-spacing:2px; }
  .doc-head { text-align:center; margin-bottom:8px; }
  .doc-sub { font-size:9pt; color:#555; }
  hr.rule { border:none; border-top:2px solid #111; margin:0 0 14px; }
  table { border-collapse:collapse; }
  .party { width:100%; margin-bottom:14px; }
  .party td { vertical-align:top; }
  .party .vlabel { font-size:8pt; font-weight:700; color:#555; margin-bottom:3px; }
  .vendor-name { font-size:13pt; font-weight:800; border-bottom:1px solid #111; padding-bottom:3px; margin-bottom:6px; }
  .muted { font-size:9pt; color:#555; }
  .section-mark { font-size:10pt; font-weight:800; margin:12px 0 6px; border-left:4px solid #111; padding-left:8px; }
  table.summary { width:100%; margin-bottom:12px; font-size:10pt; }
  table.summary th { width:30%; background:#f3f3f3; border:1px solid #cfcfcf; padding:7px 8px; text-align:left; }
  table.summary td { border:1px solid #cfcfcf; padding:7px 8px; }
  .total-amount { font-size:13pt; font-weight:800; }
  .amount-note { font-size:8.5pt; color:#555; }
  table.items { width:100%; font-size:9pt; margin-top:4px; table-layout:fixed; }
  table.items th { background:#f3f3f3; border:1px solid #cfcfcf; padding:7px 8px; }
  table.items td { border:1px solid #cfcfcf; padding:7px 8px; vertical-align:top; }
  table.items th.l, table.items td.l { text-align:left; }
  .center { text-align:center; }
  .right { text-align:right; }
  .item-main td { border-bottom:none; padding:8px 8px 4px; }
  .item-detail td { border-top:1px dashed #cfcfcf; padding:3px 8px 8px; font-size:8.5pt; color:#555; }
  .item-detail ul { margin:4px 0 0; padding-left:16px; color:#333; line-height:1.55; }
  .tag { display:inline-block; font-size:7.5pt; font-weight:800; background:#eef; color:#334; border-radius:3px; padding:1px 5px; margin-right:4px; }
  .royalty-tag { background:#fef3c7; color:#92400e; }
  .royalty-aside { color:#92400e; font-size:8pt; }
  .callout { border:1px solid #cfcfcf; border-left:4px solid #111; padding:8px 10px; font-size:9pt; margin-top:12px; }
  .terms-box { border:1px solid #cfcfcf; padding:10px; margin-top:12px; }
  .terms-title { display:block; border-bottom:1px solid #111; padding-bottom:3px; margin-bottom:6px; font-weight:800; }
  .sign-box { height:22mm; border:1px solid #cfcfcf; margin-top:4px; }
  .incl-note { font-size:7.5pt; color:#92400e; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  /* ── Part 2 (Schedule A) 用 ── */
  .terms-wrap { line-height: 1.7; font-size: 10pt; page-break-before: always; }
  .terms-doc-title { text-align: center; font-size: 14pt; font-weight: 700; letter-spacing: 0.05em; margin: 0 0 2mm 0; }
  .terms-ver { text-align: right; font-size: 9pt; color: #444; margin: 0 0 5mm 0; }
  .terms-lead { margin: 0 0 5mm 0; }
  .terms-h { font-size: 10.5pt; font-weight: 700; background: #f2f2f2; padding: 4px 9px; border-left: 4px solid #111; margin: 6mm 0 2.5mm 0; break-after: avoid; page-break-after: avoid; }
  .terms-ol { margin: 0 0 1.5mm 0; padding-left: 18px; }
  .terms-ol > li { margin: 0 0 1.8mm 0; }
  .terms-sub { list-style: none; padding-left: 0; margin: 1mm 0 0 0; }
  .terms-sub li { padding-left: 1.5em; text-indent: -1.5em; margin: 0 0 1.2mm 0; }
  ol, li { break-inside: avoid; page-break-inside: avoid; }
  .prec-table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 4px; }
  .prec-table td { border: 1px solid #cfcfcf; padding: 4px 8px; }
  .prec-table td:first-child { width: 8%; text-align: center; font-weight: 700; background: #f3f3f3; }
</style>
</head>
<body>

<!-- ════════ PART 1 — ORDER FORM ════════ -->

<!-- ===== ヘッダ ===== -->
<div class="doc-head">
  <h1 class="doc-title">ORDER FORM</h1>
  <div class="doc-sub">Independent Contractor Agreement</div>
  <div class="doc-sub">
    Issue Date: {{or OF_DATE "—"}}
    　／　Order Form No.: {{or OF_NO ORDER_NO}}{{#if isReissue}}{{#unless (eq showReissueBanner false)}}　(Orig.: {{BASE_DOC_NO}}){{/unless}}{{/if}}
    　／　Currency: <strong>{{or CURRENCY "—"}}</strong>
  </div>
</div>
<hr class="rule">

<!-- ===== 宛先 ＋ 発注者 ===== -->
<table class="party">
  <tr>
    <td style="width:50%; padding-right:12px;">
      <div class="vlabel">CONTRACTOR</div>
      <div class="vendor-name">{{CONTRACTOR_NAME}}</div>
      {{#if CONTRACTOR_ADDRESS}}<div class="muted" style="white-space:pre-wrap;">{{CONTRACTOR_ADDRESS}}</div>{{/if}}
      {{#if CONTRACTOR_COUNTRY}}<div class="muted">{{CONTRACTOR_COUNTRY}}</div>{{/if}}
      {{#if CONTRACTOR_EMAIL}}<div class="muted" style="margin-top:2px;">E-mail: {{CONTRACTOR_EMAIL}}</div>{{/if}}
      <div style="margin-top:10px; font-size:9pt;">This Order Form, together with <strong>Schedule A</strong> attached hereto, constitutes a binding agreement. Please review and confirm.</div>
      {{#if PROJECT_TITLE}}<div style="margin-top:8px; font-size:10pt;">Project: <strong>{{PROJECT_TITLE}}</strong></div>{{/if}}
    </td>
    <td style="width:50%; padding-left:12px; border-left:1px solid #cfcfcf;">
      <div class="vlabel">COMPANY / CLIENT</div>
      <div style="font-weight:900; font-size:12pt; margin-bottom:4px;">{{COMPANY_NAME}}</div>
      <div style="white-space:pre-wrap;">{{COMPANY_ADDRESS}}</div>
      {{#if COMPANY_REP}}<div style="margin-top:2px;">{{COMPANY_REP}}</div>{{/if}}
      {{#if STAFF_NAME}}
      <div style="margin-top:8px; padding-top:6px; border-top:1px solid #cfcfcf; font-size:9pt;">
        {{#if STAFF_DEPARTMENT}}<strong>Dept.:</strong> {{STAFF_DEPARTMENT}}<br>{{/if}}
        <strong>Contact:</strong> {{STAFF_NAME}}<br>
        {{#if STAFF_PHONE}}Tel: {{STAFF_PHONE}}<br>{{/if}}
        {{#if STAFF_EMAIL}}E-mail: {{STAFF_EMAIL}}{{/if}}
      </div>
      {{/if}}
    </td>
  </tr>
</table>

<!-- ===== 発注概要 ===== -->
<div class="section-mark">■ ORDER SUMMARY</div>
<table class="summary">
  <tr>
    <th>Fixed Fees — Subtotal<br><span style="font-size:8pt;color:#888;font-weight:400;">(Excl. Tax / Withholding)</span></th>
    <td>
      {{#if (gt grandTotalFees 0)}}
      <strong class="total-amount">{{CURRENCY}} {{formatMoney grandTotalFees}}</strong><br>
      <span class="amount-note">* Taxes and withholding are governed by Article 7 of Schedule A.</span>
      {{else}}
      <strong style="color:#92400e;">Fees are included in the license royalties</strong>
      <span class="amount-note">/ calculated as stated in the line items below</span>
      {{/if}}
    </td>
  </tr>
  <tr>
    <th>License Royalties</th>
    <td>
      {{#if has_seller_owned_license}}
      <strong style="color:#92400e;">Calculated separately</strong>
      <span style="font-size:8pt; color:#666;">/ per Royalty Statement (see ROYALTY line items and License Conditions below)</span>
      {{else}}
      <span style="color:#888;">—</span>
      {{/if}}
    </td>
  </tr>
  <tr>
    <th>Currency</th>
    <td><strong>{{or CURRENCY "—"}}</strong>{{#if CURRENCY}} <span class="amount-note">— all amounts in this Order Form are stated in {{CURRENCY}} unless noted otherwise.</span>{{/if}}</td>
  </tr>
  <tr>
    <th>Order Date</th>
    <td>{{or OF_DATE "—"}}</td>
  </tr>
  <tr>
    <th>Completion / Delivery<br><span style="font-size:8pt;color:#888;font-weight:400;">(or Service Period)</span></th>
    <td>{{or summaryCompletionDate "As per line items"}}</td>
  </tr>
  <tr>
    <th>Payment Due Date</th>
    <td>{{or summaryPaymentDate "As per line items"}}</td>
  </tr>
</table>

<!-- ===== 業務明細（2行レイアウト） ===== -->
<div class="section-mark">■ SERVICES &amp; DELIVERABLES</div>
<table class="items">
  <thead>
    <tr>
      <th style="width:5%;">No.</th>
      <th class="l" style="width:45%;">Service / Deliverable</th>
      <th class="center" style="width:10%;">Qty</th>
      <th class="right" style="width:19%;">Unit Fee{{#if CURRENCY}} ({{CURRENCY}}){{/if}}</th>
      <th class="right" style="width:21%;">Amount{{#if CURRENCY}} ({{CURRENCY}}){{/if}}</th>
    </tr>
  </thead>
  <tbody>
    {{#if items}}
    {{#each items}}
    <!-- 1行目：核心情報 -->
    <tr class="item-main">
      <td class="center">{{or line_no (index1 @index)}}</td>
      <td class="l">
        {{#if category}}<span class="tag">{{category}}</span>{{/if}}
        <strong style="font-size:10pt;">{{item_name}}</strong>
      </td>
      <td class="right">{{or quantity qty}}</td>
      <td class="right">{{#if (eq calc_method "ROYALTY")}}{{#if (gt (or amount_ex_tax amount) 0)}}{{formatMoney (or unit_price unitPrice)}}{{else}}<span style="color:#888;">-</span>{{/if}}{{else}}{{formatMoney (or unit_price unitPrice)}}{{/if}}</td>
      <td class="right">{{#if (eq calc_method "ROYALTY")}}{{#if (gt (or amount_ex_tax amount) 0)}}<strong>{{formatMoney (or amount_ex_tax amount)}}</strong><div class="incl-note">Fixed fee (royalties separate)</div>{{else}}<div class="incl-note">Fees included in<br>license royalties</div>{{/if}}{{else}}<strong>{{formatMoney (or amount_ex_tax amount)}}</strong>{{/if}}</td>
    </tr>
    <!-- 2行目：詳細情報 -->
    <tr class="item-detail">
      <td></td>
      <td colspan="4">
        [IP Ownership] {{#if (eq deliverable_ownership "受注者")}}Contractor (license model){{else}}Company (assignment){{/if}}
        　／　Payment: {{or calc_method payment_method_display payment_method "FIXED"}}{{#if payment_terms}} ({{payment_terms}}){{else}}{{#if payment_method}} ({{payment_method}}){{/if}}{{/if}}
        　／　{{#if (eq calc_method "SUBSCRIPTION")}}Service Period{{else}}Delivery{{/if}}: {{#if (eq calc_method "SUBSCRIPTION")}}{{cycleLabelEn cycle interval_unit interval_count}} / {{#if term_start}}{{formatDateCompact term_start}}{{else}}—{{/if}} – {{#if term_end}}{{formatDateCompact term_end}}{{else}}ongoing{{/if}}{{else}}{{#if delivery_date}}{{formatDateCompact delivery_date}}{{else}}—{{/if}}{{/if}}
        　／　Payment Date: {{#if (eq calc_method "SUBSCRIPTION")}}{{or (billingDayLabelEn billing_day cycle billing_timing) "TBD"}}{{else}}{{#if (eq calc_method "ROYALTY")}}{{#unless (gt (or amount_ex_tax amount) 0)}}Per Royalty Statement{{else}}{{#if payment_date}}{{formatDateCompact payment_date}}{{else}}—{{/if}}{{/unless}}{{else}}{{#if payment_date}}{{formatDateCompact payment_date}}{{else}}—{{/if}}{{/if}}{{/if}}
        {{#if (eq calc_method "ROYALTY")}}
        <div style="margin-top:4px;"><span class="tag royalty-tag">ROYALTY</span>{{#if (eq royalty_calc_basis "manufacturing")}}Qty × Base Price × Rate{{else}}{{#if (eq royalty_calc_basis "sales")}}Net Sales × Rate{{else}}{{#if (eq royalty_calc_basis "sublicense")}}Amounts Received × Rate{{else}}{{#if (eq royalty_calc_basis "fixed")}}Fixed amount{{else}}Qty × Base Price × Rate{{/if}}{{/if}}{{/if}}{{/if}}{{#if rate_pct}} ・Rate {{rate_pct}}%{{/if}}<span class="royalty-aside"> / royalties are invoiced and paid separately per Royalty Statement</span></div>
        {{/if}}
        {{#if (or spec detailText)}}
        <ul>
          {{#if spec}}<li>{{spec}}</li>{{/if}}
          {{#if detailText}}<li>{{detailText}}</li>{{/if}}
        </ul>
        {{/if}}
        {{#if acceptance_cond}}
        <div style="margin-top:4px;"><strong>Acceptance:</strong> {{acceptance_cond}}</div>
        {{/if}}
        {{#if payment_schedule}}
        <div style="margin-top:4px; font-weight:700;">Payment Schedule</div>
        <table style="width:100%; border-collapse:collapse; font-size:8.5pt;">
          <tr><th class="l" style="width:8%;">No.</th><th class="l">Payment Date</th><th class="right" style="width:30%;">Amount</th></tr>
          {{#each payment_schedule}}
          <tr>
            <td class="center">{{index1 @index}}</td>
            <td>{{date}}</td>
            <td class="right">{{#if amount}}{{../../CURRENCY}} {{formatMoney amount}}{{/if}}</td>
          </tr>
          {{/each}}
        </table>
        {{/if}}
      </td>
    </tr>
    {{/each}}
    {{else}}
    <!-- 単一明細フォールバック (items[] が空のとき) -->
    <tr class="item-main">
      <td class="center">1</td>
      <td class="l"><strong style="font-size:10pt;">{{ITEM_NAME}}</strong></td>
      <td class="right">1</td>
      <td class="right">-</td>
      <td class="right"><strong>{{formatMoney grandTotalFees}}</strong></td>
    </tr>
    <tr class="item-detail">
      <td></td>
      <td colspan="4">
        Payment: {{or CALC_METHOD PAYMENT_METHOD "FIXED"}}{{#if PAYMENT_TERMS}} ({{PAYMENT_TERMS}}){{else}}{{#if PAYMENT_METHOD}} ({{PAYMENT_METHOD}}){{/if}}{{/if}}
        　／　Delivery: {{or summaryCompletionDate "—"}}
        　／　Payment Date: {{or summaryPaymentDate "—"}}
      </td>
    </tr>
    {{/if}}
    <!-- 合計 -->
    <tr>
      <td colspan="4" class="right"><strong>Subtotal — Fixed Fees (Excl. Tax / Withholding)</strong></td>
      <td class="right">{{#if (gt (or itemsSubtotalExTax grandTotalFees) 0)}}<strong>{{CURRENCY}} {{formatMoney (or itemsSubtotalExTax grandTotalFees)}}</strong>{{else}}<span style="color:#888;">—</span>{{/if}}</td>
    </tr>
  </tbody>
</table>

<!-- ===== 利用許諾条件（利用許諾料・確定額外） ===== -->
{{#if has_license_conditions}}
<div class="section-mark">■ LICENSE CONDITIONS (Royalties — outside Fixed Fees)</div>
<table class="items">
  <thead>
    <tr>
      <th style="width:4%;">#</th>
      <th class="l" style="width:26%;">Condition / Scope</th>
      <th class="l" style="width:34%;">Formula</th>
      <th class="l" style="width:16%;">Rate / Basis</th>
      <th class="right" style="width:20%;">MG / AG</th>
    </tr>
  </thead>
  <tbody>
    {{#if financial_conditions.length}}
    {{#each financial_conditions}}
    <tr>
      <td class="center">{{or condition_no (index1 @index)}}</td>
      <td class="l">{{#if condition_name}}{{condition_name}}{{else}}License condition{{/if}}{{#if region_language_label}}<div style="font-size:7.5pt;color:#666;">{{region_language_label}}</div>{{/if}}</td>
      <td class="l">{{#if (eq calc_type "BASE_QTY_RATE")}}Base Price × Qty × Rate{{/if}}{{#if (eq calc_type "BASE_RATE")}}Base Price × Rate{{/if}}{{#if (eq calc_type "FIXED")}}Fixed ({{#if (eq fixed_kind "INSTALLMENT")}}installments{{else}}lump sum{{/if}}){{/if}}{{#if (eq calc_type "SUBSCRIPTION")}}Subscription ({{#if (eq subscription_cycle "ANNUAL")}}annual{{else}}monthly{{/if}}){{/if}}{{#if formula_text}}<div style="font-size:7.5pt;color:#666;">{{formula_text}}</div>{{/if}}</td>
      <td class="l">{{#if rate_pct}}<div>Rate: {{rate_pct}}%</div>{{/if}}{{#if base_price_label}}<div style="font-size:7.5pt;color:#666;">Base price: {{base_price_label}}</div>{{/if}}</td>
      <td class="right">{{#if (eq guarantee_type "MG")}}MG {{../CURRENCY}} {{formatMoney mg_amount}}{{/if}}{{#if (eq guarantee_type "AG")}}AG {{../CURRENCY}} {{formatMoney ag_amount}}{{/if}}</td>
    </tr>
    {{#if applies_scope}}
    <tr><td style="border-top:0;"></td><td colspan="4" class="l" style="border-top:0; font-size:7.5pt; color:#444;"><strong>Applies to:</strong> {{applies_scope}}</td></tr>
    {{/if}}
    {{/each}}
    {{else}}
    {{#each items}}
    {{#if (eq calc_method "ROYALTY")}}
    <tr>
      <td class="center">{{or line_no (index1 @index)}}</td>
      <td class="l">{{#if condition_name}}{{condition_name}}{{else}}{{item_name}}{{/if}}{{#if region_language_label}}<div style="font-size:7.5pt;color:#666;">{{region_language_label}}</div>{{/if}}</td>
      <td class="l">{{#if (eq calc_type "BASE_QTY_RATE")}}Base Price × Qty × Rate{{/if}}{{#if (eq calc_type "BASE_RATE")}}Base Price × Rate{{/if}}{{#if (eq calc_type "FIXED")}}Fixed ({{#if (eq fixed_kind "INSTALLMENT")}}installments{{else}}lump sum{{/if}}){{/if}}{{#if (eq calc_type "SUBSCRIPTION")}}Subscription ({{#if (eq subscription_cycle "ANNUAL")}}annual{{else}}monthly{{/if}}){{/if}}{{#if formula_text}}<div style="font-size:7.5pt;color:#666;">{{formula_text}}</div>{{/if}}</td>
      <td class="l">{{#if rate_pct}}<div>Rate: {{rate_pct}}%</div>{{/if}}{{#if base_price_label}}<div style="font-size:7.5pt;color:#666;">Base price: {{base_price_label}}</div>{{/if}}</td>
      <td class="right">{{#if (eq guarantee_type "MG")}}MG {{../CURRENCY}} {{formatMoney mg_amount}}{{/if}}{{#if (eq guarantee_type "AG")}}AG {{../CURRENCY}} {{formatMoney ag_amount}}{{/if}}</td>
    </tr>
    {{/if}}
    {{/each}}
    {{/if}}
  </tbody>
</table>
<div style="margin-top:4px; font-size:8.5pt; color:#555;">* The above conditions apply to the ROYALTY line items of this Order Form. Royalties are not included in the Fixed Fees subtotal and are calculated and paid separately per Royalty Statement.</div>
{{/if}}

<!-- ===== 個人データ ===== -->
<div class="callout">
  <strong>Personal Data:</strong>
  No processing of customer, visitor, lead, inquiry, end-user, or other third-party personal data is permitted unless expressly authorized in writing by the Company. Ordinary communications, payment administration, personnel coordination, performance of services, and delivery of deliverables are permitted to the extent necessary for the applicable Order Form.
</div>

<!-- ===== 特約事項 ===== -->
{{#if SPECIAL_TERMS}}
<div class="terms-box">
  <strong class="terms-title">Special Terms</strong>
  <div style="white-space:pre-wrap;">{{SPECIAL_TERMS}}</div>
</div>
{{/if}}

<!-- ===== 備考 ===== -->
{{#if REMARKS}}
<div class="terms-box">
  <strong class="terms-title">Remarks / Notes</strong>
  {{#if REMARKS_FIXED}}<div style="white-space:pre-wrap;">{{REMARKS_FIXED}}</div>{{/if}}
  {{#if REMARKS_FREE}}<div style="white-space:pre-wrap; margin-top:{{#if REMARKS_FIXED}}8px{{else}}0{{/if}};">{{REMARKS_FREE}}</div>{{/if}}
</div>
{{/if}}

<!-- ===== 適用約款 ===== -->
<div class="callout">
  <strong>Applicable Terms:</strong>
  This Order Form is subject to the Independent Contractor Standard Terms set out in <strong>Schedule A</strong>. In the event of any conflict, the order of precedence in Article 1 of Schedule A applies. By signing, electronically accepting, or commencing performance, the Contractor agrees to all terms herein.
</div>

<!-- ===== 準拠法 ===== -->
{{#if GOVERNING_LAW}}
<div class="callout" style="margin-top:6px;">
  <strong>Governing Law:</strong> {{GOVERNING_LAW}}
  {{#if DISPUTE_RESOLUTION}}<br><strong>Dispute Resolution:</strong> {{DISPUTE_RESOLUTION}}{{/if}}
</div>
{{/if}}

<!-- ===== 支払先情報（海外送金） ===== -->
{{#if BANK_NAME}}
<div class="terms-box">
  <strong class="terms-title">Payment Details (Wire Transfer)</strong>
  <table class="summary" style="margin-bottom:6px;">
    <tr><th>Beneficiary Bank</th><td>{{BANK_NAME}}{{#if BRANCH_NAME}}, {{BRANCH_NAME}}{{/if}}</td></tr>
    {{#if SWIFT_BIC}}<tr><th>SWIFT / BIC</th><td><strong>{{SWIFT_BIC}}</strong></td></tr>{{/if}}
    {{#if IBAN}}<tr><th>IBAN</th><td>{{IBAN}}</td></tr>{{/if}}
    {{#if INTERMEDIARY_BANK}}<tr><th>Intermediary Bank</th><td>{{INTERMEDIARY_BANK}}</td></tr>{{/if}}
    {{#if ACCOUNT_TYPE}}<tr><th>Account Type</th><td>{{ACCOUNT_TYPE}}</td></tr>{{/if}}
    {{#if ACCOUNT_NUMBER}}<tr><th>Account No.</th><td>{{ACCOUNT_NUMBER}}</td></tr>{{/if}}
    <tr><th>Account Holder</th><td>{{ACCOUNT_HOLDER}}{{#if ACCOUNT_HOLDER_LOCAL}}<br><span class="amount-note">({{ACCOUNT_HOLDER_LOCAL}})</span>{{/if}}</td></tr>
    {{#if TAX_REGISTRATION_NO}}<tr><th>Tax Reg. No.</th><td>{{TAX_REGISTRATION_NO}}</td></tr>{{/if}}
  </table>
  {{#if TRANSFER_FEE_CODE}}<span style="font-size:8.5pt; color:#555;">* Bank charges: <strong>{{TRANSFER_FEE_CODE}}</strong></span>{{/if}}
</div>
{{/if}}

<!-- ===== 受領確認（承諾） ===== -->
{{#if (or ACCEPT_METHOD SHOW_SIGN_SECTION)}}
<div class="section-mark">■ ACCEPTANCE &amp; SIGNATURE</div>
{{#if ACCEPT_METHOD}}
<div class="callout">
  <strong>Acceptance Procedure</strong><br>
  <span style="color:#555;">{{ACCEPT_METHOD}}{{#if ACCEPT_REPLY_DUE_DATE}}<br>Reply deadline: {{ACCEPT_REPLY_DUE_DATE}}{{/if}}</span>
</div>
{{/if}}
{{#if SHOW_SIGN_SECTION}}
<table class="summary" style="margin-top:6px;">
  <tr>
    <th>Contractor — Acceptance</th>
    <td>
      <div>{{CONTRACTOR_NAME}}</div>
      <div style="font-size:8.5pt; color:#555; white-space:pre-wrap;">{{CONTRACTOR_ADDRESS}}{{#if CONTRACTOR_COUNTRY}}, {{CONTRACTOR_COUNTRY}}{{/if}}</div>
      <div class="sign-box"></div>
      <div style="display:flex; align-items:flex-end; gap:8px; margin-top:8px;">
        <span style="font-size:8.5pt; color:#555; white-space:nowrap;">Date:</span>
        <span style="flex:1; border-bottom:1px solid #aaa; min-width:80px; display:inline-block;">&nbsp;</span>
      </div>
      {{#if CONTRACTOR_ACCEPT_DATE}}<div style="margin-top:3px; font-size:7.5pt; color:#aaa;">* Write date or enter: {{CONTRACTOR_ACCEPT_DATE}}</div>{{/if}}
    </td>
  </tr>
</table>
{{/if}}
{{/if}}


<!-- ════════ PART 2 — SCHEDULE A: INDEPENDENT CONTRACTOR STANDARD TERMS ════════ -->

<div class="terms-wrap">
  <div class="terms-doc-title">Schedule A — Independent Contractor Standard Terms</div>
  <div class="terms-ver">({{TERMS_VERSION_DATE}})</div>

  <div class="terms-lead">
    These Standard Terms, together with each applicable Order Form, any Data Processing Addendum
    ("DPA"), and any incorporated specifications, constitute the entire agreement ("Agreement")
    between the Company and the Contractor.
  </div>

  <div class="terms-h">Article 1 — Order of Precedence</div>
  <ol class="terms-ol">
    <li>Where documents conflict, the following order governs:
      <table class="prec-table">
        <tr><td>(a)</td><td>Special Terms in the Order Form</td></tr>
        <tr><td>(b)</td><td>The Order Form or Statement of Work</td></tr>
        <tr><td>(c)</td><td>Any DPA (data protection matters only)</td></tr>
        <tr><td>(d)</td><td>These Standard Terms</td></tr>
      </table>
    </li>
    <li>No terms proposed by the Contractor — including terms on invoices, emails, or online forms — apply unless expressly accepted in writing by the Company.</li>
  </ol>

  <div class="terms-h">Article 2 — Formation of Agreement</div>
  <ol class="terms-ol">
    <li>Each Order Form becomes binding when the Contractor signs it, confirms acceptance in writing, or commences performance with knowledge of its terms. Silence does not constitute acceptance. The Company may withdraw any Order Form before acceptance.</li>
    <li>Each Order Form shall specify: services, deliverables, fees, payment due date, acceptance criteria, completion date, and any special requirements.</li>
  </ol>

  <div class="terms-h">Article 3 — Independent Contractor Status</div>
  <ol class="terms-ol">
    <li>The Contractor is an independent contractor, not an employee, agent, or partner of the Company. This Agreement does not create an employment relationship.</li>
    <li>The Contractor determines the manner and means of performing the services, subject to the requirements set out in the Order Form.</li>
    <li>The Contractor is solely responsible for all taxes, social security contributions, insurance, and regulatory obligations applicable in the Contractor's jurisdiction, except for taxes the Company is legally required to withhold.</li>
  </ol>

  <div class="terms-h">Article 4 — Services and Deliverables</div>
  <ol class="terms-ol">
    <li>The Contractor shall perform the services and provide the deliverables described in the Order Form with the skill, care, and diligence reasonably expected of a qualified professional in the relevant field.</li>
    <li>Unless the Order Form provides otherwise, the Contractor shall supply its own equipment and working environment at its own cost.</li>
  </ol>

  <div class="terms-h">Article 5 — Service Warranty; Remedies</div>
  <ol class="terms-ol">
    <li>The Contractor expressly warrants that: (i) all services will be performed with the skill, care, and diligence reasonably expected of a qualified professional; and (ii) all deliverables will conform to the description, quality, and specifications in the Order Form (the "<strong>Warranty</strong>").</li>
    <li>If any deliverable or service fails to satisfy the Warranty ("<strong>Non-Conforming Performance</strong>"), the Company may — by written notice within the period in Article 5.4 — elect one or more of the following contractual remedies (independent of any statutory regime): (i) <strong>Cure</strong> — require repair, replacement, or re-performance within a period designated by the Company; (ii) <strong>Fee Reduction</strong> — reduce fees in proportion to the deficiency where cure is unavailable or not timely; or (iii) <strong>Damages</strong> — claim compensation for direct loss, including costs of substitute performance.</li>
    <li>These remedies are cumulative.</li>
    <li>The Company must notify the Contractor in writing of Non-Conforming Performance within <strong>six (6) months</strong> after acceptance of the relevant deliverable or completion of services. This limitation does not apply where the deficiency is attributable to the Contractor's fraud, willful misconduct, or gross negligence.</li>
    <li>The Company shall not unilaterally reduce fees or reject deliverables on grounds outside this Article.</li>
  </ol>

  <div class="terms-h">Article 6 — Fees and Payment</div>
  <ol class="terms-ol">
    <li>The Company shall pay the fees stated in the Order Form (exclusive of taxes and withholding) on the payment due date stated in the Order Form.</li>
    <li>The Company shall not reduce agreed fees or delay payment except in accordance with this Agreement. If mandatory law requires a shorter payment period or stricter terms, such law prevails.</li>
    <li>Payment shall be made by wire transfer or equivalent, with all transfer charges borne by the Company (OUR) unless the Order Form states otherwise.</li>
    <li>Late payment accrues interest at {{LATE_PAYMENT_RATE}} per annum, calculated daily from the day after the due date until actual payment.</li>
  </ol>

  <div class="terms-h">Article 7 — Taxes and Withholding</div>
  <ol class="terms-ol">
    <li>All fees are exclusive of taxes unless the Order Form states otherwise. The Contractor is responsible for all taxes and charges applicable in the Contractor's jurisdiction, except for taxes the Company is legally required to withhold.</li>
    <li>If the Company is required to withhold tax, it shall do so and provide the Contractor with appropriate documentation. The Contractor shall provide any tax residency certificate, treaty form, or other documentation requested for tax compliance or treaty benefit purposes. The Company has no obligation to gross up withheld amounts unless the Order Form expressly provides otherwise.</li>
  </ol>

  <div class="terms-h">Article 8 — Delivery and Acceptance</div>
  <ol class="terms-ol">
    <li>The Contractor shall deliver each deliverable by the deadline and in the manner specified in the Order Form. The Company shall inspect and notify the Contractor of acceptance or rejection in accordance with the acceptance criteria and period in the relevant line item.</li>
    <li>If the Company gives no notification within the inspection period, the deliverable is deemed accepted for defects reasonably discoverable upon inspection — but deemed acceptance does not waive the Company's rights under Article 5 regarding latent defects.</li>
    <li>Acceptance of a deliverable does not limit the Company's rights under Article 5 with respect to latent defects or non-conforming performance not reasonably discoverable during the inspection period. Ownership and license rights in deliverables are governed by Article 9.</li>
  </ol>

  <div class="terms-h">Article 9 — Intellectual Property</div>
  <ol class="terms-ol">
    <li><strong>Assignment.</strong> Unless the Order Form specifies a license model, all IP rights in deliverables created by the Contractor for the Company are assigned to the Company upon full payment. The Contractor shall execute any documents needed to perfect the assignment. Where moral rights cannot be assigned, the Contractor agrees not to assert them against the Company or its licensees.</li>
    <li><strong>Background Materials.</strong> The Contractor retains ownership of pre-existing materials, tools, and know-how developed independently of this Agreement. To the extent Background Materials are incorporated into deliverables, the Contractor grants the Company a worldwide, perpetual, irrevocable, royalty-free, sublicensable license to use them as part of the deliverables.</li>
    <li><strong>Third-Party Materials.</strong> The Contractor shall not incorporate any third-party materials (including AI-generated content, open-source software, stock content, or images) into deliverables without first obtaining all necessary licenses and disclosing such materials to the Company in writing.</li>
  </ol>

  <div class="terms-h">Article 10 — AI Tools and Open-Source Software</div>
  <ol class="terms-ol">
    <li>The Contractor shall not use generative AI, code-generation, or similar tools unless approved in writing by the Company for the relevant Order Form. Where approved, the Contractor shall disclose upon request: the tool name and version; whether Company or personal data was input; and any restrictions on the Company's use of the output.</li>
    <li>The Contractor shall not input any personal data, confidential information, credentials, or non-public Company materials into any AI tool without the Company's prior written consent.</li>
    <li>The Contractor shall not incorporate open-source software into deliverables in any manner that would require the Company's proprietary code or data to be disclosed or licensed under open-source terms, without the Company's prior written approval.</li>
  </ol>

  <div class="terms-h">Article 11 — IP Warranties</div>
  <ol class="terms-ol">
    <li>The Contractor warrants that deliverables do not infringe any third-party intellectual property rights and that no third-party rights prevent the Company from using them as intended. Where third-party materials are incorporated, the Contractor shall hold all necessary licenses before delivery.</li>
    <li>If a third party brings a claim against the Company arising from the Contractor's breach of this Article, the Contractor shall defend and indemnify the Company at its own cost. This indemnity does not apply to claims arising from Company-Designated Materials.</li>
    <li>"<strong>Company-Designated Materials</strong>" are materials provided by or specifically directed by the Company. The Company warrants that it holds the rights needed for the Contractor's use. Claims arising from Company-Designated Materials are the Company's responsibility, except where caused by the Contractor's unauthorized use.</li>
  </ol>

  <div class="terms-h">Article 12 — Confidentiality</div>
  <ol class="terms-ol">
    <li>Each party shall keep the other's confidential information strictly confidential, not disclose it to third parties without prior written consent, and use it only for performance of this Agreement. Standard exceptions apply (public domain, independent development, legal compulsion with prior notice where permitted).</li>
    <li>These obligations survive termination for <strong>{{NDA_SURVIVAL_YEARS}} years</strong>.</li>
    <li>The Contractor shall obtain the Company's prior written consent before displaying any deliverables as portfolio items or on public channels.</li>
  </ol>

  <div class="terms-h">Article 13 — Personal Data Protection</div>
  <ol class="terms-ol">
    <li>The Contractor may process personal data only to the extent necessary for ordinary communications, payment administration, personnel or staff coordination, performance of the services, and delivery of the deliverables under the applicable Order Form.</li>
    <li>The Contractor shall not collect, copy, scan, photograph, export, disclose, transfer, or otherwise process any customer, visitor, lead, inquiry, end-user, or other third-party personal data unless the Company has expressly authorized such processing in writing.</li>
    <li>The Contractor shall implement reasonable technical and organizational measures to protect personal data handled in connection with this Agreement against unauthorized access, disclosure, loss, destruction, alteration, or misuse.</li>
    <li>The Contractor shall not disclose or transfer personal data to any third party, including subcontractors, staffing agencies, or assistants, except to the extent necessary for the performance of the services or with the Company's prior written consent.</li>
    <li>If the Contractor becomes aware of any actual or suspected unauthorized access, disclosure, loss, or misuse of personal data, the Contractor shall notify the Company promptly and cooperate in taking reasonable remedial measures.</li>
    <li>Upon completion of the services or upon the Company's request, the Contractor shall return or securely delete personal data received from or processed on behalf of the Company, unless retention is required by applicable law.</li>
    <li>If the Contractor is required to process customer data, visitor data, lead information, end-user data, or other personal data beyond the scope of Article 13.1, the parties shall agree in writing on additional data protection terms, including a data processing addendum where required by applicable law.</li>
  </ol>

  <div class="terms-h">Article 14 — Customer Flow-Down Requirements</div>
  <div>The Contractor shall comply with any customer-specific security, confidentiality, data protection, or compliance requirements notified by the Company in writing. If the Contractor cannot comply, it shall notify the Company before commencing the affected services.</div>

  <div class="terms-h">Article 15 — No Assignment</div>
  <div>The Contractor may not assign or transfer any rights or obligations under this Agreement without the Company's prior written consent. Any change of control of the Company does not give the Contractor a right to terminate.</div>

  <div class="terms-h">Article 16 — Subcontracting</div>
  <ol class="terms-ol">
    <li>The Contractor shall not engage any third party — including crowd-workers or AI-based agents — to perform any material part of the services without the Company's prior written consent.</li>
    <li>Approved subcontractors must be bound by obligations at least as protective as those in this Agreement. The Contractor remains fully liable for its subcontractors' acts and omissions.</li>
  </ol>

  <div class="terms-h">Article 17 — Sanctions; Anti-Corruption</div>
  <div>The Contractor warrants that it is not subject to any applicable sanctions list and has not violated any anti-bribery or anti-corruption law in connection with this Agreement. Breach of this Article entitles the Company to terminate immediately without compensation, and the Contractor shall indemnify the Company for resulting losses.</div>

  <div class="terms-h">Article 18 — Termination; Liability</div>
  <ol class="terms-ol">
    <li>The Company may terminate for the Contractor's material breach not cured within <strong>14 days</strong> of written notice. The Contractor may terminate for the Company's material breach not cured within <strong>30 days</strong> of written notice.</li>
    <li>Except for Excluded Claims, the Contractor's total liability under an Order Form shall not exceed the total fees paid or payable under that Order Form.</li>
    <li>Neither party shall be liable to the other for indirect, incidental, special, punitive, or consequential damages, including loss of profits, revenue, data, or business opportunity, except to the extent arising from Excluded Claims.</li>
    <li>"<strong>Excluded Claims</strong>" — to which no cap applies — means the Contractor's liability for: (i) fraud, willful misconduct, or gross negligence; (ii) breach of confidentiality; (iii) breach of data protection obligations; (iv) IP infringement or misappropriation; (v) breach of sanctions or anti-corruption obligations; or (vi) unauthorized subcontracting.</li>
  </ol>

  <div class="terms-h">Article 19 — Force Majeure</div>
  <ol class="terms-ol">
    <li>A party affected by an event genuinely beyond its reasonable control (excluding economic conditions, currency movements, cost increases, and personal circumstances of the Contractor) is excused from affected obligations during the event, provided it notifies the other party in writing within <strong>5 business days</strong> and uses reasonable efforts to mitigate.</li>
    <li>Fees for work performed or deliverables accepted before the event remain payable. If a Force Majeure Event affecting the Contractor persists for more than <strong>30 consecutive days</strong>, the Company may terminate immediately without compensation for unperformed work.</li>
  </ol>

  <div class="terms-h">Article 20 — Entire Agreement; Amendments</div>
  <div>This Agreement is the entire agreement on its subject matter and supersedes all prior representations and understandings. Amendments require written signatures of both parties, except that the Company may issue written instructions that supplement scope without altering fees or payment terms. No waiver of breach constitutes a waiver of future breaches.</div>

  <div class="terms-h">Article 21 — Settlement on Early Termination</div>
  <div>On early termination, fees shall be settled on a pro-rata basis reflecting work completed and accepted up to the termination date.</div>

  <div class="terms-h">Article 22 — Governing Law and Dispute Resolution</div>
  <div>The governing law and dispute resolution mechanism applicable to this Agreement shall be as stated in the Order Form. Where the Order Form does not specify, the parties shall agree in writing before commencing any dispute resolution process.</div>

  <div class="terms-h">Article 23 — Miscellaneous</div>
  <div>Unaddressed matters shall be resolved by good-faith discussion. If any provision is held invalid, the remainder continues in full force. These Terms prevail over any conflicting Contractor terms unless expressly agreed otherwise in writing.</div>

</div>
</body>
</html>
$ipo_html$,
          COALESCE(cur_schema, '[]'::jsonb),
          '海外発注書: サブスク明細の納期/支払日の逆転修正＋当月/翌月/翌々月払いの明示 (0112)', 'migration-0112')
  RETURNING id INTO vid;

  UPDATE document_templates SET current_version_id = vid, updated_at = now() WHERE id = tid;
END $mig_ipo$;
