// C2 (Phase 2): worker に「Search(search-api)が持つ read」を補完する。
// admin-ui を worker 専用(C1)に振り替えるための前提。search-api の該当
// ハンドラを忠実移植(pure query + res.json)。worker の query を注入。
//
// バッチ1: 単純マスター read(query のみ・helper/middleware 非依存)。
//   残バッチ(別ファイル/別コミットで追加予定):
//   - master/contracts(大規模JSON集約), master/rules, csvテンプレ(helper依存)
//   - backlog/*(backlogService), management/* ダッシュボード, dashboard/stats,
//     contract-check/purposes, imports/legalon-csv/template

import type { Express } from "express";

type Query = (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }>;

// worker BacklogService の必要メソッドだけを構造的に要求(疎結合)。
type BacklogSvc = {
  getIssues(): Promise<any>;
  getIssueTypes(): Promise<any>;
  getCustomFields(): Promise<any>;
  getStatuses(): Promise<any>;
};

// CSV エスケープ(search-api の *MasterService と同一ロジック)
function csvJoin(rows: (string | number)[][]): string {
  return rows
    .map((cols) =>
      cols
        .map((c) =>
          /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c
        )
        .join(",")
    )
    .join("\n");
}

// search-api vendorMasterService.getVendorSampleCsv の忠実移植
function getVendorSampleCsv(): string {
  const header = [
    "vendor_code", "corporate_number", "vendor_name", "trade_name", "pen_name", "entity_type",
    "phone", "email", "payment_terms", "main_business", "transaction_category",
    "capital_yen", "employee_count", "rating", "antisocial_check_result", "master_updated_at",
    "contact_name", "address",
    "bank_name", "branch_name", "account_type", "account_number", "account_holder_kana",
    "is_invoice_issuer", "invoice_registration_number",
  ];
  const rows = [
    [
      "2-20-9001", "1234567890123", "Sample Trading Co., Ltd.", "Sample Trading", "", "corporate",
      "03-1234-5678", "info@sample.co.jp", "month-end closing / next month-end payment", "content production and distribution", "goods_sale",
      "50000000", "120", "A", "clear", "2026-05-24",
      "Taro Yamada", "1-2-3 Sample, Chiyoda-ku, Tokyo",
      "Mizuho Bank", "Tokyo Branch", "ordinary", "1234567", "SAMPLE TRADING",
      "TRUE", "T1234567890123",
    ],
    [
      "2-20-9002", "", "Sample Sole Proprietor", "", "Sample Pen Name", "individual",
      "090-0000-0000", "ind@sample.com", "payment after acceptance", "design services", "service",
      "", "3", "B", "clear", "2026-05-24",
      "Hanako Suzuki", "2-3-4 Sample, Osaka-shi, Osaka",
      "Sumitomo Mitsui Banking Corporation", "Umeda Branch", "ordinary", "7654321", "HANAKO SUZUKI",
      "FALSE", "",
    ],
  ];
  return csvJoin([header, ...rows]);
}

// search-api staffMasterService.getStaffSampleCsv の忠実移植
function getStaffSampleCsv(): string {
  const header = [
    "slack_user_id", "staff_name", "email", "phone", "department", "department_code",
  ];
  const rows = [
    ["U01ABCDEF12", "倉持 達也", "tatsuya.kuramochi@arclight.co.jp", "03-1234-5678", "経営管理本部", "MGMT"],
    ["U02GHIJKL34", "山田 太郎", "yamada.taro@arclight.co.jp", "", "法務", "LEGAL"],
    ["U03MNOPQR56", "佐藤 花子", "sato.hanako@arclight.co.jp", "", "事業企画部", "BIZ"],
  ];
  return csvJoin([header, ...rows]);
}

