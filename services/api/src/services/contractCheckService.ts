import { query } from '../lib/db.ts';

export interface ContractCheckInput {
  counterpartyName: string;
  purposeCode: string;
  vendorId?: number;
  workName?: string;
  productName?: string;
  territory?: string;
  language?: string;
  memo?: string;
  additionalFlags?: {
    usesIp: boolean;
    includesSublicense: boolean;
    includesOverseas: boolean;
    includesEbook: boolean;
    includesVideoGame: boolean;
    unusualPaymentTerms: boolean;
  };
}

export function normalizeName(name: string): string {
  if (!name) return '';
  // NFKC normalization
  let normalized = name.normalize('NFKC');
  // Remove whitespace
  normalized = normalized.replace(/\s+/g, '');
  // Simplified removal of common corporate suffixes/prefixes in Japan
  const corporateTerms = [
    '株式会社', '有限会社', '合同会社', '一般社団法人', '公益社団法人',
    '一般財団法人', '公益財団法人', '特定非営利活動法人', 'NPO法人',
    '(株)', '(有)', '(合)', '(一社)', '(公社)', '(一財)', '(公財)', '(特非)'
  ];
  corporateTerms.forEach(term => {
    normalized = normalized.replace(term, '');
  });
  // Remove symbols
  normalized = normalized.replace(/[（）()<>〈〉［］[\]｛｝{}]/g, '');
  return normalized;
}

async function findVendorById(vendorId: number) {
  const res = await query(
    `SELECT * FROM vendors WHERE id = $1`,
    [vendorId]
  );
  return res.rows[0] || null;
}

function dedupeVendorsById(rows: any[]) {
  const map = new Map<number, any>();

  rows.forEach((row) => {
    if (row && row.id && !map.has(row.id)) {
      map.set(row.id, row);
    }
  });

  return Array.from(map.values());
}

/**
 * Phase 22.21.47: 全角/半角の差を意識せずに検索できるよう、SQL 両側を NFKC
 * 正規化した上で ILIKE 比較する。例:
 *   DB="ＧＣＴ研究所" / 入力="GCT" → 旧仕様では ILIKE が失敗。
 *   normalize(DB,NFKC)="GCT研究所" / normalize(入力,NFKC)="GCT" → ヒット。
 *
 * `normalize(text, NFKC)` は PostgreSQL 13+ で利用可能。Cloud SQL の現行設定は
 * PG14+ のため通常通る。旧 PG 環境で 42883 (undefined_function) が出た場合は
 * 旧来の ILIKE フォーム (NFKC 無し) に自動 fallback する。
 */
const VENDOR_SEARCH_SQL_NFKC = `
  SELECT *
    FROM (
      SELECT
        v.*,
        CASE
          WHEN normalize(v.vendor_name, NFKC) ILIKE normalize($1, NFKC) THEN 0
          WHEN normalize(v.trade_name,  NFKC) ILIKE normalize($1, NFKC) THEN 0
          WHEN normalize(v.pen_name,    NFKC) ILIKE normalize($1, NFKC) THEN 0
          WHEN normalize(v.aliases,     NFKC) ILIKE normalize($1, NFKC) THEN 0
          WHEN normalize(v.vendor_code, NFKC) ILIKE normalize($1, NFKC) THEN 0
          WHEN normalize(v.vendor_name, NFKC) ILIKE normalize($2, NFKC) THEN 1
          WHEN normalize(v.trade_name,  NFKC) ILIKE normalize($2, NFKC) THEN 1
          WHEN normalize(v.pen_name,    NFKC) ILIKE normalize($2, NFKC) THEN 1
          WHEN normalize(v.aliases,     NFKC) ILIKE normalize($2, NFKC) THEN 1
          WHEN normalize(v.vendor_code, NFKC) ILIKE normalize($2, NFKC) THEN 1
          WHEN normalize(v.vendor_name, NFKC) ILIKE normalize($3, NFKC) THEN 2
          WHEN normalize(v.trade_name,  NFKC) ILIKE normalize($3, NFKC) THEN 2
          WHEN normalize(v.pen_name,    NFKC) ILIKE normalize($3, NFKC) THEN 2
          WHEN normalize(v.aliases,     NFKC) ILIKE normalize($3, NFKC) THEN 2
          ELSE 9
        END AS match_priority
      FROM vendors v
      WHERE normalize(v.vendor_name, NFKC) ILIKE normalize($1, NFKC)
         OR normalize(v.trade_name,  NFKC) ILIKE normalize($1, NFKC)
         OR normalize(v.pen_name,    NFKC) ILIKE normalize($1, NFKC)
         OR normalize(v.aliases,     NFKC) ILIKE normalize($1, NFKC)
         OR normalize(v.vendor_code, NFKC) ILIKE normalize($1, NFKC)
         OR normalize(v.vendor_name, NFKC) ILIKE normalize($2, NFKC)
         OR normalize(v.trade_name,  NFKC) ILIKE normalize($2, NFKC)
         OR normalize(v.pen_name,    NFKC) ILIKE normalize($2, NFKC)
         OR normalize(v.aliases,     NFKC) ILIKE normalize($2, NFKC)
         OR normalize(v.vendor_code, NFKC) ILIKE normalize($2, NFKC)
         OR normalize(v.vendor_name, NFKC) ILIKE normalize($3, NFKC)
         OR normalize(v.trade_name,  NFKC) ILIKE normalize($3, NFKC)
         OR normalize(v.pen_name,    NFKC) ILIKE normalize($3, NFKC)
         OR normalize(v.aliases,     NFKC) ILIKE normalize($3, NFKC)
    ) matched
   ORDER BY match_priority ASC, vendor_name ASC, id ASC
   LIMIT $4
`;

