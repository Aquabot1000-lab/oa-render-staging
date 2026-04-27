/**
 * approval-pipeline.js
 * Tyler directive 2026-04-27 10:53 CDT — APPROVAL PIPELINE.
 *
 * Single entry point: maybeBuildForReview(caseId)
 *
 * Hard gates (ALL must be true before any package is generated):
 *   1. notice_valid       = true  (county_notice_status === 'received' AND upload_status === 'verified_notice' AND notice_url present)
 *   2. aoa_signed         = true  (esign_tokens row with signed_at NOT NULL AND length(signature_data) > 1000)
 *   3. signed_50_162_pdf  = true  (case_documents row with doc_type='signed_50_162')
 *   4. cad_verified       = true  (verified_analysis.data_source === 'local-cad-bulk' OR 'cad-direct' AND comp_count >= 5)
 *   5. analysis_fresh     = true  (analysis_status NOT IN ('analysis_stale_pending_recomp','DATA_INVALID','DATA_BLOCKED') AND analysis_tier !== 'STALE' AND !savings_deprecated)
 *
 * On all-pass:
 *   - Generate package via taxnet-package-generator.generateTaxNetPackage()
 *   - Store PDF in /server/filing-packages/<case>-Filing-Package.pdf
 *   - Set submissions.filing_status = 'READY_FOR_TYLER_REVIEW'
 *   - Email PDF to tyler@overassessed.ai ONLY (no customer)
 *   - Log activity_log: 'package_built_for_tyler_review'
 *
 * On any-fail:
 *   - DO NOT build, DO NOT email
 *   - Return { ok:false, gates:{...}, blockers:[...] }
 *   - Log activity_log: 'build_blocked_by_gate' with reasons
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const FILING_DIR = path.join(__dirname, '..', 'filing-packages');
if (!fs.existsSync(FILING_DIR)) fs.mkdirSync(FILING_DIR, { recursive: true });

function sb() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — load .env before requiring approval-pipeline');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Evaluate all 5 gates for a case. Read-only. No side effects.
 * @returns {Promise<{ok:boolean, gates:object, blockers:string[], snapshot:object}>}
 */
async function evaluateGates(caseId) {
  const client = sb();

  const { data: sub, error: subErr } = await client
    .from('submissions')
    .select('case_id, owner_name, county, upload_status, county_notice_status, notice_url, analysis_status, analysis_tier, savings_deprecated, comp_results, verified_analysis, fee_agreement_signed, agent_form_signed')
    .eq('case_id', caseId).single();
  if (subErr || !sub) {
    return { ok: false, gates: {}, blockers: ['case not found in submissions'], snapshot: null };
  }

  // Gate 1: notice_valid
  const notice_valid = (
    sub.county_notice_status === 'received' &&
    sub.upload_status === 'verified_notice' &&
    !!sub.notice_url
  );

  // Gate 2: aoa_signed (real signature, not legacy boolean)
  const { data: tokens } = await client
    .from('esign_tokens')
    .select('signed_at, signature_data')
    .eq('case_id', caseId)
    .not('signed_at', 'is', null);
  const realSig = (tokens || []).find(t => (t.signature_data || '').length > 1000);
  const aoa_signed = !!realSig;

  // Gate 3: signed_50_162 PDF exists in case_documents
  const { data: docs } = await client
    .from('case_documents')
    .select('doc_type, file_url')
    .eq('case_id', caseId)
    .eq('doc_type', 'signed_50_162');
  const signed_50_162_pdf = (docs || []).length > 0;

  // Gate 4: cad_verified
  const va = sub.verified_analysis || {};
  const validSources = new Set(['local-cad-bulk', 'cad-direct']);
  const cad_verified = (
    validSources.has(va.data_source) &&
    (va.comp_count || 0) >= 5
  );

  // Gate 5: analysis_fresh
  const staleStatuses = new Set(['analysis_stale_pending_recomp', 'DATA_INVALID', 'DATA_BLOCKED']);
  const analysis_fresh = (
    !staleStatuses.has(sub.analysis_status) &&
    sub.analysis_tier !== 'STALE' &&
    !sub.savings_deprecated
  );

  const gates = { notice_valid, aoa_signed, signed_50_162_pdf, cad_verified, analysis_fresh };
  const blockers = [];
  if (!notice_valid)       blockers.push(`notice_valid=false (notice_status=${sub.county_notice_status}, upload=${sub.upload_status}, has_url=${!!sub.notice_url})`);
  if (!aoa_signed)         blockers.push(`aoa_signed=false (no esign_token with signed_at AND signature_data>1000)`);
  if (!signed_50_162_pdf)  blockers.push(`signed_50_162_pdf=false (no case_documents row with doc_type=signed_50_162)`);
  if (!cad_verified)       blockers.push(`cad_verified=false (data_source=${va.data_source}, comp_count=${va.comp_count || 0})`);
  if (!analysis_fresh)     blockers.push(`analysis_fresh=false (status=${sub.analysis_status}, tier=${sub.analysis_tier}, deprecated=${sub.savings_deprecated})`);

  return {
    ok: blockers.length === 0,
    gates,
    blockers,
    snapshot: {
      case_id: sub.case_id,
      owner_name: sub.owner_name,
      county: sub.county,
      analysis_status: sub.analysis_status,
      analysis_tier: sub.analysis_tier
    }
  };
}

