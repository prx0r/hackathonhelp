#!/usr/bin/env bash
# activate-hackathon.sh — Add a hackathon to active tracking
# Usage: scripts/activate-hackathon.sh <slug> <url>
#
# Flow:
#   1. Creates skeleton with tasks from seed.json (if available)
#   2. Agent follows POPULATE-PROMPT.md to crawl site and fill details
#   3. Build pipeline picks up the new entry
set -euo pipefail

SLUG="${1:?Usage: activate-hackathon.sh <slug> <url>}"
URL="${2:?Usage: activate-hackathon.sh <slug> <url>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ACTIVE_DIR="$ROOT/data/active"
OUT="$ACTIVE_DIR/$SLUG.json"

mkdir -p "$ACTIVE_DIR"

if [ -f "$OUT" ]; then
  echo "Already active: $SLUG"
  echo "  To refresh: node scripts/populate-active.mjs $SLUG --refresh"
  echo "  To re-crawl: agent follows POPULATE-PROMPT.md"
  exit 0
fi

# Create enriched skeleton from seed.json + add tasks
echo "Creating active entry for $SLUG..."
node "$ROOT/scripts/populate-active.mjs" "$SLUG" "$URL"

echo ""
echo "---"
echo "Activation complete. Next steps:"
echo "  1. Agent reads POPULATE-PROMPT.md"
echo "  2. Agent crawls $URL"
echo "  3. Agent fills in rules, judging, prizes, strategy"
echo "  4. Agent clones any reference repos to data/active/$SLUG-refs/"
echo "  5. Run: node scripts/build-data.mjs"
echo ""
echo "Tasks created automatically. Agent can claim them via:"
echo "  node scripts/agent-task.mjs next <agent-id>"
