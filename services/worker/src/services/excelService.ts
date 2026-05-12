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
}