/**
 * If all gates pass: build, store, email Tyler, log, set status.
 * If any gate fails: log block, return { ok:false, gates, blockers }.
 *
 * @param {string} caseId
 * @param {object} opts - { dryRun: bool, actor: string }
 * @returns {Promise<{ok:boolean, gates:object, blockers:string[], pdfPath?:string, emailStatus?:number, status?:string}>}
 */
async function maybeBuildForReview(caseId, opts = {}) {
  const { dryRun = false, actor = 'system' } = opts;
  const client = sb();
  const result = await evaluateGates(caseId);

  // Always log the gate evaluation
  await client.from('activity_log').insert({
    case_id: caseId,
    actor,
    action: result.ok ? 'gates_passed_build_authorized' : 'build_blocked_by_gate',
    details: { gates: result.gates, blockers: result.blockers, dryRun },
    created_at: new Date().toISOString()
  });

  if (!result.ok) {
    return result;
  }
  if (dryRun) {
    return { ...result, status: 'DRY_RUN_PASSED' };
  }

  // ALL GATES PASSED — build the package
  const { generateTaxNetPackage } = require('./taxnet-package-generator');

  // Pull full case data for renderer
  const { data: full } = await client
    .from('submissions')
    .select('*')
    .eq('case_id', caseId).single();

  // Build via existing generator (which honors quarantine via assertAnalysisFresh upstream too)
  let buildOut;
  try {
    buildOut = await generateTaxNetPackage(full);
  } catch (err) {
    await client.from('activity_log').insert({
      case_id: caseId,
      actor,
      action: 'build_failed_after_gates_passed',
      details: { error: err.message, code: err.code || null },
      created_at: new Date().toISOString()
    });
    return { ok: false, gates: result.gates, blockers: ['build threw: ' + err.message] };
  }

  const pdfPath = buildOut?.pdfPath || path.join(FILING_DIR, `${caseId}-Filing-Package.pdf`);

  // Mark case as READY_FOR_TYLER_REVIEW
  await client.from('submissions').update({
    filing_status: 'READY_FOR_TYLER_REVIEW',
    status: 'READY_FOR_TYLER_REVIEW',
    last_activity_at: new Date().toISOString()
  }).eq('case_id', caseId);

  // Email internal team ONLY (Tyler + Uri — no customer)
  let emailStatus = null;
  let emailRecipients = null;
  try {
    const sg = require('@sendgrid/mail');
    sg.setApiKey(process.env.SENDGRID_API_KEY);
    const team = require('./internal-team');
    const pdfB64 = fs.readFileSync(pdfPath).toString('base64');
    const r = await team.notifyEmail(sg, {
      subject: `[Internal Review] ${caseId} — ${result.snapshot.owner_name} — package ready`,
      html: buildReviewEmailHtml(result.snapshot, result.gates),
      text: buildReviewEmailText(result.snapshot, result.gates),
      attachments: [{
        content: pdfB64,
        filename: `${caseId}-Filing-Package.pdf`,
        type: 'application/pdf',
        disposition: 'attachment'
      }]
    });
    emailStatus = r.statusCode;
    emailRecipients = r.recipients;
  } catch (err) {
    // Email failure is logged but doesn't undo the build
    await client.from('activity_log').insert({
      case_id: caseId, actor,
      action: 'review_email_failed',
      details: { error: err.message, pdfPath },
      created_at: new Date().toISOString()
    });
  }

  await client.from('activity_log').insert({
    case_id: caseId, actor,
    action: 'package_built_for_tyler_review',
    details: { pdfPath, emailStatus, emailRecipients, gates: result.gates, customer_notified: false },
    created_at: new Date().toISOString()
  });

  return {
    ok: true,
    gates: result.gates,
    blockers: [],
    pdfPath,
    emailStatus,
    emailRecipients,
    status: 'READY_FOR_TYLER_REVIEW'
  };
}

