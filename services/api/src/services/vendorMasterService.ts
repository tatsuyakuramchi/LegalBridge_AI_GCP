/**
 * 取引先マスター CRUD サービス (Phase 17z)
 *
 * `vendors` テーブルに対する list / get / upsert 操作。
 *
 * 役割の整理 (Phase 17z):
 *   - メイン (= 保守対象) : services/api (本ファイル)
 *   - サブ (= 既存維持)   : services/worker
 *   両者は同じ DB にアクセスするため、いずれの経路で更新しても
 *   contract_capabilities / order_items 等の依存テーブルから即時に参照可能。
 *
 * セキュリティ: 上位 (server.ts) で requireSignedUrl が必須化される前提。
 *   呼び出し時にエンドポイント側で resourceId "master:vendors" を渡す。
 */

import Papa from "papaparse";

import { query } from "../lib/db.ts";

export type VendorContact = {
  id?: number;
  contact_name: string;
  contact_department?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  is_primary?: boolean;
  sort_order?: number;
  remarks?: string | null;
};

export type VendorRow = {
  id?: number;
  vendor_code: string;
  vendor_name: string;
  trade_name?: string | null;
  pen_name?: string | null;
  vendor_suffix?: string | null;
  entity_type?: string | null;
  withholding_enabled?: boolean;
  aliases?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_department?: string | null;
  contact_name?: string | null;
  master_contract_ref?: string | null;
  bank_info?: string | null;
  bank_name?: string | null;
  branch_name?: string | null;
  account_type?: string | null;
  account_number?: string | null;
  account_holder_kana?: string | null;
  is_invoice_issuer?: boolean;
  invoice_registration_number?: string | null;
  // Phase 22.13
  vendor_rep?: string | null;
  contacts?: VendorContact[];
};

const SELECT_COLUMNS = `
  id, vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type,
  withholding_enabled, aliases, address, phone, email,
  contact_department, contact_name, master_contract_ref, bank_info,
  bank_name, branch_name, account_type, account_number, account_holder_kana,
  is_invoice_issuer, invoice_registration_number, vendor_rep
`;

/**
 * Phase 22.13: 指定 vendor_id 群の contacts[] を一括取得 (N+1 回避)。
 *   schema migration 未適用 (worker 未デプロイ) 環境では undefined_column
 *   になるため、catch して空 Map で返す (= UI には contacts なし扱い)。
 */
async function fetchContactsMap(
  vendorIds: number[]
): Promise<Map<number, VendorContact[]>> {
  const map = new Map<number, VendorContact[]>();
  if (vendorIds.length === 0) return map;
  try {
    const res = await query(
      `SELECT vendor_id, id, contact_name, contact_department, title, email, phone,
              is_primary, sort_order, remarks
         FROM vendor_contacts
        WHERE vendor_id = ANY($1::int[])
        ORDER BY vendor_id, is_primary DESC, sort_order ASC, id ASC`,
      [vendorIds]
    );
    res.rows.forEach((r: any) => {
      const vid = Number(r.vendor_id);
      if (!map.has(vid)) map.set(vid, []);
      map.get(vid)!.push({
        id: Number(r.id),
        contact_name: r.contact_name || "",
        contact_department: r.contact_department || null,
        title: r.title || null,
        email: r.email || null,
        phone: r.phone || null,
        is_primary: !!r.is_primary,
        sort_order: Number(r.sort_order) || 0,
        remarks: r.remarks || null,
      });
    });
  } catch (err: any) {
    if (err && (err.code === "42703" || err.code === "42P01")) {
      // 列なし / テーブルなし → worker 未デプロイ。空 Map を返して呼び出し側で contacts: [] にする。
      console.warn(
        "[fetchContactsMap] vendor_contacts table/column unavailable. " +
          "worker サービスを再デプロイして migration を実行してください。"
      );
      return map;
    }
    throw err;
  }
  return map;
}

