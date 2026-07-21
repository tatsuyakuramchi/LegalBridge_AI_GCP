import pg from 'pg';
import { createHash } from 'node:crypto';

import { normalizeGenre, normalizeRole, coreGenreForDivision } from './materialVocab.ts';

/**
 * 文書の「内容ハッシュ」。重複保存の検出に使う。
 * __ で始まる制御フィールド(__reopen_doc_number 等)は除外し、キーを
 * ソートして安定化したうえで template_type と結合して sha256。
 */
export function computeFormContentHash(
  formData: Record<string, any> | null | undefined,
  templateType: string
): string {
  const clean: Record<string, any> = {};
  for (const k of Object.keys(formData || {}).sort()) {
    if (k.startsWith('__')) continue;
    clean[k] = (formData as any)[k];
  }
  return createHash('sha256')
    .update(String(templateType || '') + '\n' + JSON.stringify(clean))
    .digest('hex');
}

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === 'production';

// Cloud SQL connection configuration
const poolConfig = process.env.DATABASE_URL 
  ? { 
      connectionString: process.env.DATABASE_URL,
      // For some hosted DBs, SSL might be required. 
      // This is a safe default for many cloud providers.
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
    }
  : {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      // If running on Cloud Run, connect via Unix socket
      host: isProduction && process.env.INSTANCE_CONNECTION_NAME ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` : process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };

if (!process.env.DATABASE_URL && !process.env.DB_HOST && !process.env.INSTANCE_CONNECTION_NAME) {
  console.warn('⚠️ No database configuration found. Please set DATABASE_URL or DB_* environment variables in the Settings menu.');
}

export const pool = new Pool(poolConfig);

export async function query(text: string, params?: any[]) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

// Phase 7: 旧 initDb() (起動時レガシー DDL) は撤去した。スキーマは migrations/ が単一所有する。
//   0101 以降 contract_capabilities は VIEW のため、旧 ALTER TABLE 群は実行するとエラーになる死コードだった。

export async function getNextSequenceValue(kind: string, year: number): Promise<number> {
  const res = await query(
    `INSERT INTO document_sequences (kind, year, current_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (kind, year)
     DO UPDATE SET current_value = document_sequences.current_value + 1
     RETURNING current_value`,
    [kind, year]
  );
  return res.rows[0].current_value;
}

/**
 * Phase 17k: ARC umbrella + 文書種別 prefix + 年 + 連番 の 4 セグメント形式。
 *
 *   ARC-<TYPE>-<YEAR>-<NNNN>
 *   例:  ARC-PO-2026-0001   (発注書)
 *        ARC-NDA-2026-0001  (NDA)
 *        ARC-LIC-2026-0001  (ライセンス基本契約)
 *
 * 連番は (prefix, year) を sequence kind として、文書種別ごとに独立。
 * 文書種別 prefix は以下の優先順で決定:
 *   1. workflow_settings.document_prefix (issueTypeName で検索)
 *   2. typeCodes mapping (テンプレ type 名 / issueTypeName のどちらでもヒット)
 *   3. type.toUpperCase().substring(0, 3) フォールバック
 */
export async function getNewDocumentNumber(type: string, issueTypeName?: string): Promise<string> {
  let prefix = "";

  if (issueTypeName) {
    const wsResult = await query("SELECT document_prefix FROM workflow_settings WHERE issue_type_name = $1", [issueTypeName]);
    if (wsResult.rows[0]?.document_prefix) {
      prefix = wsResult.rows[0].document_prefix;
    }
  }

  if (!prefix) {
    // テンプレ type 名 / Backlog issueType.name どちらでもヒットするよう
    // 両方向のキーを登録する。
    // Phase 22.21.82: 削除済みテンプレ (planning_purchase_order /
    //   inspection_certificate_v2 / inspection_certificate_detailed /
    //   license_report / intl_master / intl_amendment / payment_notice /
    //   payment_notice_alt / fee_statement / service_terms / contract)
    //   を typeCodes から除去。
    // Phase 22.21.83: legal_response (LGR) と maintenance_spec (MNT) を追加。
    const typeCodes: Record<string, string> = {
      // 発注系
      purchase_order: "PO",
      intl_purchase_order: "IPO",
      "発注書": "PO",
      // 検収系
      inspection_certificate: "INS",
      delivery_inspec: "INS",
      "検収書": "INS",
      // ライセンス系
      license_master: "LIC",
      lic_individual: "ILT",
      individual_license_terms: "ILT",
      license_calculation_sheet: "LCS",
      "ライセンス基本契約": "LIC",
      "個別利用許諾条件": "ILT",
      // ロイヤリティ / 支払
      royalty_statement: "ROY",
      manufacturing: "MFG",
      "利用許諾料計算書": "ROY",
      // 業務委託
      service_master: "SVC",
      outsourcing: "OUT",
      "業務委託基本契約": "SVC",
      // 出版 (Phase 25 / 25.6): 基本契約=PUB / 利用許諾条件書=PUBT / 追加利用許諾条件書=PUBA
      //   search-api の typeCodes と同一仕様。publication_contract は legalon import 用。
      pub_master_individual: "PUB",
      pub_master_corporate: "PUB",
      publication_contract: "PUB",
      "出版等許諾基本契約": "PUB",
      "出版基本契約": "PUB",
      pub_license_terms: "PUBT",
      "出版等利用許諾条件書": "PUBT",
      pub_additional_terms: "PUBA",
      "追加利用許諾条件書": "PUBA",
      // 再許諾/アウトライセンス条件書(当社が受け取る sublicense_out)
      sublicense_out_terms: "SLO",
      "再許諾条件書": "SLO",
      // 売買
      sales_master: "SAL",
      sales_master_buyer: "SAL",
      sales_master_credit: "SAL",
      sales_master_standard: "SAL",
      "売買基本契約": "SAL",
      // 別紙 (保守仕様書)
      maintenance_spec: "MNT",
      "システム保守仕様書": "MNT",
      // 法務回答 (Phase 22.21.83 → 22.21.84: ユーザー提供デザインに合わせ
      //   prefix を LGR から LG に短縮。"No. LG-2026-NNNN" 形式で表示。)
      legal_response: "LG",
      "法務回答書": "LG",
      legal_consult: "LG",
      "法務相談": "LG",
      "事務手続": "LG",
      // 通知・同意 (個人情報取得 通知・同意書) → ARC-PR-YYYY-NNNN
      notice_consent_personal_info_freelance: "PR",
      "個人情報取得 通知・同意書": "PR",
      // その他
      nda: "NDA",
      "NDA": "NDA",
      external_contract: "ARC",
    };
    prefix =
      typeCodes[type] ||
      (issueTypeName ? typeCodes[issueTypeName] : "") ||
      type.toUpperCase().substring(0, 3);
  }

  const year = new Date().getFullYear();

  // Phase 17k: 文書種別ごとに独立した連番。sequence kind = prefix なので
  //   PO は PO の連番、NDA は NDA の連番 ... と完全分離。年が変わると
  //   各 prefix のカウンタが個別にリセットされる。
  const val = await getNextSequenceValue(prefix, year);

  return `ARC-${prefix}-${year}-${val.toString().padStart(4, "0")}`;
}

/**
 * Phase 22.12: 「真の契約」マーク管理。
 *
 * 指定 base に属する全ドキュメント (documents + contract_capabilities) を対象に、
 * targetDocNumber のみ is_primary=TRUE、それ以外は is_primary=FALSE + superseded_by=target
 * に書き換える。
 *
 * 用途:
 *   - 新リビジョン生成時: 自動的に最新を真の契約に格上げ
 *   - ユーザーが Archive UI から手動で旧版を真の契約に戻す (override)
 */
/**
 * Phase 22.18 / 採番統一(§9.3): 原作 (ledgers) の ledger_code 自動採番。
 *
 * 形式: LO-{YYYY}-{NNNN} (例: LO-2026-0001)
 *
 * 採番ロジック: **ledgers ∪ works の当年 LO 最大 +1** から導出する。
 *   旧実装は document_sequences(kind="LO") の独立カウンタだったが、api 側
 *   (POST /api/v3/source-ips) は ledgers∪works の max+1 で LO を振るため、
 *   両系統が同一 LO 番号を二重採番しうる問題があった(移行0075も max+1)。
 *   両者を同一の実コード由来ロジックに揃え、系統間衝突を構造的に解消する。
 *   (残: 同時 INSERT の競合は ledger_code/work_code の UNIQUE 制約で検出。)
 */
export async function getNewLedgerCode(year?: number): Promise<string> {
  const y = year || new Date().getFullYear();
  const res = await query(
    `SELECT COALESCE(MAX(
              CASE WHEN code ~ ('^LO-' || $1 || '-[0-9]+$')
                   THEN split_part(code, '-', 3)::int ELSE 0 END), 0) + 1 AS n
       FROM (SELECT ledger_code AS code FROM ledgers
             UNION ALL SELECT work_code AS code FROM works) c`,
    [String(y)]
  );
  const n: number = res.rows[0]?.n ?? 1;
  return `LO-${y}-${n.toString().padStart(4, "0")}`;
}

/**
 * Phase 22.18: WorkID (license_contracts.work_id) の自動採番。
 *
 * 形式: LIC-{ledger_code}-W-{YYYY}-{NNNN}
 *   例: LIC-LO-2026-0001-W-2026-0001
 *
 * 連番カウンタは **原作 (ledger_code) 単位で独立**。
 * document_sequences に kind=`W_${ledger_code}` / year=YYYY で連番。
 *
 * これにより:
 *   - LO-2026-0001 配下: LIC-LO-2026-0001-W-2026-0001, 0002, ...
 *   - LO-2026-0002 配下: LIC-LO-2026-0002-W-2026-0001, 0002, ...
 * となり「シリーズ何作目?」が即わかる識別子になる。
 */
export async function getNewWorkId(
  ledgerCode: string,
  year?: number
): Promise<string> {
  if (!ledgerCode) throw new Error("ledgerCode is required");
  const y = year || new Date().getFullYear();
  const kind = `W_${ledgerCode}`;
  const val = await getNextSequenceValue(kind, y);
  return `LIC-${ledgerCode}-W-${y}-${val.toString().padStart(4, "0")}`;
}

/**
 * データ構造刷新 Phase B-6: 条件明細の公開採番 line_code。
 *
 * 形式 (仮決め / ⚠ Q1): CL-{YYYY}-{NNNNN}
 *   契約再発行・契約改版で番号が変わらないことが要件のため、契約番号従属では
 *   なく **独立採番**。document_sequences に kind='condition_line' / year=YYYY。
 */
export async function issueConditionLineCode(year?: number): Promise<string> {
  const y = year || new Date().getFullYear();
  const val = await getNextSequenceValue("condition_line", y);
  return `CL-${y}-${val.toString().padStart(5, "0")}`;
}

/**
 * データ構造刷新 Phase B-6: 作品マスター works.work_code の採番。
 *
 * 形式 (仮決め / ⚠ Q2): WK-{YYYY}-{NNNN}
 *   document_sequences に kind='work' / year=YYYY で独立採番。
 *   (既存の getNewWorkId = license_contracts.work_id とは別概念)
 */
export async function issueWorkCode(year?: number): Promise<string> {
  const y = year || new Date().getFullYear();
  const val = await getNextSequenceValue("work", y);
  return `WK-${y}-${val.toString().padStart(4, "0")}`;
}

/**
 * Phase 22.21.52: ILT (個別利用許諾条件書 + 単独契約) の原作ベース採番。
 *
 * 形式: LIC-{ledger_code}-ILT-{NNNN}
 *   例: LIC-LO-2026-0001-ILT-0001
 *
 * 連番は **原作 (ledger_code) 単位で通算**。年単位ではリセットしない
 * (作品ライフタイムを通じた連番。getNewWorkId と違う設計判断)。
 *
 * 用途:
 *   - contract_capabilities で record_type='individual_contract' /
 *     'standalone_contract' / 'license_condition' かつ
 *     contract_category='license' かつ ledger_code 紐付け済み のレコード。
 *
 * document_sequences の (kind, year) PK 制約があるため、年でリセットしない
 * 場合は year=0 を sentinel として使う。
 */
export async function getNewIltNumberForLedger(
  ledgerCode: string
): Promise<string> {
  if (!ledgerCode) throw new Error("ledgerCode is required for ILT numbering");
  const kind = `ILT_${ledgerCode}`;
  const val = await getNextSequenceValue(kind, 0);
  return `LIC-${ledgerCode}-ILT-${val.toString().padStart(4, "0")}`;
}

/**
 * Phase 22.18: 素材 (materials) の枝番自動採番。
 *
 * 指定 ledger_id 配下の MAX(material_no) + 1 を返す。
 * 原作マスター登録時に最初に -001 (原作本体) を立てるので、
 * 派生素材は -002, -003, ... と進む。
 */
// Category 昇格(2): (work_id, genre) のカテゴリを get-or-create し id を返す。
//   素材→カテゴリは genre から自動導出。genre 空なら null。
const GENRE_SORT: Record<string, number> = {
  game_design: 0, manuscript: 1, illustration: 2, graphic_design: 3, scenario: 4,
  music: 5, translation: 6, editing: 7, text: 8, data: 9, other: 99,
};
export async function ensureMaterialCategory(
  workId: number, genre: string | null | undefined
): Promise<number | null> {
  const g = String(genre ?? "").trim();
  if (!workId || !g) return null;
  const r = await query(
    `INSERT INTO material_categories (work_id, genre, sort_order)
       VALUES ($1, $2, $3)
     ON CONFLICT (work_id, genre) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [workId, g, GENRE_SORT[g.toLowerCase()] ?? 99]
  );
  return r.rows[0]?.id ? Number(r.rows[0].id) : null;
}

