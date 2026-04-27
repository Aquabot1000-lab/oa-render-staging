/**
 * state-engine.js
 * OverAssessed pipeline state machine.
 *
 * STATE DEFINITIONS (each case is in exactly one state):
 *
 *   INTAKE            — new submission; address/county not yet validated
 *   WAITING_NOTICE    — TX county confirmed; awaiting customer notice upload
 *   WRONG_DOCUMENT    — customer uploaded the wrong file type
 *   WAITING_SIGNATURE — valid notice on file; AOA esign token sent/pending
 *   SIGNED_PENDING_PDF— esign_tokens.signed_at set but no signed_50_162 in case_documents yet
 *   READY_FOR_CAD     — signed PDF + valid notice both confirmed; ready to enrich from CAD
 *   CAD_BLOCKED       — county parser unavailable (Cloudflare/not implemented/out-of-TX)
 *   CAD_COMPLETE      — enrichment JSON verified; ready to build protest package
 *   READY_TO_BUILD    — manifest entry registered; build queued
 *   READY_TO_FILE     — package built and verified; awaiting Tyler's filing approval
 *   FILED             — filed with appraisal district
 *
 * HARD RULES:
 *   - Do NOT build if notice invalid
 *   - Do NOT file without Tyler approval (filing_approved=true)
 *   - Do NOT use synthetic values (cad-direct only)
 *   - Do NOT trust agent_form_signed column — use esign_tokens table only
 *   - Out-of-TX + do_not_contact cases stay INTAKE (no automation)
 *
 * API:
 *   computeState(submission, esignRows, caseDocRows) → { state, reason, blockers[] }
 *   reconcileAll(supabase, opts)                     → writes pipeline_state to all live TX cases
 */
'use strict';

const path  = require('path');
const fs    = require('fs');
const { resolveEngine } = require('./county-router');

const TX_STATES = new Set([
  'TX','tx','Texas','TEXAS',null,undefined,''
]);

/**
 * Determine canonical pipeline state for a single case.
 *
 * @param {object} sub    — row from submissions (all relevant columns)
 * @param {object[]} esign — rows from esign_tokens for this case_id
 * @param {object[]} docs  — rows from case_documents for this case_id
 * @returns {{ state:string, reason:string, blockers:string[], cadEngine:string|null }}
 */
