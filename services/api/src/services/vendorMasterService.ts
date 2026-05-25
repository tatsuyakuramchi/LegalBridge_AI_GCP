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

import { query, pool } from "../lib/db.ts";

/**
 * Phase 22.21.72: 任意の "client もしくは pool" の query 抽象。
 *   transaction 配下では PoolClient を受け取り、それ以外は global pool query を使う。
 *   replaceVendorAddresses / replaceVendorBankAccounts を transaction 化したときに
 *   呼び出し側から client を渡せるようにするためのインタフェース。
 */
type Queryable = {
  query: (text: string, params?: any[]) => Promise<any>;
};
const defaultQueryable: Queryable = {
  query: (text, params) => query(text, params),
};

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

export type VendorAddress = {
  id?: number;
  address_label?: string | null;
  postal_code?: string | null;
  address: string;
  is_primary?: boolean;
  sort_order?: number;
};

export type VendorBankAccount = {
  id?: number;
  bank_label?: string | null;
  bank_name?: string | null;
  branch_name?: string | null;
  account_type?: string | null;
  account_number?: string | null;
  account_holder_kana?: string | null;
  is_primary?: boolean;
  sort_order?: number;
};

export type VendorRow = {
  id?: number;
  vendor_code: string;
  vendor_name: string;
  corporate_number?: string | null;
  trade_name?: string | null;
  pen_name?: string | null;
  vendor_suffix?: string | null;
  entity_type?: string | null;
  withholding_enabled?: boolean;
  aliases?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  payment_terms?: string | null;
  main_business?: string | null;
  transaction_category?: string | null;
  capital_yen?: number | string | null;
  employee_count?: number | string | null;
  subcontract_act_applicable?: boolean | null;
  rating?: string | null;
  antisocial_check_result?: string | null;
  master_updated_at?: string | null;
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
  addresses?: VendorAddress[];
  bank_accounts?: VendorBankAccount[];
};

const SELECT_COLUMNS = `
  id, vendor_code, vendor_name, corporate_number, trade_name, pen_name, vendor_suffix, entity_type,
  withholding_enabled, aliases, address, phone, email, payment_terms, main_business,
  transaction_category, capital_yen, employee_count, subcontract_act_applicable,
  rating, antisocial_check_result, master_updated_at,
  contact_department, contact_name, master_contract_ref, bank_info,
  bank_name, branch_name, account_type, account_number, account_holder_kana,
  is_invoice_issuer, invoice_registration_number, vendor_rep
`;

