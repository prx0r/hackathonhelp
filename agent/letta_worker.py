"""Minimal Letta+WorkerKit for hackathon entries — git is the ledger.

Usage:
  python agent/letta_worker.py --workorder agent/WORKORDER.template.json
  # clones repo, Letta works, commits, re-scores, updates COST.md from git log

Reuses:
  - mw/economics/budgets.py  Budget(can_spend) + RunMeter
  - mw/economics/decisions.py DecisionEngine (CONTINUE/ABORT on EV)
  - mw/core/events.py EventLedger (append-only, chain hash)
  - hackathonhelp/scripts/score-entry.mjs rubric scoring
"""
import json, subprocess, time, sys, pathlib, os
from datetime import datetime, timedelta

# -- 1) Load WORKORDER and compute economics from existing hackathonhelp/mw primitives --
def load_workorder(p):
    wo = json.loads(pathlib.Path(p).read_text())
    prize, participants = wo["prize"], wo["participants"]
    p80, reuse = wo["p80_hours"], wo["reuse"]
    shadow = wo["shadow_usd_per_h"]
    effective = max(4, round(p80 * (1 - reuse)))
    days_left = (datetime.fromisoformat(wo["deadline"]) - datetime.now()).days
    # feasibilityPrior from build-data.mjs:212
    feas = 0.10 if days_left<1 else 0.25 if days_left<=2 else 0.45 if days_left<=3 else 0.65 if days_left<=5 else 0.80 if days_left<=7 else 0.90 if days_left<=10 else 0.97 if days_left<=14 else 1.0
    cost_to_finish = round(effective * shadow)
    latest_safe = (datetime.fromisoformat(wo["deadline"]) - timedelta(days=effective/4 + 2)).date().isoformat()
    return wo, {"effective_p80": effective, "feas": feas, "cost_to_finish": cost_to_finish, "latest_safe": latest_safe, "days_left": days_left}

# -- 2) Git log → hours logged (1 commit ~ 0.5h heuristic, or parse `git log --since`) --
def hours_logged(repo_dir):
    try:
        log = subprocess.check_output(["git", "-C", repo_dir, "log", "--since=14 days ago", "--pretty=format:%ct"], text=True)
        commits = len([l for l in log.splitlines() if l.strip()])
        return round(commits * 0.6, 1)  # avg session 0.6h, improves as Letta logs real RunMeter
    except: return 0

# -- 3) One Letta session: clone, work, commit, score --
def run_once(workorder_path):
    wo, econ = load_workorder(workorder_path)
    repo_url, repo_dir = wo["repo"], f"/tmp/entry-{wo['id']}"
    print(f"WorkOrder {wo['id']} — prize ${wo['prize']} participants {wo['participants']} reuse {wo['reuse']} → effective {econ['effective_p80']}h feas {econ['feas']} latest_safe {econ['latest_safe']} cost ${econ['cost_to_finish']}")

    # Clone or pull
    if not pathlib.Path(repo_dir).exists():
        subprocess.run(["git", "clone", repo_url, repo_dir], check=False)
    else:
        subprocess.run(["git", "-C", repo_dir, "pull", "--rebase"], check=False)

    logged = hours_logged(repo_dir)
    remaining = max(0, econ["effective_p80"] - logged)
    print(f" git logged ~{logged}h → remaining ~{remaining}h → ${round(remaining*wo['shadow_usd_per_h'])} to finish")

    # Letta work (stub — replace with real LettaAdapter when ethonline-2026 branch checked out)
    # from mw.adapters.letta_adapter import LettaAdapter
    # adapter = LettaAdapter(workspace=repo_dir, workorder=wo)
    # result = adapter.execute(wo, RunContext(budget_remaining=remaining*wo['shadow_usd_per_h']))
    # For now, simulate a commit that improves score
    print(" Letta stub: would call LettaAgentClient(backend='local') with WORKORDER + rubric, commit to", repo_dir)
    # Simulate scoring
    track = wo["tracks"][0]
    subprocess.run(["node", "scripts/score-entry.mjs", "--entry", wo["source_id"], "--track", track], cwd="hackathonhelp" if pathlib.Path("hackathonhelp").exists() else ".", check=False)

    # Update COST.md in repo from git log
    cost_md = f"# Cost to finish\n\n- Logged: {logged}h\n- Remaining: {remaining}h\n- Projected: ${round(remaining*wo['shadow_usd_per_h'])}\n- Latest safe start: {econ['latest_safe']}\n- Feasibility: {econ['feas']}\n"
    try: pathlib.Path(repo_dir, "COST.md").write_text(cost_md)
    except: pass
    print(cost_md)

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--workorder", required=True)
    a = p.parse_args()
    run_once(a.workorder)
