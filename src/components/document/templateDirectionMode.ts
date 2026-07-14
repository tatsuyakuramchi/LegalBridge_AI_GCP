/**
 * templateDirectionMode — テンプレートごとの「請求の向き(FLOW_DIRECTION)」制御モード。
 *
 * 修正計画書 §5.5.4「請求方向の制御」/ LB-F03・LB-F04 に基づく。
 * 従来 DocumentEditorPage は全テンプレで請求の向き(in/out)を必須にしていたが、
 * NDA・通知書・同意書・回答書のような非金銭文書には支払/受取の方向が存在しない。
 * ここでテンプレ属性として方向モードを定義し、エディタ側の必須判定・UI表示・
 * 自動既定を切り替える。
 *
 * 最終的な金銭方向は condition_lines.direction を正本とする(§5.5.4 末尾)。
 * 文書レベルの向きは初期値/集計属性に限定していく方針。
 */

export type DirectionMode =
  // ユーザーが in/out を必ず選ぶ(既定・従来挙動)。
  | "required"
  // 当社が払う(in)を自動既定にする。ユーザーは変更可。
  | "auto_in"
  // 当社が受け取る(out)を自動既定にする。ユーザーは変更可。
  | "auto_out"
  // 親文書(発注書→検収書 等)から方向を継承する。※継承解決は未実装のため
  //   当面は auto_in 相当に丸める(resolveDirectionMode 側では扱わず呼び出し側で判断)。
  | "inherit_parent"
  // 明細(condition_lines.direction)ごとに方向を持つ混在文書。
  | "condition_line"
  // 請求方向の概念が無い(非金銭)。UI 非表示・未選択でも生成可。
  | "not_applicable";

/**
 * テンプレ key → DirectionMode の明示マップ。
 * 未登録テンプレは resolveDirectionMode の既定("required")にフォールバックする
 * (＝従来どおり in/out 必須。安全側)。
 *
 * 現時点では従来挙動を保存する範囲に限定して分類する:
 *   - not_applicable: 非金銭3種(NDA / 法務相談回答書 / 個人情報同意書)。← LB-F04 本体
 *   - auto_in:        従来 auto-default("in")対象だったもの(挙動維持)。
 *   - required(既定): それ以外(基本契約・売買・計算書等)。挙動を変えない。
 *
 * NOTE: 修正計画 §5.5.4 は基本契約(license_master/service_master/*_master)も原則
 *   not_applicable としているが、台帳の方向反映に影響するため本スライスでは required の
 *   まま据え置き、別途決定・移行とする。
 */
export const TEMPLATE_DIRECTION_MODE: Record<string, DirectionMode> = {
  // 非金銭 — 請求方向なし(LB-F04)
  nda: "not_applicable",
  legal_response: "not_applicable",
  notice_consent_personal_info_freelance: "not_applicable",

  // 仕入・支払・ライセンスイン — 当社が払う(in)を既定(従来 auto-default 維持)
  purchase_order: "auto_in",
  individual_license_terms: "auto_in",
  pub_license_terms: "auto_in",
  pub_additional_terms: "auto_in",
  // 検収書は inspection_certificate / inspection_certificate_* の複数派生あり →
  //   resolveDirectionMode で prefix 判定する(下記)。
};

/**
 * テンプレ key から DirectionMode を解決する。
 * - 明示マップ優先
 * - `inspection_certificate` 系は prefix 一致で auto_in(従来 startsWith 挙動を踏襲)
 * - それ以外は既定 "required"
 */
export function resolveDirectionMode(templateKey: string | null | undefined): DirectionMode {
  const key = (templateKey || "").trim();
  if (!key) return "required";
  if (Object.prototype.hasOwnProperty.call(TEMPLATE_DIRECTION_MODE, key)) {
    return TEMPLATE_DIRECTION_MODE[key];
  }
  // 検収書(派生含む)は従来「当社が払う(in)」を既定にしていた。
  if (key.startsWith("inspection_certificate")) return "auto_in";
  return "required";
}

/** 請求の向きが「適用される」テンプレか(= UI 表示・必須判定の対象か)。 */
export function isDirectionApplicable(templateKey: string | null | undefined): boolean {
  return resolveDirectionMode(templateKey) !== "not_applicable";
}
