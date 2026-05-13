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

export async function findVendorsByName(counterpartyName: string, limit: number = 10) {
  const normalized = normalizeName(counterpartyName);
  if (!normalized) return [];

  const exactValue = counterpartyName;
  const rawLike = `%${counterpartyName}%`;
  const normalizedLike = `%${normalized}%`;

  const res = await query(
    `SELECT *
       FROM (
         SELECT
           v.*,
           CASE
             WHEN v.vendor_name ILIKE $1 THEN 0
             WHEN v.trade_name ILIKE $1 THEN 0
             WHEN v.pen_name ILIKE $1 THEN 0
             WHEN v.aliases ILIKE $1 THEN 0
             WHEN v.vendor_code ILIKE $1 THEN 0
             WHEN v.vendor_name ILIKE $2 THEN 1
             WHEN v.trade_name ILIKE $2 THEN 1
             WHEN v.pen_name ILIKE $2 THEN 1
             WHEN v.aliases ILIKE $2 THEN 1
             WHEN v.vendor_code ILIKE $2 THEN 1
             WHEN v.vendor_name ILIKE $3 THEN 2
             WHEN v.trade_name ILIKE $3 THEN 2
             WHEN v.pen_name ILIKE $3 THEN 2
             WHEN v.aliases ILIKE $3 THEN 2
             ELSE 9
           END AS match_priority
         FROM vendors v
         WHERE v.vendor_name ILIKE $1
            OR v.trade_name ILIKE $1
            OR v.pen_name ILIKE $1
            OR v.aliases ILIKE $1
            OR v.vendor_code ILIKE $1
            OR v.vendor_name ILIKE $2
            OR v.trade_name ILIKE $2
            OR v.pen_name ILIKE $2
            OR v.aliases ILIKE $2
            OR v.vendor_code ILIKE $2
            OR v.vendor_name ILIKE $3
            OR v.trade_name ILIKE $3
            OR v.pen_name ILIKE $3
            OR v.aliases ILIKE $3
       ) matched
      ORDER BY match_priority ASC, vendor_name ASC, id ASC
      LIMIT $4`,
    [exactValue, rawLike, normalizedLike, limit]
  );

  return dedupeVendorsById(res.rows).slice(0, limit);
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
  const res = await query(
    `WITH vendor_docs AS (
       SELECT DISTINCT
         cc.document_number,
         cc.contract_title,
         cc.contract_status,
         cc.effective_date,
         cc.expiration_date,
         cc.contract_type,
         cc.document_url
       FROM contract_capabilities cc
       WHERE cc.vendor_id = $1
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
       d.created_at
     FROM vendor_docs vd
     LEFT JOIN documents d ON d.document_number = vd.document_number
     LEFT JOIN external_assets ea ON ea.asset_number = vd.document_number
     ORDER BY d.created_at DESC NULLS LAST, vd.document_number DESC`,
    [vendorId]
  );

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
    counterparty: {
      vendorId: vendor.id,
      vendorCode: vendor.vendor_code,
      vendorName: vendor.vendor_name,
      entityType: vendor.entity_type
    },
    masterContracts,
    licenseConditions,
    publicationConditions,
    documentsByCategory,
    purposeResult,
    suggestedAction
  };
}

export async function searchContractStatus(input: ContractCheckInput) {
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

