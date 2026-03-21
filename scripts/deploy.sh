#!/bin/bash
# ── Seekers AI OS — Deploy script ───────────────────────
# Run from VPS after ssh-ing in, or via CI/CD
# Usage: bash scripts/deploy.sh
set -e

echo "📦 Deploying Seekers AI OS API..."

cd /var/www/seekersai/backend

# Pull latest code
git pull origin main
echo "✅ Code updated"

# Install dependencies
npm install --production=false
echo "✅ Dependencies installed"

# Build TypeScript
npx tsup src/index.ts --format cjs --out-dir dist
echo "✅ TypeScript compiled"

# Run any pending migrations
npx drizzle-kit migrate
echo "✅ Migrations applied"

# Restart PM2 process
pm2 restart seekersai-api
echo "✅ PM2 restarted"

# Show status
pm2 status seekersai-api

echo ""
echo "🎉 Deployed successfully at $(date)"
