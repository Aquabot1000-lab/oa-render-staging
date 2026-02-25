/**
 * Re-exports notification helpers from server.js scope.
 * Used by route modules that need to send notifications without circular deps.
 * Falls back to console.log if Twilio/SendGrid aren't configured.
 */
const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}
if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

async function sendSMS(to, message) {
    if (!twilioClient || !to) { console.log('SMS skipped'); return; }
    try {
        await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to
        });
    } catch (e) { console.error('SMS failed:', e.message); }
}

async function sendNotificationSMS(message) {
    await sendSMS(process.env.NOTIFY_PHONE, message);
}

async function sendNotificationEmail(subject, html) {
    if (!process.env.SENDGRID_API_KEY || !process.env.NOTIFY_EMAIL) {
        console.log('Email skipped');
        return;
    }
    try {
        await sgMail.send({
            to: process.env.NOTIFY_EMAIL,
            from: process.env.SENDGRID_FROM_EMAIL || 'notifications@overassessed.ai',
            subject,
            html
        });
    } catch (e) { console.error('Email failed:', e.message); }
}

module.exports = { sendNotificationSMS, sendNotificationEmail };
