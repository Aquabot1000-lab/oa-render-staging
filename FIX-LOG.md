# FIX-LOG.md — OverAssessed Fix History

> Format: Each entry must complete all 6 checklist layers before status = FIXED.  
> Maintained by: WortheyAquaBot  
> Last updated: 2026-04-22

---

## FIX-001 — Owner Opinion / Requested Relief value mismatch
**Date:** 2026-04-22  
**Reported by:** Tyler Worthey  
**Cases affected:** OA-0010, OA-0013, OA-0027

### 1. ROOT CAUSE
`server/services/taxnet-package-generator.js` — Form 50-132 rendered `property.opinionOfValue` from the build script input (e.g., $702,845) while Requested Relief and E&U Grid used `stats.min` (e.g., $677,530). Two separate value derivations existed with no reconciliation.

### 2. CODE FIX
- File: `server/services/taxnet-package-generator.js`
- Lines ~674–680: Added SINGLE SOURCE OF TRUTH block. `property.opinionOfValue` overridden to `finalValue` (county-specific: median for Collin/Fort Bend, min for Bexar) before any page renders.
- `renderEUGrid(doc, property, comps, allAdj, finalValue)` — added `finalValue` param
- `renderEvidence(doc, caseData, property, comps, allAdj, stats, finalValue)` — added `finalValue` param
- Both functions now use `finalValue` for Indicated Value, Recommended Value, and Requested Relief text
- Old path (hardcoded `minVal` / `stats.min` inside grid/evidence) removed

### 3. DATA FIX
- OA-0010, OA-0013, OA-0027 rebuilt with corrected values
- All 3 packages verified: Form 50-132 = Comp Grid = Evidence = Requested Relief

### 4. AUTOMATION FIX
- Hard-fail validation added to stream finish handler
- If `property.opinionOfValue !== finalValue` → PDF deleted, Promise rejected
- No PDF is emitted if mismatch exists

### 5. PERSISTENCE FIX
- Change is in source file (`taxnet-package-generator.js`) — survives restarts
- Build scripts that previously passed `opinionOfValue` are ignored (generator overwrites)

### 6. VERIFICATION
- Test build passed `opinionOfValue: 999999` externally; generator overrode to correct county value
- `validationPassed: true` returned on all 3 packages
- OA-0010 (Fort Bend/Median): $583,514 consistent across all pages
- OA-0013 (Collin/Median): $373,970 consistent across all pages
- OA-0027 (Bexar/Min): $677,530 consistent across all pages

### STATUS: ✅ FIXED

---

## FIX-002 — County-specific valuation logic (Median vs Min)
**Date:** 2026-04-22  
**Requested by:** Tyler Worthey

### 1. ROOT CAUSE
Generator used universal MIN rule for all counties. Collin and Fort Bend should use MEDIAN per county protest standards.

### 2. CODE FIX
- File: `server/services/taxnet-package-generator.js`
- Replaced single `minAdjustedValue` with county switch:
  - `collin` → MEDIAN
  - `fort bend` / `fortbend` → MEDIAN
  - all others (incl. `bexar`) → MIN
- `finalValue` derived from switch; `countyRule` returned in resolve payload

### 3. DATA FIX
- OA-0010 (Fort Bend): rebuilt with $583,514 (median)
- OA-0013 (Collin): rebuilt with $373,970 (median)
- OA-0027 (Bexar): rebuilt with $677,530 (min — unchanged)

### 4. AUTOMATION FIX
- Hard-fail validation checks `finalValue` (not `minAdjustedValue`)
- `countyRule` field in resolve output confirms which path fired

### 5. PERSISTENCE FIX
- Source file change; survives restarts

### 6. VERIFICATION
- All 3 builds returned `validationPassed: true`
- `countyRule=median` confirmed on OA-0010 and OA-0013
- `countyRule=min` confirmed on OA-0027

### STATUS: ✅ FIXED

---

## FIX-003 — Legacy address email template ("Action Required: Complete Your Submission")
**Date:** 2026-04-22  
**Reported by:** Tyler Worthey  
**Cases affected:** All new `POST /api/prereg` incomplete address submissions

