/**
 * workModelImportService — 作品中心(work-centric / /api/v3)モデルの CSV 一括取込。
 *
 * 取引先(vendorMasterService.importVendorRows)/ LegalOn(legalonImportService)と
 * 同じ仕組み:
 *   - papaparse で header 付き CSV をパース
 *   - 日本語 / 英語ヘッダを内部フィールドにマップ(alias 辞書)
 *   - dry_run(検証のみ)+ duplicate_mode(overwrite / skip / fill_only)
 *   - コード列(source_code / work_code / document_number)を UNIQUE キーに upsert
 *     未指定なら master_sequences で自動採番
 *
 * 対応エンティティ: source-ips / works / contracts / work-materials。
 */

import Papa from "papaparse";

import { normalizeGenre, normalizeRole } from "../lib/materialVocab";

type Query = (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }>;

export type V3Entity = "source-ips" | "works" | "contracts" | "work-materials";
export type V3ImportOptions = {
  dry_run?: boolean;
  duplicate_mode?: "overwrite" | "skip" | "fill_only";
};
export type V3ImportResult = {
  entity: V3Entity;
  dry_run: boolean;
  duplicate_mode: string;
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  errors: { row: number; message: string }[];
  preview: { row: number; action: string; code: string; title: string; [k: string]: any }[];
  parent_unresolved?: number; // works: parent_work_code を解決できなかった行数
};

type ColType = "text" | "int" | "bool" | "date" | "array" | "vendor" | "work";
type ColSpec = { field: string; aliases: string[]; type?: ColType; virtual?: boolean };

type EntityConfig = {
  table: string;
  codeColumn: string; // UNIQUE upsert キー
  seqKind: string; // master_sequences.kind
  codePrefix: string; // 自動採番接頭辞 (IP / W / ARC-REG)
  titleField: string; // 必須・プレビュー表示用
  cols: ColSpec[]; // テーブル列(コード列含む)
  links?: ColSpec[]; // contracts のみ: contract_works への作品/IP 紐付け
};

const normHeader = (h: string) =>
  String(h || "").trim().toLowerCase().replace(/[\s　]+/g, "");

function parseBool(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "○", "有", "はい", "オリジナル", "自動更新"].includes(s);
}

const splitArray = (v: unknown): string[] =>
  String(v ?? "")
    .split(/[,、;；]/)
    .map((s) => s.trim())
    .filter(Boolean);

