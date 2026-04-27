#!/usr/bin/env node
/**
 * run-followup-worker.js
 * Hourly worker. Wire as cron OR pm2 cron job:
 *
 *   0 * * * * cd /opt/overassessed && node server/scripts/run-followup-worker.js >> /var/log/oa-followup.log 2>&1
 *
 * Live sends require env: OA_AUTO_FOLLOWUP_LIVE=true
 *   - Default: queue only (status='pending_approval' in tasks table)
 *   - Live:    also writes to communications table (queued for delivery)
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const { runFollowupWorker } = require('../lib/state-engine/followup-engine');

const LIVE = process.env.OA_AUTO_FOLLOWUP_LIVE === 'true';

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const t0 = Date.now();
  console.log(`[followup-worker] start mode=${LIVE ? 'LIVE' : 'QUEUE-ONLY'} ${new Date().toISOString()}`);
  const r = await runFollowupWorker(sb, { live: LIVE });
  console.log(`[followup-worker] done in ${Date.now()-t0}ms summary:`, r.summary);
})().catch(e => { console.error('[followup-worker] error:', e); process.exit(1); });
