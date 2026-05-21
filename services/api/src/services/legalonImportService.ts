/**
 * LegalOn 契約台帳 CSV インポート (Phase 17x)
 *
 * LegalOn Cloud からエクスポートされる契約書台帳 (xlsx を CSV に変換した
 * もの, 43 列) を受け取り、LegalBridge の `contract_capabilities` テーブル
 * に upsert する。法務検索 (/search/vendor) で参照できるようになる。
 *
 * 設計方針:
 *   - 「読み取り専用」だった search-api に対する、唯一の書き込みエンドポイント
 *     (Phase 17t-w の Option A)。書き込み対象は contract_capabilities のみで、
 *     ほかのテーブルには手を出さない (PDF 生成・Backlog 連携・状態遷移は
 *     worker の担当)。
 *   - 3 者以上の契約は LegalOn の取引先名 列にカンマ区切りで入る運用とし、
 *     1 つ目を vendor_id (主取引先)、2 つ目以降を additional_parties JSONB
 *     に構造化保存する (Phase 17x で追加された列)。
 *   - Dry Run モードを必ず用意して、本番投入前に「何が INSERT / UPDATE
 *     されるか」をプレビュー可能にする。
 *
 * LegalOn の CSV ヘッダ (代表) は legalonColumnMap で吸収。CSV のヘッダが
 * 変わったらこのマップだけ修正すれば済む構造にしてある。
 */

import Papa from "papaparse";
import { query, getNewDocumentNumber } from "../lib/db.ts";

// ----------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------

export type DuplicateMode = "overwrite" | "skip" | "fill_only";

export interface ImportOptions {
  dry_run?: boolean;
  duplicate_mode?: DuplicateMode;
}

export interface ResolvedParty {
  name: string;
  vendor_id: number | null;
  role: "primary" | "secondary";
}

export interface ImportPreviewRow {
  row: number;                  // CSV 上の行番号 (header を含む)
  document_number: string;
  primary_vendor: ResolvedParty | null;
  additional_parties: ResolvedParty[];
  contract_title: string;
  contract_type: string;
  contract_category: string;
  record_type: string;
  effective_date: string | null;
  expiration_date: string | null;
  auto_renewal: boolean;
  legalon_url: string;
  action: "INSERT" | "UPDATE" | "SKIP" | "ERROR";
  warning?: string;
  error?: string;
}

export interface ImportResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  multi_party_count: number;       // 2+ 社の契約数
  unresolved_vendor_count: number; // vendor_id 解決できなかった party 数
  errors: Array<{
    row: number;
    document_number?: string;
    error: string;
  }>;
  preview: ImportPreviewRow[];     // dry_run=true ならフル、本番は先頭 200 件
  duplicate_mode: DuplicateMode;
  dry_run: boolean;
}

// ----------------------------------------------------------------------
// CSV ヘッダ → 内部フィールド 名のマップ
// ----------------------------------------------------------------------

/**
 * LegalOn Cloud のエクスポート CSV の標準ヘッダ。
 * 設定変更でずれた場合はこのマップだけ更新すれば良い。
 */
const COLUMN_MAP: Record<string, string> = {
  // 主キー
  "管理番号": "document_number",
  // 契約情報
  "契約書タイトル": "contract_title",
  "契約類型, 立場": "contract_type_raw",
  "契約類型": "contract_type_raw_alt", // ヘッダ表記揺れ吸収
  // 取引先
  "取引先名": "counterparty_raw",
  "取引先コード": "vendor_code",
  // 日付
  "契約締結日": "effective_date",
  "契約開始日": "effective_date_alt",
  "契約終了日": "expiration_date",
  // フラグ・状態
  "自動更新": "auto_renewal",
  "契約状況": "contract_status",
  // 参照
  "URL": "legalon_url",
  "ファイル名": "file_name",
};

// ----------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------

/**
 * 取引先名のフィールド (例: "A社, B社・C社") を分割して個別社名リストに。
 * 区切り文字: 半角カンマ・全角カンマ・読点・中黒・改行。
 */
