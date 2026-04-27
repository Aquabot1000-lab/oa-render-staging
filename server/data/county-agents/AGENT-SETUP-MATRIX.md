# OverAssessed — County Agent Setup Matrix
Generated: 2026-04-27 | Last Updated: 2026-04-27

All counties with active cases. TX requires Form 50-162 (Appointment of Agent) per case.
Other states: agent registration rules vary — see notes.

---

## TX — TEXAS (May 15, 2026 protest deadline)

| County | Cases | Status | Method | Contact / Portal | Notes |
|---|---|---|---|---|---|
| **Bexar** | 18 | ⚠️ UNCONFIRMED | Portal | https://bcad.org/online-portal/ | BCAD eFile portal — need to confirm account active |
| **Tarrant** | 7 | ⚠️ UNCONFIRMED | Portal | https://www.tad.org/login | TAD online portal |
| **Harris** | 4 | ⚠️ UNCONFIRMED | Portal | https://owners.hcad.org | HCAD iFile portal |
| **Dallas** | 3 | ⚠️ UNCONFIRMED | Portal | https://www.dallascad.org | DCAD eFile portal |
| **Travis** | 3 | ⚠️ UNCONFIRMED | Portal | https://traviscad.org/efile/ | Travis CAD efile |
| **Williamson** | 3 | ⚠️ UNCONFIRMED | Portal | https://www.wcad.org | WCAD portal |
| **Fort Bend** | 2 | ⚠️ UNCONFIRMED | Portal | https://taxpayer.justappraised.com/fortbendcad | JustAppraised portal — FBCAD eFile |
| **El Paso** | 2 | 🔴 NOT REGISTERED | Email/Mail | agents@epcad.org (verify) | EPCAD blocks web scrapers — call (915) 780-2000 to confirm |
| **Denton** | 2 | ⚠️ UNCONFIRMED | Portal | https://www.dentoncad.com | Denton CAD portal |
| **Collin** | 2 | ⚠️ UNCONFIRMED | Portal | https://www.collincad.org | Collin CAD portal |
| **Galveston** | 3 | 🔴 NOT REGISTERED | Portal | https://galvestoncad.org (Agent Portal button) | Has dedicated Agent Portal — need to register account |
| **Johnson** | 1 | 🔴 NOT REGISTERED | Email | arb@johnsoncad.net | No portal found — use ARB email; main: customerservice@johnsoncad.net |
| **Nueces** | 1 | 🔴 NOT REGISTERED | Portal | https://nuecescad.net (Agent Portal link) | Has Agent Portal — register at nuecescad.net |
| **McLennan** | 1 | 🔴 NOT REGISTERED | Unknown | https://www.mcad-tx.org | Site redirects to portal — call to verify: (254) 752-9864 |
| **Bowie** | 1 | 🔴 NOT REGISTERED | Unknown | https://www.bowiecad.org | Site not rendering — call to verify |
| **Montgomery** | 1 | ⚠️ UNCONFIRMED | Portal | https://www.mcad-tx.org | Montgomery CAD portal |
| **Comal** | 1 | ⚠️ UNCONFIRMED | Portal | https://www.comalcad.org | Comal CAD portal |
| **Hunt** | 1 | 🟡 PENDING_CONFIRMATION (reply sent) | **Email** | agents@hunt-cad.org | **Email-only path confirmed 2026-04-27.** Portal not yet live (no timeline). Mailing address + portal-timeline question sent via SendGrid 17:14 CDT (msg id 1MmspcgHSMaydtWBfm4qQw). Readiness service: `server/services/hunt-county-readiness.js`. |
| **Kaufman** | 1 | 🔴 NOT REGISTERED | Portal | https://esearch.kaufman-cad.org | BIS search portal — agent portal status unknown; check directly |
| **Medina** | 1 | ⚠️ UNCONFIRMED | Portal | https://www.medinaappraisal.org | Medina CAD |

---

## WA — WASHINGTON (July 1 protest deadline — more runway)

| County | Cases | Status | Method | Contact / Portal | Notes |
|---|---|---|---|---|---|
| **King** | 4 | ⚠️ UNCONFIRMED | Online | https://www.kingcounty.gov/depts/assessor | No separate agent registration required in WA — file as agent on appeal form |
| **Snohomish** | 3 | ⚠️ UNCONFIRMED | Online | https://www.snohomishcountywa.gov/assessor | WA: no separate 50-162 equivalent; agent listed on petition form |
| **Pierce** | 3 | ⚠️ UNCONFIRMED | Online | https://www.piercecountywa.gov/assessor | Same — agent listed on petition |
| **Spokane** | 2 | 🔴 RESEARCH NEEDED | Unknown | https://www.spokanecounty.org/assessor | Confirm petition process |
| **Kitsap** | 1 | ⚠️ UNCONFIRMED | Online | https://www.kitsapgov.com/assessor | Standard WA process |
| **Yakima** | 1 | 🔴 RESEARCH NEEDED | Unknown | https://www.yakimacounty.us/assessor | Confirm process |
| **Stevens** | 1 | 🔴 RESEARCH NEEDED | Unknown | https://www.stevenscountywa.gov/assessor | Rural county — likely mail/in-person |
| **Ferry** | 1 | 🔴 RESEARCH NEEDED | Unknown | https://www.ferry-county.com | Very rural — likely mail only |

---

## GA — GEORGIA (April 1 deadline — may already be past)

| County | Cases | Status | Method | Contact / Portal | Notes |
|---|---|---|---|---|---|
| **Fulton** | 1 | ⚠️ UNCONFIRMED | Online | https://www.fultonassessor.org | GA: no statewide agent registration — POA attached to appeal |

---

## OH — OHIO (March 31 deadline — likely past)

| County | Cases | Status | Method | Contact / Portal | Notes |
|---|---|---|---|---|---|
| **Franklin** | 1 | ⚠️ UNCONFIRMED | Online | https://www.co.franklin.oh.us/auditor/ | OH BOR process — agent authorization on complaint form |

---

## Summary

| Priority | Action |
|---|---|
| 🔴 **URGENT — TX, May 15 deadline** | Hunt 🟡 pending CAD confirmation. Galveston, Nueces, Johnson, El Paso, McLennan, Bowie — register NOW |

## Email Filing Workflow
Counties confirmed as **email-only** (no portal):
- **Hunt** — agents@hunt-cad.org — method: email — agent_registered: pending_confirmation
| 🟡 **CONFIRM — TX portals** | Bexar, Tarrant, Harris, Dallas, Travis, Williamson, Collin, Denton, Fort Bend — verify accounts are active/credentialed |
| 🟢 **WA — runway to July 1** | Research Spokane, Yakima, Stevens, Ferry — confirm petition process |
| ℹ️ **GA/OH** | Deadlines likely passed for 2026 — verify case status |

---

## Key Notes
- TX Form 50-162 required per case — signed by owner, submitted before or with protest
- WA/GA/OH: no equivalent mandatory pre-registration; agent listed on appeal form
- Hunt CAD: email only to agents@hunt-cad.org (portal in development as of 2026-04-27)
- FBCAD uses JustAppraised platform (taxpayer.justappraised.com/fortbendcad)
- Bexar screenshots show portal exists (server/filing-automation/screenshots/BCAD-agent-candidate3.png)

---
*Source: county-config.js + live CAD site checks 2026-04-27. Flag any changes back to Aquabot for update.*
