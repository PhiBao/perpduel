#!/usr/bin/env bash
for f in /tmp/perpduel/executor.pid /tmp/perpduel/backend.pid /tmp/perpduel/web.pid; do
  [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null && echo "stopped $(cat "$f") ($f)" || true
done
