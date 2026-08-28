# Populate Active Hackathon — Agent Prompt

You are populating a new active hackathon entry for HackathonHelp.
The skeleton has been created at `data/active/<SLUG>.json`.
Your job: fill it with verified facts from official sources. Never guess.

## Step 1: Crawl the official page

Fetch the hackathon URL. Extract:
- **Title** (exact official name)
- **Organizer** (company/org running it)
- **Prize pool** (total USD, broken down by track/rank if available)
- **Timeline** (opens, submission deadline, finals date)
- **Tracks** (available entry types with descriptions)
- **Eligibility** (age, location, student-only, team requirements)
- **Judging criteria** (names, weights, direct quotes from rules)
- **Submission requirements** (what to submit, required tech, submission URL)
- **Registrants** (current count if shown)

If the page is behind Cloudflare or JS-rendered, try the Devpost API or alternative sources.

## Step 2: Find and read the rules

Check for a rules page, rules PDF, or guidelines page. Common patterns:
- `<url>/rules`
- `<url>/guidelines`
- `<url>/official-rules`
- Devpost events: `<slug>.devpost.com/rules`
- lablab.ai: `lablab.ai/hackathon-rules`

Extract exact quotes for:
- Judging criteria and weights
- Submission deadlines (exact time + timezone)
- Eligibility restrictions
- Required technologies
- What disqualifies entries

## Step 3: Clone reference repos

If the hackathon has official repos, SDKs, or starter kits:
```bash
mkdir -p data/active/<SLUG>-refs
git clone <repo-url> data/active/<SLUG>-refs/<repo-name>
```

Log what you cloned in the JSON `sources` array.

## Step 4: Write the JSON

Update `data/active/<SLUG>.json` with ALL of the following. Use `null` for unknowns — never fabricate.

```json
{
  "slug": "<SLUG>",
  "title": "<exact official title>",
  "url": "<official competition page>",
  "rules_url": "<direct link to rules or null>",
  "status": "active",
  "added_at": "<when we added this>",
  "timeline": {
    "opens": "<ISO date or null>",
    "build_deadline": "<ISO datetime with timezone if known>",
    "measurement_window": "<description or null>",
    "finals": "<ISO date or null>",
    "finals_location": "<location or null>"
  },
  "prizes": {
    "total_usd": <number or null>,
    "breakdown": [
      {"rank": "<track/rank>", "usd": <amount>}
    ],
    "leaderboard_pool": "<description or null>"
  },
  "judging": {
    "criteria": [
      {"name": "<criterion>", "weight": "<% or HIGH|MEDIUM|LOW>", "quote": "<exact text from rules>"}
    ],
    "how_to_win": ["<ordered list of what wins>"],
    "leaderboard_formula": "<how ranking works or null>"
  },
  "submission": {
    "types": ["<entry types>"],
    "checklist": ["<step-by-step submission steps>"],
    "required_tech": ["<technologies>"],
    "submission_url": "<where to submit>"
  },
  "tracks": [
    {"name": "<track name>", "description": "<what this track is>"}
  ],
  "eligibility": {
    "open_to_all": <true|false>,
    "notes": "<restrictions, gotchas>"
  },
  "strategy_notes": {
    "our_entry_type": "<which track we'd enter or null>",
    "our_endpoint": "<what we'd build or null>",
    "key_insight": "<core strategy for winning>"
  },
  "sources": [
    {"url": "<url>", "quote": "<exact quote from that page>"}
  ],
  "last_crawled": "<ISO datetime now>",
  "crawl_version": 1
}
```

## Step 5: Generate the rubric

From the judging criteria, create a `rubric` object. For each criterion:
1. **weight** — percentage from rules (or estimate if not given)
2. **levels** — what 0/25/50/75/100% looks like (concrete, not vague)
3. **what_we_need** — what WE specifically need to do to score here
4. **our_score** — null until scored

```json
{
  "rubric": {
    "generated_from": "source description",
    "track": "which track we're entering",
    "criteria": [
      {
        "name": "Criterion",
        "weight": 40,
        "description": "What judges evaluate",
        "levels": {"100": "...", "75": "...", "50": "...", "25": "...", "0": "..."},
        "what_we_need": "Specific action for us",
        "our_score": null,
        "our_notes": null
      }
    ],
    "disqualifiers": ["auto-fail conditions"],
    "total_possible": 100,
    "our_total_score": null,
    "our_confidence": null
  }
}
```

## Step 6: Add project info

Add a `project` object for tracking our submission:

```json
{
  "project": {
    "repo_url": "<github url or null>",
    "repo_local_path": "<local clone path or null>",
    "demo_url": "<live demo or null>",
    "intent": "<which intent/track>",
    "what_it_does": "<one-liner>",
    "tech_stack": ["<technologies>"],
    "submission_files": [],
    "demo_script": null,
    "build_story": null
  }
}
```

## Step 7: Create initial tasks

Add a `tasks` array and `progress` object. Tasks should cover:
1. **research** — deep-read rules, verify all facts (priority: critical)
2. **research** — document required tech/SDK/API (priority: high)
3. **build** — set up local dev environment (priority: high)
4. **build** — implement core submission (priority: high)
5. **submit** — final submission (priority: critical)

```json
{
  "progress": {
    "phase": "research",
    "pct_complete": 0,
    "blocks": [],
    "last_update": "<ISO datetime>",
    "updated_by": null
  },
  "tasks": [...]
}
```

## Step 8: Register in coordination hub

Add the hackathon to `data/coordination/hub.json` → `active_hackathons` array.

## Step 9: Verify

Run the build pipeline to confirm your JSON is valid:
```bash
node scripts/build-data.mjs
```

If it errors, fix the JSON and re-run.

## Quality checklist

Before marking done, verify:
- [ ] Every number comes from the official page (not guessed)
- [ ] Deadlines include timezone if known
- [ ] Judging criteria have direct quotes from rules
- [ ] Sources array has URLs with supporting quotes
- [ ] `null` used for unknowns (never empty strings or fake data)
- [ ] Rubric generated with concrete levels for each criterion
- [ ] Project info filled in (repo, intent, what_it_does)
- [ ] Tasks created with realistic deadlines relative to submission date
- [ ] Build pipeline runs without errors
- [ ] Score against rubric: `node scripts/score-project.mjs <slug> --checklist`
