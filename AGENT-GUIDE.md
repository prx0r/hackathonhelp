# Agent Coordination Protocol

**Read this first.** This is how agents coordinate on hackathon entries.

## Quick Start

```bash
# 1. Register yourself
node scripts/agent-task.mjs register hermes-1 --caps "research,build,crawl"

# 2. See what needs doing
node scripts/agent-task.mjs status
node scripts/agent-task.mjs list

# 3. Get your next task
node scripts/agent-task.mjs next hermes-1

# 4. Claim it
node scripts/agent-task.mjs claim telegraph-h1-research-rules hermes-1

# 5. Update progress
node scripts/agent-task.mjs update telegraph-h1-research-rules hermes-1 --status in_progress --notes "Started reading rules page"

# 6. Mark done
node scripts/agent-task.mjs complete telegraph-h1-research-rules hermes-1 --output '{"findings":"..."}'
```

## File Layout

```
data/
  coordination/
    hub.json              ← Master state: active hackathons, agents, conflicts
  active/
    selected.json         ← Which hackathons we're tracking
    <slug>.json           ← Per-hackathon: rules, strategy, tasks, progress
    _task-schema.md       ← Task object schema reference
    _schema.md            ← Active hackathon schema reference
scripts/
  agent-task.mjs          ← CLI for task management
```

## Rules

1. **Read hub.json first** — it tells you what's active, what's priority, who's doing what.
2. **Never modify another agent's task** without releasing it first (set status back to `queued`).
3. **Update notes frequently** — other agents and the human need to see progress.
4. **One task at a time per agent** — finish before claiming another (or explicitly note you're multi-tasking).
5. **Deliverables are contracts** — when you claim a task, the deliverables define what "done" looks like.
6. **Deadlines are real** — if you can't make it, update the task notes and flag it.

## Task Lifecycle

```
queued → claimed → in_progress → review → done
                     ↓
                  blocked (add reason to notes)
```

## Hub.json Structure

```json
{
  "active_hackathons": [...],    // What we're working on
  "agents": {                    // Who's available
    "hermes-1": {
      "capabilities": ["research", "build"],
      "last_seen": "2026-08-28T...",
      "tasks_completed": 3
    }
  },
  "task_queue": [...],           // Unclaimed task IDs
  "recent_completions": [...],   // Last 50 completions
  "conflicts": [...]             // Active disagreements
}
```

## API Access (for remote agents)

```
GET /api/v1/coordination/hub.json     — master state
GET /api/v1/coordination/tasks.json   — all tasks with status
GET /api/v1/active/<slug>.json         — full hackathon data + tasks
```

## Task Types

| Type | What | Output |
|------|------|--------|
| `research` | Investigate rules, strategy, competitors | Updated JSON, findings |
| `build` | Write code, create artifacts | Files, repos, test results |
| `crawl` | Fetch data from official pages | Updated JSON fields |
| `submit` | Handle submission process | Confirmation, receipt |
| `document` | Write docs, README, demo script | File paths |
| `social` | Post updates on X/Discord | Post URLs |

## Conflict Resolution

If two agents claim the same task or produce conflicting outputs:
1. Both update the task notes with their perspective
2. The human resolves it (or agents discuss in hub.json `conflicts` array)
3. Winner keeps the task, loser gets reassigned

## Progress Tracking

Each active hackathon has a `progress` object:

```json
{
  "phase": "research | build | submit | done",
  "pct_complete": 35,
  "blocks": ["waiting on API key"],
  "last_update": "2026-08-28T...",
  "updated_by": "hermes-1"
}
```

This updates automatically when tasks are completed.
