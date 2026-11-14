#!/usr/bin/env bash
# Starts the local data services for kuvos-near: Postgres 17 on :5433 and MinIO on :9000,
# both storing data under ./data (gitignored). Creates the database, bucket and schema.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
[ -f .env ] || { echo "Copy .env.example to .env first." >&2; exit 1; }
pg="$(brew --prefix postgresql@17)/bin"
mkdir -p data
if [ ! -d data/postgres ]; then
  "$pg/initdb" -D data/postgres -U kuvos --auth=trust >/dev/null
fi
"$pg/pg_ctl" -D data/postgres -o "-p 5433 -k /tmp" -l data/postgres.log status >/dev/null 2>&1 ||
  "$pg/pg_ctl" -D data/postgres -o "-p 5433 -k /tmp" -l data/postgres.log start >/dev/null
for _ in $(seq 1 20); do "$pg/pg_isready" -h localhost -p 5433 >/dev/null 2>&1 && break; sleep 0.5; done
"$pg/createdb" -h localhost -p 5433 -U kuvos kuvos_near 2>/dev/null || true

if ! curl -fs http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
  mkdir -p data/minio
  MINIO_ROOT_USER="$(grep ^AWS_ACCESS_KEY_ID= .env | cut -d= -f2)" \
  MINIO_ROOT_PASSWORD="$(grep ^AWS_SECRET_ACCESS_KEY= .env | cut -d= -f2)" \
    nohup minio server data/minio --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 >data/minio.log 2>&1 &
  for _ in $(seq 1 30); do curl -fs http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1 && break; sleep 0.5; done
fi
apps/worker/.venv/bin/python -I scripts/create-bucket.py
(cd apps/api && set -a && . ../../.env && set +a && npx prisma migrate deploy >/dev/null && echo "Database schema is up to date")
