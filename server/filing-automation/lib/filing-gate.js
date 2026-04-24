'use strict';

/**
 * Control gate — runs BEFORE any filing attempt.
 * Blocks filing unless ALL conditions pass.
 */

const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../../lib/supabase');

// COUNTY FILING RULES — enforced before any filing attempt (2026-04-24)
const COUNTY_FILING_RULES = {
  kaufman:   { allowed: ['portal', 'paper_mail', 'paper_in_person'], disallowed: ['email'], portal: 'https://www.kaufmanapp.com', notes: 'KCAD does not accept email filings.' },
  bexar:     { allowed: ['portal', 'email', 'paper_mail'], disallowed: [], portal: 'https://www.bcad.org/protest', notes: 'BCAD accepts portal or email.' },
  fort_bend: { allowed: ['portal', 'email', 'paper_mail'], disallowed: [], portal: 'https://www.fbcad.org/protest', notes: 'FBCAD accepts portal or email.' },
  collin:    { allowed: ['portal', 'email', 'paper_mail'], disallowed: [], portal: 'https://www.collincad.org/protest', notes: 'CCAD accepts portal or email.' },
  harris:    { allowed: ['portal', 'email', 'paper_mail'], disallowed: [], portal: 'https://www.hcad.org/protest', notes: 'HCAD accepts portal or email.' },
  tarrant:   { allowed: ['portal', 'email', 'paper_mail'], disallowed: [], portal: 'https://www.tad.org/protest', notes: 'TAD accepts portal or email.' },
  dallas:    { allowed: ['portal', 'email', 'paper_mail'], disallowed: [], portal: 'https://www.dallascad.org/protest', notes: 'DCAD accepts portal or email.' },
};

const REQUIRED_FIELDS = [
  { key: 'county_method_valid', label: 'County filing method validated' },
  { key: 'comp_source_real',   label: 'Real comp source' },
  { key: 'data_not_blocked',   label: 'Data not blocked' },
  { key: 'savings_valid',      label: 'Savings valid' },
  { key: 'fee_agreement',      label: 'Fee agreement signed' },
  { key: 'form_50_241',        label: 'Form 50-241 / 50-162 (AOA) present' },
  { key: 'evidence_pdf',       label: 'Evidence PDF exists' },
  // RULE 1 — Property ID gate (URi Review 2026-04-24)
  { key: 'has_account_number', label: 'Account Number / GEO ID present' },
  { key: 'has_legal_desc',     label: 'Legal Description present' },
  // RULE 3 — Minimum reduction gate (URi Review 2026-04-24)
  { key: 'reduction_above_5pct', label: 'Reduction >= 5% (filing warranted)' },
];

async function checkFilingGate(caseId) {
  const { data: sub, error } = await supabaseAdmin.from('submissions').select('*').eq('case_id', caseId).single();
  if (error || !sub) return { pass: false, blocks: ['Case not found'], checks: {} };

  const cr = sub.comp_results || {};
  const county = (sub.county || '').toLowerCase().replace(/\s+/g, '_');

  // Locate 50-241 / 50-162
  const formDir = path.join(__dirname, '../../generated-forms');
  const possibleForms = [
    path.join(formDir, `form-50-162-${caseId}.pdf`),
    path.join(formDir, `form-50-241-${caseId}.pdf`),
    path.join(formDir, `aoa-${caseId}.pdf`),
  ];
  const aoaPath = possibleForms.find(p => fs.existsSync(p)) || null;

  const evidencePath = sub.evidence_packet_path;
  const evidenceExists = evidencePath && fs.existsSync(evidencePath);

  const syntheticSource = /synthetic|rentcast|estimate/i.test(cr.comp_source || '');

  // RULE 1 — Property Identification checks
  const pd = sub.property_data || {};
  const hasAccountNumber = !!(sub.geo_id || pd.geo_id || pd.pidn || pd.accountId || pd.accountNumber || cr.bcad_acct_public);
  const hasLegalDesc = !!(pd.legal || pd.legalDescription || cr.legal_description);

  // COUNTY METHOD GATE — block if method not allowed for this county
  const countyRules = COUNTY_FILING_RULES[county];
  const countyKnown = !!countyRules;
  const intendedMethod = (sub.filing_method || 'portal').replace('email_rejected','email').toLowerCase();
  const methodAllowed = countyKnown
    ? (countyRules.allowed.includes(intendedMethod) && !countyRules.disallowed.includes(intendedMethod))
    : false;

  // RULE 3 — Minimum reduction gate
  const assessedVal   = parseFloat(String(sub.assessed_value || '').replace(/[^0-9.]/g,'')) || 0;
  const recommendedVal = cr.recommendedValue || cr.corrected_total || 0;
  const reductionAmt  = assessedVal - recommendedVal;
  const reductionPct  = assessedVal > 0 ? (reductionAmt / assessedVal * 100) : 0;
  const reductionAbove5 = reductionPct >= 5;
  // Flag 5-8% range for manual review (non-blocking, surfaced in meta)
  const reductionNeedsReview = reductionPct >= 5 && reductionPct < 8;

  const checks = {
    comp_source_real:   !syntheticSource && !!cr.comp_source,
    data_not_blocked:   !cr.data_blocked,
    savings_valid:      !!cr.savings_valid && (sub.estimated_savings || 0) > 0,
    fee_agreement:      !!sub.fee_agreement_signed,
    form_50_241:        !!aoaPath,
    evidence_pdf:       !!evidenceExists,
    // RULE 1
    has_account_number: hasAccountNumber,
    has_legal_desc:     hasLegalDesc,
    // RULE 3
    reduction_above_5pct: reductionAbove5,
    // COUNTY METHOD GATE
    county_method_valid: countyKnown && methodAllowed,
  };

  const blocks = REQUIRED_FIELDS.filter(f => !checks[f.key]).map(f => f.label);
  const pass = blocks.length === 0;

  return {
    pass, blocks, checks,
    meta: {
      case_id: caseId,
      county, owner: sub.owner_name,
      comp_source: cr.comp_source,
      savings: sub.estimated_savings,
      fee_agreement_signed: sub.fee_agreement_signed,
      aoa_path: aoaPath,
      evidence_path: evidencePath,
      // RULE 3 detail
      reduction_pct: reductionPct.toFixed(1),
      reduction_needs_review: reductionNeedsReview,
      reduction_status: reductionPct < 5 ? 'NO_FILING_WARRANTED' : reductionPct < 8 ? 'MANUAL_REVIEW_REQUIRED' : 'ALLOWED',
      // COUNTY METHOD detail
      county_known: countyKnown,
      county_rules: countyKnown ? countyRules : null,
      intended_method: intendedMethod,
      method_allowed: methodAllowed,
      county_method_status: !countyKnown ? 'UNKNOWN_COUNTY_BLOCKED' : !methodAllowed ? 'FILING_METHOD_INVALID' : 'VALID',
    },
  };
}

module.exports = { checkFilingGate };
