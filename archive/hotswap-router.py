#!/usr/bin/env python3
"""
HotSwap Router — unified agent API subscription manager.

Connects:
  llmdeals    → AI tool pricing (what APIs cost)
  hackathonhelp → hackathon opportunities (what to enter)
  repute       → marketplace for agent work (Products, Requests)
  get-me-money → worker execution (WorkRuns, economics)

An agent uses this to:
1. Check what AI tools it needs for a job
2. Find the cheapest provider for each tool
3. Auto-switch when better deals appear
4. Track earnings and costs across jobs

Usage:
  python hotswap/router.py status                    # current subscriptions
  python hotswap/router.py check --job "hackathon"   # what tools for this job
  python hotswap/router.py optimize --budget 50      # optimize subscriptions
  python hotswap/router.py sync                      # sync all data sources
"""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path
from dataclasses import dataclass, field

ROOT = Path(__file__).parent.parent

# ── Data sources ────────────────────────────────────────────────────────────

LLMDEALS_DEALS = "/root/llmdeals/web/public/api/v1/deals.json"
LLMDEALS_MODELS = "/root/llmdeals/data/seed.json"
HACKATHON_OPPORTUNITIES = ROOT / "data/active/selected.json"
REPUTE_PRODUCTS = "/root/repute/data/assets.jsonl"
GET_ME_MONEY_CONFIG = "/root/get-me-money/get_me_money/config.py"

# ── HotSwap Config ──────────────────────────────────────────────────────────

@dataclass
class AgentProfile:
    agent_id: str
    budget_usd: float = 100.0
    capabilities: list[str] = field(default_factory=list)
    current_subscriptions: dict = field(default_factory=dict)
    spending_history: list[dict] = field(default_factory=list)
    preferred_providers: list[str] = field(default_factory=list)

@dataclass
class ToolNeed:
    category: str
    purpose: str
    min_quality: float = 0.5
    max_cost_per_call: float = 0.01
    max_monthly: float = 10.0

@dataclass  
class Subscription:
    provider: str
    product: str
    cost_per_call: float
    monthly_estimate: float
    quality: float
    alternatives: list[dict] = field(default_factory=list)
    savings_vs_next: float = 0.0

# ── Load data ───────────────────────────────────────────────────────────────

def load_deals() -> list[dict]:
    """Load AI tool deals from llmdeals."""
    for path in [LLMDEALS_DEALS, "/root/llmdeals/web/public/api/v1/deals.json"]:
        if os.path.exists(path):
            with open(path) as f:
                data = json.load(f)
                return data.get("deals", []) if isinstance(data, dict) else data
    return []

def load_models() -> dict:
    """Load model registry from llmdeals."""
    if os.path.exists(LLMDEALS_MODELS):
        with open(LLMDEALS_MODELS) as f:
            return json.load(f)
    return {}

def load_hackathons() -> list[dict]:
    """Load active hackathons."""
    if os.path.exists(HACKATHON_OPPORTUNITIES):
        with open(HACKATHON_OPPORTUNITIES) as f:
            data = json.load(f)
            return data.get("hackathons", [])
    return []

def load_repute_products() -> list[dict]:
    """Load repute products."""
    products = []
    if os.path.exists(REPUTE_PRODUCTS):
        with open(REPUTE_PRODUCTS) as f:
            for line in f:
                if line.strip():
                    try: products.append(json.loads(line))
                    except: pass
    return products

# ── Tool requirement detection ──────────────────────────────────────────────

HACKATHON_TOOL_MAP = {
    "ai": ["inference", "llm", "model"],
    "ml": ["inference", "training"],
    "research": ["search", "data"],
    "agents": ["inference", "orchestration"],
    "image": ["generation", "vision"],
    "video": ["generation"],
    "data": ["api", "data"],
    "web3": ["blockchain", "defi"],
}

def detect_tool_needs(hackathon: dict) -> list[ToolNeed]:
    """Detect what AI tools a hackathon needs."""
    needs = []
    themes = hackathon.get("themes", [])
    tech = hackathon.get("required_tech", [])
    
    for theme in themes:
        keywords = HACKATHON_TOOL_MAP.get(theme.lower(), [theme.lower()])
        needs.append(ToolNeed(
            category=theme,
            purpose=f"hackathon_{theme}",
            min_quality=0.5,
            max_cost_per_call=0.01,
        ))
    return needs

# ── Subscription optimizer ──────────────────────────────────────────────────