/**
 * 取引先の一覧取得 (検索 + ページング)。
 *
 * q が指定された場合、vendor_code / vendor_name / trade_name /
 * pen_name / aliases を ILIKE 部分一致。
 */
export async function listVendors(
  opts: { q?: string; limit?: number; offset?: number } = {}
): Promise<{ rows: VendorRow[]; total: number }> {
  const q = String(opts.q || "").trim();
  const limit = Math.max(1, Math.min(5000, Number(opts.limit ?? 5000)));
  const offset = Math.max(0, Number(opts.offset ?? 0));

  // Phase 22.21.47: 全角/半角の差を吸収するため WHERE 句両側を NFKC 正規化。
  //   PG12 以下では normalize() が無く 42883 で落ちるので、その場合は legacy
  //   ILIKE (NFKC 無し) に自動 fallback する。
  let where = "";
  let whereLegacy = "";
  const params: any[] = [];
  if (q) {
    params.push(`%${String(q).normalize("NFKC")}%`);
    where = `WHERE
      normalize(vendor_code,            NFKC) ILIKE normalize($1, NFKC) OR
      normalize(vendor_name,            NFKC) ILIKE normalize($1, NFKC) OR
      normalize(trade_name,             NFKC) ILIKE normalize($1, NFKC) OR
      normalize(pen_name,               NFKC) ILIKE normalize($1, NFKC) OR
      normalize(COALESCE(aliases, ''),  NFKC) ILIKE normalize($1, NFKC)
    `;
    whereLegacy = `WHERE
      vendor_code ILIKE $1 OR
      vendor_name ILIKE $1 OR
      trade_name ILIKE $1 OR
      pen_name ILIKE $1 OR
      COALESCE(aliases, '') ILIKE $1
    `;
  }

  // 件数取得は同じ where を使う (失敗時に再試行)
  let total = 0;
  try {
    const countRes = await query(
      `SELECT COUNT(*)::int AS c FROM vendors ${where}`,
      params
    );
    total = Number(countRes.rows[0]?.c || 0);
  } catch (err: any) {
    if (err?.code === "42883" && where) {
      const countRes = await query(
        `SELECT COUNT(*)::int AS c FROM vendors ${whereLegacy}`,
        params
      );
      total = Number(countRes.rows[0]?.c || 0);
      // ↓ 本体クエリも legacy に切替
      where = whereLegacy;
    } else {
      throw err;
    }
  }

  params.push(limit, offset);
  // Phase 22.13: vendor_rep が未追加の環境ではフォールバック (legacy SELECT)
  let res: any;
  try {
    res = await query(
      `SELECT ${SELECT_COLUMNS}
         FROM vendors
         ${where}
         ORDER BY vendor_code
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
  } catch (err: any) {
    if (err && err.code === "42703") {
      // vendor_rep 列なし → 旧 SELECT で再試行
      const LEGACY_COLS = SELECT_COLUMNS.replace(/,\s*vendor_rep\b/, "");
      res = await query(
        `SELECT ${LEGACY_COLS}
           FROM vendors
           ${where}
           ORDER BY vendor_code
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
    } else {
      throw err;
    }
  }
  const rows: VendorRow[] = res.rows as VendorRow[];

  // Phase 22.13: contacts[] を 1 クエリで全 vendor 分取得して inject (N+1 回避)
  const ids = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
  const contactsMap = await fetchContactsMap(ids);
  rows.forEach((r) => {
    r.contacts = contactsMap.get(Number(r.id)) || [];
  });

  return { rows, total };
}

/**
 * vendor_code 完全一致で 1 件取得。見つからない場合は null。
 */
