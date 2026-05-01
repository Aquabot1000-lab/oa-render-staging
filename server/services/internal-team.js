/**
 * internal-team.js
 * Single source of truth for internal/operator notifications.
 *
 * Tyler directive 2026-04-27 13:41 CDT: add Uri to the notification list.
 * Tyler directive 2026-04-30 20:59 CDT: unify ALL notification paths through this module
 *   (email + SMS + Telegram), kill direct sendNotificationEmail/SMS/Telegram callers.
 *
 * To add/remove team members or override env, edit TEAM below.
 *
 * Telegram chat IDs are set via env (TYLER_TELEGRAM_CHAT_ID, URI_TELEGRAM_CHAT_ID)
 * with hardcoded defaults for Tyler. Uri's chat ID stays empty until he DMs the bot;
 * the helper script `scripts/capture-telegram-chat-id.js` can capture it.
 *
 * Usage:
 *   const t = require('./internal-team');
 *   await t.notifyEmail(sgClient, { subject, html, text, attachments });
 *   await t.notifySms(twilioClient, body);
 *   await t.notifyTelegram(body, { html: true });
 *   await t.notifyAll({ sgClient, twilioClient, subject, html, text, sms, telegram });
 */

'use strict';

const TEAM = [
  {
    name: 'Tyler Worthey',
    role: 'owner',
    email: 'tyler@overassessed.ai',
    phone: process.env.TYLER_PHONE || process.env.NOTIFY_PHONE || '+12105598725',
    telegram_chat_id: process.env.TYLER_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '8568734697',
    sms_optin: true,
    email_optin: true,
    telegram_optin: true,
    primary: true
  },
  {
    name: 'Uri',
    role: 'admin-partner',
    email: process.env.URI_EMAIL || 'uri@uriahrealestate.com',
    phone: process.env.URI_PHONE || '+12103158885',
    telegram_chat_id: process.env.URI_TELEGRAM_CHAT_ID || '', // empty until Uri DMs bot
    sms_optin: true,
    email_optin: true,
    telegram_optin: true,
    primary: false
  }
];

function members() { return TEAM.slice(); }
function emails() { return TEAM.filter(m => m.email_optin && m.email).map(m => m.email); }
function phones() { return TEAM.filter(m => m.sms_optin && m.phone).map(m => m.phone); }
function telegramChats() {
  return TEAM
    .filter(m => m.telegram_optin && m.telegram_chat_id)
    .map(m => ({ name: m.name, chat_id: m.telegram_chat_id }));
}

/* ------------------------- EMAIL ------------------------- */

async function notifyEmail(sgClient, msg) {
  if (!sgClient) throw new Error('notifyEmail requires sendgrid client');
  const list = emails();
  if (!list.length) return { skipped: true, reason: 'no team email recipients' };

  // Kill switch passthrough — server.js sets OA_EMAIL_KILLED on global; we honor it via env too
  if (process.env.OA_EMAIL_KILLED === '1' || process.env.OA_EMAIL_KILLED === 'true') {
    return { skipped: true, reason: 'OA_EMAIL_KILLED' };
  }

  const [primary, ...rest] = list;
  const finalMsg = {
    to: primary,
    bcc: rest.length ? rest.map(e => ({ email: e })) : undefined,
    from: msg.from || { email: 'tyler@overassessed.ai', name: 'OverAssessed Internal' },
    replyTo: msg.replyTo || 'tyler@overassessed.ai',
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    attachments: msg.attachments
  };
  if (msg.trackingSettings) finalMsg.trackingSettings = msg.trackingSettings;

  try {
    const out = await sgClient.send(finalMsg);
    return { ok: true, statusCode: out[0]?.statusCode, recipients: list };
  } catch (err) {
    console.error('[internal-team.notifyEmail] FAILED:', err.message);
    return { ok: false, error: err.message, recipients: list };
  }
}

/* ------------------------- SMS ------------------------- */

async function notifySms(twilioClient, body, fromNumber) {
  if (!twilioClient) return { skipped: true, reason: 'no twilio client' };
  const list = phones();
  if (!list.length) return { skipped: true, reason: 'no team sms recipients' };

  const from = fromNumber || process.env.TWILIO_PHONE_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!from && !messagingServiceSid) return { skipped: true, reason: 'no twilio from/messaging service' };

  const baseParams = messagingServiceSid
    ? { messagingServiceSid }
    : { from };

  const results = await Promise.all(
    list.map(to =>
      twilioClient.messages.create({ ...baseParams, to, body })
        .then(m => ({ to, sid: m.sid, status: m.status }))
        .catch(err => ({ to, error: err.message, code: err.code }))
    )
  );
  return { ok: true, results };
}

/* ------------------------- TELEGRAM ------------------------- */

async function notifyTelegram(text, opts = {}) {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TOKEN) return { skipped: true, reason: 'no TELEGRAM_BOT_TOKEN' };

  const chats = telegramChats();
  if (!chats.length) return { skipped: true, reason: 'no telegram recipients' };

  const fetchFn = (typeof fetch !== 'undefined') ? fetch : require('node-fetch');
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const parse_mode = opts.parse_mode || (opts.html === false ? undefined : 'HTML');

  const results = await Promise.all(
    chats.map(c =>
      fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: c.chat_id,
          text,
          ...(parse_mode ? { parse_mode } : {}),
          disable_web_page_preview: opts.disable_web_page_preview ?? true
        })
      })
        .then(r => r.json())
        .then(j => ({ name: c.name, chat_id: c.chat_id, ok: !!j.ok, error: j.description }))
        .catch(err => ({ name: c.name, chat_id: c.chat_id, ok: false, error: err.message }))
    )
  );
  return { ok: true, results };
}

/* ------------------------- BUNDLED FAN-OUT ------------------------- */

/**
 * Convenience: fire any combo of channels.
 * @param {Object} o
 * @param {Object} [o.sgClient]    SendGrid client (sgMail)
 * @param {Object} [o.twilioClient] Twilio client (optional)
 * @param {string} [o.subject]
 * @param {string} [o.html]
 * @param {string} [o.text]
 * @param {Array}  [o.attachments]
 * @param {string} [o.sms]         SMS body (omit to skip SMS)
 * @param {string} [o.telegram]    Telegram body (omit to skip Telegram)
 */
async function notifyAll(o = {}) {
  const out = { email: null, sms: null, telegram: null };
  if (o.sgClient && (o.subject || o.html || o.text)) {
    out.email = await notifyEmail(o.sgClient, {
      subject: o.subject, html: o.html, text: o.text, attachments: o.attachments
    });
  }
  if (o.twilioClient && o.sms) out.sms = await notifySms(o.twilioClient, o.sms);
  if (o.telegram) out.telegram = await notifyTelegram(o.telegram, { html: true });
  return out;
}

// Legacy alias
const notify = notifyAll;

module.exports = {
  TEAM,
  members,
  emails,
  phones,
  telegramChats,
  notifyEmail,
  notifySms,
  notifyTelegram,
  notifyAll,
  notify
};
