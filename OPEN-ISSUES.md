# OPEN-ISSUES.md — OverAssessed Unresolved Items

> Only unresolved items live here.  
> An issue is removed ONLY when all 6 fix layers are complete and logged in FIX-LOG.md.  
> Last updated: 2026-04-23  
> Maintained by: WortheyAquaBot

---

## OI-001 — v2 incomplete-address handler deployed to Render ✅ RESOLVED
**Priority:** ✅ RESOLVED  
**Opened:** 2026-04-22 | **Resolved:** 2026-04-23  
**Fix:** FIX-008 in FIX-LOG.md

**Problem was two-stage:**
1. Server restart needed (resolved by git push → Render auto-deploy, commit `2d69b8d`)
2. Post-restart verification revealed 4 broken `supabaseAdmin.from(...).catch(() => {})` chains in the v2 block — task creation + email + SMS sent fine but `address_fix_requested`, `activity_log`, `communications`, and auto-resolve status update all silently failed (deploy commit `77f1048`)

**Final production verification (test pre-reg `b96ebdbe-870c-4856-b954-c3f442fe880e`, 2026-04-23 12:24 UTC):**
- ✅ Geocoder returned results (1 match, high-confidence)
- ✅ Email sent (SendGrid, `oi001-postfix4@...`)
- ✅ SMS sent (Twilio, `+12105550044`, SID logged)
- ✅ `address_fix_requested = true` in DB
- ✅ `communications` row inserted (channel=sms, status=sent)
- ✅ `activity_log` row inserted (action=incomplete_address_outreach)
- ✅ Auto-resolve: status advanced to `WAITING_FOR_NOTICE_UPLOAD`, `resolved_address` populated
- ✅ Zero errors in Render logs for this request

---

## OI-002 — 6 NEEDS_REVIEW pre-registrations awaiting address confirmation (customer reply required)
**Priority:** 🟡 MEDIUM  
**Opened:** 2026-04-22 | **Reframed:** 2026-04-23

**Original framing (stale — closed):**  
"3 NEEDS_REVIEW records with `resolved_address IS NOT NULL` not promoted." DB verification on 2026-04-23 confirmed `resolved_address = NULL` across all pre-reg records. The original 3 were either promoted during the April 22 batch normalization run or never persisted `resolved_address` due to the same `.catch()` bug fixed in FIX-008. Original framing no longer present in DB. Superseded by current framing below.

**Current problem:**  
6 pre-registration records remain in `NEEDS_REVIEW` with `resolved_address = NULL`. All 6 were created during the broken `.catch()` window (2026-04-23 00:08–10:54 UTC, before FIX-008). Email and SMS outreach fired successfully for each, but `address_fix_requested` was never set to `true` (DB write failed silently). Geocoder returned 0 matches for 5 of 6 addresses (too ambiguous without city/state/zip). 1 record (Arnoldo Corona) geocodes to a single high-confidence match.

**Records:**

| Pre-reg ID | Name | Email | Original Address | Geocoder |
|---|---|---|---|---|
| `1a6ea8a1` | Maria Montemayor | flylupita@icloud.com | 10260 Stone Gate Dr | 0 matches |
| `54a0bb4b` | Arnoldo Corona | acorona605@gmail.com | 4342 Woodcrest Ln Dallas 75206 | ✅ 1 match |
| `a65d386b` | Arturo Barrera | abarrera3564@hotmail.com | 790 Tierra Linda Dr | 0 matches |
| `8f9f3dce` | Cpn Ling | cpnking001@gmail.com | 11457 hillhaven dr | 0 matches |
| `71f155d1` | Manuel Mejia | mejdom@gmail.com | 614 white ash dr | 0 matches |
| `d5526a8c` | Joseph Strand | joseph7351@gmail.com | 1701 E Round Rock Dr | 0 matches |

**Root cause of DB state:** FIX-008 `.catch()` bug — outreach sent but `address_fix_requested` update silently failed for all 6.