const VENDOR_SEARCH_SQL_LEGACY = `
  SELECT *
    FROM (
      SELECT
        v.*,
        CASE
          WHEN v.vendor_name ILIKE $1 THEN 0
          WHEN v.trade_name  ILIKE $1 THEN 0
          WHEN v.pen_name    ILIKE $1 THEN 0
          WHEN v.aliases     ILIKE $1 THEN 0
          WHEN v.vendor_code ILIKE $1 THEN 0
          WHEN v.vendor_name ILIKE $2 THEN 1
          WHEN v.trade_name  ILIKE $2 THEN 1
          WHEN v.pen_name    ILIKE $2 THEN 1
          WHEN v.aliases     ILIKE $2 THEN 1
          WHEN v.vendor_code ILIKE $2 THEN 1
          WHEN v.vendor_name ILIKE $3 THEN 2
          WHEN v.trade_name  ILIKE $3 THEN 2
          WHEN v.pen_name    ILIKE $3 THEN 2
          WHEN v.aliases     ILIKE $3 THEN 2
          ELSE 9
        END AS match_priority
      FROM vendors v
      WHERE v.vendor_name ILIKE $1
         OR v.trade_name  ILIKE $1
         OR v.pen_name    ILIKE $1
         OR v.aliases     ILIKE $1
         OR v.vendor_code ILIKE $1
         OR v.vendor_name ILIKE $2
         OR v.trade_name  ILIKE $2
         OR v.pen_name    ILIKE $2
         OR v.aliases     ILIKE $2
         OR v.vendor_code ILIKE $2
         OR v.vendor_name ILIKE $3
         OR v.trade_name  ILIKE $3
         OR v.pen_name    ILIKE $3
         OR v.aliases     ILIKE $3
    ) matched
   ORDER BY match_priority ASC, vendor_name ASC, id ASC
   LIMIT $4
`;

export async function findVendorsByName(counterpartyName: string, limit: number = 10) {
  const normalized = normalizeName(counterpartyName);
  if (!normalized) return [];

  // 入力側も JS で NFKC 正規化しておく (DB 側は SQL で normalize() するので
  // 二重正規化になるが、NFKC は冪等なので問題ない)。
  const inputNfkc = String(counterpartyName).normalize("NFKC");
  const exactValue = inputNfkc;
  const rawLike = `%${inputNfkc}%`;
  const normalizedLike = `%${normalized}%`;

  try {
    const res = await query(VENDOR_SEARCH_SQL_NFKC, [
      exactValue,
      rawLike,
      normalizedLike,
      limit,
    ]);
    return dedupeVendorsById(res.rows).slice(0, limit);
  } catch (err: any) {
    // PG12 以下では normalize() が無く 42883 (undefined_function) になる。
    if (err?.code === "42883") {
      console.warn(
        "[contractCheck] normalize(NFKC) unsupported; falling back to plain ILIKE search"
      );
      const res = await query(VENDOR_SEARCH_SQL_LEGACY, [
        exactValue,
        rawLike,
        normalizedLike,
        limit,
      ]);
      return dedupeVendorsById(res.rows).slice(0, limit);
    }
    throw err;
  }
}

