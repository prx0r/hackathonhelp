# Hacksmith — autonomous winning hackathon substrate (.zip)

**Date:** Thu, 3 Sep 2026 02:16:00 -0400

---

Attached is the full tested Hacksmith substrate for autonomous hackathon entry creation.

It integrates the principles from LiveLLM, ProofDesk and DomainArena plus current Devpost guidance and concrete winner-repo patterns from DispatchAI, HackMate, Ctrl+Meet and FireForm.

Core contents:
- autonomous agent constitution + operating contract
- rules/rubric → idea → build → proof → demo → script → submission state machine
- strong bias toward reusable autonomous-agent infrastructure when sponsor/rubric fit
- sponsor causality/removal-test framework
- fail-closed, approval, fresh revalidation and idempotency rules
- truthfulness gates for live/real/verified/current claims
- judge scoring + P0/P1 audit CLI
- README, PITCH, DEMO, script, landing and Devpost templates
- specialized prompts for rules research, ideation, building, demo direction, skeptical judging, repo curation and submission editing
- worked abstractions of LiveLLM / ProofDesk / DomainArena, including the exact failure lessons we found
- concrete winner-repo presentation patterns
- deadline runbook, final freeze checklist and autonomous orchestration design

The substrate's own tests pass. Start with START_HERE.md, then AGENT.md and CONSTITUTION.md.
