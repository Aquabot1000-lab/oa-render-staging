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

// Telegram real-time alert
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8546685923:AAGxRV6_YwimsyLvaORNhZTNu-1JM9PtdDs';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8568734697';

async function sendTelegramAlert(text) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' })
        });
        if (!resp.ok) console.error('[Telegram] Alert failed:', resp.status);
        else console.log('[Telegram] Alert sent');
    } catch (err) {
        console.error('[Telegram] Alert error:', err.message);
    }
}

module.exports = { sendNotificationSMS, sendNotificationEmail, sendTelegramAlert };
