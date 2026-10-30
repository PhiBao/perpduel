#!/usr/bin/env bash
# Verify a duel's four transactions on the Somnia Tokyo (Hideki) chain.
#
#   ./scripts/verify-duel.sh <duel-id>
#
# Reads the duel from the local API, then checks each open/close transaction
# receipt against the chain RPC. Prints one line per transaction and exits
# non-zero if any is missing or not status 1.
set -euo pipefail
ID="${1:?usage: verify-duel.sh <duel-id>}"
API="${PERPDUEL_API:-http://127.0.0.1:4102}"
RPC="${SOMNIA_RPC:-https://api.hideki2.infra.testnet.somnia.network}"
command -v cast >/dev/null || { echo "cast (foundry) is required" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

duel=$(curl -fsS "$API/api/duels/$ID")
fail=0
count=0
while read -r name kind hash; do
  [ -n "$hash" ] && [ "$hash" != "null" ] || { printf '%-7s %-6s %-12s MISSING\n' "$name" "$kind" "-"; fail=1; continue; }
  rec=$(cast receipt "$hash" --rpc-url "$RPC" --json)
  status=$(echo "$rec" | jq -r '.status')
  block=$(echo "$rec" | jq -r '.blockNumber')
  count=$((count + 1))
  short="${hash:0:10}…${hash: -6}"
  if [ "$status" = "0x1" ]; then
    printf '%-7s %-6s %-20s confirmed  block %d\n' "$name" "$kind" "$short" "$block"
  else
    printf '%-7s %-6s %-20s FAILED     block %d\n' "$name" "$kind" "$short" "$block"
    fail=1
  fi
done < <(echo "$duel" | jq -r '
  .creator as $c | .opponent as $o |
  (($c.name + " open " + ($c.open_tx // "null")),
   ($c.name + " close " + ($c.close_tx // "null")),
   ($o.name + " open " + ($o.open_tx // "null")),
   ($o.name + " close " + ($o.close_tx // "null"))) |
  split(" ") | .[0] + " " + .[1] + " " + .[2]')

echo
if [ "$fail" -eq 0 ]; then
  echo "$count/4 confirmed on chain 50383 — Somnia Tokyo (Hideki)"
else
  echo "verification FAILED for duel $ID" >&2
  exit 1
fi