/**
 * WM-01 Phase A′ (dual-resolve): 原作(licensed_in)の識別子を works へ解決する。
 *   入力 id は ledgers.id ∪ works.id の両方を受け付ける（後方互換）。
 *   - まず works.id として解決（新: /api/master/ledgers list が works.id を返す場合）。
 *   - 見つからなければ ledgers.id → ledger_code=work_code で works へブリッジ（旧: ledgers.id）。
 *   これにより list の id 空間を works.id へ切り替えても素材 write が壊れない。
 */
export async function resolveLicensedInWork(
  id: number
): Promise<{ work_id: number; ledger_code: string } | null> {
  const w = await query(
    `SELECT id AS work_id, work_code AS ledger_code
       FROM works WHERE id = $1 AND kind = 'licensed_in'`,
    [id]
  );
  if (w.rows[0]) return { work_id: Number(w.rows[0].work_id), ledger_code: w.rows[0].ledger_code };
  const l = await query(
    `SELECT w.id AS work_id, w.work_code AS ledger_code
       FROM ledgers l
       JOIN works w ON w.work_code = l.ledger_code AND w.kind = 'licensed_in'
      WHERE l.id = $1`,
    [id]
  );
  if (l.rows[0]) return { work_id: Number(l.rows[0].work_id), ledger_code: l.rows[0].ledger_code };
  return null;
}