const CONFIGS: Record<V3Entity, EntityConfig> = {
  "source-ips": {
    table: "source_ips",
    codeColumn: "source_code",
    seqKind: "IP",
    codePrefix: "IP",
    titleField: "title",
    cols: [
      { field: "source_code", aliases: ["source_code", "ipコード", "コード"] },
      { field: "title", aliases: ["title", "タイトル", "作品名", "原作名"] },
      { field: "title_kana", aliases: ["title_kana", "タイトルカナ", "ヨミ", "よみ"] },
      { field: "alternative_titles", aliases: ["alternative_titles", "別名", "別タイトル"], type: "array" },
      { field: "original_publisher", aliases: ["original_publisher", "出版社", "原作出版社"] },
      { field: "default_rights_holder", aliases: ["default_rights_holder", "権利者", "既定権利者"] },
      { field: "default_credit_display", aliases: ["default_credit_display", "クレジット表記", "クレジット"] },
      { field: "default_work_supplement", aliases: ["default_work_supplement", "作品補足"] },
      { field: "default_approval_target", aliases: ["default_approval_target", "承認対象"] },
      { field: "default_approval_timing", aliases: ["default_approval_timing", "承認タイミング"] },
      { field: "remarks", aliases: ["remarks", "備考"] },
      { field: "rights_holder_vendor_id", aliases: ["rights_holder_vendor_code", "権利者取引先コード"], type: "vendor" },
    ],
  },
  works: {
    table: "works",
    codeColumn: "work_code",
    seqKind: "W",
    codePrefix: "W",
    titleField: "title",
    cols: [
      { field: "work_code", aliases: ["work_code", "作品コード", "コード"] },
      { field: "title", aliases: ["title", "タイトル", "作品名"] },
      { field: "title_kana", aliases: ["title_kana", "タイトルカナ", "ヨミ", "よみ"] },
      { field: "alternative_titles", aliases: ["alternative_titles", "別名", "別タイトル"], type: "array" },
      { field: "division", aliases: ["division", "区分"], type: "array" },
      { field: "work_type", aliases: ["work_type", "作品種別", "種別"] },
      { field: "status", aliases: ["status", "ステータス", "状態"] },
      { field: "is_original", aliases: ["is_original", "オリジナル", "完全オリジナル"], type: "bool" },
      // 派生(系譜): parent_work_code を works.id に解決して parent_work_id に入れる。
      //   コードが無くても parent_work_title(親作品名)でも解決できる(下の virtual 列)。
      //   いずれも未存在/空ならスキップ(後から作品フォームで紐付け可)。
      { field: "parent_work_id", aliases: ["parent_work_code", "親作品コード", "派生元コード", "派生元作品コード", "派生元"], type: "work" },
      // 仮想列: テーブルには書かず、parent_work_id がコードで解決できないとき
      //   タイトル一致で親を解決するために使う。
      { field: "parent_work_title", aliases: ["parent_work_title", "親作品名", "親作品タイトル", "派生元作品名", "派生元名", "派生元タイトル"], virtual: true },
      { field: "derivation_type", aliases: ["derivation_type", "派生種別", "派生"] },
      { field: "remarks", aliases: ["remarks", "備考"] },
      // 整理①: publisher_vendor_id(自社作品の出版社)は廃止のため CSV 取込からも除外。
    ],
  },
  contracts: {
    table: "contracts",
    codeColumn: "document_number",
    seqKind: "REG",
    codePrefix: "ARC-REG",
    titleField: "contract_title",
    cols: [
      { field: "document_number", aliases: ["document_number", "管理番号", "文書番号"] },
      { field: "contract_title", aliases: ["contract_title", "契約名", "タイトル"] },
      { field: "contract_level", aliases: ["contract_level", "契約レベル"] },
      { field: "contract_category", aliases: ["contract_category", "契約カテゴリ", "カテゴリ"] },
      { field: "contract_type", aliases: ["contract_type", "契約類型", "類型"] },
      { field: "lifecycle_stage", aliases: ["lifecycle_stage", "ステータス", "進捗"] },
      { field: "effective_date", aliases: ["effective_date", "発効日", "開始日"], type: "date" },
      { field: "expiration_date", aliases: ["expiration_date", "満了日", "終了日"], type: "date" },
      { field: "auto_renewal", aliases: ["auto_renewal", "自動更新"], type: "bool" },
      { field: "primary_vendor_id", aliases: ["primary_vendor_code", "取引先コード", "相手方コード"], type: "vendor" },
    ],
    links: [
      { field: "work_code", aliases: ["work_code", "作品コード"] },
      { field: "source_code", aliases: ["source_code", "ipコード"] },
    ],
  },
  // マテリアル一本化(0089/0090): 統合マテリアル表 work_materials への一括取込。
  //   親 = work_code(原作/自社作品どちらでも) → work_id。code = material_code(<work_code>-NNN)。
  //   material_type/material_role/acquisition_type は正準語彙へ正規化(下の normalize* 参照)。
  "work-materials": {
    table: "work_materials",
    codeColumn: "material_code",
    seqKind: "WM",       // material_code は work スコープで導出するため通常未使用
    codePrefix: "WM",
    titleField: "material_name",
    cols: [
      { field: "work_id", aliases: ["work_code", "作品コード", "原作コード", "コード"], type: "work" },
      { field: "material_no", aliases: ["material_no", "素材番号", "枝番"], type: "int" },
      { field: "material_code", aliases: ["material_code", "素材コード", "マテリアルコード"] },
      { field: "material_name", aliases: ["material_name", "素材名", "マテリアル名", "名称"] },
      { field: "material_type", aliases: ["material_type", "ジャンル", "種別", "素材種別"] },
      { field: "material_role", aliases: ["material_role", "役割", "区分"] },
      { field: "acquisition_type", aliases: ["acquisition_type", "取得経路", "取得区分"] },
      { field: "rights_holder_label", aliases: ["rights_holder_label", "権利者", "素材権利者"] },
      { field: "rights_holder_vendor_id", aliases: ["rights_holder_vendor_code", "権利者取引先コード"], type: "vendor" },
      { field: "is_default", aliases: ["is_default", "本体", "デフォルト", "原作本体"], type: "bool" },
      { field: "remarks", aliases: ["remarks", "備考"] },
    ],
  },
};

