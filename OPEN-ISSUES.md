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

## OI-002 — 3 pre_registrations stuck in NEEDS_REVIEW (geocoder-resolved, not promoted)
**Priority:** 🟡 MEDIUM  
**Opened:** 2026-04-22

**Problem:** 3 records have `status = NEEDS_REVIEW` but their addresses were geocoder-resolved (i.e., `resolved_address IS NOT NULL`). They should be `WAITING_FOR_NOTICE_UPLOAD`. Were not promoted during the batch normalization because the promotion condition requires manual confirmation of the resolved address.

**To close:** Review 3 records → confirm resolved address is correct → update status to `WAITING_FOR_NOTICE_UPLOAD` → log in FIX-LOG.md.

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
| OI-002 | 🟡 MED | 3 pre_regs stuck in NEEDS_REVIEW, geocoder-resolved | Manual review |
| OI-003 | 🟡 MED | OA-0031, OA-0001 have no filing package | Package regen |
| OI-004 | ✅ RESOLVED | documents RLS blocks portal reads | FIX-007 |
| OI-005 | 🟠 LOW-MED | 5 duplicate hardcoded templates in server.js | Phase 3 cleanup |
| OI-006 | 🟠 LOW-MED | 4 templates not using wrapEmail() | Phase 3 cleanup |
| OI-007 | 🟠 LOW | runFollowUpSequence old status exclusion list | Minor code fix |
| OI-008 | 🟠 LOW | Filing packages not in documents table | Decision needed |