function computeState(sub, esign, docs) {
  const blockers = [];

  // ── DNC / archived / test ────────────────────────────────────────────────
  if (sub.do_not_contact) return { state: 'INTAKE', reason: 'do_not_contact=true; no automation', blockers: ['DNC flag set'], cadEngine: null };
  if (sub.archived_at)    return { state: 'INTAKE', reason: 'Case archived', blockers: ['archived'], cadEngine: null };
  if ((sub.case_id||'').startsWith('OA-TEST')) return { state: 'INTAKE', reason: 'Test case — excluded', blockers: ['test'], cadEngine: null };

  // ── Out of TX ─────────────────────────────────────────────────────────────
  const state = sub.state || '';
  const isWA  = state.toUpperCase() === 'WA' || state.toLowerCase() === 'washington';
  const isGA  = state.toUpperCase() === 'GA';
  const isCO  = state.toUpperCase() === 'CO';
  if (isWA || isGA || isCO) {
    return { state: 'INTAKE', reason: `Out of TX service area (state=${state})`, blockers: ['out_of_tx'], cadEngine: 'out_of_tx' };
  }

  // ── County detection ──────────────────────────────────────────────────────
  const county = (sub.county || '').trim();
  const { engine: cadEngine, blocker: cadBlocker, ready: cadReady } = resolveEngine(county);

  // ── FILED ─────────────────────────────────────────────────────────────────
  // Strict: require filing_submitted=true AND a confirmation number.
  // Legacy filed_at alone (set by old auto_filed jobs before we discovered notice issues)
  // is NOT trusted per directive #8 ("Do NOT trust agent_form_signed" — same rule).
  if (sub.filing_submitted === true && sub.filing_confirmation_number) {
    return { state: 'FILED', reason: `Filed with confirmation #${sub.filing_confirmation_number}`, blockers: [], cadEngine };
  }

  // (READY_TO_FILE is determined later in the waterfall, requiring real artifacts.
  //  filing_ready alone is a legacy flag and not trusted as authoritative.)

  // ── Notice check ─────────────────────────────────────────────────────────
  const uploadStatus = sub.upload_status || 'none';
  const hasValidNotice = uploadStatus === 'verified_notice';
  const hasWrongDoc    = uploadStatus === 'wrong_document';
  const hasUpload      = uploadStatus !== 'none' && uploadStatus !== '';

  // ── Signature check (from esign_tokens only — never agent_form_signed) ───
  const signedTokens = (esign || []).filter(t => t.signed_at && (t.signature_data || '').length > 1000);
  const hasSig = signedTokens.length > 0;

  // ── Signed PDF check ─────────────────────────────────────────────────────
  const hasSignedPdf = (docs || []).some(d => d.file_type === 'signed_50_162');

  // ── CAD enrichment check ─────────────────────────────────────────────────
  // Check if an enrichment JSON exists on disk for this case
  const dataRoot = path.join(__dirname, '..', '..', 'data');
  const enrichFiles = {
    fbcad:          path.join(dataRoot, 'fort-bend', `${sub.case_id}-cad-comps.json`),
    kaufman_parser: path.join(dataRoot, 'kaufman',   `${sub.case_id}-cad-comps.json`),
    collin_blocked: path.join(dataRoot, 'collin',    `${sub.case_id}-cad-comps.json`),
    bcad_pending:   path.join(dataRoot, 'bexar',     `${sub.case_id}-cad-comps.json`),
    pending:        path.join(dataRoot, county.toLowerCase().replace(/\s+/g,'-'), `${sub.case_id}-cad-comps.json`),
  };
  const enrichPath = enrichFiles[cadEngine] || enrichFiles['pending'];
  const hasEnrichment = fs.existsSync(enrichPath) && (() => {
    try {
      const j = JSON.parse(fs.readFileSync(enrichPath, 'utf8'));
      return j.subject !== null && Array.isArray(j.comps) && j.comps.length >= 5 && !j.cloudflareBlocked;
    } catch (_) { return false; }
  })();

  // ── Package built check ───────────────────────────────────────────────────
  const hasPackage = (docs || []).some(d => d.file_type === 'filing_package') ||
    (sub.filing_package_meta && sub.filing_package_meta.built === true);

  // ── State determination (waterfall) ──────────────────────────────────────

  // WRONG_DOCUMENT short-circuits everything below — customer must re-upload before
  // any signed/CAD/build work can advance. Hard rule: do NOT build if notice invalid.
  if (hasWrongDoc) {
    return {
      state: 'WRONG_DOCUMENT',
      reason: 'Uploaded document is not a Notice of Appraised Value (re-upload required)',
      blockers: ['wrong_document'],
      cadEngine
    };
  }

  if (hasPackage && hasValidNotice && hasSig && hasSignedPdf && hasEnrichment) {
    return { state: 'READY_TO_FILE', reason: 'Package built; awaiting Tyler approval', blockers: [], cadEngine };
  }

  if (hasEnrichment && hasValidNotice && hasSig && hasSignedPdf) {
    return { state: 'CAD_COMPLETE', reason: 'CAD enrichment verified; ready to build protest package', blockers: [], cadEngine };
  }

  if (hasValidNotice && hasSig && hasSignedPdf) {
    if (!cadReady) {
      return {
        state: 'CAD_BLOCKED',
        reason: `Signed + notice valid; CAD enrichment blocked: ${cadBlocker || 'engine='+cadEngine}`,
        blockers: [cadBlocker || cadEngine],
        cadEngine
      };
    }
    return { state: 'READY_FOR_CAD', reason: 'Signed PDF + valid notice confirmed; CAD enrichment queued', blockers: [], cadEngine };
  }

  if (hasSig && !hasSignedPdf) {
    return { state: 'SIGNED_PENDING_PDF', reason: 'Token signed but signed_50_162 PDF not yet materialized', blockers: ['signed_50_162 missing'], cadEngine };
  }

  if (hasValidNotice && !hasSig) {
    return { state: 'WAITING_SIGNATURE', reason: 'Valid notice on file; AOA signature pending', blockers: [], cadEngine };
  }

  if (hasUpload && !hasValidNotice && !hasWrongDoc) {
    // uploaded but status not yet classified — treat as pending validation
    return { state: 'WAITING_NOTICE', reason: `Document uploaded but upload_status='${uploadStatus}' — notice validation required`, blockers: ['unclassified upload'], cadEngine };
  }

  if (!county) {
    return { state: 'INTAKE', reason: 'No county on file; address review required', blockers: ['no county'], cadEngine: null };
  }

  // ── County out of scope but TX? Flag as not_supported ────────────────────
  if (cadEngine === 'out_of_tx') {
    return { state: 'INTAKE', reason: 'Out of TX service area', blockers: ['out_of_tx'], cadEngine };
  }

  // Default: waiting for notice
  return { state: 'WAITING_NOTICE', reason: 'No valid notice on file', blockers: ['notice_required'], cadEngine };
}

