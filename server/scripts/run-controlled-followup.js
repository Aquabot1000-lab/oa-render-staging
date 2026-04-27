#!/usr/bin/env node
/**
 * run-controlled-followup.js
 * One-shot, scope-locked live follow-up.
 *
 * Tyler approval 2026-04-27 07:00 CDT — scope:
 *   - WRONG_DOCUMENT: OA-0022, OA-0025, OA-0084 (re-upload request)
 *   - WAITING_NOTICE cases that have:
 *       * valid email OR valid US phone
 *       * NOT do_not_contact
 *       * NOT automation_excluded
 *       * NOT archived
 *       * NOT TEST
 *       * NOT out-of-TX (state IS NULL or state = 'TX')
 *
 * For each contacted case: writes one outbound communications row with status='queued',
 * channel preferred = sms if phone present, else email.
 *
 * Uses real Twilio + SendGrid via existing services.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const WRONG_DOC_TARGETS = ['OA-0022', 'OA-0025', 'OA-0084'];

const NOTICE_REUPLOAD_SMS  = caseNum =>
  `Hi from OverAssessed — the file you sent for case ${caseNum} isn't your 2026 Notice of Appraised Value. Could you reply with a photo/PDF of the official mailed notice from your appraisal district? Reply STOP to opt out.`;
const NOTICE_REUPLOAD_EMAIL_SUBJECT = caseNum => `Action needed: re-upload your Notice of Appraised Value (${caseNum})`;
const NOTICE_REUPLOAD_EMAIL_BODY = caseNum => `
<p>Hi —</p>
<p>The document you uploaded for case <strong>${caseNum}</strong> isn't your 2026 Texas Notice of Appraised Value.</p>
<p>Please reply with a photo or PDF of the official mailed notice from your county appraisal district so we can move forward with your protest.</p>
<p>Thanks,<br/>OverAssessed</p>`;

const WAITING_NOTICE_SMS = caseNum =>
  `Hi from OverAssessed — to file your 2026 protest (case ${caseNum}) we still need your Notice of Appraised Value. Could you upload it today? Reply STOP to opt out.`;
const WAITING_NOTICE_EMAIL_SUBJECT = caseNum => `Please upload your 2026 Notice of Appraised Value (${caseNum})`;
const WAITING_NOTICE_EMAIL_BODY = caseNum => `
<p>Hi —</p>
<p>To file your 2026 property tax protest for case <strong>${caseNum}</strong>, we still need your Notice of Appraised Value.</p>
<p>Reply to this email with a photo or PDF of the notice you received in the mail from your county appraisal district.</p>
<p>Thanks,<br/>OverAssessed</p>`;

function isValidEmail(e) {
  return !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}
function isValidUSPhone(p) {
  if (!p) return false;
  const d = p.replace(/\D/g,'');
  return d.length === 10 || (d.length === 11 && d[0] === '1');
}

async function loadCases(sb) {
  // WRONG_DOCUMENT — by explicit case_id
  const { data: wd } = await sb.from('submissions')
    .select('case_id, owner_name, phone, email, county, state, status, upload_status, archived_at, do_not_contact, automation_excluded')
    .in('case_id', WRONG_DOC_TARGETS);

  // WAITING_NOTICE — broader query, filter in code
  const { data: all } = await sb.from('submissions')
    .select('case_id, owner_name, phone, email, county, state, status, upload_status, archived_at, do_not_contact, automation_excluded, notice_url')
    .not('case_id', 'like', 'OA-TEST%')
    .not('case_id', 'like', 'BM-%');
  const wn = (all || []).filter(s =>
    s.status === 'WAITING_NOTICE'                    &&
    !s.archived_at                                    &&
    !s.do_not_contact                                 &&
    !s.automation_excluded                            &&
    (!s.state || (s.state || '').toUpperCase() === 'TX') &&
    s.upload_status !== 'verified_notice'
  );

  return { wrongDocument: wd || [], waitingNotice: wn };
}

function classify(sub, kind) {
  const skipReasons = [];
  if (sub.archived_at)                                          skipReasons.push('archived');
  if (sub.do_not_contact)                                       skipReasons.push('do_not_contact');
  if (sub.automation_excluded)                                  skipReasons.push('automation_excluded');
  if (sub.state && sub.state.toUpperCase() !== 'TX')            skipReasons.push(`out_of_tx(${sub.state})`);
  if ((sub.case_id || '').startsWith('OA-TEST'))                skipReasons.push('test_case');

  const phoneOk = isValidUSPhone(sub.phone);
  const emailOk = isValidEmail(sub.email);
  if (!phoneOk && !emailOk)                                     skipReasons.push('no_valid_contact');

  if (skipReasons.length) return { send: false, reason: skipReasons.join('+') };

  const channel = phoneOk ? 'sms' : 'email';
  return { send: true, channel, kind };
}

async function send(sb, sub, plan) {
  const caseNum = sub.case_id;

  // Resolve message
  let body, subject = null;
  if (plan.kind === 'wrong_doc') {
    if (plan.channel === 'sms')   body = NOTICE_REUPLOAD_SMS(caseNum);
    else { body = NOTICE_REUPLOAD_EMAIL_BODY(caseNum); subject = NOTICE_REUPLOAD_EMAIL_SUBJECT(caseNum); }
  } else {
    if (plan.channel === 'sms')   body = WAITING_NOTICE_SMS(caseNum);
    else { body = WAITING_NOTICE_EMAIL_BODY(caseNum); subject = WAITING_NOTICE_EMAIL_SUBJECT(caseNum); }
  }

  const recipient = plan.channel === 'sms' ? sub.phone : sub.email;

  // Insert communications row first (audit trail)
  const { data: comm, error: commErr } = await sb.from('communications').insert({
    case_id:    caseNum,
    direction:  'outbound',
    channel:    plan.channel,
    recipient,
    subject,
    body,
    status:     'queued',
    metadata:   { source: 'controlled-followup', kind: plan.kind, approved_by: 'tyler', approved_at: '2026-04-27T12:00:00Z' },
  }).select().single();
  if (commErr) return { ok: false, error: commErr.message };

  // Actually send
  try {
    if (plan.channel === 'sms') {
      const { sendClientSMS } = require('../server.js'); // not exported — use direct twilio
      throw new Error('using_twilio_direct');
    }
  } catch (_) {}

  // Direct send paths
  try {
    if (plan.channel === 'sms') {
      const twilio = require('twilio');
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const from   = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER;
      const digits = sub.phone.replace(/\D/g,'');
      const to     = '+' + (digits.length === 11 && digits[0] === '1' ? digits : '1' + digits);
      const msg = await client.messages.create({ from, to, body });
      await sb.from('communications').update({ status: 'sent', twilio_sid: msg.sid }).eq('id', comm.id);
      return { ok: true, sid: msg.sid, channel: 'sms', to };
    } else {
      const sg = require('@sendgrid/mail');
      sg.setApiKey(process.env.SENDGRID_API_KEY);
      const r = await sg.send({
        to: sub.email,
        from: { email: process.env.SENDGRID_FROM_EMAIL || process.env.SENDGRID_FROM || 'team@overassessed.ai', name: 'OverAssessed' },
        subject,
        html: body,
      });
      await sb.from('communications').update({ status: 'sent' }).eq('id', comm.id);
      return { ok: true, channel: 'email', to: sub.email, status: r[0]?.statusCode };
    }
  } catch (err) {
    await sb.from('communications').update({ status: 'failed', failure_reason: err.message }).eq('id', comm.id);
    return { ok: false, error: err.message, channel: plan.channel };
  }
}

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { wrongDocument, waitingNotice } = await loadCases(sb);

  const results = { sent: [], skipped: [], errors: [] };

  for (const sub of wrongDocument) {
    const plan = classify(sub, 'wrong_doc');
    if (!plan.send) { results.skipped.push({ caseId: sub.case_id, reason: plan.reason }); continue; }
    const r = await send(sb, sub, plan);
    if (r.ok) results.sent.push({ caseId: sub.case_id, owner: sub.owner_name, channel: plan.channel, to: r.to, kind: 'wrong_doc' });
    else      results.errors.push({ caseId: sub.case_id, error: r.error, channel: plan.channel });
  }

  for (const sub of waitingNotice) {
    const plan = classify(sub, 'waiting_notice');
    if (!plan.send) { results.skipped.push({ caseId: sub.case_id, reason: plan.reason }); continue; }
    const r = await send(sb, sub, plan);
    if (r.ok) results.sent.push({ caseId: sub.case_id, owner: sub.owner_name, channel: plan.channel, to: r.to, kind: 'waiting_notice' });
    else      results.errors.push({ caseId: sub.case_id, error: r.error, channel: plan.channel });
  }

  console.log(JSON.stringify({
    summary: {
      wrongDocumentEvaluated: wrongDocument.length,
      waitingNoticeEvaluated: waitingNotice.length,
      sent:    results.sent.length,
      skipped: results.skipped.length,
      errors:  results.errors.length,
    },
    results,
  }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
