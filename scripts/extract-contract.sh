#!/bin/bash
# Usage: extract-contract.sh <slug> <official-url>
set -e
SLUG="$1"; URL="$2"
[ -z "$SLUG" || -z "$URL" ] && { echo "usage: $0 <slug> <url>"; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TPL="$ROOT/data/contracts/_prompt-template.txt"
PROMPT=$(sed "s|{URL}|$URL|g; s|{SLUG}|$SLUG|g" "$TPL")
OUT="/tmp/opencode/contract-$SLUG.json"
mkdir -p /tmp/opencode
echo "[extract] $SLUG <- $URL (hermes/mimo)"
timeout 420 hermes ${HERMES_MODEL:+-m "$HERMES_MODEL"} -z "$PROMPT" > "$OUT" 2>&1 || { echo "[fail] hermes exit $?"; exit 1; }
# strip to first {...} JSON blob
python3 - "$OUT" "$ROOT/data/contracts/$SLUG.json" << 'PY'
import json,sys,re
raw=open(sys.argv[1]).read()
m=re.search(r'\{.*\}', raw, re.S)
if not m: print('[reject] no JSON found'); sys.exit(1)
try: c=json.loads(m.group(0))
except Exception as e: print('[reject] invalid JSON:',e); sys.exit(1)
req=['eligibility','judging','originality','sources']
missing=[k for k in req if k not in c]
if missing: print('[reject] missing sections:',missing); sys.exit(1)
if not c.get('sources'): print('[reject] no sources'); sys.exit(1)
c['validated']=True; c['validator']='deterministic-v1'
json.dump(c,open(sys.argv[2],'w'),indent=2)
print('[ok] contract saved:',sys.argv[2])
PY
