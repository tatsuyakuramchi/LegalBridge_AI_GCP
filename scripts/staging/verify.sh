#!/usr/bin/env bash
# staging 検証スクリプト（全UIリニューアル A）。
#   使い方: STAGING_API_URL=https://legalbridge-search-api-staging-xxx.run.app bash scripts/staging/verify.sh
#   前提: staging は STAGING_DEV_AUTH=1 + IAP 無し。x-staging-role で role を指定して叩く。
#   本番 URL には絶対に向けないこと（x-staging-role は本番では無効なので実害は無いが誤用防止）。
set -uo pipefail

API="${STAGING_API_URL:-}"
if [[ -z "$API" ]]; then echo "ERROR: STAGING_API_URL 未設定"; exit 2; fi
API="${API%/}"
pass=0; fail=0
ok()  { echo "  PASS: $1"; pass=$((pass+1)); }
ng()  { echo "  FAIL: $1"; fail=$((fail+1)); }

get() { # $1=path $2=role
  curl -sS -m 25 -H "x-staging-role: ${2:-viewer}" "$API$1" 2>/dev/null
}
code() { # $1=path $2=role
  curl -sS -m 25 -o /dev/null -w "%{http_code}" -H "x-staging-role: ${2:-viewer}" "$API$1" 2>/dev/null
}

echo "== §13 統合作品検索 =="
J="$(get '/api/v3/works/search?limit=50' viewer)"
if echo "$J" | grep -q '"kind"'; then ok "works/search が kind 列を返す"; else ng "kind 列が無い ($(echo "$J" | head -c120))"; fi
# own 以外(licensed_in/external)が含まれる＝統合化された
if echo "$J" | grep -qE '"kind":"(licensed_in|external)"'; then ok "own 以外の works が検索に含まれる(統合)"; else echo "  INFO: own 以外がヒットせず(データ次第)。件数を確認: $(echo "$J" | grep -o '"total":[0-9]*' | head -1)"; fi

echo "== §12 機密除外(vendor: 口座/反社) =="
# viewer では口座/反社が返らないこと / admin では返ること（§12 実装後に有効）
VV="$(get '/api/master/vendors?limit=5' viewer)"
VA="$(get '/api/master/vendors?limit=5' admin)"
if echo "$VV" | grep -qiE 'account_number|antisocial_check_result'; then ng "viewer に口座/反社が返っている(§12 未実装 or 未除外)"; else ok "viewer に口座/反社が返らない"; fi
if echo "$VA" | grep -qiE 'account_number|antisocial_check_result'; then ok "admin には口座/反社が返る(想定どおり)"; else echo "  INFO: admin でも口座/反社が見当たらない(エンドポイント/データ次第)"; fi

echo "== SSR read-only(書込みフォームの有無) =="
for path in "/search/work" "/search/vendor" "/master/vendors"; do
  H="$(get "$path" viewer)"
  c="$(echo "$H" | head -c1)"
  if [[ -z "$H" ]]; then echo "  INFO: $path 応答なし(ルート無し?)"; continue; fi
  if echo "$H" | grep -qiE '<form[^>]*method=["'"'"']?post|type=["'"'"']?submit'; then
    ng "$path に書込みフォーム/submit が残存(SSR read-only 未達)"
  else ok "$path に書込みフォームなし(read-only)"; fi
done

echo "== 基本疎通 =="
for p in "/api/v3/works/search?limit=1"; do
  st="$(code "$p" viewer)"; [[ "$st" == "200" ]] && ok "$p -> 200" || ng "$p -> $st"
done

echo ""
echo "==== 結果: PASS=$pass FAIL=$fail ===="
[[ $fail -eq 0 ]] && exit 0 || exit 1
