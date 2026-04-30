const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');
const crypto = require('crypto');
const { generateAndStoreSigned } = require('../services/sign-form-50-162');
const { generateAndStoreSignedWA } = require('../services/sign-wa-package');

// Generate signing token for a case
router.post('/generate', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { case_id, signer_name, signer_email } = req.body;
        if (!case_id) return res.status(400).json({ error: 'case_id required' });

        const token = crypto.randomBytes(32).toString('hex');
        const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabaseAdmin
            .from('esign_tokens')
            .insert({
                case_id,
                token,
                signer_name: signer_name || null,
                signer_email: signer_email || null,
                status: 'pending',
                expires_at,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) throw error;

        const baseUrl = process.env.BASE_URL || 'https://overassessed.ai';
        const sign_url = `${baseUrl}/sign/${token}`;

        res.json({ sign_url, token, expires_at });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET signing page
router.get('/:token', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).send('Service unavailable');
    try {
        const { token } = req.params;

        const { data: signData, error } = await supabaseAdmin
            .from('esign_tokens')
            .select('id, case_id, signer_name, signer_email, status, expires_at, signed_at')
            .eq('token', token)
            .single();

        if (error || !signData) return res.status(404).send(signingPage('not_found'));
        if (new Date(signData.expires_at) < new Date()) return res.status(410).send(signingPage('expired'));

        // Fetch submission early so we can branch on state
        let sub = null;
        if (signData.case_id) {
            const { data: subData } = await supabaseAdmin
                .from('submissions')
                .select('owner_name, property_address, county, state, estimated_savings, assessed_value, property_data')
                .eq('case_id', signData.case_id)
                .maybeSingle();
            sub = subData;
        }

        if (signData.status === 'signed') {
            // Fetch signed PDF URL in the async route (not inside signingPage)
            let signedPdfUrl = null;
            try {
                // Try state-specific signed doc first, fall back to TX type
                const fileType = sub?.state === 'WA' ? 'signed_wa_package' : 'signed_50_162';
                const { data: doc } = await supabaseAdmin
                    .from('case_documents')
                    .select('file_url')
                    .eq('case_id', signData.case_id)
                    .eq('file_type', fileType)
                    .order('uploaded_at', { ascending: false })
                    .limit(1)
                    .single();
                signedPdfUrl = doc?.file_url || null;
            } catch (docErr) {
                console.error('[esign] Failed to fetch signed PDF URL for already_signed page:', docErr.message);
            }
            return res.status(200).send(signingPage('already_signed', signData, sub, signedPdfUrl));
        }

        res.send(signingPage('ready', signData, sub));
    } catch (err) {
        res.status(500).send('Server error: ' + err.message);
    }
});

