'use strict';
/**
 * /api/email/inbound
 * SendGrid Inbound Parse webhook handler.
 *
 * Configure in SendGrid: Settings → Inbound Parse → Add Host & URL
 *   MX domain: inbound.overassessed.ai (or your verified domain)
 *   URL: https://api.overassessed.ai/api/email/inbound
 *   Check: "POST the raw, full MIME message"  → OFF (use form-encoded fields)
 *
 * This handler:
 *   1. Parses the incoming multipart/form-data from SendGrid
 *   2. Matches sender email to a submissions case
 *   3. Inserts into communications (handled=false)
 *   4. Fires Telegram alert to Tyler
 *   5. Detects opt-out keywords and marks email_unusable
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const { supabaseAdmin } = require('../lib/supabase');

// Lazy-load sendTelegramAlert from server context (injected via app.locals)
async function telegramAlert(req, text) {
    try {
        if (req.app.locals.sendTelegramAlert) await req.app.locals.sendTelegramAlert(text);
    } catch (e) { console.error('[email-inbound] Telegram alert failed:', e.message); }
}

// POST /api/email/inbound — SendGrid Inbound Parse
router.post('/', upload.any(), async (req, res) => {
    // Respond 200 immediately so SendGrid doesn't retry
    res.status(200).send('OK');

    try {
        const from      = req.body?.from || req.body?.sender || '';
        const to        = req.body?.to || '';
        const subject   = req.body?.subject || '(no subject)';
        const text      = req.body?.text || '';
        const html      = req.body?.html || '';
        const body      = text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const envelope  = req.body?.envelope ? JSON.parse(req.body.envelope) : {};

        // Extract sender email address
        const senderEmail = (from.match(/<([^>]+)>/) || [])[1] || from.trim().toLowerCase();

        console.log(`📧 [Inbound Email] From: ${senderEmail} | Subject: ${subject.substring(0, 80)}`);

        // Match to a submission by email
        const { data: cases } = await supabaseAdmin.from('submissions')
            .select('id, case_id, owner_name, email, phone, status')
            .ilike('email', senderEmail)
            .is('deleted_at', null)
            .limit(3);

        const matched = cases && cases.length > 0 ? cases[0] : null;
        const caseId  = matched?.case_id || 'UNKNOWN';
        const custName = matched?.owner_name || senderEmail;

        // Opt-out detection
        const isOptOut = /^\s*(unsubscribe|stop|opt.?out|remove me)\s*$/i.test(body.trim());
        if (isOptOut && matched) {
            await supabaseAdmin.from('submissions').update({
                email_unusable: true,
                email_unusable_reason: `OPT_OUT — replied unsubscribe/stop on ${new Date().toISOString().slice(0,10)}`,
                updated_at: new Date().toISOString()
            }).eq('case_id', caseId);
            console.log(`[Inbound Email] Opt-out — marked email_unusable for ${caseId}`);
        }

        // Store in communications table
        const { error: commErr } = await supabaseAdmin.from('communications').insert({
            case_id:       caseId === 'UNKNOWN' ? null : caseId,
            submission_id: matched?.id || null,
            direction:     'inbound',
            channel:       'email',
            recipient:     senderEmail,
            subject:       subject.substring(0, 255),
            body:          body.substring(0, 4000),
            status:        'received',
            handled:       false,
            metadata: {
                from, to,
                envelope,
                attachments: req.files ? req.files.length : 0,
                opt_out: isOptOut
            },
            created_at: new Date().toISOString()
        });
        if (commErr) console.error('[Inbound Email] communications insert error:', commErr.message);
        else console.log(`[Inbound Email] Saved — case: ${caseId}, handled: false`);

        // Telegram alert
        await telegramAlert(req,
            `📧 <b>INBOUND EMAIL</b>\n\n` +
            `<b>From:</b> ${senderEmail}\n` +
            `<b>Case:</b> ${caseId} (${custName})\n` +
            `<b>Subject:</b> ${subject.substring(0, 100)}\n` +
            `<b>Body:</b> ${body.substring(0, 300)}` +
            (isOptOut ? `\n\n⚠️ <b>OPT-OUT received — email blocked for ${caseId}</b>` : '') +
            (!matched ? `\n\n⚠️ <b>No case matched for ${senderEmail}</b>` : '')
        );

    } catch (err) {
        console.error('[Inbound Email] Unhandled error:', err.message);
    }
});

module.exports = router;