/**
 * WM-01 Phase B: documents.ledger_ref_id 等の「保存済み FK」から原作を解決する。
 *   ledger_ref_id の id 空間は歴史的に混在している:
 *     - 旧データ: ledgers.id（レガシー・正準の FK）
 *     - 新規/フォールバック: works.id（documentSave の `?? origWorkId`、
 *                            および原作一覧 API を works 由来へ切替えた後の選択 id）
 *   スタブ ledgers 行は ledger_code で紐付くだけで id は works.id と別番のため、
 *   works.id の ledger_ref_id は `WHERE ledgers.id=$1` では空振りしていた（silent degrade）。
 *
 *   ここでは「ledgers.id 優先 → works.id フォールバック」で解決する。この順序は:
 *     - 旧 ledgers.id を従来どおり正しい ledger_code に解決する（挙動不変）。
 *     - works.id（ledgers 行を持たない新規）を初めて正しく解決する（バグ修正）。
 *   なお素材 write 系（新一覧 id = works.id 由来）は works 優先の
 *   resolveLicensedInWork を使うこと（id の出所で優先順を使い分ける）。
 */
export async function resolveLedgerRef(
  id: number
): Promise<{ work_id: number | null; ledger_code: string; title: string | null } | null> {
  // 1) レガシー正準: ledgers.id → ledger_code（works があれば work_id/title も同時解決）
  const l = await query(
    `SELECT l.ledger_code AS ledger_code,
            COALESCE(w.title, l.title) AS title,
            w.id AS work_id
       FROM ledgers l
       LEFT JOIN works w ON w.work_code = l.ledger_code AND w.kind = 'licensed_in'
      WHERE l.id = $1`,
    [id]
  );
  if (l.rows[0]) {
    return {
      work_id: l.rows[0].work_id != null ? Number(l.rows[0].work_id) : null,
      ledger_code: l.rows[0].ledger_code,
      title: l.rows[0].title ?? null,
    };
  }
  // 2) 新規/フォールバック: works.id（ledgers 行が無いケースのみここへ到達）
  const w = await query(
    `SELECT id AS work_id, work_code AS ledger_code, title
       FROM works WHERE id = $1 AND kind = 'licensed_in'`,
    [id]
  );
  if (w.rows[0]) {
    return {
      work_id: Number(w.rows[0].work_id),
      ledger_code: w.rows[0].ledger_code,
      title: w.rows[0].title ?? null,
    };
  }
  return null;
}