export function splitCounterparties(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[,，、・\n\r]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** LegalOn の「自動更新」セル ("あり"/"なし" 等) を boolean に。 */
function parseAutoRenewal(raw: any): boolean {
  if (raw == null) return false;
  const s = String(raw).trim().toLowerCase();
  return ["あり", "true", "○", "◯", "yes", "1"].includes(s);
}

/**
 * "2026/05/08" / "2026-05-08" / "2026年5月8日" のような日本語日付を
 * "YYYY-MM-DD" に正規化。パース失敗時は null。
 */
function parseDate(raw: any): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "-") return null;
  const slash = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (slash) {
    return `${slash[1]}-${slash[2].padStart(2, "0")}-${slash[3].padStart(2, "0")}`;
  }
  const jp = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (jp) {
    return `${jp[1]}-${jp[2].padStart(2, "0")}-${jp[3].padStart(2, "0")}`;
  }
  return null;
}

/**
 * タイトル + 契約類型 から LegalBridge の (contract_type, category, record_type)
 * を推定する。完全自動だと取りこぼしがあるので、最終的には UI で手動修正可能に
 * しておく予定。Phase 17x ではまず推定ロジックを置く。
 */
function inferContractType(
  title: string,
  typeRaw: string
): { type: string; category: string; recordType: string } {
  const s = `${title || ""} ${typeRaw || ""}`;
  // 個別契約系を先に判定 (基本契約 と 個別契約の取り違え防止)
  if (/発注書/.test(s)) {
    return { type: "purchase_order", category: "service", recordType: "individual_contract" };
  }
  if (/検収|納品確認/.test(s)) {
    return { type: "inspection_certificate", category: "service", recordType: "individual_contract" };
  }
  if (/個別利用許諾|個別ライセンス|個別契約/.test(s)) {
    return { type: "individual_license_terms", category: "license", recordType: "individual_contract" };
  }
  // 基本契約系
  if (/業務委託基本契約|業務委託.*基本|業務委託契約/.test(s)) {
    return { type: "service_master", category: "service", recordType: "master_contract" };
  }
  if (/ライセンス基本契約|利用許諾基本契約|ライセンス契約|利用許諾契約/.test(s)) {
    return { type: "license_master", category: "license", recordType: "master_contract" };
  }
  if (/売買基本契約|売買契約/.test(s)) {
    return { type: "sales_master", category: "sales", recordType: "master_contract" };
  }
  if (/出版基本契約|出版契約/.test(s)) {
    return { type: "publication_contract", category: "publication", recordType: "master_contract" };
  }
  if (/秘密保持|NDA/i.test(s)) {
    return { type: "nda", category: "other", recordType: "master_contract" };
  }
  if (/譲渡契約|権利譲渡/.test(s)) {
    return { type: "assignment", category: "other", recordType: "master_contract" };
  }
  // フォールバック
  return { type: "unknown", category: "unknown", recordType: "master_contract" };
}

// ----------------------------------------------------------------------
// Vendors 一括フェッチ (パフォーマンス最適化)
// ----------------------------------------------------------------------

type VendorIndex = {
  byCode: Map<string, number>;
  byName: Map<string, number>;
  byTradePen: Map<string, number>;
};

/**
 * 全 vendors を 1 回だけフェッチして in-memory index を組む。
 * 1,983 行 × 平均 1.2 取引先 = 約 2,400 lookup を DB → 1 回で済ます。
 */
async function loadVendorIndex(): Promise<VendorIndex> {
  const r = await query(
    `SELECT id, vendor_code, vendor_name, trade_name, pen_name
       FROM vendors`
  );
  const byCode = new Map<string, number>();
  const byName = new Map<string, number>();
  const byTradePen = new Map<string, number>();
  for (const row of r.rows) {
    const id = Number(row.id);
    if (row.vendor_code) byCode.set(String(row.vendor_code).trim(), id);
    if (row.vendor_name) byName.set(String(row.vendor_name).trim(), id);
    if (row.trade_name) byTradePen.set(String(row.trade_name).trim(), id);
    if (row.pen_name) byTradePen.set(String(row.pen_name).trim(), id);
  }
  return { byCode, byName, byTradePen };
}

function resolveVendorFromIndex(
  idx: VendorIndex,
  name: string,
  code?: string
): number | null {
  const c = (code || "").trim();
  const n = (name || "").trim();
  if (c && c.toUpperCase() !== "UNKNOWN") {
    const hit = idx.byCode.get(c);
    if (hit) return hit;
  }
  if (n) {
    const hit = idx.byName.get(n);
    if (hit) return hit;
  }
  if (n) {
    const hit = idx.byTradePen.get(n);
    if (hit) return hit;
  }
  return null;
}

