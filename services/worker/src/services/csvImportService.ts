import Papa from "papaparse";
import { query, getNewDocumentNumber } from "../lib/db.ts";

export interface CsvImportResult {
  success: boolean;
  processedCount: number;
  errors: string[];
  csvOutput?: string;
}

export class CsvImportService {
  /**
   * Section 7.2: generic mode (Unified with Inspection)
   * Returns a CSV pre-filled for the next step (Inspection/Delivery)
   */
  async importGeneric(csvText: string): Promise<CsvImportResult> {
    const parseResult = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const errors: string[] = [];
    let rowIndex = 0;
    let processedCount = 0;
    const resultRows: any[] = [];

    const headers = ["issueKey", "orderNumber", "itemName", "vendorCode", "amount", "dueDate", "deliveredAt", "deliveredAmount", "inspectionDeadline", "deliveryNo", "isPartial", "spec", "SlackID", "CHANGE_RECORDS"];

    for (const row of parseResult.data as any[]) {
      rowIndex++;
      try {
        const desc = row.desc || row.itemName || row.item_name || row["業務内容"] || row["成果物名"];
        const vendorCode = row.vendorCode || row.vendor_code || row.registration_number || row["登録番号"] || row.VendorCode;
        const dueDate = row.dueDate || row.due_date || row.delivery_date || row["納期"] || row["納品日"] || row.DueDate;
        const amountStr = String(row.amount || row["金額"] || row["税抜金額"] || row.Amount || "0").replace(/,/g, "");
        const amount = parseFloat(amountStr);
        const slackId = row.SlackID || row.slack_user_id || "";
        
        let orderNumber = row.orderNumber || row.ORDER_NO || "";

        if (!desc || !vendorCode) {
          errors.push(`Row ${rowIndex}: Missing required fields (desc or vendorCode)`);
          continue;
        }

        const issueKey = row.issue_key || row.issueKey || `CSV-GEN-${Date.now()}-${processedCount}`;
        
        // Auto-generate PO number if it doesn't exist and this looks like a PO import
        if (!orderNumber) {
          orderNumber = await getNewDocumentNumber("purchase_order");
        }

        // 1. Create Legal Request / Order
        await query(
          "INSERT INTO legal_requests (backlog_issue_key, slack_user_id, counterparty, summary, notes) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (backlog_issue_key) DO UPDATE SET counterparty = EXCLUDED.counterparty",
          [issueKey, slackId, vendorCode, desc, JSON.stringify({ ...row, orderNumber })]
        );

        // 2. Inspection part (optional)
        const deliveredAt = row.deliveredAt || row.DeliveredAt || row["納品完了日"];
        const deliveredAmountStr = String(row.deliveredAmount || row.DeliveredAmount || row["今回納品額"] || "").replace(/,/g, "");
        
        if (deliveredAt || deliveredAmountStr) {
          const deliveryNo = row.deliveryNo || row.DeliveryNo || "1";
          const inspectionDeadline = row.inspectionDeadline || row.InspectionDeadline || deliveredAt;
          
          await query(
            `INSERT INTO delivery_events 
             (backlog_issue_key, delivery_no, status, delivered_at, delivered_amount, inspection_deadline, note) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (backlog_issue_key, delivery_no) DO UPDATE SET 
             delivered_at = EXCLUDED.delivered_at, delivered_amount = EXCLUDED.delivered_amount`,
            [
              issueKey, 
              parseInt(deliveryNo), 
              "pending", 
              deliveredAt || new Date().toISOString().split('T')[0], 
              parseFloat(deliveredAmountStr || "0"), 
              inspectionDeadline,
              `Bulk imported unified: ${desc}`
            ]
          );

          await query(
            "INSERT INTO issue_workflows (backlog_issue_key, issue_type_name, current_status_name) VALUES ($1, $2, $3) ON CONFLICT (backlog_issue_key) DO NOTHING",
            [issueKey, "delivery_request", "文書生成依頼"]
          );
        }

        resultRows.push({
          issueKey,
          orderNumber,
          itemName: desc,
          vendorCode,
          amount,
          dueDate,
          deliveredAt: deliveredAt || "",
          deliveredAmount: deliveredAmountStr || "",
          inspectionDeadline: row.inspectionDeadline || "",
          deliveryNo: row.deliveryNo || "1",
          isPartial: row.isPartial || "FALSE",
          spec: row.spec || "",
          SlackID: slackId,
          CHANGE_RECORDS: row.CHANGE_RECORDS || ""
        });

        processedCount++;
      } catch (err) {
        errors.push(`Row ${rowIndex}: ${String(err)}`);
      }
    }

    const csvOutput = Papa.unparse({ fields: headers, data: resultRows });

    return { success: errors.length === 0, processedCount, errors, csvOutput };
  }

