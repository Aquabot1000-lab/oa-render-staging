/**
 * FILING KILL-SWITCH (2026-05-09 — Tyler directive)
 * ─────────────────────────────────────────────────
 * NO AUTO-FILING EVER. All portal-submitting / auto-filing paths must
 * call assertFilingAllowed() before doing any portal work. The only way
 * to bypass is the per-case explicit "FILE OA-XXXX" approval flow which
 * sets process.env.OA_FILING_APPROVED_CASE_IDS for one invocation.
 */

const KILL_SWITCH_REASON =
  'AUTO_FILING_DISABLED — Tyler directive 2026-05-09. ' +
  'Any actual filing must be triggered manually with explicit "FILE OA-XXXX" approval.';

function isFilingApprovedForCase(caseId) {
  if (!caseId) return false;
  const allowList = (process.env.OA_FILING_APPROVED_CASE_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return allowList.includes(caseId);
}

/**
 * Throws if auto-filing is being attempted without explicit approval.
 * @param {string} caseId
 * @param {string} entrypoint  — name of the call site for logging
 */
function assertFilingAllowed(caseId, entrypoint) {
  const ok = isFilingApprovedForCase(caseId);
  console.warn(
    `[FILING-KILLSWITCH] ${entrypoint} attempted for ${caseId} — ` +
    (ok ? 'APPROVED via OA_FILING_APPROVED_CASE_IDS' : 'BLOCKED. ' + KILL_SWITCH_REASON)
  );
  if (!ok) {
    const err = new Error(KILL_SWITCH_REASON);
    err.code = 'AUTO_FILING_DISABLED';
    err.entrypoint = entrypoint;
    err.caseId = caseId;
    throw err;
  }
}

module.exports = {
  assertFilingAllowed,
  isFilingApprovedForCase,
  KILL_SWITCH_REASON,
};