export async function getVendor(vendorCode: string): Promise<VendorRow | null> {
  const code = String(vendorCode || "").trim();
  if (!code) return null;
  let res: any;
  try {
    res = await query(
      `SELECT ${SELECT_COLUMNS} FROM vendors WHERE vendor_code = $1 LIMIT 1`,
      [code]
    );
  } catch (err: any) {
    if (err && err.code === "42703") {
      const LEGACY_COLS = SELECT_COLUMNS.replace(/,\s*vendor_rep\b/, "");
      res = await query(
        `SELECT ${LEGACY_COLS} FROM vendors WHERE vendor_code = $1 LIMIT 1`,
        [code]
      );
    } else {
      throw err;
    }
  }
  const row = (res.rows[0] as VendorRow) || null;
  if (!row) return null;
  const contactsMap = await fetchContactsMap([Number(row.id)]);
  row.contacts = contactsMap.get(Number(row.id)) || [];
  return row;
}

/**
 * 取引先の upsert (worker /api/master/vendors と同仕様)。
 *
 * vendor_code を UNIQUE キーとして ON CONFLICT で UPDATE。
 * 既存値が空でも上書きするので、明示的に "空にする" 操作も可能。
 *
 * @throws vendor_code / vendor_name が空のときエラー。
 */
export async function upsertVendor(v: VendorRow): Promise<VendorRow> {
  const code = String(v.vendor_code || "").trim();
  const name = String(v.vendor_name || "").trim();
  if (!code) throw new Error("vendor_code は必須です");
  if (!name) throw new Error("vendor_name は必須です");

  await query(
    `INSERT INTO vendors (
      vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type,
      withholding_enabled, aliases, address, phone, email, contact_department,
      contact_name, master_contract_ref, bank_info, bank_name, branch_name,
      account_type, account_number, account_holder_kana, is_invoice_issuer,
      invoice_registration_number
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
    )
    ON CONFLICT (vendor_code) DO UPDATE SET
      vendor_name                 = EXCLUDED.vendor_name,
      trade_name                  = EXCLUDED.trade_name,
      pen_name                    = EXCLUDED.pen_name,
      vendor_suffix               = EXCLUDED.vendor_suffix,
      entity_type                 = EXCLUDED.entity_type,
      withholding_enabled         = EXCLUDED.withholding_enabled,
      aliases                     = EXCLUDED.aliases,
      address                     = EXCLUDED.address,
      phone                       = EXCLUDED.phone,
      email                       = EXCLUDED.email,
      contact_department          = EXCLUDED.contact_department,
      contact_name                = EXCLUDED.contact_name,
      master_contract_ref         = EXCLUDED.master_contract_ref,
      bank_info                   = EXCLUDED.bank_info,
      bank_name                   = EXCLUDED.bank_name,
      branch_name                 = EXCLUDED.branch_name,
      account_type                = EXCLUDED.account_type,
      account_number              = EXCLUDED.account_number,
      account_holder_kana         = EXCLUDED.account_holder_kana,
      is_invoice_issuer           = EXCLUDED.is_invoice_issuer,
      invoice_registration_number = EXCLUDED.invoice_registration_number`,
    [
      code,
      name,
      v.trade_name || null,
      v.pen_name || null,
      v.vendor_suffix || null,
      v.entity_type || null,
      Boolean(v.withholding_enabled),
      v.aliases || null,
      v.address || null,
      v.phone || null,
      v.email || null,
      v.contact_department || null,
      v.contact_name || null,
      v.master_contract_ref || null,
      v.bank_info || null,
      v.bank_name || null,
      v.branch_name || null,
      v.account_type || null,
      v.account_number || null,
      v.account_holder_kana || null,
      Boolean(v.is_invoice_issuer),
      v.invoice_registration_number || null,
    ]
  );

  const result = await getVendor(code);
  if (!result) throw new Error("upsert 後の取得に失敗しました");
  return result;
}

// ====================================================================
// CSV 一括インポート (Phase 17z-4)
// ====================================================================

/**
 * CSV ヘッダ → 内部キーへのマッピング。
 * worker の csvImportService.ts と一致するエイリアスを受け入れる。
 */
