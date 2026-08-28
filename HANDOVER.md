# HackathonHelp — Handover
2026-08-23, 23:30 UTC · repo: github.com/prx0r/hackathonhelp · live: https://hackathonhelp.pages.dev

## What this is
Opportunity-intelligence engine for online individual builders. Not a directory:
normalizes prizes (cash vs credits), estimates serious fields from submission-rate
priors, gates eligibility (student/age/in-person excluded, never ranked), and emits
decision states (ENTER NOW / SPRINT / PREP / WATCH / SKIP) with the math shown.

Stack: Astro static site + deterministic Node pipeline. No backend. Cloudflare Pages.
Data: data/seed.json (single source) → scripts/build-data.mjs → derived JSON + API.

## Build notes (things that bit us — read before editing)
1. AGENTS.md at llmdeals applies here too: never put HTML template literals inside
   JSX expressions — precompute in frontmatter, render with set:html.
2. prebuild path is `node ../scripts/build-data.mjs` (relative to web/).
3. Brabble API key lives in .env (BRABBLE_API_KEY), gitignored. 1000 req/day.
4. lablab.ai is Cloudflare-challenge walled for curl; its 7 events are covered by
   hand-verified entries in data/manual-events.json instead.
5. Manual events flow: fetch merges data/manual-events.json → seed. first_deadline
   (milestone) overrides ends_at for urgency math (Telegraph Aug 31 case).
6. Deploy: `npx wrangler pages deploy web/dist --project-name=hackathonhelp --branch=main`
   Key: CLOUDFLARE_API_TOKEN env. If pages.dev serves stale, hard refresh or use
   the deployment-hash URL.

## Daily/weekly loop
```
node scripts/fetch-opportunities.mjs     # devpost + brabble + manual → seed.json
node scripts/build-data.mjs              # metrics, decisions, diffs, portfolio + coordination API
cd web && npm run build                  # 158 static pages incl per-slug + APIs
git add data/history && commit           # snapshot = the moat
deploy                                   # wrangler command above
```

## Agent coordination (new)
Agents coordinate via `data/coordination/hub.json` + per-hackathon tasks in `data/active/<slug>.json`.

### Adding a new active hackathon
```bash
# Option A: from seed.json (auto-fills title, prize, deadline)
node scripts/populate-active.mjs --from-seed <slug>

# Option B: from URL (creates skeleton)
bash scripts/activate-hackathon.sh <slug> <url>

# Then agent follows POPULATE-PROMPT.md to crawl site and fill details
```

### Agent task management
```bash
node scripts/agent-task.mjs status                    # overview
node scripts/agent-task.mjs list                      # all tasks
node scripts/agent-task.mjs next <agent-id>           # get next task
node scripts/agent-task.mjs claim <task-id> <agent>   # claim
node scripts/agent-task.mjs update <task-id> <agent> --status in_progress --notes "..."
node scripts/agent-task.mjs complete <task-id> <agent> --output '{"key":"val"}'
```

### Rubric + project scoring
```bash
node scripts/score-project.mjs <slug>                              # show rubric
node scripts/score-project.mjs <slug> --set "Criterion" 75 "why"  # score it
node scripts/score-project.mjs <slug> --project <repo> <intent>    # link project
node scripts/score-project.mjs <slug> --checklist                  # readiness check
```

### Agent API (agent-native, no human signup)
```bash
node scripts/api-server.mjs                    # start API on :3847
# Discovery: GET /.well-known/ai-plugin.json
# Register:  POST /api/v2/agents/register {agent_id, caps[]}
# Auth:      X-Agent-Key header on all writes
# Full docs: AGENT-PROTOCOL.md
```
Full protocol: AGENT-GUIDE.md · Prompt: POPULATE-PROMPT.md · API: `/api/v1/coordination/*.json`
ChatGPT researcher path: run data/RESEARCHER-PROMPT.md task → save output to
data/candidates/date.json → node scripts/import-candidates.mjs <file> → same loop.

## Current state (2026-08-23)
- 154 opportunities | 25 gated out (student/age/in-person) | 3 extracted contracts
- Decisions: 1 SPRINT (Telegraph, first deadline Aug 31!), 7 PREP, rest WATCH/SKIP
- Portfolio chain: Telegraph (18h eff.) → ETHOnline → AMD ACT III

## Immediate TODOs (owner: operator)
1. **Telegraph H1 deadline is Aug 31** (first milestone) — engine now shows SPRINT,
   9 days. Commit or drop this week.
2. Run ChatGPT discovery prompt once; import candidates.
3. After entering any event, log outcomes to data/history/outcomes-*.json
   (predicted vs actual hours/submissions/result) — calibration data is the moat.

## Future dev ideas (do NOT overengineer)
- Batch contract extraction over all devpost events (hermes loop, ~3min/page)
- Prize-ladder verification on official pages → replace slot assumptions in payout model
- Kill-switch daily re-eval for entered events (remaining EV vs remaining hours)
- Personal skill-vector file → real SkillEdge in sigmoid
- MCP server wrapping /api/v1 (tool names already specced in llmdeals docs)
- Clone pattern for next vertical: GPU compute or cloud credits (see llmdeals/docs/OBJECTIVE-ENGINE.md)