export async function findVendorByName(counterpartyName: string) {
  const vendors = await findVendorsByName(counterpartyName, 1);
  return vendors[0] || null;
}

export async function getContractPurposes() {
  const res = await query(
    `SELECT * FROM contract_purposes
     WHERE active = TRUE
     ORDER BY sort_order ASC`
  );
  return res.rows;
}

export async function getMasterContractSummary(vendorId: number) {
  const res = await query(
    `SELECT * FROM contract_capabilities
     WHERE vendor_id = $1 AND record_type = 'master_contract'`,
    [vendorId]
  );

  const summary: Record<string, any> = {
    service: createEmptyStatus('purchase_order', '業務委託基本契約書'),
    license: createEmptyStatus('license_condition', 'ライセンス利用許諾基本契約書'),
    publication: createEmptyStatus('publication_contract', '出版許諾基本契約書')
  };

  res.rows.forEach(row => {
    const cat = row.contract_category;
    if (summary[cat]) {
      summary[cat] = {
        exists: true,
        status: row.contract_status || 'executed',
        label: row.contract_status === 'executed' ? '締結済' : '確認中',
        contractTitle: row.contract_title,
        documentNumber: row.document_number,
        effectiveDate: row.effective_date ? (row.effective_date instanceof Date ? row.effective_date.toISOString().split('T')[0] : row.effective_date) : '',
        expirationDate: row.expiration_date ? (row.expiration_date instanceof Date ? row.expiration_date.toISOString().split('T')[0] : row.expiration_date) : '',
        autoRenewal: row.auto_renewal,
        availableDocument: cat === 'service' ? 'purchase_order' : (cat === 'license' ? 'license_condition' : 'publication_contract'),
        documentUrl: row.document_url || '',
        legalonUrl: row.legalon_url || '',
        cloudsignUrl: row.cloudsign_url || '',
        driveUrl: row.drive_url || ''
      };
    }
  });

  return summary;
}

function createEmptyStatus(availableDocument: string, defaultTitle: string) {
  return {
    exists: false,
    status: 'not_found',
    label: '未締結',
    contractTitle: '',
    documentNumber: '',
    effectiveDate: '',
    expirationDate: '',
    autoRenewal: false,
    availableDocument,
    documentUrl: '',
    legalonUrl: '',
    cloudsignUrl: '',
    driveUrl: ''
  };
}

export async function getLicenseConditions(vendorId: number) {
  const res = await query(
    `SELECT * FROM contract_capabilities
     WHERE vendor_id = $1 AND record_type = 'license_condition'`,
    [vendorId]
  );
  return res.rows.map(row => ({
    conditionNumber: row.condition_number || '',
    originalWork: row.original_work || '',
    productName: row.product_name || '',
    territory: row.territory || '',
    language: row.language || '',
    status: row.contract_status === 'executed' ? '有効' : '終了/確認中',
    documentUrl: row.document_url || ''
  }));
}

/**
 * Phase 11: vendor 紐付きの全文書を 3 カテゴリ (basic / individual / other) に
 * 分けて返す。Slack /法務検索 の結果画面で「基本契約は何と何がある / 個別契約は
 * 何と何がある / その他はなにとなにがある」をそのまま描画する用途。
 *
 * 突合経路:
 *   1. contract_capabilities.vendor_id = $1 から document_number 群を引く
 *   2. documents テーブルで document_category と drive_link を取得
 *   3. external_assets で file_link をフォールバック
 *
 * 並び順: created_at DESC (新しい順)
 */
