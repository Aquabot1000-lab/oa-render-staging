/**
 * daily-summary.js
 * Once-daily roll-up for Tyler.
 *
 * Buckets:
 *   READY_TO_FILE   — packages built, awaiting filing approval
 *   BLOCKED         — CAD_BLOCKED + WRONG_DOCUMENT + SIGNED_PENDING_PDF (with reasons)
 *   NEW_SIGNATURES  — esign_tokens.signed_at within last 24h
 *   NEW_NOTICES     — case_documents.uploaded_at where file_type IN (notice/uploaded notice) within last 24h,
 *                     OR submissions.upload_status changed to 'uploaded' within last 24h
 *
 * Pure builder — does NOT send any message. Returns a structured object + a
 * formatted text body. The caller decides whether/how to deliver to Tyler.
 */
'use strict';

const { reconcileAll } = require('./state-engine');

async function buildDailySummary(supabase, { now = new Date(), windowHours = 24 } = {}) {
  const cutoffISO = new Date(now.getTime() - windowHours * 3600 * 1000).toISOString();

  // 1. Compute current state for every case (dry-run: don't write)
  const states = await reconcileAll(supabase, { dryRun: true });

  const byState = {};
  for (const r of states) {
    if (!byState[r.newStatus]) byState[r.newStatus] = [];
    byState[r.newStatus].push(r);
  }

  const readyToFile = byState['READY_TO_FILE'] || [];

  const blocked = []
    .concat((byState['CAD_BLOCKED']        || []).map(r => ({...r, bucket:'CAD_BLOCKED'})))
    .concat((byState['WRONG_DOCUMENT']     || []).map(r => ({...r, bucket:'WRONG_DOCUMENT'})))
    .concat((byState['SIGNED_PENDING_PDF'] || []).map(r => ({...r, bucket:'SIGNED_PENDING_PDF'})));

  // 2. New signatures in last 24h
  const { data: newSigs } = await supabase
    .from('esign_tokens')
    .select('case_id,signer_name,signed_at')
    .gte('signed_at', cutoffISO)
    .not('signed_at', 'is', null)
    .order('signed_at', { ascending: false });

  const newSignatures = (newSigs || [])
    .filter(s => !s.case_id.startsWith('OA-TEST'));

  // 3. New notices in last 24h
  // Strategy: any submissions where upload_status changed to a non-'none' value
  // within the window. We don't have a dedicated change-log table for upload_status,
  // so we approximate by looking at submissions.last_activity_at + upload_status.
  const { data: subsActivity } = await supabase
    .from('submissions')
    .select('case_id,owner_name,upload_status,last_activity_at,county')
    .gte('last_activity_at', cutoffISO)
    .not('upload_status', 'eq', 'none')
    .not('upload_status', 'is', null);

  const newNotices = (subsActivity || []).filter(s => !s.case_id.startsWith('OA-TEST'));

  // 4. Format
  const lines = [];
  lines.push(`📊 OverAssessed Daily Summary — ${now.toISOString().slice(0,10)}`);
  lines.push('');
  lines.push(`READY TO FILE: ${readyToFile.length}`);
  for (const r of readyToFile) lines.push(`  • ${r.case_id} — ${r.owner} (${r.county})`);

  lines.push('');
  lines.push(`BLOCKED: ${blocked.length}`);
  for (const r of blocked) lines.push(`  • ${r.case_id} [${r.bucket}] — ${r.owner} (${r.county}): ${r.reason}`);

  lines.push('');
  lines.push(`NEW SIGNATURES (last ${windowHours}h): ${newSignatures.length}`);
  for (const s of newSignatures) lines.push(`  • ${s.case_id} — ${s.signer_name} @ ${s.signed_at}`);

  lines.push('');
  lines.push(`NEW NOTICES (last ${windowHours}h): ${newNotices.length}`);
  for (const n of newNotices) lines.push(`  • ${n.case_id} — ${n.owner_name} (${n.county || '?'}): upload_status=${n.upload_status}`);

  lines.push('');
  lines.push(`(state engine v1, dry-run; no DB writes from this summary)`);

  return {
    generatedAt: now.toISOString(),
    counts: {
      readyToFile:    readyToFile.length,
      blocked:        blocked.length,
      newSignatures:  newSignatures.length,
      newNotices:     newNotices.length,
    },
    readyToFile,
    blocked,
    newSignatures,
    newNotices,
    text: lines.join('\n'),
  };
}

module.exports = { buildDailySummary };
