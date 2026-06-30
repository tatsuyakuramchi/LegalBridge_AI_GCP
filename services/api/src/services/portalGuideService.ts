/**
 * portalGuideService — 法務ポータルのガイド(DB 化)の読取サービス(search-api / read)。
 *
 * 書込(版の追加・公開切替・メタ編集)は worker(release/worker)が所有する。
 * 本サービスは SELECT のみ:
 *   - listCategories / listGuides / guidesInCategory : ポータル・カテゴリ描画
 *   - getGuideByKey / renderGuideHtml                : 各ガイド配信(GAS タグ変換つき)
 *   - listGuidesForAdmin                             : 管理画面の一覧(版数・更新日)
 *
 * 「公開中(ready)」= status='published' かつ current_version_id がある。
 *   それ以外はカテゴリページで「準備中」表示になる(ファイル未投入の search/eventinst 等)。
 */

import { query } from "../lib/db.ts";
import { renderGuide } from "../lib/portalRender.ts";

export interface GuideCategory {
  catKey: string;
  label: string;
  color: string | null;
  description: string | null;
  sortOrder: number;
}

export interface GuideMeta {
  guideKey: string;
  categoryKey: string | null;
  guideNum: string | null;
  title: string;
  summary: string | null;
  isOverview: boolean;
  status: string;
  needsRuntime: boolean;
  sortOrder: number;
  /** リンク型ガイド: 設定時はカードがこのパスへ遷移(本文版は不要)。例: /search/vendor。 */
  linkPath: string | null;
  ready: boolean;
}

export interface GuideAdminRow extends GuideMeta {
  categoryLabel: string | null;
  versionCount: number;
  currentVersionNo: number | null;
  updatedAt: string | null;
}

function toMeta(r: any): GuideMeta {
  return {
    guideKey: r.guide_key,
    categoryKey: r.category_key ?? null,
    guideNum: r.guide_num ?? null,
    title: r.title,
    summary: r.summary ?? null,
    isOverview: !!r.is_overview,
    status: r.status,
    needsRuntime: !!r.needs_runtime,
    sortOrder: Number(r.sort_order ?? 0),
    linkPath: r.link_path ?? null,
    ready:
      r.status === "published" &&
      (r.current_version_id != null || r.link_path != null),
  };
}

/** 有効カテゴリを表示順で返す。 */
export async function listCategories(): Promise<GuideCategory[]> {
  const { rows } = await query(
    `SELECT cat_key, label, color, description, sort_order
       FROM portal_guide_categories
      WHERE is_active = TRUE
      ORDER BY sort_order, id`
  );
  return rows.map((r) => ({
    catKey: r.cat_key,
    label: r.label,
    color: r.color,
    description: r.description,
    sortOrder: Number(r.sort_order ?? 0),
  }));
}

/** 有効ガイドを(overview を含め)カテゴリ順・表示順で返す。 */
export async function listGuides(): Promise<GuideMeta[]> {
  const { rows } = await query(
    `SELECT g.guide_key, c.cat_key AS category_key, g.guide_num, g.title, g.summary,
            g.is_overview, g.status, g.needs_runtime, g.sort_order, g.current_version_id, g.link_path
       FROM portal_guides g
       LEFT JOIN portal_guide_categories c ON c.id = g.category_id
      WHERE g.is_active = TRUE
      ORDER BY c.sort_order NULLS FIRST, g.sort_order, g.id`
  );
  return rows.map(toMeta);
}

/** あるカテゴリに属するガイド(overview 除く)を表示順で返す。 */
export async function guidesInCategory(catKey: string): Promise<GuideMeta[]> {
  const { rows } = await query(
    `SELECT g.guide_key, c.cat_key AS category_key, g.guide_num, g.title, g.summary,
            g.is_overview, g.status, g.needs_runtime, g.sort_order, g.current_version_id, g.link_path
       FROM portal_guides g
       JOIN portal_guide_categories c ON c.id = g.category_id
      WHERE g.is_active = TRUE AND c.cat_key = $1
      ORDER BY g.sort_order, g.id`,
    [catKey]
  );
  return rows.map(toMeta);
}

