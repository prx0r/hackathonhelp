# HackathonHelp

**Opportunity intelligence for builders.** Not "where are hackathons" — which ones are *worth entering*, normalized by real competition.

Live: https://hackathonhelp.pages.dev · Agent API: `/api/v1/{top,opportunities,changes}.json`

## The alpha: fair-share per entrant
`fair_share = prize_pool / current_registrants`

A $100K event with 300 entrants ($333/share) is a different animal from $100K with 20,000 ($5/share).

**v0.2 decision engine** - two numbers, not one:
- **Opportunity score** (deadline-free): normalized cash, serious-field odds via payout-slot model, organizer quality
- **Action state**: ENTER NOW / SPRINT / PREP / WATCH / SKIP - feasibility prior x latest-safe-start math decides *when*, not just *whether*
- Eligibility hard gates first (student-only/age-gated/in-person events are excluded, never ranked)

Data from the official Devpost API. Deterministic formulas, documented on /methodology.

## Pipeline
```
scripts/fetch-opportunities.mjs   devpost API → data/seed.json (72+ events)
scripts/build-data.mjs            metrics + mega detection + history diff
                                  → web/src/data/derived.json
                                  → web/public/api/v1/*.json
astro build                       75 static pages
```
Daily refresh = re-run fetch → commit snapshot to data/history/ → deploy.
The diff feed at /changes is the moat starter.

Scaffolded on the objective-engine pattern proven in llmdeals (github.com/prx0r/llmdeals).
Next verticals queued in llmdeals/docs/OBJECTIVE-ENGINE.md.
