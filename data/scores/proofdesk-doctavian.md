
## Peer Review — proofdesk vs doctavian (Doctavian)
**Repo:** https://github.com/prx0r/proofdesk @ 2324bd50b64870a3972d47fa084497e131f0828d
**Auto:** 60/100 ✅ must-have present

**5-min checklist (each peer scores 0-20, avg → 0-100):**
- [ ] **Doctavian generation API called (real document shaped, not mocked)** (35%) — grep -ri 'doctavian|doctavian.*generation|template.*branch|expression' src/ → auto 85/100
- [ ] **Template intelligence (branch/loop/calc, not flat mail-merge)** (25%) — template file has {{#if}} / {{#each}} / expressions → auto 60/100
- [ ] **Messiest data handled repeatedly** (20%) — tests with varied data shapes, not one happy path → auto 60/100
- [ ] **One-line where Doctavian did real work + demo 2-4 min** (20%) — README has 'Where Doctavian did work' + video link → auto 15/100

**Quick peer Qs:**
- Would you pay to use this? (real-world viability)
- Is the API central or throwaway?
- Demo shows it end-to-end or just slides?

**Scorecard:**
| Criterion | Auto | Peer1 (0-20) | Peer2 (0-20) | Final |
|-----------|------|--------------|--------------|-------|
| Doctavian generation API calle | 85 |  |  |  |
| Template intelligence (branch/ | 60 |  |  |  |
| Messiest data handled repeated | 60 |  |  |  |
| One-line where Doctavian did r | 15 |  |  |  |

**One-line where Doctavian did real work:** ______________________
