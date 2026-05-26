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

    const row: any[] = [
      data.summary,
      data.payment_date,
      data.department,
      data.vendor_code,
      data.name,
      data.name_kana
    ];

    // Add 5 items
    for (let i = 0; i < 5; i++) {
      const item = data.items[i] || { content: '', unit_price: '', quantity: '', amount: '', delivery_date: '' };
      row.push(item.content);
      row.push(item.unit_price);
      row.push(item.quantity);
      row.push(item.amount);
      row.push(item.delivery_date);
    }

    row.push(data.reimbursement);
    row.push(data.subtotal);
    row.push(data.withholding_tax);
    row.push(data.after_tax);
    row.push(data.net_transfer_amount);

    const ws = XLSX.utils.aoa_to_sheet([headers, row]);
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

    if (isInspection) {
      // ── 検収書 ─────────────────────────────────
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

      // 明細別検収 (delivery_line_items) があれば優先、無ければ自由入力フォールバック
      const lines = Array.isArray(formData.delivery_line_items)
        ? formData.delivery_line_items
        : [];
      if (lines.length > 0) {
        items = lines.slice(0, 5).map((l: any) => ({
          content: l.item_name || l.description || '',
          unit_price: num(l.unit_price),
          quantity: num(l.quantity),
          amount: num(l.inspected_amount_ex_tax || l.amount_ex_tax),
          delivery_date: isoDate(l.delivery_date),
        }));
      } else {
        // 自由入力フォールバック (単一明細)
        const amt = num(formData.deliveredAmountStr);
        if (amt > 0 || formData.description) {
          items = [
            {
              content:
                formData.description || formData.itemName || '検収内容',
              unit_price: amt,
              quantity: 1,
              amount: amt,
              delivery_date: isoDate(
                formData.deliveryDate || formData.documentDate
              ),
            },
          ];
        }
      }

      reimbursement = num(formData.expensesTotalIncTax);
      // 小計 = 検収金額 (税抜) + 立替金 (= grandTotalPayable は税込なので不適切)
      subtotal = items.reduce((s, it) => s + it.amount, 0);
    } else if (isRoyalty) {
      // ── 利用許諾料計算書 ───────────────────────
      // 行 1 にグロス計算、行 2-5 は空 (ユーザー回答に従う)
      summary = (formData.originalWork || '') + ' 利用許諾料';
      payment_date = isoDate(
        formData.paymentDueDate || formData.documentDate
      );
      department = formData.STAFF_DEPARTMENT || '';

      const content =
        (formData.productName || '') +
        (formData.edition ? `（${formData.edition}）` : '') +
        ' 利用許諾料';
      // 単価 = MSRP × 料率 (実効単価相当)、数量 = 課金対象、金額 = 実支払
      const unit = num(formData.msrpStr);
      const qty = num(formData.billableQuantity);
      const amount = num(formData.actualRoyaltyStr) || num(formData.actualRoyalty);
      if (amount > 0 || unit > 0) {
        items = [
          {
            content,
            unit_price: unit,
            quantity: qty,
            amount,
            delivery_date: isoDate(formData.completionDate),
          },
        ];
      }
      reimbursement = 0;
      subtotal = amount;
    }

    // 源泉徴収 (10.21% / 20.42% の段階課税)
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
