import * as XLSX from 'xlsx';

export interface InspectionExcelData {
  summary: string; // 件名
  payment_date: string; // 支払日
  department: string; // 部署
  vendor_code: string; // 取引先コード
  name: string; // 氏名
  name_kana: string; // 氏名（カナ）
  items: Array<{
    content: string; // 支払内容
    unit_price: number; // 単価
    quantity: number; // 数量
    amount: number; // 金額
    delivery_date: string; // 納品日
  }>;
  reimbursement: number; // 立替金
  subtotal: number; // 小計
  withholding_tax: number; // 源泉税
  after_tax: number; // 税引後
  net_transfer_amount: number; // 差引振込額
}

export class ExcelService {
  generateInspectionExcel(data: InspectionExcelData): Buffer {
    const headers = [
      '件名',
      '支払日',
      '部署',
      '取引先コード',
      '氏名',
      '氏名（カナ）',
      '支払内容（１）',
      '単価（１）',
      '数量（１）',
      '金額（１）',
      '納品日(１)',
      '支払内容（２）',
      '単価（２）',
      '数量（２）',
      '金額（２）',
      '納品日(２)',
      '支払内容（３）',
      '単価（３）',
      '数量（３）',
      '金額（３）',
      '納品日(３)',
      '支払内容（４）',
      '単価（４）',
      '数量（４）',
      '金額（４）',
      '納品日(４)',
      '支払内容（５）',
      '単価（５）',
      '数量（５）',
      '金額（５）',
      '納品日(５)',
      '立替金',
      '小計',
      '源泉税',
      '税引後',
      '差引振込額'
    ];

    // Phase 22.21.106: 空スロットでも 36 列分の セル を必ず出力する。
    //   後続処理で「行コピペで新規行を作る」運用があり、スロット 2-5 の
    //   列が無いとコピー元として使えない問題があった。
    //   - 値が無いセルは "" を入れる (undefined ではなく明示的空文字)
    //   - 立替金/小計/源泉税/税引後/差引振込額 が 0 でも数値 0 をそのまま入れる
    //     (会計側で SUM 計算しやすいため)
    const safe = (v: any) => (v === undefined || v === null ? '' : v);
    const row: any[] = [
      safe(data.summary),
      safe(data.payment_date),
      safe(data.department),
      safe(data.vendor_code),
      safe(data.name),
      safe(data.name_kana),
    ];

    // 5 スロット必ず展開 — items[i] が無くても 5 セル分の空セルを出す
    for (let i = 0; i < 5; i++) {
      const item: any = data.items[i] || {};
      row.push(safe(item.content));
      row.push(item.unit_price === undefined || item.unit_price === null ? '' : item.unit_price);
      row.push(item.quantity === undefined || item.quantity === null ? '' : item.quantity);
      row.push(item.amount === undefined || item.amount === null ? '' : item.amount);
      row.push(safe(item.delivery_date));
    }

    row.push(data.reimbursement ?? 0);
    row.push(data.subtotal ?? 0);
    row.push(data.withholding_tax ?? 0);
    row.push(data.after_tax ?? 0);
    row.push(data.net_transfer_amount ?? 0);

    // headers.length === row.length === 36 列であることを assert.
    // ここで一致しない場合は実装ミスなので例外を投げて気付けるようにする。
    if (row.length !== headers.length) {
      throw new Error(
        `[ExcelService] header / row length mismatch: headers=${headers.length} row=${row.length}`
      );
    }

    const ws = XLSX.utils.aoa_to_sheet([headers, row]);

    // Phase 22.21.106: trailing empty cells が trim されないよう
    //   sheet の '!ref' を明示的に 36 列・2 行に設定する。
    //   encode_range で A1:AJ2 のような正式 A1 形式に変換 (36 列目 = AJ)。
    const lastCol = headers.length - 1; // 35 (0-indexed)
    ws['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: 1, c: lastCol },
    });