export async function getDocumentsByCategory(vendorId: number) {
  // Phase 17x: 主取引先 (vendor_id) に加えて、3+ 者契約の
  //   additional_parties JSONB 配列内の vendor_id でも突合する。
  //   JSONB 配列の各要素は { name, vendor_id, role } の形。
  // Phase 22.12: is_primary フィルタを追加。リビジョン版 (is_primary=FALSE) は
  //   検索一覧には出さない (真の契約 = is_primary=TRUE のみ)。NULL は旧データ
  //   なので TRUE 同等扱い (= 表示する)。
  // Phase 22.12.1: schema migration が未適用 (= worker 未デプロイ) の環境で
  //   `cc.is_primary` 列が存在せず Slack 検索が落ちる事故への対策。
  //   新クエリを試して PostgreSQL undefined_column (42703) なら旧クエリに
  //   フォールバックする。これにより worker → api のデプロイ順を気にせずに済む。
  const NEW_QUERY = `
    WITH vendor_docs AS (
      SELECT DISTINCT
        cc.document_number,
        cc.contract_title,
        cc.contract_status,
        cc.effective_date,
        cc.expiration_date,
        cc.contract_type,
        cc.document_url,
        cc.base_document_number,
        cc.revision,
        cc.is_primary
      FROM contract_capabilities cc
      WHERE (
             cc.vendor_id = $1
          OR cc.additional_parties @> jsonb_build_array(jsonb_build_object('vendor_id', $1::int))
        )
        AND cc.document_number IS NOT NULL
        AND cc.document_number <> ''
        AND cc.is_primary IS NOT FALSE
    )
    SELECT
      vd.document_number,
      vd.contract_title,
      vd.contract_status,
      vd.effective_date,
      vd.expiration_date,
      vd.contract_type,
      COALESCE(d.document_category, lb_category_for_template(vd.contract_type)) AS category,
      d.template_type,
      d.issue_key,
      COALESCE(d.drive_link, ea.file_link, vd.document_url) AS file_link,
      d.created_at,
      vd.base_document_number,
      COALESCE(vd.revision, 0) AS revision,
      vd.is_primary
    FROM vendor_docs vd
    LEFT JOIN documents d ON d.document_number = vd.document_number
    LEFT JOIN external_assets ea ON ea.asset_number = vd.document_number
    ORDER BY d.created_at DESC NULLS LAST, vd.document_number DESC`;

  const LEGACY_QUERY = `
    WITH vendor_docs AS (
      SELECT DISTINCT
        cc.document_number,
        cc.contract_title,
        cc.contract_status,
        cc.effective_date,
        cc.expiration_date,
        cc.contract_type,
        cc.document_url
      FROM contract_capabilities cc
      WHERE (
             cc.vendor_id = $1
          OR cc.additional_parties @> jsonb_build_array(jsonb_build_object('vendor_id', $1::int))
        )
        AND cc.document_number IS NOT NULL
        AND cc.document_number <> ''
    )
    SELECT
      vd.document_number,
      vd.contract_title,
      vd.contract_status,
      vd.effective_date,
      vd.expiration_date,
      vd.contract_type,
      COALESCE(d.document_category, lb_category_for_template(vd.contract_type)) AS category,
      d.template_type,
      d.issue_key,
      COALESCE(d.drive_link, ea.file_link, vd.document_url) AS file_link,
      d.created_at,
      NULL::text AS base_document_number,
      0 AS revision,
      TRUE AS is_primary
    FROM vendor_docs vd
    LEFT JOIN documents d ON d.document_number = vd.document_number
    LEFT JOIN external_assets ea ON ea.asset_number = vd.document_number
    ORDER BY d.created_at DESC NULLS LAST, vd.document_number DESC`;

  let res: any;
  try {
    res = await query(NEW_QUERY, [vendorId]);
  } catch (err: any) {
    // PostgreSQL undefined_column = 42703。worker 未デプロイの環境で起きる。
    if (err && err.code === "42703") {
      console.warn(
        "[getDocumentsByCategory] is_primary 列が存在しないため legacy query にフォールバック。" +
          "worker サービスを再デプロイして migration を実行してください。"
      );
      res = await query(LEGACY_QUERY, [vendorId]);
    } else {
      throw err;
    }
  }

  const groups: {
    basic: any[];
    individual: any[];
    other: any[];
  } = { basic: [], individual: [], other: [] };

  res.rows.forEach((r: any) => {
    const cat = (r.category || "other") as keyof typeof groups;
    const item = {
      document_number: r.document_number || "",
      contract_title: r.contract_title || "",
      contract_type: r.contract_type || r.template_type || "",
      template_type: r.template_type || r.contract_type || "",
      contract_status: r.contract_status || "",
      effective_date:
        r.effective_date instanceof Date
          ? r.effective_date.toISOString().split("T")[0]
          : r.effective_date || "",
      expiration_date:
        r.expiration_date instanceof Date
          ? r.expiration_date.toISOString().split("T")[0]
          : r.expiration_date || "",
      file_link: r.file_link || "",
      issue_key: r.issue_key || "",
      created_at:
        r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      // Phase 22.12: リビジョン情報も含める
      base_document_number: r.base_document_number || r.document_number || "",
      revision: Number(r.revision) || 0,
      is_primary: r.is_primary !== false,
    };
    (groups[cat] || groups.other).push(item);
  });

  return {
    basic: groups.basic,
    individual: groups.individual,
    other: groups.other,
    total:
      groups.basic.length + groups.individual.length + groups.other.length,
  };
}

