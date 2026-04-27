/**
 * daily-summary.js
 * Actionable daily command summary for Tyler.
 *
 * 4 buckets (exact):
 *   READY_TO_FILE   — built packages awaiting approval
 *   WRONG_DOCUMENT  — fixable (re-upload required)
 *   WAITING_NOTICE  — largest opportunity
 *   CAD_BLOCKED     — enrichment blocked
 *
 * Pure builder — no DB writes. Returns structured object + formatted text.
 */
'use strict';

const { reconcileAll } = require('./state-engine');

async function buildDailySummary(supabase, { now = new Date() } = {}) {
  const { transitions } = await reconcileAll(supabase, { dryRun: true });

  const buckets = {
    READY_TO_FILE:  [],
    WRONG_DOCUMENT: [],
    WAITING_NOTICE: [],
    CAD_BLOCKED:    [],
  };

  for (const t of transitions || []) {
    if (t.case_id.startsWith('OA-TEST')) continue;
    const s = t.to;
    if (buckets[s]) buckets[s].push(t);
  }

  const lines = [
    `📊 OA DAILY SUMMARY — ${now.toISOString().slice(0,10)}`,
    '',
    `✅ READY TO FILE: ${buckets.READY_TO_FILE.length}`,
    ...buckets.READY_TO_FILE.map(r => `   ${r.case_id}  ${r.owner_name || ''}`),
    '',
    `⚠️  WRONG DOCUMENT: ${buckets.WRONG_DOCUMENT.length}`,
    ...buckets.WRONG_DOCUMENT.map(r => `   ${r.case_id}  ${r.owner_name || ''}  — ${r.reason}`),
    '',
    `📬 WAITING NOTICE: ${buckets.WAITING_NOTICE.length}`,
    ...buckets.WAITING_NOTICE.map(r => `   ${r.case_id}  ${r.owner_name || ''}  (${r.county || '?'})`),
    '',
    `🚧 CAD BLOCKED: ${buckets.CAD_BLOCKED.length}`,
    ...buckets.CAD_BLOCKED.map(r => `   ${r.case_id}  ${r.owner_name || ''}  — ${r.reason}`),
  ];

  return {
    generatedAt:   now.toISOString(),
    readyToFile:   buckets.READY_TO_FILE.length,
    wrongDocument: buckets.WRONG_DOCUMENT.length,
    waitingNotice: buckets.WAITING_NOTICE.length,
    cadBlocked:    buckets.CAD_BLOCKED.length,
    cases:         buckets,
    text:          lines.join('\n'),
  };
}

module.exports = { buildDailySummary };
