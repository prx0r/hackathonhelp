#!/bin/bash
# Waits for batch to finish, then rebuilds + deploys automatically
while pgrep -f batch-extract > /dev/null; do sleep 60; done
echo "[watch] batch done at $(date)"
cd "$(dirname "$0")/.."
node scripts/build-data.mjs
cd web && npm run build
cd ..
npx wrangler pages deploy web/dist --project-name=hackathonhelp --branch=main --commit-dirty=true
git add -A && git commit -q -m "Batch contract extraction complete" && git push -q origin master
echo "[watch] shipped"
