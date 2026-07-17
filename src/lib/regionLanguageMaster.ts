/**
 * regionLanguageMaster — 許諾地域(国名単位) / 許諾言語 の選択肢マスター。
 *
 * 条件明細フォームの 許諾地域 / 許諾言語 を「選択式・国名単位・複数選択(1対N)」に
 * するための静的マスター。国・言語は日本語名で提示し、code(ISO or 特別値)で保持する。
 *   - COUNTRIES / LANGUAGES : 主要国・主要言語。
 *   - REGION_PRESETS        : 「北米」「欧州」等。選ぶと配下国を一括追加。
 *   - 特別値                : 全世界(WORLD) / 全言語(ALL_LANG)。
 *
 * 保存は子テーブル(condition_line_regions / condition_line_languages)へ code+name を N 行。
 * 後方互換の region_territory / region_language(結合文字列)は name を「・」連結して合成する。
 */

export type Opt = { code: string; name: string }

// 特別値(国名列挙の代わりに全体を表す)。
export const WORLD: Opt = { code: "WORLD", name: "全世界" }
export const ALL_LANG: Opt = { code: "ALL", name: "全言語" }

// 主要国(日本語名)。code は ISO 3166-1 alpha-2。
export const COUNTRIES: Opt[] = [
  { code: "JP", name: "日本" },
  { code: "US", name: "アメリカ合衆国" },
  { code: "CA", name: "カナダ" },
  { code: "GB", name: "イギリス" },
  { code: "FR", name: "フランス" },
  { code: "DE", name: "ドイツ" },
  { code: "IT", name: "イタリア" },
  { code: "ES", name: "スペイン" },
  { code: "NL", name: "オランダ" },
  { code: "BE", name: "ベルギー" },
  { code: "CH", name: "スイス" },
  { code: "SE", name: "スウェーデン" },
  { code: "PL", name: "ポーランド" },
  { code: "RU", name: "ロシア" },
  { code: "CN", name: "中国" },
  { code: "TW", name: "台湾" },
  { code: "HK", name: "香港" },
  { code: "KR", name: "韓国" },
  { code: "TH", name: "タイ" },
  { code: "SG", name: "シンガポール" },
  { code: "MY", name: "マレーシア" },
  { code: "ID", name: "インドネシア" },
  { code: "VN", name: "ベトナム" },
  { code: "PH", name: "フィリピン" },
  { code: "IN", name: "インド" },
  { code: "AU", name: "オーストラリア" },
  { code: "NZ", name: "ニュージーランド" },
  { code: "BR", name: "ブラジル" },
  { code: "MX", name: "メキシコ" },
]

// 主要言語(日本語名)。code は ISO 639(必要に応じ地域付き)。
export const LANGUAGES: Opt[] = [
  { code: "ja", name: "日本語" },
  { code: "en", name: "英語" },
  { code: "zh-Hans", name: "中国語(簡体)" },
  { code: "zh-Hant", name: "中国語(繁体)" },
  { code: "ko", name: "韓国語" },
  { code: "fr", name: "フランス語" },
  { code: "de", name: "ドイツ語" },
  { code: "es", name: "スペイン語" },
  { code: "it", name: "イタリア語" },
  { code: "pt", name: "ポルトガル語" },
  { code: "nl", name: "オランダ語" },
  { code: "ru", name: "ロシア語" },
  { code: "th", name: "タイ語" },
  { code: "vi", name: "ベトナム語" },
  { code: "id", name: "インドネシア語" },
]

// 地域プリセット: 選ぶと配下国を一括追加する。
export const REGION_PRESETS: { label: string; codes: string[] }[] = [
  { label: "北米", codes: ["US", "CA"] },
  { label: "欧州", codes: ["GB", "FR", "DE", "IT", "ES", "NL", "BE", "CH", "SE", "PL"] },
  { label: "アジア", codes: ["CN", "TW", "HK", "KR", "TH", "SG", "MY", "ID", "VN", "PH", "IN"] },
  { label: "オセアニア", codes: ["AU", "NZ"] },
  { label: "中南米", codes: ["BR", "MX"] },
]

const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]))

export function presetOptions(codes: string[]): Opt[] {
  return codes.map((c) => COUNTRY_BY_CODE.get(c)).filter(Boolean) as Opt[]
}

// 選択(name 配列)を「・」連結の結合ラベルへ(後方互換の region_territory/region_language 用)。
export function composeNames(items: Opt[]): string {
  return items.map((i) => i.name).filter(Boolean).join("・")
}