export async function getPublicationConditions(vendorId: number) {
  const res = await query(
    `SELECT * FROM contract_capabilities
     WHERE vendor_id = $1 AND record_type = 'publication_condition'`,
    [vendorId]
  );
  return res.rows.map(row => ({
    conditionNumber: row.condition_number || '',
    workName: row.work_name || row.original_work || '',
    media: row.media || '',
    territory: row.territory || '',
    language: row.language || '',
    scope: row.scope || '',
    status: row.contract_status === 'executed' ? '有効' : '終了/確認中',
    documentUrl: row.document_url || ''
  }));
}

function createVendorNotFoundResult(purpose: any) {
  return {
    ok: true,
    counterparty: null,
    masterContracts: null,
    licenseConditions: [],
    publicationConditions: [],
    purposeResult: {
      selected: !!purpose,
      label: purpose?.purpose_label || '未選択',
      judgmentLabel: '取引先が見つかりません',
      recommendedDocumentType: 'legal_review',
      legalReviewRequired: true,
      reasonSummary: '指定された名称で取引先マスタが見つからないため、新規登録または名称確認が必要です。'
    },
    suggestedAction: {
      label: '取引先確認',
      legalReviewRequired: true,
      message: '取引先マスタに登録されている正式名称で再検索するか、法務へ相談してください。'
    }
  };
}

/**
 * Phase 26.8: 取引先マスタの「入力済みの全項目」を counterparty として返す。
 *
 * Slack /法務検索 の結果 (GAS が描画) と /search/vendor 系の Web 詳細ページの
 * 両方で「文書情報だけでなく取引先情報も全件表示」するための共通整形。
 * vendor は vendors テーブルの全カラム (SELECT *) 行。
 */
function buildCounterparty(vendor: any) {
  const toDateStr = (v: any) =>
    v instanceof Date ? v.toISOString().split("T")[0] : v || "";
  return {
    vendorId: vendor.id,
    vendorCode: vendor.vendor_code || "",
    vendorName: vendor.vendor_name || "",
    entityType: vendor.entity_type || "",
    // 名称・識別
    tradeName: vendor.trade_name || "",
    penName: vendor.pen_name || "",
    vendorSuffix: vendor.vendor_suffix || "",
    aliases: vendor.aliases || "",
    corporateNumber: vendor.corporate_number || "",
    invoiceRegistrationNumber: vendor.invoice_registration_number || "",
    isInvoiceIssuer:
      vendor.is_invoice_issuer === null || vendor.is_invoice_issuer === undefined
        ? null
        : !!vendor.is_invoice_issuer,
    withholdingEnabled:
      vendor.withholding_enabled === null || vendor.withholding_enabled === undefined
        ? null
        : !!vendor.withholding_enabled,
    subcontractActApplicable:
      vendor.subcontract_act_applicable === null ||
      vendor.subcontract_act_applicable === undefined
        ? null
        : !!vendor.subcontract_act_applicable,
    // 連絡先
    address: vendor.address || "",
    phone: vendor.phone || "",
    email: vendor.email || "",
    contactDepartment: vendor.contact_department || "",
    contactName: vendor.contact_name || "",
    // 取引・与信
    transactionCategory: vendor.transaction_category || "",
    paymentTerms: vendor.payment_terms || "",
    mainBusiness: vendor.main_business || "",
    capitalYen:
      vendor.capital_yen === null || vendor.capital_yen === undefined
        ? null
        : Number(vendor.capital_yen),
    employeeCount:
      vendor.employee_count === null || vendor.employee_count === undefined
        ? null
        : Number(vendor.employee_count),
    rating: vendor.rating || "",
    antisocialCheckResult: vendor.antisocial_check_result || "",
    // 振込先
    bankName: vendor.bank_name || vendor.bank_info || "",
    branchName: vendor.branch_name || "",
    accountType: vendor.account_type || "",
    accountNumber: vendor.account_number || "",
    accountHolderKana: vendor.account_holder_kana || "",
    // 参照・更新
    masterContractRef: vendor.master_contract_ref || "",
    masterUpdatedAt: toDateStr(vendor.master_updated_at),
  };
}

