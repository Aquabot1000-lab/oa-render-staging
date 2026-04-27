#!/usr/bin/env node
/**
 * Belt-and-suspenders monitor for OA-0010 AOA signature.
 *
 * The esign POST /submit endpoint already triggers the payment flow inline.
 * This script runs as an independent watcher in case the inline trigger fails
 * (network blip, exception, container restart). It polls esign_tokens for
 * signed_at and verifies the post-signature steps actually executed.
 *
 * Run on demand or schedule via cron every 1-2 minutes during active window.
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: tokens } = await sb.from('esign_tokens')
    .select('case_id,signed_at,signature_data,status')
    .eq('case_id', 'OA-0010')
    .not('signed_at', 'is', null);

  const real = (tokens || []).find(t => (t.signature_data || '').length > 1000);
  if (!real) {
    console.log('OA-0010: no real signature yet. Watching.');
    return;
  }

  // Real signature exists. Verify post-signature actions ran.
  const { data: logs } = await sb.from('activity_log')
    .select('action,created_at')
    .eq('case_id', 'OA-0010')
    .gte('created_at', real.signed_at);

  const actions = new Set((logs || []).map(l => l.action));
  console.log('OA-0010: signature detected at ' + real.signed_at);
  console.log('  aoa_signed_verified: ' + (actions.has('aoa_signed_verified') ? '✅' : '⛔'));
  console.log('  payment_request_sent: ' + (actions.has('payment_request_sent') ? '✅' : '⛔'));
  console.log('  post_signature_package_staged: ' + (actions.has('post_signature_package_staged') ? '✅' : '⛔'));

  if (!actions.has('payment_request_sent')) {
    console.log('\n⚠️ Payment request NOT logged after signature — fallback trigger may be needed.');
    console.log('Run: node server/scripts/oa0010-fallback-payment-trigger.js');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
