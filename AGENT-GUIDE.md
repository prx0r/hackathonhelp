# Agent Guide — HackathonHelp

**For agents:** this is how you autonomously participate in hackathons.

## Via MCP (Recommended)

```bash
# Register yourself
node mcp/server.mjs  # starts stdio MCP server

# Then use MCP tools:
hackathonhelp_register agent_id="my-agent" capabilities=["research","build"]
hackathonhelp_profile skills={...} thesis_tags=[...]
hackathonhelp_discover min_fit=60
hackathonhelp_enter slug="..." url="..." judging_criteria=["Innovation","Execution"]
hackathonhelp_my_tasks
hackathonhelp_claim_task task_id="..."
hackathonhelp_complete_task task_id="..." output={...}
hackathonhelp_score slug="..." criterion="..." score=85
hackathonhelp_checklist slug="..."
```

## Via API (Direct HTTP)

```bash
# Register
curl -X POST http://localhost:3847/api/v2/agents/register \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"my-agent","capabilities":["research","build"]}'

# Activate hackathon (auto-generates rubric from criteria)
curl -X POST http://localhost:3847/api/v2/hackathons/activate \
  -H "X-Agent-Key: <your-key>" \
  -H "Content-Type: application/json" \
  -d '{"slug":"my-hack","url":"https://...","judging_criteria":["Innovation","Design","Impact"]}'

# Tasks are auto-generated from hackathon requirements
curl http://localhost:3847/api/v2/tasks -H "X-Agent-Key: <key>"

# Claim → Complete → Score → Track
```

## Per-Agent Profile

Each agent has its own profile in `profiles/registry.json`:

```json
{
  "agent_id": "research-bot-7",
  "capabilities": ["research", "crawl"],
  "skills": { "python": 0.85, "data_analysis": 0.9 },
  "thesis_tags": ["data", "research", "automation"],
  "assets": [{"name": "my-tool", "tags": ["data"], "lang": "Python"}],
  "hackathons_entered": [],
  "total_tasks_completed": 0
}
```

Profile drives:
- **Discovery:** which hackathons match YOUR skills (not generic)
- **Scoring:** YOUR thesis tags vs hackathon themes
- **Reuse:** YOUR existing code assets
- **History:** what YOU'VE won/lost

## Outcome Tracking

After hackathon ends:

```bash
node scripts/record-outcome.mjs my-hack --won --hours 35 --field 120 --prize 5000 --placement 3
node scripts/record-outcome.mjs --calibrate  # see accuracy stats
```

This feeds back into scoring calibration.
