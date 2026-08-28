# Task Schema

Tasks live inside `data/active/<slug>.json` under the `tasks` array.
The master coordination state is in `data/coordination/hub.json`.

## Task Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique task ID: `<slug>-<type>-<short>` (e.g. `telegraph-h1-research-miner-api`) |
| `type` | enum | yes | `research` \| `build` \| `crawl` \| `submit` \| `document` \| `social` |
| `title` | string | yes | One-line description |
| `description` | string | no | Detailed context for the agent picking this up |
| `status` | enum | yes | `queued` \| `claimed` \| `in_progress` \| `review` \| `done` \| `blocked` |
| `assigned_to` | string | no | Agent ID who claimed it (null = unclaimed) |
| `claimed_at` | ISO datetime | no | When agent claimed it |
| `priority` | enum | yes | `critical` \| `high` \| `medium` \| `low` |
| `depends_on` | string[] | no | Task IDs this depends on |
| `deliverables` | string[] | no | What "done" looks like (file paths, URLs, outputs) |
| `notes` | string | no | Agent's working notes / progress log |
| `deadline` | ISO datetime | no | Hard deadline for this specific task |
| `estimated_hours` | number | no | Time estimate |
| `completed_at` | ISO datetime | no | When marked done |
| `output` | object | no | Structured output (varies by task type) |

## Task Types

### research
Investigate a hackathon: read rules, find tracks, verify prizes, check eligibility.
**Output:** Updated active JSON fields, source quotes, strategy notes.

### build
Write code: implement a feature, create a submission artifact, build a demo.
**Output:** File paths, repo links, test results.

### crawl
Fetch/refresh data from official pages. Low-level data gathering.
**Output:** Updated JSON fields, new sources.

### submit
Handle the actual submission: fill forms, upload, confirm receipt.
**Output:** Submission confirmation, receipt URL.

### document
Write docs, README, build story, demo script.
**Output:** File paths, content.

### social
Post updates on X, Discord, community channels.
**Output:** Post URLs, engagement metrics.

## Progress Tracking

Each active hackathon also has a `progress` object:

```json
{
  "progress": {
    "phase": "research | build | submit | done",
    "pct_complete": 35,
    "blocks": ["waiting on API key from Alpaca"],
    "last_update": "2026-08-28T12:00:00Z",
    "updated_by": "agent-id"
  }
}
```

## Agent IDs

Any string. Convention: `<role>-<instance>` (e.g. `hermes-1`, `researcher-1`, `builder-1`).
Register yourself in `hub.json` → `agents` with your capabilities.