const LEGACY_SELECT_COLUMNS = `
  id, vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type,
  withholding_enabled, aliases, address, phone, email,
  contact_department, contact_name, master_contract_ref, bank_info,
  bank_name, branch_name, account_type, account_number, account_holder_kana,
  is_invoice_issuer, invoice_registration_number
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

async function fetchAddressesMap(
  vendorIds: number[]
): Promise<Map<number, VendorAddress[]>> {
  const map = new Map<number, VendorAddress[]>();
  if (vendorIds.length === 0) return map;
  try {
    const res = await query(
      `SELECT vendor_id, id, address_label, postal_code, address, is_primary, sort_order
         FROM vendor_addresses
        WHERE vendor_id = ANY($1::int[])
        ORDER BY vendor_id, is_primary DESC, sort_order ASC, id ASC`,
      [vendorIds]
    );
    res.rows.forEach((r: any) => {
      const vid = Number(r.vendor_id);
      if (!map.has(vid)) map.set(vid, []);
      map.get(vid)!.push({
        id: Number(r.id),
        address_label: r.address_label || null,
        postal_code: r.postal_code || null,
        address: r.address || "",
        is_primary: !!r.is_primary,
        sort_order: Number(r.sort_order) || 0,
      });
    });
  } catch (err: any) {
    if (err && (err.code === "42703" || err.code === "42P01")) return map;
    throw err;
  }
  return map;
}

async function fetchBankAccountsMap(
  vendorIds: number[]
): Promise<Map<number, VendorBankAccount[]>> {
  const map = new Map<number, VendorBankAccount[]>();
  if (vendorIds.length === 0) return map;
  try {
    const res = await query(
      `SELECT vendor_id, id, bank_label, bank_name, branch_name, account_type,
              account_number, account_holder_kana, is_primary, sort_order
         FROM vendor_bank_accounts
        WHERE vendor_id = ANY($1::int[])
        ORDER BY vendor_id, is_primary DESC, sort_order ASC, id ASC`,
      [vendorIds]
    );
    res.rows.forEach((r: any) => {
      const vid = Number(r.vendor_id);
      if (!map.has(vid)) map.set(vid, []);
      map.get(vid)!.push({
        id: Number(r.id),
        bank_label: r.bank_label || null,
        bank_name: r.bank_name || null,
        branch_name: r.branch_name || null,
        account_type: r.account_type || null,
        account_number: r.account_number || null,
        account_holder_kana: r.account_holder_kana || null,
        is_primary: !!r.is_primary,
        sort_order: Number(r.sort_order) || 0,
      });
    });
  } catch (err: any) {
    if (err && (err.code === "42703" || err.code === "42P01")) return map;
    throw err;
  }
  return map;
}

function normalizeNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function calculateSubcontractActApplicable(v: VendorRow): boolean {
  const category = String(v.transaction_category || "").trim();
  const capital = normalizeNumber(v.capital_yen);
  const employees = normalizeNumber(v.employee_count);
  if (!category && capital == null && employees == null) return false;
  return (capital != null && capital >= 10000000) || (employees != null && employees >= 100);
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
  // New vendor master columns are created by the worker migration. Until that
  // migration has run, keep read pages alive by falling back to the legacy shape.
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
      res = await query(
        `SELECT ${LEGACY_SELECT_COLUMNS}
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
  const [contactsMap, addressesMap, bankAccountsMap] = await Promise.all([
    fetchContactsMap(ids),
    fetchAddressesMap(ids),
    fetchBankAccountsMap(ids),
  ]);
  rows.forEach((r) => {
    r.contacts = contactsMap.get(Number(r.id)) || [];
    r.addresses = addressesMap.get(Number(r.id)) || [];
    r.bank_accounts = bankAccountsMap.get(Number(r.id)) || [];
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
      res = await query(
        `SELECT ${LEGACY_SELECT_COLUMNS} FROM vendors WHERE vendor_code = $1 LIMIT 1`,
        [code]
      );
    } else {
      throw err;
    }
  }
  const row = (res.rows[0] as VendorRow) || null;
  if (!row) return null;
  const [contactsMap, addressesMap, bankAccountsMap] = await Promise.all([
    fetchContactsMap([Number(row.id)]),
    fetchAddressesMap([Number(row.id)]),
    fetchBankAccountsMap([Number(row.id)]),
  ]);
  row.contacts = contactsMap.get(Number(row.id)) || [];
  row.addresses = addressesMap.get(Number(row.id)) || [];
  row.bank_accounts = bankAccountsMap.get(Number(row.id)) || [];
  return row;
}

