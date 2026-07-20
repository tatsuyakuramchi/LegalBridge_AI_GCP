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

import { query, pool, ensureVendorColumns } from "../lib/db.ts";

/**
 * Phase 28.1: ensureVendorColumns を 1 プロセス 1 回だけ実行するためのメモ化 Promise。
 *   search-api は initDb を呼ばないため、upsert が走る前に vendors 列を保証する。
 *   失敗したら memo をクリアして次回再試行できるようにする。
 */
let vendorSchemaReady: Promise<void> | null = null;
function ensureVendorSchema(): Promise<void> {
  if (!vendorSchemaReady) {
    vendorSchemaReady = ensureVendorColumns().catch((e) => {
      vendorSchemaReady = null;
      throw e;
    });
  }
  return vendorSchemaReady;
}

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
  // 0014: 海外送金用(account_scope='overseas' のとき使用)
  account_scope?: string | null; // 'domestic' | 'overseas'
  swift_bic?: string | null;
  iban?: string | null;
  routing_number?: string | null;
  account_holder_name?: string | null;
  bank_country?: string | null;
  bank_address?: string | null;
  currency?: string | null;
  intermediary_bank_swift?: string | null;
  intermediary_bank_name?: string | null;
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

// ====================================================================
// §12 機密フィールドの役割別フィルタ
//   viewer には「口座 / 反社 / 与信(評点)」を一切返さない。admin は従来どおり全開示。
//   admin-ui の内部呼び出し(portal_secret)は resolveAppRole で admin に解決されるため
//   編集画面は影響を受けない(§20)。フィルタは各出力境界(ハンドラ/レンダラ)で明示適用する。
//   ※ upsert 後の読み戻し(internal getVendor)には適用しない(書込み応答は admin 向け)。
// ====================================================================

/** viewer に返してはいけない vendor 機密列(スカラ)。 */
export const VENDOR_SENSITIVE_FIELDS = [
  "rating", // 与信/評点
  "antisocial_check_result", // 反社チェック結果
  "bank_info",
  "bank_name",
  "branch_name",
  "account_type",
  "account_number",
  "account_holder_kana", // 口座(単一列レガシー)
] as const;

/** 単一 vendor から機密列＋口座配列を除去した複製を返す(admin はそのまま)。 */
export function redactVendor<T extends Record<string, any>>(
  row: T,
  role: "admin" | "viewer"
): T {
  if (!row || role === "admin") return row;
  const clone: any = { ...row };
  for (const f of VENDOR_SENSITIVE_FIELDS) delete clone[f];
  // 口座は 1:N 配列でも保持されるため空配列に落とす(存在自体は隠さない)。
  if (Array.isArray(clone.bank_accounts)) clone.bank_accounts = [];
  return clone;
}

