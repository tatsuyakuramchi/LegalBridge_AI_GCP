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
    unit_price: number; // 単価（税抜・参考）
    quantity: number; // 数量
    amount: number; // 金額（税抜）
    delivery_date: string; // 納品日
  }>;
  reimbursement: number; // 立替金（経費税込）
  subtotal: number; // 小計（税抜合計）
  consumption_tax: number; // 消費税（小計税抜 × 税率、一括）
  withholding_tax: number; // 源泉税（税込ベース）
  after_tax: number; // 税引後（小計 + 消費税 − 源泉税）
  net_transfer_amount: number; // 差引振込額（税引後 + 立替金）
}

// Phase 24: 支払スロットを 5 → 8 に拡張。
const SLOT_COUNT = 8;

export class ExcelService {
  // ヘッダ行（件名…〜各スロット〜末尾合計欄）。
  // 末尾は 立替金 / 小計(税抜) / 消費税 / 源泉税 / 税引後 / 差引振込額 の 6 列。
  private buildHeaders(): string[] {
    const headers: string[] = [
      '件名',
      '支払日',
      '部署',
      '取引先コード',
      '氏名',
      '氏名（カナ）',
    ];
    for (let i = 1; i <= SLOT_COUNT; i++) {
      headers.push(
        `支払内容（${i}）`,
        `単価（${i}）`,
        `数量（${i}）`,
        `金額（${i}）`,
        `納品日(${i})`
      );
    }
    headers.push('立替金', '小計', '消費税', '源泉税', '税引後', '差引振込額');
    return headers;
  }

  // 1 検収書 = 1 データ行。値が無いセルは "" を明示、金額系の 0 は数値 0 のまま。
  private buildRow(data: InspectionExcelData): any[] {
    const safe = (v: any) => (v === undefined || v === null ? '' : v);
    const numOrBlank = (v: any) =>
      v === undefined || v === null ? '' : v;

    const row: any[] = [
      safe(data.summary),
      safe(data.payment_date),
      safe(data.department),
      safe(data.vendor_code),
      safe(data.name),
      safe(data.name_kana),
    ];

    // 8 スロット必ず展開 — items[i] が無くても 5 セル分の空セルを出す
    for (let i = 0; i < SLOT_COUNT; i++) {
      const item: any = data.items[i] || {};
      row.push(safe(item.content));
      row.push(numOrBlank(item.unit_price));
      row.push(numOrBlank(item.quantity));
      row.push(numOrBlank(item.amount)); // 金額（税抜）
      row.push(safe(item.delivery_date));
    }

    row.push(data.reimbursement ?? 0);
    row.push(data.subtotal ?? 0);
    row.push(data.consumption_tax ?? 0);
    row.push(data.withholding_tax ?? 0);
    row.push(data.after_tax ?? 0);
    row.push(data.net_transfer_amount ?? 0);

    return row;
  }

  // aoa（ヘッダ + データ行群）から、空セルも埋めた worksheet を組み立てる。
  private buildSheet(rows: any[][]): XLSX.WorkSheet {
    const headers = this.buildHeaders();
    for (const r of rows) {
      if (r.length !== headers.length) {
        throw new Error(
          `[ExcelService] header / row length mismatch: headers=${headers.length} row=${r.length}`
        );
      }
    }

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // trailing empty cells が trim されないよう '!ref' を明示。
    const lastCol = headers.length - 1;
    const lastRow = rows.length; // 0=ヘッダ行, 1..N=データ行
    ws['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: lastRow, c: lastCol },
    });