// Phase 22.21.72: 第3引数 q (Queryable) を受け取り、transaction 配下では
//   PoolClient 経由で実行する。省略時は defaultQueryable (= global pool query)。
async function replaceVendorAddresses(
  vendorId: number,
  addresses: VendorAddress[],
  q: Queryable = defaultQueryable
) {
  const rows = addresses
    .filter((a) => a && String(a.address || "").trim())
    .map((a, idx) => ({
      address_label: a.address_label || null,
      postal_code: a.postal_code || null,
      address: String(a.address).trim(),
      is_primary: !!a.is_primary,
      sort_order: Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : idx,
    }));
  if (rows.length > 0 && !rows.some((a) => a.is_primary)) rows[0].is_primary = true;

  await q.query("DELETE FROM vendor_addresses WHERE vendor_id = $1", [vendorId]);
  for (const a of rows) {
    await q.query(
      `INSERT INTO vendor_addresses
        (vendor_id, address_label, postal_code, address, is_primary, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [vendorId, a.address_label, a.postal_code, a.address, a.is_primary, a.sort_order]
    );
  }

  const primary = rows.find((a) => a.is_primary) || rows[0];
  if (primary) {
    await q.query("UPDATE vendors SET address = $1 WHERE id = $2", [primary.address, vendorId]);
  }
}

async function replaceVendorBankAccounts(
  vendorId: number,
  bankAccounts: VendorBankAccount[],
  q: Queryable = defaultQueryable
) {
  const rows = bankAccounts
    .filter((a) =>
      a &&
      [a.bank_name, a.branch_name, a.account_number, a.account_holder_kana].some((x) =>
        String(x || "").trim()
      )
    )
    .map((a, idx) => ({
      bank_label: a.bank_label || null,
      bank_name: a.bank_name || null,
      branch_name: a.branch_name || null,
      account_type: a.account_type || null,
      account_number: a.account_number || null,
      account_holder_kana: a.account_holder_kana || null,
      is_primary: !!a.is_primary,
      sort_order: Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : idx,
    }));
  if (rows.length > 0 && !rows.some((a) => a.is_primary)) rows[0].is_primary = true;

  await q.query("DELETE FROM vendor_bank_accounts WHERE vendor_id = $1", [vendorId]);
  for (const a of rows) {
    await q.query(
      `INSERT INTO vendor_bank_accounts
        (vendor_id, bank_label, bank_name, branch_name, account_type,
         account_number, account_holder_kana, is_primary, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        vendorId,
        a.bank_label,
        a.bank_name,
        a.branch_name,
        a.account_type,
        a.account_number,
        a.account_holder_kana,
        a.is_primary,
        a.sort_order,
      ]
    );
  }

  const primary = rows.find((a) => a.is_primary) || rows[0];
  if (primary) {
    await q.query(
      `UPDATE vendors
          SET bank_name = $1, branch_name = $2, account_type = $3,
              account_number = $4, account_holder_kana = $5
        WHERE id = $6`,
      [
        primary.bank_name,
        primary.branch_name,
        primary.account_type,
        primary.account_number,
        primary.account_holder_kana,
        vendorId,
      ]
    );
  }
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

  // Phase 22.21.72: vendors INSERT/UPDATE + vendor_addresses + vendor_bank_accounts
  //   の書込みをトランザクション化。途中失敗で中途半端なデータ (住所だけ消える等)
  //   が残るのを防ぐ。
  //   - pool.connect() で専用 client を取得
  //   - BEGIN → 全 write を client 経由
  //   - COMMIT で確定、エラー時 ROLLBACK で全巻戻し
  //   - finally で client.release() — 接続リーク防止
  //   - getVendor(code) は COMMIT 後の global pool 経由 (確定済データを返す)
  const subcontractApplicable = calculateSubcontractActApplicable(v);
  const client = await pool.connect();
  let vendorId = 0;
  try {
    await client.query("BEGIN");

    const upsert = await client.query(
      `INSERT INTO vendors (
        vendor_code, vendor_name, corporate_number, trade_name, pen_name, vendor_suffix, entity_type,
        withholding_enabled, aliases, address, phone, email, payment_terms,
        main_business, transaction_category, capital_yen, employee_count,
        subcontract_act_applicable, rating, antisocial_check_result, master_updated_at, contact_department,
        contact_name, master_contract_ref, bank_info, bank_name, branch_name,
        account_type, account_number, account_holder_kana, is_invoice_issuer,
        invoice_registration_number
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,COALESCE($21, CURRENT_TIMESTAMP),$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
      )
      ON CONFLICT (vendor_code) DO UPDATE SET
        vendor_name                 = EXCLUDED.vendor_name,
        corporate_number            = EXCLUDED.corporate_number,
        trade_name                  = EXCLUDED.trade_name,
        pen_name                    = EXCLUDED.pen_name,
        vendor_suffix               = EXCLUDED.vendor_suffix,
        entity_type                 = EXCLUDED.entity_type,
        withholding_enabled         = EXCLUDED.withholding_enabled,
        aliases                     = EXCLUDED.aliases,
        address                     = EXCLUDED.address,
        phone                       = EXCLUDED.phone,
        email                       = EXCLUDED.email,
        payment_terms               = EXCLUDED.payment_terms,
        main_business               = EXCLUDED.main_business,
        transaction_category        = EXCLUDED.transaction_category,
        capital_yen                 = EXCLUDED.capital_yen,
        employee_count              = EXCLUDED.employee_count,
        subcontract_act_applicable  = EXCLUDED.subcontract_act_applicable,
        rating                      = EXCLUDED.rating,
        antisocial_check_result     = EXCLUDED.antisocial_check_result,
        master_updated_at           = EXCLUDED.master_updated_at,
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
        invoice_registration_number = EXCLUDED.invoice_registration_number
      RETURNING id`,
      [
        code,
        name,
        v.corporate_number || null,
        v.trade_name || null,
        v.pen_name || null,
        v.vendor_suffix || null,
        v.entity_type || null,
        Boolean(v.withholding_enabled),
        v.aliases || null,
        v.address || null,
        v.phone || null,
        v.email || null,
        v.payment_terms || null,
        v.main_business || null,
        v.transaction_category || null,
        normalizeNumber(v.capital_yen),
        normalizeNumber(v.employee_count),
        subcontractApplicable,
        v.rating || null,
        v.antisocial_check_result || null,
        v.master_updated_at || null,
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
    vendorId = Number(upsert.rows[0]?.id);
    // Queryable adapter — replace ヘルパに client を渡してトランザクション内実行
    const tx: Queryable = { query: (text, params) => client.query(text, params) };

    if (Array.isArray(v.addresses) && vendorId) {
      await replaceVendorAddresses(vendorId, v.addresses, tx);
    } else if (v.address && vendorId) {
      // 既存 vendor_addresses 行の存在チェック (transaction 内なので tx 経由)。
      //   無ければ legacy `v.address` から 1 行作成してバックフィル。
      const existing = await client.query(
        "SELECT 1 FROM vendor_addresses WHERE vendor_id = $1 LIMIT 1",
        [vendorId]
      );
      if (existing.rows.length === 0) {
        await replaceVendorAddresses(
          vendorId,
          [{ address: v.address, is_primary: true }],
          tx
        );
      }
    }

    if (Array.isArray(v.bank_accounts) && vendorId) {
      await replaceVendorBankAccounts(vendorId, v.bank_accounts, tx);
    } else if (
      vendorId &&
      (v.bank_name || v.branch_name || v.account_number || v.account_holder_kana)
    ) {
      const existing = await client.query(
        "SELECT 1 FROM vendor_bank_accounts WHERE vendor_id = $1 LIMIT 1",
        [vendorId]
      );
      if (existing.rows.length === 0) {
        await replaceVendorBankAccounts(
          vendorId,
          [
            {
              bank_name: v.bank_name || null,
              branch_name: v.branch_name || null,
              account_type: v.account_type || null,
              account_number: v.account_number || null,
              account_holder_kana: v.account_holder_kana || null,
              is_primary: true,
            },
          ],
          tx
        );
      }
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => { /* noop */ });
    throw e;
  } finally {
    client.release();
  }

  // COMMIT 確定後、getVendor で最新状態を読み戻して返却 (global pool 経由)。
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
  corporate_number: "corporate_number",
  trade_name: "trade_name",
  pen_name: "pen_name",
  vendor_suffix: "vendor_suffix",
  entity_type: "entity_type",
  withholding_enabled: "withholding_enabled",
  aliases: "aliases",
  address: "address",
  phone: "phone",
  email: "email",
  payment_terms: "payment_terms",
  main_business: "main_business",
  transaction_category: "transaction_category",
  capital_yen: "capital_yen",
  employee_count: "employee_count",
  rating: "rating",
  antisocial_check_result: "antisocial_check_result",
  master_updated_at: "master_updated_at",
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
  corporateNumber: "corporate_number",
  tradeName: "trade_name",
  penName: "pen_name",
  vendorSuffix: "vendor_suffix",
  entityType: "entity_type",
  withholdingEnabled: "withholding_enabled",
  contactDepartment: "contact_department",
  paymentTerms: "payment_terms",
  mainBusiness: "main_business",
  transactionCategory: "transaction_category",
  capitalYen: "capital_yen",
  employeeCount: "employee_count",
  ratingScore: "rating",
  antisocialCheckResult: "antisocial_check_result",
  masterUpdatedAt: "master_updated_at",
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
