# Score v0.2 Decision Engine — Review Spec (2026-08-23)
Full review preserved verbatim in git history (this file summarizes implementation contract).

## Core: two scores, not one
- OPPORTUNITY: how attractive with sufficient time (deadline barely matters)
- ACTION: given today + alternatives, what to do now
- States: ENTER NOW / SPRINT / PREP / WATCH / SKIP (+ ENDED)

## Deadline feasibility prior (replaces hardcoded urgency curve)
<1d:.10 | 1-2d:.25 | 2-3d:.45 | 3-5d:.65 | 5-7d:.80 | 7-10d:.90 | 10-14d:.97 | 14-30d:1.00 | 30+d:1.00
Never penalize long deadlines in opportunity. Far-out => WATCH with latest_safe_start =
deadline - P80_build_days - buffer(2d). P50=25h P80=40h @4h/day until reference-class history exists.

## Bug fixes required
1. confidence multiplier never fired ('platform_metadata_unverified' vs test 'unverified') -> explicit map
2. age_confirmed silently true for unreviewed events -> UNKNOWN stays UNKNOWN
3. deadline double-counted (winnability had urgency AND attention multiplied) -> strip urgency from winnability
4. missing info != neutral: prize-TBA cannot score 85 -> cap + WATCH

## Field: distribution not point
P10/P50/P90 serious field (P50=regs*prior, P10=.65x, P90=1.55x documented heuristic)

## Payout model
baseline = paying_slots / serious_field_P50 ; slots unknown -> 3..12 (P50 6)
p_paid = sigmoid(logit(baseline) + skill_edge(0 v1))
EV_cash_heuristic = normalized_value x p_paid (ladder when known)

## Decisions replace single ranking; Mega becomes OUTLIER later (needs history percentiles)
## README + methodology must match engine (transparency = product)
