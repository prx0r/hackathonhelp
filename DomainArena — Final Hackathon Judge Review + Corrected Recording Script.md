# DomainArena — Final Hackathon Judge Review + Corrected Recording Script

**Date:** Thu, 3 Sep 2026 01:58:57 -0400

---

# DomainArena — Final Hackathon Judge Review

**Repo:** `prx0r/agentseolab`  
**Canonical submission:** **DomainArena — name.com Domain API Challenge only**  
**Current head reviewed:** `3e784a4f71151875d9b879d60c42bd82d03e5c09`

## Verdict

The **idea is excellent** and the sponsor fit is arguably the strongest of the three entries:

> **DomainArena is A/B testing for domain names in the agentic web.**

The memorable insight is genuinely distinct: domains were optimized for human recall and search, but increasingly a machine agent is deciding whether a service is relevant. DomainArena measures machine comprehension **before acquisition**, then uses name.com to close the loop from live inventory to registration and DNS.

This maps almost perfectly to name.com's published judging criteria. They explicitly reward: deep multi-endpoint integration, originality, technical execution/edge cases, real-world viability, and a clear end-to-end demo. They even call out search + registration + DNS as the kind of depth they want.

**Current public submission state: ~7.2/10.**  
**After the P0 fixes below: ~9.5–9.7/10 and a serious 1st-place candidate.**

The problem is not the concept. The problem is that the newest public Worker has regressed behind the much better Python implementation and currently contradicts several of your own safety claims.

---

# DO NOT RECORD THE CURRENT PUBLIC DEMO YET

There are five P0 fixes.

## P0-1 — The public Worker currently bypasses human approval and can auto-purchase

This is the biggest issue.

The landing page and README say things like:

- “Human gates all writes”
- “The recommendation was autonomous. Spending was not.”
- Registration requires explicit human approval

But current `/api/demo/run` actually performs this continuously in one server request:

```text
search
→ pricing
→ blind inference
→ Mistral scoring
→ winner
→ fresh recheck
→ POST /domains     <-- registration
→ POST DNS record   <-- mutation
→ DNS readback
→ receipt
```

There is no human approval boundary in that Worker route.

That is a direct contradiction of the product story and it is risky because anyone pressing **Run Live Demo** can potentially trigger a write if the Worker has production credentials.

### Fix

Split the public demo into two server-enforced phases:

```text
PHASE 1 — autonomous, read-only
intent
→ name.com search
→ pricing
→ blind test
→ independent score
→ winner
→ fresh checkout revalidation
→ PENDING HUMAN APPROVAL

PHASE 2 — only after explicit approval
approve
→ idempotent name.com registration
→ DNS create
→ DNS readback
→ receipt
```

The browser should visibly stop on:

> **PURCHASE REQUIRES HUMAN APPROVAL**

Then you click something like:

> **Approve sandbox registration**

The approval must be checked server-side, not merely represented as a button.

For the hackathon demo, I strongly prefer **name.com sandbox CORE v1**. It proves the complete transactional integration without risking real charges. Name.com explicitly documents sandbox as the safe environment for simulated registration and DNS.

The money line here is:

> **“The recommendation is autonomous. Spending is not.”**

But only say it once it is actually true.

---

## P0-2 — GitHub Actions is currently RED

The README/landing still claim **148 tests passing**, but the latest public CI on current head fails during collection.

Exact failure:

```text
tests/domainarena/test_world.py
from cogym_kernel.kernel.contracts import ActionSpec, ActionResult
ModuleNotFoundError: No module named 'cogym_kernel'
```

The ironic part is that you already fixed the product code to be self-contained. The repo contains:

```text
domainarena/worldpack/contracts.py
```

with local `ActionSpec` and `ActionResult` definitions.

### Exact fix

Change:

```python
from cogym_kernel.kernel.contracts import ActionSpec, ActionResult
```

to:

```python
from domainarena.worldpack.contracts import ActionSpec, ActionResult
```

Then run/push until both Python matrix jobs are green.

**Do not claim 148 passing in README/video until clean GitHub Actions proves it.**

This is especially important because name.com's rubric explicitly scores technical execution and edge-case handling.

---

## P0-3 — The Worker says CORE but defaults to legacy v4

The current Worker helper defaults to:

```js
const base = env.NAMECOM_BASE_URL || "https://api.name.com/v4";
```

but the demo says things like:

> “Registering via name.com CORE”