// ── マテリアル分類の正準化(O5: 正準語彙は lib/materialVocab に集約) ─────────────
function normalizeAcquisition(v: unknown): string | null {
  const k = String(v ?? "").trim().toLowerCase();
  if (["license", "ライセンス", "許諾"].includes(k)) return "license";
  if (["buyout_commission", "buyout", "委託", "買い切り", "買取", "業務委託"].includes(k)) return "buyout_commission";
  if (["in_house", "inhouse", "自社", "自社制作"].includes(k)) return "in_house";
  const raw = String(v ?? "").trim();
  return raw || null;
}

const pad4 = (n: number) => String(n).padStart(4, "0");
async function nextSeq(query: Query, kind: string, year: number): Promise<number> {
  const r = await query(
    `INSERT INTO master_sequences (kind, year, current_value) VALUES ($1, $2, 1)
       ON CONFLICT (kind, year) DO UPDATE SET current_value = master_sequences.current_value + 1
     RETURNING current_value`,
    [kind, year]
  );
  return r.rows[0].current_value as number;
}

/** ヘッダ → フィールド名の対応表(ある CSV の実ヘッダから引く)。 */
function buildHeaderIndex(cfg: EntityConfig, headers: string[]): Map<string, string> {
  const idx = new Map<string, string>();
  const specs = [...cfg.cols, ...(cfg.links || [])];
  for (const h of headers) {
    const nh = normHeader(h);
    for (const c of specs) {
      if (c.aliases.some((a) => normHeader(a) === nh)) {
        idx.set(h, c.field);
        break;
      }
    }
  }
  return idx;
}

function coerce(type: ColType | undefined, raw: unknown): any {
  const s = String(raw ?? "").trim();
  if (s === "") return type === "array" ? [] : null;
  switch (type) {
    case "int": {
      const n = Number(s.replace(/,/g, ""));
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case "bool":
      return parseBool(s);
    case "array":
      return splitArray(s);
    case "date":
      return s; // Postgres が YYYY-MM-DD 等を解釈
    default:
      return s;
  }
}

const vendorIdCache = new Map<string, number | null>();
async function resolveVendorId(query: Query, code: string): Promise<number | null> {
  const key = code.trim();
  if (!key) return null;
  if (vendorIdCache.has(key)) return vendorIdCache.get(key)!;
  const r = await query(`SELECT id FROM vendors WHERE vendor_code = $1`, [key]);
  const id = r.rows.length ? Number(r.rows[0].id) : null;
  vendorIdCache.set(key, id);
  return id;
}

// parent_work_code → works.id 解決(派生品の親作品紐付け用)。未存在は null(非致命)。
const workIdCache = new Map<string, number | null>();
async function resolveWorkId(query: Query, code: string): Promise<number | null> {
  const key = code.trim();
  if (!key) return null;
  if (workIdCache.has(key)) return workIdCache.get(key)!;
  const r = await query(`SELECT id FROM works WHERE work_code = $1`, [key]);
  const id = r.rows.length ? Number(r.rows[0].id) : null;
  workIdCache.set(key, id);
  return id;
}

// 親作品名(タイトル)で works を解決。1件一致のみ採用。0件/複数件は未解決(count を返す)。
async function resolveWorkByTitle(query: Query, title: string): Promise<{ id: number | null; count: number }> {
  const t = title.trim();
  if (!t) return { id: null, count: 0 };
  const r = await query(`SELECT id FROM works WHERE LOWER(title) = LOWER($1)`, [t]);
  if (r.rows.length === 1) return { id: Number(r.rows[0].id), count: 1 };
  return { id: null, count: r.rows.length };
}

export function parseWorkModelCsv(csvText: string): Record<string, any>[] {
  const res = Papa.parse<Record<string, any>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => String(h).trim(),
  });
  return (res.data || []).filter(
    (row) => row && Object.values(row).some((v) => String(v ?? "").trim() !== "")
  );
}