  async importVendors(csvText: string): Promise<CsvImportResult> {
    if (!csvText || !csvText.trim()) {
      return { success: true, processedCount: 0, errors: [] };
    }
    const parseResult = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const errors: string[] = [];
    let rowIndex = 0;
    let processedCount = 0;

    for (const row of parseResult.data as any[]) {
      rowIndex++;
      // Check if the row is entirely empty
      const hasAnyValue = Object.values(row).some(val => val !== null && val !== undefined && String(val).trim() !== "");
      if (!hasAnyValue) {
        continue;
      }

      try {
        const vendor_code = row.vendorCode || row.vendor_code || row["仕入先コード"] || row["取引先コード"];
        const vendor_name = row.vendorName || row.vendor_name || row["仕入先名"] || row["取引先名"];
        
        if (!vendor_code || !vendor_name) {
          errors.push(`Row ${rowIndex}: Missing vendorCode or vendorName`);
          continue;
        }

        const trade_name = row.tradeName || row.trade_name || row["屋号"] || row["屋号・ペンネーム"] || "";
        const pen_name = row.penName || row.pen_name || row["ペンネーム"] || "";
        const vendor_suffix = row.vendorSuffix || row.vendor_suffix || row["敬称"] || "様";
        const entity_type = row.entityType || row.entity_type || row["エンティティ"] || row["種別"] || "individual";
        const withholding_enabled = String(row.withholdingEnabled || row.withholding_enabled || row["源泉徴収"] || "").toUpperCase() === "TRUE";
        const aliases = row.aliases || row["エイリアス"] || "";
        const address = row.address || row.address_name || row["住所"] || row["所在地"] || "";
        const phone = row.phone || row["電話番号"] || row["電話"] || "";
        const email = row.email || row["メール"] || row["メールアドレス"] || "";
        const contact_department = row.contactDepartment || row.contact_department || row["担当部署"] || "";
        // Phase 22.21.77: 「代表者名」を contact_name から外す (vendor_rep に移管)。
        //   旧仕様 (Phase 22.13 前) では vendor_rep カラムが無く contact_name で
        //   兼用していたが、22.13 で正式な vendor_rep カラムが追加された後も
        //   ここのマッピングが残っていたため CSV 「代表者名」列が誤って
        //   担当者名フィールドを上書きしていた。
        const contact_name = row.contactName || row.contact_name || row["担当者名"] || row["担当者"] || row["宛名"] || "";
        // Phase 22.21.77: vendor_rep (法人の代表者名) を取り込む。
        //   admin-ui の VendorsPanel が法人区分時のみ表示するフィールドに対応。
        const vendor_rep = row.vendorRep || row.vendor_rep || row["代表者名"] || row["代表者"] || row["代表"] || "";
        const master_contract_ref = row.masterContractRef || row.master_contract_ref || row["基本契約書参照"] || "";
        const bank_info = row.bankInfo || row.bank_info || "";
        const bank_name = row.bankName || row.bank_name || row["金融機関名"] || row["銀行名"] || "";
        const branch_name = row.branchName || row.branch_name || row["支店名"] || "";
        const account_type = row.accountType || row.account_type || row["預金種別"] || row["口座種別"] || "普通";
        const account_number = row.accountNumber || row.account_number || row["口座番号"] || "";
        const account_holder_kana = row.accountHolderKana || row.account_holder_kana || row["口座名義カナ"] || row["名義人カナ"] || "";
        const is_invoice_issuer = String(row.isInvoiceIssuer || row.is_invoice_issuer || row["適格請求書発行事業者"] || "").toUpperCase() === "TRUE";
        const invoice_registration_number = row.invoiceRegistrationNumber || row.invoice_registration_number || row["インボイス登録番号"] || row["登録番号"] || "";

        await query(
          // Phase 22.21.77: vendor_rep カラムを INSERT/UPDATE に追加
          `INSERT INTO vendors (
            vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type,
            withholding_enabled, aliases, address, phone, email, contact_department,
            contact_name, master_contract_ref, bank_info, bank_name, branch_name,
            account_type, account_number, account_holder_kana, is_invoice_issuer,
            invoice_registration_number, vendor_rep
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
          ON CONFLICT (vendor_code) DO UPDATE SET
            vendor_name = CASE WHEN vendors.vendor_name IS NULL OR vendors.vendor_name = '' THEN EXCLUDED.vendor_name ELSE vendors.vendor_name END,
            trade_name = CASE WHEN vendors.trade_name IS NULL OR vendors.trade_name = '' THEN EXCLUDED.trade_name ELSE vendors.trade_name END,
            pen_name = CASE WHEN vendors.pen_name IS NULL OR vendors.pen_name = '' THEN EXCLUDED.pen_name ELSE vendors.pen_name END,
            vendor_suffix = CASE WHEN vendors.vendor_suffix IS NULL OR vendors.vendor_suffix = '' THEN EXCLUDED.vendor_suffix ELSE vendors.vendor_suffix END,
            entity_type = CASE WHEN vendors.entity_type IS NULL OR vendors.entity_type = '' THEN EXCLUDED.entity_type ELSE vendors.entity_type END,
            withholding_enabled = CASE WHEN vendors.withholding_enabled IS NULL THEN EXCLUDED.withholding_enabled ELSE vendors.withholding_enabled END,
            aliases = CASE WHEN vendors.aliases IS NULL OR vendors.aliases = '' THEN EXCLUDED.aliases ELSE vendors.aliases END,
            address = CASE WHEN vendors.address IS NULL OR vendors.address = '' THEN EXCLUDED.address ELSE vendors.address END,
            phone = CASE WHEN vendors.phone IS NULL OR vendors.phone = '' THEN EXCLUDED.phone ELSE vendors.phone END,
            email = CASE WHEN vendors.email IS NULL OR vendors.email = '' THEN EXCLUDED.email ELSE vendors.email END,
            contact_department = CASE WHEN vendors.contact_department IS NULL OR vendors.contact_department = '' THEN EXCLUDED.contact_department ELSE vendors.contact_department END,
            contact_name = CASE WHEN vendors.contact_name IS NULL OR vendors.contact_name = '' THEN EXCLUDED.contact_name ELSE vendors.contact_name END,
            master_contract_ref = CASE WHEN vendors.master_contract_ref IS NULL OR vendors.master_contract_ref = '' THEN EXCLUDED.master_contract_ref ELSE vendors.master_contract_ref END,
            bank_info = CASE WHEN vendors.bank_info IS NULL OR vendors.bank_info = '' THEN EXCLUDED.bank_info ELSE vendors.bank_info END,
            bank_name = CASE WHEN vendors.bank_name IS NULL OR vendors.bank_name = '' THEN EXCLUDED.bank_name ELSE vendors.bank_name END,
            branch_name = CASE WHEN vendors.branch_name IS NULL OR vendors.branch_name = '' THEN EXCLUDED.branch_name ELSE vendors.branch_name END,
            account_type = CASE WHEN vendors.account_type IS NULL OR vendors.account_type = '' THEN EXCLUDED.account_type ELSE vendors.account_type END,
            account_number = CASE WHEN vendors.account_number IS NULL OR vendors.account_number = '' THEN EXCLUDED.account_number ELSE vendors.account_number END,
            account_holder_kana = CASE WHEN vendors.account_holder_kana IS NULL OR vendors.account_holder_kana = '' THEN EXCLUDED.account_holder_kana ELSE vendors.account_holder_kana END,
            is_invoice_issuer = CASE WHEN vendors.is_invoice_issuer IS NULL THEN EXCLUDED.is_invoice_issuer ELSE vendors.is_invoice_issuer END,
            invoice_registration_number = CASE WHEN vendors.invoice_registration_number IS NULL OR vendors.invoice_registration_number = '' THEN EXCLUDED.invoice_registration_number ELSE vendors.invoice_registration_number END,
            vendor_rep = CASE WHEN vendors.vendor_rep IS NULL OR vendors.vendor_rep = '' THEN EXCLUDED.vendor_rep ELSE vendors.vendor_rep END`,
          [
            vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type,
            withholding_enabled, aliases, address, phone, email, contact_department,
            contact_name, master_contract_ref, bank_info, bank_name, branch_name,
            account_type, account_number, account_holder_kana, is_invoice_issuer,
            invoice_registration_number, vendor_rep
          ]
        );
        processedCount++;
      } catch (err) {
        errors.push(`Row ${rowIndex}: ${String(err)}`);
      }
    }
    return { success: errors.length === 0, processedCount, errors };
  }

