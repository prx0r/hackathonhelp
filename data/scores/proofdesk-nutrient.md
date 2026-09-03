
## Peer Review — proofdesk vs nutrient (Nutrient DWS)
**Repo:** https://github.com/prx0r/proofdesk @ 2324bd50b64870a3972d47fa084497e131f0828d
**Auto:** 68/100 ✅ must-have present

**5-min checklist (each peer scores 0-20, avg → 0-100):**
- [ ] **Nutrient DWS core operation used meaningfully (not throwaway call)** (30%) — grep -ri 'nutrient|dws|data.*extraction|viewer.*review|redact|sign.*archive' src/ → auto 85/100
- [ ] **Pipeline: extract → confidence → human where needed → audit trail** (30%) — code has confidence scores + Viewer human review + audit log → auto 60/100
- [ ] **Deterministic auditable output + Viewer human sign-off** (20%) — Viewer used for human approval, signed/sealed output → auto 60/100
- [ ] **Regulated use case anchored (KYC/e-invoice/trade/mortgage/redact)** (20%) — README names regulation and DWS heavy lifting one-liner → auto 60/100

**Quick peer Qs:**
- Would you pay to use this? (real-world viability)
- Is the API central or throwaway?
- Demo shows it end-to-end or just slides?

**Scorecard:**
| Criterion | Auto | Peer1 (0-20) | Peer2 (0-20) | Final |
|-----------|------|--------------|--------------|-------|
| Nutrient DWS core operation us | 85 |  |  |  |
| Pipeline: extract → confidence | 60 |  |  |  |
| Deterministic auditable output | 60 |  |  |  |
| Regulated use case anchored (K | 60 |  |  |  |

**One-line where Nutrient DWS did real work:** ______________________