Current name.com documentation says:

- **CORE v1 is the current/latest API**
- released June 2025
- new integrations should use CORE
- v4 is legacy and scheduled to sunset during 2026

Official production/sandbox model:

```text
Production: https://api.name.com/core/v1
Sandbox:    https://api.dev.name.com/core/v1
```

Your **Python client is already good here**. It uses CORE-style paths and sandbox-first semantics.

### Recommendation

Bring the Worker in line with the Python client rather than inventing anything new.

For the hackathon:

```text
NAMECOM_BASE_URL=https://api.dev.name.com
/core/v1/...
```

Use sandbox credentials and say explicitly:

> “This is a real call to name.com's sandbox registration API, so the complete lifecycle runs without spending real money.”

That is actually more professional than gambling on a production purchase during a recording.

---

## P0-4 — Current “fresh availability” logic is not really fail-closed

The current Worker sends roughly:

```js
POST /domains:checkAvailability
{ domains: [winner.domainName] }
```

then effectively decides:

```js
available = !response.error
```

That is insufficient.

Current CORE docs specify:

```json
{
  "domainNames": ["example.com"],
  "purchaseType": "registration"
}
```

and return an explicit `purchasable` field.

A successful HTTP response does **not** mean the domain is purchasable.

Your Python implementation already has the correct logic: require a matching domain, explicit `purchasable`, supported `purchaseType`, and fail closed on malformed/missing state.

### Public demo must require

```text
result exists
AND domainName == requested domain
AND purchasable == true
AND purchaseType == registration / supported flow
AND fresh price within approved budget/drift threshold
```

Anything else:

> **CHECKOUT INVALIDATED — HUMAN APPROVAL REQUIRED AGAIN**

That becomes a nice demo moment rather than merely defensive code.

---

## P0-5 — Public registration needs idempotency

The current Worker directly calls Create Domain without an idempotency header.

Current name.com CORE quickstart explicitly says:

> Always send `X-Idempotency-Key` on Create Domain so retrying a timed-out request does not double-purchase.

Again: your Python client already does this correctly.

Make the public Worker do the same.

---

# One more CORE mismatch: DNS request shape

The current Worker DNS body is legacy-shaped:

```js
{
  record: {
    type: "TXT",
    name: "_domainarena",
    data: "...",
    ttl: 300
  }
}
```

CORE uses direct fields along the lines of:

```json
{
  "type": "TXT",
  "host": "_domainarena",
  "answer": "domainarena-run=...",
  "ttl": 300
}
```

Your Python client already uses the correct CORE field model.

Also, the current demo always renders `DNS CREATE: 200` rather than proving that call actually succeeded. Make the output reflect the real result, then require readback to contain the record before marking the run VERIFIED.

---

# Sponsor integration assessment

Once the Worker matches the Python lifecycle, this is a *very* strong name.com entry because the API is not bolted on.

The product literally cannot function without name.com:

```text
PRODUCT INTENT
  ↓
name.com SEARCH
  ↓
live candidate inventory + prices
  ↓
BLIND MACHINE-COMPREHENSION TEST
  ↓
independent scoring
  ↓
MEASURED WINNER
  ↓
name.com CHECK AVAILABILITY + FRESH PRICE
  ↓
HUMAN APPROVAL
  ↓
name.com CREATE DOMAIN
  ↓
name.com DNS CREATE
  ↓
name.com DNS READBACK
  ↓
SHA-256 RECEIPT
```

That directly satisfies name.com's stated preference for deep integrations combining search, registration and DNS rather than a superficial API call.

The killer sponsor line:

> **“name.com supplies the live inventory, becomes the checkout authority immediately before money moves, and closes the loop by registering and verifying the resulting infrastructure.”**

Without name.com, DomainArena could perform a naming experiment. It could not turn that experiment into an evidence-backed deployment decision.

---

# Demo/winner calibration

I compared the structure against strong hackathon-winning repos/demos including DispatchAI (Berkeley AI Hackathon Grand Prize), FaceTimeOS (Cal Hacks Grand Prize), and other recent winners.

The recurring winning pattern is:

```text
one-sentence idea
→ immediately understandable problem
→ ONE end-to-end transformation
→ sponsor technology visibly causal
→ changed real state
→ proof/receipt
→ stop
```

DispatchAI's repo puts the demo immediately high on the README and centers one complete 911 call instead of touring every feature.

DomainArena should do the same.

