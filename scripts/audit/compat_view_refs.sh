#!/usr/bin/env bash
# compat_view_refs.sh — 互換VIEW(contract_capabilities / capability_*)参照の棚卸し (LB-12)
#
# Phase 4「DB安定化」〜 Phase 7「レガシー撤去」の進捗計測に使う。
#   - 書込み(INSERT/UPDATE/DELETE)は Phase 4 で実体表(documents/condition_lines)直書きへ移行する対象
#   - 読取り(FROM/JOIN)は Phase 7 で VIEW ごと撤去する際の対象
#   - CI で「書込みゼロ」「参照ゼロ」をゲートにする想定(計画 §9 Phase 7)
#
# 使い方:
#   scripts/audit/compat_view_refs.sh            # サマリ表示
#   scripts/audit/compat_view_refs.sh --detail   # 該当行も表示
#
# 期待値の推移は docs/plans/phase4-compat-retirement-plan.md の進捗表を更新すること。
set -euo pipefail
cd "$(dirname "$0")/../.."

VIEWS='contract_capabilities|capability_financial_conditions|capability_line_items|capability_expenses|capability_other_fees'
WRITE_RE="(INSERT INTO|UPDATE|DELETE FROM)[[:space:]]+(${VIEWS})\\b"
READ_RE="(FROM|JOIN)[[:space:]]+(${VIEWS})\\b"

echo "== 互換VIEWへの書込み (Phase 4 で撤去対象) =="
rg -c "$WRITE_RE" services -g '*.ts' 2>/dev/null | sort -t: -k2 -rn || echo "(なし)"
WRITE_TOTAL=$(rg -o "$WRITE_RE" services -g '*.ts' 2>/dev/null | wc -l | tr -d ' ')
echo "-- 書込み合計: ${WRITE_TOTAL}"
echo ""
echo "== 操作×VIEW別の内訳 =="
rg -o "$WRITE_RE" services -g '*.ts' -N 2>/dev/null | cut -d: -f2- | sort | uniq -c | sort -rn || true
echo ""
echo "== 互換VIEWの読取り (Phase 7 で撤去対象) =="
rg -c "$READ_RE" services src -g '*.ts' -g '*.tsx' 2>/dev/null | sort -t: -k2 -rn || echo "(なし)"
READ_TOTAL=$(rg -o "$READ_RE" services src -g '*.ts' -g '*.tsx' 2>/dev/null | wc -l | tr -d ' ')
echo "-- 読取り合計: ${READ_TOTAL}"
echo ""
echo "== サマリ =="
echo "writes=${WRITE_TOTAL} reads=${READ_TOTAL}"
if [ "${1:-}" = "--detail" ]; then
  echo ""
  echo "== 書込み該当行 =="
  rg -n "$WRITE_RE" services -g '*.ts' || true
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
