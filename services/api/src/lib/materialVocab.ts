/**
 * materialVocab — マテリアル分類(Category)の正準語彙(O5 / 正式化)。
 *
 * 設計: docs/design/work-tables-consolidation-plan.md §4.5。
 *   - material_type = 純粋な「ジャンル」(下の MATERIAL_GENRES)。
 *   - material_role = 「役割2層」(本体=core_logic / サブ=sub_component)。0089 で導入。
 *   本体/派生は material_role が担い、material_type はジャンル専用に分離する。
 *
 * 注: 同内容の正規化を api/worker 側 lib/materialVocab にもミラーする(パッケージ分離のため)。
 *   変更時は3箇所を揃えること。
 */

export type MaterialRole = 'core_logic' | 'sub_component';

export interface GenreDef {
  value: string;
  label: string;
  /** 未指定時に推定する既定ロール。 */
  role: MaterialRole;
}

/** 正準ジャンル(value=DB 値, label=UI 表示)。 */
export const MATERIAL_GENRES: GenreDef[] = [
  { value: 'game_design', label: 'オリジナルゲームデザイン', role: 'core_logic' },
  { value: 'manuscript', label: '執筆文書', role: 'core_logic' },
  { value: 'illustration', label: 'イラスト', role: 'sub_component' },
  { value: 'graphic_design', label: 'グラフィックデザイン', role: 'sub_component' },
  { value: 'scenario', label: 'シナリオ', role: 'sub_component' },
  { value: 'music', label: '音楽', role: 'sub_component' },
  { value: 'translation', label: '翻訳', role: 'sub_component' },
  { value: 'editing', label: '編集・校閲', role: 'sub_component' },
  { value: 'text', label: 'テキスト', role: 'sub_component' },
  { value: 'data', label: 'データ', role: 'sub_component' },
  { value: 'other', label: 'その他', role: 'sub_component' },
];

export const MATERIAL_ROLES: { value: MaterialRole; label: string }[] = [
  { value: 'core_logic', label: 'メイン作品（コアロジック）' },
  { value: 'sub_component', label: 'サブコンポーネント' },
];

/** 旧自由語彙・別表記 → 正準ジャンル。構造値(派生/キャラ/設定資料等)はジャンル不明のため other。 */
const GENRE_SYNONYMS: Record<string, string> = {
  'ゲームデザイン': 'game_design', 'コアデザイン': 'game_design', 'gamedesign': 'game_design',
  '執筆': 'manuscript', '執筆文書': 'manuscript', '原稿': 'manuscript',
  'イラスト': 'illustration', 'illust': 'illustration',
  'グラフィック': 'graphic_design', 'グラフィックデザイン': 'graphic_design', 'graphic': 'graphic_design',
  'design': 'graphic_design', 'デザイン': 'graphic_design',
  'シナリオ': 'scenario', '音楽': 'music', '翻訳': 'translation',
  '編集': 'editing', '校閲': 'editing', '編集校閲': 'editing',
  'テキスト': 'text', 'データ': 'data', 'その他': 'other',
  // 構造的レガシー値(ジャンルではない) → other(役割は material_role が担う)
  'derivative': 'other', '派生作品': 'other', 'character': 'other', 'キャラクター': 'other',
  'asset': 'other', '関連アセット': 'other', 'setting': 'other', '設定資料': 'other',
};

const GENRE_VALUES = new Set(MATERIAL_GENRES.map((g) => g.value));

/** 入力値を正準ジャンルへ。未知値は原文維持(grandfathered)。'original' は本体ゆえ別途 division で確定。 */
export function normalizeGenre(v: unknown): string | null {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const k = raw.toLowerCase();
  if (GENRE_SYNONYMS[k]) return GENRE_SYNONYMS[k];
  return GENRE_VALUES.has(k) ? k : raw;
}

export function genreLabel(v?: string | null): string {
  if (!v) return '—';
  return MATERIAL_GENRES.find((g) => g.value === v)?.label || v;
}

export function roleLabel(v?: string | null): string {
  if (!v) return '—';
  return MATERIAL_ROLES.find((r) => r.value === v)?.label || v;
}

export function defaultRoleForGenre(genre?: string | null): MaterialRole {
  return MATERIAL_GENRES.find((g) => g.value === genre)?.role || 'sub_component';
}

/** 役割の正規化。明示値→なければ is_default/ジャンルから推定。 */
export function normalizeRole(v: unknown, genre?: unknown, isDefault?: unknown): MaterialRole {
  const k = String(v ?? '').trim().toLowerCase();
  if (['core_logic', 'core', 'メイン', 'コアロジック', '本体'].includes(k)) return 'core_logic';
  if (['sub_component', 'sub', 'サブ', 'サブコンポーネント'].includes(k)) return 'sub_component';
  if (isDefault === true) return 'core_logic';
  return defaultRoleForGenre(typeof genre === 'string' ? genre : null);
}

/** 事業部(division)から本体ジャンルを確定: PUB→執筆文書 / それ以外→ゲームデザイン。 */
export function coreGenreForDivision(division?: string[] | null): string {
  const divs = Array.isArray(division) ? division.map((d) => String(d).toUpperCase()) : [];
  return divs.includes('PUB') && !divs.includes('BDG') ? 'manuscript' : 'game_design';
}
