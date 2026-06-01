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

type Query = (text: string, params?: any[]) => Promise<{ rows: any[] }>;

export function registerSharedReads(app: Express, deps: { query: Query }): void {
  const { query } = deps;

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
}
