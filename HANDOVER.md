# HANDOVER — 2026-08-28

## What's Built

- **MCP server** (11 tools) — agent-native hackathon coordination
- **Per-agent profiles** — each agent gets own skills, tags, assets
- **Rubric auto-generation** — enter with judging_criteria → rubric built
- **Hackathon-aware tasks** — derived from tracks, tech, themes, judging
- **Outcome tracking** — record wins/losses/hours for calibration
- **Scoring configurable** — all knobs in `data/scoring-config.json`
- **File locking** — optimistic concurrency on JSON writes
- **Repute adapter** — demand signals flow to worker marketplace

## What's NOT Built Yet

- Live data stream (fetch is manual, no cron)
- Per-agent scoring views (build-data.mjs reads single profile)
- CLI scripts bypass API auth
- SWE-bench / WebArena / tau3 benchmark adapters
- Real agent completing a full hackathon autonomously

## Key Files

| File | What |
|------|------|
| `mcp/server.mjs` | MCP server (11 tools) |
| `mcp/repute-adapter.mjs` | Demand signal → repute oracle |
| `profiles/registry.json` | Per-agent profiles (single source) |
| `data/scoring-config.json` | All scoring tuning knobs |
| `scripts/api-server.mjs` | Agent API (auth, tasks, rubrics) |
| `scripts/build-data.mjs` | Opportunity scoring pipeline |
| `scripts/populate-active.mjs` | Activation + task generation |
| `scripts/record-outcome.mjs` | Outcome tracking + calibration |
| `scripts/fetch-opportunities.mjs` | Devpost + Brabble data fetch |
