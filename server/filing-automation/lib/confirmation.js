'use strict';

const { supabaseAdmin } = require('../../lib/supabase');
const { log } = require('./logger');
const { updateCaseState } = require('../../services/state-controller');

// Confirmation number patterns per portal
const CONF_PATTERNS = {
  kaufman:   /(?:confirmation|protest|appeal|ref(?:erence)?)\s*(?:number|no|#|id)?[:\s]*([A-Z0-9\-]{4,20})/i,
  fort_bend: /(?:confirmation|protest|appeal|ref(?:erence)?)\s*(?:number|no|#|id)?[:\s]*([A-Z0-9\-]{4,20})/i,
  bexar:     /(?:confirmation|protest|appeal|ref(?:erence)?|case)\s*(?:number|no|#|id)?[:\s]*([A-Z0-9\-]{4,20})/i,
  email:     /(?:confirmation|protest|receipt|reference|case)\s*(?:number|no|#|id)?[:\s]*([A-Z0-9\-]{4,20})/i,
};

async function extractConfirmation(page, county) {
  const text = await page.evaluate(() => document.body.innerText);
  const pattern = CONF_PATTERNS[county] || CONF_PATTERNS.email;
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

async function recordFiled(caseId, { method, confirmationNumber, county, screenshotPath, sentAt, dryRun = false }) {
  const ts = sentAt || new Date().toISOString();
  const status = dryRun ? 'DRY_RUN_COMPLETE' : 'FILED';

  if (!dryRun) {
    await updateCaseState(caseId, 'filed', { actor: 'system:filing-confirmation' });
    await supabaseAdmin.from('submissions').update({
      filing_confirmation_number: confirmationNumber || 'SUBMITTED_UNCONFIRMED',
      filed_at: ts,
      filing_method: method,
      updated_at: ts,
    }).eq('case_id', caseId);
  }

  await log(caseId, dryRun ? 'filing_dry_run_complete' : 'filing_confirmed', {
    method, confirmationNumber, county, screenshotPath, sentAt: ts, dryRun,
  });

  return { caseId, status, method, confirmationNumber, county, sentAt: ts };
}

async function recordBlocked(caseId, reason, details = {}) {
  await updateCaseState(caseId, 'status_override', { target_status: 'FILING_BLOCKED', actor: 'system:filing-confirmation' });
  await log(caseId, 'filing_blocked', { reason, ...details });
}

module.exports = { extractConfirmation, recordFiled, recordBlocked };
