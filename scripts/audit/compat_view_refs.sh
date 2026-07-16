#!/usr/bin/env bash
# compat_view_refs.sh — 互換VIEW(contract_capabilities / capability_*)参照の棚卸し (LB-12)
#
# Phase 4「DB安定化」〜 Phase 7「レガシー撤去」の進捗計測に使う。
#   - 書込み(INSERT/UPDATE/DELETE)は Phase 4 で実体表(documents/condition_lines)直書きへ移行する対象
#   - 読取り(FROM/JOIN)は Phase 7 で VIEW ごと撤去する際の対象
#   - CI で「書込みゼロ」「参照ゼロ」をゲートにする想定(計画 §9 Phase 7)
#
# 使い方:
#   scripts/audit/compat_view_refs.sh                 # サマリ表示
#   scripts/audit/compat_view_refs.sh --detail        # 該当行も表示
#   scripts/audit/compat_view_refs.sh --gate-writes 0 # CI ゲート(書込みが上限超過なら非0終了)
#
# ripgrep(rg) があれば使い、無い環境(Cloud Build の cloud-sdk イメージ等)では
# GNU grep -E にフォールバックする(\b / [[:space:]] は両者で解釈が一致)。
#
# 期待値の推移は docs/plans/phase4-compat-retirement-plan.md の進捗表を更新すること。
set -euo pipefail
cd "$(dirname "$0")/../.."

VIEWS='contract_capabilities|capability_financial_conditions|capability_line_items|capability_expenses|capability_other_fees'
WRITE_RE="(INSERT INTO|UPDATE|DELETE FROM)[[:space:]]+(${VIEWS})\\b"
READ_RE="(FROM|JOIN)[[:space:]]+(${VIEWS})\\b"

if command -v rg >/dev/null 2>&1; then HAVE_RG=1; else HAVE_RG=0; fi

# ファイル別ヒット数(0件のファイルは出さない)。引数: パターン ディレクトリ...
per_file_counts() {
  local re="$1"; shift
  if [ "$HAVE_RG" = 1 ]; then
    { rg -c "$re" "$@" -g '*.ts' -g '*.tsx' 2>/dev/null || true; } | sort -t: -k2 -rn
  else
    { grep -rEc --include='*.ts' --include='*.tsx' "$re" "$@" 2>/dev/null || true; } \
      | grep -v ':0$' | sort -t: -k2 -rn || true
  fi
}

# マッチ文字列のみを列挙(ファイル名なし)。合計数や内訳集計に使う。
matches_only() {
  local re="$1"; shift
  if [ "$HAVE_RG" = 1 ]; then
    rg -o "$re" "$@" -g '*.ts' -g '*.tsx' -N --no-filename 2>/dev/null || true
  else
    grep -rEoh --include='*.ts' --include='*.tsx' "$re" "$@" 2>/dev/null || true
  fi
}

# 行番号つき該当行(--detail 用)。
matching_lines() {
  local re="$1"; shift
  if [ "$HAVE_RG" = 1 ]; then
    rg -n "$re" "$@" -g '*.ts' -g '*.tsx' 2>/dev/null || true
  else
    grep -rEn --include='*.ts' --include='*.tsx' "$re" "$@" 2>/dev/null || true
  fi
}

echo "== 互換VIEWへの書込み (Phase 4 で撤去対象) =="
WRITE_FILES=$(per_file_counts "$WRITE_RE" services)
[ -n "$WRITE_FILES" ] && echo "$WRITE_FILES" || echo "(なし)"
WRITE_TOTAL=$(matches_only "$WRITE_RE" services | wc -l | tr -d ' ')
echo "-- 書込み合計: ${WRITE_TOTAL}"
echo ""
echo "== 操作×VIEW別の内訳 =="
matches_only "$WRITE_RE" services | sort | uniq -c | sort -rn
echo ""
echo "== 互換VIEWの読取り (Phase 7 で撤去対象) =="
READ_FILES=$(per_file_counts "$READ_RE" services src)
[ -n "$READ_FILES" ] && echo "$READ_FILES" || echo "(なし)"
READ_TOTAL=$(matches_only "$READ_RE" services src | wc -l | tr -d ' ')
echo "-- 読取り合計: ${READ_TOTAL}"
echo ""
echo "== サマリ =="
echo "writes=${WRITE_TOTAL} reads=${READ_TOTAL}"
if [ "${1:-}" = "--detail" ]; then
  echo ""
  echo "== 書込み該当行 =="
  matching_lines "$WRITE_RE" services
fi
# CI ゲート用: --gate-writes N で書込みが N を超えたら非0終了(退行防止)
if [ "${1:-}" = "--gate-writes" ]; then
  MAX="${2:?--gate-writes には上限数を指定}"
  if [ "$WRITE_TOTAL" -gt "$MAX" ]; then
    echo "NG: 互換VIEW書込みが ${WRITE_TOTAL} 箇所 (> 上限 ${MAX})。直書きへ移行してください。" >&2
    exit 1
  fi
  echo "OK: 互換VIEW書込み ${WRITE_TOTAL} 箇所 (<= 上限 ${MAX})"
fi