/** 1 ガイドのメタを返す(無ければ null)。 */
export async function getGuideByKey(key: string): Promise<GuideMeta | null> {
  const { rows } = await query(
    `SELECT g.guide_key, c.cat_key AS category_key, g.guide_num, g.title, g.summary,
            g.is_overview, g.status, g.needs_runtime, g.sort_order, g.current_version_id, g.link_path
       FROM portal_guides g
       LEFT JOIN portal_guide_categories c ON c.id = g.category_id
      WHERE g.guide_key = $1 AND g.is_active = TRUE
      LIMIT 1`,
    [key]
  );
  return rows[0] ? toMeta(rows[0]) : null;
}

/**
 * ガイドの配信 HTML を返す。公開中(ready)で現行版があれば GAS タグ変換して返す。
 * 未公開・現行版なし(=準備中)なら null。
 */
export async function renderGuideHtml(key: string): Promise<string | null> {
  const { rows } = await query(
    `SELECT v.html_source
       FROM portal_guides g
       JOIN portal_guide_versions v ON v.id = g.current_version_id
      WHERE g.guide_key = $1 AND g.is_active = TRUE AND g.status = 'published'
      LIMIT 1`,
    [key]
  );
  if (!rows[0]) return null;
  return renderGuide(rows[0].html_source as string);
}

/** 管理画面用の一覧(カテゴリ・版数・現行版・更新日つき)。 */
export async function listGuidesForAdmin(): Promise<GuideAdminRow[]> {
  const { rows } = await query(
    `SELECT g.guide_key, c.cat_key AS category_key, c.label AS category_label,
            g.guide_num, g.title, g.summary, g.is_overview, g.status, g.needs_runtime,
            g.sort_order, g.current_version_id, g.link_path, g.updated_at,
            (SELECT COUNT(*) FROM portal_guide_versions v WHERE v.guide_id = g.id) AS version_count,
            (SELECT version_no FROM portal_guide_versions v WHERE v.id = g.current_version_id) AS current_version_no
       FROM portal_guides g
       LEFT JOIN portal_guide_categories c ON c.id = g.category_id
      WHERE g.is_active = TRUE
      ORDER BY c.sort_order NULLS FIRST, g.sort_order, g.id`
  );
  return rows.map((r) => ({
    ...toMeta(r),
    categoryLabel: r.category_label ?? null,
    versionCount: Number(r.version_count ?? 0),
    currentVersionNo: r.current_version_no != null ? Number(r.current_version_no) : null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }));
}

// ───────────────────────────────────────────────────────────────────
// カテゴリ管理(admin 書込)。サイトのカテゴリ(A〜D 等)の追加・編集・削除。
//   search-api は同一プールで書込する(vendor 取込等と同様)。認可は呼び出し側
//   (server.ts requireAppRole admin)が担保する。
// ───────────────────────────────────────────────────────────────────

export interface CategoryAdminRow extends GuideCategory {
  isActive: boolean;
  guideCount: number;
}

const CAT_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** 管理用: 全カテゴリ(非activeも含む)＋所属ガイド数。 */
export async function listCategoriesForAdmin(): Promise<CategoryAdminRow[]> {
  const { rows } = await query(
    `SELECT c.cat_key, c.label, c.color, c.description, c.sort_order, c.is_active,
            (SELECT COUNT(*) FROM portal_guides g WHERE g.category_id = c.id) AS guide_count
       FROM portal_guide_categories c
      ORDER BY c.sort_order, c.id`
  );
  return rows.map((r) => ({
    catKey: r.cat_key,
    label: r.label,
    color: r.color,
    description: r.description,
    sortOrder: Number(r.sort_order ?? 0),
    isActive: !!r.is_active,
    guideCount: Number(r.guide_count ?? 0),
  }));
}

