/**
 * auto-trigger.js
 * Orchestrates the full automation chain by reading the current state from
 * state-engine and emitting "next-step" intents.
 *
 * Chain:
 *   notice_uploaded   → validate_notice
 *   notice_valid      → send AOA (if not already sent)
 *   signature_received→ generate signed PDF
 *   signed + valid    → trigger CAD enrichment
 *   CAD complete      → register manifest
 *   manifest registered → build package
 *   package built     → READY_TO_FILE
 *
 * Live actions (CAD enrich, send AOA, build package) are gated by
 *   process.env.OA_AUTO_TRIGGER_LIVE === 'true'
 * Otherwise this module returns the planned actions only and writes them
 * to `tasks` with status='pending_approval'. Filing is NEVER auto-triggered.
 */
'use strict';

const { computeStateForCase } = require('./state-engine');
const { resolveEngine }       = require('./county-router');
const { registerCase, isRegistered } = require('./manifest-registry');

/**
 * For one case row, decide which automation step (if any) to trigger.
 * Returns { caseId, currentState, nextStep, reason } or null.
 */
function decideNext(caseRow, signedTokens, manifestRegistry) {
  const state = caseRow.__state;
  if (!state) return null;
  const cid = caseRow.case_id;

  switch (state.state) {
    case 'WAITING_NOTICE':
      // Notice not on file or invalid — nothing to trigger here; the
      // followup-engine handles outbound nudges. Intake guard handles re-uploads.
      return null;

    case 'WRONG_DOCUMENT':
      // Wait for re-upload; intake guard will re-classify.
      return null;

    case 'WAITING_SIGNATURE':
      // Notice valid + no token yet → send AOA
      if (!signedTokens.byCase[cid]) {
        return { caseId: cid, currentState: state.state, nextStep: 'SEND_AOA',
                 reason: 'Notice valid; AOA not yet sent' };
      }
      return null;

    case 'SIGNED_PENDING_PDF':
      // Token signed but no signed_50_162 PDF → generate
      return { caseId: cid, currentState: state.state, nextStep: 'GENERATE_SIGNED_PDF',
               reason: 'Esign signed; signed PDF not yet generated' };

    case 'READY_FOR_CAD':
      // Both notice + signed PDF → enrich
      const engine = resolveEngine(caseRow.county);
      if (!engine.ready) {
        return { caseId: cid, currentState: state.state, nextStep: 'CAD_BLOCKED',
                 reason: `County '${caseRow.county}' parser ${engine.engine} not ready: ${engine.blocker || 'unsupported'}` };
      }
      return { caseId: cid, currentState: state.state, nextStep: 'TRIGGER_CAD_ENRICHMENT',
               reason: `Run ${engine.engine} for ${caseRow.county}` };

    case 'CAD_BLOCKED':
      return null; // human required

    case 'CAD_COMPLETE':
      // Manifest registered yet?
      if (!manifestRegistry.has(cid)) {
        return { caseId: cid, currentState: state.state, nextStep: 'REGISTER_MANIFEST',
                 reason: 'CAD complete; manifest not registered' };
      }
      return { caseId: cid, currentState: state.state, nextStep: 'BUILD_PACKAGE',
               reason: 'Manifest registered; build protest package' };

    case 'READY_TO_BUILD':
      return { caseId: cid, currentState: state.state, nextStep: 'BUILD_PACKAGE',
               reason: 'Enrichment + manifest ready; build protest package' };

    case 'READY_TO_FILE':
      // STOP — Tyler approves filing manually.
      return null;

    case 'FILED':
    case 'INTAKE':
    case 'OUT_OF_TX':
    default:
      return null;
  }
}

/**
 * Plan the full chain across all cases. Does NOT execute live actions;
 * writes a `tasks` row per planned step (status='pending_approval')
 * unless live=true and OA_AUTO_TRIGGER_LIVE=true.
 */
async function planAutoTriggers(supabase, { live = false, dryRun = false } = {}) {
  const liveAllowed = live && process.env.OA_AUTO_TRIGGER_LIVE === 'true';
  // Pull all cases with computed state (delegates to state-engine reconcile w/o write)
  const { reconcileAll } = require('./state-engine');
  const recon = await reconcileAll(supabase, { dryRun: true });

  // We need the original rows for county etc; reconcileAll returns transitions only,
  // so re-fetch:
  const { data: subs } = await supabase
    .from('submissions')
    .select('case_id, county, status, upload_status, notice_url, agent_form_signed, filing_data')
    .not('case_id', 'like', 'OA-TEST%');
  const stateByCase = {};
  for (const t of recon.transitions || []) stateByCase[t.case_id] = t;

  const { data: tokens } = await supabase
    .from('esign_tokens')
    .select('case_id, signed_at')
    .not('case_id', 'like', 'OA-TEST%');
  const signedTokens = { byCase: {} };
  for (const t of tokens || []) signedTokens.byCase[t.case_id] = t;

  const fs = require('fs');
  const path = require('path');
  const regPath = path.join(__dirname, '../../data/shared/case-manifest.json');
  let registry = { entries: {} };
  try { registry = JSON.parse(fs.readFileSync(regPath, 'utf8')); } catch (_) {}
  const manifestRegistry = { has: cid => !!registry.entries?.[cid] };

  const plans = [];
  for (const sub of subs || []) {
    const t = stateByCase[sub.case_id];
    if (!t) continue;
    sub.__state = { state: t.to, reason: t.reason };
    const decision = decideNext(sub, signedTokens, manifestRegistry);
    if (decision) plans.push(decision);
  }

  const summary = { planned: plans.length, byStep: {} };
  for (const p of plans) summary.byStep[p.nextStep] = (summary.byStep[p.nextStep] || 0) + 1;

  if (dryRun) return { summary, plans, executed: false };

  // Persist intents as tasks (always — even if liveAllowed, we keep audit trail)
  for (const p of plans) {
    await supabase.from('tasks').insert({
      case_id:        p.caseId,
      type:           'auto_trigger',
      title:          `Auto-trigger: ${p.nextStep}`,
      description:    `[current_state=${p.currentState} next_step=${p.nextStep}] ${p.reason}`,
      status:         liveAllowed ? 'queued' : 'pending_approval',
      priority:       'medium',
      auto_generated: true,
      due_date:       new Date().toISOString(),
    });
  }

  return { summary, plans, executed: liveAllowed };
}

module.exports = { planAutoTriggers, decideNext };