  async importStaff(csvText: string): Promise<CsvImportResult> {
    const parseResult = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const errors: string[] = [];
    let rowIndex = 0;
    let processedCount = 0;
    for (const row of parseResult.data as any[]) {
      rowIndex++;
      try {
        const slackId = row.slack_user_id || row.slackUserId || row["SlackID"];
        const name = row.staff_name || row.staffName || row["氏名"];
        if (!slackId || !name) {
          errors.push(`Row ${rowIndex}: Missing slackUserId or staffName`);
          continue;
        }

        const email = row.email || row["メール"] || row["メールアドレス"] || "";
        const phone = row.phone || row["電話"] || row["電話番号"] || "";
        const department = row.department || row["部署"] || "";
        const department_code = row.department_code || row.departmentCode || row["部署コード"] || "";

        await query(
          "INSERT INTO staff (slack_user_id, staff_name, email, phone, department, department_code) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (slack_user_id) DO UPDATE SET staff_name = EXCLUDED.staff_name, email = EXCLUDED.email, phone = EXCLUDED.phone, department = EXCLUDED.department, department_code = EXCLUDED.department_code",
          [slackId, name, email, phone, department, department_code]
        );
        processedCount++;
      } catch (err) {
        errors.push(`Row ${rowIndex}: ${String(err)}`);
      }
    }
    return { success: errors.length === 0, processedCount, errors };
  }

