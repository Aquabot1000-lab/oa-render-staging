'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { supabaseAdmin } = require('../../lib/supabase');

async function log(caseId, action, details = {}) {
  const entry = {
    case_id: caseId,
    actor: 'filing-automation',
    action,
    details: { ...details, logged_at: new Date().toISOString() },
    created_at: new Date().toISOString(),
  };
  console.log(`[${new Date().toISOString()}] [${caseId}] ${action}`, details);
  try {
    await supabaseAdmin.from('activity_log').insert(entry);
  } catch (e) {
    console.error('[logger] DB write failed:', e.message);
  }
}

async function logStep(caseId, step, status, meta = {}) {
  return log(caseId, `filing_step:${step}`, { status, ...meta });
}

async function logError(caseId, step, error, meta = {}) {
  return log(caseId, `filing_error:${step}`, { error: error.message || String(error), stack: error.stack?.substring(0, 500), ...meta });
}

async function setFilingStatus(caseId, status, extra = {}) {
  // Phase 0.5 (Tyler msg 28321): canonical filing_status is owned by
  // services/state-controller.js. This helper now emits a status_override
  // event and writes any extra metadata fields directly (those are not
  // canonical state).
  const { updateCaseState } = require('../../services/state-controller');
  // Map filing_status string → controller event
  const event = status === 'filed' ? 'filed'
              : status === 'package_ready' ? 'package_built'
              : status === 'ready_to_file' ? 'approve_for_filing'
              : status === 'manual_review_required' ? 'hold'
              : 'status_override';
  const payload = {
    actor: 'system:filing-logger',
    reason: `setFilingStatus(${status})`,
    details: { filing_status: status, ...extra },
  };
  if (event === 'status_override') payload.target_status = `FILING_${String(status).toUpperCase()}`;
  await updateCaseState(caseId, event, payload);
  // Write any non-canonical extra fields directly (e.g. filing_attempt_count, filing_error)
  const extraKeys = Object.keys(extra || {});
  if (extraKeys.length) {
    await supabaseAdmin.from('submissions').update({
      ...extra,
      updated_at: new Date().toISOString(),
    }).eq('case_id', caseId);
  }
}

module.exports = { log, logStep, logError, setFilingStatus };
