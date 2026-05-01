'use strict';

/**
 * Manual fallback handler.
 * When automation can't submit, mark the case for human review
 * and generate a "ready-to-send" pack with clear instructions.
 */

const path = require('path');
const fs = require('fs');
const { supabaseAdmin } = require('../../lib/supabase');
const { logStep } = require('../lib/logger');
const { updateCaseState } = require('../../services/state-controller');
const { buildFilingPack } = require('../lib/filing-pack-builder');
const { checkFilingGate } = require('../lib/filing-gate');
const portalUrls = require('../config/portal-urls.json');

async function markForManualSubmission(caseId, reason, details = {}) {
  const gate = await checkFilingGate(caseId);
  const { caseDir, meta } = await buildFilingPack(caseId);

  const county = (meta.county || '').toLowerCase().replace(/\s+/g, '_');
  const portal = portalUrls[county] || {};

  const instructions = {
    caseId,
    owner: meta.owner,
    property: meta.property,
    county: meta.county,
    reason,
    gate: { pass: gate.pass, blocks: gate.blocks },
    submission: {
      email:  portal.protestEmail,
      portal: portal.agentPortal,
      address: portal.address,
      phone: portal.phone,
      methods: portal.filingMethods,
    },
    documents: meta.documents,
    instructions: [
      `1. Open ${caseDir} for all filing documents`,
      `2. Preferred path: email to ${portal.protestEmail}`,
      `3. Attach: cover letter, Form 50-162 AOA, evidence packet`,
      `4. Subject: "Notice of Protest — ${meta.owner} — ${meta.property} — 2026 [Ref ${caseId}]"`,
      `5. After sending, update submissions.filed_at, filing_method="email_manual", filing_confirmation_number=<reply reference>`,
    ],
    ...details,
  };

  const instructionsPath = path.join(caseDir, `${caseId}-MANUAL-SUBMISSION-INSTRUCTIONS.json`);
  fs.writeFileSync(instructionsPath, JSON.stringify(instructions, null, 2));

  await updateCaseState(caseId, 'hold', { actor: 'system:manual-fallback' });
  await supabaseAdmin.from('submissions').update({
    needs_manual_review: true,
    review_reason: reason,
    updated_at: new Date().toISOString(),
  }).eq('case_id', caseId);

  await logStep(caseId, 'manual_fallback_prepared', 'ok', { reason, instructionsPath });

  return { caseId, status: 'MANUAL_REVIEW_REQUIRED', reason, instructionsPath, packDir: caseDir };
}

module.exports = { markForManualSubmission };