/**
 * Reconcile state for ALL live TX cases.
 * Reads all submissions + esign_tokens + case_documents from Supabase,
 * computes state for each, and updates submissions.status.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ dryRun?: boolean, verbose?: boolean }} opts
 * @returns {Promise<object[]>} array of state change records
 */
async function reconcileAll(supabase, { dryRun = false, verbose = false } = {}) {
  const { data: subs, error: e1 } = await supabase.from('submissions').select(
    'case_id,owner_name,county,state,property_address,upload_status,notice_url,agent_form_signed,fee_agreement_signed,' +
    'filing_ready,filing_submitted,filed_at,filing_approved,do_not_contact,archived_at,deleted_at,status,' +
    'filing_package_meta,upload_status,county_notice_status'
  );
  if (e1) throw new Error('reconcileAll: submissions fetch: ' + JSON.stringify(e1));

  const { data: allEsign } = await supabase.from('esign_tokens')
    .select('case_id,signed_at,signature_data,status')
    .not('signed_at', 'is', null);
  const esignMap = {};
  for (const t of (allEsign || [])) {
    (esignMap[t.case_id] = esignMap[t.case_id] || []).push(t);
  }

  const { data: allDocs } = await supabase.from('case_documents')
    .select('case_id,file_type,file_name,uploaded_at');
  const docsMap = {};
  for (const d of (allDocs || [])) {
    (docsMap[d.case_id] = docsMap[d.case_id] || []).push(d);
  }

  const results = [];
  const writes  = [];

  for (const sub of subs) {
    if (sub.deleted_at) continue;
    const esign = esignMap[sub.case_id] || [];
    const docs  = docsMap[sub.case_id]  || [];
    const { state: newState, reason, blockers, cadEngine } = computeState(sub, esign, docs);

    const changed = sub.status !== newState;
    results.push({
      case_id:   sub.case_id,
      owner:     sub.owner_name,
      county:    sub.county || '-',
      oldStatus: sub.status,
      newStatus: newState,
      changed,
      reason,
      blockers,
      cadEngine,
    });

    if (changed && !dryRun) {
      writes.push(
        supabase.from('submissions').update({ status: newState, last_activity_at: new Date().toISOString() })
          .eq('case_id', sub.case_id)
      );
      // activity log
      writes.push(
        supabase.from('activity_log').insert({
          case_id:    sub.case_id,
          actor:      'state-engine',
          action:     'state_transition',
          details: {
            from:      sub.status,
            to:        newState,
            reason,
            blockers,
            cadEngine,
            dryRun,
            engine:    'state-engine/v1',
          }
        })
      );
    }

    if (verbose || changed) {
      console.log(`[state-engine] ${sub.case_id} ${sub.status} → ${newState}${changed?'  ★':''} (${reason})`);
    }
  }

  if (!dryRun && writes.length) {
    await Promise.all(writes);
    console.log(`[state-engine] Wrote ${writes.length / 2} state updates to DB`);
  }

  // Also expose as `transitions` with normalized field names for downstream consumers
  const transitions = results.map(r => ({
    case_id:    r.case_id,
    owner_name: r.owner,
    county:     r.county,
    from:       r.oldStatus,
    to:         r.newStatus,
    reason:     r.reason,
    changed:    r.changed,
  }));
  return { results, transitions };
}

module.exports = { computeState, reconcileAll };
