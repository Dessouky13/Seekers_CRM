#!/bin/bash
# ── Seekers AI OS — API deploy ──────────────────────────
# Run on the VPS:  bash /var/www/seekersai/deploy.sh
#
# This is the authoritative copy; /var/www/seekersai/deploy.sh on the server
# should be kept identical to it. The two had drifted — the repo copy assumed
# the backend directory was a git checkout (it is not) while the server copy
# used drizzle-kit push.
#
# Schema changes are applied from the numbered files in src/db/migrations, NOT
# with `drizzle-kit push:pg`. Push prompts whenever it cannot infer whether a
# change is a rename, and the server copy piped it into grep — so the prompt was
# invisible and any deploy carrying a schema change hung indefinitely with the
# API still serving the previous build. That happened on 2026-08-03.
set -euo pipefail

REPO="https://github.com/Dessouky13/Seekers_CRM.git"
BACKEND_DIR="/var/www/seekersai/backend"
TMP="/tmp/seekers-deploy-$(date +%s)"
trap 'rm -rf "$TMP"' EXIT

cd "$BACKEND_DIR"
PGPASS=$(grep -o "postgresql://[^:]*:[^@]*@" .env | sed "s|postgresql://[^:]*:||; s|@||")
export PGPASSWORD="$PGPASS"
PSQL="psql -h localhost -U seekers -d seekersai"

echo "==> Backing up the database..."
mkdir -p /root/db-backups
BACKUP="/root/db-backups/seekersai-$(date +%Y%m%d-%H%M%S).dump"
pg_dump -h localhost -U seekers -d seekersai -Fc -f "$BACKUP"
echo "    $BACKUP ($(du -h "$BACKUP" | cut -f1))"
# Keep the ten most recent; unbounded dumps eventually fill the disk.
ls -1t /root/db-backups/seekersai-*.dump 2>/dev/null | tail -n +11 | xargs -r rm -f

echo "==> Cloning latest from GitHub..."
git clone --depth=1 "$REPO" "$TMP" 2>&1 | tail -1

echo "==> Copying backend source..."
# rsync --delete so a file removed or moved in the repo is removed here too.
# `cp -r` had left a stale src/outreach.ts on the server since June 2026,
# breaking typecheck for months without anyone noticing.
rsync -a --delete "$TMP/backend/src/" "$BACKEND_DIR/src/"
# scripts/ too, or one-off maintenance scripts simply do not exist on the server.
# The phone backfill could not be run here at all until this line was added: the
# deploy copied only src/, so `npx tsx scripts/backfill-phones.ts` failed with a
# missing file on a box where the migration adding its columns had just run.
rsync -a --delete "$TMP/backend/scripts/" "$BACKEND_DIR/scripts/"
cp "$TMP/backend/package.json" "$TMP/backend/tsconfig.json" "$BACKEND_DIR/"
cp "$TMP/backend/drizzle.config.ts" "$BACKEND_DIR/" 2>/dev/null || true

echo "==> Installing dependencies..."
npm install --silent

echo "==> Applying migrations..."
# Applied names are recorded, so re-running is a no-op. </dev/null guarantees
# nothing can sit waiting for input.
$PSQL -v ON_ERROR_STOP=1 -q -c \
  'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
for f in $(ls -1 src/db/migrations/*.sql 2>/dev/null | sort); do
  name=$(basename "$f")
  if [ "$($PSQL -t -A -c "SELECT 1 FROM _migrations WHERE name = '$name'")" = "1" ]; then
    continue
  fi
  echo "    applying $name"
  $PSQL -v ON_ERROR_STOP=1 -q -f "$f" < /dev/null
  $PSQL -q -c "INSERT INTO _migrations (name) VALUES ('$name') ON CONFLICT DO NOTHING"
done
echo "    schema up to date"

echo "==> Type-checking..."
# A deploy that cannot compile stops here rather than restarting into a
# broken build.
npx tsc --noEmit

echo "==> Building..."
npx tsup src/index.ts --format cjs --out-dir dist 2>&1 | tail -2

echo "==> Restarting API..."
pm2 restart seekersai-api --update-env
sleep 3

echo "==> Verifying..."
for _ in $(seq 1 10); do
  if curl -sf -m 5 https://agency.seekersai.org/health | grep -q '"status":"ok"'; then
    echo ""
    echo "Deploy complete — $(curl -s https://agency.seekersai.org/health)"
    exit 0
  fi
  sleep 2
done

echo "" >&2
echo "API did not come back healthy. Recent logs:" >&2
pm2 logs seekersai-api --lines 25 --nostream --no-color >&2
echo "" >&2
echo "Database backup for rollback: $BACKUP" >&2
exit 1
