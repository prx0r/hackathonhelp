# Strategy Review: Agent Reliability Specialism + Portfolio Model
2026-08-23 · Operator review (implemented in engine same day)

## Core strategy
Not "become good at hackathons." Become unusually good at ONE problem:
**reliable agents — evaluation, verification, evidence, routing** — then use
hackathons as repeated markets for that expertise.

Specialisation tree: EVALUATION (benchmarks/adversarial cases/scoring) x
VERIFICATION (evidence/provenance/freshness/receipts) x ROUTING (provider
selection/cost-quality/failover) -> OBSERVABILITY.

## Engine changes mandated by this review (all implemented)
1. GIBC V2 gated: headline non-cash + student restrictions
2. Rice gated: 18+/college/US/team required
3. LexHack flagged verify-first
4. Builder profile (data/builder-profile.json): specialism tags, assets,
   per-event code_reuse table, shadow_hour_value
5. Per-event effective_p80_hours = P80 x (1-reuse); drives feasibility +
   latest_safe_start (Telegraph: 18h effective)
6. strategic_fit computed from thesis-tag overlap + asset coverage
7. opportunity_cost_usd = effective_hours x shadow rate on every record

## Portfolio queue (operator)
DO NOW: Telegraph H1 (fit 1.0, 18h) · Register ETHOnline (tracks TBA)
PREP: OpenCV VisualProof Agent (agentic vision = QDW thesis applied to CV),
      AI Infra Summit · BOSS Battle only-if-cheap-adapter
WATCH: AMD ACT III + AI Genesis (Oct targets, strong priors), WeAreDevelopers,
      Rise of AI Agents

## Rule-of-reuse caveat
Libraries/infrastructure usually permitted w/ disclosure; some events require
genuinely new projects — carry knowledge/methodology, never assume repo reuse.
Check each event's originality clause before planning around reuse.

## Compounding model
Total Strategic Value = Cash EV + Portfolio + Reusable Asset Value + Learning
+ Follow-on - Effective Build Cost - Rule Adaptation Cost
Effective Build Cost = Raw x (1 - allowable_reuse)
