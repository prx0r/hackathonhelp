#!/bin/bash
# Batch-extract contracts using hermes on free model. Usage: batch-extract.sh [N]
N=${1:-30}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export HERMES_MODEL=ox-alpha-free  # HARDCODED FREE — do not switch to pool-consuming models
i=0; ok=0; fail=0
while IFS=$'\t' read -r slug url; do
  i=$((i+1)); [ $i -gt $N ] && break
  [ -f "$ROOT/data/contracts/$slug.json" ] && continue
  echo "[$i/$N] $slug"
  if timeout 300 "$ROOT/scripts/extract-contract.sh" "$slug" "$url" > /tmp/opencode/ext-$slug.log 2>&1; then
    ok=$((ok+1))
  else
    fail=$((fail+1)); echo "  failed (see /tmp/opencode/ext-$slug.log)"
  fi
done < /tmp/opencode/batch.tsv
echo "DONE: $ok extracted, $fail failed"
