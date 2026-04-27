#!/usr/bin/env node
/**
 * reconcile-states.js
 * Run the state engine across all cases.
 *
 * Usage:
 *   node server/scripts/reconcile-states.js --dry-run   # default
 *   node server/scripts/reconcile-states.js --commit    # write status updates to DB
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const { reconcileAll } = require('../lib/state-engine/state-engine');
const { buildDailySummary } = require('../lib/state-engine/daily-summary');

const COMMIT = process.argv.includes('--commit');
const SUMMARY = process.argv.includes('--summary');

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log(`[reconcile] mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);

  const results = await reconcileAll(sb, { dryRun: !COMMIT, verbose: false });

  // Summary
  const byState = {};
  for (const r of results) {
    byState[r.newStatus] = (byState[r.newStatus] || 0) + 1;
  }
  const changed = results.filter(r => r.changed);
  console.log('');
  console.log(`Total cases: ${results.length}`);
  console.log(`Changed: ${changed.length}`);
  console.log('');
  console.log('State distribution (post-reconcile):');
  for (const s of Object.keys(byState).sort()) {
    console.log(`  ${s.padEnd(22)} ${byState[s]}`);
  }
  console.log('');
  console.log('Cases with state change:');
  for (const r of changed) {
    console.log(`  ${r.case_id.padEnd(10)} ${(r.oldStatus || '(null)').padEnd(28)} → ${r.newStatus.padEnd(22)} ${r.reason}`);
  }

  if (SUMMARY) {
    console.log('');
    console.log('=== DAILY SUMMARY ===');
    const sum = await buildDailySummary(sb);
    console.log(sum.text);
  }
})().catch(e => { console.error(e); process.exit(1); });
