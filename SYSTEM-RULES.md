# SYSTEM-RULES.md — OverAssessed CRM & Automation Operating Rules

> Last updated: 2026-04-22  
> Owner: Tyler Worthey  
> Enforced by: WortheyAquaBot

---

## RULE 1 — NOTHING IS FIXED UNTIL ALL 6 LAYERS ARE COMPLETE

Every fix must satisfy:

1. **ROOT CAUSE** — exact file, table, trigger, or workflow identified
2. **CODE FIX** — exact files changed, old path removed or disabled
3. **DATA FIX** — existing records backfilled / normalized / corrected
4. **AUTOMATION FIX** — duplicate triggers removed, cooldown/dedup verified
5. **PERSISTENCE FIX** — restart completed if required, change survives session reset
6. **VERIFICATION** — one live test case proves new path works; old path cannot fire

Do not say "fixed," "done," or "saved" unless all 6 sections are complete and logged in FIX-LOG.md.

---

## RULE 2 — SINGLE SOURCE OF TRUTH FOR VALUATION

- `minAdjustedValue` = `adjValuesSorted[0]` (lowest adjusted comp)
- `medianAdjustedValue` = `adjValuesSorted[Math.floor(n/2)]`
- **Collin County** → final value = MEDIAN
- **Fort Bend County** → final value = MEDIAN
- **Bexar County** → final value = MIN
- **All other counties** → final value = MIN (default)
- `finalValue` is injected into `property.opinionOfValue` BEFORE any page renders
- Hard-fail validation runs post-render: if any page shows a different value, build fails and PDF is deleted
- No external `opinionOfValue` input is ever accepted — generator owns this value

---

## RULE 3 — CANONICAL STATUS LISTS

### pre_registrations
| Status | Meaning |
|---|---|
| `INCOMPLETE_INTAKE` | Address/data insufficient; confirmation email sent once |
| `WAITING_FOR_NOTICE_UPLOAD` | Valid lead; awaiting tax notice |
| `PRE_ANALYZED` | Comp snapshot stored; awaiting notice |
| `READY_TO_BUILD` | Notice received; ready for full package |
| `CONVERTED` | Promoted to submissions |
| `UNSUPPORTED_STATE` | State not TX |

### submissions
| Status | Meaning |
|---|---|
| `NEW` | Just submitted, not yet analyzed |
| `AWAITING_NOTICE` | Needs notice upload |
| `NEEDS_INFO` | Data gap blocking analysis |
| `PRELIMINARY_ANALYSIS` | Pre-final snapshot |
| `PENDING_TYLER_APPROVAL` | Analysis complete; awaiting Tyler filing auth |
| `SIGNED_READY_TO_FILE` | Agreement signed; cleared to file |
| `FILED` | Protest filed with CAD |
| `ARCHIVED` | Inactive; do not contact |

**No other status strings are valid. Any deviation must be normalized immediately.**

### submissions.filing_status
`NOT_STARTED` → `PACKAGE_BUILDING` → `PENDING_APPROVAL` → `APPROVED` → `FILED` → `HEARING_SCHEDULED` → `SETTLED` | `HEARING_COMPLETE` → `CLOSED`

---

## RULE 4 — EMAIL / SMS OUTREACH RULES

- **address_fix_requested = true** → NEVER send another address email to that record
- All address emails use the **v2 confirmation template only** (geocode-first)
  - High-confidence (1 match): "We found your property — please confirm"
  - Low-confidence (0 or 2+ matches): "Quick question about your property address"
- The legacy "Action Required: Complete Your Submission" template is **permanently disabled**
- `runDripCheck()` is **permanently disabled** (dead return at top of function)
- `runFollowUpSequence()` is the **single active drip** (day 2/5/7 on submissions)
- `/api/email/nurture` markdown sequences are **manual-trigger only** (no cron)
- No customer email sends from any hardcoded template that duplicates a canonical `oa-email-templates.js` export

---

## RULE 5 — DOCUMENT MODEL

- Primary relationship: `documents.submission_id → submissions.id`
- `client_id` is optional (was previously NOT NULL — changed 2026-04-22)
- `case_id` (text) stored directly for fast lookup without join
- All new uploads must write to `documents` table, NOT only to `submissions.notice_url` / `agreement_url`
- Filing packages stored at: `/Users/aquabot/Documents/OverAssessed/server/filing-packages/`
- Stale Render/container paths (`/app/server/...`, `/opt/render/...`) are **invalid** — always use local path

---

## RULE 6 — PACKAGE GENERATOR RULES