const VENDOR_COLUMN_MAP: Record<string, keyof VendorRow> = {
  // 英語キー (snake_case)
  vendor_code: "vendor_code",
  vendor_name: "vendor_name",
  trade_name: "trade_name",
  pen_name: "pen_name",
  vendor_suffix: "vendor_suffix",
  entity_type: "entity_type",
  withholding_enabled: "withholding_enabled",
  aliases: "aliases",
  address: "address",
  phone: "phone",
  email: "email",
  contact_department: "contact_department",
  contact_name: "contact_name",
  master_contract_ref: "master_contract_ref",
  bank_info: "bank_info",
  bank_name: "bank_name",
  branch_name: "branch_name",
  account_type: "account_type",
  account_number: "account_number",
  account_holder_kana: "account_holder_kana",
  is_invoice_issuer: "is_invoice_issuer",
  invoice_registration_number: "invoice_registration_number",
  // camelCase variant
  vendorCode: "vendor_code",
  vendorName: "vendor_name",
  tradeName: "trade_name",
  penName: "pen_name",
  vendorSuffix: "vendor_suffix",
  entityType: "entity_type",
  withholdingEnabled: "withholding_enabled",
  contactDepartment: "contact_department",
  contactName: "contact_name",
  masterContractRef: "master_contract_ref",
  bankInfo: "bank_info",
  bankName: "bank_name",
  branchName: "branch_name",
  accountType: "account_type",
  accountNumber: "account_number",
  accountHolderKana: "account_holder_kana",
  isInvoiceIssuer: "is_invoice_issuer",
  invoiceRegistrationNumber: "invoice_registration_number",
  // 日本語
  取引先コード: "vendor_code",
  取引先名: "vendor_name",
  正式名称: "vendor_name",
  屋号: "trade_name",
  "屋号・ペンネーム": "trade_name",
  ペンネーム: "pen_name",
  敬称: "vendor_suffix",
  区分: "entity_type",
  種別: "entity_type",
  エンティティ: "entity_type",
  源泉徴収: "withholding_enabled",
  別名: "aliases",
  住所: "address",
  所在地: "address",
  電話: "phone",
  電話番号: "phone",
  メール: "email",
  メールアドレス: "email",
  担当部署: "contact_department",
  部署: "contact_department",
  担当者: "contact_name",
  担当者名: "contact_name",
  代表者名: "contact_name",
  マスター契約: "master_contract_ref",
  銀行情報: "bank_info",
  銀行名: "bank_name",
  支店名: "branch_name",
  口座種別: "account_type",
  預金種別: "account_type",
  口座番号: "account_number",
  口座名義: "account_holder_kana",
  口座名義カナ: "account_holder_kana",
  インボイス: "is_invoice_issuer",
  適格請求書発行事業者: "is_invoice_issuer",
  インボイス登録番号: "invoice_registration_number",
  登録番号: "invoice_registration_number",
};

function parseBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v || "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "○", "✓", "TRUE", "はい"].includes(s);
}

/**
 * CSV テキストを VendorRow[] に変換する。ヘッダはマッピング辞書経由で
 * 内部キーに正規化、空セルは undefined にする。
 */
export function parseVendorCsv(csvText: string): VendorRow[] {
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
      const mapped = VENDOR_COLUMN_MAP[key];
      if (!mapped) continue;
      const s = typeof val === "string" ? val.trim() : val;
      if (s === "" || s == null) continue;
      if (mapped === "withholding_enabled" || mapped === "is_invoice_issuer") {
        row[mapped] = parseBool(s);
      } else {
        row[mapped] = s;
      }
    }
    return row as VendorRow;
  });
}

export type VendorImportOptions = {
  dry_run?: boolean;
  /**
   * - "overwrite" : 既存値は EXCLUDED で完全上書き (= デフォルト)
   * - "skip"      : vendor_code が既存ならスキップ
   * - "fill_only" : 既存セルが空のときだけ補完
   */
  duplicate_mode?: "overwrite" | "skip" | "fill_only";
};

