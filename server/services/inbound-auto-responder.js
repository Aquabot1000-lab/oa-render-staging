/**
 * inbound-auto-responder.js
 *
 * Auto-responds to inbound customer messages based on classification.
 *  - WRONG_DOCUMENT → SMS/email with exact upload instruction
 *  - DOCUMENT_RECEIVED → no auto-reply (state engine will advance; receipt
 *    confirmation already sent by /twiml/sms-incoming for MMS)
 *  - GENERAL_QUESTION → no auto-reply, send Telegram alert to Tyler so he
 *    can respond same cycle
 *  - NOTICE_NOT_RECEIVED → SMS/email "we'll check in 3 days"
 *  - SIGNATURE_PENDING → SMS/email with signing link reminder
 *
 * Design rules:
 *  - Idempotent: never send the same template to the same case within 30 minutes
 *  - Channel match: respond on the channel the customer messaged us on
 *  - DNC / opt-out aware: skips do_not_contact and sms_unusable cases
 *  - Logs every send to communications with metadata.source=auto-responder
 *  - Live-gated by env var OA_INBOUND_AUTOREPLY_LIVE=true
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TEMPLATES = {
  WRONG_DOCUMENT: ({ firstName, caseId, link }) =>
    `Hi ${firstName} — thanks, but the document you sent isn't your 2026 Notice of Appraised Value. ` +
    `That's the form your county appraisal district mails you (NOT a tax bill or 1098). ` +
    `Please upload it here: ${link}`,
  NOTICE_NOT_RECEIVED: ({ firstName, caseId, link }) =>
    `Hi ${firstName} — counties usually mail Notices of Appraised Value April–May. ` +
    `If you receive yours, upload it here: ${link} — we'll check back with you in a few days.`,
  SIGNATURE_PENDING: ({ firstName, caseId, signLink }) =>
    `Hi ${firstName} — your protest is ready, but we still need your signature on the AOA. ` +
    `Sign here: ${signLink || 'https://overassessed.ai/sign?case=' + caseId}`,
};

const EMAIL_SUBJECTS = {
  WRONG_DOCUMENT: 'We need the correct document — Notice of Appraised Value',
  NOTICE_NOT_RECEIVED: 'About your Notice of Appraised Value',
  SIGNATURE_PENDING: 'Quick signature needed for your protest',
};

const DEDUP_WINDOW_MS = 30 * 60 * 1000;

function uploadLinkFor(caseId) {
  const base = process.env.OA_PORTAL_URL || 'https://overassessed.ai';
  return `${base}/upload?case=${encodeURIComponent(caseId)}`;
}

async function alreadySentRecently(supabaseAdmin, caseId, kind) {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
  const { data } = await supabaseAdmin
    .from('communications')
    .select('id, created_at, metadata')
    .eq('case_id', caseId)
    .eq('direction', 'outbound')
    .eq('status', 'sent')
    .gte('created_at', cutoff);
  if (!data) return false;
  return data.some(c => c?.metadata?.source === 'auto-responder' && c?.metadata?.kind === kind);
}

async function sendSms({ supabaseAdmin, caseId, to, body, kind }) {
  const Twilio = require('twilio');
  const t = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const FROM = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER;

  const { data: comm, error: ce } = await supabaseAdmin.from('communications').insert({
    case_id: caseId, direction: 'outbound', channel: 'sms', recipient: to, body, status: 'queued',
    metadata: { source: 'auto-responder', kind, auto: true, sent_at: new Date().toISOString() },
  }).select().single();
  if (ce) throw new Error('communications insert failed: ' + ce.message);

  try {
    const m = await t.messages.create({ to, from: FROM, body });
    await supabaseAdmin.from('communications').update({ status: 'sent', external_id: m.sid }).eq('id', comm.id);
    return { ok: true, sid: m.sid };
  } catch (err) {
    await supabaseAdmin.from('communications').update({ status: 'failed', failure_reason: err.message }).eq('id', comm.id);
    return { ok: false, error: err.message };
  }
}

async function sendEmail({ supabaseAdmin, caseId, to, subject, html, kind }) {
  const sg = require('@sendgrid/mail');
  sg.setApiKey(process.env.SENDGRID_API_KEY);
  const from = { email: process.env.SENDGRID_FROM_EMAIL || 'team@overassessed.ai', name: 'OverAssessed' };

  const { data: comm, error: ce } = await supabaseAdmin.from('communications').insert({
    case_id: caseId, direction: 'outbound', channel: 'email', recipient: to, subject, body: html, status: 'queued',
    metadata: { source: 'auto-responder', kind, auto: true, sent_at: new Date().toISOString() },
  }).select().single();
  if (ce) throw new Error('communications insert failed: ' + ce.message);

  try {
    const r = await sg.send({ to, from, subject, html });
    await supabaseAdmin.from('communications').update({ status: 'sent' }).eq('id', comm.id);
    return { ok: true, statusCode: r[0]?.statusCode };
  } catch (err) {
    await supabaseAdmin.from('communications').update({ status: 'failed', failure_reason: err.message }).eq('id', comm.id);
    return { ok: false, error: err.message };
  }
}

function fmtUS(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return null;
}

/**
 * Auto-respond to a classified inbound message.
 * @param {Object} ctx
 *   classification: NOTICE_NOT_RECEIVED|WRONG_DOCUMENT|DOCUMENT_RECEIVED|SIGNATURE_PENDING|GENERAL_QUESTION
 *   caseId, channel ('sms'|'email'), supabaseAdmin
 * @returns {Object} action taken
 */
