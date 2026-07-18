/**
 * formValidation — 文書フォームの入力検証「基盤」(UIC-08, 設計 v1.4 Phase B)。
 *
 * これまでの検証は DocumentEditorPage.handleGenerate の中にベタ書きで、
 *   「required=true のトップレベル項目が空か」だけを見ていた。UIC-08 は
 *   その判定を単一の再利用可能モジュールへ切り出し、次を「基盤」として足す:
 *
 *   1. required (必須・空)          … 従来どおり(単一ソース化)
 *   2. type    (数値・日付の型)      … number/date 型の項目に明らかな不正値
 *   3. line    (動的明細の行検証)    … 配列/明細セクションの最小行数・必須セル
 *
 * 設計上の要点:
 *   - PDF テンプレ(Handlebars)も formData のキーも不変。ここは「値の妥当性」だけを見る。
 *   - type/line は False Positive を避けるため保守的(明らかな不正のみ弾く)。
 *     数値欄に「応相談」等の自由記述が入る運用があるため、区切り記号を除いて
 *     なお数字にならない場合のみ type エラーにする。日付も「数字を含むのに
 *     日付として解釈不能」なときだけ弾く(フリーテキストは素通し)。
 *   - 動的明細は metadata では宣言されないため、呼び出し側が extraValidators として
 *     差し込めるようにする(テンプレ固有の明細ルールの拡張口)。将来 metadata に
 *     type:"array" / itemRequired が入れば line 検証がそのまま働く。
 */

export type DocValidationKind = "required" | "type" | "line";

export type DocValidationIssue = {
  /** 対象フィールド id(スクロール/フォーカス用に data-field-id と一致させる)。 */
  id: string;
  /** 表示ラベル。 */
  label: string;
  kind: DocValidationKind;
  /** ユーザー向けの短い説明。 */
  message: string;
};

/** テンプレ固有の動的明細などを検証する拡張口。 */
export type DocExtraValidator = (
  formData: Record<string, any>,
  metadata: any
) => DocValidationIssue[];

export type ValidateDocFormArgs = {
  metadata: any;
  formData: Record<string, any>;
  /** true を返した (id) はスキップ(条件付き必須の除外に使う)。 */
  skipField?: (id: string, formData: Record<string, any>) => boolean;
  /** 動的明細など、metadata で表現できない検証を足す。 */
  extraValidators?: DocExtraValidator[];
};

/** 空値判定(文字列は trim して空、null/undefined、空配列)。 */
export function isEmptyValue(v: any): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

// 数値欄で許容する区切り・単位(全角/半角のカンマ・空白・通貨・%・読点)。
const NUM_STRIP_RE = /[\s,，、¥￥$＄%％円]/g;
const NUM_OK_RE = /^[-+]?\d*\.?\d+$/;

/** number 型の値が「明らかに数値でない」か。空/自由記述は false(弾かない)。 */
function isBadNumber(v: any): boolean {
  if (isEmptyValue(v)) return false;
  if (typeof v === "number") return !Number.isFinite(v);
  const s = String(v).replace(NUM_STRIP_RE, "");
  if (s === "") return false; // 区切りだけ → 実質空とみなし弾かない
  return !NUM_OK_RE.test(s);
}

/** date 型の値が「数字を含むのに日付として解釈できない」か。フリーテキストは弾かない。 */
function isBadDate(v: any): boolean {
  if (isEmptyValue(v)) return false;
  const s = String(v).trim();
  if (!/\d/.test(s)) return false; // 「別途協議」等 → 日付欄でも素通し
  const norm = s.replace(/[./年月]/g, "-").replace(/日/g, "").replace(/-+$/g, "");
  return Number.isNaN(Date.parse(norm));
}

const typeOf = (meta: any): string => String(meta?.type || "");

/**
 * 単一ソースの文書フォーム検証。issue の配列を返す(空 = 妥当)。
 * 先頭要素はフォーム上でいちばん上の問題になるよう、metadata の宣言順を保つ。
 */
export function validateDocForm(args: ValidateDocFormArgs): DocValidationIssue[] {
  const { metadata, formData, skipField, extraValidators } = args;
  const issues: DocValidationIssue[] = [];
  const vars: Record<string, any> = metadata?.vars || {};

  for (const [id, m] of Object.entries<any>(vars)) {
    if (m?.hidden === true || typeOf(m) === "hidden") continue;
    if (skipField && skipField(id, formData)) continue;

    const label: string = m?.label || id.replace(/_/g, " ");
    const t = typeOf(m);
    const isLine = t === "array" || m?.line === true;
    const v = formData?.[id];

    // 1) 必須。
    if (m?.required === true && isEmptyValue(v)) {
      issues.push({
        id,
        label,
        kind: isLine ? "line" : "required",
        message: isLine ? "1 行以上入力してください" : "必須項目です",
      });
      // 必須が空なら型検証は無意味なので次へ。
      continue;
    }

    // 2) 型(数値・日付)。空はここまでに到達しないか、required でないので素通し。
    if (t === "number" && isBadNumber(v)) {
      issues.push({ id, label, kind: "type", message: "数値を入力してください" });
    } else if (t === "date" && isBadDate(v)) {
      issues.push({
        id,
        label,
        kind: "type",
        message: "日付の形式が正しくありません (YYYY-MM-DD)",
      });
    }

    // 3) 明細の行内必須セル(metadata が itemRequired:string[] を宣言していれば)。
    if (isLine && Array.isArray(v) && Array.isArray(m?.itemRequired) && m.itemRequired.length) {
      const bad = v.some(
        (row: any) => row && m.itemRequired.some((k: string) => isEmptyValue(row?.[k]))
      );
      if (bad) {
        issues.push({
          id,
          label,
          kind: "line",
          message: `明細の必須項目(${m.itemRequired.join("・")})が未入力の行があります`,
        });
      }
    }
  }

  // 4) テンプレ固有の動的明細など。
  if (extraValidators) {
    for (const fn of extraValidators) {
      try {
        const extra = fn(formData, metadata);
        if (Array.isArray(extra)) issues.push(...extra);
      } catch {
        // 拡張バリデータの失敗で生成を止めない(基盤は堅牢側に倒す)。
      }
    }
  }

  return issues;
}

/** 表示用: issue 配列から「先頭数件を要約した1行メッセージ」を組み立てる。 */
export function summarizeIssues(issues: DocValidationIssue[], max = 5): string {
  const allRequired = issues.every((x) => x.kind === "required");
  const head = issues.slice(0, max).map((x) => {
    // required は従来どおりラベルのみ、それ以外は理由を併記。
    return x.kind === "required" ? x.label : `${x.label}（${x.message}）`;
  });
  const tail = issues.length > max ? ` 他 ${issues.length - max} 件` : "";
  const lead = allRequired ? "必須項目が未入力です" : "入力を確認してください";
  return `${lead}: ${head.join("、")}${tail}。最初の項目までスクロールします。`;
}