export async function getNextMaterialNo(ledgerId: number): Promise<number> {
  // マテリアル一本化(0089/0090): 正準表 work_materials の枝番を採番。
  //   WM-01 Phase A′: ledgers.id ∪ works.id の両対応で works を解決してから枝番採番。
  const resolved = await resolveLicensedInWork(ledgerId);
  if (!resolved) return 1;
  const res = await query(
    `SELECT COALESCE(MAX(wm.material_no), 0) + 1 AS next
       FROM work_materials wm
      WHERE wm.work_id = $1`,
    [resolved.work_id]
  );
  return Number(res.rows[0].next) || 1;
}

/**
 * Phase 22.18: 原作マスター登録 + 自動で原作本体素材 (-001) を作成する一括ヘルパー。
 *
 * @param payload 原作の属性 (title 必須, kana / publisher など任意)
 * @returns 作成された ledger 行 (id, ledger_code, ...) + デフォルト素材
 */
export async function createLedgerWithDefaultMaterial(payload: {
  title: string;
  title_kana?: string;
  alternative_titles?: string[];
  creator_name?: string;
  publisher_name?: string;
  remarks?: string;
  ledger_code?: string; // 手動指定時 (legacy 移行等)
  // Phase 22.20: 原作デフォルト値
  default_rights_holder?: string;
  default_credit_display?: string;
  default_work_supplement?: string;
  // Phase 22.21.7: 承認条件 / 承認時期 デフォルト
  default_approval_target?: string;
  default_approval_timing?: string;
  // Phase 26: 事業部タグ (BDG / PUB)。未指定なら ['BDG'] で初期化 (従来運用に合わせる)。
  division?: string[];
}): Promise<{
  id: number;
  ledger_code: string;
  default_material_id: number;
  default_material_code: string;
}> {
  const ledgerCode = payload.ledger_code || (await getNewLedgerCode());
  const division =
    Array.isArray(payload.division) && payload.division.length > 0
      ? payload.division
      : ["BDG"];
  const ledgerRes = await query(
    `INSERT INTO ledgers (
       ledger_code, title, title_kana, alternative_titles,
       creator_name, publisher_name, remarks,
       default_rights_holder, default_credit_display, default_work_supplement,
       default_approval_target, default_approval_timing, division
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, ledger_code`,
    [
      ledgerCode,
      payload.title,
      payload.title_kana || null,
      payload.alternative_titles || [],
      payload.creator_name || null,
      payload.publisher_name || null,
      payload.remarks || null,
      payload.default_rights_holder || null,
      payload.default_credit_display || null,
      payload.default_work_supplement || null,
      payload.default_approval_target || null,
      payload.default_approval_timing || null,
      division,
    ]
  );
  const ledgerId = Number(ledgerRes.rows[0].id);

  // マテリアル一本化(0089/0090): 原作の正本 works(licensed_in) を作成/更新し、
  //   原作本体素材(-001)は正準表 work_materials に立てる(materials 表は廃止)。
  //   work_code = ledger_code で ledgers と紐付く。works/素材作成は必須経路(best-effort では無い)。
  const wk = await query(
    `INSERT INTO works (work_code, title, title_kana, alternative_titles, kind, is_original,
        original_publisher, default_rights_holder, default_credit_display, default_work_supplement,
        default_approval_target, default_approval_timing, remarks, division, is_active)
     VALUES ($1,$2,$3,$4,'licensed_in',FALSE,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)
     ON CONFLICT (work_code) DO UPDATE SET
        title=EXCLUDED.title, title_kana=EXCLUDED.title_kana,
        default_rights_holder=EXCLUDED.default_rights_holder,
        default_credit_display=EXCLUDED.default_credit_display,
        default_work_supplement=EXCLUDED.default_work_supplement,
        default_approval_target=EXCLUDED.default_approval_target,
        default_approval_timing=EXCLUDED.default_approval_timing,
        updated_at=now()
     RETURNING id`,
    [
      ledgerCode, payload.title, payload.title_kana || null, payload.alternative_titles || [],
      payload.publisher_name || null, payload.default_rights_holder || null,
      payload.default_credit_display || null, payload.default_work_supplement || null,
      payload.default_approval_target || null, payload.default_approval_timing || null,
      payload.remarks || null, division,
    ]
  );
  const workId = Number(wk.rows[0].id);

  // 原作本体素材 (-001) = メイン作品(core_logic)。material_code で冪等。
  // O5: ジャンルは事業部(division)で確定(PUB→執筆文書 / それ以外→ゲームデザイン)。
  // Phase 22.20: 素材権利者を ledger.default_rights_holder で初期化
  const defaultMaterialCode = `${ledgerCode}-001`;
  const coreGenre = coreGenreForDivision(division);
  // Category(2): 本体ジャンルのカテゴリを get-or-create し -001 に紐付け。
  const coreCategoryId = await ensureMaterialCategory(workId, coreGenre);
  const matRes = await query(
    `INSERT INTO work_materials (
       work_id, material_no, material_code, material_name,
       material_type, rights_holder_label, is_default, material_role, acquisition_type, category_id
     ) VALUES ($1, 1, $2, $3, $5, $4, TRUE, 'core_logic', 'license', $6)
     ON CONFLICT (material_code) WHERE material_code IS NOT NULL DO UPDATE SET
       material_name = EXCLUDED.material_name, category_id = EXCLUDED.category_id, updated_at = now()
     RETURNING id, material_code`,
    [
      workId,
      defaultMaterialCode,
      payload.title,
      payload.default_rights_holder || null,
      coreGenre,
      coreCategoryId,
    ]
  );

  return {
    id: ledgerId,
    ledger_code: ledgerCode,
    default_material_id: Number(matRes.rows[0].id),
    default_material_code: matRes.rows[0].material_code,
  };
}

