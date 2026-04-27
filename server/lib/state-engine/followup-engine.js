/**
 * followup-engine.js
 * Auto follow-up worker.
 *
 * Day cadence (from esign_tokens.created_at OR oldest 'request-notice' communication):
 *   Day 2 → soft reminder
 *   Day 4 → second reminder
 *   Day 7 → final notice
 *
 * Stops automatically when:
 *   - esign_tokens.signed_at IS NOT NULL  (for AOA reminder track)
 *   - upload_status === 'verified_notice' (for notice reminder track)
 *
 * Storage:
 *   - Each send → row in `communications` (channel=sms|email, direction=outbound)
 *   - Each send → row in `tasks` (type='followup_reminder', status='completed', metadata.kind=day2|day4|day7)
 *   - Idempotency: before sending, check `tasks` where case_id+kind exists & completed
 *
 * IMPORTANT: this module does NOT actually call Twilio/SendGrid in the current build —
 * it writes a queued task with status='pending' awaiting Tyler approval. Per the rule
 * "do not file or send live messages without Tyler's explicit approval", we record
 * intent + body, but flip to live send only when env OA_AUTO_FOLLOWUP_LIVE=true.
 */
'use strict';

const REMINDER_RULES = [
  { kind: 'day2', minHours:  48, track: 'notice', reason: 'Day 2 — initial nudge for notice upload' },
  { kind: 'day4', minHours:  96, track: 'notice', reason: 'Day 4 — second nudge for notice upload' },
  { kind: 'day7', minHours: 168, track: 'notice', reason: 'Day 7 — final notice' },
  { kind: 'day2', minHours:  48, track: 'aoa',    reason: 'Day 2 — AOA signature reminder' },
  { kind: 'day4', minHours:  96, track: 'aoa',    reason: 'Day 4 — AOA signature reminder' },
  { kind: 'day7', minHours: 168, track: 'aoa',    reason: 'Day 7 — AOA final notice' },
];

const NOTICE_BODY = {
  day2: caseNum => `Reminder: please upload your 2026 Notice of Appraised Value so we can begin your protest. Case ${caseNum}. Reply STOP to opt out.`,
  day4: caseNum => `Friendly second reminder — we still need your 2026 appraisal notice for case ${caseNum} to file your protest. Reply STOP to opt out.`,
  day7: caseNum => `Final notice: we need your 2026 appraisal notice within 24 hours for case ${caseNum} or we cannot file your protest by the deadline. Reply STOP to opt out.`,
};
const AOA_BODY = {
  day2: caseNum => `Reminder: please sign your Authorization of Agent so we can file your protest. Case ${caseNum}. Reply STOP to opt out.`,
  day4: caseNum => `Friendly second reminder — your AOA signature is still needed for case ${caseNum}. Reply STOP to opt out.`,
  day7: caseNum => `Final notice: your AOA signature is required within 24 hours for case ${caseNum} or we cannot file your protest. Reply STOP to opt out.`,
};

function hoursSince(iso) { return (Date.now() - new Date(iso).getTime()) / 3600000; }

/**
 * Find candidate cases for follow-up.
 * Returns rows from submissions joined with esign_tokens latest signed_at.
 */
async function loadCandidates(supabase) {
  const { data: subs } = await supabase
    .from('submissions')
    .select('case_id, owner_name, phone, email, county, status, upload_status, notice_url, agent_form_signed, created_at, last_activity_at, do_not_contact, automation_excluded')
    .not('case_id', 'like', 'OA-TEST%');
  if (!subs) return [];

  const { data: tokens } = await supabase
    .from('esign_tokens')
    .select('case_id, status, signed_at, created_at')
    .not('case_id', 'like', 'OA-TEST%');
  const tokenByCase = {};
  for (const t of tokens || []) {
    const cur = tokenByCase[t.case_id];
    if (!cur || new Date(t.created_at) > new Date(cur.created_at)) tokenByCase[t.case_id] = t;
  }

  const { data: existingTasks } = await supabase
    .from('tasks')
    .select('case_id, type, title, description, status, created_at')
    .eq('type', 'followup_reminder');
  const sentByCase = {};
  for (const t of existingTasks || []) {
    // Encode kind/track in title: 'Follow-up day2 (notice)'
    const m = (t.title || '').match(/Follow-up (day\d)\s*\((notice|aoa)\)/);
    if (!m) continue;
    const k = `${t.case_id}|${m[2]}|${m[1]}`;
    sentByCase[k] = t;
  }

  return subs.map(s => ({ sub: s, token: tokenByCase[s.case_id] || null, sent: sentByCase }));
}