    // 各空セルにも明示的に空文字セル {t:'s', v:''} を埋めて、
    // Excel 側で「列が存在しない」と認識されないようにする保険。
    for (let c = 0; c <= lastCol; c++) {
      const addr = XLSX.utils.encode_cell({ r: 1, c }); // 2 行目 (データ行)
      if (!ws[addr]) {
        ws[addr] = { t: 's', v: '' };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '検収書');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Phase 22.21.104: formData + vendor 情報から InspectionExcelData を組み立てる。
   *   検収書 (inspection_certificate) と利用許諾料計算書 (royalty_statement)
   *   の両方をサポート。templateType が対象外なら null を返す。
   *
   *   源泉徴収:
   *     vendor.withholding_enabled === true のときのみ控除。
   *     - 支払対象額 (=小計) <= 100万円 → 10.21%
   *     - 100万円超 → 1,000,000 × 10.21% + (超過分 × 20.42%)
   *     vendor が見つからない / withholding_enabled が false → 控除 0
   */
  buildFromFormData(
    formData: any,
    templateType: string,
    vendor: {
      vendor_code?: string;
      vendor_name?: string;
      account_holder_kana?: string;
      withholding_enabled?: boolean;
    } | null
  ): InspectionExcelData | null {
    if (!formData) return null;
    const isInspection = String(templateType || '').startsWith(
      'inspection_certificate'
    );
    const isRoyalty = templateType === 'royalty_statement';
    if (!isInspection && !isRoyalty) return null;

    const num = (v: any): number => {
      if (v == null) return 0;
      const n = Number(String(v).replace(/[^0-9.-]+/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    const isoDate = (v: any): string => {
      if (!v) return '';
      const s = String(v);
      // 既に YYYY-MM-DD ならそのまま、それ以外は先頭 10 文字
      return s.length >= 10 ? s.substring(0, 10) : s;
    };

    let items: InspectionExcelData['items'] = [];
    let summary = '';
    let payment_date = '';
    let department = '';
    let reimbursement = 0;
    let subtotal = 0;

    // Phase 22.21.109: 支払スロットの金額を税込に変更。
    //   - 単価は 税抜 のまま (実勢単価。数量との掛け算は崩れるが運用優先)
    //   - 金額 = 税込 (= 税抜 × (1 + taxRate/100), ceil)
    //   - 小計 = 税込合計
    //   - 源泉徴収 = 税込小計 × 10.21% (100万超は超過分 20.42%)
    //   - 税引後 = 税込小計 − 源泉
    //   - 差引振込額 = 税引後 + 立替金 (経費税込)
    const taxRatePct = num(formData.taxRate) || (formData.isReducedTax ? 8 : 10);
    const toIncTax = (exTax: number): number =>
      Math.ceil(exTax * (1 + taxRatePct / 100));

    if (isInspection) {
      // ── 検収書 ─────────────────────────────────
      // Phase 22.21.105: スロット詰め込み順
      //   ① 業務明細 (delivery_line_items) を先に詰める
      //   ② その他手数料 (other_fees) を続けて同じスロットに詰める
      //   ③ 5 スロット超過分は無視
      //   ④ 経費・交通費 (expenses, 税込) は合算して「立替金」へ
      summary =
        formData.PROJECT_TITLE ||
        formData.summary ||
        formData.description ||
        '';
      payment_date = isoDate(
        formData.paymentDate || formData.payment_due_date || formData.documentDate
      );
      department =
        formData.inspectorDept || formData.STAFF_DEPARTMENT || '';

      const lines = Array.isArray(formData.delivery_line_items)
        ? formData.delivery_line_items
        : [];
      const otherFees = Array.isArray(formData.other_fees)
        ? formData.other_fees
        : [];

      // Phase 23.0.2: delivery_line_items は inspected_amount_ex_tax しか
      //   持たないので、item_name / unit_price / quantity / delivery_date は
      //   order_lines_for_inspection 側を引いて補完する。
      //   結合キーは order_line_item_id (UnifiedContractPicker が capability_line_items.id
      //   を入れる)。fallback として line_no でも結合。
      const parentLines = Array.isArray(formData.order_lines_for_inspection)
        ? formData.order_lines_for_inspection
        : [];
      const findParentLine = (l: any): any => {
        const olid = l.order_line_item_id ?? l.capability_line_item_id;
        if (olid != null) {
          const m = parentLines.find(
            (p: any) => Number(p.id) === Number(olid)
          );
          if (m) return m;
        }
        if (l.line_no != null) {
          const m = parentLines.find(
            (p: any) => Number(p.line_no) === Number(l.line_no)
          );
          if (m) return m;
        }
        return null;
      };

      const combined: InspectionExcelData['items'] = [];

      if (lines.length > 0) {
        for (const l of lines) {
          const p = findParentLine(l) || {};
          // Phase 23.0.4: `||` だと 0 を falsy 扱いして「今回検収しない 0 円行」
          //   が発注額 (amount_ex_tax) に化ける。null/undefined のみフォール
          //   バックする `??` を使う。unit_price / quantity / delivery_date /
          //   item_name も同様 (0 や空文字を意図的に入れている場合の挙動を尊重)。
          const amtExTax = num(l.inspected_amount_ex_tax ?? l.amount_ex_tax);
          combined.push({
            content: l.item_name ?? p.item_name ?? l.description ?? '',
            unit_price: num(l.unit_price ?? p.unit_price), // 税抜 単価
            quantity: num(l.quantity ?? p.quantity),
            amount: toIncTax(amtExTax), // 税込
            delivery_date: isoDate(l.delivery_date ?? p.delivery_date),
          });
        }
      } else {
        // 自由入力フォールバック (単一明細)
        const amtExTax = num(formData.deliveredAmountStr);
        if (amtExTax > 0 || formData.description) {
          combined.push({
            content:
              formData.description || formData.itemName || '検収内容',
            unit_price: amtExTax,
            quantity: 1,
            amount: toIncTax(amtExTax),
            delivery_date: isoDate(
              formData.deliveryDate || formData.documentDate
            ),
          });
        }
      }

      // その他手数料: { line_no, fee_name, amount(税抜), remarks? }
      for (const f of otherFees) {
        const feeExTax = num(f.amount);
        combined.push({
          content: f.fee_name || f.label || f.description || '手数料',
          unit_price: feeExTax, // 税抜
          quantity: 1,
          amount: toIncTax(feeExTax), // 税込
          delivery_date: isoDate(formData.documentDate),
        });
      }

      items = combined.slice(0, 5);

      // 立替金 = 経費 (税込) 合算
      let reimburseSum = num(formData.expensesTotalIncTax);
      if (!reimburseSum && Array.isArray(formData.expenses)) {
        reimburseSum = formData.expenses.reduce(
          (s: number, e: any) =>
            s + num(e.amount_inc_tax || e.amount || e.amount_ex_tax),
          0
        );
      }
      reimbursement = reimburseSum;

      // 小計 = 税込 items 合算
      subtotal = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    } else if (isRoyalty) {
      // ── 利用許諾料計算書 ───────────────────────
      // Phase 22.21.110: 単価列を「実効ロイヤリティ単価」(= MSRP × 料率)
      //   に変更。旧実装は MSRP そのもの (2500) を出していたため、
      //   単価×数量 が小計とまったく合わない見た目になっていた。
      //   今後: 単価 = MSRP × 料率 / 100 → 単価×数量 ≒ 税抜小計
      //         金額 = 税込実支払 (Phase 22.21.109)
      summary = (formData.originalWork || '') + ' 利用許諾料';
      payment_date = isoDate(
        formData.paymentDueDate || formData.documentDate
      );
      department = formData.STAFF_DEPARTMENT || '';

      const content =
        (formData.productName || '') +
        (formData.edition ? `（${formData.edition}）` : '') +
        ' 利用許諾料';
      const msrp = num(formData.msrpStr); // 基準価格 (MSRP)
      const ratePct = num(formData.royaltyRatePct); // 料率 (%) 例: 5
      // 実効ロイヤリティ単価 = MSRP × 料率 / 100 (税抜, 整数化)
      const effectiveUnit = ratePct > 0 ? Math.round(msrp * ratePct / 100) : msrp;
      const qty = num(formData.billableQuantity);
      // 実支払 (税抜) → 税込
      const actualExTax =
        num(formData.actualRoyaltyStr) || num(formData.actualRoyalty);
      // formData.totalPaymentStr が既に 税込 計算されているのでそれを優先
      const actualIncTax =
        num(formData.totalPaymentStr) || toIncTax(actualExTax);

      if (actualIncTax > 0 || effectiveUnit > 0) {
        items = [
          {
            content,
            unit_price: effectiveUnit, // 税抜 実効単価 (= MSRP × 料率)
            quantity: qty,
            amount: actualIncTax, // 税込実支払
            delivery_date: isoDate(formData.completionDate),
          },
        ];
      }
      reimbursement = 0;
      subtotal = actualIncTax;
    }

    // Phase 22.21.109: 源泉徴収 = 税込小計 × 税率
    //   - 税込 100 万円以下 → 10.21%
    //   - 100 万円超     → 1,000,000 × 10.21% + (超過分 × 20.42%)
    let withholding_tax = 0;
    if (vendor?.withholding_enabled === true && subtotal > 0) {
      const threshold = 1_000_000;
      if (subtotal <= threshold) {
        withholding_tax = Math.floor(subtotal * 0.1021);
      } else {
        withholding_tax =
          Math.floor(threshold * 0.1021) +
          Math.floor((subtotal - threshold) * 0.2042);
      }
    }
    const after_tax = subtotal - withholding_tax;
    const net_transfer_amount = after_tax + reimbursement;

    return {
      summary,
      payment_date,
      department,
      vendor_code: vendor?.vendor_code || formData.VENDOR_CODE || '',
      name:
        vendor?.vendor_name ||
        formData.counterparty ||
        formData.licensor ||
        formData.VENDOR_NAME ||
        '',
      name_kana:
        vendor?.account_holder_kana ||
        formData.accountHolder ||
        formData.ACCOUNT_HOLDER_KANA ||
        '',
      items,
      reimbursement,
      subtotal,
      withholding_tax,
      after_tax,
      net_transfer_amount,
    };
  }
}