function buildReviewEmailHtml(snap, gates) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;color:#0d1117;line-height:1.55">
    <div style="background:#dafbe1;border:1px solid #1a7f37;color:#1a7f37;padding:10px 14px;border-radius:6px;margin-bottom:18px;font-size:13px;font-weight:600">
      ✓ ALL GATES PASSED — Package built and ready for your review.
    </div>
    <h2 style="margin:0 0 10px">${snap.case_id} — ${snap.owner_name}</h2>
    <table style="font-size:13px;border-collapse:collapse;margin-bottom:14px">
      <tr><td style="padding:3px 14px 3px 0;color:#666">County</td><td>${snap.county}</td></tr>
      <tr><td style="padding:3px 14px 3px 0;color:#666">Status</td><td>READY_FOR_TYLER_REVIEW</td></tr>
    </table>
    <h3 style="margin:18px 0 6px;font-size:14px">Gates passed</h3>
    <ul style="font-size:13px;padding-left:20px;margin:0 0 14px">
      <li>notice_valid ✓</li>
      <li>aoa_signed (real sig &gt;1KB) ✓</li>
      <li>signed_50_162 PDF present ✓</li>
      <li>cad_verified (≥5 verified comps) ✓</li>
      <li>analysis_fresh (not stale, not deprecated) ✓</li>
    </ul>
    <p style="font-size:13px;color:#444">PDF attached. Customer was NOT notified. No filing has occurred. Awaiting your review and explicit go-ahead before any further action.</p>
    <p style="font-size:12px;color:#666;margin-top:18px">Internal documentation · OverAssessed LLC · Approval Pipeline</p>
  </div>`;
}

function buildReviewEmailText(snap, _gates) {
  return `[Tyler Review] ${snap.case_id} — ${snap.owner_name}

ALL GATES PASSED. Package built and ready for your review.

County: ${snap.county}
Status: READY_FOR_TYLER_REVIEW

Gates: notice_valid ✓ · aoa_signed ✓ · signed_50_162 ✓ · cad_verified ✓ · analysis_fresh ✓

