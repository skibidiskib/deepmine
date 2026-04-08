#!/usr/bin/env bash
set -euo pipefail

# DEEPMINE Dashboard Deploy Script
# Deploys to Oracle .147 server (213.35.116.147)
# Database lives OUTSIDE the app dir at /home/ubuntu/deepmine-data/

SERVER="ubuntu@213.35.116.147"
SSH_KEY="$HOME/.ssh/id_ed25519"
SSH="ssh -i $SSH_KEY $SERVER"
APP_DIR="/home/ubuntu/deepmine-dash"
DATA_DIR="/home/ubuntu/deepmine-data"

echo "=== DEEPMINE Dashboard Deploy ==="
echo ""

# Step 1: Backup database on server before anything else
echo "[1/5] Backing up database on server..."
$SSH "mkdir -p $DATA_DIR/backups && cp $DATA_DIR/deepmine-dash.db $DATA_DIR/backups/deepmine-dash-\$(date +%Y%m%d-%H%M%S).db 2>/dev/null && echo 'Backup created' || echo 'No existing DB to backup (first deploy?)'"

# Step 2: Sync files (NEVER touch the data directory)
echo "[2/5] Syncing files..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.git' \
  --exclude 'data/' \
  -e "ssh -i $SSH_KEY" \
  "$(dirname "$0")/dashboard/" \
  "$SERVER:$APP_DIR/"

# Step 3: Build on server
echo "[3/5] Building..."
$SSH "source ~/.nvm/nvm.sh && cd $APP_DIR && npm run build" 2>&1 | tail -5

# Step 4: Restart PM2
echo "[4/5] Restarting..."
$SSH "source ~/.nvm/nvm.sh && pm2 restart deepmine-dash"

# Step 5: Health check
echo "[5/5] Health check..."
sleep 2
STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://deepmine.computers.ch/api/stats)
if [ "$STATUS" = "200" ]; then
  echo "Deploy successful! API returned HTTP $STATUS"
else
  echo "WARNING: API returned HTTP $STATUS - check server logs"
  $SSH "source ~/.nvm/nvm.sh && pm2 logs deepmine-dash --lines 20 --nostream"
fi

echo ""
echo "=== Done ==="
