/**
 * internal-team.js
 * Single source of truth for who gets internal/operator notifications
 * (Tyler-review packages, alerts, build summaries, etc.).
 *
 * Tyler directive 2026-04-27 13:41 CDT: add Uri to the notification list.
 *
 * To add/remove team members: edit TEAM below, deploy, done.
 *
 * Usage:
 *   const t = require('./internal-team');
 *   t.emails()           -> ['tyler@overassessed.ai', 'uri@uriahrealestate.com']
 *   t.phones()           -> ['+12105598725', '+12103158885']
 *   t.notifyEmail(sgClient, {subject, html, text, attachments})
 *   t.notifySms(twilioClient, {body})
 *   t.notify(sgClient, twilioClient, {subject, html, text, sms, attachments})
 */

'use strict';

const TEAM = [
  {
    name: 'Tyler Worthey',
    role: 'owner',
    email: 'tyler@overassessed.ai',
    phone: '+12105598725',
    sms_optin: true,
    email_optin: true
  },
  {
    name: 'Uri',
    role: 'admin-partner',
    email: 'uri@uriahrealestate.com', // pending mailbox at uri@overassessed.ai
    phone: '+12103158885',
    sms_optin: true,
    email_optin: true
  }
];

function members() {
  return TEAM.slice();
}

function emails() {
  return TEAM.filter(m => m.email_optin && m.email).map(m => m.email);
}

function phones() {
  return TEAM.filter(m => m.sms_optin && m.phone).map(m => m.phone);
}

/**
 * Send the same email to every opted-in team member.
 * Uses To: tyler, BCC: everyone-else so threads render naturally.
 */
async function notifyEmail(sgClient, msg) {
  if (!sgClient) throw new Error('notifyEmail requires sendgrid client');
  const list = emails();
  if (!list.length) return { skipped: true, reason: 'no team email recipients' };

  const [primary, ...rest] = list;
  const out = await sgClient.send({
    to: primary,
    bcc: rest.length ? rest.map(e => ({ email: e })) : undefined,
    from: msg.from || { email: 'team@overassessed.ai', name: 'OverAssessed Internal' },
    replyTo: msg.replyTo || 'tyler@overassessed.ai',
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    attachments: msg.attachments
  });
  return { ok: true, statusCode: out[0].statusCode, recipients: list };
}

/**
 * Send the same SMS to every opted-in team member.
 * Returns array of {to, sid|error}.
 */
async function notifySms(twilioClient, body, fromNumber) {
  if (!twilioClient) throw new Error('notifySms requires twilio client');
  const list = phones();
  if (!list.length) return { skipped: true, reason: 'no team sms recipients' };

  const from = fromNumber || process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error('TWILIO_PHONE_NUMBER env not set and no fromNumber provided');

  const results = await Promise.all(
    list.map(to =>
      twilioClient.messages.create({ to, from, body })
        .then(m => ({ to, sid: m.sid, status: m.status }))
        .catch(err => ({ to, error: err.message }))
    )
  );
  return { ok: true, results };
}

/**
 * Convenience: fire both channels.
 * sms is optional; if omitted, only email goes out.
 */
async function notify(sgClient, twilioClient, opts) {
  const out = { email: null, sms: null };
  if (sgClient && (opts.subject || opts.html || opts.text)) {
    try {
      out.email = await notifyEmail(sgClient, opts);
    } catch (err) {
      out.email = { ok: false, error: err.message };
    }
  }
  if (twilioClient && opts.sms) {
    try {
      out.sms = await notifySms(twilioClient, opts.sms);
    } catch (err) {
      out.sms = { ok: false, error: err.message };
    }
  }
  return out;
}

module.exports = {
  TEAM,
  members,
  emails,
  phones,
  notifyEmail,
  notifySms,
  notify
};