export function registerSharedReads(
  app: Express,
  deps: { query: Query; backlogService: BacklogSvc }
): void {
  const { query, backlogService } = deps;

  // ── バッチ3: 単純 backlog read(backlogService 呼び出しのみ)─────────
  app.get("/api/backlog/issues", async (_req, res) => {
    try {
      res.json(await backlogService.getIssues());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
  app.get("/api/backlog/issue-types", async (_req, res) => {
    try {
      res.json(await backlogService.getIssueTypes());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
  app.get("/api/backlog/custom-fields", async (_req, res) => {
    try {
      res.json(await backlogService.getCustomFields());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
  app.get("/api/backlog/statuses", async (_req, res) => {
    try {
      res.json(await backlogService.getStatuses());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // CSV テンプレは動的ルート(/:code)より先に登録(順序依存。search-api と同様)。
  // GET /api/master/vendors/template.csv
  app.get("/api/master/vendors/template.csv", (_req, res) => {
    const body = "﻿" + getVendorSampleCsv();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="vendor_sample.csv"');
    res.send(body);
  });
  // GET /api/master/staff/template.csv
  app.get("/api/master/staff/template.csv", (_req, res) => {
    const body = "﻿" + getStaffSampleCsv();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="staff_sample.csv"');
    res.send(body);
  });

  // GET /api/master/vendors — 取引先一覧
  app.get("/api/master/vendors", async (_req, res) => {
    try {
      const result = await query("SELECT * FROM vendors ORDER BY id ASC");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/master/vendors/:code — 取引先(コード指定)
  app.get("/api/master/vendors/:code", async (req, res) => {
    try {
      const { code } = req.params;
      const result = await query("SELECT * FROM vendors WHERE vendor_code = $1", [code]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/master/staff — スタッフ一覧
  app.get("/api/master/staff", async (_req, res) => {
    try {
      const result = await query("SELECT * FROM staff ORDER BY id ASC");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/master/app-settings — 設定 key/value をオブジェクトで
  app.get("/api/master/app-settings", async (_req, res) => {
    try {
      const result = await query("SELECT * FROM app_settings");
      const settings: Record<string, any> = {};
      result.rows.forEach((row: any) => {
        settings[row.key] = row.value;
      });
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/master/company-profile — 自社プロフィール(app_settings + env fallback)
  app.get("/api/master/company-profile", async (_req, res) => {
    try {
      const result = await query(
        "SELECT * FROM app_settings WHERE key IN ('COMPANY_NAME', 'COMPANY_ADDRESS', 'COMPANY_REPRESENTATIVE', 'COMPANY_INVOICE_NO')"
      );
      const settings: Record<string, string> = {};
      result.rows.forEach((r: any) => (settings[r.key] = r.value));
      res.json({
        name: settings.COMPANY_NAME || process.env.COMPANY_NAME || "サンプル株式会社",
        address: settings.COMPANY_ADDRESS || process.env.COMPANY_ADDRESS || "東京都千代田区丸の内1-1-1",
        representative:
          settings.COMPANY_REPRESENTATIVE || process.env.COMPANY_REPRESENTATIVE || "代表取締役 山田 太郎",
        invoice_no: settings.COMPANY_INVOICE_NO || process.env.COMPANY_INVOICE_NO || "T1234567890123",
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── バッチ2 ─────────────────────────────────────────────

  // GET /api/master/rules — 部門ワークフロールール
  app.get("/api/master/rules", async (_req, res) => {
    try {
      const result = await query("SELECT * FROM department_workflow_rules ORDER BY id ASC");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/master/contracts — 契約マスタ(金銭条件/明細/経費/その他手数料/稟議番号 同梱)
  //   search-api 忠実移植。capability_* 未追加環境は 42P01/42703 を握り潰しフォールバック。
  app.get("/api/master/contracts", async (_req, res) => {
    try {
      let result: any;
      try {
        result = await query(
          `SELECT cc.*, v.vendor_name,
                  v.vendor_code AS vendor_code,
                  v.entity_type AS vendor_entity_type,
                  v.bank_name AS vendor_bank_name,
                  v.branch_name AS vendor_branch_name,
                  v.account_type AS vendor_account_type,
                  v.account_number AS vendor_account_number,
                  v.account_holder_kana AS vendor_account_holder_kana,
                  v.invoice_registration_number AS vendor_invoice_registration_number,
                  v.withholding_enabled AS vendor_withholding_enabled,
                  COALESCE(
                    (
                      SELECT array_agg(rr.ringi_number ORDER BY rr.ringi_number)
                        FROM documents d
                        JOIN ringi_documents rd ON rd.document_id = d.id
                        JOIN ringi_records rr ON rr.id = rd.ringi_id
                       WHERE d.document_number = cc.document_number
                    ),
                    '{}'::text[]
                  ) AS ringi_numbers,
                  COALESCE(
                    (
                      SELECT json_agg(
                               json_build_object(
                                 'id', cfc.id,
                                 'condition_no', cfc.condition_no,
                                 'region_language_label', cfc.region_language_label,
                                 'calc_method', cfc.calc_method,
                                 'rate_pct', cfc.rate_pct,
                                 'base_price_label', cfc.base_price_label,
                                 'calc_period', cfc.calc_period,
                                 'calc_period_kind', cfc.calc_period_kind,
                                 'calc_period_close_month', cfc.calc_period_close_month,
                                 'currency', cfc.currency,
                                 'formula_text', cfc.formula_text,
                                 'payment_terms', cfc.payment_terms,
                                 'mg_amount', cfc.mg_amount,
                                 'ag_amount', COALESCE(cfc.ag_amount, 0)
                               )
                               ORDER BY cfc.condition_no ASC
                             )
                        FROM capability_financial_conditions cfc
                       WHERE cfc.capability_id = cc.id
                    ),
                    '[]'::json
                  ) AS financial_conditions,
                  COALESCE(
                    (
                      SELECT json_agg(
                               json_build_object(
                                 'id', cli.id,
                                 'line_no', cli.line_no,
                                 'category', cli.category,
                                 'item_name', cli.item_name,
                                 'spec', cli.spec,
                                 'calc_method', cli.calc_method,
                                 'payment_method', cli.payment_method,
                                 'payment_terms', cli.payment_terms,
                                 'quantity', cli.quantity,
                                 'unit_price', cli.unit_price,
                                 'amount_ex_tax', cli.amount_ex_tax,
                                 'delivery_date', cli.delivery_date,
                                 'payment_date', cli.payment_date,
                                 'cycle', cli.cycle,
                                 'billing_day', cli.billing_day,
                                 'term_start', cli.term_start,
                                 'term_end', cli.term_end
                               )
                               ORDER BY cli.line_no ASC
                             )
                        FROM capability_line_items cli
                       WHERE cli.capability_id = cc.id
                    ),
                    '[]'::json
                  ) AS line_items,
                  COALESCE(
                    (
                      SELECT json_agg(
                               json_build_object(
                                 'id', ce.id,
                                 'line_no', ce.line_no,
                                 'expense_name', ce.expense_name,
                                 'spec', ce.spec,
                                 'spent_date', ce.spent_date,
                                 'amount_inc_tax', ce.amount_inc_tax,
                                 'remarks', ce.remarks
                               )
                               ORDER BY ce.line_no ASC
                             )
                        FROM capability_expenses ce
                       WHERE ce.capability_id = cc.id
                    ),
                    '[]'::json
                  ) AS expenses,
                  COALESCE(
                    (
                      SELECT json_agg(
                               json_build_object(
                                 'id', cof.id,
                                 'line_no', cof.line_no,
                                 'fee_name', cof.fee_name,
                                 'amount', cof.amount,
                                 'remarks', cof.remarks
                               )
                               ORDER BY cof.line_no ASC
                             )
                        FROM capability_other_fees cof
                       WHERE cof.capability_id = cc.id
                    ),
                    '[]'::json
                  ) AS other_fees
           FROM contract_capabilities cc
           LEFT JOIN vendors v ON cc.vendor_id = v.id
           ORDER BY cc.id DESC`
        );
      } catch (err: any) {
        if (err && (err.code === "42P01" || err.code === "42703")) {
          result = await query(
            `SELECT cc.*, v.vendor_name,
                    v.vendor_code AS vendor_code,
                    v.entity_type AS vendor_entity_type,
                    v.bank_name AS vendor_bank_name,
                    v.branch_name AS vendor_branch_name,
                    v.account_type AS vendor_account_type,
                    v.account_number AS vendor_account_number,
                    v.account_holder_kana AS vendor_account_holder_kana,
                    v.invoice_registration_number AS vendor_invoice_registration_number,
                    v.withholding_enabled AS vendor_withholding_enabled,
                    '[]'::json AS financial_conditions,
                    '[]'::json AS line_items,
                    '[]'::json AS expenses,
                    '[]'::json AS other_fees
             FROM contract_capabilities cc
             LEFT JOIN vendors v ON cc.vendor_id = v.id
             ORDER BY cc.id DESC`
          );
        } else {
          throw err;
        }
      }
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── バッチ4: management ダッシュボード + dashboard/stats ──────────────
  app.get("/api/management/alerts", async (_req, res) => {
    try {
      const overdue = await query(
        `SELECT d.*, l.summary as issue_summary, l.counterparty
         FROM delivery_events d
         LEFT JOIN legal_requests l ON d.backlog_issue_key = l.backlog_issue_key
         WHERE d.status = 'pending' AND d.inspection_deadline < CURRENT_TIMESTAMP`
      );
      res.json({ overdue: overdue.rows, totalAlerts: overdue.rowCount });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/management/deliveries", async (_req, res) => {
    try {
      const result = await query(`
        SELECT d.*, r.counterparty, r.summary
        FROM delivery_events d
        LEFT JOIN legal_requests r ON d.backlog_issue_key = r.backlog_issue_key
        ORDER BY d.inspection_deadline ASC NULLS LAST
      `);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/management/royalties", async (_req, res) => {
    try {
      const result = await query(`
        SELECT p.*, r.summary as project_name
        FROM royalty_payments p
        LEFT JOIN legal_requests r ON p.backlog_issue_key = r.backlog_issue_key
        ORDER BY p.period DESC, project_name ASC
      `);
      if (result.rows.length === 0) {
        return res.json([
          { id: "m1", period: "2026-01", project_name: "Sample Game A", total_amount: 500000, status: "paid" },
          { id: "m2", period: "2026-02", project_name: "Sample Game A", total_amount: 750000, status: "calculated" },
          { id: "m3", period: "2026-03", project_name: "Sample Game B", total_amount: 1200000, status: "calculated" },
        ]);
      }
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/management/workflows", async (_req, res) => {
    try {
      const result = await query(`
        SELECT w.*, r.summary, r.counterparty, r.contract_type
        FROM issue_workflows w
        LEFT JOIN legal_requests r ON w.backlog_issue_key = r.backlog_issue_key
        ORDER BY w.updated_at DESC
      `);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/management/documents", async (_req, res) => {
    try {
      const result = await query("SELECT * FROM documents ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/management/assets", async (req, res) => {
    try {
      const includeHistory = String(req.query.include_history || "") === "1";
      let result: any;
      try {
        result = await query(
          `SELECT ea.*,
                  d.base_document_number,
                  COALESCE(d.revision, 0) AS revision,
                  COALESCE(d.is_primary, TRUE) AS is_primary,
                  COALESCE(d.lifecycle_status, 'final') AS lifecycle_status,
                  d.superseded_by,
                  cc.contract_status,
                  cc.expiration_date  AS cc_expiration_date,
                  cc.effective_date   AS cc_effective_date
             FROM external_assets ea
             LEFT JOIN documents d
               ON d.document_number = ea.asset_number
             LEFT JOIN contract_capabilities cc
               ON cc.document_number = ea.asset_number
                  OR cc.document_number = COALESCE(d.base_document_number, ea.asset_number)
            WHERE ${includeHistory ? "TRUE" : "COALESCE(d.lifecycle_status, 'final') = 'final'"}
            ORDER BY ea.created_at DESC`
        );
      } catch (err: any) {
        if (err && err.code === "42703") {
          result = await query("SELECT * FROM external_assets ORDER BY created_at DESC");
        } else {
          throw err;
        }
      }
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/dashboard/stats", async (_req, res) => {
    try {
      const issues = await backlogService.getIssues();
      const docs = await query("SELECT issue_key, template_type, created_at FROM documents");
      const stats = {
        totalIssues: issues.length,
        totalDocuments: docs.rowCount,
        byStatus: {} as Record<string, number>,
        recentActivity: docs.rows.slice(0, 5),
        issueDetails: issues.map((i: any) => {
          const relatedDocs = docs.rows.filter((d: any) => d.issue_key === i.issueKey);
          return {
            ...i,
            documentCount: relatedDocs.length,
            lastDocDate: relatedDocs.length > 0 ? relatedDocs[0].created_at : null,
          };
        }),
      };
      issues.forEach((i: any) => {
        const s = i.status?.name || "Unknown";
        stats.byStatus[s] = (stats.byStatus[s] || 0) + 1;
      });
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}