// POST signature submission — PDF generation is REQUIRED, not optional
router.post('/:token/submit', express.json(), async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { token } = req.params;
        const { signature_data, signer_role, typed_name, authorized } = req.body;

        if (!signature_data) return res.status(400).json({ error: 'Signature required' });

        const { data: signData, error: fetchErr } = await supabaseAdmin
            .from('esign_tokens')
            .select('*')
            .eq('token', token)
            .single();

        if (fetchErr || !signData) return res.status(404).json({ error: 'Invalid token' });
        if (signData.status === 'signed') return res.status(409).json({ error: 'Already signed' });
        if (new Date(signData.expires_at) < new Date()) return res.status(410).json({ error: 'Link expired' });

        // Mark token as signed
        const { error: updateErr } = await supabaseAdmin
            .from('esign_tokens')
            .update({
                status: 'signed',
                signed_at: new Date().toISOString(),
                signature_data,
                signer_role: signer_role || 'property_owner',
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            })
            .eq('token', token);

        if (updateErr) throw updateErr;

        const signedAt = new Date().toISOString();

        // Look up state BEFORE updating, so we can branch correctly. We need extra
        // columns for the WA path (parcel via property_data, owner_opinion, etc.).
        const { data: preSub } = await supabaseAdmin
            .from('submissions')
            .select('owner_name, property_address, county, state, phone, email, assessed_value, property_data, filing_data, analysis_report')
            .eq('case_id', signData.case_id)
            .maybeSingle();
        const isWA = (preSub?.state || '').toUpperCase() === 'WA';

        // Update submission record (status differs by state)
        const subUpdate = isWA
            ? {
                fee_agreement_signed: true,
                fee_agreement_signed_at: signedAt,
                agent_form_signed: true,
                filing_status: 'READY_TO_FILE_WA',
                signature_data: signature_data,
                signature: {
                    fullName: typed_name || signData.signer_name || preSub?.owner_name || null,
                    signedAt,
                    ipAddress: req.ip,
                    authorized: authorized !== false,
                    documentsSigned: ['wa_form_64_0075', 'wa_loa']
                }
              }
            : {
                fee_agreement_signed: true,
                fee_agreement_signed_at: signedAt,
                status: 'SIGNED_READY_TO_FILE'
              };

        const { data: subData, error: subErr } = await supabaseAdmin
            .from('submissions')
            .update(subUpdate)
            .eq('case_id', signData.case_id)
            .select('owner_name, property_address, county, state, phone, email, property_data, assessed_value')
            .single();

        if (subErr) console.error('[esign] Failed to update submission:', subErr.message);

        // Generate signed PDF — REQUIRED, blocking, no silent failures
        console.log(`[esign] ▶ Starting PDF generation for case ${signData.case_id} (state=${preSub?.state || 'TX'})`);
        let signedPdfUrl = null;
        let signedHash = null;
        let signedStoragePath = null;

        try {
            if (isWA) {
                // ===== WA path =====
                const pData = subData?.property_data || preSub?.property_data || {};
                const parcel = pData.parcel_number || pData.parcel || pData.account_number
                    || preSub?.filing_data?.parcel_number || '';
                const ownerOpinion = pData.owner_opinion || pData.opinion_of_value
                    || preSub?.analysis_report?.owner_opinion
                    || preSub?.filing_data?.owner_opinion
                    || 0;
                const stored = await generateAndStoreSignedWA(supabaseAdmin, {
                    caseId: signData.case_id,
                    ownerName: subData?.owner_name || signData.signer_name,
                    propertyAddress: subData?.property_address || '',
                    county: subData?.county || '',
                    parcel,
                    ownerOpinion,
                    email: subData?.email || preSub?.email || '',
                    phone: subData?.phone || '',
                    assessmentYear: pData.assessment_year || new Date().getFullYear(),
                    taxPayableYear: pData.tax_payable_year,
                    assessorTotal: parseInt(String(subData?.assessed_value || '0').replace(/[^\d]/g, ''), 10) || pData.assessor_total || 0,
                    assessorLand: pData.assessor_land || 0,
                    assessorImprovements: pData.assessor_improvements || 0,
                    ownerLand: pData.owner_land || 0,
                    ownerImprovements: pData.owner_improvements,
                    compMedian: pData.comp_median || 0,
                    compMin: pData.comp_min || 0,
                    compMax: pData.comp_max || 0,
                    compCount: pData.comp_count || 0,
                    signatureDataUrl: signature_data,
                    signedAt
                });
                signedPdfUrl = stored.publicUrl;
                signedHash = stored.hash;
                signedStoragePath = stored.storagePath;
                console.log(`[esign] ✅ Signed WA package stored: ${signedPdfUrl} (sha256=${signedHash})`);

                // Activity log entry — WA path
                try {
                    await supabaseAdmin.from('activity_log').insert({
                        case_id: signData.case_id,
                        actor: 'aquabot',
                        action: 'wa_signature_captured',
                        details: {
                            token_prefix: token.slice(0, 8) + '...',
                            signed_pdf_url: signedPdfUrl,
                            storage_path: signedStoragePath,
                            sha256: signedHash,
                            documents: ['wa_form_64_0075', 'wa_loa'],
                            signed_at: signedAt
                        },
                        created_at: new Date().toISOString()
                    });
                } catch (alErr) {
                    console.error('[esign] activity_log insert failed:', alErr.message);
                }

                // Email Tyler — WA wording, NO Form 50-162 reference
                try {
                    if (process.env.SENDGRID_API_KEY) {
                        const sgMail = require('@sendgrid/mail');
                        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
                        const ownerName = subData?.owner_name || signData.signer_name || 'Property Owner';
                        const county = subData?.county || '';
                        await sgMail.send({
                            to: 'tyler@overassessed.ai',
                            from: { email: process.env.SENDGRID_FROM_EMAIL || 'notifications@overassessed.ai', name: 'OverAssessed' },
                            subject: `✅ WA Protest signed — ${signData.case_id} (${ownerName})`,
                            html: `<div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px;">
                                <h2 style="color:#6c5ce7;">✅ WA Petition Signed</h2>
                                <p><strong>Case:</strong> ${signData.case_id}</p>
                                <p><strong>Owner:</strong> ${ownerName}</p>
                                <p><strong>County:</strong> ${county} County, WA</p>
                                <p><strong>Documents signed:</strong> WA DOR Form 64-0075 (Taxpayer Petition) + Letter of Authorization</p>
                                <p><strong>Signed at:</strong> ${signedAt}</p>
                                <p><strong>SHA-256:</strong> <code>${signedHash}</code></p>
                                <p><a href="${signedPdfUrl}" style="background:#6c5ce7;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">📄 View Signed Package</a></p>
                                <p>filing_status set to <code>READY_TO_FILE_WA</code>. Awaiting your approval before submission to the ${county} County BOE.</p>
                                <p style="color:#888;font-size:12px;">— OverAssessed automation</p>
                            </div>`
                        });
                    }
                } catch (mailErr) {
                    console.error('[esign] Tyler notification email failed:', mailErr.message);
                }

                // Real-time Telegram alert to Tyler — fires the moment WA petition is signed
                try {
                    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
                    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
                    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
                        const ownerName = subData?.owner_name || signData.signer_name || 'Property Owner';
                        const county = subData?.county || '';
                        const text = `\u2705 <b>WA Petition Signed</b>\n\n<b>Case:</b> ${signData.case_id}\n<b>Owner:</b> ${ownerName}\n<b>County:</b> ${county} County, WA\n<b>Documents:</b> Form 64-0075 + LOA\n<b>Signed at:</b> ${signedAt}\n\nfiling_status \u2192 <code>READY_TO_FILE_WA</code>\nAwaiting your approval before BOE submission.`;
                        const tgUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
                        const fetchFn = (typeof fetch !== 'undefined') ? fetch : require('node-fetch');
                        await fetchFn(tgUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' })
                        });
                    }
                } catch (tgErr) {
                    console.error('[esign] Tyler Telegram alert failed:', tgErr.message);
                }
            } else {
                // ===== TX/GA path (UNCHANGED) =====
                const stored = await generateAndStoreSigned(supabaseAdmin, {
                    caseId: signData.case_id,
                    ownerName: subData?.owner_name || signData.signer_name,
                    propertyAddress: subData?.property_address || '',
                    county: subData?.county || '',
                    phone: subData?.phone || '',
                    signatureDataUrl: signature_data,
                    signedAt
                });
                signedPdfUrl = stored.publicUrl;
                console.log(`[esign] ✅ Signed PDF stored: ${signedPdfUrl}`);
            }
        } catch (pdfErr) {
            console.error(`[esign] ❌ PDF generation FAILED for case ${signData.case_id}`);
            console.error(`[esign] Error: ${pdfErr.message}`);
            console.error(`[esign] Stack: ${pdfErr.stack}`);
            return res.status(500).json({
                success: false,
                error: 'PDF_GENERATION_FAILED',
                detail: pdfErr.message
            });
        }

        if (!signedPdfUrl) {
            console.error(`[esign] ❌ PDF generated but no URL returned for case ${signData.case_id}`);
            return res.status(500).json({
                success: false,
                error: 'PDF_GENERATION_FAILED',
                detail: 'No public URL returned from storage'
            });
        }

        res.json({
            success: true,
            message: 'Document signed successfully',
            signed_pdf_url: signedPdfUrl,
            case_id: signData.case_id
        });

        // AUTO-PACKAGE / AUTO-FILE: trigger after successful signature (non-blocking)
        setImmediate(async () => {
            try {
                // === WA GUARD (state-aware) ===
                // WA cases use a separate filing pipeline (DOR Form 64-0075 → County BOE).
                // No auto-file. Tyler will manually approve and submit.
                if (isWA) {
                    console.log(`[esign] 📝 WA case ${signData.case_id} — signed package staged. No auto-file. filing_status=READY_TO_FILE_WA.`);
                    try {
                        await supabaseAdmin.from('activity_log').insert({
                            case_id: signData.case_id, actor: 'aquabot', action: 'wa_post_signature_staged',
                            details: {
                                requires_tyler_review: true, auto_file: false,
                                next_step: 'READY_FOR_TYLER_REVIEW — awaiting Tyler approval to file WA petition'
                            }, created_at: new Date().toISOString()
                        });
                    } catch (e) { console.error('[esign] WA staged log failed:', e.message); }
                    return;
                }

                // === HUNT COUNTY GUARD (Tyler directive 2026-04-27) ===
                // Hunt County: PACKAGE ONLY, never auto-send. Tyler must review before submission.
                const county = (subData?.county || '').toLowerCase();
                if (county === 'hunt') {
                    const { autoPackageOnSignature } = require('../services/hunt-county-readiness');
                    console.log(`[esign] 📦 Hunt County — packaging only (no auto-send) for ${signData.case_id}`);
                    const pkg = await autoPackageOnSignature(supabaseAdmin, signData.case_id);
                    console.log(`[esign] 📦 Hunt package result:`, JSON.stringify(pkg));
                    return;
                }

                // === FORT BEND (OA-0010) GUARD (Tyler directive 2026-04-27) ===
                // Fort Bend: Generate 50-162 + verify card on file, then hold for Tyler approval.
                // Do NOT auto-file. Do NOT proceed to filing until payment method secured.
                if (county === 'fort bend') {
                    console.log(`[esign] 📦 Fort Bend — package-only after signature for ${signData.case_id}`);

                    // 1. Generate Form 50-162 PDF
                    const { generatePrefilledForm } = require('../services/form-50-162-generator');
                    const { createClient } = require('@supabase/supabase-js');
                    const fs = require('fs'), path = require('path'), os = require('os');
                    const tmpPath = path.join(os.tmpdir(), `${signData.case_id}-50162-${Date.now()}.pdf`);
                    const agentInfo = {
                        company: 'OverAssessed, LLC', address: '6002 Camp Bullis, Suite 208',
                        city: 'San Antonio', state: 'TX', zip: '78257',
                        phone: '(888) 282-9165', email: 'info@overassessed.ai'
                    };
                    await generatePrefilledForm(subData, agentInfo, tmpPath);
                    const buf = fs.readFileSync(tmpPath);
                    const storagePath = `forms/${signData.case_id}/2026-50162-${Date.now()}.pdf`;
                    const { error: upErr } = await supabaseAdmin.storage.from('documents').upload(storagePath, buf, { contentType: 'application/pdf', upsert: true });
                    if (!upErr) {
                        const { data: { publicUrl } } = supabaseAdmin.storage.from('documents').getPublicUrl(storagePath);
                        await supabaseAdmin.from('case_documents').insert({
                            case_id: signData.case_id,
                            file_name: `2026-Form-50-162-${(subData?.owner_name||'').replace(/\s+/g,'-')}.pdf`,
                            file_url: publicUrl, file_type: 'signed_50_162',
                            uploaded_by: 'aquabot-auto-package',
                            notes: 'Auto-generated post-AOA-signature. Fort Bend. Awaiting Tyler approval before filing.'
                        });
                        console.log(`[esign] ✅ Fort Bend 50-162 stored: ${publicUrl}`);
                    } else {
                        console.error(`[esign] ❌ 50-162 upload failed: ${upErr.message}`);
                    }
                    fs.unlink(tmpPath, ()=>{});

                    // 2. Log signature verification
                    await supabaseAdmin.from('activity_log').insert({
                        case_id: signData.case_id, actor: 'aquabot', action: 'aoa_signed_verified',
                        details: { signature_length: (signature_data || '').length, signed_at: signedAt, county: 'Fort Bend' },
                        created_at: new Date().toISOString()
                    });

                    // 3. Verify card on file → IMMEDIATE payment-flow action (Tyler 18:25 CDT)
                    const { data: sub2 } = await supabaseAdmin.from('submissions').select('stripe_customer_id,payment_status,email,owner_name').eq('case_id', signData.case_id).single();
                    const cardReady = sub2?.stripe_customer_id && sub2?.payment_status === 'card_authorized';
                    console.log(`[esign] 💳 Card gate for ${signData.case_id}: ${cardReady ? 'READY' : 'MISSING'}`);

                    if (cardReady) {
                        // Card already on file — send confirmation email immediately (one continuous flow)
                        try {
                            const sgMail = require('@sendgrid/mail');
                            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
                            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                            const pms = await stripe.paymentMethods.list({ customer: sub2.stripe_customer_id, type: 'card' });
                            const card = pms.data[0]?.card || {};
                            const last4 = card.last4 || '****';
                            const brand = card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : 'Card';
                            const firstName = (sub2.owner_name || 'there').split(' ')[0];
                            const sgRes = await sgMail.send({
                                to: sub2.email,
                                from: { email: 'notifications@overassessed.ai', name: 'OverAssessed' },
                                replyTo: { email: 'tyler@reply.overassessed.ai', name: 'Tyler Worthey' },
                                subject: `Authorization signed — payment method confirmed`,
                                html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                                    <h2 style="color:#6c5ce7;">✅ Signed — your protest is moving</h2>
                                    <p>Hi ${firstName},</p>
                                    <p>Thanks for signing your authorization.</p>
                                    <p><strong>Card on file:</strong> ${brand} ending in <strong>${last4}</strong></p>
                                    <p>We will use this card for the agreed <strong>20% contingency fee upon a successful reduction</strong>. If we don't win you a reduction, you owe nothing.</p>
                                    <p>Next: we'll file your protest with Fort Bend CAD before the May 15 deadline and represent you through the hearing. We'll keep you posted.</p>
                                    <p>— Tyler<br>OverAssessed</p>
                                </div>`
                            });
                            const sgMsgId = sgRes[0].headers['x-message-id'];
                            // Tyler-mandated logs (2026-04-27 19:08 CDT)
                            await supabaseAdmin.from('activity_log').insert([
                                {
                                    case_id: signData.case_id, actor: 'aquabot', action: 'payment_method_confirmed',
                                    details: {
                                        stripe_customer_id: sub2.stripe_customer_id,
                                        card_brand: brand, card_last4: last4,
                                        confirmation_email_sg_id: sgMsgId,
                                        sent_to: sub2.email,
                                        payment_method_collected: true
                                    }, created_at: new Date().toISOString()
                                },
                                {
                                    case_id: signData.case_id, actor: 'aquabot', action: 'contingency_authorization_reaffirmed',
                                    details: {
                                        terms: '20% of successful reduction, no charge if no reduction',
                                        method: 'email_to_customer_post_signature',
                                        card_brand: brand, card_last4: last4,
                                        sg_message_id: sgMsgId
                                    }, created_at: new Date().toISOString()
                                },
                                {
                                    case_id: signData.case_id, actor: 'aquabot', action: 'payment_request_sent',
                                    details: {
                                        method: 'card_on_file_confirmation',
                                        stripe_customer_id: sub2.stripe_customer_id,
                                        card_brand: brand, card_last4: last4,
                                        sg_message_id: sgMsgId,
                                        sent_to: sub2.email,
                                        payment_method_collected: true,
                                        note: 'Card already on file; sent confirmation email — no recapture'
                                    }, created_at: new Date().toISOString()
                                }
                            ]);
                            await supabaseAdmin.from('communications').insert({
                                case_id: signData.case_id, direction: 'outbound', channel: 'email',
                                recipient: sub2.email, subject: 'Authorization signed — confirmation',
                                body: `Card on file confirmation: ${brand} ...${last4}. 20% contingency agreement.`,
                                status: 'sent', handled: true,
                                metadata: { source: 'post-signature-payment-confirmation', sg_message_id: sgRes[0].headers['x-message-id'] },
                                created_at: new Date().toISOString()
                            });
                            console.log(`[esign] 💳 Payment confirmation email sent to ${sub2.email}`);
                        } catch (payErr) {
                            console.error(`[esign] ❌ Payment confirmation email failed:`, payErr.message);
                            await supabaseAdmin.from('activity_log').insert({
                                case_id: signData.case_id, actor: 'aquabot', action: 'payment_request_failed',
                                details: { error: payErr.message, stripe_customer_id: sub2?.stripe_customer_id },
                                created_at: new Date().toISOString()
                            });
                        }
                    } else {
                        // No card on file — send SetupIntent link
                        try {
                            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                            const sgMail = require('@sendgrid/mail');
                            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
                            // Find or create stripe customer
                            let custId = sub2?.stripe_customer_id;
                            if (!custId) {
                                const list = await stripe.customers.list({ email: (sub2.email || '').toLowerCase(), limit: 1 });
                                if (list.data.length > 0) custId = list.data[0].id;
                                else {
                                    const created = await stripe.customers.create({ email: sub2.email, name: sub2.owner_name, metadata: { case_id: signData.case_id, source: 'post-signature' } });
                                    custId = created.id;
                                }
                                await supabaseAdmin.from('submissions').update({ stripe_customer_id: custId }).eq('case_id', signData.case_id);
                            }
                            const si = await stripe.setupIntents.create({
                                customer: custId, payment_method_types: ['card'],
                                metadata: { case_id: signData.case_id, source: 'post-signature' }
                            });
                            const baseUrl = process.env.BASE_URL || 'https://overassessed.ai';
                            const payUrl = `${baseUrl}/payment-setup?si=${si.client_secret}&case=${signData.case_id}`;
                            const firstName = (sub2.owner_name || 'there').split(' ')[0];
                            const sgRes = await sgMail.send({
                                to: sub2.email,
                                from: { email: 'notifications@overassessed.ai', name: 'OverAssessed' },
                                replyTo: { email: 'tyler@reply.overassessed.ai', name: 'Tyler Worthey' },
                                subject: `Last step — add a card to lock in your protest`,
                                html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                                    <h2 style="color:#6c5ce7;">✅ Signature received</h2>
                                    <p>Hi ${firstName},</p>
                                    <p>One quick last step: add a payment method so we can charge our 20% contingency only if we win you a reduction.</p>
                                    <p style="text-align:center;margin:28px 0;"><a href="${payUrl}" style="background:#6c5ce7;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Add Card</a></p>
                                    <p style="color:#666;font-size:13px;">No charge today. We only bill if we win.</p>
                                    <p>— Tyler<br>OverAssessed</p>
                                </div>`
                            });
                            await supabaseAdmin.from('activity_log').insert({
                                case_id: signData.case_id, actor: 'aquabot', action: 'payment_request_sent',
                                details: {
                                    method: 'setup_intent_link',
                                    setup_intent_id: si.id, stripe_customer_id: custId,
                                    sg_message_id: sgRes[0].headers['x-message-id'],
                                    sent_to: sub2.email, payment_method_collected: false
                                }, created_at: new Date().toISOString()
                            });
                            console.log(`[esign] 💳 SetupIntent link sent to ${sub2.email}`);
                        } catch (siErr) {
                            console.error(`[esign] ❌ SetupIntent send failed:`, siErr.message);
                        }
                    }

                    // 4. Log final state for Tyler review
                    await supabaseAdmin.from('activity_log').insert({
                        case_id: signData.case_id, actor: 'aquabot', action: 'post_signature_package_staged',
                        details: {
                            county: 'Fort Bend', form_50_162_generated: !upErr,
                            payment_method_collected: !!cardReady,
                            requires_tyler_review: true, auto_file: false,
                            next_step: cardReady ? 'READY_FOR_TYLER_REVIEW — awaiting Tyler approval to file' : 'BLOCKED_PAYMENT — awaiting card capture'
                        }, created_at: new Date().toISOString()
                    });
                    return;
                }

                // Default path: auto-file via email runner (other counties)
                const { fileByEmail } = require('../filing-automation/runners/email-runner');
                console.log(`[esign] 🚀 Auto-filing ${signData.case_id} after signature...`);
                const result = await fileByEmail(signData.case_id, { dryRun: false, submitMode: true });
                console.log(`[esign] 📬 Auto-file result for ${signData.case_id}:`, JSON.stringify(result));
            } catch (autoFileErr) {
                console.error(`[esign] ❌ Auto-file FAILED for ${signData.case_id}:`, autoFileErr.message);
            }
        });

    } catch (err) {
        console.error(`[esign] ❌ Submit route error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// GET pdf-url for a token
router.get('/:token/pdf-url', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data: tok } = await supabaseAdmin
            .from('esign_tokens')
            .select('case_id')
            .eq('token', req.params.token)
            .single();
        if (!tok) return res.status(404).json({ url: null });
        const { data: doc } = await supabaseAdmin
            .from('case_documents')
            .select('file_url')
            .eq('case_id', tok.case_id)
            .eq('file_type', 'signed_50_162')
            .order('uploaded_at', { ascending: false })
            .limit(1)
            .single();
        res.json({ url: doc?.file_url || null });
    } catch (err) {
        res.json({ url: null });
    }
});

// Check signing status
router.get('/:token/status', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabaseAdmin
            .from('esign_tokens')
            .select('status,signed_at,signer_name,case_id')
            .eq('token', req.params.token)
            .single();

        if (error || !data) return res.status(404).json({ error: 'Not found' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// signingPage — sync, no DB calls inside. PDF URL passed as 4th arg for already_signed.
function signingPage(state, signData = null, sub = null, signedPdfUrl = null) {
    const logo = `<div style="text-align:center;margin-bottom:24px;">
        <h1 style="color:#6c5ce7;margin:0;font-size:28px;">OverAssessed</h1>
        <p style="color:#666;margin:4px 0;">Property Tax Protest Services</p>
    </div>`;

    if (state === 'not_found') {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OverAssessed - Sign</title></head><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:40px auto;padding:20px;">${logo}<div style="background:#fee;padding:20px;border-radius:8px;text-align:center;"><h2>Document Not Found</h2><p>This signing link is invalid or has been removed.</p></div></body></html>`;
    }

    if (state === 'expired') {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OverAssessed - Expired</title></head><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:40px auto;padding:20px;">${logo}<div style="background:#fff3cd;padding:20px;border-radius:8px;text-align:center;"><h2>Link Expired</h2><p>This signing link has expired. Please contact OverAssessed for a new link.</p></div></body></html>`;
    }

    if (state === 'already_signed') {
        const pdfLink = signedPdfUrl
            ? `<p style="margin-top:16px;">
                <a href="${signedPdfUrl}" target="_blank" style="background:#6c5ce7;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700;">📄 View Signed Document</a>
                &nbsp;
                <a href="${signedPdfUrl}" download style="background:#e9ecef;color:#333;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700;">⬇️ Download PDF</a>
               </p>`
            : '';
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OverAssessed - Signed</title></head><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:40px auto;padding:20px;">${logo}<div style="background:#d4edda;padding:20px;border-radius:8px;text-align:center;"><h2>✅ Already Signed</h2><p>This document was signed on ${signData && signData.signed_at ? new Date(signData.signed_at).toLocaleDateString() : 'a previous date'}.</p><p>No further action needed. Thank you!</p>${pdfLink}</div></body></html>`;
    }

    const ownerName = sub ? sub.owner_name : (signData && signData.signer_name ? signData.signer_name : 'Property Owner');
    const address = sub ? sub.property_address : '';
    const caseId = signData ? signData.case_id || '' : '';
    const stateCode = (sub && sub.state ? sub.state : '').toUpperCase();

    // ====== WA-specific UI ======
    if (stateCode === 'WA') {
        const county = (sub && sub.county) ? sub.county : '';
        const pData = (sub && sub.property_data) ? sub.property_data : {};
        const parcel = pData.parcel_number || pData.parcel || pData.account_number || '';
        const ownerOpinion = pData.owner_opinion || pData.opinion_of_value || '';
        const ownerOpinionFmt = ownerOpinion
            ? '$' + parseInt(String(ownerOpinion).replace(/[^\d]/g, ''), 10).toLocaleString('en-US')
            : 'See attached petition';
        const assessmentYear = pData.assessment_year || new Date().getFullYear();
        const agentName = 'OverAssessed, LLC';
        const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>OverAssessed — Sign Your Property Tax Protest</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; background: #f5f5f5; color: #333; }
        .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        h1 { color: #6c5ce7; text-align: center; margin: 0 0 4px; font-size: 24px; }
        .subtitle { text-align: center; color: #666; margin-bottom: 4px; }
        h2 { color: #333; font-size: 18px; margin: 0 0 16px; }
        .field { margin-bottom: 12px; }
        .field label { display: block; font-weight: 600; color: #555; font-size: 13px; margin-bottom: 4px; }
        .field .value { padding: 10px 12px; background: #f8f9fa; border-radius: 6px; border: 1px solid #e9ecef; }
        .checklist { list-style: none; padding: 0; margin: 0; }
        .checklist li { padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
        .checklist li:last-child { border: none; }
        .checklist li::before { content: "☑️ "; }
        .docs { display: grid; gap: 10px; }
        .doc-row { padding: 10px 12px; background: #f0eeff; border-left: 3px solid #6c5ce7; border-radius: 4px; font-size: 14px; }
        .doc-row strong { color: #6c5ce7; }
        .sig-pad { border: 2px dashed #ccc; border-radius: 8px; background: #fafafa; cursor: crosshair; touch-action: none; width: 100%; height: 150px; }
        .sig-pad.active { border-color: #6c5ce7; }
        .btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 12px; }
        .btn-primary { background: #6c5ce7; color: white; }
        .btn-primary:hover { background: #5a4bd1; }
        .btn-primary:disabled { background: #b8b0e0; cursor: not-allowed; }
        .btn-secondary { background: #e9ecef; color: #333; }
        .btn-secondary:hover { background: #dee2e6; }
        .input-text { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 15px; }
        .input-text:focus { outline: none; border-color: #6c5ce7; box-shadow: 0 0 0 3px rgba(108,92,231,0.15); }
        .auth-row { display: flex; gap: 10px; align-items: flex-start; padding: 12px; background: #fff8e1; border: 1px solid #ffe082; border-radius: 6px; margin-top: 12px; }
        .auth-row input[type="checkbox"] { width: 22px; height: 22px; flex-shrink: 0; margin-top: 1px; accent-color: #6c5ce7; }
        .auth-row label { font-size: 13px; line-height: 1.5; color: #5d4037; }
        .success { background: #d4edda; padding: 24px; border-radius: 12px; text-align: center; display: none; }
        .success h2 { color: #155724; }
        .legal { font-size: 11px; color: #999; text-align: center; margin-top: 16px; line-height: 1.4; }
    </style>
</head>
<body>
    <div id="formView">
        <div class="card">
            <h1>Sign Your Property Tax Protest</h1>
            <p class="subtitle">Washington State</p>
            <p class="subtitle" style="font-weight:600;color:#6c5ce7;">Petition to the ${county} County Board of Equalization</p>
        </div>

        <div class="card">
            <h2>📄 What You're Signing</h2>
            <div class="docs">
                <div class="doc-row"><strong>1. WA DOR Form 64-0075</strong> — Taxpayer Petition to the County Board of Equalization for Review of Real Property Valuation Determination.</div>
                <div class="doc-row"><strong>2. Letter of Authorization (LOA)</strong> — Appoints ${agentName} as your authorized agent to represent you in this appeal.</div>
            </div>
            <p style="font-size:13px;color:#666;margin-top:12px;">One signature applies to both documents.</p>
        </div>

        <div class="card">
            <h2>📋 Key Facts</h2>
            <div class="field"><label>Property Owner</label><div class="value">${ownerName}</div></div>
            <div class="field"><label>Property Address</label><div class="value">${address || 'See attached petition'}</div></div>
            <div class="field"><label>Parcel Number</label><div class="value">${parcel || 'See attached petition'}</div></div>
            <div class="field"><label>County</label><div class="value">${county} County, Washington</div></div>
            <div class="field"><label>Assessment Year</label><div class="value">${assessmentYear}</div></div>
            <div class="field"><label>Owner Opinion of Value</label><div class="value">${ownerOpinionFmt}</div></div>
            <div class="field"><label>Authorized Agent</label><div class="value">${agentName}</div></div>
            <div class="field"><label>Case Reference</label><div class="value">${caseId}</div></div>
        </div>

        <div class="card">
            <h2>✍️ Sign Below</h2>
            <div class="field">
                <label for="typedName">Type your full legal name</label>
                <input id="typedName" class="input-text" type="text" placeholder="e.g. ${ownerName}" value="${ownerName.replace(/"/g, '&quot;')}" autocomplete="name">
            </div>
            <p style="font-size:13px;color:#666;margin:12px 0 6px;">Draw your signature below using your finger or mouse. This same signature will appear on both documents:</p>
            <canvas id="sigCanvas" class="sig-pad"></canvas>
            <button class="btn btn-secondary" onclick="clearSig()" style="margin-top:8px;">Clear Signature</button>

            <div class="auth-row">
                <input type="checkbox" id="authCheck">
                <label for="authCheck">I authorize ${agentName} to represent me before the ${county} County Board of Equalization for the ${assessmentYear} assessment year, and I confirm the facts above are accurate to the best of my knowledge.</label>
            </div>
        </div>

        <button class="btn btn-primary" onclick="submitSignature()" id="submitBtn">
            Sign &amp; Submit Petition
        </button>

        <p class="legal">
            By signing, you authorize ${agentName} as your agent for property tax matters in Washington State. Your signature applies to WA DOR Form 64-0075 and the Letter of Authorization. This is a legally binding electronic signature under the Washington Uniform Electronic Transactions Act (RCW 1.80).
            <br><br>Today's date: ${todayStr}
        </p>
    </div>

    <div class="success" id="successView">
        <h2>✅ Successfully Signed!</h2>
        <p>Your petition (Form 64-0075) and Letter of Authorization have been signed and submitted to ${agentName}.</p>
        <p>We'll review your file and submit your protest to the ${county} County Board of Equalization. We'll keep you posted on the hearing date.</p>
        <div id="pdfLinks" style="margin-top:20px;"></div>
        <p style="color:#666;font-size:14px;margin-top:16px;">A confirmation will be sent to your email. You may close this page.</p>
    </div>

    <script>
        const canvas = document.getElementById('sigCanvas');
        const ctx = canvas.getContext('2d');
        let drawing = false;
        let hasSig = false;

        function resizeCanvas() {
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * 2;
            canvas.height = rect.height * 2;
            ctx.scale(2, 2);
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
        }
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        function getPos(e) {
            const rect = canvas.getBoundingClientRect();
            const touch = e.touches ? e.touches[0] : e;
            return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
        }

        canvas.addEventListener('pointerdown', (e) => {
            drawing = true; hasSig = true;
            canvas.classList.add('active');
            const pos = getPos(e);
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            e.preventDefault();
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!drawing) return;
            const pos = getPos(e);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            e.preventDefault();
        });
        canvas.addEventListener('pointerup', () => { drawing = false; canvas.classList.remove('active'); });
        canvas.addEventListener('pointerleave', () => { drawing = false; canvas.classList.remove('active'); });

        function clearSig() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            hasSig = false;
        }

        async function submitSignature() {
            if (!hasSig) { alert('Please draw your signature first.'); return; }
            const typedName = document.getElementById('typedName').value.trim();
            if (!typedName) { alert('Please type your full legal name.'); return; }
            if (!document.getElementById('authCheck').checked) { alert('Please confirm the authorization checkbox.'); return; }

            const btn = document.getElementById('submitBtn');
            btn.textContent = 'Submitting...';
            btn.disabled = true;

            const sigData = canvas.toDataURL('image/png');
            try {
                const resp = await fetch(window.location.pathname + '/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        signature_data: sigData,
                        signer_role: 'property_owner',
                        typed_name: typedName,
                        authorized: true
                    })
                });
                const result = await resp.json();
                if (result.success) {
                    document.getElementById('formView').style.display = 'none';
                    document.getElementById('successView').style.display = 'block';
                    if (result.signed_pdf_url) {
                        document.getElementById('pdfLinks').innerHTML =
                            '<a href="' + result.signed_pdf_url + '" target="_blank" style="display:inline-block;background:#6c5ce7;color:white;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;margin-right:10px;">📄 View Signed Package</a>' +
                            '<a href="' + result.signed_pdf_url + '" download style="display:inline-block;background:#e9ecef;color:#333;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;">⬇️ Download PDF</a>';
                    }
                } else {
                    alert('Error: ' + (result.detail || result.error || 'Submission failed. Please try again.'));
                    btn.textContent = 'Sign & Submit Petition';
                    btn.disabled = false;
                }
            } catch (err) {
                alert('Network error. Please check your connection and try again.');
                btn.textContent = 'Sign & Submit Petition';
                btn.disabled = false;
            }
        }
    </script>
</body>
</html>`;
    }

    // ====== Default (TX/GA) UI — UNCHANGED ======
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>OverAssessed - Sign Form 50-162</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; background: #f5f5f5; color: #333; }
        .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        h1 { color: #6c5ce7; text-align: center; margin: 0 0 4px; font-size: 26px; }
        .subtitle { text-align: center; color: #666; margin-bottom: 20px; }
        h2 { color: #333; font-size: 18px; margin: 0 0 16px; }
        .field { margin-bottom: 12px; }
        .field label { display: block; font-weight: 600; color: #555; font-size: 13px; margin-bottom: 4px; }
        .field .value { padding: 10px 12px; background: #f8f9fa; border-radius: 6px; border: 1px solid #e9ecef; }
        .checklist { list-style: none; padding: 0; }
        .checklist li { padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
        .checklist li:last-child { border: none; }
        .checklist li::before { content: "☑️ "; }
        .sig-pad { border: 2px dashed #ccc; border-radius: 8px; background: #fafafa; cursor: crosshair; touch-action: none; width: 100%; height: 150px; }
        .sig-pad.active { border-color: #6c5ce7; }
        .btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 12px; }
        .btn-primary { background: #6c5ce7; color: white; }
        .btn-primary:hover { background: #5a4bd1; }
        .btn-secondary { background: #e9ecef; color: #333; }
        .btn-secondary:hover { background: #dee2e6; }
        .role-select { display: flex; gap: 8px; flex-wrap: wrap; }
        .role-option { flex: 1; min-width: 140px; }
        .role-option input { display: none; }
        .role-option label { display: block; padding: 10px; border: 2px solid #e9ecef; border-radius: 8px; text-align: center; cursor: pointer; font-size: 13px; }
        .role-option input:checked + label { border-color: #6c5ce7; background: #f0eeff; color: #6c5ce7; font-weight: 600; }
        .success { background: #d4edda; padding: 24px; border-radius: 12px; text-align: center; display: none; }
        .success h2 { color: #155724; }
        .legal { font-size: 11px; color: #999; text-align: center; margin-top: 16px; line-height: 1.4; }
    </style>
</head>
<body>
    <div id="formView">
        <div class="card">
            <h1>OverAssessed</h1>
            <p class="subtitle">Appointment of Agent for Property Tax Matters</p>
        </div>

        <div class="card">
            <h2>📋 Form 50-162 Summary</h2>
            <div class="field"><label>Property Owner</label><div class="value">${ownerName}</div></div>
            <div class="field"><label>Property Address</label><div class="value">${address || 'See attached form'}</div></div>
            <div class="field"><label>Case Reference</label><div class="value">${caseId}</div></div>
        </div>

        <div class="card">
            <h2>✅ What You're Authorizing</h2>
            <ul class="checklist">
                <li>OverAssessed LLC to represent you in all property tax matters</li>
                <li>Agent receives confidential property tax information on your behalf</li>
                <li>All communications from the chief appraiser delivered to agent</li>
                <li>All communications from the appraisal review board delivered to agent</li>
                <li>All communications from taxing units delivered to agent</li>
                <li>Authorization continues until otherwise notified</li>
            </ul>
        </div>

        <div class="card">
            <h2>👤 I am signing as:</h2>
            <div class="role-select">
                <div class="role-option">
                    <input type="radio" name="role" id="role_owner" value="property_owner" checked>
                    <label for="role_owner">Property Owner</label>
                </div>
                <div class="role-option">
                    <input type="radio" name="role" id="role_manager" value="property_manager">
                    <label for="role_manager">Property Manager</label>
                </div>
                <div class="role-option">
                    <input type="radio" name="role" id="role_other" value="authorized_person">
                    <label for="role_other">Authorized Person</label>
                </div>
            </div>
        </div>

        <div class="card">
            <h2>✍️ Your Signature</h2>
            <p style="font-size:13px;color:#666;">Draw your signature below using your finger or mouse:</p>
            <canvas id="sigCanvas" class="sig-pad"></canvas>
            <button class="btn btn-secondary" onclick="clearSig()" style="margin-top:8px;">Clear Signature</button>
        </div>

        <button class="btn btn-primary" onclick="submitSignature()" id="submitBtn">
            Sign &amp; Submit Form 50-162
        </button>

        <p class="legal">
            By signing, you authorize OverAssessed LLC as your agent for property tax matters
            per Texas Tax Code §1.111. This is a legally binding electronic signature under
            the Texas Uniform Electronic Transactions Act (Tex. Bus. &amp; Com. Code §322).
            <br><br>Today's date: ${new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'})}
        </p>
    </div>

    <div class="success" id="successView">
        <h2>✅ Successfully Signed!</h2>
        <p>Your Form 50-162 has been signed and submitted to OverAssessed LLC.</p>
        <p>We'll begin working on your property tax protest right away.</p>
        <div id="pdfLinks" style="margin-top:20px;"></div>
        <p style="color:#666;font-size:14px;margin-top:16px;">A confirmation will be sent to your email. You may close this page.</p>
    </div>

    <script>
        const canvas = document.getElementById('sigCanvas');
        const ctx = canvas.getContext('2d');
        let drawing = false;
        let hasSig = false;

        function resizeCanvas() {
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * 2;
            canvas.height = rect.height * 2;
            ctx.scale(2, 2);
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
        }
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        function getPos(e) {
            const rect = canvas.getBoundingClientRect();
            const touch = e.touches ? e.touches[0] : e;
            return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
        }

        canvas.addEventListener('pointerdown', (e) => {
            drawing = true;
            hasSig = true;
            canvas.classList.add('active');
            const pos = getPos(e);
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            e.preventDefault();
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!drawing) return;
            const pos = getPos(e);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            e.preventDefault();
        });

        canvas.addEventListener('pointerup', () => { drawing = false; canvas.classList.remove('active'); });
        canvas.addEventListener('pointerleave', () => { drawing = false; canvas.classList.remove('active'); });

        function clearSig() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            hasSig = false;
        }

        async function submitSignature() {
            if (!hasSig) { alert('Please draw your signature first.'); return; }

            const btn = document.getElementById('submitBtn');
            btn.textContent = 'Submitting...';
            btn.disabled = true;

            const sigData = canvas.toDataURL('image/png');
            const role = document.querySelector('input[name="role"]:checked').value;

            try {
                const resp = await fetch(window.location.pathname + '/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ signature_data: sigData, signer_role: role })
                });
                const result = await resp.json();

                if (result.success) {
                    document.getElementById('formView').style.display = 'none';
                    document.getElementById('successView').style.display = 'block';
                    if (result.signed_pdf_url) {
                        document.getElementById('pdfLinks').innerHTML =
                            '<a href="' + result.signed_pdf_url + '" target="_blank" style="display:inline-block;background:#6c5ce7;color:white;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;margin-right:10px;">📄 View Signed Document</a>' +
                            '<a href="' + result.signed_pdf_url + '" download style="display:inline-block;background:#e9ecef;color:#333;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;">⬇️ Download PDF</a>';
                    }
                } else {
                    alert('Error: ' + (result.detail || result.error || 'Submission failed. Please try again.'));
                    btn.textContent = 'Sign & Submit Form 50-162';
                    btn.disabled = false;
                }
            } catch (err) {
                alert('Network error. Please check your connection and try again.');
                btn.textContent = 'Sign & Submit Form 50-162';
                btn.disabled = false;
            }
        }
    </script>
</body>
</html>`;
}

// POST /api/esign/send — generate token + send signing link to customer
router.post('/send', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { case_id, email, phone, owner_name } = req.body;
        if (!case_id || !email) return res.status(400).json({ error: 'case_id and email required' });

        const token = crypto.randomBytes(32).toString('hex');
        const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const { data: tokenRow, error: tokenErr } = await supabaseAdmin
            .from('esign_tokens')
            .insert({ case_id, token, signer_name: owner_name || null, signer_email: email, status: 'pending', expires_at, created_at: new Date().toISOString() })
            .select().single();
        if (tokenErr) throw tokenErr;

        const baseUrl = process.env.BASE_URL || 'https://overassessed.ai';
        const sign_url = `${baseUrl}/sign/${token}`;

        await supabaseAdmin.from('submissions').update({
            status: 'Awaiting Signature',
            last_activity_at: new Date().toISOString()
        }).eq('case_id', case_id);

        await supabaseAdmin.from('activity_log').insert({
            case_id, actor: 'tyler', action: 'esign_sent',
            details: { sign_url, email, token: token.slice(0, 8) + '...' }
        }).catch(() => {});

        const sgMail = require('@sendgrid/mail');
        if (process.env.SENDGRID_API_KEY) {
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            const firstName = (owner_name || 'there').split(' ')[0];
            try {
                await sgMail.send({
                    to: email,
                    from: { email: process.env.SENDGRID_FROM_EMAIL || 'notifications@overassessed.ai', name: 'OverAssessed' },
                    replyTo: { email: 'tyler@reply.overassessed.ai', name: 'Tyler Worthey' },
                    subject: `Sign Your Authorization — ${case_id}`,
                    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                        <h2 style="color:#6c5ce7;">Your Tax Protest Authorization</h2>
                        <p>Hi ${firstName},</p>
                        <p>Your property tax savings analysis is complete. To authorize us to file your protest, please sign Form 50-162 using the link below.</p>
                        <p style="text-align:center;margin:28px 0;">
                            <a href="${sign_url}" style="background:#6c5ce7;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Sign Form 50-162</a>
                        </p>
                        <p style="color:#666;font-size:13px;">This link is valid for 30 days. If you have questions, reply to this email.</p>
                        <p>— Tyler Worthey<br>OverAssessed</p>
                    </div>`
                });
            } catch (emailErr) {
                console.error('[esign/send] Email failed:', emailErr.message);
            }
        }

        if (phone) {
            try {
                const twilio = require('twilio');
                const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                const toNum = phone.startsWith('+') ? phone : '+1' + phone.replace(/\D/g, '');
                await client.messages.create({
                    body: `Hi ${(owner_name||'').split(' ')[0] || 'there'}, your OverAssessed authorization is ready to sign: ${sign_url}`,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: toNum
                });
            } catch (smsErr) {
                console.error('[esign/send] SMS failed:', smsErr.message);
            }
        }

        res.json({ ok: true, sign_url, token: tokenRow.token, expires_at, status: 'Awaiting Signature' });
    } catch (err) {
        console.error('[esign/send] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
