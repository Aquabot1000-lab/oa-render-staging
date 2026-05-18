// ═══════════════════════════════════════════════════════════════════════
// lib/filing-window.js — Filing window classification (Tyler msg 34806)
// ─────────────────────────────────────────────────────────────────────
// Replaces "expired-deadline → still recommend Send AOA" antipattern.
//
// Every TX case now classifies into one of:
//   ACTIVE_FILING_WINDOW     — still within statutory standard protest window
//   LATE_REMEDY_REVIEW       — outside standard window but eligible for §25.25 /
//                              no-notice / certified-roll review
//   MISSED_STANDARD_DEADLINE — deadline passed; route to late-signature
//                              follow-up + 2027 candidate workflow
//   2027_CANDIDATE           — already classified as next-cycle candidate
//                              (e.g., OA-0072 pattern, new construction)
//
// Other states pass through unchanged.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

// ── Statutory standard protest deadlines by state (year-agnostic month/day) ──
// Texas: May 15 OR 30 days after NOV mailed (whichever later) — we use May 15 for
//        standard cases. Cases that received NOV later have late_protest_deadline set on row.
// Arizona: April for full-cash-value protest (county-by-county varies).
// We default to the customer's local jurisdiction in production; here we encode TX
// because that's the primary filing state today.
const STANDARD_DEADLINES = {
  TX: { month: 5, day: 15 }, // May 15
  AZ: { month: 4, day: 21 }, // Maricopa 2027 TY = April 21, 2026 (verified Tyler msg 34943)
  CO: { month: 6, day: 1 },  // Colorado NOV protest — June 1 (C.R.S. § 39-5-122)
  // WA: county-by-county; deadline = max(July 1, NOV_date + 60 days). We rely on row.notice_date + 60 via effectiveDeadline() override below.
  WA: { month: 7, day: 1 },  // RCW 84.40.038 minimum baseline; per-county may extend later via NOV+60 path
};

// States where the deadline is driven by NOV date + N days (overrides the calendar default if later)
const NOTICE_DATE_RULES = {
  TX: { plusDays: 30 }, // §41.44(a)(1)(B)
  WA: { plusDays: 60 }, // RCW 84.40.038 — 60 days after NOV mail
};

function getStandardDeadlineForYear(state, year) {
  const cfg = STANDARD_DEADLINES[(state || '').toUpperCase()];
  if (!cfg) return null;
  // Use end-of-day local-ish (UTC noon is safe enough; not minute-critical for digest logic)
  return new Date(Date.UTC(year, cfg.month - 1, cfg.day, 23, 59, 59));
}

/**
 * Compute the effective protest deadline for a row, respecting county-specific
 * overrides and notice-date "30 days after delivery" extension.
 *
 * TX: max(May 15, notice_date + 30 days). If county_filing_deadline is set on
 *     the row's automation_flags, use that instead.
 *
 * @param {object} row
 * @param {Date} statutoryDeadline
 * @returns {Date} effective deadline
 */
function effectiveDeadline(row, statutoryDeadline) {
  let effective = statutoryDeadline;
  const flags = (row.automation_flags && typeof row.automation_flags === 'object' && !Array.isArray(row.automation_flags))
    ? row.automation_flags : {};

  // County-specific override
  if (flags.county_filing_deadline) {
    const ov = new Date(flags.county_filing_deadline);
    if (!isNaN(ov.getTime())) effective = ov;
  }

  // Notice-date + N days rule (state-specific)
  const state = (row.state || '').toUpperCase();
  const rule = NOTICE_DATE_RULES[state];
  if (rule) {
    // Schema columns: customer_notice_confirmed_at (timestamp), notice_received (bool), automation_flags.notice_date override
    const noticeDateStr = flags.notice_date || row.customer_notice_confirmed_at;
    if (noticeDateStr) {
      const nd = new Date(noticeDateStr);
      if (!isNaN(nd.getTime())) {
        const plusN = new Date(nd.getTime() + rule.plusDays * 86400000);
        if (plusN.getTime() > effective.getTime()) effective = plusN;
      }
    }
  }

  return effective;
}