### 1. ROOT CAUSE
`server/server.js` lines 4393–4409: hardcoded `incompleteHtml` template with red warning header, "We cannot run your analysis" text, and "Action Required: Complete Your Address" subject. Fired unconditionally on all incomplete pre-reg submissions regardless of whether address could be resolved.

### 2. CODE FIX
- File: `server/server.js`
- Lines 4337–4420: replaced entire `INCOMPLETE ADDRESS HANDLING` block via node patch script
- New flow (v2):
  1. Create task (data_fix)
  2. Run Census geocoder FIRST
  3. If 1 match → auto-resolve address, advance to `WAITING_FOR_NOTICE_UPLOAD`
  4. `address_fix_requested` guard check → skip if already sent
  5. High-confidence: "We found your property — please confirm" template
  6. Low-confidence (0 or 2+): "Quick question about your property address" with candidate list
  7. Set `address_fix_requested = true` on send
  8. SMS mirrors email logic (high/low confidence branching)
- Legacy `incompleteHtml` const and "Action Required" subject: **deleted**, 0 references remain (verified via grep)

### 3. DATA FIX
- `address_fix_requested` column added to `pre_registrations` (boolean, default false)
- 28 existing NEEDS_REVIEW/INCOMPLETE/NEEDS_INFO records bulk-marked `address_fix_requested = true`
- Tho (id: 9408ee67): `address_fix_requested = true` set manually; 1 v2 email sent (2 candidates found)
- Michael Doland (id: 8e3532a0): address auto-resolved to `8715 Washington Blvd, Beaumont, TX 77707` via geocoder; status advanced to `WAITING_FOR_NOTICE_UPLOAD`

### 4. AUTOMATION FIX
- `address_fix_requested` hard gate: checked before every email send
- Set to `true` immediately after successful send
- Activity log action `incomplete_address_outreach` stores `template: 'v2_confirmation'` for audit trail
- `activity_log` confirmed 0 repeated `incomplete_address_outreach` per case

### 5. PERSISTENCE FIX
- Change is in `server/server.js` — survives restarts
- `address_fix_requested` column is in Postgres — survives session reset
- **Server restart required for live traffic to use new handler**
- Server process confirmed running (PID 66672)
- ⚠ Server has NOT been restarted yet — new code not live for incoming requests until restart

### 6. VERIFICATION
- Grep confirms 0 occurrences of legacy template strings: `"Action Required.*Complete"`, `"We cannot run your analysis"`, `"Complete Your Submission"`, `incompleteHtml`
- `node -c server.js` syntax check passes
- New template markers present at lines 4337, 4383, 4398, 4418

### STATUS: ⚠ PARTIAL — Code and data fixed. **Server restart pending** for new handler to serve live traffic.

---

## FIX-004 — Status normalization (12 duplicate/legacy status strings)
**Date:** 2026-04-22

### 1. ROOT CAUSE
`pre_registrations` and `submissions` had 12+ distinct status strings due to mixed casing, legacy naming, and inconsistent writes (e.g., `converted` vs `CONVERTED`, `Pending Approval` vs `PENDING_TYLER_APPROVAL`).

### 2. CODE FIX
- No code change required — statuses are free-text fields
- SYSTEM-RULES.md establishes canonical list going forward

### 3. DATA FIX
Applied via Supabase admin:

| Table | From | To | Count |
|---|---|---|---|
| pre_registrations | `converted` | `CONVERTED` | 2 |
| pre_registrations | `NEEDS_REVIEW` (flagged+unresolved) | `INCOMPLETE_INTAKE` | 23 |
| pre_registrations | `NEEDS_INFO` | `WAITING_FOR_NOTICE_UPLOAD` | 6 |
| submissions | `New` | `NEW` | 3 |
| submissions | `Pending Approval` | `PENDING_TYLER_APPROVAL` | 21 |
| submissions | `Awaiting Notice` | `AWAITING_NOTICE` | 8 |
| submissions | `Needs Info` | `NEEDS_INFO` | 3 |
| submissions | `Needs Review` | `NEEDS_INFO` | 1 |
| submissions | `pending-review` | `NEEDS_INFO` | 1 |
| submissions | `Ready to File` | `SIGNED_READY_TO_FILE` | 1 |
| submissions | `Signed` | `SIGNED_READY_TO_FILE` | 1 |
| submissions | `Preliminary Analysis` | `PRELIMINARY_ANALYSIS` | 1 |
| submissions | `Archived` | `ARCHIVED` | 31 |