// ----------------------------------------------------------------------
// CSV → 内部行
// ----------------------------------------------------------------------

interface RawLegalOnRow {
  document_number?: string;
  contract_title?: string;
  contract_type_raw?: string;
  contract_type_raw_alt?: string;
  counterparty_raw?: string;
  vendor_code?: string;
  effective_date?: string;
  effective_date_alt?: string;
  expiration_date?: string;
  auto_renewal?: any;
  contract_status?: string;
  legalon_url?: string;
  file_name?: string;
}

/**
 * サンプル CSV を返す (UI のダウンロードボタンから取得)。
 *
 * 含まれるサンプル行:
 *   1. 業務委託基本契約書 (取引先 1 社)
 *   2. ライセンス基本契約 (取引先 1 社、自動更新あり)
 *   3. 3 者契約 (取引先名 をカンマ区切りで 3 社)
 *   4. NDA (秘密保持)
 *   5. 発注書 (個別契約)
 *
 * CSV は UTF-8 (BOM なし) で吐く。Excel で開くときに文字化けする場合は
 * Excel 側で「データ → テキストファイルから」で UTF-8 を選択して
 * インポートしてもらう (or BOM 付与版が欲しければ caller 側で先頭に '﻿')。
 */
export function getSampleCsv(): string {
  const headers = [
    "管理番号",
    "契約書タイトル",
    "契約類型, 立場",
    "取引先名",
    "取引先コード",
    "契約締結日",
    "契約開始日",
    "契約終了日",
    "自動更新",
    "契約状況",
    "URL",
    "ファイル名",
  ];
  const rows = [
    // 1. 業務委託基本契約 (1 社)
    [
      "SVC-2026-001",
      "業務委託基本契約書",
      "[業務委託契約（成果物あり）,委託者]",
      "株式会社サンプル",
      "V001",
      "2026/04/01",
      "2026/04/01",
      "2027/03/31",
      "あり",
      "契約期間中",
      "https://loc.legalon-cloud.com/document/sample-001",
      "業務委託基本契約書_サンプル.pdf",
    ],
    // 2. ライセンス基本契約 (1 社・自動更新あり)
    [
      "LIC-2026-001",
      "ライセンス基本契約書",
      "[利用許諾契約,被許諾者]",
      "Sample IP Holdings 株式会社",
      "V002",
      "2026/04/01",
      "2026/04/01",
      "",
      "あり",
      "契約期間中",
      "https://loc.legalon-cloud.com/document/sample-002",
      "ライセンス基本契約書_Sample IP Holdings.pdf",
    ],
    // 3. ★ 3 者契約 (取引先名をカンマ区切り)
    [
      "TRI-2026-001",
      "共同事業に関する業務委託契約書",
      "[業務委託契約（成果物あり）,委託者]",
      "株式会社A, 株式会社B, 株式会社C",
      "",
      "2026/05/01",
      "2026/05/01",
      "2027/04/30",
      "なし",
      "契約期間中",
      "https://loc.legalon-cloud.com/document/sample-003",
      "共同事業契約_A_B_C.pdf",
    ],
    // 4. NDA
    [
      "NDA-2026-001",
      "秘密保持契約書",
      "[秘密保持契約,双方]",
      "株式会社サンプル B",
      "V003",
      "2026/03/15",
      "2026/03/15",
      "2027/03/14",
      "あり",
      "契約期間中",
      "https://loc.legalon-cloud.com/document/sample-004",
      "NDA_株式会社サンプルB.pdf",
    ],
    // 5. 発注書 (個別契約)
    [
      "PO-2026-001",
      "発注書",
      "[業務委託契約（成果物あり）,委託者]",
      "株式会社サンプル",
      "V001",
      "2026/05/08",
      "2026/05/08",
      "",
      "なし",
      "契約期間中",
      "https://loc.legalon-cloud.com/document/sample-005",
      "発注書_PO-2026-001.pdf",
    ],
  ];

  // 自前 CSV ライターで papaparse の挙動と合わせる (RFC 4180 準拠)
  const escape = (v: string) => {
    const s = String(v);
    // ダブルクォート / カンマ / 改行 を含む場合は "..." でラップ + " を ""
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [
    headers.map(escape).join(","),
    ...rows.map((r) => r.map(escape).join(",")),
  ];
  return lines.join("\r\n") + "\r\n";
}

/**
 * CSV テキストを内部行構造の配列にパース。papaparse の header=true を使う
 * ので、CSV のヘッダ名 → COLUMN_MAP で内部フィールド名にリネーム。
 */
export function parseCsv(csvText: string): RawLegalOnRow[] {
  const result = Papa.parse<Record<string, any>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => String(h).trim(),
  });
  return result.data.map((row): RawLegalOnRow => {
    const mapped: any = {};
    for (const [header, value] of Object.entries(row)) {
      const field = COLUMN_MAP[header];
      if (!field) continue;
      mapped[field] = value;
    }
    return mapped;
  });
}