/** vendor 配列を一括 redact(admin はそのまま)。 */
export function redactVendors<T extends Record<string, any>>(
  rows: T[],
  role: "admin" | "viewer"
): T[] {
  if (role === "admin" || !Array.isArray(rows)) return rows;
  return rows.map((r) => redactVendor(r, role));
}

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
              account_number, account_holder_kana, is_primary, sort_order,
              account_scope, swift_bic, iban, routing_number, account_holder_name,
              bank_country, bank_address, currency, intermediary_bank_swift, intermediary_bank_name
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
        account_scope: r.account_scope || "domestic",
        swift_bic: r.swift_bic || null,
        iban: r.iban || null,
        routing_number: r.routing_number || null,
        account_holder_name: r.account_holder_name || null,
        bank_country: r.bank_country || null,
        bank_address: r.bank_address || null,
        currency: r.currency || null,
        intermediary_bank_swift: r.intermediary_bank_swift || null,
        intermediary_bank_name: r.intermediary_bank_name || null,
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
  // Phase 25.1: DB 側の vendor_code に前後空白が混入している行 (CSV 取込時に
  //   法人番号末尾へ紛れ込んだケース等) でも引けるよう、完全一致を優先しつつ
  //   TRIM 一致を fallback として OR でマッチさせる。受け取り code は既に trim 済み。
  let res: any;
  try {
    res = await query(
      `SELECT ${SELECT_COLUMNS} FROM vendors
        WHERE vendor_code = $1 OR TRIM(vendor_code) = $1
        ORDER BY (vendor_code = $1) DESC LIMIT 1`,
      [code]
    );
  } catch (err: any) {
    if (err && err.code === "42703") {
      res = await query(
        `SELECT ${LEGACY_SELECT_COLUMNS} FROM vendors
          WHERE vendor_code = $1 OR TRIM(vendor_code) = $1
          ORDER BY (vendor_code = $1) DESC LIMIT 1`,
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
      // 国内・海外いずれかの主要項目が入っていれば保存対象。
      [
        a.bank_name, a.branch_name, a.account_number, a.account_holder_kana,
        a.account_holder_name, a.iban, a.swift_bic,
      ].some((x) => String(x || "").trim())
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
      account_scope: a.account_scope === "overseas" ? "overseas" : "domestic",
      swift_bic: a.swift_bic || null,
      iban: a.iban || null,
      routing_number: a.routing_number || null,
      account_holder_name: a.account_holder_name || null,
      bank_country: a.bank_country || null,
      bank_address: a.bank_address || null,
      currency: a.currency || null,
      intermediary_bank_swift: a.intermediary_bank_swift || null,
      intermediary_bank_name: a.intermediary_bank_name || null,
    }));
  if (rows.length > 0 && !rows.some((a) => a.is_primary)) rows[0].is_primary = true;

  await q.query("DELETE FROM vendor_bank_accounts WHERE vendor_id = $1", [vendorId]);
  for (const a of rows) {
    await q.query(
      `INSERT INTO vendor_bank_accounts
        (vendor_id, bank_label, bank_name, branch_name, account_type,
         account_number, account_holder_kana, is_primary, sort_order,
         account_scope, swift_bic, iban, routing_number, account_holder_name,
         bank_country, bank_address, currency, intermediary_bank_swift, intermediary_bank_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
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
        a.account_scope,
        a.swift_bic,
        a.iban,
        a.routing_number,
        a.account_holder_name,
        a.bank_country,
        a.bank_address,
        a.currency,
        a.intermediary_bank_swift,
        a.intermediary_bank_name,
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
export async function upsertVendor(
  v: VendorRow,
  opts?: { checkCorpDup?: boolean }
): Promise<VendorRow> {
  const code = String(v.vendor_code || "").trim();
  const name = String(v.vendor_name || "").trim();
  if (!code) throw new Error("vendor_code は必須です");
  if (!name) throw new Error("vendor_name は必須です");

  // B系(取引先UI一本化): 対話登録では、同じ法人番号(正規化=数字のみ)の取引先が
  //   「別 vendor_code」で既にあれば重複作成を止める(worker 側 POST と同一仕様)。
  //   CSV 一括取込は opts 未指定で従来通り(バッチを壊さない)。
  const corpNo = String((v as any).corporate_number || "").replace(/[^0-9]/g, "");
  if (opts?.checkCorpDup && corpNo && (v as any).force_new !== true) {
    try {
      const dupe = await query(
        `SELECT id, vendor_code, vendor_name FROM vendors
          WHERE regexp_replace(coalesce(corporate_number,''), '[^0-9]', '', 'g') = $1
            AND vendor_code <> $2
          ORDER BY id LIMIT 1`,
        [corpNo, code]
      );
      if (dupe.rows[0]) {
        const err: any = new Error(
          `同じ法人番号の取引先「${dupe.rows[0].vendor_name}（${dupe.rows[0].vendor_code}）」が既に登録されています。既存を使うか、統合(Masters→統合)してください。`
        );
        err.code = "VENDOR_CORP_DUP";
        err.existing = dupe.rows[0];
        throw err;
      }
    } catch (e: any) {
      if (e?.code === "VENDOR_CORP_DUP") throw e;
      console.warn("[upsertVendor corp dedup] skipped:", e);
    }
  }

  // Phase 22.21.72: vendors INSERT/UPDATE + vendor_addresses + vendor_bank_accounts
  //   の書込みをトランザクション化。途中失敗で中途半端なデータ (住所だけ消える等)
  //   が残るのを防ぐ。
  //   - pool.connect() で専用 client を取得
  //   - BEGIN → 全 write を client 経由
  //   - COMMIT で確定、エラー時 ROLLBACK で全巻戻し
  //   - finally で client.release() — 接続リーク防止
  //   - getVendor(code) は COMMIT 後の global pool 経由 (確定済データを返す)
  // Phase 28.1: worker の migration が共有 DB に届く前でも保存を成立させるため、
  //   upsert 実行前に vendors 列/子テーブルを冪等に保証する (プロセス内 1 回)。
  await ensureVendorSchema();

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
        invoice_registration_number, vendor_rep
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,COALESCE($21, CURRENT_TIMESTAMP),$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
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
        -- Phase 22.21.73: master_updated_at は user-curated タイムスタンプ。
        --   ユーザーが日付欄を空白で保存すると EXCLUDED.master_updated_at が
        --   NULL になり、既存値を NULL で上書きしてしまう問題があった。
        --   COALESCE で「新値があれば新値、無ければ既存値、最後の砦は now()」
        --   の優先順に変更する。
        master_updated_at           = COALESCE(
                                        EXCLUDED.master_updated_at,
                                        vendors.master_updated_at,
                                        CURRENT_TIMESTAMP
                                      ),
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
        invoice_registration_number = EXCLUDED.invoice_registration_number,
        vendor_rep                  = EXCLUDED.vendor_rep
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
        v.vendor_rep || null,
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
  // Phase 22.21.77: 代表者名 (法人の正式代表者) の alias を追加。
  //   Phase 22.13 で vendors.vendor_rep カラムを追加したのに、CSV import
  //   側のマッピング辞書には英語 alias が追加されておらず、さらに日本語
  //   alias「代表者名」が誤って contact_name (担当者名) に振られていた。
  //   今回両方を修正。
  vendor_rep: "vendor_rep",
  vendorRep: "vendor_rep",
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
  // Phase 22.21.77: 代表者名 は vendor_rep にマップ (Phase 22.13 で追加)。
  //   旧仕様では contact_name (担当者名) に振っていたが、Phase 22.13 で
  //   vendor_rep カラムを追加した時にここの更新が漏れていた。
  代表者名: "vendor_rep",
  代表者: "vendor_rep",
  代表: "vendor_rep",
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
  // Phase 22.21.74: 週末追加した新列の日本語 alias。これがないと日本語
  //   ヘッダ CSV (例: "法人番号,資本金,従業員数,...") が silently ドロップする。
  法人番号: "corporate_number",
  支払サイト: "payment_terms",
  支払条件: "payment_terms",
  主要事業: "main_business",
  業種: "main_business",
  取引区分: "transaction_category",
  取引カテゴリ: "transaction_category",
  資本金: "capital_yen",
  資本金額: "capital_yen",
  従業員数: "employee_count",
  社員数: "employee_count",
  格付: "rating",
  格付け: "rating",
  レーティング: "rating",
  "反社チェック": "antisocial_check_result",
  反社確認: "antisocial_check_result",
  反社チェック結果: "antisocial_check_result",
  最終更新日: "master_updated_at",
  マスター更新日: "master_updated_at",
  更新日: "master_updated_at",
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

/**
 * 既存の取引先データを「取込テンプレと同じ列」でCSV出力する(ラウンドトリップ用)。
 *   これをDLして修正 → /api/master/vendors/import-csv で一括更新できる。
 *   列は getVendorSampleCsv のヘッダと完全一致(vendor_code をキーに upsert)。
 *   ※住所/振込先は「メイン(★)」の単一値(レガシー列)を出力する。複数住所・複数
 *     口座の一括編集はこのCSVの対象外(取引先画面で編集)。
 */
const VENDOR_EXPORT_COLUMNS = [
  "vendor_code", "corporate_number", "vendor_name", "trade_name", "pen_name", "entity_type",
  "phone", "email", "payment_terms", "main_business", "transaction_category",
  "capital_yen", "employee_count", "rating", "antisocial_check_result", "master_updated_at",
  "contact_name", "address",
  "bank_name", "branch_name", "account_type", "account_number", "account_holder_kana",
  "is_invoice_issuer", "invoice_registration_number",
] as const;

export async function getVendorExportCsv(
  codes?: string[],
  role: "admin" | "viewer" = "admin"
): Promise<string> {
  const cols = VENDOR_EXPORT_COLUMNS;
  const filter = (codes || []).map((c) => String(c).trim()).filter(Boolean);
  // §12: viewer 出力では口座/反社/与信の列値を空欄化(列見出しは維持し形式を安定させる)。
  const redactSet: Set<string> =
    role === "admin"
      ? new Set()
      : new Set(VENDOR_SENSITIVE_FIELDS as readonly string[]);

  // 住所/振込先/窓口担当は 1:N の primary(★メイン) を採用し、無ければレガシー単一
  //   カラムにフォールバック。codes 指定時はその vendor_code のみ。
  const primarySql = `
    SELECT
      v.vendor_code, v.corporate_number, v.vendor_name, v.trade_name, v.pen_name, v.entity_type,
      v.phone, v.email, v.payment_terms, v.main_business, v.transaction_category,
      v.capital_yen, v.employee_count, v.rating, v.antisocial_check_result, v.master_updated_at,
      COALESCE(c.contact_name, v.contact_name)                 AS contact_name,
      COALESCE(a.address, v.address)                           AS address,
      COALESCE(ba.bank_name, v.bank_name)                      AS bank_name,
      COALESCE(ba.branch_name, v.branch_name)                  AS branch_name,
      COALESCE(ba.account_type, v.account_type)                AS account_type,
      COALESCE(ba.account_number, v.account_number)            AS account_number,
      COALESCE(ba.account_holder_kana, v.account_holder_kana)  AS account_holder_kana,
      v.is_invoice_issuer, v.invoice_registration_number
    FROM vendors v
    LEFT JOIN LATERAL (
      SELECT address FROM vendor_addresses
       WHERE vendor_id = v.id AND is_primary = TRUE
       ORDER BY sort_order ASC, id ASC LIMIT 1
    ) a ON TRUE
    LEFT JOIN LATERAL (
      SELECT bank_name, branch_name, account_type, account_number, account_holder_kana
        FROM vendor_bank_accounts
       WHERE vendor_id = v.id AND is_primary = TRUE
       ORDER BY sort_order ASC, id ASC LIMIT 1
    ) ba ON TRUE
    LEFT JOIN LATERAL (
      SELECT contact_name FROM vendor_contacts
       WHERE vendor_id = v.id AND is_primary = TRUE
       ORDER BY sort_order ASC, id ASC LIMIT 1
    ) c ON TRUE
    WHERE (cardinality($1::text[]) = 0 OR v.vendor_code = ANY($1::text[]))
    ORDER BY v.vendor_code`;

  let r;
  try {
    r = await query(primarySql, [filter]);
  } catch (err: any) {
    // 1:N テーブル未作成等(42P01/42703)はレガシー単一カラムのみで出力。
    if (err && (err.code === "42P01" || err.code === "42703")) {
      r = await query(
        `SELECT ${cols.join(", ")} FROM vendors
          WHERE (cardinality($1::text[]) = 0 OR vendor_code = ANY($1::text[]))
          ORDER BY vendor_code`,
        [filter]
      );
    } else {
      throw err;
    }
  }
  const fmt = (col: string, v: any): string => {
    if (v == null) return "";
    if (col === "is_invoice_issuer") {
      return v === true || v === "t" || v === "true" || v === "TRUE" ? "TRUE" : "FALSE";
    }
    if (col === "master_updated_at") {
      const s = String(v);
      return s.length >= 10 ? s.substring(0, 10) : s;
    }
    return String(v);
  };
  const esc = (s: string) =>
    /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const lines: string[] = [cols.join(",")];
  for (const row of r.rows) {
    lines.push(
      cols
        .map((c) => esc(redactSet.has(c) ? "" : fmt(c, (row as any)[c])))
        .join(",")
    );
  }
  return lines.join("\n");
}

// ====================================================================
// 取引先の強制削除 + 孤立レコード救済(再アタッチ)
// ====================================================================

// 主要な参照テーブルの「ラベル式」(救済画面で何のレコードか分かるように)。
//   未登録テーブルは "table #id" を使う。
const VENDOR_REF_LABELS: Record<string, string> = {
  documents: "document_number",
  contract_capabilities: "COALESCE(NULLIF(document_number,''), contract_title)",
  contracts: "COALESCE(NULLIF(document_number,''), contract_title)",
  works: "COALESCE(NULLIF(work_code,'') || ' : ' || title, title)",
  source_ips: "COALESCE(NULLIF(source_code,'') || ' : ' || title, title)",
  work_title_aliases: "alias_title",
};

type VendorFk = { table: string; column: string; nullable: boolean; cascade: boolean };

/** vendors(id) を参照している全 FK(子テーブル/列/NULL可否/ON DELETE) をカタログから取得。 */
async function vendorReferencingFks(): Promise<VendorFk[]> {
  const r = await query(
    `SELECT tc.table_name AS child_table, kcu.column_name AS child_column,
            col.is_nullable, rc.delete_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
       JOIN information_schema.columns col
         ON col.table_name = tc.table_name AND col.column_name = kcu.column_name AND col.table_schema = tc.table_schema
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'vendors' AND ccu.column_name = 'id'
        AND tc.table_schema = 'public'`
  );
  return r.rows.map((x: any) => ({
    table: String(x.child_table),
    column: String(x.child_column),
    nullable: String(x.is_nullable).toUpperCase() === "YES",
    cascade: String(x.delete_rule || "").toUpperCase() === "CASCADE",
  }));
}

/** 孤立ログ表(救済対象の記録)を冪等に用意。 */
async function ensureVendorOrphanTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS vendor_delete_orphans (
      id SERIAL PRIMARY KEY,
      deleted_vendor_code TEXT,
      deleted_vendor_name TEXT,
      child_table  TEXT NOT NULL,
      child_column TEXT NOT NULL,
      child_id     INTEGER NOT NULL,
      child_label  TEXT,
      resolved_at  TIMESTAMPTZ,
      resolved_vendor_code TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

/**
 * 取引先を強制削除。参照(FK)を:
 *   - ON DELETE CASCADE(住所/口座/担当 等) → 取引先削除で自動
 *   - NULL 可の参照     → NULL にし、孤立ログへ記録(後で再アタッチ可能)
 *   - NOT NULL の参照行 → 行ごと削除(救済不可・関連も消す)
 * テーブル/列名はカタログ由来(ユーザー入力ではない)ため安全。
 */
export async function deleteVendorForce(
  code: string
): Promise<{ deleted: boolean; nulled: number; removed: number; orphans: number }> {
  await ensureVendorOrphanTable();
  const fks = await vendorReferencingFks();
  const client = await pool.connect();
  let nulled = 0,
    removed = 0,
    orphans = 0;
  try {
    await client.query("BEGIN");
    const vr = await client.query(
      "SELECT id, vendor_name FROM vendors WHERE vendor_code = $1",
      [code]
    );
    if (vr.rows.length === 0) {
      await client.query("ROLLBACK");
      return { deleted: false, nulled: 0, removed: 0, orphans: 0 };
    }
    const vid = Number(vr.rows[0].id);
    const vname = String(vr.rows[0].vendor_name || "");
    for (const fk of fks) {
      if (fk.cascade) continue; // 取引先削除でカスケード
      if (fk.nullable) {
        const lbl = VENDOR_REF_LABELS[fk.table];
        const rows = await client.query(
          `SELECT id${lbl ? `, (${lbl}) AS label` : ""} FROM ${fk.table} WHERE ${fk.column} = $1`,
          [vid]
        );
        for (const row of rows.rows) {
          await client.query(
            `INSERT INTO vendor_delete_orphans
               (deleted_vendor_code, deleted_vendor_name, child_table, child_column, child_id, child_label)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [code, vname, fk.table, fk.column, Number(row.id), row.label || `${fk.table} #${row.id}`]
          );
          orphans++;
        }
        const up = await client.query(
          `UPDATE ${fk.table} SET ${fk.column} = NULL WHERE ${fk.column} = $1`,
          [vid]
        );
        nulled += up.rowCount || 0;
      } else {
        const del = await client.query(
          `DELETE FROM ${fk.table} WHERE ${fk.column} = $1`,
          [vid]
        );
        removed += del.rowCount || 0;
      }
    }
    const dv = await client.query("DELETE FROM vendors WHERE id = $1 RETURNING id", [vid]);
    await client.query("COMMIT");
    return { deleted: dv.rows.length > 0, nulled, removed, orphans };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** 未解決の孤立レコード(取引先参照を失ったもの)を一覧。 */
