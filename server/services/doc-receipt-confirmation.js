/**
 * doc-receipt-confirmation.js
 * Send confirmation to customers when documents are received via any channel.
 * Called after: Twilio inbound MMS, email attachment, or manual upload to case_documents.
 */

const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');

const sg = sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const tw = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM_PHONE = process.env.TWILIO_PHONE_NUMBER;
const FROM_EMAIL = 'notifications@overassessed.ai';
const REPLY_TO = 'tyler@overassessed.ai';

/**
 * Send document receipt confirmation to a customer.
 * @param {object} opts
 * @param {string} opts.case_id
 * @param {string} opts.owner_name
 * @param {string} opts.email
 * @param {string} opts.phone
 * @param {string} opts.property_address
 * @param {string} opts.channel - 'sms' | 'email' | 'upload'
 * @param {string[]} opts.doc_types - e.g. ['tax assessment', 'notice of value']
 */
async function sendDocReceiptConfirmation(opts) {
  const { case_id, owner_name, email, phone, property_address, channel, doc_types = [] } = opts;
  const firstName = (owner_name || '').split(' ')[0] || 'there';
  const docLabel = doc_types.length > 0 ? doc_types.join(', ') : 'tax documents';
  const results = [];

  // SMS confirmation
  if (phone && channel !== 'email') {
    try {
      const cleanPhone = phone.replace(/\D/g, '');
      const e164 = cleanPhone.length === 10 ? `+1${cleanPhone}` : `+${cleanPhone}`;
      const msg = await tw.messages.create({
        from: FROM_PHONE,
        to: e164,
        body: `Hi ${firstName} — we received your ${docLabel} for ${property_address}. We're on it! We'll be in touch soon with your analysis.\n\n– OverAssessed (888) 282-9165`,
      });
      results.push({ channel: 'sms', status: 'sent', sid: msg.sid });
      console.log(`[doc-receipt] SMS sent to ${e164} for ${case_id}: ${msg.sid}`);
    } catch (e) {
      console.error(`[doc-receipt] SMS failed for ${case_id}:`, e.message);
      results.push({ channel: 'sms', status: 'failed', error: e.message });
    }
  }

  // Email confirmation
  if (email) {
    try {
      const html = `<!DOCTYPE html><html><head><style>
body{font-family:Arial,sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px}
h2{color:#1e3a5f}.banner{background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px 18px;margin-bottom:18px}
p{line-height:1.6;font-size:14px}.footer{margin-top:24px;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:10px}
</style></head><body>
<h2>Documents Received ✓</h2>
<div class="banner"><b>Case ${case_id} — ${property_address}</b></div>
<p>Hi ${firstName},</p>
<p>We've received your <b>${docLabel}</b> and added them to your case file. Our team will review everything and you'll hear back from us shortly with your full analysis.</p>
<p>You don't need to take any further action right now. If you have additional documents or questions, just reply to this email or call us at <b>(888) 282-9165</b>.</p>
<p>Best regards,<br><b>Tyler Worthey</b><br>President, OverAssessed LLC<br>(888) 282-9165</p>
<div class="footer">OverAssessed LLC · Case ${case_id} · <a href="https://overassessed.ai">overassessed.ai</a></div>
</body></html>`;

      await sgMail.send({
        to: { email, name: owner_name },
        from: { email: FROM_EMAIL, name: 'Tyler Worthey | OverAssessed' },
        replyTo: { email: REPLY_TO, name: 'Tyler Worthey' },
        subject: `Documents received — Case ${case_id}`,
        html,
      });
      results.push({ channel: 'email', status: 'sent' });
      console.log(`[doc-receipt] Email sent to ${email} for ${case_id}`);
    } catch (e) {
      console.error(`[doc-receipt] Email failed for ${case_id}:`, e.message);
      results.push({ channel: 'email', status: 'failed', error: e.message });
    }
  }

  return results;
}

module.exports = { sendDocReceiptConfirmation };
