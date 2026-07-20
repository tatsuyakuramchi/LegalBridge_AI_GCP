#!/usr/bin/env bash
# staging worker 検証スクリプト(全UIリニューアル A ステップ1: master 書込みの worker 移設)。
#   使い方: STAGING_WORKER_URL=https://legalbridge-document-worker-staging-xxx.run.app bash scripts/staging/verify-worker.sh
#   前提: staging worker は LB_PORTAL_SECRET 未設定(= requirePortalSecret 素通り)で、
#         DATABASE_URL がクローンDBを指す。本番 worker には絶対に向けないこと。
#   設計: クローンDBを壊さない。役割変更は「実staffを"現在のロール"へPATCH」= 無変更で検証。
set -uo pipefail

W="${STAGING_WORKER_URL:-}"
if [[ -z "$W" ]]; then echo "ERROR: STAGING_WORKER_URL 未設定"; exit 2; fi
W="${W%/}"
pass=0; fail=0
ok()  { echo "  PASS: $1"; pass=$((pass+1)); }
ng()  { echo "  FAIL: $1"; fail=$((fail+1)); }

jqget() { # $1=json $2=key(単純) : 最初の "key":"value" or "key":value を拾う
  echo "$1" | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|[a-zA-Z0-9_.-]+)" | head -1 | sed -E "s/.*:[[:space:]]*\"?([^\"]*)\"?$/\1/"
}
code_patch() { # $1=path $2=body : HTTP コードのみ
  curl -sS -m 25 -o /dev/null -w "%{http_code}" -X PATCH -H "Content-Type: application/json" \
    -H "x-user-email: staging-verify@dev.local" -d "$2" "$W$1" 2>/dev/null
}
body_patch() { # $1=path $2=body : レスポンスボディ
  curl -sS -m 25 -X PATCH -H "Content-Type: application/json" \
    -H "x-user-email: staging-verify@dev.local" -d "$2" "$W$1" 2>/dev/null
}

echo "== ステップ1: staff 役割変更(PATCH /api/master/staff/:email/role) =="

# (1) 不正 app_role → 400
c="$(code_patch '/api/master/staff/anyone%40example.com/role' '{"app_role":"bogus"}')"
[[ "$c" == "400" ]] && ok "不正 app_role は 400" || ng "不正 app_role が $c (期待 400)"

# (2) 不存在 email → 404
c="$(code_patch '/api/master/staff/nonexistent-xyz%40nowhere.invalid/role' '{"app_role":"viewer"}')"
[[ "$c" == "404" ]] && ok "不存在 email は 404" || ng "不存在 email が $c (期待 404)"

# (3) 実 staff を現在ロールへ PATCH(無変更) → 200 + 同一ロール返却
STAFF_JSON="$(curl -sS -m 25 -H 'x-user-email: staging-verify@dev.local' "$W/api/master/staff" 2>/dev/null)"
EMAIL="$(echo "$STAFF_JSON" | grep -oE "\"email\"[[:space:]]*:[[:space:]]*\"[^\"]+@[^\"]+\"" | head -1 | sed -E 's/.*"([^"]+@[^"]+)".*/\1/')"
if [[ -z "$EMAIL" ]]; then
  echo "  INFO: staff 一覧から email を取得できず(GET /api/master/staff 応答: $(echo "$STAFF_JSON" | head -c120)). 実データ検証はスキップ。"
else
  # 現在ロールを role エコー用に取得(app_role が無ければ viewer 相当として現在値へ揃える)
  # まず現在ロールを email 行から拾う(同一 JSON 内)。無ければ viewer を既定に。
  CUR="$(echo "$STAFF_JSON" | tr '}' '\n' | grep -F "\"$EMAIL\"" | grep -oE "\"app_role\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed -E 's/.*"app_role"[^"]*"([^"]*)".*/\1/')"
  CUR="$(echo "${CUR:-viewer}" | tr 'A-Z' 'a-z')"
  [[ "$CUR" == "admin" ]] || CUR="viewer"
  EMAIL_ENC="$(echo "$EMAIL" | sed 's/@/%40/')"
  RESP="$(body_patch "/api/master/staff/${EMAIL_ENC}/role" "{\"app_role\":\"$CUR\"}")"
  GOTROLE="$(jqget "$RESP" app_role)"
  OKFLAG="$(jqget "$RESP" ok)"
  if [[ "$OKFLAG" == "true" && "$GOTROLE" == "$CUR" ]]; then
    ok "実 staff($EMAIL) を現在ロール($CUR)へ PATCH=200・無変更で role 一致"
  else
    ng "実 staff PATCH 応答が想定外 (ok=$OKFLAG role=$GOTROLE 期待=$CUR / body=$(echo "$RESP" | head -c160))"
  fi
fi

echo ""
echo "==== worker 結果: PASS=$pass FAIL=$fail ===="
[[ $fail -eq 0 ]] && exit 0 || exit 1
