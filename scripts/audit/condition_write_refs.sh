#!/usr/bin/env bash
# condition_write_refs.sh — Admin UI(src/)からレガシー条件エンドポイントへの直接参照の棚卸し
#                            (UIC-01 / CLEAN-08, 設計 v1.4 「最重要修正#1: 条件明細唯一の書込み口」)
#
# 目的:
#   条件明細(condition_lines)の値は Document Command(文書フォーム)経由でのみ書けるべき、というのが
#   本設計の第1原則。ところが WorkGraphPanel / MaterialEntryPanel など複数の画面が、作品・素材(source-ip)
#   単位のレガシー条件エンドポイントを直接叩いている。ここを「増やさない → Phase C/D で 0 にする」ための計測。
#
#   対象(レガシー条件カップリング):
#     - /works/:id/license-matrix              V3LicenseMatrix 直接保存(条件値の一括書込み) …撤去対象
#     - /works/:id/component-lines             コンポーネント明細の作成/置換              …撤去対象
#     - /materials/:mid/conditions             素材条件の全置換(PUT)                    …撤去対象
#     - /materials/:mid/condition-lines        素材条件明細の作成(POST) / 取得(GET)      …撤去対象(GET含む)
#     - /materials/:mid/link-conditions        既存条件のリンク(値は書かない)             …設計上は維持(凍結)
#
#   分類の詳細(値書込み vs リンク維持)は docs/forms/legacy-condition-endpoints.md を参照。
#   Phase C: 値書込み系を文書起票/独立入力/元文書再編集へ置換して 0 件へ。
#   Phase D: source-ips→works 統合に伴い残りのレガシー面ごと撤去。
#
# ripgrep(rg) があれば使い、無い環境(Cloud Build の cloud-sdk イメージ等)では GNU grep -E にフォールバック。
#
# 使い方:
#   scripts/audit/condition_write_refs.sh            # サマリ表示
#   scripts/audit/condition_write_refs.sh --detail   # 該当行も表示
#   scripts/audit/condition_write_refs.sh --gate 18  # CI ラチェット(参照数が上限超過なら非0終了)
set -euo pipefail
cd "$(dirname "$0")/../.."

# レガシー条件エンドポイントのパス断片(フロントの fetch/apiSend URL に現れる形)。
# 注: 値書込み・GET読取り・doc-comment 参照をまとめて「凍結対象」として数える(増やさないラチェット)。
LEGACY_RE="/(license-matrix|component-lines|link-conditions)|/materials/[^/\"'\`]+/(conditions|condition-lines)"

if command -v rg >/dev/null 2>&1; then HAVE_RG=1; else HAVE_RG=0; fi

per_file_counts() {
  local re="$1"; shift
  if [ "$HAVE_RG" = 1 ]; then
    { rg -c "$re" "$@" -g '*.ts' -g '*.tsx' 2>/dev/null || true; } | sort -t: -k2 -rn
  else
    { grep -rEc --include='*.ts' --include='*.tsx' "$re" "$@" 2>/dev/null || true; } \
      | grep -v ':0$' | sort -t: -k2 -rn || true
  fi
}

matches_only() {
  local re="$1"; shift
  if [ "$HAVE_RG" = 1 ]; then
    rg -o "$re" "$@" -g '*.ts' -g '*.tsx' -N --no-filename 2>/dev/null || true
  else
    grep -rEoh --include='*.ts' --include='*.tsx' "$re" "$@" 2>/dev/null || true
  fi
}

matching_lines() {
  local re="$1"; shift
  if [ "$HAVE_RG" = 1 ]; then
    rg -n "$re" "$@" -g '*.ts' -g '*.tsx' 2>/dev/null || true
  else
    grep -rEn --include='*.ts' --include='*.tsx' "$re" "$@" 2>/dev/null || true
  fi
}

echo "== Admin UI(src/) → レガシー条件エンドポイント参照 (Phase C/D で撤去対象) =="
FILES=$(per_file_counts "$LEGACY_RE" src)
[ -n "$FILES" ] && echo "$FILES" || echo "(なし)"
TOTAL=$(matches_only "$LEGACY_RE" src | wc -l | tr -d ' ')
echo "-- 参照合計: ${TOTAL}"
echo ""
echo "== エンドポイント別の内訳 =="
matches_only "$LEGACY_RE" src | sed -E 's#/materials/[^/]+/#/materials/:mid/#' | sort | uniq -c | sort -rn
echo ""
echo "== サマリ =="
echo "condition_endpoint_refs=${TOTAL}"

if [ "${1:-}" = "--detail" ]; then
  echo ""
  echo "== 該当行 =="
  matching_lines "$LEGACY_RE" src
fi

# CI ラチェット: --gate N で参照が N を超えたら非0終了(新規カップリングの追加を防ぐ)。
if [ "${1:-}" = "--gate" ]; then
  MAX="${2:?--gate には上限数を指定}"
  if [ "$TOTAL" -gt "$MAX" ]; then
    echo "NG: レガシー条件エンドポイント参照が ${TOTAL} 箇所 (> 上限 ${MAX})。" >&2
    echo "    条件値の書込みは文書フォーム(Document Command)経由へ。詳細: docs/forms/legacy-condition-endpoints.md" >&2
    exit 1
  fi
  echo "OK: レガシー条件エンドポイント参照 ${TOTAL} 箇所 (<= 上限 ${MAX})"
fi