/**
 * Classify a case row's filing window for current year (or override).
 *
 * @param {object} row — submissions row
 * @param {{ now?: Date, year?: number }} opts
 * @returns {'ACTIVE_FILING_WINDOW' | 'LATE_REMEDY_REVIEW' | 'MISSED_STANDARD_DEADLINE' | '2027_CANDIDATE' | 'UNKNOWN'}
 */
function classifyFilingWindow(row, opts = {}) {
  const now = opts.now || new Date();
  const year = opts.year || now.getFullYear();
  const state = row.state || null;
  if (!state) return 'UNKNOWN';

  // ── Explicit tag overrides take precedence ──
  const flags = row.automation_flags;
  const tagList = Array.isArray(row.tags) ? row.tags : [];
  const flagJson = (() => {
    if (!flags) return {};
    if (Array.isArray(flags)) return flags.reduce((a, k) => (a[k] = true, a), {});
    if (typeof flags === 'object') return flags;
    return {};
  })();

  const hasTag = (t) => tagList.includes(t) || flagJson[t];

  if (hasTag('2027_PROTEST_CANDIDATE') || hasTag('NEW_CONSTRUCTION_POTENTIAL')) {
    return '2027_CANDIDATE';
  }

  if (hasTag('LATE_REMEDY_REVIEW') || hasTag('MISSED_OPERATIONAL_CUTOFF') ||
      hasTag('MISSED_OPERATIONAL_CUTOFF_2027_CANDIDATE')) {
    return 'LATE_REMEDY_REVIEW';
  }

  // ── If already filed, this classifier is not the right tool ──
  if (row.filing_submitted === true) return 'UNKNOWN';

  // ── Compute effective deadline (respects county-override + notice+30) ──
  const statutory = getStandardDeadlineForYear(state, year);
  if (!statutory) return 'UNKNOWN';
  const deadline = effectiveDeadline(row, statutory);

  if (now.getTime() <= deadline.getTime()) return 'ACTIVE_FILING_WINDOW';

  // Deadline passed: data-rich = LATE_REMEDY_REVIEW; data-poor = MISSED_STANDARD_DEADLINE
  const hasAssessment = (row.assessed_value && Number(row.assessed_value) > 0);
  const hasCounty = !!row.county;

  if (!hasCounty || !hasAssessment) return 'MISSED_STANDARD_DEADLINE';
  return 'LATE_REMEDY_REVIEW';
}

/**
 * Returns a CTA appropriate for the filing-window classification, replacing
 * the legacy "Send AOA" recommendation when the window is closed.
 *
 * @param {string} windowClass — output of classifyFilingWindow()
 * @param {string} legacyCtaLabel — what the engine WOULD have said
 * @returns {{ label: string, action: string, note?: string }}
 */
function ctaForWindow(windowClass, legacyCtaLabel = 'Review') {
  switch (windowClass) {
    case 'ACTIVE_FILING_WINDOW':
      return { label: legacyCtaLabel, action: 'send_aoa' };
    case 'LATE_REMEDY_REVIEW':
      return {
        label: 'Late Remedy Review',
        action: 'late_remedy_review',
        note: 'Standard window closed. Evaluate §25.25 motion / no-notice / certified-roll path before any new outreach.',
      };
    case 'MISSED_STANDARD_DEADLINE':
      return {
        label: 'Late Follow-up + 2027 Track',
        action: 'late_followup_2027_candidate',
        note: 'Standard window closed without signature. Send late-signature follow-up and preserve as 2027 candidate.',
      };
    case '2027_CANDIDATE':
      return {
        label: '2027 Candidate Track',
        action: 'monitor_2027',
        note: 'Already classified as next-cycle candidate. No new-deadline outreach.',
      };
    default:
      return { label: legacyCtaLabel, action: 'review_case' };
  }
}

module.exports = {
  classifyFilingWindow,
  ctaForWindow,
  effectiveDeadline,
  getStandardDeadlineForYear,
  STANDARD_DEADLINES,
};
