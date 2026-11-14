#!/usr/bin/env bash
# Copies this checkout to a server and (re)starts the Docker stack there.
# Usage: scripts/deploy.sh ubuntu@46.62.162.111 [remote-dir]   (default dir: ~/kuvos-near)
# The server keeps its own .env (never copied): create it once from .env.example (see README).
set -euo pipefail
target="${1:?Usage: scripts/deploy.sh user@host [remote-dir]}"
dir="${2:-kuvos-near}"
root="$(cd "$(dirname "$0")/.." && pwd)"

# .gitignore rules keep .env, keys, data/, node_modules and build output off the server; they
# also protect the server's own .env from --delete.
rsync -az --delete --exclude .git --filter=':- .gitignore' "$root/" "$target:$dir/"
ssh "$target" "cd $dir && test -f .env || { echo 'Create $dir/.env on the server first (see README).' >&2; exit 1; }
  docker compose up -d --build --remove-orphans && docker compose ps"