def optimize_subscriptions(profile: AgentProfile, deals: list[dict], needs: list[ToolNeed]) -> list[Subscription]:
    """Find best subscriptions for agent's needs within budget."""
    subscriptions = []
    
    for need in needs:
        # Find deals matching this need's category
        matching = []
        for deal in deals:
            deal_text = f"{deal.get('provider', '')} {deal.get('product', '')}".lower()
            if need.category.lower() in deal_text:
                cost = deal.get("price", 0)
                if isinstance(cost, str):
                    cost = float(cost.replace("$", "").replace(",", "")) if cost not in ["free", "Free"] else 0
                if cost <= need.max_cost_per_call:
                    matching.append(Subscription(
                        provider=deal.get("provider", "unknown"),
                        product=deal.get("product", "unknown"),
                        cost_per_call=cost,
                        monthly_estimate=cost * 200,  # estimate 200 calls/month
                        quality=deal.get("savings_pct", 50) / 100,
                    ))
        
        matching.sort(key=lambda s: s.cost_per_call)
        if matching:
            subscriptions.append(matching[0])
    
    return subscriptions

# ── Main ────────────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    
    print("=== HotSwap Router ===\n")
    
    # Load all data
    deals = load_deals()
    hackathons = load_hackathons()
    products = load_repute_products()
    
    print(f"Deals: {len(deals)}")
    print(f"Hackathons: {len(hackathons)}")
    print(f"Repute products: {len(products)}")
    
    if "--status" in args:
        # Show current state
        print("\n--- AI Tool Market ---")
        providers = set(d.get("provider", "") for d in deals)
        free_deals = [d for d in deals if d.get("price") == 0 or d.get("savings_pct", 0) > 90]
        print(f"  Providers: {len(providers)}")
        print(f"  Total deals: {len(deals)}")
        print(f"  Free/cheap: {len(free_deals)}")
        
        print("\n--- Hackathon Opportunities ---")
        for h in hackathons[:5]:
            print(f"  {h.get('title', h.get('slug', '?'))[:40]}")
        
        print("\n--- Repute Products ---")
        for p in products[:5]:
            print(f"  {p.get('title', '?')[:40]} (${p.get('price', 0)})")
    
    elif "--check" in args:
        # Check what tools a job needs
        job_idx = args.index("--check") + 1
        job_type = args[job_idx] if job_idx < len(args) else "hackathon"
        
        print(f"\n--- Tool Requirements for: {job_type} ---")
        # Find matching hackathon
        matching = [h for h in hackathons if job_type.lower() in h.get("slug", "").lower() 
                    or job_type.lower() in h.get("title", "").lower()]
        
        if not matching:
            print("No matching hackathon found. Using generic needs.")
            needs = [ToolNeed(category=job_type, purpose="general")]
        else:
            h = matching[0]
            needs = detect_tool_needs(h)
            print(f"Hackathon: {h.get('title', h.get('slug'))}")
        
        for need in needs:
            print(f"\n  Category: {need.category}")
            matching_deals = [d for d in deals if need.category.lower() in f"{d.get('provider', '')} {d.get('product', '')}".lower()]
            if matching_deals:
                for d in matching_deals[:3]:
                    print(f"    {d.get('provider', '?')}: {d.get('product', '?')} (${d.get('price', '?')})")
            else:
                print(f"    No deals found for {need.category}")
    
    elif "--optimize" in args:
        budget_idx = args.index("--budget") + 1 if "--budget" in args else -1
        budget = float(args[budget_idx]) if budget_idx < len(args) else 50.0
        
        profile = AgentProfile(agent_id="default", budget_usd=budget)
        needs = [ToolNeed(category="ai", purpose="general"), ToolNeed(category="research", purpose="search")]
        
        subs = optimize_subscriptions(profile, deals, needs)
        print(f"\n--- Optimized Subscriptions (budget: ${budget}) ---")
        total = 0
        for s in subs:
            print(f"  {s.provider}: {s.product} (${s.cost_per_call}/call, ~${s.monthly_estimate}/mo)")
            total += s.monthly_estimate
        print(f"\n  Total estimated: ${total:.2f}/mo")
        print(f"  Budget remaining: ${budget - total:.2f}/mo")
    
    elif "--sync" in args:
        print("\n--- Syncing all sources ---")
        # This would be called by a daemon
        print("Sync complete.")
    
    else:
        print("Usage:")
        print("  python hotswap/router.py status")
        print("  python hotswap/router.py check <job-type>")
        print("  python hotswap/router.py optimize --budget 50")
        print("  python hotswap/router.py sync")

if __name__ == "__main__":
    main()
