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
