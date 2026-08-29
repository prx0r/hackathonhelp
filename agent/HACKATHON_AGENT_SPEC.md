# Autonomous Hackathon Agent — Git-Native Procedure

**Goal:** One agent, one `git` repo per entry, stays organized and makes steady progress on a multi-sponsor hackathon (e.g., `proofdesk` → Foxit/Doctavian/Nutrient) without rebuilding the world.

## Lab Layout (one `git init`)

```
my-lab/
  WORKSPACE/proofdesk/      # entry repo clone (https://github.com/prx0r/proofdesk)
    WORKORDER.json          # prize, participants, tracks, p80, reuse, deadline
    COST.md                 # git log → remaining h, $ to finish, latest_safe
    SCORE.md                # auto + peer vs rubric (foxit 60, nutrient 68...)
    src/                    # agent writes code, commits per session
    MEMFS/                  # Letta git-backed memory (submodule)
      system/identity.md      # always loaded
      research/task-patterns.md
      skills/foxit-esign/SKILL.md
  LEDGER/                   # WorkerKit EventLedger SQLite (chain hash, git-ignored, syncs to Hydra)
  RECEIPTS/                 # WorkReceipt .af (JCS, DSSE, Merkle) — git-tracked
```

`npx workerkit init my-lab` creates this. `WORKORDER.json` from `agent/WORKORDER.template.json:1` (prize 3500, 120 participants, reuse 0.35, p80 40h, shadow $35).

## Agent Loop (per hackathon entry)

**1. Discover & Plan (once)**
```bash
node scripts/build-data.mjs --profile data/builder-profile.json  # hackathonhelp scores DevNetwork 200+ opps, feasibilityPrior, latest_safe_start
node scripts/score-entry.mjs --entry proofdesk --track foxit      # auto 42 → peer template data/scores/proofdesk-foxit.md
```
Agent reads `data/rubrics/devnetwork-foxit.json:1` (40 tools + eSign handoff) and `WORKORDER.json`, writes `WORKSPACE/proofdesk/TODO.md` broken into rubric slices:
- Foxit tool coverage (25%) → `src/foxit/*`
- Signing handoff (30%) → `src/esign/*`
- Doctavian template branch/loop (35%) → `src/doctavian/`

**2. Session = Letta + git commit + re-score (repeat)**
```bash
for session in {1..10}; do
  letta_worker.py --workorder WORKSPACE/proofdesk/WORKORDER.json
  # → LettaAgentClient(backend:"local", agentId=moltwork_worker_id, session=cwd:WORKSPACE/proofdesk)
  # → reads MEMFS/system + Lab Brief (prior runs' trajectory refs), executes one TODO slice, `git commit -m "feat: foxit eSign handoff"`
  # → EventLedger.append(run.started→run.completed, chain hash)
  # → node scripts/score-entry.mjs --entry proofdesk --track foxit → SCORE.md: 42→58→68
  # → git log --since 14d | wc -l *0.6 → COST.md: logged 4.2h, remaining 21.8h, $763, latest_safe 2026-09-21, feas 1.0
  # → Hydra syncs LEDGER + MEMFS diff
done
```
Each commit improves `COST.md` estimate (real `RunMeter` `mw/economics/costs.py:1` replaces 0.6h heuristic after first run). If `SCORE.md` `must-have` still capped <55 (e.g., no `Foxit eSign` call), next session auto-prioritizes that slice.

**3. Stay organized (git is the planner)**
- **Branch per track:** `git -C WORKSPACE/proofdesk checkout -b foxit-esign` → merge to `main` when `score-entry` >65.
- **Cost projection:** `COST.md` from `git log` + `p80*(1-reuse)` (`hackathonhelp/scripts/build-data.mjs:212`, `mw/economics/decisions.py:1` CONTINUE/ABORT on EV) — agent sees `remaining $763` vs `prize $3500` and decides to continue.
- **Peer async:** Push → GitHub Action `.github/workflows/score-entry.yml:1` scores vs 3 rubrics, comments `data/scores/*.md` 5-min checklist on PR — human/peers fill 0-20, agent reads it next session via `MEMFS/research/peer-feedback.md`.

**4. Submit**
When `SCORE.md` >70 on all 3 tracks and `git log` shows `latest_safe` not passed:
```bash
# README demo video link + one-liner where Doctavian/Nutrient did work
# git tag v0.9 && git push
# hackathonhelp: update data/entries/proofdesk.json commit → 2324bd5
# DevNetwork → submit repo URL + video (one repo, 3 sponsor tracks)
```

## Why this is minimal

- No new DB — `git log` = hours, `SCORE.md` = quality, `COST.md` = $ to finish, `MEMFS` git = memory.
- Reuses `hackathonhelp` prize/field/feasibility + `mw` budgets/decisions/gates without rebuild.
- Add `immunefi` (bug bounty) or `roblox` (repute oracle) by swapping `WORKORDER.json` `rubric: data/rubrics/devnetwork-hackerone.json` — same `git` + `score-entry` loop, same `COST.md` math.

Run `python agent/letta_worker.py --workorder agent/WORKORDER.template.json` to see the 26h → $910 → 21.8h loop live.
