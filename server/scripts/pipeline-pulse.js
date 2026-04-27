#!/usr/bin/env node
/**
 * pipeline-pulse.js
 * Compare current pipeline against a saved baseline + run state engine.
 * Reports forward movement only. No writes besides reconcile commit.
 *
 * Usage:
 *   node server/scripts/pipeline-pulse.js                # diff vs /tmp/oa-pipeline-baseline.json
 *   node server/scripts/pipeline-pulse.js --no-commit    # dry-run reconcile
 *   node server/scripts/pipeline-pulse.js --rebase       # save current as new baseline
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { reconcileAll } = require('../lib/state-engine/state-engine');

const COMMIT  = !process.argv.includes('--no-commit');
const REBASE  = process.argv.includes('--rebase');
const BASELINE_PATH = '/tmp/oa-pipeline-baseline.json';

const FORWARD_RANK = {
  ARCHIVED: 0,
  INTAKE: 1, OUT_OF_TX: 1, NEEDS_REVIEW: 1,
  WAITING_NOTICE: 2,
  WRONG_DOCUMENT: 2,
  WAITING_SIGNATURE: 3,
  SIGNED_PENDING_PDF: 4,
  READY_FOR_CAD: 5,
  CAD_BLOCKED: 5,
  CAD_COMPLETE: 6,
  READY_TO_BUILD: 7,
  READY_TO_FILE: 8,
  FILED: 9,
};

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const tStart = new Date();

  // 1. Reconcile (commits state to DB)
  const recon = await reconcileAll(sb, { dryRun: !COMMIT, verbose: false });

  // 2. Pull current snapshot
  const { data: subs } = await sb.from('submissions')
    .select('case_id,owner_name,county,status,upload_status,notice_url,last_activity_at')
    .not('case_id','like','OA-TEST%').not('case_id','like','BM-%');
  const { data: tokens } = await sb.from('esign_tokens')
    .select('case_id,signed_at')
    .not('case_id','like','OA-TEST%').not('case_id','like','BM-%');
  const sigByCase = {};
  for (const t of tokens || []) if (t.signed_at) sigByCase[t.case_id] = t.signed_at;
  const { data: docs } = await sb.from('case_documents')
    .select('case_id,file_type')
    .not('case_id','like','OA-TEST%').not('case_id','like','BM-%');
  const docsByCase = {};
  for (const d of docs || []) (docsByCase[d.case_id] = docsByCase[d.case_id] || []).push(d.file_type);

  const cur = {};
  for (const s of subs || []) cur[s.case_id] = {
    owner_name:    s.owner_name,
    county:        s.county,
    status:        s.status,
    upload_status: s.upload_status || 'none',
    has_notice:    !!s.notice_url,
    signed_at:     sigByCase[s.case_id] || null,
    doc_types:     [...new Set(docsByCase[s.case_id] || [])].sort(),
    last_activity_at: s.last_activity_at,
  };

  // 3. Load baseline
  let base = { cases: {} };
  try { base = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); } catch (_) {}

  const newUploads   = [];   // upload_status changed from 'none' or null → uploaded/verified_notice
  const fixedWrong   = [];   // wrong_document → uploaded/verified_notice
  const newSignatures = [];  // signed_at changed from null → set
  const stateChanges = [];   // status changed in any direction
  const forward      = [];   // forward-rank increase
  const newReady     = [];   // now in READY_TO_FILE
  const replied      = [];   // last_activity_at moved forward (proxy for any reply)

  for (const cid of Object.keys(cur)) {
    const c = cur[cid];
    const b = base.cases?.[cid] || null;
    if (!b) continue;

    // Notice-upload movement
    const wasEmpty   = !b.has_notice && (b.upload_status === 'none' || !b.upload_status);
    const wasWrong   = b.upload_status === 'wrong_document';
    const isLoaded   = c.upload_status === 'uploaded' || c.upload_status === 'verified_notice';
    if (wasEmpty && isLoaded)  newUploads.push({ cid, owner: c.owner_name, county: c.county, upload_status: c.upload_status });
    if (wasWrong && isLoaded)  fixedWrong.push({ cid, owner: c.owner_name, county: c.county, upload_status: c.upload_status });

    // Signature movement
    if (!b.signed_at && c.signed_at) newSignatures.push({ cid, owner: c.owner_name, signed_at: c.signed_at });

    // State change
    if (b.status !== c.status) {
      stateChanges.push({ cid, owner: c.owner_name, from: b.status, to: c.status });
      const r0 = FORWARD_RANK[b.status] ?? 1;
      const r1 = FORWARD_RANK[c.status] ?? 1;
      if (r1 > r0) forward.push({ cid, owner: c.owner_name, from: b.status, to: c.status });
    }

    if (c.status === 'READY_TO_FILE') newReady.push({ cid, owner: c.owner_name, county: c.county });
    // Activity / reply proxy: last_activity_at advanced AND no explicit move (means inbound activity)
    if (b.last_activity_at && c.last_activity_at && new Date(c.last_activity_at) > new Date(b.last_activity_at)) {
      // Only show as reply if no other forward movement already counted
      if (!newUploads.find(x=>x.cid===cid) && !newSignatures.find(x=>x.cid===cid))
        replied.push({ cid, owner: c.owner_name, prev: b.last_activity_at, now: c.last_activity_at });
    }
  }

  // 4. Targeted priority cases
  const priority = ['OA-0010','OA-0022','OA-0013'].map(cid => {
    const c = cur[cid];
    if (!c) return { cid, missing: true };
    return {
      cid,
      owner:        c.owner_name,
      status:       c.status,
      upload:       c.upload_status,
      signed:       !!c.signed_at,
      doc_types:    c.doc_types,
      last_activity_at: c.last_activity_at,
    };
  });

  // 5. Currently-blocked summary
  const blockedNow = Object.entries(cur)
    .filter(([_,c]) => ['WRONG_DOCUMENT','CAD_BLOCKED'].includes(c.status))
    .map(([cid,c]) => ({ cid, owner: c.owner_name, status: c.status }));

  console.log('=== PIPELINE PULSE @', tStart.toISOString(), '===');
  console.log('reconcile:', { changed: (recon.results||[]).filter(r=>r.changed).length, total: (recon.results||[]).length, mode: COMMIT ? 'COMMIT' : 'DRY-RUN' });
  console.log('');
  console.log('FORWARD MOVEMENT since baseline');
  console.log('  new notice uploads:', newUploads.length, newUploads);
  console.log('  wrong→fixed:        ', fixedWrong.length, fixedWrong);
  console.log('  new signatures:     ', newSignatures.length, newSignatures);
  console.log('  state forward jumps:', forward.length, forward);
  console.log('  inbound replies:    ', replied.length, replied);
  console.log('  now READY_TO_FILE:  ', newReady.length, newReady);
  console.log('');
  console.log('STATE CHANGES (any direction):', stateChanges.length);
  for (const c of stateChanges) console.log('  ', c.cid, c.from, '→', c.to, '(' + c.owner + ')');
  console.log('');
  console.log('PRIORITY WATCH');
  for (const p of priority) console.log('  ', JSON.stringify(p));
  console.log('');
  console.log('STILL BLOCKED:', blockedNow.length);
  for (const b of blockedNow) console.log('  ', b.cid, b.status, '—', b.owner);

  if (REBASE) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify({ takenAt: tStart.toISOString(), cases: cur }, null, 2));
    console.log('\n✓ baseline rebased to current snapshot');
  }
})().catch(e => { console.error(e); process.exit(1); });
