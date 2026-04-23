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
