/**
 * wa-followup.js
 *
 * Dedicated reminder + escalation cadence for WA cases that have been sent a
 * signing link but haven't signed yet.
 *
 * Cadence (relative to drip_state.wa_link_sent_at, or first esign_token created_at):
 *   - 24h: customer email reminder
 *   - 48h: customer SMS reminder (if SMS approved/usable)
 *   - 72h: ESCALATION — internal alert to Tyler (Telegram + email + activity_log)
 *           Also flags case for manual outreach once SMS is approved.
 *
 * State stored on submissions.drip_state.wa_followup as { reminder24, reminder48, escalation72 }
 *
 * Exported: runWAFollowUp() — call from a setInterval or cron.
 *
 * Notes:
 * - Skips immediately if token.signed_at IS NOT NULL (case is signed).
 * - Skips if drip_state.wa_followup.<slot> is already set (idempotent).
 * - Respects email_unusable / sms_unusable flags.
 * - Honors automation_excluded / manual_only.
 */

'use strict';

const SIGN_BASE_URL = process.env.BASE_URL || 'https://overassessed.ai';
const _team = require('./internal-team');

async function runWAFollowUp(deps = {}) {
    const {
        supabase,                  // supabase admin client
        sendClientEmail,           // (to, subject, html) => Promise
        sendClientSMS,             // (phone, body, opts) => Promise
        brandedEmailWrapper,       // (heading, sub, body) => html string
        log = (...a) => console.log('[WA-FollowUp]', ...a),
    } = deps;

    // Use internal-team for all internal alerts (Tyler + Uri)
    const getTeamEmailClient = () => {
        if (!process.env.SENDGRID_API_KEY) return null;
        const sg = require('@sendgrid/mail');
        sg.setApiKey(process.env.SENDGRID_API_KEY);
        return sg;
    };

    if (!supabase) {
        log('No supabase client provided, skipping');
        return { actions: 0 };
    }

    log('Running WA follow-up sweep…');
    const now = Date.now();
    let actions = 0;

    try {
        // Pull WA cases that have been sent a signing link and aren't signed yet
        const { data: cases, error } = await supabase
            .from('submissions')
            .select('id, case_id, owner_name, email, phone, status, state, county, property_address, drip_state, automation_excluded, manual_only, email_unusable, sms_unusable, fee_agreement_signed, signature, last_activity_at')
            .eq('state', 'WA')
            .is('deleted_at', null)
            .in('status', ['WA_SIGNING_LINK_SENT', 'READY_FOR_SIGNATURE_WA', 'PENDING_SIGNATURE_WA']);

        if (error) {
            log('Query error:', error.message);
            return { actions: 0, error: error.message };
        }

        for (const c of (cases || [])) {
            if (c.automation_excluded || c.manual_only) continue;
            if (c.fee_agreement_signed || c.signature) {
                log('Skip', c.case_id, '— already signed');
                continue;
            }

            // Find the active esign_token for this case (most recent pending)
            const { data: tokens } = await supabase
                .from('esign_tokens')
                .select('token, status, signed_at, created_at, expires_at, signer_email')
                .eq('case_id', c.case_id)
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
                .limit(1);

            const tok = tokens && tokens[0];
            if (!tok) {
                log('Skip', c.case_id, '— no active pending token');
                continue;
            }

            if (tok.signed_at) continue;
            if (new Date(tok.expires_at).getTime() < now) {
                log('Skip', c.case_id, '— token expired');
                continue;
            }

            const drip = c.drip_state || {};
            const followup = drip.wa_followup || {};
            const sentAt = new Date(drip.wa_link_sent_at || tok.created_at).getTime();
            const hoursSince = (now - sentAt) / (1000 * 60 * 60);
            const signUrl = `${SIGN_BASE_URL}/sign/${tok.token}`;
            const firstName = (c.owner_name || '').split(' ')[0] || 'there';
            const county = c.county || '';
            const recipientEmail = tok.signer_email || c.email;

            let updated = false;

            // === 24h reminder (email) ===
            if (hoursSince >= 24 && !followup.reminder24) {
                if (recipientEmail && !c.email_unusable) {
                    const subject = `Reminder: Sign your ${county} County WA property tax petition`;
                    const html = brandedEmailWrapper
                        ? brandedEmailWrapper('Quick Reminder', `Case ${c.case_id}`, `
                            <p>Hi ${firstName},</p>
                            <p>Just a friendly reminder \u2014 we still need your signed Washington State petition (Form 64-0075) and Letter of Authorization to file your protest with the ${county} County Board of Equalization.</p>
                            <p>It only takes about 2 minutes:</p>
                            <p style="text-align:center;margin:24px 0;">
                              <a href="${signUrl}" style="background:#6c5ce7;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Review &amp; Sign</a>
                            </p>
                            <p style="font-size:13px;color:#666;">Or copy this link: <br><a href="${signUrl}">${signUrl}</a></p>
                            <p>If anything looks off, just reply and we'll fix it before filing.</p>
                            <p>Thanks,<br>OverAssessed</p>
                          `)
                        : `<p>Hi ${firstName},</p><p>Reminder: please sign your WA petition: <a href="${signUrl}">${signUrl}</a></p>`;
                    try {
                        await sendClientEmail(recipientEmail, subject, html);
                        log('24h email sent', c.case_id, '\u2192', recipientEmail);
                        await supabase.from('communications').insert({
                            case_id: c.case_id, submission_id: c.id, direction: 'outbound',
                            channel: 'email', recipient: recipientEmail,
                            subject, body: 'WA 24h reminder', status: 'sent'
                        });
                    } catch (e) { log('24h email failed', c.case_id, ':', e.message); }
                }
                followup.reminder24 = new Date().toISOString();
                updated = true; actions++;
            }

            // === 48h reminder (SMS — only if SMS is usable & approved) ===
            if (hoursSince >= 48 && !followup.reminder48) {
                if (c.phone && !c.sms_unusable) {
                    const body = `OverAssessed: We still need your signed WA petition for ${c.property_address || c.case_id}. Sign here (~2 min): ${signUrl}`;
                    try {
                        await sendClientSMS(c.phone, body, {
                            email: c.email, customerName: c.owner_name, context: 'wa_followup_48h'
                        });
                        log('48h SMS sent', c.case_id, '\u2192', c.phone);
                        await supabase.from('communications').insert({
                            case_id: c.case_id, submission_id: c.id, direction: 'outbound',
                            channel: 'sms', recipient: c.phone, body, status: 'sent'
                        });
                    } catch (e) {
                        log('48h SMS failed', c.case_id, ':', e.message);
                        // If SMS fails (likely TCR not approved yet), record as queued for manual outreach
                        followup.sms_blocked_at_48h = new Date().toISOString();
                    }
                } else {
                    log('48h SMS skipped', c.case_id, '\u2014 phone unusable or missing');
                    followup.sms_blocked_at_48h = new Date().toISOString();
                }
                followup.reminder48 = new Date().toISOString();
                updated = true; actions++;
            }

            // === 72h escalation flag (internal alert + manual-outreach flag) ===
            if (hoursSince >= 72 && !followup.escalation72) {
                const ownerName = c.owner_name || 'Property Owner';
                const phone = c.phone || 'no phone on file';
                const escMsg = `\u26a0\ufe0f WA signing escalation \u2014 ${c.case_id}\nOwner: ${ownerName}\nCounty: ${county}\nPhone: ${phone}\nEmail: ${recipientEmail}\nSign URL: ${signUrl}\n\n72h passed since signing link sent. No signature yet. Manual outreach recommended (call once SMS campaign is approved).`;
                try {
                    // Fan out to Tyler + Uri via internal-team.js
                    await _team.notifyTelegram(`\u26a0\ufe0f <b>WA Signing Escalation</b>\n\n<b>Case:</b> ${c.case_id}\n<b>Owner:</b> ${ownerName}\n<b>County:</b> ${county}\n<b>Phone:</b> ${phone}\n<b>Email:</b> ${recipientEmail}\n\n72h since signing link sent. No signature.\n<b>Action:</b> Manual outreach (call once SMS approved).\n\n<a href="${signUrl}">Sign URL</a>`);
                    const sg72 = getTeamEmailClient();
                    if (sg72) {
                        await _team.notifyEmail(sg72, {
                            subject: `\u26a0\ufe0f WA 72h Escalation \u2014 ${c.case_id} ${ownerName}`,
                            html: `<div style="font-family:sans-serif;max-width:600px;">
                                <h3 style="color:#d63031;">WA Signing Escalation \u2014 72h</h3>
                                <p><strong>Case:</strong> ${c.case_id}</p>
                                <p><strong>Owner:</strong> ${ownerName}</p>
                                <p><strong>County:</strong> ${county}, WA</p>
                                <p><strong>Phone:</strong> ${phone}</p>
                                <p><strong>Email:</strong> ${recipientEmail}</p>
                                <p>72 hours have passed since the WA signing link was sent. No signature received.</p>
                                <p><strong>Action recommended:</strong> manual outreach (call once SMS campaign approved).</p>
                                <p><a href="${signUrl}">${signUrl}</a></p>
                            </div>`
                        });
                    }
                    log('72h escalation alerted (Tyler + Uri)', c.case_id);
                } catch (e) {
                    log('72h alert failed', c.case_id, ':', e.message);
                }
                // Flag for manual outreach in DB
                followup.escalation72 = new Date().toISOString();
                followup.manual_outreach_required = true;

                // Activity log
                try {
                    await supabase.from('activity_log').insert({
                        case_id: c.case_id, actor: 'aquabot', action: 'wa_signing_72h_escalation',
                        details: {
                            sent_at: drip.wa_link_sent_at || tok.created_at,
                            hours_since: Math.round(hoursSince),
                            sign_url: signUrl,
                            manual_outreach_flag_set: true
                        }
                    });
                } catch (e) { /* non-fatal */ }
                updated = true; actions++;
            }

            if (updated) {
                drip.wa_followup = followup;
                if (!drip.wa_link_sent_at) drip.wa_link_sent_at = new Date(tok.created_at).toISOString();
                await supabase.from('submissions').update({
                    drip_state: drip,
                    last_activity_at: new Date().toISOString()
                }).eq('id', c.id);
            }
        }

        log('Sweep done. Actions:', actions);
        return { actions };
    } catch (err) {
        log('Top-level error:', err.message);
        return { actions: 0, error: err.message };
    }
}

module.exports = { runWAFollowUp };
