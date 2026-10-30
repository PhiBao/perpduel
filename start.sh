#!/usr/bin/env bash
# PERPDUEL — start executor (4101), Rust backend (4102), web (3000)
set -e
cd "$(dirname "$0")"
[ -f .env ] || { echo "Missing .env — copy .env.example and fill PRIVATE_KEY / PRIVATE_KEY_B"; exit 1; }
set -a; . ./.env; set +a
mkdir -p /tmp/perpduel
# executor shared secret: from env, or generated once and kept out of git
if [ -z "${EXECUTOR_SECRET:-}" ]; then
  if [ ! -f /tmp/perpduel/executor-secret ]; then
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > /tmp/perpduel/executor-secret
  fi
  EXECUTOR_SECRET=$(cat /tmp/perpduel/executor-secret)
  export EXECUTOR_SECRET
fi
echo "Building Rust backend (release)…"
cargo build --release --manifest-path backend/Cargo.toml
echo "Building web…"
(cd web && npx next build)
nohup npx tsx executor/src/server.ts > /tmp/perpduel/executor.log 2>&1 &
echo $! > /tmp/perpduel/executor.pid
nohup ./backend/target/release/perpduel-backend > /tmp/perpduel/backend.log 2>&1 &
echo $! > /tmp/perpduel/backend.pid
nohup bash -c 'cd web && npx next start -p 3000' > /tmp/perpduel/web.log 2>&1 &
echo $! > /tmp/perpduel/web.pid
for i in $(seq 1 20); do
  sleep 1
  if curl -s http://127.0.0.1:4102/health > /dev/null 2>&1; then break; fi
done
echo "Executor : http://127.0.0.1:4101 (secret-protected)"
echo "Backend  : http://127.0.0.1:4102/health -> $(curl -s http://127.0.0.1:4102/health || echo DOWN)"
echo "Web      : http://localhost:3000"
echo "Logs     : /tmp/perpduel/*.log — keep all three processes supervised (e.g. systemd/pm2) on a public host."