async function buildContractStatusForVendor(input: ContractCheckInput, vendor: any, purpose: any) {
  const masterContracts = await getMasterContractSummary(vendor.id);
  const licenseConditions = await getLicenseConditions(vendor.id);
  const publicationConditions = await getPublicationConditions(vendor.id);
  // Phase 11: 全文書をカテゴリ別 (基本/個別/その他) にグループ化して返す
  const documentsByCategory = await getDocumentsByCategory(vendor.id);
  const purposeResult = buildPurposeResult(input, masterContracts, purpose);
  const suggestedAction = buildSuggestedAction(masterContracts, purposeResult);

  return {
    ok: true,
    counterparty: buildCounterparty(vendor),
    masterContracts,
    licenseConditions,
    publicationConditions,
    documentsByCategory,
    purposeResult,
    suggestedAction
  };
}

/**
 * Phase 17d: documents に紐付く Backlog issue の status を一括取得。
 * BacklogService を import すると循環参照になるので、ここでは別途
 * 注入する形にする。呼び出し側 (server.ts) で wrap して使う。
 *
 * 渡された issue_keys から status を fetch して { issueKey -> statusName }
 * の map を返す。BACKLOG が無設定 or API エラーのとき空マップ。
 */
export async function fetchBacklogStatuses(
  backlogService: any,
  issueKeys: string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!backlogService) return out;
  for (const key of issueKeys) {
    if (!key || key.startsWith("IMPORT-") || key.startsWith("MANUAL-")) continue;
    try {
      const issue = await backlogService.getIssue(key);
      if (issue?.status?.name) {
        out[key] = issue.status.name;
      }
    } catch {
      // skip unfetchable (404 / network) — keep going
    }
  }
  return out;
}

/**
 * Phase 17c: 稟議番号 (5 桁数字) で文書群を引く。
 * 戻り値は documentsByCategory と同じ shape + ringi 詳細 (title, owner 等)。
 * 法務検索で `00001` のような 5 桁の数字を入れた場合に呼ばれる。
 */
export async function searchByRingiNumber(ringiNumber: string) {
  const ringiRes = await query(
    `SELECT id, ringi_number, title, category, owner_name, owner_department,
            approved_at, backlog_issue_key, status, total_budget, remarks
       FROM ringi_records WHERE ringi_number = $1`,
    [ringiNumber]
  );
  if (ringiRes.rows.length === 0) {
    return { ok: true, ringi: null, documentsByCategory: { basic: [], individual: [], other: [], total: 0 } };
  }
  const ringi = ringiRes.rows[0];
  const docs = await query(
    `SELECT d.id, d.document_number, d.template_type, d.document_category,
            d.issue_key, d.drive_link, d.form_data, d.created_at
       FROM documents d
       JOIN ringi_documents rd ON rd.document_id = d.id
      WHERE rd.ringi_id = $1
      ORDER BY d.created_at DESC`,
    [ringi.id]
  );
  const groups: any = { basic: [], individual: [], other: [] };
  docs.rows.forEach((r: any) => {
    const cat = (r.document_category || "other") as keyof typeof groups;
    const fd = r.form_data || {};
    const item = {
      document_number: r.document_number || "",
      contract_title:
        fd.contract_title ||
        fd.description ||
        fd.basic_contract_name ||
        fd.original_work ||
        "",
      contract_type: r.template_type || "",
      template_type: r.template_type || "",
      contract_status:
        fd.contract_status ||
        (r.drive_link && r.drive_link !== "" ? "executed" : "draft"),
      effective_date:
        fd.effective_date || fd.license_start_date || fd.issue_date || "",
      expiration_date: fd.expiration_date || "",
      file_link: r.drive_link || "",
      issue_key: r.issue_key || "",
      counterparty:
        fd.vendor_name ||
        fd.party_b_name ||
        fd.licensor_name ||
        fd.licensee_name ||
        fd.counterparty ||
        "",
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    };
    (groups[cat] || groups.other).push(item);
  });
  return {
    ok: true,
    ringi: {
      ...ringi,
      approved_at:
        ringi.approved_at instanceof Date
          ? ringi.approved_at.toISOString().split("T")[0]
          : ringi.approved_at || "",
    },
    documentsByCategory: {
      basic: groups.basic,
      individual: groups.individual,
      other: groups.other,
      total: groups.basic.length + groups.individual.length + groups.other.length,
    },
  };
}

