// ═══════════════════════════════════════════════════════════════════════
// lib/late-remedy.js — Late-remedy evaluation paths
// (Tyler msg 34806 / msg 34817 — post-deadline lead preservation)
// ─────────────────────────────────────────────────────────────────────
// When the standard protest deadline has passed (e.g., TX May 15), a case
// may still have one or more late-remedy paths available. This module
// evaluates a submission row and returns the set of eligible paths.
//
// Paths evaluated:
//   1. §25.25(c) — clerical / one-third overvaluation correction (TX Property Tax Code)
//   2. §25.25(d) — substantial overvaluation correction (TX, ≥25% homestead / ≥33% other)
//   3. NO_NOTICE — owner never received the Notice of Appraised Value
//   4. NEW_CONSTRUCTION — recently-built parcel may still be unassessed; track parcel split
//   5. CERTIFIED_ROLL — certified roll arrives ~July; evaluate for clerical errors then
//   6. 2027_CANDIDATE — preserve and track for next cycle
//
// This is an OFFLINE evaluator. It does not write to the DB; callers
// decide what to do with the result.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const { classifyFilingWindow } = require('./filing-window');

/**
 * Evaluate the late-remedy paths available for a submissions row.
 *
 * @param {object} row — submissions row (must include state, county, assessed_value,
 *                       market_value, comp_results, automation_flags, tags, aoa_signed,
 *                       notice_received, filing_submitted, property_type)
 * @param {{ now?: Date }} opts
 * @returns {{
 *   window: string,
 *   eligible_paths: string[],
 *   recommended_action: string,
 *   reasoning: object,
 * }}
 */
function evaluateLateRemedy(row, opts = {}) {
  const now = opts.now || new Date();
  const window = classifyFilingWindow(row, { now });

  const reasoning = {};
  const eligible = [];

  // ── §25.25(c) — clerical / 1/3 overvaluation (TX only) ──
  // Available within 5 years for clerical errors; within 1 year for 1/3 overvaluation.
  // Requires: certified roll error OR ARB-confirmable clerical mistake.
  if ((row.state || '').toUpperCase() === 'TX') {
    // Late-remedy 25.25(c) is possible if we have evidence of clerical error or 1/3 overvaluation
    const av = Number(row.assessed_value) || 0;
    const mv = Number(row.market_value) || (Array.isArray(row.comp_results) && row.comp_results[0]?.median) || 0;
    const overvaluation = (av > 0 && mv > 0) ? (av - mv) / av : null;

    if (overvaluation !== null && overvaluation >= 0.333) {
      eligible.push('SECTION_25_25_C_ONE_THIRD');
      reasoning['SECTION_25_25_C_ONE_THIRD'] = {
        overvaluation_pct: Math.round(overvaluation * 100),
        av, mv,
        note: 'Comp evidence suggests >1/3 overvaluation. §25.25(c)(3) motion may be filed within 1 year.',
      };
    } else if (overvaluation === null) {
      reasoning['SECTION_25_25_C_ONE_THIRD'] = { skip: 'no comp evidence yet; rerun after analysis' };
    } else {
      reasoning['SECTION_25_25_C_ONE_THIRD'] = { ineligible: true, overvaluation_pct: Math.round(overvaluation * 100), threshold_pct: 33 };
    }

    // ── §25.25(d) — substantial value error (≥25% homestead, ≥33% other) ──
    // Late-filed protest under §41.411 / §25.25(d) — within statute of limitations.
    const isHomestead = String(row.property_type || '').toLowerCase().includes('residential')
      || String(row.property_type || '').toLowerCase().includes('homestead');
    const threshold = isHomestead ? 0.25 : 0.333;
    if (overvaluation !== null && overvaluation >= threshold) {
      eligible.push('SECTION_25_25_D_SUBSTANTIAL');
      reasoning['SECTION_25_25_D_SUBSTANTIAL'] = {
        overvaluation_pct: Math.round(overvaluation * 100),
        threshold_pct: Math.round(threshold * 100),
        homestead: isHomestead,
      };
    } else if (overvaluation !== null) {
      reasoning['SECTION_25_25_D_SUBSTANTIAL'] = { ineligible: true, overvaluation_pct: Math.round(overvaluation * 100), threshold_pct: Math.round(threshold * 100) };
    }
  }

  // ── NO_NOTICE — owner claims they never received NOV ──
  // §41.411 — protest may be filed late (up to certain limits) if no notice received.
  if (row.notice_received === false || row.notice_received == null) {
    eligible.push('NO_NOTICE_REVIEW');
    reasoning['NO_NOTICE_REVIEW'] = {
      note: 'notice_received is false/null — eligible for §41.411 no-notice late protest if owner attests no NOV received.',
    };
  }

  // ── NEW_CONSTRUCTION — parcel not yet split / not yet assessed ──
  const flags = (row.automation_flags && typeof row.automation_flags === 'object' && !Array.isArray(row.automation_flags)) ? row.automation_flags : {};
  const tags = Array.isArray(row.tags) ? row.tags : [];
  if (tags.includes('NEW_CONSTRUCTION_POTENTIAL') || flags.NEW_CONSTRUCTION_POTENTIAL ||
      flags.parcel_split_monitoring) {
    eligible.push('NEW_CONSTRUCTION_REVIEW');
    reasoning['NEW_CONSTRUCTION_REVIEW'] = {
      note: 'Parcel split / new-construction monitoring active. When parcel splits to owner, re-evaluate for next-cycle protest.',
    };
  }

  // ── CERTIFIED_ROLL — certified appraisal records arrive ~July ──
  // Always evaluate post-certification (mid-July to August) for clerical errors.
  if (window === 'LATE_REMEDY_REVIEW' || window === 'MISSED_STANDARD_DEADLINE') {
    eligible.push('CERTIFIED_ROLL_REVIEW');
    reasoning['CERTIFIED_ROLL_REVIEW'] = {
      note: 'Re-evaluate after certified appraisal roll publishes (~July). Look for clerical errors or class-of-property mistakes amenable to §25.25(c) motion.',
      schedule: 'July–August annually',
    };
  }

  // ── 2027_CANDIDATE — always preserve missed-deadline leads for next cycle ──
  if (window === 'MISSED_STANDARD_DEADLINE' || window === '2027_CANDIDATE' || window === 'LATE_REMEDY_REVIEW') {
    eligible.push('2027_CANDIDATE');
    reasoning['2027_CANDIDATE'] = {
      note: 'Preserve lead for 2027 cycle. Schedule outreach in January 2027 (well before May 15 deadline).',
    };
  }

  // ── Recommended action prioritization ──
  let recommended = 'review_case';
  if (eligible.includes('SECTION_25_25_D_SUBSTANTIAL')) recommended = 'late_protest_25_25_d';
  else if (eligible.includes('SECTION_25_25_C_ONE_THIRD')) recommended = 'motion_25_25_c';
  else if (eligible.includes('NO_NOTICE_REVIEW')) recommended = 'no_notice_review';
  else if (eligible.includes('NEW_CONSTRUCTION_REVIEW')) recommended = 'monitor_parcel_split';
  else if (eligible.includes('CERTIFIED_ROLL_REVIEW')) recommended = 'await_certified_roll';
  else if (eligible.includes('2027_CANDIDATE')) recommended = 'preserve_2027_candidate';

  return {
    window,
    eligible_paths: eligible,
    recommended_action: recommended,
    reasoning,
  };
}

module.exports = { evaluateLateRemedy };