- File: `server/services/taxnet-package-generator.js`
- No "TaxNet USA Standard" text in any rendered PDF
- Dynamic condition narrative: yearBuilt≥2020 → "production home"; rural/acreage → "significant land value"; yearBuilt<2000 → "older dated"; else neutral
- Overvaluation % = `(noticedValue - recommendedValue) / noticedValue`
- Minimum 8 comps per package; flag if below
- County standards baked into footer
- Map must render (not blank); numbered comp markers; subject red / comps blue
- No stacked identical markers (spiral offsets applied)

---

## RULE 7 — INTAKE RULES

- If address is incomplete → status = `INCOMPLETE_INTAKE`, NOT a usable lead
- Geocoder runs FIRST before any email fires
- If geocoder returns exactly 1 match → auto-resolve address, advance to `WAITING_FOR_NOTICE_UPLOAD`
- If geocoder returns 0 or 2+ matches → send low-confidence confirmation email once
- `address_fix_requested` set to `true` immediately after first outreach — cannot be re-sent

---

## RULE 8 — AUDIT STANDARDS

- Every fix logged in `FIX-LOG.md` with date, root cause, files changed, verification
- Open issues tracked in `OPEN-ISSUES.md` — removed only when all 6 fix layers complete
- No item removed from OPEN-ISSUES.md without corresponding FIX-LOG.md entry

---

## RULE 9 — NO SYNTHETIC COMPS (HARD BLOCK)

**Added 2026-04-23 per Tyler directive. Enforced by `ALLOW_SYNTHETIC = false` in `server/services/comp-engine.js`.**

Synthetic / engine-generated comparable properties MAY NOT be used for any of:

- Savings calculation
- Approval gate promotion
- Evidence / filing package generation
- Actual filing with a CAD
- Customer-facing result delivery (email, SMS, portal)

**Detection flags** (any truthy → hard block):
- `compResults.comp_source === 'synthetic'`
- `compResults.comps_generated === true`
- `compResults.comp_engine_fallback === true`
- `compResults.data_blocked === true`
- Any individual comp with `_synthetic: true` or `source: 'synthetic-estimate' | 'synthetic'`

**Enforcement points:**
1. `comp-engine.js findComparables()` — returns `{ data_blocked: true, data_issue: 'SYNTHETIC_COMPS_BLOCK', comps: [] }` instead of generating fakes
2. `evidence-generator.js generateEvidencePacket()` — throws `SYNTHETIC_COMPS_BLOCK` error
3. `server.js runApprovalGate()` Gate 7 — rejects cases with non-real comp_source
4. Affected cases get `analysis_status='DATA_INVALID'`, `confidence_level='INVALID'`, `status='NEEDS_REVIEW'`, activity_log `action='synthetic_comps_blocked'`

**Override:** `ALLOW_SYNTHETIC` flag in `comp-engine.js` — only flip for local dev, never in production.

---

## RULE 10 — COUNTY DATA SOURCE ROUTING

**Added 2026-04-23 per Tyler directive. Enforced by `TAXNETUSA_COUNTIES` set in `server/services/comp-engine.js`.**

**Global priority order:**

| Tier | Source | Use for |
|---|---|---|
| 1 | TaxNetUSA / local parcel bulk data (`data/<county>/parcels-compact.jsonl.gz`) | Supported TX counties: **Bexar, Denton, Tarrant** |
| 2 | County CAD scraper (BCAD, FBCAD, CCAD, WCAD, MCAD, HUNT, KCAD) | All other supported counties |
| 3 | Rentcast | Property **baseline** only (assessed value lookup); **NEVER** for comps |
| 4 | Synthetic | **DISABLED** — see RULE 9 |

**TaxNetUSA-required counties (Bexar / Denton / Tarrant):**
- MUST use local parcel data for both `property_data` and comps
- If local data unavailable OR returns < 5 comps → hard block: `analysis_status = DATA_BLOCKED`, `data_issue = 'TAXNET_SOURCE_REQUIRED'`, `filing_ready = false`
- No Rentcast comp fallback
- No CAD scraper fallback (local data is the authoritative source for these counties)
- No synthetic fallback

**Accepted `comp_source` values for approval gate (RULE 9 Gate 7):**
- `'real'` — generic real comps
- `'taxnetusa'` — local parcel bulk data
- `'cad_scraper'` — county CAD scrape
- Any individual-comp `source` matching `<county>-cad-local` or `<CAD code>` (e.g. `'bexar-cad-local'`, `'BCAD'`, `'tarrant-cad'`)

**Rejected `comp_source` values:**
- `'synthetic'`, `'synthetic-estimate'`, `'rentcast'`, `'rentcast-api'`, `'unknown'`, `'none'`

**Activity log actions:**
- `taxnet_routing_applied` — TaxNetUSA source used
- `data_blocked_taxnet_failure` — TaxNetUSA data unavailable for required county
- `synthetic_comps_blocked` — RULE 9 block triggered