/** CSV テキストを取り込む。dry_run のときは DB 書き込みをしない。 */
export async function importWorkModelCsv(
  query: Query,
  entity: V3Entity,
  csvText: string,
  opts: V3ImportOptions = {}
): Promise<V3ImportResult> {
  const cfg = CONFIGS[entity];
  if (!cfg) throw new Error(`unknown entity: ${entity}`);
  const dryRun = !!opts.dry_run;
  const dupMode = opts.duplicate_mode || "overwrite";

  const rows = parseWorkModelCsv(csvText);
  const result: V3ImportResult = {
    entity, dry_run: dryRun, duplicate_mode: dupMode,
    total: rows.length, succeeded: 0, skipped: 0, failed: 0,
    errors: [], preview: [], parent_unresolved: 0,
  };
  if (rows.length === 0) return result;

  const headerIdx = buildHeaderIndex(cfg, Object.keys(rows[0]));
  vendorIdCache.clear();
  workIdCache.clear();

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // 1=ヘッダ, データは 2 行目から
    const raw = rows[i];
    try {
      // ヘッダ → フィールドへ写像
      const rec: Record<string, any> = {};
      const links: Record<string, string> = {};
      const virtuals: Record<string, string> = {}; // テーブルに書かない補助列(親作品名 等)
      let parentRaw = ""; // parent_work_code / parent_work_title の入力値
      let parentResolved: boolean | null = null; // true=解決 / false=未解決 / null=指定なし
      let parentNote = "";
      let workRefRaw = ""; // work-materials: 親 work_code の入力値
      for (const [header, field] of headerIdx) {
        const spec = [...cfg.cols, ...(cfg.links || [])].find((c) => c.field === field)!;
        if (cfg.links?.some((l) => l.field === field)) {
          links[field] = String(raw[header] ?? "").trim();
        } else if (spec.virtual) {
          virtuals[field] = String(raw[header] ?? "").trim();
        } else if (spec.type === "vendor") {
          rec[field] = await resolveVendorId(query, String(raw[header] ?? ""));
        } else if (spec.type === "work") {
          const codeRaw = String(raw[header] ?? "").trim();
          rec[field] = await resolveWorkId(query, codeRaw);
          if (field === "parent_work_id") {
            parentRaw = codeRaw;
            parentResolved = codeRaw ? rec[field] != null : null;
          }
          if (field === "work_id") workRefRaw = codeRaw;
        } else {
          rec[field] = coerce(spec.type, raw[header]);
        }
      }

      // 親がコードで解決できないとき、親作品名(タイトル)でフォールバック解決(works のみ)。
      if (entity === "works" && rec.parent_work_id == null && virtuals.parent_work_title) {
        const byTitle = await resolveWorkByTitle(query, virtuals.parent_work_title);
        rec.parent_work_id = byTitle.id;
        if (!parentRaw) parentRaw = virtuals.parent_work_title;
        parentResolved = byTitle.id != null;
        if (byTitle.count > 1) parentNote = "(同名複数)";
      }

      // work-materials: 親作品の必須化 + 分類正規化 + material_code(<work_code>-NNN)導出。
      if (entity === "work-materials") {
        if (rec.work_id == null) {
          throw new Error(`work_code が解決できません: ${workRefRaw || "(空)"}`);
        }
        rec.material_type = normalizeGenre(rec.material_type);
        rec.acquisition_type = normalizeAcquisition(rec.acquisition_type);
        rec.material_role = normalizeRole(rec.material_role, rec.material_type, rec.is_default);
        if (!String(rec.material_code ?? "").trim()) {
          const noRes = await query(
            `SELECT COALESCE(MAX(material_no), 0) + 1 AS n FROM work_materials WHERE work_id = $1`,
            [rec.work_id]
          );
          const nextNo = Number(noRes.rows[0]?.n) || 1;
          if (rec.material_no == null) rec.material_no = nextNo;
          rec.material_code = `${workRefRaw}-${String(rec.material_no).padStart(3, "0")}`;
        }
      }

      const title = String(rec[cfg.titleField] ?? "").trim();
      if (!title) throw new Error(`${cfg.titleField}(タイトル)は必須です`);

      let code = String(rec[cfg.codeColumn] ?? "").trim();
      const existing = code
        ? await query(`SELECT id FROM ${cfg.table} WHERE ${cfg.codeColumn} = $1`, [code])
        : { rows: [] as any[] };
      const exists = existing.rows.length > 0;

      let action: string;
      if (exists && dupMode === "skip") {
        action = "skip";
        result.skipped++;
      } else if (!exists) {
        action = "insert";
        if (!code) {
          code = dryRun
            ? `(${cfg.codePrefix}-auto)`
            : `${cfg.codePrefix}-${new Date().getFullYear()}-${pad4(await nextSeq(query, cfg.seqKind, new Date().getFullYear()))}`;
          rec[cfg.codeColumn] = code;
        }
        if (!dryRun) await insertRow(query, cfg, rec, links);
        result.succeeded++;
      } else {
        action = dupMode === "fill_only" ? "fill" : "update";
        if (!dryRun) await updateRow(query, cfg, code, rec, links, dupMode === "fill_only");
        result.succeeded++;
      }

      const previewRow: any = { row: rowNo, action, code: code || "(auto)", title };
      if (entity === "works") {
        // 親(派生元)解決の成否を行ごとに表示。未解決は ✗。コード/タイトル両対応。
        previewRow["親指定"] = parentRaw || "—";
        previewRow["親解決"] = parentRaw ? (parentResolved ? "OK" : "未解決✗" + parentNote) : "—";
        if (parentRaw && !parentResolved) result.parent_unresolved = (result.parent_unresolved || 0) + 1;
      }
      result.preview.push(previewRow);
    } catch (e: any) {
      result.failed++;
      result.errors.push({ row: rowNo, message: String(e?.message || e) });
    }
  }
  return result;
}