/**
 * Phase 22.18: 原作配下に派生素材を追加する一括ヘルパー。
 *
 * @returns 作成された material 行
 */
export async function addMaterialToLedger(payload: {
  ledger_id: number;
  material_name: string;
  material_type?: string;
  rights_holder?: string;
  remarks?: string;
  territory?: string;
  language?: string;
}): Promise<{ id: number; material_code: string; material_no: number }> {
  // マテリアル一本化(0089/0090): 台帳 → 正本 works(licensed_in) を解決し、
  //   派生素材は正準表 work_materials に直接追加する(materials 表は廃止)。
  //   WM-01 Phase A′: ledger_id は ledgers.id ∪ works.id の両対応で解決する。
  const resolved = await resolveLicensedInWork(payload.ledger_id);
  if (!resolved) {
    throw new Error(`ledger ${payload.ledger_id} (works licensed_in) not found`);
  }
  const ledgerCode = resolved.ledger_code;
  const workId = resolved.work_id;
  // B系(T1): 同作品内で同名(正規化一致)の素材が既にあれば新規作成せず既存を返す(重複防止)。
  //   lb_norm_name 欠如時は fail-open(従来通り新規追加)。
  try {
    const dup = await query(
      `SELECT id, material_code, material_no FROM work_materials
        WHERE work_id = $1 AND lb_norm_name(material_name) = lb_norm_name($2)
        ORDER BY id LIMIT 1`,
      [workId, payload.material_name]
    );
    if (dup.rows[0]) {
      return {
        id: Number(dup.rows[0].id),
        material_code: dup.rows[0].material_code,
        material_no: Number(dup.rows[0].material_no),
      };
    }
  } catch (e) {
    console.warn("[addMaterialToLedger dedup] skipped:", e);
  }
  const nextNo = await getNextMaterialNo(payload.ledger_id);
  const materialCode = `${ledgerCode}-${nextNo.toString().padStart(3, "0")}`;
  // O5: ジャンルを正準化し、役割(本体/サブ)を推定。
  const matType = normalizeGenre(payload.material_type);
  const role = normalizeRole(undefined, matType, false);
  // Category(2): genre のカテゴリを get-or-create し紐付け。
  const categoryId = await ensureMaterialCategory(workId, matType);
  // acquisition_type は JS 側で算出して別パラメータにする。以前は
  //   CASE WHEN $5 = 'original' … で $5(material_type)を列値と比較の2文脈で使い回し、
  //   PostgreSQL が $5 の型を別々に推論して "inconsistent types deduced for parameter $5"
  //   で 500 になっていた。二重使用を解消する。
  const acquisitionType = matType === "original" ? "license" : null;
  const res = await query(
    `INSERT INTO work_materials (
       work_id, material_no, material_code, material_name,
       material_type, rights_holder_label, remarks, is_default, material_role,
       acquisition_type, category_id, territory, language
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8, $9, $10, $11, $12)
     RETURNING id, material_code, material_no`,
    [
      workId,
      nextNo,
      materialCode,
      payload.material_name,
      matType,
      payload.rights_holder || null,
      payload.remarks || null,
      role,
      acquisitionType,
      categoryId,
      payload.territory || null,
      payload.language || null,
    ]
  );
  return {
    id: Number(res.rows[0].id),
    material_code: res.rows[0].material_code,
    material_no: Number(res.rows[0].material_no),
  };
}

