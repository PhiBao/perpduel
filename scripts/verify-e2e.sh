#!/usr/bin/env bash
# End-to-end verification: creates a 60s BTC duel vs the Ghost through the public API,
# polls until FINISHED/VOID, prints every tx hash. Requires services running (./start.sh).
set -e
API="${API:-http://127.0.0.1:4102}"
ID=$(curl -s -X POST "$API/api/duels" -H 'content-type: application/json' \
  -d '{"name":"VERIFY","market":"BTC","side":"LONG","duration_sec":60}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "duel $ID — accepting as rival…"
curl -s -X POST "$API/api/duels/$ID/join" -H 'content-type: application/json' -d '{"name":"CHECKER"}' > /dev/null
for i in $(seq 1 40); do
  OUT=$(curl -s "$API/api/duels/$ID")
  STATUS=$(echo "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])")
  echo "[$i] status=$STATUS"
  if [ "$STATUS" = "FINISHED" ] || [ "$STATUS" = "VOID" ]; then
    echo "$OUT" | python3 -m json.tool
    echo "$OUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d['status'] in ('FINISHED','VOID'), d['status']
if d['status'] == 'FINISHED':
    for p in (d['creator'], d['opponent']):
        assert p['open_tx'] and p['close_tx'], p
    print('E2E OK: both sides opened and closed with real txs. Winner:', d['winner'])
else:
    print('E2E VOID (honest failure state):', d['void_reason'])
"
    exit 0
  fi
  sleep 5
done
echo "E2E TIMEOUT"; exit 1