export async function searchContractStatus(input: ContractCheckInput) {
  // Phase 17c: 5 桁数字 (= 稟議番号) を最優先で稟議検索にディスパッチ
  const trimmed = (input.counterpartyName || "").trim();
  if (/^[0-9]{5}$/.test(trimmed)) {
    const ringiResult = await searchByRingiNumber(trimmed);
    if (ringiResult.ringi) {
      return {
        ok: true,
        ringiMode: true,
        ringi: ringiResult.ringi,
        documentsByCategory: ringiResult.documentsByCategory,
        purposeResult: {
          selected: false,
          label: `稟議 ${trimmed} の関連文書`,
          judgmentLabel: "",
          recommendedDocumentType: "",
          legalReviewRequired: false,
          reasonSummary: "",
        },
        suggestedAction: {
          label: "稟議検索結果",
          legalReviewRequired: false,
          message: "稟議番号に紐付く文書を表示しています。",
        },
      };
    }
    // 該当稟議なし → 通常 vendor 検索にフォールバック (Counterparty 名と
    // 混同される可能性は低いが念のため)
  }

  const purposeRes = await query(
    `SELECT * FROM contract_purposes WHERE purpose_code = $1`,
    [input.purposeCode]
  );
  const purpose = purposeRes.rows[0];

  if (input.vendorId) {
    const vendor = await findVendorById(input.vendorId);
    if (!vendor) {
      return createVendorNotFoundResult(purpose);
    }

    const result = await buildContractStatusForVendor(input, vendor, purpose);
    await logContractDecision(input, vendor, result);
    return result;
  }

  const vendors = await findVendorsByName(input.counterpartyName, 10);

  if (vendors.length === 0) {
    return createVendorNotFoundResult(purpose);
  }

  if (vendors.length === 1) {
    const vendor = vendors[0];
    const result = await buildContractStatusForVendor(input, vendor, purpose);
    await logContractDecision(input, vendor, result);
    return result;
  }

  const results = await Promise.all(
    vendors.map((vendor) => buildContractStatusForVendor(input, vendor, purpose))
  );

  return {
    ok: true,
    multiple: true,
    count: results.length,
    message: '複数の取引先候補が見つかりました。確認したい候補を選択してください。',
    results
  };
}