Your current script spends too much time explaining all six research findings. The research is excellent supporting proof, but it is **not the movie**.

The movie is:

> **“I would have bought a domain by taste. Instead I measured what an AI agent thinks it means, approved the measured winner, and name.com turned that decision into verified infrastructure.”**

That is memorable.

---

# Current script assessment

You currently have two competing scripts:

- `HACKATHON_NOTES.md` — nominally 2:30
- `RECORDING-SCRIPT.md` — nominally 3:35

Neither should be read verbatim after the new audit.

Problems:

1. Both claim a human approves the purchase, while the Worker currently auto-registers.
2. They promise fixed winner names/scores (`jsonrepair.dev`, `0.87`, etc.) even though live inventory and Workers AI can change.
3. The longer version devotes too much runtime to research/frontier context.
4. The 2:30 version enumerates six research findings, which becomes feature-tour energy rather than one product story.
5. They claim CORE while Worker defaults to v4.

**Never narrate a fixed winner.** Say what appears on-screen in that take.

---

# Corrected recording target

Aim for **2:35–2:55 total**.

Suggested timing:

```text
0:00–0:18  Hook / problem
0:18–0:32  Explain pipeline and name.com causality
0:32–1:25  Run search + prices + blind testing + winner
1:25–1:48  Fresh checkout revalidation + approval boundary
1:48–2:15  Registration + DNS create/readback
2:15–2:35  SHA-256 receipt
2:35–2:50  Research/startup close
```

Do not spend 30 seconds enumerating research papers. One sentence proves the depth.

---

# FINAL RECORDING SCRIPT — ~2:45

## 0:00–0:18 — Hook

**SCREEN: Landing hero — “Measure the name before you buy it.”**

> “Domain names were designed for humans. But increasingly the thing deciding whether your service is relevant is an AI agent. We still buy names based on taste. DomainArena asks a different question: can the machine audience actually understand the name before we buy it?”

> “DomainArena is A/B testing for domain names in the agentic web.”

## 0:18–0:32 — How it works

**SCREEN: Scroll just enough to show pipeline.**

> “I freeze a product intent. name.com gives me live registration inventory and pricing. Each candidate is shown blindly to an AI model with no product description. A separate model scores what it inferred against the frozen intent. The result is evidence, not taste.”

**Click Try Live Demo.**

## 0:32–1:20 — Live discovery + blind test

**SCREEN: Run Live Demo.**

> “I’ll run it for a JSON repair API.”

As name.com results appear:

> “First, name.com returns currently purchasable candidates and prices. This isn’t a generated list — the available inventory comes from name.com.”

As inference appears:

> “Now Llama sees only each hostname. No description, no hint about the product. It has to infer what the service does from the domain itself.”

As score appears:

> “A separate Mistral model judges that inference against the frozen product intent, so the model generating the interpretation never scores itself.”

At winner:

> “On this run, this is the measured winner. The important part isn’t the specific domain. It’s that machine comprehension became something I can test before acquisition.”

## 1:20–1:48 — Checkout authority + human approval

**SCREEN: Fresh checkout revalidation.**

> “But search results are not checkout state. Before any billable action, DomainArena asks name.com again.”

> “The domain must still be explicitly purchasable, the purchase type must still be supported, and the fresh price must still fit the approved budget. If any of that changes, we stop.”

**SCREEN: Explicit PENDING HUMAN APPROVAL panel.**

> “And this is the key boundary: the recommendation is autonomous. Spending is not.”

**Click: Approve sandbox registration.**

> “I approve this sandbox registration now.”

## 1:48–2:15 — Registration + verified DNS

**SCREEN: name.com registration.**

> “Only after approval does name.com create the domain. The registration is idempotent, so retrying a timed-out request cannot accidentally purchase it twice.”

As DNS runs:

> “Then DomainArena creates a DNS TXT record and reads it back from name.com. A recommendation is not complete until the infrastructure actually exists and verifies.”

## 2:15–2:35 — Receipt

**SCREEN: Receipt / final state.**

> “Finally, DomainArena hashes the frozen intent, candidate inventory, machine inference, score, checkout state, registration result and DNS verification into a receipt.”

> “Measured. Approved. Acquired. Verified.”

**Pause briefly on the receipt.**

## 2:35–2:52 — Why this matters / close

**SCREEN: return to landing lifecycle or research metrics.**