**To close:**  
1. Arnoldo Corona (`54a0bb4b`): Tyler confirms `4342 WOODCREST LN, DALLAS, TX, 75206` → promote to `WAITING_FOR_NOTICE_UPLOAD`, backfill `resolved_address`/`resolved_zip`/`state`  
2. Remaining 5: await customer replies with corrected address → v2 handler re-processes on reply → promote automatically  
3. Backfill `address_fix_requested = true` on all 6 so re-outreach doesn't fire  
4. Log in FIX-LOG.md when all 6 are resolved or moved to `INCOMPLETE_INTAKE`

---

## OI-003 — OA-0031 and OA-0001 have no filing package (AWAITING_NOTICE with NULL evidence path)
**Priority:** 🟡 MEDIUM  
**Opened:** 2026-04-22  
**Relates to:** FIX-005

**Problem:** Both cases are in `AWAITING_NOTICE` status with `evidence_packet_path = NULL`. No local filing package PDF exists for either. They cannot proceed to Tyler approval without a package.

**OA-0031:** `/app/server/evidence-packets/OA-0031-Evidence-Packet.pdf` — Render path, file gone  
**OA-0001:** `/app/server/evidence-packets/OA-0001-Evidence-Packet.pdf` — Render path, file gone

**To close:** Run package generator for OA-0031 and OA-0001 → verify PDF written to `filing-packages/` → update `evidence_packet_path` in DB → log in FIX-LOG.md.

---

## OI-004 — documents RLS policy blocks non-admin portal reads (client_id = NULL records)
**Priority:** ✅ RESOLVED  
**Opened:** 2026-04-22 | **Resolved:** 2026-04-22  
**Fix:** FIX-007 in FIX-LOG.md

New `documents_select` policy adds `submission_id → submissions.email → clients.auth_user_id` bridge. Admin sees all 8 docs. Unauthorized uid sees 0. Policy activates automatically when clients create portal accounts.

---

## OI-005 — Duplicate hardcoded email templates in server.js (Phase 2 cleanup pending)
**Priority:** 🟠 LOW-MEDIUM  
**Opened:** 2026-04-22

**Problem:** 5 hardcoded email templates in `server.js` are duplicates of canonical `oa-email-templates.js` exports and should be removed/replaced:

| server.js line | Description | Duplicate of |
|---|---|---|
| ~3716 | "Great News — Appeal Successful" | `analysisCompleteEmail` |
| ~4222 | Needs-review analysis hardcoded | `analysisCompleteEmail` |
| ~5577 | Needs-docs / notice upload | `uploadNoticeEmail` |
| ~5884 | Analysis in progress (hardcoded) | `analysisInProgressEmail` |
| ~6056 | Analysis complete (hardcoded) | `analysisCompleteEmail` |

**Risk:** Divergence between canonical template and hardcoded copy over time; branding changes applied to one but not the other.

**To close:** Replace each hardcoded block with call to canonical template → confirm no customer-visible change → log in FIX-LOG.md.

---

## OI-006 — 4 customer-facing templates in server.js use raw HTML (not wrapped in wrapEmail)
**Priority:** 🟠 LOW-MEDIUM  
**Opened:** 2026-04-22

**Problem:** These templates send raw HTML without the canonical `wrapEmail()` wrapper from `oa-email-templates.js`, meaning they do not get the Outlook-safe VML button, Arial font stack, or consistent brand header/footer:

| server.js line | Template |
|---|---|
| ~4384 | Address confirmation — high-confidence |
| ~4399 | Address confirmation — low-confidence |
| ~1082 | Hearing scheduled |
| ~1687 | 72h unsigned reminder |
| ~7510 | Document receipt confirmation |

**To close:** Migrate each to canonical `wrapEmail()` wrapper → visual review → log in FIX-LOG.md.

---

## OI-007 — runFollowUpSequence exclusion list uses old status strings
**Priority:** 🟠 LOW  
**Opened:** 2026-04-22

