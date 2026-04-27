/**
 * Hunt County Execution Readiness
 *
 * Hunt CAD has no agent portal yet (confirmed 2026-04-27 by agents@hunt-cad.org).
 * Filing path: EMAIL only — submit Form 50-162 (Appointment of Agent) to agents@hunt-cad.org.
 *
 * This module:
 *   1. Watches Hunt County cases for full gate-green state
 *   2. When ready, packages 50-162 for email submission (no portal automation)
 *   3. Drops the package into a review queue (Tyler must approve before send)
 *   4. NEVER auto-submits — Hunt CAD email path is high-trust, low-volume; manual review required
 *
 * @version 1.0.0 — 2026-04-27 (Tyler directive: zero-delay readiness, no customer action, no auto-file)
 */

const HUNT_CAD_AGENT_EMAIL = 'agents@hunt-cad.org';
const HUNT_CAD_AGENT_PORTAL = null; // confirmed 2026-04-27 — not yet live
const HUNT_CAD_FILING_METHOD = 'email';
const HUNT_CAD_REGISTRATION_STATUS = 'pending_confirmation';

/**
 * Check if a case is ready for Hunt County email submission.
 * Returns { ready: boolean, missing: string[], submission_payload: ... }
 */
async function checkCaseReadiness(supabase, caseId) {
  const { data: sub, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('case_id', caseId)
    .single();
  if (error || !sub) return { ready: false, missing: ['case-not-found'], submission_payload: null };
  if ((sub.county || '').toLowerCase() !== 'hunt') {
    return { ready: false, missing: ['not-hunt-county'], submission_payload: null };
  }

  const missing = [];

  // Real signature (not legacy boolean) — esign_tokens row with sig_data > 1KB
  const { data: tokens } = await supabase
    .from('esign_tokens').select('signed_at,signature_data')
    .eq('case_id', caseId).not('signed_at', 'is', null);
  const realSig = (tokens || []).find(t => (t.signature_data || '').length > 1000);
  if (!realSig) missing.push('aoa_real_signature');

  // Generated 50-162 PDF in case_documents
  const { data: docs } = await supabase
    .from('case_documents').select('file_type,file_url,file_name')
    .eq('case_id', caseId).eq('file_type', 'signed_50_162');
  if (!docs || docs.length === 0) missing.push('signed_50_162_pdf');

  // Notice valid (formal NOAV uploaded and verified)
  if (sub.upload_status !== 'verified_notice' || !sub.notice_url) {
    missing.push('verified_notice');
  }

  if (missing.length > 0) {
    return { ready: false, missing, submission_payload: null };
  }

  // Build email submission payload (Tyler-reviewed before send)
  const payload = {
    to: HUNT_CAD_AGENT_EMAIL,
    cc: ['tyler@overassessed.ai'],
    from: 'tyler@overassessed.ai',
    subject: `Form 50-162 Appointment of Agent — ${sub.owner_name} — ${sub.property_address}`,
    body_template: 'hunt_county_50162_submission',
    case_id: caseId,
    owner_name: sub.owner_name,
    property_address: sub.property_address,
    attachments: [
      { type: 'signed_50_162', file_url: docs[0].file_url, filename: docs[0].file_name }
    ],
    review_required: true,
    auto_send: false   // HARD: never auto-send
  };

  return { ready: true, missing: [], submission_payload: payload };
}

/**
 * Sweep all Hunt County cases — return array of case states + readiness flags.
 */
async function sweepHuntCounty(supabase) {
  const { data, error } = await supabase
    .from('submissions')
    .select('case_id,owner_name,property_address,filing_status,status,upload_status,county_notice_status,agent_form_signed,fee_agreement_signed,deleted_at,archived_at')
    .ilike('county', 'hunt')
    .is('deleted_at', null);
  if (error) return { error: error.message };

  const results = [];
  for (const row of data) {
    const r = await checkCaseReadiness(supabase, row.case_id);
    results.push({
      case_id: row.case_id,
      owner: row.owner_name,
      address: row.property_address,
      filing_status: row.filing_status,
      ready: r.ready,
      missing: r.missing,
      payload: r.submission_payload
    });
  }
  return { count: results.length, results, county_method: HUNT_CAD_FILING_METHOD, agent_email: HUNT_CAD_AGENT_EMAIL };
}

/**
 * Auto-package: when AOA signature lands, generate the 50-162 PDF and stage
 * a draft email submission for Tyler review. NEVER auto-send.
 */
async function autoPackageOnSignature(supabase, caseId) {
  const { data: sub } = await supabase.from('submissions').select('*').eq('case_id', caseId).single();
  if (!sub || (sub.county || '').toLowerCase() !== 'hunt') {
    return { staged: false, reason: 'not-hunt-county' };
  }

  // Real signature gate
  const { data: tokens } = await supabase
    .from('esign_tokens').select('signed_at,signature_data')
    .eq('case_id', caseId).not('signed_at', 'is', null);
  const realSig = (tokens || []).find(t => (t.signature_data || '').length > 1000);
  if (!realSig) return { staged: false, reason: 'aoa-not-signed' };

  // Already packaged?
  const { data: existing } = await supabase
    .from('case_documents').select('id').eq('case_id', caseId).eq('file_type', 'signed_50_162');
  if (existing && existing.length > 0) {
    return { staged: false, reason: 'already-packaged', existing_doc_id: existing[0].id };
  }

  // Generate 50-162 PDF
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { generatePrefilledForm } = require('./form-50-162-generator');

  const tmpPath = path.join(os.tmpdir(), `${caseId}-50162-${Date.now()}.pdf`);
  const agentInfo = {
    company: 'OverAssessed, LLC',
    address: '6002 Camp Bullis, Suite 208',
    city: 'San Antonio',
    state: 'TX',
    zip: '78257',
    phone: '(888) 282-9165',
    email: 'info@overassessed.ai'
  };
  await generatePrefilledForm(sub, agentInfo, tmpPath);

  // Upload to Supabase storage
  const buf = fs.readFileSync(tmpPath);
  const storagePath = `forms/${caseId}/2026-50162-${Date.now()}.pdf`;
  const { error: upErr } = await supabase.storage.from('documents').upload(storagePath, buf, {
    contentType: 'application/pdf', upsert: true
  });
  if (upErr) return { staged: false, reason: 'upload-failed: ' + upErr.message };

  const { data: { publicUrl } } = supabase.storage.from('documents').getPublicUrl(storagePath);

  await supabase.from('case_documents').insert({
    case_id: caseId,
    file_name: `2026-Form-50-162-${sub.owner_name.replace(/\s+/g, '-')}.pdf`,
    file_url: publicUrl,
    file_type: 'signed_50_162',
    uploaded_by: 'aquabot-auto-package',
    notes: `Auto-generated after AOA signature for Hunt County email submission. Pending Tyler review before send to ${HUNT_CAD_AGENT_EMAIL}.`
  });

  await supabase.from('activity_log').insert({
    case_id: caseId,
    actor: 'aquabot',
    action: 'hunt_county_50162_auto_packaged',
    details: {
      county: 'Hunt',
      file_url: publicUrl,
      ready_for_submission: true,
      requires_tyler_review: true,
      submission_target: HUNT_CAD_AGENT_EMAIL
    },
    created_at: new Date().toISOString()
  });

  fs.unlinkSync(tmpPath);

  return { staged: true, file_url: publicUrl, submission_target: HUNT_CAD_AGENT_EMAIL };
}

module.exports = {
  HUNT_CAD_AGENT_EMAIL,
  HUNT_CAD_AGENT_PORTAL,
  HUNT_CAD_FILING_METHOD,
  HUNT_CAD_REGISTRATION_STATUS,
  checkCaseReadiness,
  sweepHuntCounty,
  autoPackageOnSignature
};