> “This grew out of sixteen experiments across more than seven model families. The conclusion was simple: agent naming behavior is unstable enough that a one-shot brandability score isn’t sufficient.”

> “name.com is causal here: it supplies the live inventory, acts as the checkout authority, and closes the loop with registration and DNS.”

> **“Measure the name. Approve the winner. Verify the infrastructure.”**

**END. No thank-you slide.**

---

# Why this script is stronger

It leaves the judge with exactly one idea:

> **The domain that sounds best to a human may not be the domain an agent understands.**

And one transformation:

```text
GUESS
→ MEASURE
→ APPROVE
→ ACQUIRE
→ VERIFY
```

That is much more memorable than six research bullets.

---

# Repo cleanup before submission

## P1

1. **Add `PITCH.md`.** It currently does not exist.
2. Fix/remove README link to `RESEARCH.md`; the root file is absent.
3. Move development archaeology into `archive/`:
   - `HANDOVER-2026-09-02.md`
   - `PLAN-DOMAINARENA-FINAL-2026-09-02.md`
   - especially the accidental **`PLAN-PROOFDESK-FINAL-2026-09-02.md`** in the DomainArena repo.
4. Update the `148 tests passing` claim only after current CI is green.
5. Landing says “6 endpoints” but the visible endpoint card only renders five rows — add `checkAvailability` explicitly.
6. Keep README’s build-vs-next table. That is excellent hackathon hygiene because it distinguishes measured/proxy/not-measured rather than pretending everything is finished.
7. Make the live demo and 2–3 minute video links obvious near the top of README after recording.

Suggested top of README:

```markdown
# DomainArena

**A/B testing for domain names in the agentic web.**

[Live Demo] · [3-Minute Demo] · [CI]

name.com Inventory
→ Blind Agent Test
→ Independent Score
→ Human Approval
→ Registration
→ DNS Verification
→ Receipt
```

---

# Suggested PITCH.md framing

## One sentence

> **DomainArena tests which available domain AI agents actually understand, then uses name.com to turn the evidence-backed winner into approval-gated, verified infrastructure.**

## Sponsor-heavy-lifting sentence

> **name.com supplies the live registration inventory and pricing, becomes the authoritative checkout boundary before acquisition, then closes the loop with domain creation, DNS configuration and DNS readback.**

## Problem

> Human naming tools optimize for memorability and taste. Agent-facing services increasingly have a second audience: machines deciding what a service is and whether it is relevant. DomainArena measures that audience before the domain is purchased.

## Magic transition

```text
Human intuition:
“this sounds good”

DomainArena:
blind agent inference
→ independent score
→ evidence-backed winner

name.com:
fresh availability
→ human approval
→ acquire
→ configure DNS
→ verify
```

## Close

> **Measure the name. Approve the winner. Verify the infrastructure.**

---

# Official references

DevNetwork / name.com challenge:
https://api-cloud-ai-hackathon-2026.devpost.com/

name.com CORE overview:
https://docs.name.com/api/v1/overview

name.com Search:
https://docs.name.com/api/v1/reference/domains/search

name.com Check Availability:
https://docs.name.com/api/v1/reference/domains/check-availability

name.com production-ready quickstart / idempotent registration:
https://docs.name.com/guides/quickstart

Winner calibration:
https://github.com/DispatcherAI/DispatcherAI
https://github.com/dylanelu/FaceTimeOS

---

# Final readiness gate

**DO NOT RECORD until all of these are true:**

- [ ] Public demo stops before any mutation and visibly requests human approval
- [ ] Server enforces approval; it is not just UI copy
- [ ] Registration is sandbox CORE v1 or every claim is truthfully labeled otherwise
- [ ] Fresh `checkAvailability` requires explicit `purchasable=true`
- [ ] `purchaseType=registration` used/validated
- [ ] fresh price/budget drift guarded
- [ ] Create Domain uses `X-Idempotency-Key`
- [ ] DNS create uses correct API shape and actual success status
- [ ] DNS readback is required before VERIFIED
- [ ] Current GitHub Actions is green
- [ ] README no longer falsely claims stale test state
- [ ] PITCH.md exists

After that: **freeze it, record it, submit it. Do not add another feature.**

My ranking of your three ideas on pure concept is extremely close, but DomainArena may be the cleanest sponsor-specific hack: the insight is unusual, the API can be used across the entire lifecycle, and the final state change is tangible. It just needs the public demo to reflect the safety and API rigor already present in the Python implementation.