export async function listVendorOrphans(): Promise<any[]> {
  await ensureVendorOrphanTable();
  const r = await query(
    `SELECT id, deleted_vendor_code, deleted_vendor_name, child_table, child_column,
            child_id, child_label, created_at
       FROM vendor_delete_orphans
      WHERE resolved_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT 1000`
  );
  return r.rows;
}

/** 孤立レコードに取引先を再アタッチ(救済)。child_table/column はFKカタログで検証。 */
export async function attachVendorOrphan(orphanId: number, vendorCode: string): Promise<void> {
  await ensureVendorOrphanTable();
  const o = await query(
    "SELECT * FROM vendor_delete_orphans WHERE id = $1 AND resolved_at IS NULL",
    [orphanId]
  );
  if (o.rows.length === 0) throw new Error("孤立レコードが見つからないか、既に解決済みです");
  const orphan = o.rows[0];
  const fks = await vendorReferencingFks();
  const valid = fks.some((f) => f.table === orphan.child_table && f.column === orphan.child_column);
  if (!valid) throw new Error("不正な参照先です");
  const vr = await query("SELECT id FROM vendors WHERE vendor_code = $1", [String(vendorCode).trim()]);
  if (vr.rows.length === 0) throw new Error(`取引先が見つかりません: ${vendorCode}`);
  const vid = Number(vr.rows[0].id);
  await query(
    `UPDATE ${orphan.child_table} SET ${orphan.child_column} = $1 WHERE id = $2`,
    [vid, Number(orphan.child_id)]
  );
  await query(
    "UPDATE vendor_delete_orphans SET resolved_at = now(), resolved_vendor_code = $1 WHERE id = $2",
    [String(vendorCode).trim(), orphanId]
  );
}
