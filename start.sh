#!/usr/bin/env bash
# PERPDUEL — start executor (4101), Rust backend (4102), web (3000)
set -e
cd "$(dirname "$0")"
[ -f .env ] || { echo "Missing .env — copy .env.example and fill PRIVATE_KEY / PRIVATE_KEY_B"; exit 1; }
mkdir -p /tmp/perpduel
echo "Building Rust backend…"
cargo build --release --manifest-path backend/Cargo.toml
echo "Building web…"
(cd web && npx next build)
nohup npx tsx executor/src/server.ts > /tmp/perpduel/executor.log 2>&1 &
echo $! > /tmp/perpduel/executor.pid
nohup ./backend/target/release/perpduel-backend > /tmp/perpduel/backend.log 2>&1 &
echo $! > /tmp/perpduel/backend.pid
nohup bash -c 'cd web && npx next start -p 3000' > /tmp/perpduel/web.log 2>&1 &
echo $! > /tmp/perpduel/web.pid
sleep 4
echo "Executor : http://127.0.0.1:4101/health"
echo "Backend  : http://127.0.0.1:4102/health"
echo "Web      : http://localhost:3000"
curl -s http://127.0.0.1:4102/health && echo