PDF attached. Customer NOT notified. No filing performed.
Awaiting explicit go-ahead before any further action.`;
}

/**
 * Sweep all open cases in a single batched pass. Builds only on all-pass.
 * Skips: automation_excluded, READY_FOR_TYLER_REVIEW already, FILED, BM-* bulk placeholders.
 * Batches all Supabase queries to avoid N×3 round-trips.
 *
 * @returns {Promise<{evaluated:number, built:number, blocked:number, results:Array}>}
 */
async function sweepAll(opts = {}) {
  const { dryRun = false, actor = 'approval-pipeline-sweep' } = opts;
  const client = sb();

  const skipFilingStatuses = new Set(['READY_FOR_TYLER_REVIEW', 'filed', 'FILED']);
  const staleStatuses = new Set(['analysis_stale_pending_recomp', 'DATA_INVALID', 'DATA_BLOCKED']);
  const validSources = new Set(['local-cad-bulk', 'cad-direct']);

  // --- Batch fetch everything needed ---
  const [subsRes, tokensRes, docsRes] = await Promise.all([
    client.from('submissions').select(
      'case_id, owner_name, county, automation_excluded, filing_status, status, ' +
      'upload_status, county_notice_status, notice_url, ' +
      'analysis_status, analysis_tier, savings_deprecated, verified_analysis'
    ).order('case_id'),
    client.from('esign_tokens').select('case_id, signed_at, signature_data').not('signed_at', 'is', null),
    client.from('case_documents').select('case_id, doc_type').eq('doc_type', 'signed_50_162')
  ]);

  const subs = (subsRes.data || []);

  // Index tokens by case_id
  const tokensByCaseId = {};
  for (const t of (tokensRes.data || [])) {
    if (!tokensByCaseId[t.case_id]) tokensByCaseId[t.case_id] = [];
    tokensByCaseId[t.case_id].push(t);
  }

  // Index docs by case_id
  const docsByCaseId = {};
  for (const d of (docsRes.data || [])) {
    docsByCaseId[d.case_id] = true;
  }

  const results = [];
  for (const sub of subs) {
    // Skip BM bulk test cases
    if (sub.case_id.startsWith('BM-')) continue;
    if (sub.automation_excluded) continue;
    if (skipFilingStatuses.has(sub.filing_status)) continue;

    // Evaluate gates inline (no extra DB calls)
    const notice_valid = (
      sub.county_notice_status === 'received' &&
      sub.upload_status === 'verified_notice' &&
      !!sub.notice_url
    );

    const tokens = tokensByCaseId[sub.case_id] || [];
    const aoa_signed = tokens.some(t => (t.signature_data || '').length > 1000);

    const signed_50_162_pdf = !!docsByCaseId[sub.case_id];

    const va = sub.verified_analysis || {};
    const cad_verified = validSources.has(va.data_source) && (va.comp_count || 0) >= 5;

    const analysis_fresh = (
      !staleStatuses.has(sub.analysis_status) &&
      sub.analysis_tier !== 'STALE' &&
      !sub.savings_deprecated
    );

    const gates = { notice_valid, aoa_signed, signed_50_162_pdf, cad_verified, analysis_fresh };
    const blockers = [];
    if (!notice_valid)      blockers.push(`notice_valid=false (notice_status=${sub.county_notice_status}, upload=${sub.upload_status}, has_url=${!!sub.notice_url})`);
    if (!aoa_signed)        blockers.push(`aoa_signed=false (tokens with real sig: ${tokens.filter(t=>(t.signature_data||'').length>1000).length})`);
    if (!signed_50_162_pdf) blockers.push(`signed_50_162_pdf=false`);
    if (!cad_verified)      blockers.push(`cad_verified=false (source=${va.data_source||'none'}, comps=${va.comp_count||0})`);
    if (!analysis_fresh)    blockers.push(`analysis_fresh=false (${sub.analysis_status} / ${sub.analysis_tier})`);

    if (blockers.length === 0 && !dryRun) {
      const r = await maybeBuildForReview(sub.case_id, { dryRun: false, actor });
      results.push({ case_id: sub.case_id, ok: r.ok, blockers: r.blockers, gates, status: r.status });
    } else {
      // Log block (or dry-run pass) without extra DB call
      await client.from('activity_log').insert({
        case_id: sub.case_id, actor,
        action: blockers.length ? 'build_blocked_by_gate' : 'gates_passed_build_authorized',
        details: { gates, blockers, dryRun },
        created_at: new Date().toISOString()
      });
      results.push({ case_id: sub.case_id, ok: blockers.length === 0, blockers, gates, status: dryRun && !blockers.length ? 'DRY_RUN_PASSED' : undefined });
    }
  }

  const built = results.filter(r => r.ok).length;
  const blocked = results.filter(r => !r.ok).length;
  return { evaluated: results.length, built, blocked, results };
}

module.exports = {
  evaluateGates,
  maybeBuildForReview,
  sweepAll
};
