# Active Hackathons Schema

Per-hackathon tracking for events you're actively entering.

## File: `data/active/<slug>.json`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | string | yes | Stable URL id |
| `title` | string | yes | Event name |
| `url` | string | yes | Official competition page |
| `rules_url` | string | no | Direct link to official rules PDF/page |
| `status` | enum | yes | `active` \| `submitted` \| `finalist` \| `won` \| `lost` \| `dropped` |
| `added_at` | ISO datetime | yes | When added to active tracking |
| `timeline` | object | yes | Key dates (opens, build_deadline, finals, etc.) |
| `prizes` | object | yes | Prize breakdown with USD/ALGO amounts |
| `judging` | object | yes | Criteria, weights, how_to_win, leaderboard formula |
| `submission` | object | yes | Types, checklist, required_tech, submission_url |
| `tracks` | array | yes | Available entry tracks |
| `eligibility` | object | yes | open_to_all, notes, restrictions |
| `strategy_notes` | object | no | Our entry type, endpoint, overlap analysis |
| `sources` | array | yes | URLs with exact quotes from official rules |
| `last_crawled` | ISO datetime | yes | When data was last verified |
| `crawl_version` | int | yes | Increment on each re-crawl |

## `timeline` fields

| Field | Description |
|-------|-------------|
| `opens` | Registration/competition opens |
| `build_deadline` | Last day to build/submit |
| `measurement_window` | Leaderboard measurement period (may be unannounced) |
| `finals` | Final presentations |
| `finals_location` | Where finals happen |

## `judging` fields

| Field | Description |
|-------|-------------|
| `criteria` | Array of `{name, weight, quote}` |
| `how_to_win` | Ordered list of steps to win |
| `leaderboard_formula` | How leaderboard ranking works |

## `submission` fields

| Field | Description |
|-------|-------------|
| `types` | Valid entry types (standard, composite, orchestrator) |
| `checklist` | Step-by-step submission checklist |
| `required_tech` | Required technologies |
| `submission_url` | Where to submit |

## `strategy_notes` fields

| Field | Description |
|-------|-------------|
| `our_entry_type` | Which track we're entering |
| `our_endpoint` | What we're building/exposing |
| `overlap_with_*` | How this connects to other projects |
| `key_insight` | Core strategy for winning |

## Usage

```bash
# Add a hackathon
scripts/activate-hackathon.sh <slug> <url>

# Crawl/refresh all active hackathons
scripts/crawl-active.sh

# Score project against rubric
node scripts/score-project.mjs <slug>                      # show rubric
node scripts/score-project.mjs <slug> --set "Criterion" 75 "notes"  # score it
node scripts/score-project.mjs <slug> --project <repo> <intent>      # link project
node scripts/score-project.mjs <slug> --checklist         # readiness check

# Query via API
curl hackathonhelp.pages.dev/api/v1/active/<slug>.json | jq '.judging'
```

## `rubric` fields (generated from judging.criteria)

| Field | Type | Description |
|-------|------|-------------|
| `criteria[].name` | string | Judging criterion name |
| `criteria[].weight` | number | Percentage of total score |
| `criteria[].levels` | object | What 0/25/50/75/100% looks like |
| `criteria[].what_we_need` | string | What WE specifically need to do |
| `criteria[].our_score` | number|null | Our self-assessed score (0-100) |
| `criteria[].our_notes` | string|null | Evidence/notes for our score |
| `disqualifiers` | string[] | Auto-fail conditions |
| `our_total_score` | number|null | Weighted total across criteria |

## `project` fields (our submission)

| Field | Type | Description |
|-------|------|-------------|
| `repo_url` | string|null | GitHub repo URL |
| `repo_local_path` | string|null | Local clone path |
| `intent` | string|null | Which intent/track we're targeting |
| `what_it_does` | string|null | One-liner description |
| `tech_stack` | string[] | Technologies used |
| `demo_url` | string|null | Live demo URL |