/** カテゴリ作成。cat_key は URL スラッグ(/c/:cat)。 */
export async function createCategory(input: {
  catKey: string;
  label: string;
  color?: string | null;
  description?: string | null;
  sortOrder?: number | null;
}): Promise<void> {
  const catKey = String(input.catKey || "").trim();
  const label = String(input.label || "").trim();
  if (!CAT_KEY_RE.test(catKey)) {
    throw new Error("cat_key は英小文字/数字/_/- の40文字以内で指定してください");
  }
  if (!label) throw new Error("label は必須です");
  const dup = await query(`SELECT 1 FROM portal_guide_categories WHERE cat_key = $1`, [catKey]);
  if (dup.rowCount) throw new Error(`cat_key '${catKey}' は既に存在します`);
  // sort_order 未指定なら末尾。
  const so =
    input.sortOrder != null
      ? Number(input.sortOrder)
      : Number(
          (await query(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM portal_guide_categories`)).rows[0].n
        );
  await query(
    `INSERT INTO portal_guide_categories (cat_key, label, color, description, sort_order, is_active)
     VALUES ($1,$2,$3,$4,$5, TRUE)`,
    [catKey, label, input.color ?? null, input.description ?? null, so]
  );
}

/** カテゴリ更新(label/color/description/sort_order/is_active)。cat_key は不変。 */
export async function updateCategory(
  catKey: string,
  patch: {
    label?: string;
    color?: string | null;
    description?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  }
): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (patch.label !== undefined) {
    const v = String(patch.label).trim();
    if (!v) throw new Error("label は空にできません");
    sets.push(`label = $${i++}`);
    vals.push(v);
  }
  if (patch.color !== undefined) {
    sets.push(`color = $${i++}`);
    vals.push(patch.color || null);
  }
  if (patch.description !== undefined) {
    sets.push(`description = $${i++}`);
    vals.push(patch.description || null);
  }
  if (patch.sortOrder !== undefined) {
    sets.push(`sort_order = $${i++}`);
    vals.push(Number(patch.sortOrder));
  }
  if (patch.isActive !== undefined) {
    sets.push(`is_active = $${i++}`);
    vals.push(!!patch.isActive);
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = now()`);
  vals.push(catKey);
  const res = await query(
    `UPDATE portal_guide_categories SET ${sets.join(", ")} WHERE cat_key = $${i}`,
    vals
  );
  if (res.rowCount === 0) throw new Error(`cat_key '${catKey}' が見つかりません`);
}

/**
 * ガイドのメタ更新(admin)。category(付け替え)・sort_order(並び順)を更新。
 *   categoryKey: cat_key を渡すとそのカテゴリへ付け替え。空/null は未分類(category_id=null)。
 */
export async function updateGuide(
  guideKey: string,
  patch: { categoryKey?: string | null; sortOrder?: number }
): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (patch.categoryKey !== undefined) {
    let catId: number | null = null;
    const ck = (patch.categoryKey || "").trim();
    if (ck) {
      const c = await query(`SELECT id FROM portal_guide_categories WHERE cat_key = $1`, [ck]);
      if (c.rowCount === 0) throw new Error(`カテゴリ '${ck}' が見つかりません`);
      catId = c.rows[0].id;
    }
    sets.push(`category_id = $${i++}`);
    vals.push(catId);
  }
  if (patch.sortOrder !== undefined) {
    sets.push(`sort_order = $${i++}`);
    vals.push(Number(patch.sortOrder));
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = now()`);
  vals.push(guideKey);
  const res = await query(
    `UPDATE portal_guides SET ${sets.join(", ")} WHERE guide_key = $${i}`,
    vals
  );
  if (res.rowCount === 0) throw new Error(`guide '${guideKey}' が見つかりません`);
}

/** カテゴリ削除。所属ガイドがある場合はブロック(先に付け替えが必要)。 */
export async function deleteCategory(catKey: string): Promise<void> {
  const c = await query(`SELECT id FROM portal_guide_categories WHERE cat_key = $1`, [catKey]);
  if (c.rowCount === 0) throw new Error(`cat_key '${catKey}' が見つかりません`);
  const cnt = await query(`SELECT COUNT(*) AS n FROM portal_guides WHERE category_id = $1`, [
    c.rows[0].id,
  ]);
  if (Number(cnt.rows[0].n) > 0) {
    throw new Error(
      `このカテゴリには ${cnt.rows[0].n} 件のガイドが属しています。先に別カテゴリへ付け替えてください。`
    );
  }
  await query(`DELETE FROM portal_guide_categories WHERE cat_key = $1`, [catKey]);
}

// ───────────────────────────────────────────────────────────────────
// ガイド本文の差し替え(admin 書込): 新版アップロード・公開トグル・版ロールバック。
//   GAS 原文をそのまま版として保存(配信時に portalRender が変換)。
// ───────────────────────────────────────────────────────────────────

export interface GuideVersionRow {
  versionNo: number;
  createdAt: string | null;
  createdBy: string | null;
  comment: string | null;
  chars: number;
  isCurrent: boolean;
}

/** ガイドの版一覧(新しい順)。現行版に印。 */
export async function listGuideVersions(guideKey: string): Promise<GuideVersionRow[]> {
  const { rows } = await query(
    `SELECT v.version_no, v.created_at, v.created_by, v.comment,
            length(v.html_source) AS chars,
            (v.id = g.current_version_id) AS is_current
       FROM portal_guide_versions v
       JOIN portal_guides g ON g.id = v.guide_id
      WHERE g.guide_key = $1
      ORDER BY v.version_no DESC`,
    [guideKey]
  );
  return rows.map((r) => ({
    versionNo: Number(r.version_no),
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    createdBy: r.created_by ?? null,
    comment: r.comment ?? null,
    chars: Number(r.chars ?? 0),
    isCurrent: !!r.is_current,
  }));
}

/** 新版アップロード: 版を1つ追加し current にして公開する。version_no を返す。 */
export async function addGuideVersion(
  guideKey: string,
  html: string,
  createdBy?: string | null,
  comment?: string | null
): Promise<number> {
  const html2 = String(html ?? "");
  if (!html2.trim()) throw new Error("HTML が空です");
  const g = await query(`SELECT id FROM portal_guides WHERE guide_key = $1`, [guideKey]);
  if (g.rowCount === 0) throw new Error(`guide '${guideKey}' が見つかりません`);
  const gid = g.rows[0].id;
  const mv = await query(
    `SELECT COALESCE(MAX(version_no),0) AS m FROM portal_guide_versions WHERE guide_id = $1`,
    [gid]
  );
  const next = Number(mv.rows[0].m) + 1;
  const ins = await query(
    `INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [gid, next, html2, comment || "admin upload", createdBy || "admin"]
  );
  await query(
    `UPDATE portal_guides SET current_version_id = $1, status = 'published', updated_at = now() WHERE id = $2`,
    [ins.rows[0].id, gid]
  );
  return next;
}

/** 公開トグル: published / draft。公開は現行版 or link_path が必要。 */
export async function setGuideStatus(
  guideKey: string,
  status: "published" | "draft"
): Promise<void> {
  if (status !== "published" && status !== "draft") {
    throw new Error("status は published / draft のいずれか");
  }
  const g = await query(
    `SELECT id, current_version_id, link_path FROM portal_guides WHERE guide_key = $1`,
    [guideKey]
  );
  if (g.rowCount === 0) throw new Error(`guide '${guideKey}' が見つかりません`);
  if (status === "published" && g.rows[0].current_version_id == null && g.rows[0].link_path == null) {
    throw new Error("公開するには現行版(本文)またはリンクが必要です");
  }
  await query(`UPDATE portal_guides SET status = $1, updated_at = now() WHERE id = $2`, [
    status,
    g.rows[0].id,
  ]);
}

/** 版ロールバック: current_version_id を指定 version_no の版へ。公開状態にする。 */
export async function rollbackGuideVersion(guideKey: string, versionNo: number): Promise<void> {
  const g = await query(`SELECT id FROM portal_guides WHERE guide_key = $1`, [guideKey]);
  if (g.rowCount === 0) throw new Error(`guide '${guideKey}' が見つかりません`);
  const v = await query(
    `SELECT id FROM portal_guide_versions WHERE guide_id = $1 AND version_no = $2`,
    [g.rows[0].id, Number(versionNo)]
  );
  if (v.rowCount === 0) throw new Error(`版 v${versionNo} が見つかりません`);
  await query(
    `UPDATE portal_guides SET current_version_id = $1, status = 'published', updated_at = now() WHERE id = $2`,
    [v.rows[0].id, g.rows[0].id]
  );
}