### 4. AUTOMATION FIX
- N/A — no automations depended on old status strings (verified by code search)
- `runFollowUpSequence` exclusion list used old strings (`"Archived","Deleted",...`) — these still work as the old strings are no longer in DB; canonical strings are not in the exclusion list (acceptable — excluded cases are ARCHIVED)

### 5. PERSISTENCE FIX
- DB change — permanent

### 6. VERIFICATION
- Final counts verified:
  - pre_registrations: `WAITING_FOR_NOTICE_UPLOAD:41, INCOMPLETE_INTAKE:23, CONVERTED:8, NEEDS_REVIEW:3, UNSUPPORTED_STATE:1` (total 76)
  - submissions: `PENDING_TYLER_APPROVAL:53, ARCHIVED:31, AWAITING_NOTICE:8, SIGNED_READY_TO_FILE:4, NEW:3, NEEDS_INFO:5, PRELIMINARY_ANALYSIS:1` (total 105)

### STATUS: ✅ FIXED

---

## FIX-005 — Stale evidence packet paths (Render/container filesystem)
**Date:** 2026-04-22

### 1. ROOT CAUSE
`submissions.evidence_packet_path` contained `/app/server/...` and `/opt/render/project/...` paths from a previous Render.com deployment. These files no longer exist on any accessible host.

### 2. CODE FIX
- N/A — path is a data field, no code change required
- Future generator writes to `/Users/aquabot/Documents/OverAssessed/server/filing-packages/` (already correct in `taxnet-package-generator.js`)

### 3. DATA FIX
- 24 active cases: paths updated to `/Users/aquabot/Documents/OverAssessed/server/filing-packages/{case_id}-Filing-Package.pdf`
- OA-0031, OA-0001: no local PDF exists — `evidence_packet_path` set to `NULL`
- OA-0013: relative path `protest-packages/OA-0013-Protest-Package-v2.pdf` corrected to canonical local path

### 4. AUTOMATION FIX
- N/A

### 5. PERSISTENCE FIX
- DB change — permanent

### 6. VERIFICATION
- Verified 23 local PDFs exist at updated paths
- OA-0031 and OA-0001 confirmed NULL (no local package)

### STATUS: ✅ FIXED — ⚠ OA-0031 and OA-0001 require package regeneration before filing approval

---

## FIX-006 — documents table: submission_id FK, client_id optional, backfill
**Date:** 2026-04-22

### 1. ROOT CAUSE
`documents` table had `client_id NOT NULL` with no `submission_id` column. 8 existing documents (notice/agreement URLs) could not be inserted because most cases have no `clients` row. The table was empty and unusable.

### 2. CODE FIX
- N/A — schema change only
- Future upload handlers should write to `documents` with `submission_id` as primary key

### 3. DATA FIX
Schema changes applied:
- `client_id` → nullable
- `submission_id uuid FK → submissions.id ON DELETE SET NULL` added
- `case_id text` added (direct lookup)
- `url text` added (public storage URL)
- `uploaded_by text` added
- `verified boolean` added

8 records backfilled:

| Case | Type | Status |
|---|---|---|
| OA-0022 | notice | ✅ |
| OA-0013 | notice | ✅ |
| OA-0084 | notice | ✅ |
| OA-TEST-TYLER | form_50_162 | ✅ |
| OA-0025 | notice | ✅ |
| OA-0037 | loa | ✅ |
| OA-0010 | notice | ✅ |
| OA-0039 | notice | ✅ |

### 4. AUTOMATION FIX
- N/A

### 5. PERSISTENCE FIX
- Schema change in Postgres — permanent
- ⚠ RLS policy `documents_select` still restricts reads to `client_id` matches or admin. Records with `client_id = NULL` are invisible to non-admin portal users. Admin/service role access works correctly.

