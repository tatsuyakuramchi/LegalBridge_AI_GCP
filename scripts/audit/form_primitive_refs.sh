#!/usr/bin/env bash
# form_primitive_refs.sh — 文書フォーム面の「独自Field・生input・旧フォームCSS」の棚卸し
#                          (FRM-03, 設計 v1.4 Phase B「新規独自Field/生input/旧CSS追加を禁止するCIゲート」)
#
# 目的:
#   文書入力フォームは FormField / DocFormKit / SchemaDocumentForm の共通プリミティブへ収斂させる方針。
#   ところが個別テンプレの custom セクション等で生の <input>/<select>/<textarea> や旧フォーム CSS
#   (retro-input 等) が再び増えると、意匠・アクセシビリティ・検証(UIC-08)の一貫性が崩れる。
#   ここを「増やさない(ラチェット)」ための計測。既存分は凍結し、新規追加を CI で弾く。
#
#   計測する 2 系統:
#     A) legacy_css   … 旧フォーム CSS クラス(retro-input / retro-field / legacy-form 等)。目標 0。
#     B) raw_inputs   … src/components/document/ 配下の生 <input>/<select>/<textarea>。
#                       共通プリミティブ本体(FormField.tsx / DocFormKit.tsx)は除外。
#                       既存の独自コンポーネント(V3LicenseMatrix 等)は Phase D 撤去まで凍結。
#
# ripgrep(rg) があれば使い、無い環境(Cloud Build の cloud-sdk イメージ等)では GNU grep -E にフォールバック。
#
# 使い方:
#   scripts/audit/form_primitive_refs.sh                          # サマリ表示
#   scripts/audit/form_primitive_refs.sh --detail                 # 該当行も表示
#   scripts/audit/form_primitive_refs.sh --gate <raw> <css>       # CI ラチェット(上限超過なら非0終了)
set -euo pipefail
cd "$(dirname "$0")/../.."

# A) 旧フォーム CSS クラス(単語境界で拾う)。
LEGACY_CSS_RE="retro-input|retro-field|retro-select|legacy-form|form-legacy|old-form"

# B) 文書フォーム面の生プリミティブ。共通プリミティブ本体は除外する。
RAW_RE="<(input|select|textarea)[ >/]"
DOC_DIR="src/components/document"
EXCLUDE_RE="FormField\.tsx|DocFormKit\.tsx"

if command -v rg >/dev/null 2>&1; then HAVE_RG=1; else HAVE_RG=0; fi

# 生プリミティブの該当行(除外ファイルを除く)。no-match でも非0終了しない。
lines_raw() {
  if [ "$HAVE_RG" = 1 ]; then
    { rg -n "$RAW_RE" "$DOC_DIR" -g '*.tsx' -g '*.ts' 2>/dev/null || true; } | { grep -vE "$EXCLUDE_RE" || true; }
  else
    { grep -rEn --include='*.tsx' --include='*.ts' "$RAW_RE" "$DOC_DIR" 2>/dev/null || true; } | { grep -vE "$EXCLUDE_RE" || true; }
  fi
}
count_raw() { lines_raw | grep -c . || true; }

# 旧 CSS の該当行(src 全体)。no-match でも非0終了しない。
lines_css() {
  if [ "$HAVE_RG" = 1 ]; then
    rg -n "$LEGACY_CSS_RE" src -g '*.tsx' -g '*.ts' -g '*.css' 2>/dev/null || true
  else
    grep -rEn --include='*.tsx' --include='*.ts' --include='*.css' "$LEGACY_CSS_RE" src 2>/dev/null || true
  fi
}
count_css() { lines_css | grep -c . || true; }

RAW=$(count_raw)
CSS=$(count_css)

echo "== 文書フォーム面の生プリミティブ / 旧フォーム CSS (FRM-03 ラチェット) =="
echo "-- raw_inputs(${DOC_DIR}, 生 <input>/<select>/<textarea>, プリミティブ本体除外) = ${RAW}"
if [ "$HAVE_RG" = 1 ]; then
  lines_raw | sed -E 's#:[0-9]+:.*##' | sort | uniq -c | sort -rn
fi
echo "-- legacy_css(retro-input 等, 目標 0) = ${CSS}"
echo ""
echo "== サマリ =="
echo "raw_form_inputs=${RAW}"
echo "legacy_form_css=${CSS}"

if [ "${1:-}" = "--detail" ]; then
  echo ""
  echo "== 該当行(raw_inputs) =="
  lines_raw
  echo ""
  echo "== 該当行(legacy_css) =="
  lines_css
fi

# CI ラチェット: --gate <raw上限> <css上限>。どちらか超過で非0終了。
if [ "${1:-}" = "--gate" ]; then
  MAXRAW="${2:?--gate には raw 上限を指定}"
  MAXCSS="${3:?--gate には css 上限を指定}"
  FAIL=0
  if [ "$RAW" -gt "$MAXRAW" ]; then
    echo "NG: 文書フォーム面の生プリミティブが ${RAW} 箇所 (> 上限 ${MAXRAW})。" >&2
    echo "    入力は FormField / DocFormKit(FkField 等) の共通プリミティブへ。" >&2
    FAIL=1
  fi
  if [ "$CSS" -gt "$MAXCSS" ]; then
    echo "NG: 旧フォーム CSS クラスが ${CSS} 箇所 (> 上限 ${MAXCSS})。" >&2
    echo "    retro-input 等の旧クラスは使わず Tailwind ユーティリティ / FormField に統一。" >&2
    FAIL=1
  fi
  if [ "$FAIL" = 1 ]; then exit 1; fi
  echo "OK: raw_inputs ${RAW} (<= ${MAXRAW}) / legacy_css ${CSS} (<= ${MAXCSS})"
fi