/**
 * Phase 22.17: 台帳ID (license_contracts.ledger_id) の自動採番。
 *
 * 形式: LIC-{YYYY}-{NNNN}  (例: LIC-2026-0001)
 *
 * document_number (ARC-LIC-2026-NNNN) とは独立した連番。
 * 同じ Backlog 課題で複数 PO 発行しても document_number は別々に増えるが、
 * 台帳ID は 1 ライセンス契約 (license_contracts 行) に対して 1 つ固定。
 * document_sequences テーブルに kind='LEDGER' / year=YYYY で連番を持つ。
 */
export async function getNewLedgerId(year?: number): Promise<string> {
  const y = year || new Date().getFullYear();
  const val = await getNextSequenceValue("LEDGER", y);
  return `LIC-${y}-${val.toString().padStart(4, "0")}`;
}

export async function markPrimaryDocument(
  baseDocumentNumber: string,
  targetDocNumber: string
): Promise<void> {
  if (!baseDocumentNumber || !targetDocNumber) return;
  // documents 側を一括更新
  await query(
    `UPDATE documents
        SET is_primary    = (document_number = $2),
            superseded_by = CASE WHEN document_number = $2 THEN NULL ELSE $2 END
      WHERE base_document_number = $1`,
    [baseDocumentNumber, targetDocNumber]
  );
  // contract_capabilities 側も同期 (検索一覧フィルタ用)。
  // 旧データで base_document_number が未設定の row もカバーするため
  // documents JOIN もチェックする。
  await query(
    `UPDATE documents
        SET is_primary    = (document_number = $2),
            superseded_by = CASE WHEN document_number = $2 THEN NULL ELSE $2 END,
            updated_at    = CURRENT_TIMESTAMP
      WHERE base_document_number = $1
         OR document_number IN (
              SELECT document_number FROM documents WHERE base_document_number = $1
            )`,
    [baseDocumentNumber, targetDocNumber]
  );
}

