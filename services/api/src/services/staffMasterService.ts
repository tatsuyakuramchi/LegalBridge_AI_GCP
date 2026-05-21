/**
 * Staff マスター CRUD + CSV インポート (Phase 17z-4)
 *
 * `staff` テーブルに対する list / get / upsert / CSV 一括取込。
 * 構造は vendorMasterService と統一して、UI 側を mirror で書けるようにする。
 *
 * セキュリティ: requireIapUser + requireDepartmentRole 前提 (server.ts)。
 */

import Papa from "papaparse";
import { query } from "../lib/db.ts";

export type StaffRow = {
  id?: number;
  slack_user_id: string;
  staff_name: string;
  email?: string | null;
  phone?: string | null;
  department?: string | null;
  department_code?: string | null;
  // Phase 22.21.36: アプリ内ロール ('admin' / 'viewer')
  app_role?: string | null;
};

// Phase 22.21.36: app_role を SELECT に追加。
//   未マイグレーション環境では undefined_column になるため、
//   COALESCE で 'viewer' に fallback。
const SELECT_COLUMNS = `
  id, slack_user_id, staff_name, email, phone, department, department_code,
  COALESCE(app_role, 'viewer') AS app_role
`;

export async function listStaff(
  opts: { q?: string; limit?: number; offset?: number } = {}
): Promise<{ rows: StaffRow[]; total: number }> {
  const q = String(opts.q || "").trim();
  const limit = Math.max(1, Math.min(5000, Number(opts.limit ?? 5000)));
  const offset = Math.max(0, Number(opts.offset ?? 0));

  let where = "";
  const params: any[] = [];
  if (q) {
    params.push(`%${q}%`);
    where = `WHERE
      slack_user_id ILIKE $1 OR
      staff_name ILIKE $1 OR
      COALESCE(email, '') ILIKE $1 OR
      COALESCE(department, '') ILIKE $1
    `;
  }

  const countRes = await query(
    `SELECT COUNT(*)::int AS c FROM staff ${where}`,
    params
  );
  const total = Number(countRes.rows[0]?.c || 0);

  params.push(limit, offset);
  const res = await query(
    `SELECT ${SELECT_COLUMNS}
       FROM staff
       ${where}
       ORDER BY department NULLS LAST, staff_name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { rows: res.rows as StaffRow[], total };
}

export async function getStaff(slackUserId: string): Promise<StaffRow | null> {
  const id = String(slackUserId || "").trim();
  if (!id) return null;
  const res = await query(
    `SELECT ${SELECT_COLUMNS} FROM staff WHERE slack_user_id = $1 LIMIT 1`,
    [id]
  );
  return (res.rows[0] as StaffRow) || null;
}

export async function upsertStaff(s: StaffRow): Promise<StaffRow> {
  const slackId = String(s.slack_user_id || "").trim();
  const name = String(s.staff_name || "").trim();
  if (!slackId) throw new Error("slack_user_id は必須です");
  if (!name) throw new Error("staff_name は必須です");

  await query(
    `INSERT INTO staff (slack_user_id, staff_name, email, phone, department, department_code)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (slack_user_id) DO UPDATE SET
       staff_name      = EXCLUDED.staff_name,
       email           = EXCLUDED.email,
       phone           = EXCLUDED.phone,
       department      = EXCLUDED.department,
       department_code = EXCLUDED.department_code`,
    [
      slackId,
      name,
      s.email || null,
      s.phone || null,
      s.department || null,
      s.department_code || null,
    ]
  );

  const result = await getStaff(slackId);
  if (!result) throw new Error("upsert 後の取得に失敗しました");
  return result;
}

// ====================================================================
// CSV 一括インポート
// ====================================================================

const STAFF_COLUMN_MAP: Record<string, keyof StaffRow> = {
  // 英語キー
  slack_user_id: "slack_user_id",
  staff_name: "staff_name",
  email: "email",
  phone: "phone",
  department: "department",
  department_code: "department_code",
  // camelCase
  slackUserId: "slack_user_id",
  staffName: "staff_name",
  departmentCode: "department_code",
  // 日本語
  SlackユーザーID: "slack_user_id",
  slack_id: "slack_user_id",
  社員ID: "slack_user_id",
  ユーザーID: "slack_user_id",
  氏名: "staff_name",
  社員名: "staff_name",
  名前: "staff_name",
  メール: "email",
  メールアドレス: "email",
  電話: "phone",
  電話番号: "phone",
  部署: "department",
  部門: "department",
  所属: "department",
  部署コード: "department_code",
  部門コード: "department_code",
};

export function parseStaffCsv(csvText: string): StaffRow[] {
  const trimmed = String(csvText || "").trim();
  if (!trimmed) return [];

  const parsed = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => String(h || "").trim().replace(/^﻿/, ""),
  });
  if (parsed.errors?.length) {
    const e = parsed.errors[0];
    throw new Error(`CSV parse error: ${e.message} (row ${e.row})`);
  }

  return (parsed.data || []).map((raw) => {
    const row: any = {};
    for (const [key, val] of Object.entries(raw)) {
      const mapped = STAFF_COLUMN_MAP[key];
      if (!mapped) continue;
      const s = typeof val === "string" ? val.trim() : val;
      if (s === "" || s == null) continue;
      row[mapped] = s;
    }
    return row as StaffRow;
  });
}

export type StaffImportOptions = {
  dry_run?: boolean;
  duplicate_mode?: "overwrite" | "skip" | "fill_only";
};

export type StaffImportResult = {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ row: number; slack_user_id: string; error: string }>;
  preview?: Array<{
    row: number;
    slack_user_id: string;
    action: "insert" | "update" | "skip" | "fill_only";
    staff_name: string;
  }>;
};

export async function importStaffRows(
  rows: StaffRow[],
  opts: StaffImportOptions = {}
): Promise<StaffImportResult> {
  const mode = opts.duplicate_mode || "overwrite";
  const result: StaffImportResult = {
    total: rows.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    preview: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    const slackId = String(r.slack_user_id || "").trim();
    const name = String(r.staff_name || "").trim();
    if (!slackId) {
      result.failed++;
      result.errors.push({ row: rowNum, slack_user_id: "(empty)", error: "slack_user_id が空" });
      continue;
    }
    if (!name) {
      result.failed++;
      result.errors.push({ row: rowNum, slack_user_id: slackId, error: "staff_name が空" });
      continue;
    }

    let existing: StaffRow | null = null;
    try {
      existing = await getStaff(slackId);
    } catch (err: any) {
      result.failed++;
      result.errors.push({ row: rowNum, slack_user_id: slackId, error: `lookup failed: ${err?.message || err}` });
      continue;
    }

    let action: "insert" | "update" | "skip" | "fill_only" = existing ? "update" : "insert";
    if (existing && mode === "skip") action = "skip";
    if (existing && mode === "fill_only") action = "fill_only";

    if (action === "skip") {
      result.skipped++;
      result.preview!.push({ row: rowNum, slack_user_id: slackId, action, staff_name: name });
      continue;
    }

    if (opts.dry_run) {
      result.succeeded++;
      result.preview!.push({ row: rowNum, slack_user_id: slackId, action, staff_name: name });
      continue;
    }

    try {
      if (action === "fill_only" && existing) {
        const merged: StaffRow = { ...existing };
        for (const [k, v] of Object.entries(r)) {
          if (v == null || v === "") continue;
          const cur = (existing as any)[k];
          if (cur == null || cur === "") (merged as any)[k] = v;
        }
        await upsertStaff(merged);
      } else {
        await upsertStaff(r);
      }
      result.succeeded++;
      result.preview!.push({ row: rowNum, slack_user_id: slackId, action, staff_name: name });
    } catch (err: any) {
      result.failed++;
      result.errors.push({ row: rowNum, slack_user_id: slackId, error: String(err?.message || err) });
    }
  }

  if (!opts.dry_run) {
    delete result.preview;
  }

  return result;
}

export function getStaffSampleCsv(): string {
  const header = [
    "slack_user_id", "staff_name", "email", "phone", "department", "department_code",
  ];
  const rows = [
    ["U01ABCDEF12", "倉持 達也", "tatsuya.kuramochi@arclight.co.jp", "03-1234-5678", "経営管理本部", "MGMT"],
    ["U02GHIJKL34", "山田 太郎", "yamada.taro@arclight.co.jp", "", "法務", "LEGAL"],
    ["U03MNOPQR56", "佐藤 花子", "sato.hanako@arclight.co.jp", "", "事業企画部", "BIZ"],
  ];
  return [header, ...rows]
    .map((cols) =>
      cols
        .map((c) =>
          /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c
        )
        .join(",")
    )
    .join("\n");
}