**Problem:** `server.js:1512` — `runFollowUpSequence` excludes: `"Archived","Deleted","Duplicate","Resolved","Form Signed","Protest Filed","Cold"`. These are legacy strings. Canonical archived status is now `ARCHIVED`. Current DB has no records with old strings so no immediate impact, but this exclusion list is a latent bug.

**To close:** Update exclusion list to canonical status strings → log in FIX-LOG.md.

---

## OI-008 — documents table: filing packages not yet backfilled
**Priority:** 🟠 LOW  
**Opened:** 2026-04-22

**Problem:** 24 active cases have local filing package PDFs at `/Users/aquabot/Documents/OverAssessed/server/filing-packages/` but none are written to the `documents` table. The `documents` table currently only contains 8 notice/agreement records.

**Note:** Filing packages are local files, not Supabase Storage objects. Writing them to `documents` table requires either uploading to Supabase Storage first or storing local path + accepting that URL is not a public link.

**To close:** Decide: (a) upload filing packages to Supabase Storage, or (b) store local path only → bulk insert `type='filing_package'` records → log in FIX-LOG.md.

---

## OI-009 — Pre-reg total count discrepancy (previously shown as 75, actual is 76)
**Priority:** ✅ RESOLVED — documented for reference  
**Opened:** 2026-04-22 | **Resolved:** 2026-04-22

Prior query used implicit `.limit(50)` default. Actual DB count confirmed as 76 via `{ count: 'exact' }`. No phantom or duplicate row. No action required.

---

## Summary

| ID | Priority | Issue | Blocked by |
|---|---|---|---|
| OI-001 | ✅ RESOLVED | v2 incomplete-address handler live + all 6 DB writes verified | FIX-008 |
| OI-002 | 🟡 MED | 6 NEEDS_REVIEW pre-regs, resolved_address=NULL, awaiting customer replies | Backfill address_fix_requested + Tyler confirm 1 record |
| OI-003 | 🟡 MED | OA-0031, OA-0001 have no filing package | Package regen |
| OI-004 | ✅ RESOLVED | documents RLS blocks portal reads | FIX-007 |
| OI-005 | 🟠 LOW-MED | 5 duplicate hardcoded templates in server.js | Phase 3 cleanup |
| OI-006 | 🟠 LOW-MED | 4 templates not using wrapEmail() | Phase 3 cleanup |
| OI-007 | 🟠 LOW | runFollowUpSequence old status exclusion list | Minor code fix |
| OI-010 | 🔴 HIGH | Orchestrator new-build comp bug (Rentcast AVM sale-price → \$0 savings) | Refactor orchAnalyzeLead |
| OI-011 | 🔴 HIGH | CCAD 403 + FBCAD AJAX parser broken → 23 cases on synthetic data | Fix BIS scraper / switch to Rentcast |
| OI-008 | 🟠 LOW | Filing packages not in documents table | Decision needed |
| OI-010 | 🔴 HIGH | Orchestrator new-build comp bug (zero savings on Rentcast AVM sale-price calc) | Refactor `orchAnalyzeLead` to use stored property_data or assessed-value comps |
| OI-011 | 🔴 HIGH | County scrapers fall back to synthetic comps for CCAD (Collin) + FBCAD (Fort Bend) | Fix CCAD 403 bot-block + FBCAD AJAX-rendered results parser |

---

## OI-010 — Orchestrator new-build comp bug: Rentcast AVM sale-price calc produces \$0 savings
**Priority:** 🔴 HIGH  
**Opened:** 2026-04-23

**Problem:** `orchAnalyzeLead()` (server.js:10376 onward, active after `ec795b6` freeze lift) calls Rentcast AVM fresh for comps and computes savings using **sale prices** of comps: `savings = (assessed - avg(compSalePrice)) * taxRate`. For new-construction properties where recent sale prices exceed the county-assessed value, this always produces `savings ≤ 0` and stages the case as `No Case`.

