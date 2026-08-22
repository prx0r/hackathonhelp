# HackathonHelp

**Opportunity intelligence for builders.** Not "where are hackathons" — which ones are *worth entering*, normalized by real competition.

Live: https://hackathonhelp.pages.dev · Agent API: `/api/v1/{top,opportunities,changes}.json`

## The alpha: fair-share per entrant
`fair_share = prize_pool / current_registrants`

A $100K event with 300 entrants ($333/share) is a different animal from $100K with 20,000 ($5/share). Every event gets:
- **Opportunity score** (0-100): value 40% + odds 35% + urgency + access
- **🔥 Mega flag**: fair-share ≥$20, or big-prize × below-median competition, transparent reasons shown
- **Deadline radar**: closing-soon events with good odds

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