  /**
   * Section 7.3: publishing_bulk (Unified with Inspection)
   * SlackID,OrderDate,PaymentDate,VendorCode,VendorName,BookTitle,Summary,Details,UnitPrice,Quantity,TotalAmount,Deadline1,Deadline2,FinalDeadline,deliveredAt,deliveredAmount,inspectionDeadline,deliveryNo
   */
  async importPublishingBulk(csvText: string): Promise<CsvImportResult> {
    const parseResult = Papa.parse(csvText, { header: false, skipEmptyLines: true });
    const errors: string[] = [];
    let processedCount = 0;
    const resultRows: any[] = [];

    const headers = ["SlackID", "OrderDate", "PaymentDate", "VendorCode", "VendorName", "BookTitle", "Summary", "Details", "UnitPrice", "Quantity", "TotalAmount", "Deadline1", "Deadline2", "FinalDeadline", "deliveredAt", "deliveredAmount", "inspectionDeadline", "deliveryNo", "orderNumber", "CHANGE_RECORDS", "issueKey"];

    // Skip header row
    const data = parseResult.data.slice(1);

    for (const row of data as any[]) {
      try {
        let [
          staffId, 
          orderDate, 
          paymentDate, 
          vendorCode, 
          vendorName, 
          bookTitle, 
          summary, 
          details, 
          unitPrice, 
          quantity, 
          totalAmount, 
          deadline1, 
          deadline2, 
          finalDeadline,
          deliveredAt,
          deliveredAmount,
          inspectionDeadline,
          deliveryNo,
          orderNumber,
          changeRecords
        ] = row;

        if (!staffId || !vendorCode) {
          errors.push(`Row ${processedCount + 2}: Missing required fields (SlackID or VendorCode)`);
          continue;
        }

        const issueKey = `PUB-${vendorCode}-${Date.now()}-${processedCount}`;
        
        // Auto-generate PO number if missing
        if (!orderNumber) {
          orderNumber = await getNewDocumentNumber("purchase_order");
        }

        // 1. Create Legal Request record
        const reqResult = await query(
          "INSERT INTO legal_requests (backlog_issue_key, slack_user_id, summary, notes, counterparty) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [issueKey, staffId, `${vendorName} - ${bookTitle}`, details || summary, vendorName]
        );
        
        // Phase 23: order_items → contract_capabilities (record_type='purchase_order')
        //   vendor_code は vendors.vendor_code 経由で vendor_id を引いて保存。
        let vendorIdForBulk: number | null = null;
        if (vendorCode) {
          const vr = await query(
            "SELECT id FROM vendors WHERE vendor_code = $1 LIMIT 1",
            [vendorCode]
          );
          vendorIdForBulk = vr.rows[0]?.id ? Number(vr.rows[0].id) : null;
        }
        await query(
          `INSERT INTO documents (
             legal_request_id,
             vendor_id,
             contract_title,
             amount_ex_tax,
             due_date,
             backlog_issue_key,
             record_type,
             contract_category,
             contract_type,
             document_number,
             template_type,
             revision,
             is_primary,
             lifecycle_status
           ) VALUES (
             $1,
             $2,
             $3,
             $4,
             $5,
             $6,
             'purchase_order',
             'service',
             'purchase_order',
             $7,
             COALESCE('purchase_order', ''),
             NULL,
             NULL,
             NULL
           )
           ON CONFLICT (document_number) DO UPDATE SET
             legal_request_id = COALESCE(EXCLUDED.legal_request_id, documents.legal_request_id),
             vendor_id = COALESCE(EXCLUDED.vendor_id, documents.vendor_id),
             contract_title = COALESCE(EXCLUDED.contract_title, documents.contract_title),
             amount_ex_tax = COALESCE(EXCLUDED.amount_ex_tax, documents.amount_ex_tax),
             due_date = COALESCE(EXCLUDED.due_date, documents.due_date),
             backlog_issue_key = COALESCE(EXCLUDED.backlog_issue_key, documents.backlog_issue_key),
             record_type = COALESCE(EXCLUDED.record_type, documents.record_type),
             contract_category = COALESCE(EXCLUDED.contract_category, documents.contract_category),
             contract_type = COALESCE(EXCLUDED.contract_type, documents.contract_type),
             updated_at = now()`,
          [
            reqResult.rows[0].id,
            vendorIdForBulk,
            summary,
            parseFloat(String(totalAmount || "0").replace(/,/g, "")),
            finalDeadline || orderDate,
            issueKey,
            orderNumber,
          ]
        );

        // 2. Inspection part (optional)
        if (deliveredAt || deliveredAmount) {
          await query(
            `INSERT INTO delivery_events 
             (backlog_issue_key, delivery_no, status, delivered_at, delivered_amount, inspection_deadline, note) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              issueKey, 
              deliveryNo ? parseInt(deliveryNo) : 1, 
              "pending", 
              deliveredAt || new Date().toISOString().split('T')[0], 
              parseFloat(String(deliveredAmount || "0").replace(/,/g, "")), 
              inspectionDeadline || deliveredAt || finalDeadline,
              `Bulk imported publishing-unified: ${bookTitle}`
            ]
          );

          await query(
            "INSERT INTO issue_workflows (backlog_issue_key, issue_type_name, current_status_name) VALUES ($1, $2, $3) ON CONFLICT (backlog_issue_key) DO NOTHING",
            [issueKey, "delivery_request", "文書生成依頼"]
          );
        }

        resultRows.push([
          staffId, 
          orderDate, 
          paymentDate, 
          vendorCode, 
          vendorName, 
          bookTitle, 
          summary, 
          details, 
          unitPrice, 
          quantity, 
          totalAmount, 
          deadline1, 
          deadline2, 
          finalDeadline,
          deliveredAt || "",
          deliveredAmount || "",
          inspectionDeadline || "",
          deliveryNo || "1",
          orderNumber,
          changeRecords || "",
          issueKey
        ]);

        processedCount++;
      } catch (err) {
        errors.push(`Row ${processedCount + 2}: ${String(err)}`);
      }
    }

    const csvOutput = Papa.unparse({ fields: headers, data: resultRows });

    return { success: errors.length === 0, processedCount, errors, csvOutput };
  }

  async importContracts(csvText: string): Promise<CsvImportResult> {
    if (!csvText || !csvText.trim()) {
      return { success: true, processedCount: 0, errors: [] };
    }
    const parseResult = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const errors: string[] = [];
    let rowIndex = 0;
    let processedCount = 0;

    for (const row of parseResult.data as any[]) {
      rowIndex++;
      // Check if the row is entirely empty
      const hasAnyValue = Object.values(row).some(val => val !== null && val !== undefined && String(val).trim() !== "");
      if (!hasAnyValue) {
        continue;
      }

      try {
        const vendor_code = row.vendorCode || row.vendor_code || row["取引先コード"] || row["仕入先コード"];
        const vendor_name = row.vendorName || row.vendor_name || row["取引先名"] || row["仕入先名"];
        
        if (!vendor_code && !vendor_name) {
          errors.push(`Row ${rowIndex}: 取引先コード (vendorCode) または 取引先名 (vendorName) が必要です。`);
          continue;
        }

        // 1. Find or create vendor
        let vendorId: number | null = null;
        let vCode = vendor_code || `VND-AUTO-${Date.now()}-${processedCount}`;
        let vName = vendor_name || `自動登録取引先 (${vCode})`;

        // Lookup by code first
        let vRes = await query("SELECT * FROM vendors WHERE vendor_code = $1", [vCode]);
        if (vRes.rows.length > 0) {
          const existingVendor = vRes.rows[0];
          vendorId = existingVendor.id;

          // Merge empty vendor fields with CSV values if provided in row
          const subUpdates: string[] = [];
          const subParams: any[] = [];
          let paramIdx = 1;

          const fieldsToMerge = [
            { key: 'trade_name', keys: ['tradeName', 'trade_name', '屋号', '屋号・ペンネーム'] },
            { key: 'pen_name', keys: ['penName', 'pen_name', 'ペンネーム'] },
            { key: 'entity_type', keys: ['entityType', 'entity_type', 'エンティティ', '種別'] },
            // Phase 22.21.77: 代表者名 は vendor_rep へ。担当者名 / 担当者 のみ contact_name に。
            { key: 'contact_name', keys: ['contactName', 'contact_name', '担当者名', '担当者', '宛名'] },
            { key: 'vendor_rep', keys: ['vendorRep', 'vendor_rep', '代表者名', '代表者', '代表'] },
            { key: 'address', keys: ['address', '住所', '取引先住所', '所在地'] },
            { key: 'bank_name', keys: ['bankName', 'bank_name', '銀行名'] },
            { key: 'branch_name', keys: ['branchName', 'branch_name', '支店名'] },
            { key: 'account_type', keys: ['accountType', 'account_type', '預金種別', '口座種別'] },
            { key: 'account_number', keys: ['accountNumber', 'account_number', '口座番号'] },
            { key: 'account_holder_kana', keys: ['accountHolderKana', 'account_holder_kana', '口座名義', '口座名義カナ'] },
            { key: 'invoice_registration_number', keys: ['invoiceRegistrationNumber', 'invoice_registration_number', 'インボイス登録番号', '登録番号'] }
          ];

          for (const f of fieldsToMerge) {
            let csvVal = "";
            for (const csvK of f.keys) {
              if (row[csvK] !== undefined && row[csvK] !== null) {
                csvVal = String(row[csvK]).trim();
                break;
              }
            }
            if (csvVal && (!existingVendor[f.key] || String(existingVendor[f.key]).trim() === "")) {
              subUpdates.push(`${f.key} = $${paramIdx}`);
              subParams.push(csvVal);
              paramIdx++;
            }
          }

          // Special check for is_invoice_issuer (boolean)
          let csvInvoiceIssuer: boolean | null = null;
          if (row.isInvoiceIssuer !== undefined || row.is_invoice_issuer !== undefined) {
            const tempVal = String(row.isInvoiceIssuer || row.is_invoice_issuer).toUpperCase();
            csvInvoiceIssuer = tempVal === "TRUE" || tempVal === "1";
          }
          if (csvInvoiceIssuer !== null && (existingVendor.is_invoice_issuer === null || existingVendor.is_invoice_issuer === undefined || existingVendor.is_invoice_issuer === false)) {
            subUpdates.push(`is_invoice_issuer = $${paramIdx}`);
            subParams.push(csvInvoiceIssuer);
            paramIdx++;
          }

          if (subUpdates.length > 0) {
            subParams.push(vendorId);
            await query(
              `UPDATE vendors SET ${subUpdates.join(', ')} WHERE id = $${paramIdx}`,
              subParams
            );
          }
        } else {
          // Try lookup by name
          let vResName = await query("SELECT * FROM vendors WHERE vendor_name ILIKE $1", [vName]);
          if (vResName.rows.length > 0) {
            const existingVendor = vResName.rows[0];
            vendorId = existingVendor.id;

            // Merge empty vendor fields with CSV values if provided in row
            const subUpdates: string[] = [];
            const subParams: any[] = [];
            let paramIdx = 1;

            const fieldsToMerge = [
              { key: 'trade_name', keys: ['tradeName', 'trade_name', '屋号', '屋号・ペンネーム'] },
              { key: 'pen_name', keys: ['penName', 'pen_name', 'ペンネーム'] },
              { key: 'entity_type', keys: ['entityType', 'entity_type', 'エンティティ', '種別'] },
              // Phase 22.21.77: 代表者名 は vendor_rep へ。担当者名 / 担当者 のみ contact_name に。
            { key: 'contact_name', keys: ['contactName', 'contact_name', '担当者名', '担当者', '宛名'] },
            { key: 'vendor_rep', keys: ['vendorRep', 'vendor_rep', '代表者名', '代表者', '代表'] },
              { key: 'address', keys: ['address', '住所', '取引先住所', '所在地'] },
              { key: 'bank_name', keys: ['bankName', 'bank_name', '銀行名'] },
              { key: 'branch_name', keys: ['branchName', 'branch_name', '支店名'] },
              { key: 'account_type', keys: ['accountType', 'account_type', '預金種別', '口座種別'] },
              { key: 'account_number', keys: ['accountNumber', 'account_number', '口座番号'] },
              { key: 'account_holder_kana', keys: ['accountHolderKana', 'account_holder_kana', '口座名義', '口座名義カナ'] },
              { key: 'invoice_registration_number', keys: ['invoiceRegistrationNumber', 'invoice_registration_number', 'インボイス登録番号', '登録番号'] }
            ];

            for (const f of fieldsToMerge) {
              let csvVal = "";
              for (const csvK of f.keys) {
                if (row[csvK] !== undefined && row[csvK] !== null) {
                  csvVal = String(row[csvK]).trim();
                  break;
                }
              }
              if (csvVal && (!existingVendor[f.key] || String(existingVendor[f.key]).trim() === "")) {
                subUpdates.push(`${f.key} = $${paramIdx}`);
                subParams.push(csvVal);
                paramIdx++;
              }
            }

            // Special check for is_invoice_issuer (boolean)
            let csvInvoiceIssuer: boolean | null = null;
            if (row.isInvoiceIssuer !== undefined || row.is_invoice_issuer !== undefined) {
              const tempVal = String(row.isInvoiceIssuer || row.is_invoice_issuer).toUpperCase();
              csvInvoiceIssuer = tempVal === "TRUE" || tempVal === "1";
            }
            if (csvInvoiceIssuer !== null && (existingVendor.is_invoice_issuer === null || existingVendor.is_invoice_issuer === undefined || existingVendor.is_invoice_issuer === false)) {
              subUpdates.push(`is_invoice_issuer = $${paramIdx}`);
              subParams.push(csvInvoiceIssuer);
              paramIdx++;
            }

            if (subUpdates.length > 0) {
              subParams.push(vendorId);
              await query(
                `UPDATE vendors SET ${subUpdates.join(', ')} WHERE id = $${paramIdx}`,
                subParams
              );
            }
          } else {
            // Auto create vendor
            let csvEntityType = row.entityType || row.entity_type || row["エンティティ"] || row["種別"] || "corporate";
            // Phase 22.21.77: 代表者名 → vendor_rep, 担当者名 → contact_name に分離
            let csvContactName = row.contactName || row.contact_name || row["担当者名"] || row["担当者"] || row["宛名"] || "";
            let csvVendorRep = row.vendorRep || row.vendor_rep || row["代表者名"] || row["代表者"] || row["代表"] || "";
            let csvPenName = row.penName || row.pen_name || row["ペンネーム"] || "";
            let csvTradeName = row.tradeName || row.trade_name || row["屋号"] || row["屋号・ペンネーム"] || "";
            let csvAddress = row.address || row.address_name || row["住所"] || row["所在地"] || "";
            let csvBankName = row.bankName || row.bank_name || row["銀行名"] || "";
            let csvBranchName = row.branchName || row.branch_name || row["支店名"] || "";
            let csvAccountType = row.accountType || row.account_type || row["預金種別"] || row["口座種別"] || "普通";
            let csvAccountNumber = row.accountNumber || row.account_number || row["口座番号"] || "";
            let csvAccountHolderKana = row.accountHolderKana || row.account_holder_kana || row["口座名義"] || row["口座名義カナ"] || "";
            let csvIsInvoiceIssuer = String(row.isInvoiceIssuer || row.is_invoice_issuer || row["適格請求書発行事業者"] || "").toUpperCase() === "TRUE";
            let csvInvoiceReg = row.invoiceRegistrationNumber || row.invoice_registration_number || row["インボイス登録番号"] || row["登録番号"] || "";

            const insertVendorRes = await query(
              `INSERT INTO vendors (
                vendor_code, vendor_name, entity_type, withholding_enabled,
                contact_name, pen_name, trade_name, address,
                bank_name, branch_name, account_type, account_number, account_holder_kana,
                is_invoice_issuer, invoice_registration_number, vendor_rep
              )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
              [
                vCode, vName, csvEntityType, false,
                csvContactName, csvPenName, csvTradeName, csvAddress,
                csvBankName, csvBranchName, csvAccountType, csvAccountNumber, csvAccountHolderKana,
                csvIsInvoiceIssuer, csvInvoiceReg, csvVendorRep
              ]
            );
            vendorId = insertVendorRes.rows[0].id;
          }
        }

        // 2. Parse contract details
        const record_type = row.recordType || row.record_type || row["契約レコード種別"] || "master_contract"; // master_contract / license_condition / publication_condition
        const contract_category = row.contractCategory || row.contract_category || row["契約カテゴリ"] || "service"; // service / license / publication
        const contract_type = row.contractType || row.contract_type || row["契約種別"] || "service_basic";
        const contract_title = row.contractTitle || row.contract_title || row["契約書タイトル"] || "インポートされた契約書";
        const document_number = row.documentNumber || row.document_number || row["文書番号"] || "";
        const contract_status = row.contractStatus || row.contract_status || row["契約状況"] || "executed";
        
        let effective_date: string | null = row.effectiveDate || row.effective_date || row["発効日"] || null;
        let expiration_date: string | null = row.expirationDate || row.expiration_date || row["満了日"] || null;
        if (effective_date === "") effective_date = null;
        if (expiration_date === "") expiration_date = null;

        const auto_renewal = String(row.autoRenewal || row.auto_renewal || row["自動更新"] || "FALSE").toUpperCase() === "TRUE";
        
        const original_work = row.originalWork || row.original_work || row["原著作物名"] || "";
        const product_name = row.productName || row.product_name || row["製品名"] || "";
        const territory = row.territory || row["地域"] || "";
        const language = row.language || row["言語"] || "";
        const document_url = row.documentUrl || row.document_url || row["文書リンク"] || "";

        // 3. Insert into contract_capabilities
        await query(
          `INSERT INTO documents (
             vendor_id,
             record_type,
             contract_category,
             contract_type,
             contract_title,
             document_number,
             contract_status,
             effective_date,
             expiration_date,
             auto_renewal,
             original_work,
             product_name,
             territory,
             language,
             document_url,
             template_type,
             drive_link,
             revision,
             is_primary,
             lifecycle_status
           ) VALUES (
             $1,
             $2,
             $3,
             $4,
             $5,
             $6,
             $7,
             $8,
             $9,
             $10,
             $11,
             $12,
             $13,
             $14,
             $15,
             COALESCE($4, ''),
             COALESCE($15, ''),
             NULL,
             NULL,
             NULL
           )
           ON CONFLICT (document_number) DO UPDATE SET
             vendor_id = COALESCE(EXCLUDED.vendor_id, documents.vendor_id),
             record_type = COALESCE(EXCLUDED.record_type, documents.record_type),
             contract_category = COALESCE(EXCLUDED.contract_category, documents.contract_category),
             contract_type = COALESCE(EXCLUDED.contract_type, documents.contract_type),
             contract_title = COALESCE(EXCLUDED.contract_title, documents.contract_title),
             contract_status = COALESCE(EXCLUDED.contract_status, documents.contract_status),
             effective_date = COALESCE(EXCLUDED.effective_date, documents.effective_date),
             expiration_date = COALESCE(EXCLUDED.expiration_date, documents.expiration_date),
             auto_renewal = COALESCE(EXCLUDED.auto_renewal, documents.auto_renewal),
             original_work = COALESCE(EXCLUDED.original_work, documents.original_work),
             product_name = COALESCE(EXCLUDED.product_name, documents.product_name),
             territory = COALESCE(EXCLUDED.territory, documents.territory),
             language = COALESCE(EXCLUDED.language, documents.language),
             document_url = COALESCE(EXCLUDED.document_url, documents.document_url),
             updated_at = now()`,
          [
            vendorId, record_type, contract_category, contract_type, contract_title,
            document_number, contract_status, effective_date, expiration_date, auto_renewal,
            original_work, product_name, territory, language, document_url
          ]
        );

        processedCount++;
      } catch (err) {
        errors.push(`Row ${rowIndex}: ${String(err)}`);
      }
    }

    return { success: errors.length === 0, processedCount, errors };
  }
}
