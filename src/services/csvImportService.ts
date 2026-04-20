import Papa from "papaparse";
import { query } from "../lib/db.ts";

export interface CsvImportResult {
  success: boolean;
  processedCount: number;
  errors: string[];
}

export class CsvImportService {
  /**
   * Section 7.2: generic mode
   */
  async importGeneric(csvText: string): Promise<CsvImportResult> {
    const parseResult = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const errors: string[] = [];
    let rowIndex = 0;
    let processedCount = 0;

    for (const row of parseResult.data as any[]) {
      rowIndex++;
      try {
        const desc = row.desc || row.itemName || row.item_name || row["業務内容"] || row["成果物名"];
        const vendorCode = row.vendorCode || row.vendor_code || row.registration_number || row["登録番号"];
        const dueDate = row.dueDate || row.due_date || row.delivery_date || row["納期"] || row["納品日"];
        const amount = parseFloat((row.amount || row["金額"] || row["税抜金額"] || "0").replace(/,/g, ""));

        if (!desc || !vendorCode || !dueDate) {
          errors.push(`Row ${rowIndex}: Missing required fields (desc, vendorCode, or dueDate)`);
          continue;
        }

        const issueKey = row.issue_key || row.issueKey || `CSV-GEN-${Date.now()}-${processedCount}`;
        
        await query(
          "INSERT INTO legal_requests (backlog_issue_key, counterparty, summary, notes) VALUES ($1, $2, $3, $4) ON CONFLICT (backlog_issue_key) DO UPDATE SET counterparty = EXCLUDED.counterparty",
          [issueKey, vendorCode, desc, JSON.stringify(row)]
        );

        processedCount++;
      } catch (err) {
        errors.push(`Row ${processedCount + 1}: ${String(err)}`);
      }
    }

    return { success: errors.length === 0, processedCount, errors };
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
   * Section 7.3: publishing_bulk fixed headers
   */
  async importPublishingBulk(csvText: string): Promise<CsvImportResult> {
    // Section 7.3 says order must match
    const parseResult = Papa.parse(csvText, { header: false, skipEmptyLines: true });
    const errors: string[] = [];
    let processedCount = 0;

    // Skip header row
    const data = parseResult.data.slice(1);

    for (const row of data as any[]) {
      try {
        const [
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
          finalDeadline
        ] = row;

        if (!staffId || !vendorCode || !finalDeadline) {
          errors.push(`Row ${processedCount + 2}: Missing required fields`);
          continue;
        }

        const issueKey = `PUB-${vendorCode}-${Date.now()}-${processedCount}`;
        
        const reqResult = await query(
          "INSERT INTO legal_requests (backlog_issue_key, slack_user_id, summary, notes) VALUES ($1, $2, $3, $4) RETURNING id",
          [issueKey, staffId, `${vendorName} - ${bookTitle}`, details]
        );
        
        await query(
          "INSERT INTO order_items (legal_request_id, item_no, vendor_code, description, amount, due_date) VALUES ($1, $2, $3, $4, $5, $6)",
          [reqResult.rows[0].id, 1, vendorCode, summary, parseFloat(totalAmount || "0"), finalDeadline]
        );

        processedCount++;
      } catch (err) {
        errors.push(`Row ${processedCount + 2}: ${String(err)}`);
      }
    }

    return { success: errors.length === 0, processedCount, errors };
  }
}
