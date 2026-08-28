#!/usr/bin/env bash
# crawl-active.sh — Hermes crawl for active hackathons
# Extracts structured data from official rules pages into data/active/<slug>.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ACTIVE_DIR="$ROOT/data/active"
PROMPT_TEMPLATE="$ROOT/data/contracts/_prompt-template.txt"

for f in "$ACTIVE_DIR"/*.json; do
  [ -f "$f" ] || continue
  SLUG=$(basename "$f" .json)
  [ "$SLUG" = "_schema" ] && continue

  # Read existing JSON to get URL
  URL=$(python3 -c "import json,sys; d=json.load(open('$f')); print(d.get('url',''))")
  [ -z "$URL" ] && { echo "SKIP $SLUG: no url"; continue; }

  echo "=== Crawling: $SLUG ==="
  echo "    URL: $URL"

  # Build prompt for hermes
  PROMPT="You are extracting hackathon competition details from the official page at: $URL

Read the page and extract ALL of the following into JSON. Be thorough — check for rules PDFs, submission forms, eligibility sections.

Return ONLY a JSON object with these fields:
{
  \"title\": \"full competition name\",
  \"rules_url\": \"direct link to official rules if found\",
  \"timeline\": {
    \"opens\": \"date\",
    \"build_deadline\": \"date\",
    \"measurement_window\": \"description or date\",
    \"finals\": \"date\",
    \"finals_location\": \"location\"
  },
  \"prizes\": {
    \"total_usd\": number,
    \"breakdown\": [{\"rank\": \"1st\", \"usd\": 25000}],
    \"leaderboard_pool\": \"description\"
  },
  \"judging\": {
    \"criteria\": [{\"name\": \"criterion\", \"weight\": \"HIGH|MEDIUM|LOW|EQUAL\", \"quote\": \"exact quote from rules\"}],
    \"how_to_win\": [\"step 1\", \"step 2\"],
    \"leaderboard_formula\": \"how ranking works\"
  },
  \"submission\": {
    \"types\": [\"standard\", \"composite\"],
    \"checklist\": [\"step 1\", \"step 2\"],
    \"required_tech\": [\"tech1\", \"tech2\"],
    \"submission_url\": \"where to submit\"
  },
  \"tracks\": [{\"name\": \"track name\", \"description\": \"what it is\"}],
  \"eligibility\": {
    \"open_to_all\": true,
    \"age_requirement\": \"18+ or age of majority\",
    \"excluded_jurisdictions\": [],
    \"notes\": \"any restrictions\"
  },
  \"sources\": [{\"url\": \"source url\", \"quote\": \"exact quote from that page\"}]
}

IMPORTANT: Return ONLY the JSON object. No markdown, no explanation. Every field must use exact quotes from the official rules where possible."

  # Run hermes with 420s timeout
  RESPONSE=$(timeout 420 hermes -z "$PROMPT" 2>/dev/null) || {
    echo "  FAILED: hermes timeout or error for $SLUG"
    continue
  }

  # Extract JSON from response
  JSON=$(echo "$RESPONSE" | python3 -c "
import sys, json, re
text = sys.stdin.read()
# Find JSON object
m = re.search(r'\{[\s\S]*\}', text)
if not m:
    print('ERROR: no JSON found', file=sys.stderr)
    sys.exit(1)
try:
    obj = json.loads(m.group())
    print(json.dumps(obj, indent=2))
except json.JSONDecodeError as e:
    print(f'ERROR: invalid JSON: {e}', file=sys.stderr)
    sys.exit(1)
") || { echo "  FAILED: JSON extraction for $SLUG"; continue; }

  # Merge with existing file (preserve added_at, strategy_notes, etc.)
  python3 -c "
import json, sys

existing = json.load(open('$f'))
new_data = json.loads('''$JSON''')

# Merge: new data overwrites crawled fields, existing preserved for manual fields
for key in ['title', 'rules_url', 'timeline', 'prizes', 'judging', 'submission', 'tracks', 'eligibility', 'sources']:
    if key in new_data and new_data[key]:
        existing[key] = new_data[key]

existing['last_crawled'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
existing['crawl_version'] = existing.get('crawl_version', 0) + 1

print(json.dumps(existing, indent=2))
" > "$f.tmp" && mv "$f.tmp" "$f"

  echo "  DONE: $SLUG (v$(python3 -c "import json; print(json.load(open('$f')).get('crawl_version',0))"))"
done

echo "=== Active crawl complete ==="