// ----------------------------------------------------------------------
// メイン処理
// ----------------------------------------------------------------------

/**
 * Phase 17x: パース済み行を contract_capabilities に upsert する。
 * dry_run=true なら実 INSERT/UPDATE はせずプレビューだけ返す。
 *
 * 同じ document_number が既存の場合の挙動:
 *   - overwrite:  上書き UPDATE
 *   - skip:       既存はスキップ
 *   - fill_only:  既存の NULL/空欄列だけを補完 (現状は overwrite に同等の扱い、
 *                 厳密な fill_only は将来拡張)
 */
export async function importLegalOnRows(
  rows: RawLegalOnRow[],
  options: ImportOptions = {}
): Promise<ImportResult> {
  const dryRun = options.dry_run === true;
  const duplicateMode: DuplicateMode = options.duplicate_mode || "overwrite";

  const result: ImportResult = {
    total: rows.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    multi_party_count: 0,
    unresolved_vendor_count: 0,
    errors: [],
    preview: [],
    duplicate_mode: duplicateMode,
    dry_run: dryRun,
  };

  // 全 vendors を一括フェッチして in-memory index 化
  const vendorIdx = await loadVendorIndex();

  // 既存 document_number を一括フェッチ (重複チェック用)
  const existing = await query(
    `SELECT document_number FROM contract_capabilities
      WHERE document_number IS NOT NULL`
  );
  const existingDocNums = new Set<string>(
    existing.rows.map((r: any) => String(r.document_number).trim())
  );

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // header=1, data starts row 2

    try {
      // Phase 22.21.46: 管理番号が空のものは「自動発番」する。
      //   旧仕様では空欄をエラー扱いにしていたが、紙契約 / 古い契約 / 取込元で
      //   採番されていない契約も多いため、worker と同じ getNewDocumentNumber 関数で
      //   ARC-<TYPE>-<YEAR>-<NNNN> を発番する。
      //   - Dry Run: 連番を消費したくないので "(AUTO: ARC-…-XXXX)" のような
      //     プレビュー文字列だけ作って表示。
      //   - 本番: 実際に連番を消費して発番。
      let docNum = String(row.document_number || "").trim();
      let docNumberAuto = false;
      const inferredContractType = (() => {
        const t = inferContractType(
          row.contract_title || "",
          row.contract_type_raw || row.contract_type_raw_alt || ""
        );
        return t.type;
      })();
      if (!docNum) {
        docNumberAuto = true;
        if (dryRun) {
          // 連番を消費しない placeholder。本番時の prefix だけ予測表示。
          docNum = `(AUTO 発番予定: ${inferredContractType})`;
        } else {
          docNum = await getNewDocumentNumber(
            inferredContractType || "external_contract"
          );
        }
      }

      const partyNames = splitCounterparties(row.counterparty_raw);
      if (partyNames.length === 0) {
        result.errors.push({
          row: rowNum,
          document_number: docNum,
          error: "取引先名 が空です",
        });
        result.failed++;
        continue;
      }

      // 全 party の vendor_id を解決
      const resolved: ResolvedParty[] = partyNames.map((name, idx) => {
        const vid = resolveVendorFromIndex(
          vendorIdx,
          name,
          idx === 0 ? row.vendor_code : undefined
        );
        if (vid === null) result.unresolved_vendor_count++;
        return {
          name,
          vendor_id: vid,
          role: idx === 0 ? "primary" : "secondary",
        };
      });
      const primary = resolved[0];
      const additional = resolved.slice(1);
      if (additional.length > 0) result.multi_party_count++;

      // 契約類型 推定
      const titleAndType = `${row.contract_title || ""} ${
        row.contract_type_raw || row.contract_type_raw_alt || ""
      }`;
      const { type: contractType, category, recordType } = inferContractType(
        row.contract_title || "",
        row.contract_type_raw || row.contract_type_raw_alt || ""
      );

      // 日付
      const effectiveDate =
        parseDate(row.effective_date) || parseDate(row.effective_date_alt);
      const expirationDate = parseDate(row.expiration_date);
      const autoRenewal = parseAutoRenewal(row.auto_renewal);

      // 重複チェック
      const exists = existingDocNums.has(docNum);
      let action: "INSERT" | "UPDATE" | "SKIP" = exists ? "UPDATE" : "INSERT";
      if (exists && duplicateMode === "skip") {
        action = "SKIP";
      }

      // Phase 22.21.46: warning メッセージ組み立て。
      //   従来の取引先未登録警告に加え、管理番号 自動発番の通知も付与。
      const warnings: string[] = [];
      if (docNumberAuto) {
        warnings.push(
          `管理番号 自動発番${dryRun ? " (本番取込時に確定)" : ""}`
        );
      }
      if (primary.vendor_id === null) {
        warnings.push(`主取引先 "${primary.name}" が vendors マスタに未登録`);
      } else if (additional.some((p) => p.vendor_id === null)) {
        warnings.push(`2 つ目以降の取引先の一部が vendors マスタに未登録`);
      }

      const previewRow: ImportPreviewRow = {
        row: rowNum,
        document_number: docNum,
        primary_vendor: primary,
        additional_parties: additional,
        contract_title: row.contract_title || "",
        contract_type: contractType,
        contract_category: category,
        record_type: recordType,
        effective_date: effectiveDate,
        expiration_date: expirationDate,
        auto_renewal: autoRenewal,
        legalon_url: row.legalon_url || "",
        action,
        warning: warnings.length > 0 ? warnings.join(" / ") : undefined,
      };

      if (action === "SKIP") {
        result.skipped++;
        if (result.preview.length < 200) result.preview.push(previewRow);
        continue;
      }

      if (dryRun) {
        result.succeeded++;
        if (result.preview.length < 200) result.preview.push(previewRow);
        continue;
      }

      // 本番 upsert
      await query(
        `INSERT INTO contract_capabilities (
           vendor_id, additional_parties, record_type, contract_category, contract_type,
           contract_title, document_number, contract_status,
           effective_date, expiration_date, auto_renewal,
           legalon_url, source_system
         ) VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (document_number) DO UPDATE SET
           vendor_id          = COALESCE(EXCLUDED.vendor_id, contract_capabilities.vendor_id),
           additional_parties = EXCLUDED.additional_parties,
           record_type        = EXCLUDED.record_type,
           contract_category  = EXCLUDED.contract_category,
           contract_type      = EXCLUDED.contract_type,
           contract_title     = EXCLUDED.contract_title,
           contract_status    = COALESCE(NULLIF(EXCLUDED.contract_status, ''), contract_capabilities.contract_status),
           effective_date     = COALESCE(EXCLUDED.effective_date, contract_capabilities.effective_date),
           expiration_date    = COALESCE(EXCLUDED.expiration_date, contract_capabilities.expiration_date),
           auto_renewal       = EXCLUDED.auto_renewal,
           legalon_url        = EXCLUDED.legalon_url,
           updated_at         = CURRENT_TIMESTAMP`,
        [
          primary.vendor_id,
          JSON.stringify(additional),
          recordType,
          category,
          contractType,
          row.contract_title || docNum,
          docNum,
          row.contract_status || "executed",
          effectiveDate,
          expirationDate,
          autoRenewal,
          row.legalon_url || "",
          "LegalOn Import",
        ]
      );
      result.succeeded++;
      if (result.preview.length < 200) result.preview.push(previewRow);
    } catch (err: any) {
      result.errors.push({
        row: rowNum,
        document_number: row.document_number,
        error: String(err?.message || err),
      });
      result.failed++;
    }
  }
  return result;
}