    // 各空セルにも明示的に空文字セルを埋め、「列が存在しない」と
    // 認識されないようにする保険。
    for (let rr = 1; rr <= lastRow; rr++) {
      for (let c = 0; c <= lastCol; c++) {
        const addr = XLSX.utils.encode_cell({ r: rr, c });
        if (!ws[addr]) {
          ws[addr] = { t: 's', v: '' };
        }
      }
    }
    return ws;
  }

  // 1 検収書 → 1 シート（ヘッダ + 1 行）の xlsx。
  generateInspectionExcel(data: InspectionExcelData): Buffer {
    const ws = this.buildSheet([this.buildRow(data)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '検収書');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  // Phase 24: 担当者 × 支払期日 のバッチ出力。
  //   複数の検収書 / 利用許諾料計算書を 1 ファイル（ヘッダ + N 行）にまとめる。
  generateInspectionExcelBatch(
    dataList: InspectionExcelData[],
    sheetName = '検収書'
  ): Buffer {
    const rows = dataList.map((d) => this.buildRow(d));
    const ws = this.buildSheet(rows.length > 0 ? rows : [this.buildRow(this.emptyData())]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  private emptyData(): InspectionExcelData {
    return {
      summary: '',
      payment_date: '',
      department: '',
      vendor_code: '',
      name: '',
      name_kana: '',
      items: [],
      reimbursement: 0,
      subtotal: 0,
      consumption_tax: 0,
      withholding_tax: 0,
      after_tax: 0,
      net_transfer_amount: 0,
    };
  }

  /**
   * formData + vendor 情報から InspectionExcelData を組み立てる。
   *   検収書 (inspection_certificate) と利用許諾料計算書 (royalty_statement)
   *   の両方をサポート。templateType が対象外なら null を返す。
   *
   *   Phase 24: 消費税の二重計算を回避する税計算に変更。
   *     - 金額（n） = 検収額（税抜）をそのまま（単価×数量ではない。部分検収を尊重）
   *     - 小計      = Σ 金額（税抜合計）
   *     - 消費税    = ceil(小計 × 税率/100)（最後に一度だけ）
   *     - 源泉税    = 税込（小計 + 消費税）ベース（現状ロジック踏襲）
   *                   税込 ≤ 100万 → 10.21% / 100万超 → 超過分 20.42%
   *                   vendor.withholding_enabled が false なら 0
   *     - 税引後    = 小計 + 消費税 − 源泉税
   *     - 差引振込額 = 税引後 + 立替金（経費税込）
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
      return s.length >= 10 ? s.substring(0, 10) : s;
    };

    let items: InspectionExcelData['items'] = [];
    let summary = '';
    let payment_date = '';
    let department = '';
    let reimbursement = 0;

    const taxRatePct = num(formData.taxRate) || (formData.isReducedTax ? 8 : 10);
    // 税額（消費税）を整数算で計算。Phase 23.0.5 の浮動小数点対策を踏襲。
    const taxOf = (exTax: number): number =>
      Math.ceil((exTax * taxRatePct) / 100);

    if (isInspection) {
      // ── 検収書 ─────────────────────────────────
      summary =
        formData.PROJECT_TITLE ||
        formData.summary ||
        formData.description ||
        '';
      payment_date = isoDate(
        // 支払期日(検収書 PDF と同じ paymentDueDate)を最優先。
        // 旧コードは paymentDate/payment_due_date しか見ず、実フィールド名
        // paymentDueDate を拾えずに documentDate(発行日)へ誤フォールバックしていた。
        formData.paymentDueDate ||
          formData.paymentDate ||
          formData.payment_due_date ||
          formData.documentDate
      );
      department = formData.inspectorDept || formData.STAFF_DEPARTMENT || '';

      const lines = Array.isArray(formData.delivery_line_items)
        ? formData.delivery_line_items
        : [];
      const otherFees = Array.isArray(formData.other_fees)
        ? formData.other_fees
        : [];

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
          const amtExTax = num(l.inspected_amount_ex_tax ?? l.amount_ex_tax);
          combined.push({
            content: l.item_name ?? p.item_name ?? l.description ?? '',
            unit_price: num(l.unit_price ?? p.unit_price), // 税抜 単価（参考）
            quantity: num(l.quantity ?? p.quantity),
            amount: amtExTax, // 税抜（検収額そのまま）
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
            amount: amtExTax, // 税抜
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
          amount: feeExTax, // 税抜
          delivery_date: isoDate(formData.documentDate),
        });
      }

      items = combined.slice(0, SLOT_COUNT);

      // 件名(列A)は成果物・業務内容にする(旧: 課題サマリ「[納品報告]…」)。
      // 明細の内容を連結。内容が無ければ PROJECT_TITLE/summary にフォールバック。
      const contentTitle = items.map((it) => it.content).filter(Boolean).join(" / ");
      if (contentTitle) summary = contentTitle;

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
    } else if (isRoyalty) {
      // ── 利用許諾料計算書 ───────────────────────
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
      const ratePct = num(formData.royaltyRatePct); // 料率 (%)
      // 実効ロイヤリティ単価 = MSRP × 料率 / 100 (税抜, 整数化)
      const effectiveUnit =
        ratePct > 0 ? Math.round((msrp * ratePct) / 100) : msrp;
      const qty = num(formData.billableQuantity);
      // 実支払 (税抜)
      const actualExTax =
        num(formData.actualRoyaltyStr) || num(formData.actualRoyalty);

      if (actualExTax > 0 || effectiveUnit > 0) {
        items = [
          {
            content,
            unit_price: effectiveUnit, // 税抜 実効単価（参考）
            quantity: qty,
            amount: actualExTax, // 税抜 実支払
            delivery_date: isoDate(formData.completionDate),
          },
        ];
      }
      reimbursement = 0;
    }

    // 小計（税抜合計）
    const subtotal = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    // 消費税（最後に一度だけ）
    const consumption_tax = taxOf(subtotal);
    // 税込（源泉ベース）
    const taxIncluded = subtotal + consumption_tax;

    // 源泉徴収（税込ベース・現状ロジック踏襲）
    let withholding_tax = 0;
    if (vendor?.withholding_enabled === true && taxIncluded > 0) {
      const threshold = 1_000_000;
      if (taxIncluded <= threshold) {
        withholding_tax = Math.floor(taxIncluded * 0.1021);
      } else {
        withholding_tax =
          Math.floor(threshold * 0.1021) +
          Math.floor((taxIncluded - threshold) * 0.2042);
      }
    }
    const after_tax = taxIncluded - withholding_tax;
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
      consumption_tax,
      withholding_tax,
      after_tax,
      net_transfer_amount,
    };
  }
}