async function insertRow(
  query: Query, cfg: EntityConfig, rec: Record<string, any>, links: Record<string, string>
) {
  // null/undefined の列は省略し、DB 既定値(NOT NULL DEFAULT 等)を活かす。virtual 列は除外。
  const fields = cfg.cols.filter((c) => !c.virtual).map((c) => c.field).filter((f) => rec[f] != null);
  const vals = fields.map((f) => rec[f]);
  const placeholders = fields.map((_, i) => `$${i + 1}`);
  const r = await query(
    `INSERT INTO ${cfg.table} (${fields.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    vals
  );
  if (cfg.links) await applyContractLinks(query, Number(r.rows[0].id), links);
}

async function updateRow(
  query: Query, cfg: EntityConfig, code: string,
  rec: Record<string, any>, links: Record<string, string>, fillOnly: boolean
) {
  // 空(null)セルは更新対象外。値のある列だけ反映(NOT NULL 列の破壊を防ぐ)。
  const fields = cfg.cols
    .filter((c) => !c.virtual)
    .map((c) => c.field)
    .filter((f) => f !== cfg.codeColumn && rec[f] != null);
  if (fields.length) {
    // fill_only: 既存値があればそれを優先(空欄のみ新値で埋める)。
    const setSql = fields.map((f, i) =>
      fillOnly ? `${f} = COALESCE(${cfg.table}.${f}, $${i + 1})` : `${f} = $${i + 1}`
    );
    await query(
      `UPDATE ${cfg.table} SET ${setSql.join(", ")}, updated_at = now() WHERE ${cfg.codeColumn} = $${fields.length + 1}`,
      [...fields.map((f) => rec[f]), code]
    );
  }
  if (cfg.links) {
    const idRes = await query(`SELECT id FROM ${cfg.table} WHERE ${cfg.codeColumn} = $1`, [code]);
    if (idRes.rows.length) await applyContractLinks(query, Number(idRes.rows[0].id), links);
  }
}

/** contracts の work_code / source_code 列を contract_works に解決して紐付け。 */
async function applyContractLinks(query: Query, contractId: number, links: Record<string, string>) {
  const workCode = (links.work_code || "").trim();
  const sourceCode = (links.source_code || "").trim();
  if (!workCode && !sourceCode) return;
  const workId = workCode
    ? (await query(`SELECT id FROM works WHERE work_code = $1`, [workCode])).rows[0]?.id ?? null
    : null;
  const sourceId = sourceCode
    ? (await query(`SELECT id FROM source_ips WHERE source_code = $1`, [sourceCode])).rows[0]?.id ?? null
    : null;
  if (workId == null && sourceId == null) return; // CHECK 制約: 少なくとも一方必要
  // 重複登録を避けるため既存リンクを確認
  const dup = await query(
    `SELECT 1 FROM contract_works
      WHERE contract_id = $1 AND work_id IS NOT DISTINCT FROM $2 AND source_ip_id IS NOT DISTINCT FROM $3`,
    [contractId, workId, sourceId]
  );
  if (dup.rows.length) return;
  await query(
    `INSERT INTO contract_works (contract_id, work_id, source_ip_id) VALUES ($1, $2, $3)`,
    [contractId, workId, sourceId]
  );
}

/** ダウンロード用サンプル CSV(BOM 付き・Excel UTF-8 対応)。 */
export function getWorkModelSampleCsv(entity: V3Entity): string {
  const samples: Record<V3Entity, string> = {
    "source-ips":
      "source_code,title,title_kana,original_publisher,default_rights_holder,default_credit_display,remarks,rights_holder_vendor_code\n" +
      ",サンプル原作,サンプルゲンサク,サンプル出版,サンプル権利者株式会社,(C)サンプル権利者,初回取込サンプル,\n",
    works:
      "work_code,title,title_kana,work_type,status,division,is_original,parent_work_code,parent_work_title,derivation_type,remarks\n" +
      ",サンプルボードゲーム,サンプルボードゲーム,board_game,planning,BDG,true,,,,初回取込サンプル\n" +
      ",サンプル現地版(派生),サンプルゲンチバン,board_game,planning,BDG,false,W-2026-0001,,localization,親をコードで紐付け,\n" +
      ",サンプル北米版(派生),サンプルホクベイバン,board_game,planning,BDG,false,,サンプルボードゲーム,localization,親を作品名で紐付け(空でも可),\n",
    contracts:
      "document_number,contract_title,contract_level,contract_category,contract_type,lifecycle_stage,effective_date,expiration_date,auto_renewal,primary_vendor_code,work_code,source_code\n" +
      ",サンプル業務委託契約,standalone,service,service_master,requested,2026-04-01,2027-03-31,false,,,\n",
    "work-materials":
      "work_code,material_code,material_name,material_type,material_role,acquisition_type,rights_holder,rights_holder_vendor_code,is_default,remarks\n" +
      // メイン作品(コアロジック): material_code 空欄なら <work_code>-NNN を自動採番。
      "W-2026-0001,,サンプルゲームコアデザイン,ゲームデザイン,core_logic,license,サンプル原作者,,true,原作本体(メイン作品)\n" +
      // サブコンポーネント(業務委託で取得したイラスト)。
      "W-2026-0001,,サンプルイラスト,イラスト,sub_component,業務委託,サンプル絵師,,false,委託制作イラスト\n",
  };
  return "﻿" + samples[entity];
}
