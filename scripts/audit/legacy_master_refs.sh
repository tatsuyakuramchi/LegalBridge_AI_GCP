#!/usr/bin/env bash
# legacy_master_refs.sh — 旧原作マスタ(ledgers / source_ips)参照の棚卸し (WM-01 Phase D)
#
# WM-01「原作マスタ統合」は原作の正本を works(kind='licensed_in') へ一本化し、
# 最終的に旧 ledgers / source_ips テーブルを DROP する(Phase E, 破壊的・要人間承認)。
# その退行防止のため、CI で以下をラチェット計測する:
#
#   A) source_ips  … 旧原作テーブルへの SQL アクセス(FROM/JOIN/INTO/UPDATE/DELETE)。目標 0。
#                    ※ コメントや表示名マッピング(識別子 "source_ips:")は SQL では無いので数えない。
#   B) ledgers_write … ledgers への書込み(INSERT/UPDATE/DELETE)。Phase E で撤去する互換ブリッジ。
#                      「増やさない」ラチェット(現状値を上限に据え置き)。
#   C) ledgers_read  … ledgers の読取り(FROM/JOIN)。診断・LO採番UNION・resolver 等の互換ブリッジ。
#                      同じく「増やさない」ラチェット。付け替えで減らしたら上限も同時に下げる。
#
# ripgrep(rg) があれば使い、無い環境(Cloud Build の cloud-sdk イメージ等)では
# GNU grep -E にフォールバックする(compat_view_refs.sh と同方式)。
#
# 使い方:
#   scripts/audit/legacy_master_refs.sh                 # サマリ表示
#   scripts/audit/legacy_master_refs.sh --detail        # 該当行も表示
#   scripts/audit/legacy_master_refs.sh --gate S W R    # CI ゲート(各上限超過なら非0終了)
#     S=source_ips 上限 / W=ledgers_write 上限 / R=ledgers_read 上限
#
# 期待値の推移は docs/plans/ の WM-01 進捗表を更新すること(Phase E で全て 0 へ)。
set -euo pipefail
cd "$(dirname "$0")/../.."

SRC_IPS_RE="(INSERT INTO|UPDATE|DELETE FROM|FROM|JOIN)[[:space:]]+source_ips\\b"
LDG_WRITE_RE="(INSERT INTO|UPDATE|DELETE FROM)[[:space:]]+ledgers\\b"
LDG_READ_RE="(FROM|JOIN)[[:space:]]+ledgers\\b"

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

# マッチ文字列のみを列挙(ファイル名なし)。合計数の集計に使う。
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

count_of() { matches_only "$1" "${@:2}" | wc -l | tr -d ' '; }

# source_ips は services + src の両方(フロントからの SQL は本来無いが将来防止で src も見る)。
SRC_IPS_TOTAL=$(count_of "$SRC_IPS_RE" services src)
# ledgers write は services のみ(SQL 発行はサーバ側)。
LDG_WRITE_TOTAL=$(count_of "$LDG_WRITE_RE" services)
# ledgers read は services + src。
LDG_READ_TOTAL=$(count_of "$LDG_READ_RE" services src)

echo "== source_ips への SQL アクセス (目標 0) =="
SRC_FILES=$(per_file_counts "$SRC_IPS_RE" services src)
[ -n "$SRC_FILES" ] && echo "$SRC_FILES" || echo "(なし)"
echo "-- source_ips 合計: ${SRC_IPS_TOTAL}"
echo ""
echo "== ledgers への書込み (Phase E で撤去) =="
LW_FILES=$(per_file_counts "$LDG_WRITE_RE" services)
[ -n "$LW_FILES" ] && echo "$LW_FILES" || echo "(なし)"
echo "-- ledgers_write 合計: ${LDG_WRITE_TOTAL}"
echo ""
echo "== ledgers の読取り (Phase E で撤去) =="
LR_FILES=$(per_file_counts "$LDG_READ_RE" services src)
[ -n "$LR_FILES" ] && echo "$LR_FILES" || echo "(なし)"
echo "-- ledgers_read 合計: ${LDG_READ_TOTAL}"
echo ""
echo "== サマリ =="
echo "source_ips=${SRC_IPS_TOTAL} ledgers_write=${LDG_WRITE_TOTAL} ledgers_read=${LDG_READ_TOTAL}"

if [ "${1:-}" = "--detail" ]; then
  echo ""
  echo "== source_ips 該当行 =="; matching_lines "$SRC_IPS_RE" services src
  echo ""
  echo "== ledgers_write 該当行 =="; matching_lines "$LDG_WRITE_RE" services
  echo ""
  echo "== ledgers_read 該当行 =="; matching_lines "$LDG_READ_RE" services src
fi

# CI ゲート: --gate S W R で各カテゴリが上限を超えたら非0終了(退行防止)。
if [ "${1:-}" = "--gate" ]; then
  MAXS="${2:?--gate には source_ips 上限を指定}"
  MAXW="${3:?--gate には ledgers_write 上限を指定}"
  MAXR="${4:?--gate には ledgers_read 上限を指定}"
  FAIL=0
  if [ "$SRC_IPS_TOTAL" -gt "$MAXS" ]; then
    echo "NG: source_ips への SQL アクセスが ${SRC_IPS_TOTAL} 箇所 (> 上限 ${MAXS})。works(licensed_in) を参照してください。" >&2
    FAIL=1
  fi
  if [ "$LDG_WRITE_TOTAL" -gt "$MAXW" ]; then
    echo "NG: ledgers への書込みが ${LDG_WRITE_TOTAL} 箇所 (> 上限 ${MAXW})。原作 write は works へ集約してください。" >&2
    FAIL=1
  fi
  if [ "$LDG_READ_TOTAL" -gt "$MAXR" ]; then
    echo "NG: ledgers の読取りが ${LDG_READ_TOTAL} 箇所 (> 上限 ${MAXR})。原作 read は works(licensed_in) へ付け替えてください。" >&2
    FAIL=1
  fi
  if [ "$FAIL" = 1 ]; then exit 1; fi
  echo "OK: source_ips ${SRC_IPS_TOTAL} (<= ${MAXS}) / ledgers_write ${LDG_WRITE_TOTAL} (<= ${MAXW}) / ledgers_read ${LDG_READ_TOTAL} (<= ${MAXR})"
fi
