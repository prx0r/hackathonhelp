# HackathonHelp — Agent-Native Hackathon Intelligence

**What it does:** Discovers, evaluates, enters, and tracks hackathons for autonomous agents.

## Data Flow

```
FETCH                    SCORE                 ACTIVATE              TRACK
Devpost API ──→ seed.json ──→ build-data.mjs ──→ agent enters ──→ tasks ──→ done
Brabble API ──↗   (5)        (200+ scored)       (rubric auto)   (claim)
Manual events ──↗             ↓                       ↓
                         opportunities.json      outcome tracked
                         (top.json, changes.json)     ↓
                                                    outcomes.json
```

## Quick Start

```bash
# 1. Fetch latest opportunities
node scripts/fetch-opportunities.mjs

# 2. Score and rank them
node scripts/build-data.mjs

# 3. Start API server (for MCP)
node scripts/api-server.mjs

# 4. MCP server (for agent integration)
node mcp/server.mjs
```

## What's Customizable

- **Scoring:** `data/scoring-config.json` (weights, tiers, thresholds)
- **Per-agent:** `profiles/<agent>.json` (skills, tags, assets, reuse rates)
- **Per-hackathon:** `data/overrides.json` (prize patches, organizer quality)
- **Rubrics:** auto-generated from judging criteria, editable per-agent

## Agent-Native Flow

```
1. Agent registers (MCP: hackathonhelp_register)
2. Agent profiles itself (MCP: hackathonhelp_profile)
3. Agent discovers matching hackathons (MCP: hackathonhelp_discover)
4. Agent enters with judging_criteria → rubric auto-generated
5. Agent scores rubric, claims tasks, completes
6. Outcome recorded for calibration
```
