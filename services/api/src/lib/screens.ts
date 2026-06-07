/**
 * 画面レジストリ + 権限マトリクス (Phase 25: ナビ役割化)
 *
 * search-api がサーバーレンダリングする全 HTML 画面を 1 か所で定義する。
 * これを唯一の真実として:
 *   - サイドバー(popChrome.navHtml)   … ログイン者の役割で絞って描画
 *   - ルートガード(requireScreen)       … minRole 未満は 403
 *   - トップ/案内ページのリンク生成     … 役割に応じた導線を自動生成
 * がすべて参照する。これにより「ページごとにナビが変わる/役割と画面が
 * 食い違う」問題を解消する。
 *
 * 役割は staff.app_role に一本化 (admin / viewer)。department ベースの
 * soft-role は廃止方針。
 */

export type Role = "viewer" | "admin";

/** 役割の強さ。比較に使う (admin > viewer)。 */
export const ROLE_RANK: Record<Role, number> = { viewer: 1, admin: 2 };

/** role が min 以上の権限を持つか。 */
export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** ナビ上のセクション。console=管理者向けマスター/管理、browse=検索閲覧。 */
export type NavSection = "console" | "browse";

export type ScreenKey =
  | "search-vendor"
  | "ringi"
  | "template-preview"
  | "conditions"
  | "vendors"
  | "contracts"
  | "staff"
  | "work-model"
  | "receivable-map"
  | "admin";

export type Screen = {
  key: ScreenKey;
  path: string;
  label: string;
  icon: string;
  section: NavSection;
  /** これ未満の役割は 403、かつサイドバー非表示。 */
  minRole: Role;
  /** サイドバーに出すか (false でもルートは存在する。例: 稟議は番号入力式)。 */
  nav: boolean;
};

/**
 * 画面定義。配列順がサイドバーの表示順。
 *   - console (admin 専用): マスター CRUD・台帳・管理
 *   - browse  (viewer 可) : 検索・閲覧・プレビュー
 */
export const SCREENS: Screen[] = [
  // ── Master Console (admin 専用) ───────────────────────────
  { key: "vendors",        path: "/master/vendors",        label: "取引先",            icon: "🏢", section: "console", minRole: "admin", nav: true },
  { key: "staff",          path: "/master/staff",          label: "スタッフ",          icon: "👥", section: "console", minRole: "admin", nav: true },
  { key: "contracts",      path: "/master/contracts",      label: "契約台帳",          icon: "📄", section: "console", minRole: "admin", nav: true },
  { key: "work-model",     path: "/work-model",            label: "作品モデル",        icon: "🎬", section: "console", minRole: "admin", nav: true },
  { key: "receivable-map", path: "/master/receivable-map", label: "分配構造マップ",    icon: "🔀", section: "console", minRole: "admin", nav: true },
  { key: "conditions",     path: "/master/conditions",     label: "条件明細",          icon: "🧾", section: "console", minRole: "admin", nav: true },
  { key: "admin",          path: "/admin",                 label: "管理",              icon: "⚙️", section: "console", minRole: "admin", nav: true },

  // ── Search & Browse (viewer 可) ───────────────────────────
  { key: "search-vendor",    path: "/search/vendor",     label: "取引先・契約検索", icon: "⌕",  section: "browse", minRole: "viewer", nav: true },
  { key: "template-preview", path: "/templates/preview", label: "ひな型プレビュー", icon: "📄", section: "browse", minRole: "viewer", nav: true },
  { key: "ringi",            path: "/search/ringi",      label: "稟議番号検索",     icon: "📋", section: "browse", minRole: "viewer", nav: false },
];

/** セクション見出し。 */
export const SECTION_TITLES: Record<NavSection, string> = {
  console: "⚙ Master Console",
  browse: "🔍 Search & Browse",
};

export function screenByKey(key: ScreenKey): Screen | undefined {
  return SCREENS.find((s) => s.key === key);
}

/** 役割が閲覧でき、かつナビ表示対象の画面を、セクション順で返す。 */
export function navScreensForRole(role: Role, section: NavSection): Screen[] {
  return SCREENS.filter(
    (s) => s.section === section && s.nav && roleAtLeast(role, s.minRole)
  );
}