export type VendorImportResult = {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ row: number; vendor_code: string; error: string }>;
  preview?: Array<{
    row: number;
    vendor_code: string;
    action: "insert" | "update" | "skip" | "fill_only";
    vendor_name: string;
  }>;
};

/**
 * 行配列を vendors テーブルに upsert する。
 * dry_run=true のときは DB は触らず preview を返す。
 */
export async function importVendorRows(
  rows: VendorRow[],
  opts: VendorImportOptions = {}
): Promise<VendorImportResult> {
  const mode = opts.duplicate_mode || "overwrite";
  const result: VendorImportResult = {
    total: rows.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    preview: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2; // CSV では 1 行目がヘッダ
    const code = String(r.vendor_code || "").trim();
    const name = String(r.vendor_name || "").trim();
    if (!code) {
      result.failed++;
      result.errors.push({ row: rowNum, vendor_code: "(empty)", error: "vendor_code が空" });
      continue;
    }
    if (!name) {
      result.failed++;
      result.errors.push({ row: rowNum, vendor_code: code, error: "vendor_name が空" });
      continue;
    }

    // 既存判定
    let existing: VendorRow | null = null;
    try {
      existing = await getVendor(code);
    } catch (err: any) {
      result.failed++;
      result.errors.push({ row: rowNum, vendor_code: code, error: `lookup failed: ${err?.message || err}` });
      continue;
    }

    // 重複モードに応じた action 判定
    let action: "insert" | "update" | "skip" | "fill_only" = existing ? "update" : "insert";
    if (existing && mode === "skip") action = "skip";
    if (existing && mode === "fill_only") action = "fill_only";

    if (action === "skip") {
      result.skipped++;
      result.preview!.push({ row: rowNum, vendor_code: code, action, vendor_name: name });
      continue;
    }

    if (opts.dry_run) {
      result.succeeded++;
      result.preview!.push({ row: rowNum, vendor_code: code, action, vendor_name: name });
      continue;
    }

    // 実際の upsert
    try {
      if (action === "fill_only" && existing) {
        // 既存が空のセルだけ補完
        const merged: VendorRow = { ...existing };
        for (const [k, v] of Object.entries(r)) {
          if (v == null || v === "") continue;
          const cur = (existing as any)[k];
          if (cur == null || cur === "") (merged as any)[k] = v;
        }
        await upsertVendor(merged);
      } else {
        // overwrite or insert
        await upsertVendor(r);
      }
      result.succeeded++;
      result.preview!.push({ row: rowNum, vendor_code: code, action, vendor_name: name });
    } catch (err: any) {
      result.failed++;
      result.errors.push({ row: rowNum, vendor_code: code, error: String(err?.message || err) });
    }
  }

  if (!opts.dry_run) {
    delete result.preview;
  }

  return result;
}

/**
 * サンプル CSV テキスト (UI のテンプレートダウンロード用)。
 */
export function getVendorSampleCsv(): string {
  const header = [
    "vendor_code", "vendor_name", "trade_name", "pen_name", "entity_type",
    "phone", "email", "contact_name", "address",
    "bank_name", "branch_name", "account_type", "account_number", "account_holder_kana",
    "is_invoice_issuer", "invoice_registration_number",
  ];
  const rows = [
    [
      "2-20-9001", "株式会社サンプル商事", "サンプル商事", "", "corporate",
      "03-1234-5678", "info@sample.co.jp", "山田 太郎", "東京都千代田区サンプル町1-2-3",
      "みずほ銀行", "東京支店", "普通", "1234567", "カ）サンプルシヨウジ",
      "TRUE", "T1234567890123",
    ],
    [
      "2-20-9002", "サンプル個人事業主", "", "サンプル筆名", "individual",
      "090-0000-0000", "ind@sample.com", "鈴木 花子", "大阪府大阪市サンプル区2-3-4",
      "三井住友銀行", "梅田支店", "普通", "7654321", "スズキ ハナコ",
      "FALSE", "",
    ],
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

