#!/bin/bash
# Push the nekojin-site repo to Gitea using a temporary access token.
# See pi-session-summary.txt in ~/Downloads for full context.

set -e

REPO_DIR="/home/xanmal/nekojin-site"
GITEA_DIR="/home/xanmal/Gitea"
REMOTE_URL="https://git.worldofxanrea.com/PurpleXanmal/nekojin-interactive-website.git"
USER="PurpleXanmal"
BRANCH="main"

echo "Generating temporary Gitea access token..."
TOKEN=$(cd "$GITEA_DIR" && "$GITEA_DIR/gitea" admin user generate-access-token \
  -u "$USER" \
  -t "pi-deploy-$(date +%s)" \
  --raw \
  --config "$GITEA_DIR/custom/conf/app.ini" \
  --work-path "$GITEA_DIR")

echo "Pushing to Gitea ($BRANCH)..."
git -C "$REPO_DIR" push "https://${TOKEN}@${REMOTE_URL#https://}" "$BRANCH"

echo "Done."
