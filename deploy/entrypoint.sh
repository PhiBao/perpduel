#!/usr/bin/env bash
# Two processes, one container: the executor stays on loopback (it holds keys),
# the Rust backend is the only thing exposed.
set -euo pipefail
: "${PRIVATE_KEY:?PRIVATE_KEY secret is required}"
: "${PRIVATE_KEY_B:?PRIVATE_KEY_B secret is required}"
: "${EXECUTOR_SECRET:?EXECUTOR_SECRET secret is required}"

mkdir -p "$(dirname "${DUEL_STORE:-/data/duels.json}")"

npx tsx executor/src/server.ts &
EXEC_PID=$!

cleanup() { kill "$EXEC_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# wait for the executor to answer before the backend starts driving it
for _ in $(seq 1 40); do
  if curl -fsS -H "x-executor-secret: $EXECUTOR_SECRET" "http://127.0.0.1:${EXECUTOR_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

perpduel-backend
