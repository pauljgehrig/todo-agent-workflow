#!/usr/bin/env bash
# Smoke test for the to-do capture endpoint.
# Requires: TODO_ENDPOINT (e.g. https://xxx.val.run), TODO_SHARED_SECRET, NOTION_TOKEN
#   source ~/.config/todo-intake/env    # for NOTION_TOKEN
#   export TODO_ENDPOINT="https://<your-val>.val.run"
#   export TODO_SHARED_SECRET="<same secret set in Val Town>"
#   ./endpoint/test.sh
set -uo pipefail

: "${TODO_ENDPOINT:?set TODO_ENDPOINT}"
: "${TODO_SHARED_SECRET:?set TODO_SHARED_SECRET}"
: "${NOTION_TOKEN:?set NOTION_TOKEN (source ~/.config/todo-intake/env)}"

SEC=(-H "x-todo-secret: $TODO_SHARED_SECRET" -H "content-type: application/json")
NH=(-H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2025-09-03" -H "content-type: application/json")
pass=0; fail=0
ok(){ echo "  ✅ $1"; pass=$((pass+1)); }
no(){ echo "  ❌ $1"; fail=$((fail+1)); }
archive(){ [ -n "$1" ] && [ "$1" != "null" ] && curl -s -X PATCH "https://api.notion.com/v1/pages/$1" "${NH[@]}" -d '{"archived":true}' >/dev/null; }

echo "1) /parse dateless -> due should be empty"
R=$(curl -s -X POST "$TODO_ENDPOINT/parse" "${SEC[@]}" -d '{"text":"email Ryan about the Emmy content edits"}')
DUE=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('due','MISSING'))")
[ "$DUE" = "" ] && ok "dateless due is empty" || no "expected empty due, got '$DUE' ($R)"

echo "2) /parse dated -> due should be a date"
R=$(curl -s -X POST "$TODO_ENDPOINT/parse" "${SEC[@]}" -d '{"text":"pick up dry cleaning tomorrow"}')
DUE=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('due','MISSING'))")
echo "$DUE" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' && ok "dated due is ISO ($DUE)" || no "expected ISO date, got '$DUE' ($R)"

echo "3) /save dateless (due='') -> must land (the original bug)"
R=$(curl -s -X POST "$TODO_ENDPOINT/save" "${SEC[@]}" -d '{"title":"🧪 DIAG dateless","project":"🧭 Nava","due":"","summary":"regression guard"}')
OKF=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('ok'))")
ID=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id') or '')")
[ "$OKF" = "True" ] && ok "dateless task landed" || no "dateless save failed ($R)"
archive "$ID"

echo "4) /save title with a double quote -> must land (JSON-safe)"
R=$(curl -s -X POST "$TODO_ENDPOINT/save" "${SEC[@]}" -d '{"title":"🧪 DIAG say \"hi\" to team","project":"🏠 Home","due":"2026-08-20","summary":""}')
OKF=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('ok'))")
ID=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id') or '')")
[ "$OKF" = "True" ] && ok "quoted title landed" || no "quoted save failed ($R)"
archive "$ID"

echo "5) missing secret -> 401, nothing written"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$TODO_ENDPOINT/save" -H "content-type: application/json" -d '{"title":"nope"}')
[ "$CODE" = "401" ] && ok "unauthorized rejected (401)" || no "expected 401, got $CODE"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
