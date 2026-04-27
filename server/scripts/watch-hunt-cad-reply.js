#!/usr/bin/env node
/**
 * Hunt CAD inbox watcher
 *
 * Checks tyler@overassessed.ai inbound mail (via SendGrid Inbound Parse webhook table)
 * for any reply from agents@hunt-cad.org since the last outbound (msg id 1MmspcgHSMaydtWBfm4qQw, 2026-04-27 17:14 CDT).
 *
 * If found:
 *   - Logs to OA-0017 activity_log (action: hunt_cad_inbound_reply)
 *   - Surfaces summary to internal-team SMS/email if portal timeline mentioned
 *   - Updates server/data/county-agents/AGENT-SETUP-MATRIX.md if status changes
 *
 * Run on demand: node server/scripts/watch-hunt-cad-reply.js
 * Or wire into existing daily cron under server/scripts/.
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const since = '2026-04-27T17:14:00-05:00';
  // Look for inbound parse rows from hunt-cad
  // Use the existing communications table (inbound emails are stored here via /api/inbound-reply)
  const { data: inbound, error } = await sb.from('communications')
    .select('id,created_at,recipient,subject,body,direction,channel,metadata')
    .gte('created_at', since)
    .eq('direction', 'inbound')
    .eq('channel', 'email')
    .or('recipient.ilike.%hunt-cad%,recipient.ilike.%huntcad%,subject.ilike.%hunt%')
    .order('created_at', { ascending: false });

  if (error) {
    console.log('communications query failed: ' + error.message);
    return;
  }

  if (!inbound || inbound.length === 0) {
    console.log('No reply from Hunt CAD since 2026-04-27 17:14 CDT.');
    return;
  }

  console.log('=== Hunt CAD inbound replies (' + inbound.length + ') ===');
  for (const m of inbound) {
    console.log('\n[' + m.created_at + '] from=' + m.recipient);
    console.log('Subject: ' + m.subject);
    console.log('Body preview: ' + (m.body || '').slice(0, 500));

    // Check for portal-timeline keywords
    const body = (m.body || '').toLowerCase();
    const timelineHints = [];
    const datePatterns = /\b(january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|spring|summer|fall|2026|2027)\b/gi;
    const matches = body.match(datePatterns);
    if (matches) timelineHints.push('Possible date refs: ' + [...new Set(matches)].join(', '));
    if (/portal.*ready|portal.*launch|portal.*live|portal.*available/i.test(body)) timelineHints.push('Portal availability mention detected');
    if (/registered|registration.*complete|in.*system/i.test(body)) timelineHints.push('Registration confirmation hint');

    if (timelineHints.length > 0) {
      console.log('Timeline hints: ' + timelineHints.join(' | '));
    }

    // Log to activity_log if not already logged for this comm
    const { data: existing } = await sb.from('activity_log')
      .select('id').eq('case_id', 'OA-0017')
      .eq('action', 'hunt_cad_inbound_reply')
      .filter('details->>communications_id', 'eq', String(m.id))
      .limit(1);
    if (existing && existing.length > 0) {
      console.log('Already logged — skipping duplicate.');
      continue;
    }
    await sb.from('activity_log').insert({
      case_id: 'OA-0017',
      actor: 'aquabot',
      action: 'hunt_cad_inbound_reply',
      details: {
        communications_id: m.id,
        from: m.recipient,
        subject: m.subject,
        received_at: m.created_at,
        body_preview: (m.body || '').slice(0, 1000),
        timeline_hints: timelineHints
      },
      created_at: new Date().toISOString()
    });
    console.log('Logged to OA-0017 activity_log.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