**Evidence (2026-04-23):**
- **OA-0010** (Khiem Nguyen, 3315 Marlene Meadow Way, Fort Bend): assessed \$648,786. Orch pulled Rentcast comps at \$574K – \$775K sale prices → `savings: 0, stage: No Case`. Real assessed-value comps (median \$608,011) → \$938/yr savings at 2.3% tax rate.
- **OA-0013** (Shabir Rupani, 708 Santa Lucia Dr, Collin): assessed \$399,042. Orch pulled Rentcast comps at \$334K–\$367K sale prices → \$572/yr savings. Real assessed-value comps (median \$354,916) → \$971/yr.

**Root cause:** Property-tax protests are decided on **assessed value** comparisons, not sale price. Using sale prices:
1. Produces wrong results for new construction (sale > assessed)
2. Ignores already-fetched real `property_data` stored in `submissions.property_data`
3. Doesn't call the proper `findComparables`/E&U engine in `services/comp-engine.js`

**To close:**
1. Refactor `orchAnalyzeLead` to either:
   - (a) Call `runFullAnalysis(caseId)` (the real pipeline), or
   - (b) Use `services/comp-engine.js findComparables` directly with stored `property_data`
2. Remove the Rentcast-AVM-only path or restrict to cases where assessed data is unavailable
3. Add guard: if orch savings differ from `findComparables` result by >20%, flag for manual review
4. Log in FIX-LOG.md

---

## OI-011 — County scrapers broken: CCAD 403 bot-block, FBCAD AJAX-rendered parser stale
**Priority:** 🔴 HIGH  
**Opened:** 2026-04-23

**Problem:** `services/property-data.js` BIS adapter (used for Collin + Fort Bend + Williamson + Montgomery + Hunt + Kaufman) no longer returns real property/comp data:
- **CCAD (collincad.org + esearch.collincad.org):** Returns `HTTP 403` on all scraper requests. Blocks multiple user-agents, multiple endpoints. Confirmed 2026-04-23 across `/Search/Result`, `/propertysearch`, `/Search/SearchResults`. Bot detection active.
- **FBCAD (esearch.fbcad.org):** Returns `HTTP 200` but table body is empty — results are fetched client-side via AJAX after page load. Current scraper parses server-rendered HTML (`$('table tbody tr')`) which is empty. Working JSON endpoint exists at `/Search/SearchResults` (not currently used).

**Impact:** Every Collin County and Fort Bend case falls back to:
1. `property_data.source = 'intake-fallback'` with synthetic \$300K assessed value
2. `comp-engine.js` line 213 triggers `generateSyntheticComps(subject, 15)` with fake neighborhood values
3. Resulting evidence packets are built on entirely fabricated comparables

**Confirmed affected cases (2026-04-23 audit):** 23 cases have synthetic or unverified comps. Full list in activity_log under `synthetic_comps_blocked`.

**Immediate mitigation (already deployed 2026-04-23):**
- `ALLOW_SYNTHETIC = false` in `services/comp-engine.js` — synthetic fallback now throws `DATA_UNAVAILABLE` instead of generating fake comps
- `ApprovalGate` Gate 7 added — rejects any case with `comp_source !== 'real'`
- `generateEvidencePacket()` throws `SYNTHETIC_COMPS_BLOCK` error if synthetic comps are passed

**To close:**
1. **CCAD:** Find alternate Collin data source. Options:
   - (a) Switch to Rentcast `/v1/properties` tax-assessment endpoint (proven working for OA-0013/OA-0010 2025 data)
   - (b) Use CCAD bulk data download/FTP if available
   - (c) Implement residential proxy rotation (last resort)
2. **FBCAD:** Refactor BIS adapter to call `/Search/SearchResults?searchtext=...` JSON endpoint instead of scraping `/Search/Result` HTML. Map `propertyId` → detail page.
3. **Comp fetching:** Same scrapers feed `comp-engine.js` — need parallel fix for comp lookup (currently returns 0 real comps for both counties)
4. Log in FIX-LOG.md

**Dependencies:** Rentcast API quota check before making it the primary Collin source.