/**
 * Decide which reminders to fire for a single case (returns 0–N decisions).
 */
function decisionsFor({ sub, token, sent }) {
  if (sub.do_not_contact || sub.automation_excluded) return [];

  const out = [];
  const noticeStop  = sub.upload_status === 'verified_notice';
  const aoaStop     = !!(token && token.signed_at);

  for (const rule of REMINDER_RULES) {
    if (rule.track === 'notice' && noticeStop) continue;
    if (rule.track === 'aoa'    && aoaStop)    continue;

    let anchor;
    if (rule.track === 'notice') {
      anchor = sub.last_activity_at || sub.created_at;
    } else {
      if (!token) continue;
      anchor = token.created_at;
    }
    if (!anchor) continue;
    if (hoursSince(anchor) < rule.minHours) continue;

    const dedupeKey = `${sub.case_id}|${rule.track}|${rule.kind}`;
    if (sent[dedupeKey]) continue;

    out.push({
      caseId:    sub.case_id,
      ownerName: sub.owner_name,
      phone:     sub.phone,
      email:     sub.email,
      kind:      rule.kind,
      track:     rule.track,
      reason:    rule.reason,
      body:      (rule.track === 'notice' ? NOTICE_BODY : AOA_BODY)[rule.kind](sub.case_id),
      hoursOld:  Math.round(hoursSince(anchor)),
    });
  }
  return out;
}

/**
 * Run the worker. Writes queued tasks; only sends if OA_AUTO_FOLLOWUP_LIVE=true.
 */
async function runFollowupWorker(supabase, { live = false, dryRun = false } = {}) {
  const candidates = await loadCandidates(supabase);
  const decisions  = candidates.flatMap(decisionsFor);

  const summary = { evaluated: candidates.length, queued: 0, sent: 0, skipped_dryrun: 0, errors: 0, byKind: {} };

  for (const d of decisions) {
    summary.byKind[d.track + '/' + d.kind] = (summary.byKind[d.track + '/' + d.kind] || 0) + 1;

    if (dryRun) { summary.skipped_dryrun++; continue; }

    // Always record the queued task. Schema has no metadata column — encode in description.
    const taskRow = {
      case_id:        d.caseId,
      type:           'followup_reminder',
      title:          `Follow-up ${d.kind} (${d.track})`,
      description:    `[kind=${d.kind} track=${d.track} hours_old=${d.hoursOld}] ${d.body}`,
      status:         live ? 'completed' : 'pending_approval',
      priority:       d.kind === 'day7' ? 'high' : 'medium',
      auto_generated: true,
      due_date:       new Date().toISOString(),
    };
    const { error: te } = await supabase.from('tasks').insert(taskRow);
    if (te) { summary.errors++; console.error('[followup] task err:', te.message); continue; }
    summary.queued++;

    if (live) {
      // Live send path — placeholder. The real send goes through existing
      // sendClientSMS / sendgrid; we record a communications row regardless.
      try {
        await supabase.from('communications').insert({
          case_id:    d.caseId,
          direction:  'outbound',
          channel:    d.phone ? 'sms' : 'email',
          recipient:  d.phone || d.email,
          body:       d.body,
          status:     'queued',
          metadata:   { kind: d.kind, track: d.track, source: 'followup-engine' },
          subject:    d.track === 'aoa' ? `Sign your AOA — ${d.caseId}` : `Upload your notice — ${d.caseId}`,
        });
        summary.sent++;
      } catch (err) {
        summary.errors++;
        console.error('[followup] comm err:', err.message);
      }
    }
  }

  return { summary, decisions };
}

module.exports = { runFollowupWorker, decisionsFor, REMINDER_RULES };
