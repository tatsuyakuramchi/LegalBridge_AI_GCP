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
    const parseResult = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const errors: string[] = [];
    let rowIndex = 0;
    let processedCount = 0;

    for (const row of parseResult.data as any[]) {
      rowIndex++;
      try {
        const vendor_code = row.vendorCode || row.vendor_code || row["仕入先コード"];
        const vendor_name = row.vendorName || row.vendor_name || row["仕入先名"];
        
        if (!vendor_code || !vendor_name) {
          errors.push(`Row ${rowIndex}: Missing vendorCode or vendorName`);
          continue;
        }

        const trade_name = row.tradeName || row.trade_name || "";
        const pen_name = row.penName || row.pen_name || "";
        const vendor_suffix = row.vendorSuffix || row.vendor_suffix || "様";
        const entity_type = row.entityType || row.entity_type || "individual";
        const withholding_enabled = String(row.withholdingEnabled || row.withholding_enabled).toUpperCase() === "TRUE";
        const aliases = row.aliases || "";
        const address = row.address || "";
        const phone = row.phone || "";
        const email = row.email || "";
        const contact_department = row.contactDepartment || row.contact_department || "";
        const contact_name = row.contactName || row.contact_name || "";
        const master_contract_ref = row.masterContractRef || row.master_contract_ref || "";
        const bank_info = row.bankInfo || row.bank_info || "";
        const bank_name = row.bankName || row.bank_name || "";
        const branch_name = row.branchName || row.branch_name || "";
        const account_type = row.accountType || row.account_type || "普通";
        const account_number = row.accountNumber || row.account_number || "";
        const account_holder_kana = row.accountHolderKana || row.account_holder_kana || "";
        const is_invoice_issuer = String(row.isInvoiceIssuer || row.is_invoice_issuer).toUpperCase() === "TRUE";
        const invoice_registration_number = row.invoiceRegistrationNumber || row.invoice_registration_number || "";

        await query(
          `INSERT INTO vendors (
            vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type, 
            withholding_enabled, aliases, address, phone, email, contact_department, 
            contact_name, master_contract_ref, bank_info, bank_name, branch_name, 
            account_type, account_number, account_holder_kana, is_invoice_issuer, 
            invoice_registration_number
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
          ON CONFLICT (vendor_code) DO UPDATE SET 
            vendor_name = EXCLUDED.vendor_name, trade_name = EXCLUDED.trade_name, pen_name = EXCLUDED.pen_name, 
            vendor_suffix = EXCLUDED.vendor_suffix, entity_type = EXCLUDED.entity_type, 
            withholding_enabled = EXCLUDED.withholding_enabled, aliases = EXCLUDED.aliases, 
            address = EXCLUDED.address, phone = EXCLUDED.phone, email = EXCLUDED.email, 
            contact_department = EXCLUDED.contact_department, contact_name = EXCLUDED.contact_name, 
            master_contract_ref = EXCLUDED.master_contract_ref, bank_info = EXCLUDED.bank_info, 
            bank_name = EXCLUDED.bank_name, branch_name = EXCLUDED.branch_name, 
            account_type = EXCLUDED.account_type, account_number = EXCLUDED.account_number, 
            account_holder_kana = EXCLUDED.account_holder_kana, is_invoice_issuer = EXCLUDED.is_invoice_issuer, 
            invoice_registration_number = EXCLUDED.invoice_registration_number`,
          [
            vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type, 
            withholding_enabled, aliases, address, phone, email, contact_department, 
            contact_name, master_contract_ref, bank_info, bank_name, branch_name, 
            account_type, account_number, account_holder_kana, is_invoice_issuer, 
            invoice_registration_number
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
        
        await query(
          "INSERT INTO order_items (legal_request_id, item_no, vendor_code, description, amount, due_date) VALUES ($1, $2, $3, $4, $5, $6)",
          [reqResult.rows[0].id, 1, vendorCode, summary, parseFloat(String(totalAmount || "0").replace(/,/g, "")), finalDeadline || orderDate]
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
}