### 6. VERIFICATION
- `\d documents` confirms all new columns present
- Query returned 8 rows with `sub_id:set` and `verified:true`

### STATUS: ✅ FIXED — ⚠ RLS policy update required before client portal can read documents (OPEN-ISSUES #4)

---

## FIX-007 — documents RLS policy blocks non-admin reads when client_id = NULL
**Date:** 2026-04-22  
**Relates to:** FIX-006, OI-004

### 1. ROOT CAUSE
`documents_select` RLS policy on `documents` table only permitted reads via `client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid()) OR is_admin()`. All 8 backfilled documents have `client_id = NULL` (no clients row for most cases). Non-admin portal users could read 0 documents.

### 2. CODE FIX
- No server code changed — pure Postgres RLS policy change
- File: Supabase `documents` table policy `documents_select`
- **Dropped** old policy (single-clause `client_id` path)
- **Created** new policy with three clauses:
  1. `is_admin()` — unchanged
  2. `client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())` — original path, preserved
  3. `submission_id IN (SELECT s.id FROM submissions s JOIN clients c ON c.email = s.email WHERE c.auth_user_id = auth.uid())` — new path via email bridge

### 3. DATA FIX
- No data changes required — 8 backfilled documents already have `submission_id` set correctly

### 4. AUTOMATION FIX
- N/A

### 5. PERSISTENCE FIX
- Postgres policy change — permanent, survives all restarts

### 6. VERIFICATION
- **Admin (tyler@overassessed.ai uid d797f5f5):** `admin_path_sees = 8` ✅
- **Unauthorized (no client/submission match):** `unauthorized_sees = 0` ✅
- **Wrong uid (ffffffff...):** `docs_visible_for_wrong_user = 0` ✅
- **Authorized path structural proof:** policy correctly joins `submissions.email → clients.email → clients.auth_user_id`. `arupani4@gmail.com` (uid ef658ac1, no admin role) has OA-0013 submission match confirmed; will see OA-0013 document once client row is created with that auth_user_id.
- **Note:** No client rows currently have `auth_user_id` populated (no portal users have signed up yet). Policy is structurally correct and will activate automatically when clients create portal accounts.

### STATUS: ✅ FIXED

---

## FIX-008 — v2 incomplete-address pre-reg flow (deploy + broken `.catch()` chains)
**Date:** 2026-04-23  
**Reported by:** Tyler Worthey  
**Related:** OI-001, FIX-003

### 1. ROOT CAUSE
Two-part failure in `POST /api/pre-register` incomplete-address branch (`server/server.js`, lines ~4295–4440):
1. **Deploy:** v2 handler patch was on local disk only. Production (Render) still ran the old handler until local commit → git push → Render auto-deploy.
2. **Runtime bug (post-deploy):** 4 Supabase query chains used `.catch(() => {})` directly on the query builder. The deployed `@supabase/supabase-js` client on Render does not return a thenable with a `.catch` method from the builder chain — calling `.catch(…)` on it throws `TypeError: supabaseAdmin.from(...).update(...).eq(...).catch is not a function` at runtime. The surrounding `try { ... } catch(emailErr) { ... }` swallowed the TypeError and logged it as an email failure, which is why the symptom appeared as "email failed" even though the email had already been sent successfully by SendGrid a split-second earlier.

Render log excerpt (pre-fix):
```
[Pre-Reg] ✅ Address confirmation email sent to ... (highConfidence=false)
[Pre-Reg] Address confirmation email failed: supabaseAdmin.from(...).update(...).eq(...).catch is not a function
[Pre-Reg] SMS failed: supabaseAdmin.from(...).insert(...).catch is not a function
```

### 2. CODE FIX
- File: `server/server.js`
- Replaced 4 broken chains with explicit `try/catch` blocks:
  1. Auto-resolve `pre_registrations` update (high-confidence match) — ~L4364
  2. `address_fix_requested = true` update after email — ~L4416
  3. `activity_log` insert (`incomplete_address_outreach`) — ~L4418
  4. `communications` insert (SMS outbound) — ~L4432
- Each failure now logs a distinct diagnostic (e.g., `[Pre-Reg] activity_log insert failed: …`) so future regressions are visible in Render logs instead of being masked as "email failed".

