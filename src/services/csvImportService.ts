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
    let processedCount = 0;

    for (const row of parseResult.data as any[]) {
      try {
        const desc = row.desc || row.item_name || row["業務内容"] || row["成果物名"];
        const vendorCode = row.vendor_code || row.registration_number || row["登録番号"];
        const dueDate = row.due_date || row.delivery_date || row["納期"] || row["納品日"];
        const amount = parseFloat((row.amount || row["金額"] || row["税抜金額"] || "0").replace(/,/g, ""));

        if (!desc || !vendorCode || !dueDate) {
          errors.push(`Row ${processedCount + 1}: Missing required fields (desc, vendorCode, or dueDate)`);
          continue;
        }

        // Section 7.4: upsert logic
        // For demo, we use a placeholder issue key if not present
        const issueKey = row.issue_key || `CSV-GEN-${Date.now()}-${processedCount}`;
        
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
