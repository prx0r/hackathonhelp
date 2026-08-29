# Entry Workflow — GitHub Repo as Entry + Rubric Scoring

You have 3 repos, 5 sponsor tracks. One repo can win multiple sponsors, so we score a matrix.

## Store an entry

`data/entries/<id>.json`:
```json
{
  "id": "proofdesk",
  "repo": "https://github.com/you/proofdesk",
  "commit": "abc123",
  "tracks": ["foxit", "doctavian", "nutrient"]
}
```
`proofdesk` → Foxit $700 + Doctavian $650 + Nutrient $1000 = $2350 from one codebase.
`llmdeals` → SerpApi $2000
`agentseolab` → name.com $2000

Update `repo` + `commit` when you push a new version you want scored.

## Rubrics

`data/rubrics/devnetwork-<track>.json` — generated from sponsor pages:
- `foxit` (40 tools + eSign handoff)
- `doctavian` (branch/loop template + real generation)
- `nutrient` (DWS pipeline + Viewer + audit)
- `serpapi` (live search data)
- `namecom` (search+register+DNS depth)

Each has `rubric[]` (criterion, weight, check) + `must_have[]`.

## Score (5 min)

**Auto (30s):**
```bash
node scripts/score-entry.mjs --entry proofdesk --track foxit
# clones repo (or uses local stub if https://github.com/you/... placeholder)
# greps for API calls, checks README for video, checks tests
# → Auto: 42/100 + must-have fails
# writes data/scores/proofdesk-foxit.md (peer template) + .json (machine)
```

**Peer (2 min each, 2 peers):**
Open `data/scores/<entry>-<track>.md` — it has a 5-min checklist:
- [ ] Tool coverage ...
- [ ] Signing handoff ...
Each peer scores 0-20 per criterion → avg → final 0-100.

**Matrix:**
```bash
for t in foxit doctavian nutrient; do node scripts/score-entry.mjs --entry proofdesk --track $t; done
node scripts/score-entry.mjs --entry llmdeals --track serpapi
node scripts/score-entry.mjs --entry agentseolab --track namecom
```

## MCP

`hackathonhelp_score_entry` — call from Claude/Cursor:
```
hackathonhelp_score_entry { entry: "proofdesk", track: "foxit" }
```
Wraps the same script and returns the score + peer template.

## GitHub Action

`.github/workflows/score-entry.yml` — on push to `data/entries/**` or manual `workflow_dispatch`:
- Fans out 5 jobs (matrix above)
- Runs `score-entry.mjs`
- Comments the scorecard on PR (if PR)
- Uploads `data/scores/*.md` + `*.json` as artifacts

## Peer review loop

1. Push to `proofdesk` → update `data/entries/proofdesk.json` commit
2. Action scores vs 3 rubrics → you + teammate fill the 0-20 peer columns in the `.md` (5 min)
3. If auto <55 due to must-have missing → fix code, push again

That's the entire loop: repo is the entry, rubric is the contract, score is the peer review.