/**
 * Phase 22.10 (改 Phase 22.11.1 / 改 Phase 23.1): 文書番号採番 + リビジョン管理。
 *
 * 採番ルール:
 *   ① existingDocumentNumber が渡されなかった場合 = 完全新規
 *        → 毎回新しい番号を採番 (PO-0001, PO-0002, ...)
 *          同じ Backlog 課題で複数 PO を発行する正常ケースをサポート
 *   ② existingDocumentNumber 渡し + その既存ドキュメントが
 *      drive_link 空 = 未完成 draft → そのまま同番号で完成
 *        (旧 Phase 15: PDF 未作成キュー由来の draft 完成)
 *   ③ existingDocumentNumber 渡し + drive_link 入り + reissue=false (default)
 *      = 完成済を内部修正 (上書き)
 *        → 同じ document_number / revision / base のまま (overwrite=true で返す)
 *          (Phase 23.1: 既定動作。caller 側で UPDATE で同 row を上書きし、
 *           Drive PDF も同 fileId で content 差し替え)
 *   ④ existingDocumentNumber 渡し + drive_link 入り + reissue=true
 *      = 完成済を外部要請で再発行
 *        → base を共有しつつ revision を +1 して "_NNN" サフィックス付与
 *          (Phase 23.1: 明示的 reissue=true でのみ発動。caller 側で過去 row を
 *           lifecycle_status='reissued' に倒し、新 row を挿入する)
 *
 * 旧 Phase 22.10 にあった「同 issue_key + 同 template_type の既存 doc を見て
 * 自動的に再発行扱い」ロジックは撤廃済。同一取引先・同一 issueKey で
 * 別 PO を発行する正常ユースケースを破壊しないため、リビジョンは
 * 「ユーザーが reopen して "再発行" を明示選択した」場合のみ発火する。
 *
 * 返り値:
 *   documentNumber:      実際に発行/更新する番号
 *   baseDocumentNumber:  初版番号 (リビジョンを跨ぐ共通キー)
 *   revision:            0=初版 / 1,2,... = 再発行版
 *   isReissue:           true なら再発行 (Rev. ≥ 1、新規 row 挿入が必要)
 *   overwrite:           true なら既存 row を UPDATE で上書き (Phase 23.1 新設)
 *                        — INSERT ではなく UPDATE で同 row を更新し、Drive PDF も
 *                        既存 fileId に content を差し替える経路を caller に伝える
 */
/**
 * 「同一文書とみなせる既存の正本(is_primary かつ lifecycle=final)」を 1 件返す。
 * 判定: 同 template_type かつ ( 同 issue_key(MANUAL- と空は除外) OR content_hash 一致 )。
 * content_hash 列が無い環境(0017 未適用)では起票×種別のみで判定(graceful)。
 */
async function findExistingPrimaryDocument(
  issueKey: string,
  templateType: string,
  contentHash?: string
): Promise<{ document_number: string; base_document_number: string; revision: number } | null> {
  const ik = (issueKey || '').trim();
  const issueUsable = ik !== '' && !ik.startsWith('MANUAL-');
  // 起票でもハッシュでも引けない場合は判定しない。
  if (!issueUsable && !contentHash) return null;

  const withHash = `
    SELECT document_number, base_document_number, revision
      FROM documents
     WHERE is_primary = TRUE
       AND COALESCE(lifecycle_status, 'final') = 'final'
       AND template_type = $2::text
       AND (
         ($1::text <> '' AND issue_key = $1::text)
         OR ($3::text IS NOT NULL AND content_hash = $3::text)
       )
     ORDER BY revision DESC, created_at DESC
     LIMIT 1`;
  const noHash = `
    SELECT document_number, base_document_number, revision
      FROM documents
     WHERE is_primary = TRUE
       AND COALESCE(lifecycle_status, 'final') = 'final'
       AND template_type = $2::text
       AND $1::text <> '' AND issue_key = $1::text
     ORDER BY revision DESC, created_at DESC
     LIMIT 1`;

  try {
    const r = await query(withHash, [issueUsable ? ik : '', templateType, contentHash || null]);
    return r.rows[0] || null;
  } catch (err: any) {
    if (err && err.code === '42703') {
      // content_hash 未追加 → 起票×種別のみ
      if (!issueUsable) return null;
      const r = await query(noHash, [ik, templateType]);
      return r.rows[0] || null;
    }
    throw err;
  }
}

