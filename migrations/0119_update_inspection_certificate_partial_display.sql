-- 0119_update_inspection_certificate_partial_display.sql
-- 検収書(inspection_certificate)テンプレを分納表現の改善版へ差し替え。
--   ④part B: 「今回の納品内容」に 今回数量 / 歩留率 列を追加(単価×数量×歩留率=対価の内訳を明示)。
--   ④part A(分納判定の残額ベース化)は worker 側 computeInspectionSummary の変更で、
--     isPartial / 進捗(検収済・残・率)を上書きする(テンプレ変数は不変)。
--   データ契約は不変(delivery_line_items[].inspected_quantity/acceptance_ratio は既存)。
--   disk: services/worker/templates/inspection_certificate.html と同一内容。
--   TEMPLATE_SOURCE=db の worker / search-api(プレビュー)はこの DB 版を読むため新版を current に。
--   field_schema は現行版から引き継ぐ(フォーム項目は不変)。0088 と同一の upsert 方式。
DO $mig$
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
   WHERE dt.template_key = 'inspection_certificate';

  IF tid IS NULL THEN
    RAISE NOTICE '0119: inspection_certificate template not found, skipping';
    RETURN;
  END IF;

  IF cur_html IS NOT DISTINCT FROM $ins_html$<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>検収書 {{or parent_po_number issueKey}}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "IPAGothic", "Noto Sans CJK JP", "MS Gothic", sans-serif;
      font-size: 10.5pt;
      color: #000;
      line-height: 1.65;
    }

    .doc-header {
      border-bottom: 2.5px solid #000;
      padding-bottom: 10px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .doc-title { font-size: 20pt; font-weight: bold; letter-spacing: 0.08em; }
    .doc-meta { text-align: right; font-size: 9pt; line-height: 1.9; }

    /* 分納バッジ — 分割時のみ表示 (納品完了バッジは廃止 Phase 9c) */
    .delivery-badge {
      display: inline-block;
      border: 1.5px dashed #000;
      padding: 2px 10px;
      font-size: 9pt;
      font-weight: bold;
      margin-left: 10px;
      vertical-align: middle;
      color: #555;
    }
    /* Phase 23.1: 再発行版バッジ — 外部要請による修正版 (revision >= 1) で表示 */
    .reissue-badge {
      display: inline-block;
      border: 1.5px solid #b91c1c;
      background: #fef2f2;
      color: #b91c1c;
      padding: 2px 10px;
      font-size: 9pt;
      font-weight: bold;
      margin-left: 10px;
      vertical-align: middle;
      letter-spacing: 0.05em;
    }

    .parties { display: flex; justify-content: space-between; margin-bottom: 14px; gap: 16px; }
    .party-block { flex: 1; }
    .party-label { font-size: 8pt; color: #555; margin-bottom: 2px; }
    .party-name { font-size: 13pt; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 2px; }
    .party-rep {
      font-size: 10pt;
      margin-top: 6px;
      padding-top: 5px;
      border-top: 1px dashed #ccc;
    }

    /* ② 相手方登録番号表示 */
    .party-reg-no {
      font-size: 8.5pt;
      margin-top: 5px;
      color: #333;
      letter-spacing: 0.01em;
    }
    .party-reg-no strong {
      font-family: "Courier New", "Lucida Console", monospace;
      font-size: 9pt;
      letter-spacing: 0.04em;
    }

    .section-title {
      font-size: 9pt;
      font-weight: bold;
      border-left: 3px solid #000;
      padding-left: 6px;
      margin: 12px 0 6px;
      letter-spacing: 0.05em;
    }

    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    th { background: #f0f0f0; border: 1px solid #999; padding: 5px 8px; font-weight: bold; text-align: center; }
    td { border: 1px solid #ccc; padding: 5px 8px; }
    td.right { text-align: right; }
    td.center { text-align: center; }
    td.label { background: #f7f7f7; font-weight: bold; width: 140px; }

    tr.total-row td { background: #f0f0f0; font-weight: bold; font-size: 11pt; }
    tr.subtotal-row td { background: #f8f8f8; }

    /* Phase 23.4: 成果物セル内の item_name / spec 併記レイアウト。
       旧「仕様」列を廃止し、成果物セル内に補足として表示する。
       背景は付けず (テーブル背景のまま) 左の縦線だけで補足を表現。 */
    .item-name {
      font-weight: bold;
      line-height: 1.5;
    }
    .item-spec {
      margin-top: 3px;
      padding-left: 8px;
      border-left: 2px solid #666;
      font-size: 9pt;
      color: #000;
      line-height: 1.55;
      white-space: pre-line;     /* spec 内の \n を改行として保持 */
    }

    /* ④ 軽減税率対象識別マーク（消費税法57条の4第1項第3号ロ） */
    .reduced-mark {
      display: inline-block;
      border: 1px solid #666;
      font-size: 7pt;
      line-height: 1;
      padding: 1px 3px;
      margin-right: 4px;
      vertical-align: middle;
      color: #444;
    }
    .reduced-note {
      font-size: 8pt;
      color: #555;
      margin-top: 5px;
      padding-left: 2px;
    }

    /* 変更履歴ブロック */
    .change-log-section {
      border: 1px solid #bbb;
      padding: 8px 10px;
      margin: 12px 0;
      font-size: 8.5pt;
    }
    .change-log-title {
      font-weight: bold;
      font-size: 9pt;
      margin-bottom: 6px;
      padding-bottom: 4px;
      border-bottom: 1px solid #ddd;
    }
    .change-log-row {
      display: flex;
      gap: 10px;
      padding: 3px 0;
      border-bottom: 1px dashed #e0e0e0;
      line-height: 1.5;
    }
    .change-log-row:last-child { border-bottom: none; }
    .change-date { color: #555; min-width: 80px; }
    .change-field { font-weight: bold; min-width: 60px; }
    .change-before { color: #888; text-decoration: line-through; }
    .change-arrow { color: #555; margin: 0 4px; }
    .change-after { font-weight: bold; }
    .change-reason { color: #444; margin-left: 8px; font-style: italic; }

    /* 進捗サマリー */
    .progress-bar-wrap {
      border: 1px solid #ccc;
      padding: 8px 10px;
      margin-bottom: 12px;
    }
    .progress-bar-title { font-size: 8pt; color: #555; margin-bottom: 4px; }
    .progress-bar-track { height: 12px; background: #e8e8e8; border-radius: 2px; overflow: hidden; margin-bottom: 4px; }
    .progress-bar-fill { height: 100%; background: #444; }
    .progress-bar-labels { display: flex; justify-content: space-between; font-size: 7.5pt; color: #555; }

    .confirmation-text {
      border: 1px solid #ccc;
      background: #fafafa;
      padding: 8px 12px;
      margin-bottom: 12px;
      font-size: 9.5pt;
    }

    .conditions { display: flex; gap: 12px; margin-bottom: 12px; }
    .condition-box { flex: 1; border: 1px solid #bbb; padding: 8px 10px; }
    .condition-box h3 { font-size: 8.5pt; font-weight: bold; border-bottom: 1px solid #ddd; margin-bottom: 5px; padding-bottom: 3px; }
    .condition-box .highlight { font-size: 11pt; font-weight: bold; }

    /* みなし同意ブロック */
    .confirm-box {
      border: 1px solid #ccc;
      background: #fafafa;
      padding: 10px 12px;
      margin-top: 14px;
      font-size: 9pt;
      line-height: 1.6;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .confirm-box p { margin: 0 0 6px 0; }
    .confirm-box p:last-child { margin-bottom: 0; }
    .confirm-box .proviso {
      font-size: 8.3pt;
      color: #555;
      border-top: 1px dashed #ccc;
      padding-top: 6px;
      margin-top: 8px;
    }
    .confirm-box .contact {
      font-size: 8.7pt;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid #ddd;
    }

  </style>
</head>
<body>

  {{!-- ヘッダー (Phase 9c)
       - 「納品完了」バッジは廃止 (分割時のみバッジ表示)
       - 旧 .doc-number ({{issueKey}}-{{itemNo}}-{{deliveryNo}}) は廃止
         代わりに「発注番号 = 親 PO の document_number」を表示
  --}}
  <div class="doc-header">
    <div>
      <span class="doc-title">検　収　書</span>
      {{#if (or (eq isPartial "分割") (eq isPartial true))}}
      <span class="delivery-badge">分割納品 第{{deliveryNo}}回 / 全{{totalDeliveries}}回予定</span>
      {{/if}}
      {{#if (gt REVISION 0)}}
      <span class="reissue-badge">修正版 Rev. {{REVISION}}</span>
      {{/if}}
    </div>
    <div class="doc-meta">
      <div>発注番号: <strong>{{or parent_po_number issueKey}}</strong></div>
      <div>発行日: {{formatDate documentDate}}</div>
    </div>
  </div>

  {{!-- 当事者ブロック (Phase 9c)
       受託者:
         - 個人 → 「<名前> 様」
         - 法人 → 「<会社名> 御中」 + 棒線 + 「<代表者名> 様」
       発注者:
         住所 / 建物 / 部署 / 担当を別行に整理
  --}}
  <div class="parties">
    <div class="party-block">
      <div class="party-label">受託者（課税仕入れの相手方）</div>
      {{!-- 法人 = 「御中」+ 棒線 + 代表者「様」 / 個人 = 「様」のみ
           COUNTERPARTY_IS_CORPORATION は文字列 "法人" / "個人" (Phase 9d: select 化)。
           後方互換: 古い boolean true もそのまま「法人」扱い --}}
      <div class="party-name">
        {{counterparty}}
        {{#if (eq COUNTERPARTY_IS_CORPORATION "法人")}}御中{{else}}{{#if (eq COUNTERPARTY_IS_CORPORATION true)}}御中{{else}}様{{/if}}{{/if}}
      </div>
      {{#if (eq COUNTERPARTY_IS_CORPORATION "法人")}}
        {{#if counterpartyRep}}
        <div class="party-rep">{{counterpartyRep}} 様</div>
        {{/if}}
      {{else}}
        {{#if (eq COUNTERPARTY_IS_CORPORATION true)}}
          {{#if counterpartyRep}}
          <div class="party-rep">{{counterpartyRep}} 様</div>
          {{/if}}
        {{/if}}
      {{/if}}
      {{#if counterpartyTni}}
      <div class="party-reg-no">登録番号: <strong>{{counterpartyTni}}</strong></div>
      {{/if}}
    </div>
    <div class="party-block" style="text-align:right; font-size:8.5pt; line-height:1.9;">
      <div style="font-size:11pt; font-weight:bold;">株式会社アークライト</div>
      <div>〒101-0052 東京都千代田区神田小川町1-2</div>
      <div>風雲堂ビル2階</div>
      <div style="margin-top:4px;">{{inspectorDept}}</div>
      <div>担当: {{inspectorName}}</div>
    </div>
  </div>

  {{!-- 検収確認文 — 日付は YYYY年MM月DD日 (formatDate)。件名を先頭に表示。 --}}
  <div class="confirmation-text">
    　{{#if projectTitle}}件名「{{projectTitle}}」に関して、{{/if}}納品日 （役務完了日）<strong>{{formatDate deliveredAt}}</strong> に納品（役務提供完了）された下記成果物（役務内容）について検収を行い、
    検収日 <strong>{{formatDate inspectionCompletedAt}}</strong> に検収完了致しましたのでご通知します。
    {{#if (or (eq isPartial "分割") (eq isPartial true))}}本書は分割納品（第{{deliveryNo}}回）に係る検収書です。{{/if}}
  </div>

  {{!-- 納品進捗サマリー（分割時のみ） --}}
  {{#if (or (eq isPartial "分割") (eq isPartial true))}}
  <div class="progress-bar-wrap">
    <div class="progress-bar-title">本発注全体の納品・検収進捗</div>
    <div class="progress-bar-track">
      <div class="progress-bar-fill" style="width: {{inspectedPct}}%;"></div>
    </div>
    <div class="progress-bar-labels">
      <span>検収済: ¥{{inspectedAmountStr}} / 発注総額: ¥{{totalOrderAmountStr}}</span>
      <span>残: ¥{{pendingAmountStr}}</span>
    </div>
  </div>
  {{/if}}

  {{!-- 今回納品明細
       適格請求書記載要件（消費税法57条の4）に対応する項目：
         納品日（課税仕入れの年月日）、成果物・業務内容（軽減税率対象の旨を含む）、
         支払対価・税率、消費税額
       Phase 9c: description / spec は親 PO 発見時に form-context で自動補完
       Phase 23.0.4: delivery_line_items[] が複数あれば each ループで複数行を描画。
                      空のときは従来の単一行 ({{description}}) を fallback として表示。
  --}}
  <div class="section-title">■ 今回の納品内容</div>
  <table style="margin-bottom:4px;">
    <thead>
      <tr>
        <th style="width:5%">No.</th>
        <th style="width:45%">成果物・業務内容</th>
        <th style="width:11%">今回数量</th>
        <th style="width:10%">歩留率</th>
        <th style="width:14%">納品日</th>
        <th style="width:15%">支払対価（税抜）</th>
      </tr>
    </thead>
    <tbody>
      {{!-- Phase 23.4: 旧「仕様」列を削除し、「成果物・業務内容」セル内に
           item_name (太字) + spec (補足、左に縦線) を併記するレイアウトに。
           spec 空の行は補足ブロック自体を表示しない (= 行高は item_name 1 行)。
           長文 spec の場合に行が縦に間延びする問題を解消。 --}}
      {{#if (gt (length delivery_line_items) 0)}}
        {{#each delivery_line_items}}
          <tr>
            <td class="center">{{index1 @index}}</td>
            <td>
              <div class="item-name">{{#if ../isReducedTax}}<span class="reduced-mark">※</span>{{/if}}{{or item_name ../description}}</div>
              {{#if (or spec ../spec)}}
              <div class="item-spec">{{or spec ../spec}}</div>
              {{/if}}
            </td>
            {{!-- 分納の内訳: 今回検収した数量・歩留率(単価×数量×歩留率=支払対価)。
                 数量/歩留率が無い(利用許諾料に含む等)行は「—」。 --}}
            <td class="center">{{#if (gt inspected_quantity 0)}}{{inspected_quantity}}{{else}}—{{/if}}</td>
            <td class="center">{{#if (gt acceptance_ratio 0)}}{{formatPct (multiply acceptance_ratio 100)}}{{else}}—{{/if}}</td>
            <td class="center">{{formatDate (or delivery_date ../deliveredAt)}}</td>
            {{!-- 固定報酬0の対価表示: 発注者×ROYALTY=業績連動報酬(別途算定)、それ以外(受注者)=
                 利用許諾料に含む。amount>0 は通常の金額表示。 --}}
            <td class="right">{{#if (gt (or inspected_amount_ex_tax amount_ex_tax) 0)}}{{formatYen (or inspected_amount_ex_tax amount_ex_tax)}}{{else}}{{#if (eq calc_method "ROYALTY")}}{{#if (eq deliverable_ownership "発注者")}}<span style="font-size:8pt;color:#1f3a8a;">業績連動報酬（別途算定）</span>{{else}}<span style="font-size:8pt;color:#92400e;">利用許諾料に含む</span>{{/if}}{{else}}<span style="font-size:8pt;color:#92400e;">利用許諾料に含む</span>{{/if}}{{/if}}</td>
          </tr>
        {{/each}}
      {{else}}
        <tr>
          <td class="center">{{itemNo}}</td>
          <td>
            <div class="item-name">{{#if isReducedTax}}<span class="reduced-mark">※</span>{{/if}}{{description}}</div>
            {{#if spec}}
            <div class="item-spec">{{spec}}</div>
            {{/if}}
          </td>
          <td class="center">—</td>
          <td class="center">—</td>
          <td class="center">{{formatDate deliveredAt}}</td>
          <td class="right">¥{{deliveredAmountStr}}</td>
        </tr>
      {{/if}}
      {{#if otherFeesTaxable}}
      {{!-- Phase 23.6.16: その他手数料がある場合、消費税は末尾の「支払額サマリー」で
           検収税抜＋手数料税抜を合算して 1 回だけ計算する (二重計上を避けるため、
           ここでは検収の税抜小計のみ表示)。 --}}
      <tr class="total-row">
        <td colspan="5" class="right">検収 小計（税抜）</td>
        <td class="right">¥{{deliveredAmountStr}}</td>
      </tr>
      {{else}}
      <tr>
        <td colspan="5" class="right">
          消費税({{taxRate}}%{{#if isReducedTax}}・軽減税率対象{{/if}})
        </td>
        <td class="right">¥{{taxAmountStr}}</td>
      </tr>
      <tr class="total-row">
        <td colspan="5" class="right">源泉徴収税計算前　検収金額(税込)</td>
        <td class="right">¥{{totalAmountStr}}</td>
      </tr>
      {{/if}}
    </tbody>
  </table>
  {{#if isReducedTax}}
  <div class="reduced-note">※ 軽減税率（8%）対象品目</div>
  {{/if}}

  {{!-- 業績連動型報酬版: 発注者帰属×ROYALTY の成果物がある場合に表示。
       IPは検収完了をもって発注者へ譲渡(譲渡型)、報酬は固定額でなく発注者の業績に
       連動して別途算定・支払。利用許諾型(受注者帰属)とは明確に区別する。 --}}
  {{#if hasPerformanceRoyalty}}
  <div class="section-title">■ 業績連動型報酬（成果物のIPは発注者へ譲渡）</div>
  <table style="margin-bottom:4px;">
    <thead>
      <tr>
        <th style="width:6%">No.</th>
        <th style="width:48%">成果物</th>
        <th style="width:28%">報酬の算定方法</th>
        <th style="width:18%">料率</th>
      </tr>
    </thead>
    <tbody>
      {{#each performanceRoyaltyLines}}
      <tr>
        <td class="center">{{index1 @index}}</td>
        <td><div class="item-name">{{item_name}}</div></td>
        <td>{{#if (eq royalty_calc_basis "manufacturing")}}個数 × 基準価格 × 料率{{else}}{{#if (eq royalty_calc_basis "sales")}}売上高 × 料率{{else}}{{#if (eq royalty_calc_basis "sublicense")}}受領額 × 料率{{else}}{{#if (eq royalty_calc_basis "fixed")}}固定額{{else}}個数 × 基準価格 × 料率{{/if}}{{/if}}{{/if}}{{/if}}</td>
        <td class="right">{{#if rate_pct}}{{rate_pct}}%{{else}}—{{/if}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>
  <div style="font-size:8.5pt;color:#555;margin-top:2px;">※ 上記成果物は、検収完了をもって知的財産権が発注者へ移転（譲渡型）します。これらに対する報酬は固定額ではなく、発注者の業績（売上・製造数量等）に連動する「業績連動型報酬」として、別途発行する算定書（利用許諾料計算書に準じた算定）により算定・支払われます。本検収書に基づく支払額には含まれません。</div>
  {{/if}}

  {{!-- Phase 17m: 経費精算 (税込み額) — 親 PO の order_expenses から
       「今回含める」とチェックされた行のみを描画。 --}}
  {{#if expenses}}
  <div class="section-title">■ 今回精算する経費（交通費等・税込み額）</div>
  <table style="margin-bottom:4px;">
    <thead>
      <tr>
        <th style="width:6%">No.</th>
        <th style="width:34%">費目</th>
        <th style="width:30%">仕様 / 区間 等</th>
        <th style="width:15%">発生日</th>
        <th style="width:15%">金額（税込）</th>
      </tr>
    </thead>
    <tbody>
      {{#each expenses}}
      <tr>
        <td class="center">{{line_no}}</td>
        <td>{{expense_name}}</td>
        <td>{{spec}}{{#if remarks}}<div style="font-size:8pt;color:#666;margin-top:2px;">{{remarks}}</div>{{/if}}</td>
        <td class="center">{{formatDate spent_date}}</td>
        <td class="right">¥{{formatCurrency amount_inc_tax}}</td>
      </tr>
      {{/each}}
      <tr class="total-row">
        <td colspan="4" class="right">経費合計（税込）</td>
        <td class="right">¥{{expensesTotalIncTaxStr}}</td>
      </tr>
    </tbody>
  </table>
  <div style="font-size:8.5pt;color:#666;margin-top:2px;">※ 経費は税込み額にて精算します（消費税の二重計上はしません）。</div>
  {{/if}}

  {{!-- Phase 22.21.57: その他手数料 (税抜・コーディネート費・振込手数料等) --}}
  {{#if other_fees}}
  {{#if (gt (length other_fees) 0)}}
  <div class="section-title">■ 今回精算するその他手数料（税抜）</div>
  <table style="margin-bottom:4px;">
    <thead>
      <tr>
        <th style="width:6%">No.</th>
        <th style="width:64%">項目名</th>
        <th style="width:15%">金額（税抜）</th>
        <th style="width:15%">摘要</th>
      </tr>
    </thead>
    <tbody>
      {{#each other_fees}}
      <tr>
        <td class="center">{{line_no}}</td>
        <td>{{fee_name}}</td>
        <td class="right">¥{{formatCurrency amount}}</td>
        <td>{{remarks}}</td>
      </tr>
      {{/each}}
      <tr class="total-row">
        <td colspan="2" class="right">手数料合計（税抜）</td>
        <td class="right">¥{{otherFeesTotalStr}}</td>
        <td></td>
      </tr>
    </tbody>
  </table>
  <div style="font-size:8.5pt;color:#666;margin-top:2px;">※ その他手数料は税抜表示。消費税は検収金額と合算し、下記「支払額サマリー」で税率ごとに一括計算します（二重計上はしません）。</div>
  {{/if}}
  {{/if}}

  {{!-- Phase 23.6.16: 支払額サマリー（検収書は仕入明細書として消費税法57条の4 の
       記載要件に対応）。検収書は発注者が発行する書類のため「請求書」とは名乗らない。
       検収金額(税抜) と その他手数料(税抜) を税率ごとに区分して合算し、消費税を
       1 回だけ計算する。経費(税込)は課税対象外の立替として別掲。手数料がある
       ときのみ表示 (手数料が無ければ上の「源泉徴収税計算前　検収金額(税込)」で完結する)。 --}}
  {{#if otherFeesTaxable}}
  <div class="section-title">■ 支払額サマリー</div>
  <table style="margin-bottom:4px;">
    <tbody>
      <tr>
        <td style="width:70%;" class="right">検収金額（税抜）</td>
        <td style="width:30%;" class="right">¥{{deliveredAmountStr}}</td>
      </tr>
      <tr>
        <td class="right">その他手数料（税抜）</td>
        <td class="right">¥{{otherFeesTotalStr}}</td>
      </tr>
      <tr class="total-row">
        <td class="right">{{taxRate}}%対象 税抜合計</td>
        <td class="right">¥{{taxableSubtotalExTaxStr}}</td>
      </tr>
      <tr>
        <td class="right">消費税（{{taxRate}}%）</td>
        <td class="right">¥{{combinedTaxStr}}</td>
      </tr>
      <tr class="total-row" style="background:#f3f3f3;">
        <td class="right">税込合計</td>
        <td class="right">¥{{taxableTotalIncTaxStr}}</td>
      </tr>
      {{#if expenses}}
      <tr>
        <td class="right">経費（税込・課税対象外／別精算）</td>
        <td class="right">¥{{expensesTotalIncTaxStr}}</td>
      </tr>
      {{/if}}
    </tbody>
  </table>
  <div style="font-size:8.5pt;color:#666;margin-top:2px;">
    ※ 消費税は {{taxRate}}%対象（検収金額＋その他手数料）の税抜合計に対し、税率ごとに区分して一括計算しています（消費税の二重計上はしません）。{{#if counterpartyTni}} 登録番号: {{counterpartyTni}}{{/if}}
  </div>
  {{/if}}

  {{!-- 検収金額（税込）+ その他手数料（税込・上のサマリーで合算課税）+ 経費（税込） の総支払額 --}}
  {{#if (or expenses other_fees)}}
  <table style="margin-top:8px;margin-bottom:4px;">
    <tbody>
      <tr class="total-row" style="background:#eef6ff;">
        <td style="width:85%;" class="right"><strong>源泉徴収税計算前　本検収書に基づく総支払額（税込・経費 / 手数料含む）</strong></td>
        <td style="width:15%;" class="right"><strong>¥{{grandTotalPayableStr}}</strong></td>
      </tr>
    </tbody>
  </table>
  {{/if}}

  {{!-- 変更履歴（あれば） --}}
  {{#if hasChangeLogs}}
  <div class="change-log-section">
    <div class="change-log-title">⚠️ 変更履歴（当初発注条件からの変更）</div>
    {{#each changeLogs}}
    <div class="change-log-row">
      <span class="change-date">{{this.changedAt}}</span>
      <span class="change-field">{{this.fieldLabel}}</span>
      <span class="change-before">{{this.beforeValue}}</span>
      <span class="change-arrow">→</span>
      <span class="change-after">{{this.afterValue}}</span>
      <span class="change-reason">（理由: {{this.reason}}）</span>
    </div>
    {{/each}}
  </div>
  {{/if}}

  {{!-- 支払条件・発注情報 — 期日表記は formatDate で YYYY年MM月DD日 --}}
  <div class="conditions">
    <div class="condition-box">
      <h3>■ 支払条件</h3>
      <p>{{paymentConditionSummary}}</p>
      <p>支払期日: <span class="highlight">{{formatDate paymentDueDate}}</span></p>
    </div>
    <div class="condition-box">
      <h3>■ 振込先</h3>
      <p>{{bankName}} {{branchName}}</p>
      <p>{{accountType}} {{accountNo}}</p>
      <p>口座名義: {{accountHolder}}</p>
    </div>
  </div>



  {{!-- みなし同意 — 連絡先は DB の staff (inspectorDept / inspectorName / inspectorEmail) から自動補完 --}}
  <div class="section-title">■ 本検収書の内容に関するご確認のお願い</div>
  <div class="confirm-box">
    <p>本検収書にご記載の内容（検収対象成果物、仕様、数量、検収日、金額等）についてご確認のうえ、記載事項に相違または異議がある場合は、本書が貴殿に到達した日の翌日（同日が営業日でない場合は翌営業日）から起算して <strong>5営業日以内</strong> に、下記連絡先宛に書面または電子メールにより、その旨および具体的内容をご通知くださいますようお願いいたします。</p>
    <p>上記期間内に何らのご通知もいただけない場合、本検収書の記載内容（検収日、検収金額、検収対象の範囲を含みます。）について貴殿にご異議がないものとして取り扱わせていただきます。</p>
    <p class="proviso">※ 本取扱いは、製造委託等に係る中小受託事業者に対する代金の支払の遅延等の防止に関する法律（中小受託取引適正化法）、特定受託事業者に係る取引の適正化等に関する法律その他関連法令に基づき貴殿に認められる権利を制限するものではありません。</p>
    <div class="contact">
      <strong>【ご連絡先】</strong><br>
      株式会社アークライト　{{inspectorDept}}　担当: {{inspectorName}}<br>
      E-mail: {{inspectorEmail}}
    </div>
  </div>

</body>
</html>
$ins_html$ THEN
    RAISE NOTICE '0119: inspection_certificate html already current, skipping';
    RETURN;
  END IF;

  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  VALUES (tid,
          COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id = tid), 0) + 1,
          $ins_html$<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>検収書 {{or parent_po_number issueKey}}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "IPAGothic", "Noto Sans CJK JP", "MS Gothic", sans-serif;
      font-size: 10.5pt;
      color: #000;
      line-height: 1.65;
    }

    .doc-header {
      border-bottom: 2.5px solid #000;
      padding-bottom: 10px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .doc-title { font-size: 20pt; font-weight: bold; letter-spacing: 0.08em; }
    .doc-meta { text-align: right; font-size: 9pt; line-height: 1.9; }

    /* 分納バッジ — 分割時のみ表示 (納品完了バッジは廃止 Phase 9c) */
    .delivery-badge {
      display: inline-block;
      border: 1.5px dashed #000;
      padding: 2px 10px;
      font-size: 9pt;
      font-weight: bold;
      margin-left: 10px;
      vertical-align: middle;
      color: #555;
    }
    /* Phase 23.1: 再発行版バッジ — 外部要請による修正版 (revision >= 1) で表示 */
    .reissue-badge {
      display: inline-block;
      border: 1.5px solid #b91c1c;
      background: #fef2f2;
      color: #b91c1c;
      padding: 2px 10px;
      font-size: 9pt;
      font-weight: bold;
      margin-left: 10px;
      vertical-align: middle;
      letter-spacing: 0.05em;
    }

    .parties { display: flex; justify-content: space-between; margin-bottom: 14px; gap: 16px; }
    .party-block { flex: 1; }
    .party-label { font-size: 8pt; color: #555; margin-bottom: 2px; }
    .party-name { font-size: 13pt; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 2px; }
    .party-rep {
      font-size: 10pt;
      margin-top: 6px;
      padding-top: 5px;
      border-top: 1px dashed #ccc;
    }

    /* ② 相手方登録番号表示 */
    .party-reg-no {
      font-size: 8.5pt;
      margin-top: 5px;
      color: #333;
      letter-spacing: 0.01em;
    }
    .party-reg-no strong {
      font-family: "Courier New", "Lucida Console", monospace;
      font-size: 9pt;
      letter-spacing: 0.04em;
    }

    .section-title {
      font-size: 9pt;
      font-weight: bold;
      border-left: 3px solid #000;
      padding-left: 6px;
      margin: 12px 0 6px;
      letter-spacing: 0.05em;
    }

    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    th { background: #f0f0f0; border: 1px solid #999; padding: 5px 8px; font-weight: bold; text-align: center; }
    td { border: 1px solid #ccc; padding: 5px 8px; }
    td.right { text-align: right; }
    td.center { text-align: center; }
    td.label { background: #f7f7f7; font-weight: bold; width: 140px; }

    tr.total-row td { background: #f0f0f0; font-weight: bold; font-size: 11pt; }
    tr.subtotal-row td { background: #f8f8f8; }

    /* Phase 23.4: 成果物セル内の item_name / spec 併記レイアウト。
       旧「仕様」列を廃止し、成果物セル内に補足として表示する。
       背景は付けず (テーブル背景のまま) 左の縦線だけで補足を表現。 */
    .item-name {
      font-weight: bold;
      line-height: 1.5;
    }
    .item-spec {
      margin-top: 3px;
      padding-left: 8px;
      border-left: 2px solid #666;
      font-size: 9pt;
      color: #000;
      line-height: 1.55;
      white-space: pre-line;     /* spec 内の \n を改行として保持 */
    }

    /* ④ 軽減税率対象識別マーク（消費税法57条の4第1項第3号ロ） */
    .reduced-mark {
      display: inline-block;
      border: 1px solid #666;
      font-size: 7pt;
      line-height: 1;
      padding: 1px 3px;
      margin-right: 4px;
      vertical-align: middle;
      color: #444;
    }
    .reduced-note {
      font-size: 8pt;
      color: #555;
      margin-top: 5px;
      padding-left: 2px;
    }

    /* 変更履歴ブロック */
    .change-log-section {
      border: 1px solid #bbb;
      padding: 8px 10px;
      margin: 12px 0;
      font-size: 8.5pt;
    }
    .change-log-title {
      font-weight: bold;
      font-size: 9pt;
      margin-bottom: 6px;
      padding-bottom: 4px;
      border-bottom: 1px solid #ddd;
    }
    .change-log-row {
      display: flex;
      gap: 10px;
      padding: 3px 0;
      border-bottom: 1px dashed #e0e0e0;
      line-height: 1.5;
    }
    .change-log-row:last-child { border-bottom: none; }
    .change-date { color: #555; min-width: 80px; }
    .change-field { font-weight: bold; min-width: 60px; }
    .change-before { color: #888; text-decoration: line-through; }
    .change-arrow { color: #555; margin: 0 4px; }
    .change-after { font-weight: bold; }
    .change-reason { color: #444; margin-left: 8px; font-style: italic; }

    /* 進捗サマリー */
    .progress-bar-wrap {
      border: 1px solid #ccc;
      padding: 8px 10px;
      margin-bottom: 12px;
    }
    .progress-bar-title { font-size: 8pt; color: #555; margin-bottom: 4px; }
    .progress-bar-track { height: 12px; background: #e8e8e8; border-radius: 2px; overflow: hidden; margin-bottom: 4px; }
    .progress-bar-fill { height: 100%; background: #444; }
    .progress-bar-labels { display: flex; justify-content: space-between; font-size: 7.5pt; color: #555; }

    .confirmation-text {
      border: 1px solid #ccc;
      background: #fafafa;
      padding: 8px 12px;
      margin-bottom: 12px;
      font-size: 9.5pt;
    }

    .conditions { display: flex; gap: 12px; margin-bottom: 12px; }
    .condition-box { flex: 1; border: 1px solid #bbb; padding: 8px 10px; }
    .condition-box h3 { font-size: 8.5pt; font-weight: bold; border-bottom: 1px solid #ddd; margin-bottom: 5px; padding-bottom: 3px; }
    .condition-box .highlight { font-size: 11pt; font-weight: bold; }

    /* みなし同意ブロック */
    .confirm-box {
      border: 1px solid #ccc;
      background: #fafafa;
      padding: 10px 12px;
      margin-top: 14px;
      font-size: 9pt;
      line-height: 1.6;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .confirm-box p { margin: 0 0 6px 0; }
    .confirm-box p:last-child { margin-bottom: 0; }
    .confirm-box .proviso {
      font-size: 8.3pt;
      color: #555;
      border-top: 1px dashed #ccc;
      padding-top: 6px;
      margin-top: 8px;
    }
    .confirm-box .contact {
      font-size: 8.7pt;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid #ddd;
    }

  </style>
</head>
<body>

  {{!-- ヘッダー (Phase 9c)
       - 「納品完了」バッジは廃止 (分割時のみバッジ表示)
       - 旧 .doc-number ({{issueKey}}-{{itemNo}}-{{deliveryNo}}) は廃止
         代わりに「発注番号 = 親 PO の document_number」を表示
  --}}
  <div class="doc-header">
    <div>
      <span class="doc-title">検　収　書</span>
      {{#if (or (eq isPartial "分割") (eq isPartial true))}}
      <span class="delivery-badge">分割納品 第{{deliveryNo}}回 / 全{{totalDeliveries}}回予定</span>
      {{/if}}
      {{#if (gt REVISION 0)}}
      <span class="reissue-badge">修正版 Rev. {{REVISION}}</span>
      {{/if}}
    </div>
    <div class="doc-meta">
      <div>発注番号: <strong>{{or parent_po_number issueKey}}</strong></div>
      <div>発行日: {{formatDate documentDate}}</div>
    </div>
  </div>

  {{!-- 当事者ブロック (Phase 9c)
       受託者:
         - 個人 → 「<名前> 様」
         - 法人 → 「<会社名> 御中」 + 棒線 + 「<代表者名> 様」
       発注者:
         住所 / 建物 / 部署 / 担当を別行に整理
  --}}
  <div class="parties">
    <div class="party-block">
      <div class="party-label">受託者（課税仕入れの相手方）</div>
      {{!-- 法人 = 「御中」+ 棒線 + 代表者「様」 / 個人 = 「様」のみ
           COUNTERPARTY_IS_CORPORATION は文字列 "法人" / "個人" (Phase 9d: select 化)。
           後方互換: 古い boolean true もそのまま「法人」扱い --}}
      <div class="party-name">
        {{counterparty}}
        {{#if (eq COUNTERPARTY_IS_CORPORATION "法人")}}御中{{else}}{{#if (eq COUNTERPARTY_IS_CORPORATION true)}}御中{{else}}様{{/if}}{{/if}}
      </div>
      {{#if (eq COUNTERPARTY_IS_CORPORATION "法人")}}
        {{#if counterpartyRep}}
        <div class="party-rep">{{counterpartyRep}} 様</div>
        {{/if}}
      {{else}}
        {{#if (eq COUNTERPARTY_IS_CORPORATION true)}}
          {{#if counterpartyRep}}
          <div class="party-rep">{{counterpartyRep}} 様</div>
          {{/if}}
        {{/if}}
      {{/if}}
      {{#if counterpartyTni}}
      <div class="party-reg-no">登録番号: <strong>{{counterpartyTni}}</strong></div>
      {{/if}}
    </div>
    <div class="party-block" style="text-align:right; font-size:8.5pt; line-height:1.9;">
      <div style="font-size:11pt; font-weight:bold;">株式会社アークライト</div>
      <div>〒101-0052 東京都千代田区神田小川町1-2</div>
      <div>風雲堂ビル2階</div>
      <div style="margin-top:4px;">{{inspectorDept}}</div>
      <div>担当: {{inspectorName}}</div>
    </div>
  </div>

  {{!-- 検収確認文 — 日付は YYYY年MM月DD日 (formatDate)。件名を先頭に表示。 --}}
  <div class="confirmation-text">
    　{{#if projectTitle}}件名「{{projectTitle}}」に関して、{{/if}}納品日 （役務完了日）<strong>{{formatDate deliveredAt}}</strong> に納品（役務提供完了）された下記成果物（役務内容）について検収を行い、
    検収日 <strong>{{formatDate inspectionCompletedAt}}</strong> に検収完了致しましたのでご通知します。
    {{#if (or (eq isPartial "分割") (eq isPartial true))}}本書は分割納品（第{{deliveryNo}}回）に係る検収書です。{{/if}}
  </div>

  {{!-- 納品進捗サマリー（分割時のみ） --}}
  {{#if (or (eq isPartial "分割") (eq isPartial true))}}
  <div class="progress-bar-wrap">
    <div class="progress-bar-title">本発注全体の納品・検収進捗</div>
    <div class="progress-bar-track">
      <div class="progress-bar-fill" style="width: {{inspectedPct}}%;"></div>
    </div>
    <div class="progress-bar-labels">
      <span>検収済: ¥{{inspectedAmountStr}} / 発注総額: ¥{{totalOrderAmountStr}}</span>
      <span>残: ¥{{pendingAmountStr}}</span>
    </div>
  </div>
  {{/if}}

  {{!-- 今回納品明細
       適格請求書記載要件（消費税法57条の4）に対応する項目：
         納品日（課税仕入れの年月日）、成果物・業務内容（軽減税率対象の旨を含む）、
         支払対価・税率、消費税額
       Phase 9c: description / spec は親 PO 発見時に form-context で自動補完
       Phase 23.0.4: delivery_line_items[] が複数あれば each ループで複数行を描画。
                      空のときは従来の単一行 ({{description}}) を fallback として表示。
  --}}
  <div class="section-title">■ 今回の納品内容</div>
  <table style="margin-bottom:4px;">
    <thead>
      <tr>
        <th style="width:5%">No.</th>
        <th style="width:45%">成果物・業務内容</th>
        <th style="width:11%">今回数量</th>
        <th style="width:10%">歩留率</th>
        <th style="width:14%">納品日</th>
        <th style="width:15%">支払対価（税抜）</th>
      </tr>
    </thead>
    <tbody>
      {{!-- Phase 23.4: 旧「仕様」列を削除し、「成果物・業務内容」セル内に
           item_name (太字) + spec (補足、左に縦線) を併記するレイアウトに。
           spec 空の行は補足ブロック自体を表示しない (= 行高は item_name 1 行)。
           長文 spec の場合に行が縦に間延びする問題を解消。 --}}
      {{#if (gt (length delivery_line_items) 0)}}
        {{#each delivery_line_items}}
          <tr>
            <td class="center">{{index1 @index}}</td>
            <td>
              <div class="item-name">{{#if ../isReducedTax}}<span class="reduced-mark">※</span>{{/if}}{{or item_name ../description}}</div>
              {{#if (or spec ../spec)}}
              <div class="item-spec">{{or spec ../spec}}</div>
              {{/if}}
            </td>
            {{!-- 分納の内訳: 今回検収した数量・歩留率(単価×数量×歩留率=支払対価)。
                 数量/歩留率が無い(利用許諾料に含む等)行は「—」。 --}}
            <td class="center">{{#if (gt inspected_quantity 0)}}{{inspected_quantity}}{{else}}—{{/if}}</td>
            <td class="center">{{#if (gt acceptance_ratio 0)}}{{formatPct (multiply acceptance_ratio 100)}}{{else}}—{{/if}}</td>
            <td class="center">{{formatDate (or delivery_date ../deliveredAt)}}</td>
            {{!-- 固定報酬0の対価表示: 発注者×ROYALTY=業績連動報酬(別途算定)、それ以外(受注者)=
                 利用許諾料に含む。amount>0 は通常の金額表示。 --}}
            <td class="right">{{#if (gt (or inspected_amount_ex_tax amount_ex_tax) 0)}}{{formatYen (or inspected_amount_ex_tax amount_ex_tax)}}{{else}}{{#if (eq calc_method "ROYALTY")}}{{#if (eq deliverable_ownership "発注者")}}<span style="font-size:8pt;color:#1f3a8a;">業績連動報酬（別途算定）</span>{{else}}<span style="font-size:8pt;color:#92400e;">利用許諾料に含む</span>{{/if}}{{else}}<span style="font-size:8pt;color:#92400e;">利用許諾料に含む</span>{{/if}}{{/if}}</td>
          </tr>
        {{/each}}
      {{else}}
        <tr>
          <td class="center">{{itemNo}}</td>
          <td>
            <div class="item-name">{{#if isReducedTax}}<span class="reduced-mark">※</span>{{/if}}{{description}}</div>
            {{#if spec}}
            <div class="item-spec">{{spec}}</div>
            {{/if}}
          </td>
          <td class="center">—</td>
          <td class="center">—</td>
          <td class="center">{{formatDate deliveredAt}}</td>
          <td class="right">¥{{deliveredAmountStr}}</td>
        </tr>
      {{/if}}
      {{#if otherFeesTaxable}}
      {{!-- Phase 23.6.16: その他手数料がある場合、消費税は末尾の「支払額サマリー」で
           検収税抜＋手数料税抜を合算して 1 回だけ計算する (二重計上を避けるため、
           ここでは検収の税抜小計のみ表示)。 --}}
      <tr class="total-row">
        <td colspan="5" class="right">検収 小計（税抜）</td>
        <td class="right">¥{{deliveredAmountStr}}</td>
      </tr>
      {{else}}
      <tr>
        <td colspan="5" class="right">
          消費税({{taxRate}}%{{#if isReducedTax}}・軽減税率対象{{/if}})
        </td>
        <td class="right">¥{{taxAmountStr}}</td>
      </tr>
      <tr class="total-row">
        <td colspan="5" class="right">源泉徴収税計算前　検収金額(税込)</td>
        <td class="right">¥{{totalAmountStr}}</td>
      </tr>
      {{/if}}
    </tbody>
  </table>
  {{#if isReducedTax}}
  <div class="reduced-note">※ 軽減税率（8%）対象品目</div>
  {{/if}}

  {{!-- 業績連動型報酬版: 発注者帰属×ROYALTY の成果物がある場合に表示。
       IPは検収完了をもって発注者へ譲渡(譲渡型)、報酬は固定額でなく発注者の業績に
       連動して別途算定・支払。利用許諾型(受注者帰属)とは明確に区別する。 --}}
  {{#if hasPerformanceRoyalty}}
  <div class="section-title">■ 業績連動型報酬（成果物のIPは発注者へ譲渡）</div>
  <table style="margin-bottom:4px;">
    <thead>
      <tr>
        <th style="width:6%">No.</th>
        <th style="width:48%">成果物</th>
        <th style="width:28%">報酬の算定方法</th>
        <th style="width:18%">料率</th>
      </tr>
    </thead>
    <tbody>
      {{#each performanceRoyaltyLines}}
      <tr>
        <td class="center">{{index1 @index}}</td>
        <td><div class="item-name">{{item_name}}</div></td>
        <td>{{#if (eq royalty_calc_basis "manufacturing")}}個数 × 基準価格 × 料率{{else}}{{#if (eq royalty_calc_basis "sales")}}売上高 × 料率{{else}}{{#if (eq royalty_calc_basis "sublicense")}}受領額 × 料率{{else}}{{#if (eq royalty_calc_basis "fixed")}}固定額{{else}}個数 × 基準価格 × 料率{{/if}}{{/if}}{{/if}}{{/if}}</td>
        <td class="right">{{#if rate_pct}}{{rate_pct}}%{{else}}—{{/if}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>
  <div style="font-size:8.5pt;color:#555;margin-top:2px;">※ 上記成果物は、検収完了をもって知的財産権が発注者へ移転（譲渡型）します。これらに対する報酬は固定額ではなく、発注者の業績（売上・製造数量等）に連動する「業績連動型報酬」として、別途発行する算定書（利用許諾料計算書に準じた算定）により算定・支払われます。本検収書に基づく支払額には含まれません。</div>
  {{/if}}

  {{!-- Phase 17m: 経費精算 (税込み額) — 親 PO の order_expenses から
       「今回含める」とチェックされた行のみを描画。 --}}
  {{#if expenses}}
  <div class="section-title">■ 今回精算する経費（交通費等・税込み額）</div>
  <table style="margin-bottom:4px;">
    <thead>
      <tr>
        <th style="width:6%">No.</th>
        <th style="width:34%">費目</th>
        <th style="width:30%">仕様 / 区間 等</th>
        <th style="width:15%">発生日</th>
        <th style="width:15%">金額（税込）</th>
      </tr>
    </thead>
    <tbody>
      {{#each expenses}}
      <tr>
        <td class="center">{{line_no}}</td>
        <td>{{expense_name}}</td>
        <td>{{spec}}{{#if remarks}}<div style="font-size:8pt;color:#666;margin-top:2px;">{{remarks}}</div>{{/if}}</td>
        <td class="center">{{formatDate spent_date}}</td>
        <td class="right">¥{{formatCurrency amount_inc_tax}}</td>
      </tr>
      {{/each}}
      <tr class="total-row">
        <td colspan="4" class="right">経費合計（税込）</td>
        <td class="right">¥{{expensesTotalIncTaxStr}}</td>
      </tr>
    </tbody>
  </table>
  <div style="font-size:8.5pt;color:#666;margin-top:2px;">※ 経費は税込み額にて精算します（消費税の二重計上はしません）。</div>
  {{/if}}

  {{!-- Phase 22.21.57: その他手数料 (税抜・コーディネート費・振込手数料等) --}}
  {{#if other_fees}}
  {{#if (gt (length other_fees) 0)}}
  <div class="section-title">■ 今回精算するその他手数料（税抜）</div>
  <table style="margin-bottom:4px;">
    <thead>
      <tr>
        <th style="width:6%">No.</th>
        <th style="width:64%">項目名</th>
        <th style="width:15%">金額（税抜）</th>
        <th style="width:15%">摘要</th>
      </tr>
    </thead>
    <tbody>
      {{#each other_fees}}
      <tr>
        <td class="center">{{line_no}}</td>
        <td>{{fee_name}}</td>
        <td class="right">¥{{formatCurrency amount}}</td>
        <td>{{remarks}}</td>
      </tr>
      {{/each}}
      <tr class="total-row">
        <td colspan="2" class="right">手数料合計（税抜）</td>
        <td class="right">¥{{otherFeesTotalStr}}</td>
        <td></td>
      </tr>
    </tbody>
  </table>
  <div style="font-size:8.5pt;color:#666;margin-top:2px;">※ その他手数料は税抜表示。消費税は検収金額と合算し、下記「支払額サマリー」で税率ごとに一括計算します（二重計上はしません）。</div>
  {{/if}}
  {{/if}}

  {{!-- Phase 23.6.16: 支払額サマリー（検収書は仕入明細書として消費税法57条の4 の
       記載要件に対応）。検収書は発注者が発行する書類のため「請求書」とは名乗らない。
       検収金額(税抜) と その他手数料(税抜) を税率ごとに区分して合算し、消費税を
       1 回だけ計算する。経費(税込)は課税対象外の立替として別掲。手数料がある
       ときのみ表示 (手数料が無ければ上の「源泉徴収税計算前　検収金額(税込)」で完結する)。 --}}
  {{#if otherFeesTaxable}}
  <div class="section-title">■ 支払額サマリー</div>
  <table style="margin-bottom:4px;">
    <tbody>
      <tr>
        <td style="width:70%;" class="right">検収金額（税抜）</td>
        <td style="width:30%;" class="right">¥{{deliveredAmountStr}}</td>
      </tr>
      <tr>
        <td class="right">その他手数料（税抜）</td>
        <td class="right">¥{{otherFeesTotalStr}}</td>
      </tr>
      <tr class="total-row">
        <td class="right">{{taxRate}}%対象 税抜合計</td>
        <td class="right">¥{{taxableSubtotalExTaxStr}}</td>
      </tr>
      <tr>
        <td class="right">消費税（{{taxRate}}%）</td>
        <td class="right">¥{{combinedTaxStr}}</td>
      </tr>
      <tr class="total-row" style="background:#f3f3f3;">
        <td class="right">税込合計</td>
        <td class="right">¥{{taxableTotalIncTaxStr}}</td>
      </tr>
      {{#if expenses}}
      <tr>
        <td class="right">経費（税込・課税対象外／別精算）</td>
        <td class="right">¥{{expensesTotalIncTaxStr}}</td>
      </tr>
      {{/if}}
    </tbody>
  </table>
  <div style="font-size:8.5pt;color:#666;margin-top:2px;">
    ※ 消費税は {{taxRate}}%対象（検収金額＋その他手数料）の税抜合計に対し、税率ごとに区分して一括計算しています（消費税の二重計上はしません）。{{#if counterpartyTni}} 登録番号: {{counterpartyTni}}{{/if}}
  </div>
  {{/if}}

  {{!-- 検収金額（税込）+ その他手数料（税込・上のサマリーで合算課税）+ 経費（税込） の総支払額 --}}
  {{#if (or expenses other_fees)}}
  <table style="margin-top:8px;margin-bottom:4px;">
    <tbody>
      <tr class="total-row" style="background:#eef6ff;">
        <td style="width:85%;" class="right"><strong>源泉徴収税計算前　本検収書に基づく総支払額（税込・経費 / 手数料含む）</strong></td>
        <td style="width:15%;" class="right"><strong>¥{{grandTotalPayableStr}}</strong></td>
      </tr>
    </tbody>
  </table>
  {{/if}}

  {{!-- 変更履歴（あれば） --}}
  {{#if hasChangeLogs}}
  <div class="change-log-section">
    <div class="change-log-title">⚠️ 変更履歴（当初発注条件からの変更）</div>
    {{#each changeLogs}}
    <div class="change-log-row">
      <span class="change-date">{{this.changedAt}}</span>
      <span class="change-field">{{this.fieldLabel}}</span>
      <span class="change-before">{{this.beforeValue}}</span>
      <span class="change-arrow">→</span>
      <span class="change-after">{{this.afterValue}}</span>
      <span class="change-reason">（理由: {{this.reason}}）</span>
    </div>
    {{/each}}
  </div>
  {{/if}}

  {{!-- 支払条件・発注情報 — 期日表記は formatDate で YYYY年MM月DD日 --}}
  <div class="conditions">
    <div class="condition-box">
      <h3>■ 支払条件</h3>
      <p>{{paymentConditionSummary}}</p>
      <p>支払期日: <span class="highlight">{{formatDate paymentDueDate}}</span></p>
    </div>
    <div class="condition-box">
      <h3>■ 振込先</h3>
      <p>{{bankName}} {{branchName}}</p>
      <p>{{accountType}} {{accountNo}}</p>
      <p>口座名義: {{accountHolder}}</p>
    </div>
  </div>



  {{!-- みなし同意 — 連絡先は DB の staff (inspectorDept / inspectorName / inspectorEmail) から自動補完 --}}
  <div class="section-title">■ 本検収書の内容に関するご確認のお願い</div>
  <div class="confirm-box">
    <p>本検収書にご記載の内容（検収対象成果物、仕様、数量、検収日、金額等）についてご確認のうえ、記載事項に相違または異議がある場合は、本書が貴殿に到達した日の翌日（同日が営業日でない場合は翌営業日）から起算して <strong>5営業日以内</strong> に、下記連絡先宛に書面または電子メールにより、その旨および具体的内容をご通知くださいますようお願いいたします。</p>
    <p>上記期間内に何らのご通知もいただけない場合、本検収書の記載内容（検収日、検収金額、検収対象の範囲を含みます。）について貴殿にご異議がないものとして取り扱わせていただきます。</p>
    <p class="proviso">※ 本取扱いは、製造委託等に係る中小受託事業者に対する代金の支払の遅延等の防止に関する法律（中小受託取引適正化法）、特定受託事業者に係る取引の適正化等に関する法律その他関連法令に基づき貴殿に認められる権利を制限するものではありません。</p>
    <div class="contact">
      <strong>【ご連絡先】</strong><br>
      株式会社アークライト　{{inspectorDept}}　担当: {{inspectorName}}<br>
      E-mail: {{inspectorEmail}}
    </div>
  </div>

</body>
</html>
$ins_html$,
          COALESCE(cur_schema, '[]'::jsonb),
          '検収書テンプレ差し替え（分納表現: 今回数量/歩留率 列追加）(0119)', 'migration-0119')
  RETURNING id INTO vid;

  UPDATE document_templates SET current_version_id = vid, updated_at = now() WHERE id = tid;
END $mig$;