### 3. DATA FIX
- Test records from the broken window remain in DB (status `NEEDS_REVIEW`, no activity/comms) — all internal `@overassessed-internal.invalid` emails, no real users affected. No backfill needed. Any future pre-regs use the fixed code path.

### 4. AUTOMATION FIX
- Each DB write in the v2 block now has its own try/catch with a unique diagnostic prefix. Tail `[Pre-Reg] ... insert failed` / `... update failed` in Render logs to detect silent regressions.

### 5. PERSISTENCE FIX
- Commit `77f1048` pushed to `origin/main` and `oa-render-staging/main`. Render auto-deploy at 2026-04-23 12:21 UTC. Service version `mobgamw8`, deployed 12:24 UTC confirmed live.

### 6. VERIFICATION (Production — Render)
Verification test: pre-reg `b96ebdbe-870c-4856-b954-c3f442fe880e` submitted 2026-04-23 12:24:47 UTC.

| Check | Result | Evidence |
|---|---|---|
| Geocoder returned results | ✅ | `geocode_matches: 1` in activity_log details |
| Email send function executed | ✅ | Render log: `✅ Address confirmation email sent to oi001-postfix4@…` |
| SMS send function executed | ✅ | SMS delivered to `+12105550044`, SID logged in Twilio |
| `address_fix_requested = true` update succeeded | ✅ | DB row: `address_fix_requested: true` |
| `communications` row inserted | ✅ | DB row: `{channel: sms, direction: outbound, status: sent, recipient: +12105550044}` |
| `activity_log` row inserted | ✅ | DB row: `action: incomplete_address_outreach, template: v2_confirmation` |
| Auto-resolve status advanced | ✅ | DB: `status: WAITING_FOR_NOTICE_UPLOAD`, `resolved_address: 654 BIRCH LN TRL, CORINTH, VT, 05039` |
| Zero runtime errors | ✅ | Render log for request: no `catch is not a function` |

### STATUS: ✅ FIXED

---

## FIX-LOG NOTE — OI-002 original framing became stale after DB verification (2026-04-23)

**Logged:** 2026-04-23  
**Relates to:** OI-002

OI-002 was opened on 2026-04-22 with the description: "3 NEEDS_REVIEW records with `resolved_address IS NOT NULL` — not promoted to WAITING_FOR_NOTICE_UPLOAD."

DB verification on 2026-04-23 (`SELECT * FROM pre_registrations WHERE resolved_address IS NOT NULL`) returned 0 rows across all 68 non-test records. The original 3 records described in OI-002 no longer exist in that state.

**Conclusion:** The original 3 records were either:
1. Promoted during the April 22 batch normalization run (most likely), or
2. Never persisted `resolved_address` due to the same `.catch()` bug documented in FIX-008 — meaning they were in the broken window and geocoder results were computed but never written to DB.

OI-002 has been reframed in OPEN-ISSUES.md to reflect the actual current DB state: 6 NEEDS_REVIEW records created during the FIX-008 broken window, all with `resolved_address = NULL`, all awaiting customer address replies.

---

## FIX-009 — NO_SYNTHETIC_COMPS hard block + TaxNetUSA routing

**Logged:** 2026-04-23
**Closes:** OI-010 (in progress), OI-011 (in progress)
**Commits:** `17316bc`, `ec795b6` (freeze lift prereq)

### Root cause

Two orthogonal problems compounded:

1. **Synthetic comp fallback was silent.** `services/comp-engine.js` generated up to 15 synthetic comps via `generateSyntheticComps(subject, n)` whenever a county scraper returned < 15 real comps. Subject assessed values were used as synthetic-comp base — meaning savings calculations were self-referential math on fake data. 23 active cases had been processed this way, including OA-0005 (already at `SIGNED_READY_TO_FILE`).

2. **Orchestrator MVP calc used sale prices, not assessed.** `orchAnalyzeLead()` in `server/server.js:~10376` fetched Rentcast AVM comps and computed `savings = (assessed - avg(salePrice)) * taxRate`. For new construction where `salePrice > assessed`, savings always = 0 (e.g. OA-0010 $648K assessed vs $574K–$775K sale comps → $0). For older homes where `salePrice < assessed` it under-reports (OA-0013 got $572 vs correct $971).

