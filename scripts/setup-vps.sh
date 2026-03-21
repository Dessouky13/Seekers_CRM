#!/bin/bash
# ── Seekers AI OS — One-time VPS bootstrap script ────────
# Run once on a fresh Ubuntu 22.04 VPS
# Usage: bash scripts/setup-vps.sh
set -e

echo "🚀 Setting up Seekers AI OS VPS..."

# ── Node.js 20 ────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
echo "✅ Node.js $(node -v) installed"

# ── PostgreSQL 16 + pgvector ──────────────────────────────
sudo apt-get install -y postgresql-16 postgresql-contrib-16 postgresql-16-pgvector
sudo systemctl enable postgresql
sudo systemctl start postgresql
echo "✅ PostgreSQL 16 + pgvector installed"

# Prompt for DB password
read -rsp "Enter a password for the 'seekers' DB user: " DB_PASS
echo

sudo -u postgres psql <<EOF
CREATE USER seekers WITH PASSWORD '${DB_PASS}';
CREATE DATABASE seekersai OWNER seekers;
GRANT ALL PRIVILEGES ON DATABASE seekersai TO seekers;
\c seekersai
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EOF
echo "✅ Database 'seekersai' created with pgvector extension"
echo "   DATABASE_URL=postgresql://seekers:${DB_PASS}@localhost:5432/seekersai"

# ── Redis ─────────────────────────────────────────────────
sudo apt-get install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
echo "✅ Redis installed and running"

# ── PM2 + tsx ─────────────────────────────────────────────
sudo npm install -g pm2 tsx
echo "✅ PM2 and tsx installed globally"

# ── Nginx + Certbot ───────────────────────────────────────
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo systemctl enable nginx
sudo systemctl start nginx
echo "✅ Nginx installed"

# ── Upload directory ──────────────────────────────────────
sudo mkdir -p /var/www/seekersai/uploads
sudo chown -R "$USER":"$USER" /var/www/seekersai
echo "✅ Upload directory created at /var/www/seekersai/uploads"

# ── App directory ─────────────────────────────────────────
sudo mkdir -p /var/www/seekersai/backend
sudo chown -R "$USER":"$USER" /var/www/seekersai/backend

# ── PM2 startup script ────────────────────────────────────
pm2 startup | tail -1 | sudo bash || true
echo "✅ PM2 startup configured"

# ── PM2 log directory ─────────────────────────────────────
sudo mkdir -p /var/log/pm2
sudo chown -R "$USER":"$USER" /var/log/pm2

echo ""
echo "🎉 VPS setup complete!"
echo ""
echo "Next steps:"
echo "  1. Clone your repo to /var/www/seekersai/backend"
echo "  2. Copy .env.example to .env and fill in all values"
echo "  3. Run: npm install && npm run db:push && npm run seed"
echo "  4. Copy nginx/seekersai.conf to /etc/nginx/sites-available/"
echo "  5. Run: sudo certbot --nginx -d api.seekersai.org"
echo "  6. Run: pm2 start ecosystem.config.js --env production"
