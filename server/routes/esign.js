const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');
const crypto = require('crypto');

// Generate signing token for a case
router.post('/generate', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { case_id, signer_name, signer_email } = req.body;
        if (!case_id) return res.status(400).json({ error: 'case_id required' });

        const token = crypto.randomBytes(32).toString('hex');
        const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

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
        if (signData.status === 'signed') return res.status(200).send(signingPage('already_signed', signData));
        if (new Date(signData.expires_at) < new Date()) return res.status(410).send(signingPage('expired'));

        // Fetch submission separately (no FK relationship needed)
        let sub = null;
        if (signData.case_id) {
            const { data: subData } = await supabaseAdmin
                .from('submissions')
                .select('owner_name, property_address, county, state, estimated_savings, assessed_value')
                .eq('case_id', signData.case_id)
                .maybeSingle();
            sub = subData;
        }

        res.send(signingPage('ready', signData, sub));
    } catch (err) {
        res.status(500).send('Server error: ' + err.message);
    }
});

// POST signature submission
router.post('/:token/submit', express.json(), async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { token } = req.params;
        const { signature_data, signer_role } = req.body;

        if (!signature_data) return res.status(400).json({ error: 'Signature required' });

        const { data: signData, error: fetchErr } = await supabaseAdmin
            .from('esign_tokens')
            .select('*')
            .eq('token', token)
            .single();

        if (fetchErr || !signData) return res.status(404).json({ error: 'Invalid token' });
        if (signData.status === 'signed') return res.status(409).json({ error: 'Already signed' });
        if (new Date(signData.expires_at) < new Date()) return res.status(410).json({ error: 'Link expired' });

        // Update token record
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

        // Update submission record
        const { error: subErr } = await supabaseAdmin
            .from('submissions')
            .update({
                fee_agreement_signed: true,
                fee_agreement_signed_at: new Date().toISOString(),
                status: 'SIGNED_READY_TO_FILE'
            })
            .eq('case_id', signData.case_id);

        if (subErr) console.error('Failed to update submission:', subErr);

        res.json({ success: true, message: 'Document signed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
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

function signingPage(state, signData = null, sub = null) {
    const logo = `<div style="text-align:center;margin-bottom:24px;">
        <h1 style="color:#6c5ce7;margin:0;font-size:28px;">OverAssessed</h1>
        <p style="color:#666;margin:4px 0;">Property Tax Protest Services</p>
    </div>`;

    if (state === 'not_found') return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OverAssessed - Sign</title></head><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:40px auto;padding:20px;">${logo}<div style="background:#fee;padding:20px;border-radius:8px;text-align:center;"><h2>Document Not Found</h2><p>This signing link is invalid or has been removed.</p></div></body></html>`;
    if (state === 'expired') return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OverAssessed - Expired</title></head><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:40px auto;padding:20px;">${logo}<div style="background:#fff3cd;padding:20px;border-radius:8px;text-align:center;"><h2>Link Expired</h2><p>This signing link has expired. Please contact OverAssessed for a new link.</p></div></body></html>`;
    if (state === 'already_signed') return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OverAssessed - Signed</title></head><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:40px auto;padding:20px;">${logo}<div style="background:#d4edda;padding:20px;border-radius:8px;text-align:center;"><h2>✅ Already Signed</h2><p>This document was signed on ${signData.signed_at ? new Date(signData.signed_at).toLocaleDateString() : 'a previous date'}.</p><p>No further action needed. Thank you!</p></div></body></html>`;

    const ownerName = sub ? sub.owner_name : (signData.signer_name || 'Property Owner');
    const address = sub ? sub.property_address : '';
    const caseId = signData.case_id || '';

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
            Sign & Submit Form 50-162
        </button>

        <p class="legal">
            By signing, you authorize OverAssessed LLC as your agent for property tax matters
            per Texas Tax Code §1.111. This is a legally binding electronic signature under
            the Texas Uniform Electronic Transactions Act (Tex. Bus. & Com. Code §322).
            <br><br>Today's date: ${new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'})}
        </p>
    </div>

    <div class="success" id="successView">
        <h2>✅ Successfully Signed!</h2>
        <p>Your Form 50-162 has been signed and submitted to OverAssessed LLC.</p>
        <p>We'll begin working on your property tax protest right away.</p>
        <p style="color:#666;font-size:14px;margin-top:20px;">A confirmation will be sent to your email. You may close this page.</p>
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
                } else {
                    alert(result.error || 'Error submitting. Please try again.');
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
// Also sets case status to AWAITING_SIGNATURE
router.post('/send', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { case_id, email, phone, owner_name } = req.body;
        if (!case_id || !email) return res.status(400).json({ error: 'case_id and email required' });

        // Generate signing token (30-day expiry)
        const crypto = require('crypto');
        const token = crypto.randomBytes(32).toString('hex');
        const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const { data: tokenRow, error: tokenErr } = await supabaseAdmin
            .from('esign_tokens')
            .insert({ case_id, token, signer_name: owner_name || null, signer_email: email, status: 'pending', expires_at, created_at: new Date().toISOString() })
            .select().single();
        if (tokenErr) throw tokenErr;

        const baseUrl = process.env.BASE_URL || 'https://overassessed.ai';
        const sign_url = `${baseUrl}/sign/${token}`;

        // Update case status to AWAITING_SIGNATURE
        await supabaseAdmin.from('submissions').update({
            status: 'Awaiting Signature',
            last_activity_at: new Date().toISOString()
        }).eq('case_id', case_id);

        // Log activity
        await supabaseAdmin.from('activity_log').insert({
            case_id, actor: 'tyler', action: 'esign_sent',
            details: { sign_url, email, token: token.slice(0, 8) + '...' }
        }).catch(() => {});

        // Send email with signing link
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

        // Send SMS if phone provided
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