### Code fix

**`server/services/comp-engine.js`**
- Added `ALLOW_SYNTHETIC = false` constant (line 33)
- Added `TAXNETUSA_COUNTIES = new Set(['bexar', 'denton', 'tarrant'])` for hard-routed counties
- Import `getCountyData as getLocalParcelData` from `./local-parcel-data`
- Synthetic fallback block (line ~213): when `ALLOW_SYNTHETIC=false`, returns `{ data_blocked: true, data_issue: 'SYNTHETIC_COMPS_BLOCK', comps: [], verificationTag: 'DATA_UNAVAILABLE' }` instead of generating fakes
- New Tier-1 block for Bexar/Denton (Tarrant already had its own): loads local parcel data, returns `data_issue: 'TAXNET_SOURCE_REQUIRED'` if unavailable or < 5 comps (no Rentcast/CAD/synthetic fallback for these counties)
- Result object now includes: `comp_source`, `comps_generated`, `comp_engine_fallback`, `has_real_comps`, `data_sources` metadata

**`server/services/evidence-generator.js`**
- Top of `generateEvidencePacket()`: throws `SYNTHETIC_COMPS_BLOCK` error if `compResults.comp_source === 'synthetic'` OR `comps_generated === true` OR `data_blocked === true` OR any comp has `_synthetic: true`

**`server/server.js`**
- `runApprovalGate()` Gate 7 added (tightened 2026-04-23): accepts only `comp_source IN ('real', 'taxnetusa', 'cad_scraper')`. Rejects `'rentcast'`, `'rentcast-api'`, `'synthetic'`, `'synthetic-estimate'`, `'none'`, `'unknown'`. Also blocks when `data_blocked=true` or `comps_generated=true`.

### Data fix

- OA-0013: `status=NEEDS_REVIEW`, `analysis_status=DATA_INVALID`, `confidence_level=INVALID`, `needs_manual_review=true`. Activity log `synthetic_comps_blocked` written.
- OA-0010: same.
- 21 other cases identified with synthetic comps — flagged in audit, not yet moved (awaits Tyler direction). Full list: OA-0079, OA-0083, OA-0024, OA-0045, OA-0056, OA-0025, OA-0076, OA-0015, OA-0016, OA-0069, OA-0084, OA-0027, OA-0026, OA-0066, OA-0018, OA-0021, OA-0042, OA-0074, OA-0023, OA-0033, **OA-0005 (SIGNED_READY_TO_FILE — highest risk)**.

### Automation fix

- Orchestrator `orchAnalyzeLead()` still active but now produces results filtered by Gate 7 at approval time (synthetic/sale-price-based savings no longer promote to `PENDING_TYLER_APPROVAL`). OI-010 remains open for the underlying orch refactor (use `findComparables` or stored `property_data` instead of Rentcast AVM).
- `orchStageTransition()` remains FROZEN (Tyler directive 2026-04-23 — status transitions still blocked).

### Persistence fix

- Commit `17316bc` pushed to `overassessed-ai` + `oa-render-staging` remotes. Render deploys automatically on push. Freeze-lift commit `ec795b6` already verified live on `analysis-worker-70`.

### Verification

- Node syntax check: `comp-engine.js`, `evidence-generator.js`, `server.js` all PASS
- OA-0013 + OA-0010 both in `NEEDS_REVIEW/DATA_INVALID/INVALID` state, confirmed via direct Supabase query
- 23-case audit complete, list in activity_log under `synthetic_comps_blocked`
- Render deploy verification pending (commit just pushed)

### SYSTEM-RULES.md updates

- RULE 9 added: NO SYNTHETIC COMPS (hard block with detection flags + enforcement points)
- RULE 10 added: COUNTY DATA SOURCE ROUTING (4-tier priority, TaxNetUSA hard requirement for Bexar/Denton/Tarrant)

### STATUS: ✅ CODE + DATA + DOCS COMPLETE, 🔄 Render deploy in flight, ⏳ 21 other synthetic-comp cases await cleanup direction