async function autoRespond({ classification, caseId, channel, supabaseAdmin, sendTelegramAlert }) {
  if (process.env.OA_INBOUND_AUTOREPLY_LIVE !== 'true') {
    return { skipped: true, reason: 'OA_INBOUND_AUTOREPLY_LIVE!=true' };
  }

  // Pull the customer record
  const { data: s } = await supabaseAdmin
    .from('submissions')
    .select('case_id, owner_name, email, phone, do_not_contact, archived_at, automation_excluded, sms_unusable, email_unusable')
    .eq('case_id', caseId)
    .single();
  if (!s) return { skipped: true, reason: 'case_not_found' };
  if (s.archived_at)         return { skipped: true, reason: 'archived' };
  if (s.do_not_contact)      return { skipped: true, reason: 'DNC' };
  if (s.automation_excluded) return { skipped: true, reason: 'automation_excluded' };

  const firstName = (s.owner_name || '').split(' ')[0] || 'there';
  const link = uploadLinkFor(caseId);

  // GENERAL_QUESTION + DOCUMENT_RECEIVED: do NOT auto-reply (alert Tyler instead for free-form)
  if (classification === 'GENERAL_QUESTION') {
    if (sendTelegramAlert) {
      await sendTelegramAlert(`❓ <b>QUESTION</b> from <b>${s.owner_name}</b> (${caseId}) on ${channel} — needs same-cycle response`);
    }
    return { skipped: true, reason: 'general_question_alerts_only' };
  }
  if (classification === 'DOCUMENT_RECEIVED') {
    return { skipped: true, reason: 'document_received_no_auto_reply' };
  }

  // Templated classes
  const builder = TEMPLATES[classification];
  if (!builder) return { skipped: true, reason: 'no_template_for_' + classification };

  // Idempotency
  if (await alreadySentRecently(supabaseAdmin, caseId, classification)) {
    return { skipped: true, reason: 'already_sent_within_30min' };
  }

  // Channel selection: respond where they messaged us
  if (channel === 'sms') {
    if (s.sms_unusable) return { skipped: true, reason: 'sms_unusable' };
    const to = fmtUS(s.phone);
    if (!to) return { skipped: true, reason: 'no_valid_phone' };
    const body = builder({ firstName, caseId, link });
    const r = await sendSms({ supabaseAdmin, caseId, to, body, kind: classification });
    return { acted: true, channel: 'sms', ...r };
  }

  if (channel === 'email') {
    if (s.email_unusable) return { skipped: true, reason: 'email_unusable' };
    const to = (s.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { skipped: true, reason: 'no_valid_email' };
    if (to.toLowerCase().endsWith('@overassessed.ai')) return { skipped: true, reason: 'internal_email' };
    const subject = EMAIL_SUBJECTS[classification] || 'About your protest';
    const html = `<p>Hi ${firstName} —</p><p>${builder({ firstName, caseId, link }).replace(link, `<a href="${link}">${link}</a>`)}</p><p>OverAssessed</p>`;
    const r = await sendEmail({ supabaseAdmin, caseId, to, subject, html, kind: classification });
    return { acted: true, channel: 'email', ...r };
  }

  return { skipped: true, reason: 'unknown_channel' };
}

module.exports = { autoRespond, TEMPLATES, uploadLinkFor };