export async function getDocumentNumberForGenerate(opts: {
  issueKey: string;
  templateType: string;
  issueTypeName?: string;
  existingDocumentNumber?: string;
  /** Phase 23.1: 外部要請の再発行フラグ。true なら revision+1 で別 row 採番。 */
  reissue?: boolean;
  /** 重複検出用の内容ハッシュ(computeFormContentHash)。Case① の再利用判定に使う。 */
  contentHash?: string;
}): Promise<{
  documentNumber: string;
  baseDocumentNumber: string;
  revision: number;
  isReissue: boolean;
  overwrite: boolean;
}> {
  const { issueKey, templateType, issueTypeName, existingDocumentNumber, reissue, contentHash } = opts;

  // === Case ①: 完全新規 (existingDocumentNumber なし) ===
  if (!existingDocumentNumber || !existingDocumentNumber.trim()) {
    // 重複防止: 再発行(reissue)でない通常保存では、新規採番の前に
    //   「同一文書とみなせる既存の正本(final)」を探し、あればその番号を
    //   上書き(overwrite)対象として返す。これにより
    //   ・同じ起票(issue_key)× 同じ種別(template_type)
    //   ・もしくは内容ハッシュ(content_hash)が同一
    //   の保存し直しが、毎回あたらしい番号で重複登録されるのを防ぐ。
    //   (MANUAL- 起票は毎回ユニークなので issue 一致は使わず content_hash で判定)
    if (reissue !== true) {
      const dup = await findExistingPrimaryDocument(issueKey, templateType, contentHash);
      if (dup) {
        return {
          documentNumber: dup.document_number,
          baseDocumentNumber: dup.base_document_number || dup.document_number,
          revision: Number(dup.revision) || 0,
          isReissue: false,
          overwrite: true,
        };
      }
    }
    const newNumber = await getNewDocumentNumber(templateType, issueTypeName);
    return {
      documentNumber: newNumber,
      baseDocumentNumber: newNumber,
      revision: 0,
      isReissue: false,
      overwrite: false,
    };
  }

  const docNum = existingDocumentNumber.trim();

  // existingDocumentNumber に対応する既存行を探す。
  // 渡された番号が base そのものでも、_001 等のリビジョン版でも、
  // 同じ base に属する最新リビジョンを取得する。
  const existingRow = await query(
    `SELECT base_document_number, revision, drive_link, document_number, template_type
       FROM documents
      WHERE document_number = $1
         OR base_document_number = $1
         OR base_document_number = (
              SELECT COALESCE(base_document_number, document_number)
                FROM documents WHERE document_number = $1 LIMIT 1
            )
      ORDER BY revision DESC
      LIMIT 1`,
    [docNum]
  );

  // 想定外: 既存履歴ゼロ → 渡された番号で初版扱い (互換性のため)
  if (existingRow.rows.length === 0) {
    return {
      documentNumber: docNum,
      baseDocumentNumber: docNum,
      revision: 0,
      isReissue: false,
      overwrite: false,
    };
  }

  const existing = existingRow.rows[0];

  // === 安全ガード: existingDocumentNumber の行と「生成種別」が異なる場合 ===
  //   その番号は流用しない(別種別の文書を誤って上書き=データ消失するのを防ぐ)。
  //   フロントが前の文書番号(__draft_doc_number 等)を持ち越しても、ここで握りつぶす。
  //   → 同種別の正本があればそれを上書き対象に、無ければ新規採番する。
  if (existing.template_type && templateType && existing.template_type !== templateType) {
    if (reissue !== true) {
      const dup = await findExistingPrimaryDocument(issueKey, templateType, contentHash);
      if (dup) {
        return {
          documentNumber: dup.document_number,
          baseDocumentNumber: dup.base_document_number || dup.document_number,
          revision: Number(dup.revision) || 0,
          isReissue: false,
          overwrite: true,
        };
      }
    }
    const newNumber = await getNewDocumentNumber(templateType, issueTypeName);
    return {
      documentNumber: newNumber,
      baseDocumentNumber: newNumber,
      revision: 0,
      isReissue: false,
      overwrite: false,
    };
  }

  const base = existing.base_document_number || existing.document_number || docNum;
  const existingDocNumber = existing.document_number || docNum;
  const isUnfinishedDraft =
    !existing.drive_link || String(existing.drive_link).trim() === "";

  // === Case ②: 未完成 draft の完成 (drive_link 空) ===
  // 旧 Phase 15: PDF 未作成キュー由来。同番号で UPDATE 完了 (リビジョンは
  // 上げない)。overwrite=true で同 row UPDATE 経路へ。
  if (isUnfinishedDraft) {
    return {
      documentNumber: existingDocNumber,
      baseDocumentNumber: base,
      revision: Number(existing.revision) || 0,
      isReissue: false,
      overwrite: true,
    };
  }

  // === Case ④: 完成済 + 再発行 (reissue=true) → revision+1 で新行 ===
  // 「再発行 (修正版)」ボタン経由でのみ発動。base を共有しつつ revision を
  // +1 して "_NNN" サフィックス付与。caller は過去 row を
  // lifecycle_status='reissued' に倒し、新 row を挿入する。
  if (reissue === true) {
    const nextRev = (Number(existing.revision) || 0) + 1;
    const suffix = nextRev.toString().padStart(3, "0");
    return {
      documentNumber: `${base}_${suffix}`,
      baseDocumentNumber: base,
      revision: nextRev,
      isReissue: true,
      overwrite: false,
    };
  }

  // === Case ③: 完成済 + reissue=false (default) → 同 row 上書き (内部修正) ===
  // Phase 23.1: 再編集 → 生成は既定で「内部修正」扱い。document_number /
  // revision を維持して同 row を UPDATE で上書き。Drive PDF も既存 fileId に
  // content 差し替えで参照リンク不変。
  return {
    documentNumber: existingDocNumber,
    baseDocumentNumber: base,
    revision: Number(existing.revision) || 0,
    isReissue: false,
    overwrite: true,
  };
}

/**
 * Phase 22.10: ファイル名に取引先名を含める用のサニタイザ。
 *   日本語 OK だがファイルシステム / URL で問題になる文字 (/ \ ? * : | " < > 改行等) を
 *   "_" に置換する。空白も "_" に。長すぎる名前は 40 文字で truncate。
 */
export function sanitizeForFilename(s: string): string {
  if (!s) return "";
  return s
    .replace(/[\\/:*?"<>|\r\n\t]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
