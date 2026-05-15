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

import { query } from "../lib/db.ts";

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
};

const SELECT_COLUMNS = `
  id, vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type,
  withholding_enabled, aliases, address, phone, email,
  contact_department, contact_name, master_contract_ref, bank_info,
  bank_name, branch_name, account_type, account_number, account_holder_kana,
  is_invoice_issuer, invoice_registration_number
`;

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

  let where = "";
  const params: any[] = [];
  if (q) {
    params.push(`%${q}%`);
    where = `WHERE
      vendor_code ILIKE $1 OR
      vendor_name ILIKE $1 OR
      trade_name ILIKE $1 OR
      pen_name ILIKE $1 OR
      COALESCE(aliases, '') ILIKE $1
    `;
  }

  const countRes = await query(
    `SELECT COUNT(*)::int AS c FROM vendors ${where}`,
    params
  );
  const total = Number(countRes.rows[0]?.c || 0);

  params.push(limit, offset);
  const res = await query(
    `SELECT ${SELECT_COLUMNS}
       FROM vendors
       ${where}
       ORDER BY vendor_code
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { rows: res.rows as VendorRow[], total };
}

/**
 * vendor_code 完全一致で 1 件取得。見つからない場合は null。
 */
export async function getVendor(vendorCode: string): Promise<VendorRow | null> {
  const code = String(vendorCode || "").trim();
  if (!code) return null;
  const res = await query(
    `SELECT ${SELECT_COLUMNS} FROM vendors WHERE vendor_code = $1 LIMIT 1`,
    [code]
  );
  return (res.rows[0] as VendorRow) || null;
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
