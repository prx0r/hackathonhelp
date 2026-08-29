# HackathonHelp MCP Integration

Multi-agent hackathon coordination with personalized profiles.

## What changed from v1

- **Per-agent profiles**: every agent gets its own skills, tags, assets (not hardcoded to prx0r)
- **Rubric auto-generation**: enter a hackathon with judging_criteria → rubric built automatically
- **Configurable scoring**: `data/scoring-config.json` has all tuning knobs (weights, tiers, thresholds)
- **Fixed MCP discover**: now correctly parses `{opportunities:[...]}` response format
- **Dynamic agent ID**: repute-adapter requires `--agent` flag, no hardcoded fallback

## Flow

```
Agent registers → gets profile → discovers matching hackathons
  ↓
Enter with judging_criteria → rubric auto-generated → tasks created
  ↓
Score rubric → claim tasks → complete → track progress
  ↓
Demand signals flow to repute oracle → worker capability profiles
```

## Scoring is customizable

`data/scoring-config.json` contains:
- Score component weights (prize, winnability, fit, etc.)
- Field size tiers
- Prize multipliers (cash=1.0x, credits=0.25x, etc.)
- Feasibility priors by deadline
- Mega detection thresholds
- Default rubric template

Agents can override via profile: `reuse_by_event`, `shadow_hour_value_usd`, `thesis_tags` all affect scoring.

## What's robust

- API registration + auth (X-Agent-Key)
- Task lifecycle (claim/update/complete)
- Opportunity scoring pipeline (build-data.mjs)
- Profile registry + capability matching
- MCP server with 11 tools
- Rubric auto-generation from judging criteria

## What's not finished

- File locking for concurrent writes (JSON last-write-wins)
- Outcome tracking (did we win? real hours?)
- CLI scripts bypass auth (API has it, CLI doesn't)
- Per-agent scoring views (build-data.mjs reads single profile)