function buildPurposeResult(input: ContractCheckInput, masterContracts: any, purpose: any) {
  if (!purpose) {
    return {
      selected: false,
      label: '契約締結状況のみ表示',
      judgmentLabel: '用途未選択',
      recommendedDocumentType: 'none',
      legalReviewRequired: false,
      reasonSummary: '用途が選択されていないため、現在の締結状況のみを表示しています。'
    };
  }

  const res = {
    selected: true,
    label: purpose.purpose_label,
    judgmentLabel: '',
    recommendedDocumentType: purpose.default_document_type,
    legalReviewRequired: purpose.high_risk_flag || false,
    reasonSummary: ''
  };

  const flags = input.additionalFlags || {
    usesIp: false,
    includesSublicense: false,
    includesOverseas: false,
    includesEbook: false,
    includesVideoGame: false,
    unusualPaymentTerms: false
  };

  if (purpose.purpose_code.startsWith('service_')) {
    if (masterContracts.service.exists) {
      res.judgmentLabel = '発注書で進行可能';
      res.reasonSummary = '業務委託基本契約が締結済みであり、発注書で個別条件を定める運用に適合します。';
    } else {
      res.judgmentLabel = '業務委託基本契約の締結または法務確認が必要';
      res.legalReviewRequired = true;
      res.recommendedDocumentType = 'legal_review';
      res.reasonSummary = '基本契約が未締結です。新たに基本契約を締結するか、本件固有の契約書作成について法務へ相談してください。';
    }
  } else if (purpose.purpose_code.startsWith('license_')) {
    if (masterContracts.license.exists) {
      res.judgmentLabel = '個別利用許諾条件書で確認';
      res.reasonSummary = 'ライセンス利用許諾基本契約が締結済みです。基本契約の範囲内であることを確認の上、個別利用許諾条件書（または発注書）を作成してください。';

      if (flags.includesSublicense || flags.includesOverseas) {
        res.legalReviewRequired = true;
        res.judgmentLabel = '再許諾・海外展開を含むため、法務確認を推奨';
        res.reasonSummary += ' ただし、再許諾や海外展開が含まれる場合は基本契約の許諾範囲を超える可能性があるため、法務確認が必要です。';
      }
    } else {
      res.judgmentLabel = 'ライセンス基本契約の締結が必要';
      res.legalReviewRequired = true;
      res.recommendedDocumentType = 'legal_review';
      res.reasonSummary = 'ライセンス利用に関する基本契約（またはマスター契約）が未締結です。';
    }
  } else if (purpose.purpose_code.startsWith('publication_')) {
    res.legalReviewRequired = true;
    res.recommendedDocumentType = 'publication_contract';
    if (purpose.purpose_code === 'publication_video_game') {
      res.judgmentLabel = '法務による個別検討・契約作成が必要';
      res.recommendedDocumentType = 'legal_review';
      res.reasonSummary = '映像化・ゲーム化等の権利処理は複雑なため、必ず法務担当者へ相談してください。';
    } else {
      res.judgmentLabel = '出版契約書の作成が必要';
      res.reasonSummary = '出版許諾基本契約がある場合でも、出版契約は個別案件ごとの調整事項が多いため、原則として契約書案 of 法務レビューを受けてください。';
    }
  } else if (purpose.purpose_code === 'mixed_service_license') {
    res.legalReviewRequired = true;
    res.judgmentLabel = '複合取引のため、法務確認が必要';
    res.reasonSummary = '業務委託とライセンスが混在する取引は、権利帰属や対価構成が複雑になるため法務確認を必須としています。';
  } else {
    res.legalReviewRequired = true;
    res.judgmentLabel = '法務確認を推奨';
    res.reasonSummary = '選択された用途または不明な用途については、法務担当者へ直接相談してください。';
  }

  return res;
}

function buildSuggestedAction(masterContracts: any, purposeResult: any) {
  const res = {
    label: '契約状況の確認結果',
    legalReviewRequired: purposeResult.legalReviewRequired,
    message: ''
  };

  if (purposeResult.legalReviewRequired) {
    res.message = '確認結果に基づき、法務へ詳細を相談してください。Backlogの法務相談チケット起票を推奨します。';
  } else if (purposeResult.recommendedDocumentType === 'purchase_order') {
    res.message = '基本契約に基づき「発注書」を作成・発行してください。';
  } else if (purposeResult.recommendedDocumentType === 'license_condition') {
    res.message = '基本契約に基づき「個別利用許諾条件書」を作成・締結してください。';
  } else {
    res.message = '確認結果に基づき、必要な個別文書を作成してください。';
  }

  return res;
}

export async function logContractDecision(input: ContractCheckInput, vendor: any, result: any) {
  // Extract matched capability IDs (simplified)
  const capabilityIds: number[] = [];
  // Normally we would track which rows were matched, but for now we just log

  const flags = input.additionalFlags || {
    usesIp: false,
    includesSublicense: false,
    includesOverseas: false,
    includesEbook: false,
    includesVideoGame: false,
    unusualPaymentTerms: false
  };

  try {
    await query(
      `INSERT INTO contract_decision_logs
       (counterparty_name_input, vendor_id, purpose_code, work_name, product_name, territory, language, additional_flags, result_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.counterpartyName,
        vendor.id,
        input.purposeCode,
        input.workName,
        input.productName,
        input.territory,
        input.language,
        JSON.stringify(flags),
        JSON.stringify(result)
      ]
    );
  } catch (err) {
    console.error('Failed to log contract decision:', err);
  }
}

