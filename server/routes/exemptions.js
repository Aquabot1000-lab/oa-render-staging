const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');
const { sendNotificationSMS, sendNotificationEmail } = require('../server-notifications');

// Exemption file upload setup
const exemptionUploadsDir = path.join(__dirname, '..', 'uploads', 'exemptions');
const exemptionStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        await fs.mkdir(exemptionUploadsDir, { recursive: true });
        cb(null, exemptionUploadsDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const uploadExemption = multer({
    storage: exemptionStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only PDF, JPG, PNG files are allowed'));
    }
});

// ==================== CRUD (auth required — mounted at /api/db/exemptions) ====================

// GET /api/db/exemptions
router.get('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        // Join client + property data for admin display
        const { data, error } = await supabaseAdmin
            .from('exemptions')
            .select('*, clients(name, email, phone), properties(address, state)')
            .order('created_at', { ascending: false });
        if (error) throw error;
        // Flatten for frontend
        const flat = (data || []).map(e => ({
            ...e,
            clientName: e.clients?.name,
            email: e.clients?.email,
            phone: e.clients?.phone,
            propertyAddress: e.properties?.address,
            state: e.state || e.properties?.state
        }));
        res.json(flat);
    } catch (err) {
        console.error('[Exemptions] GET error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/db/exemptions/:id (skip non-UUID paths like /intake)
router.get('/:id', (req, res, next) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
        return res.status(404).json({ error: 'Not found' });
    }
    next();
}, async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabaseAdmin
            .from('exemptions')
            .select('*, clients(name, email, phone), properties(address, state)')
            .eq('id', req.params.id)
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Exemption not found' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/db/exemptions
router.post('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { client_id, property_id, exemption_type, status, filing_date, outcome, notes } = req.body;
        if (!exemption_type) return res.status(400).json({ error: 'Exemption type required' });

        const { data, error } = await supabaseAdmin
            .from('exemptions')
            .insert({ client_id, property_id, exemption_type, status: status || 'pending', filing_date, outcome, notes })
            .select()
            .single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/db/exemptions/:id — with status-triggered notifications
router.patch('/:id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const newStatus = req.body.status;
        
        // Get current exemption with client info before updating
        let exemption = null;
        if (newStatus) {
            const { data: existing } = await supabaseAdmin
                .from('exemptions')
                .select('*, clients(name, email, phone), properties(address, state)')
                .eq('id', req.params.id)
                .single();
            exemption = existing;
        }

        const { data, error } = await supabaseAdmin
            .from('exemptions')
            .update(req.body)
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) throw error;

        // Send status-triggered notifications
        if (newStatus && exemption && exemption.clients) {
            const client = exemption.clients;
            const property = exemption.properties;
            const exType = exemption.exemption_type || 'homestead';
            const addr = property?.address || 'your property';
            
            try {
                await sendExemptionStatusNotification(newStatus, client, exType, addr, req.body);
            } catch (notifErr) {
                console.error('[Exemptions] Notification error:', notifErr.message);
            }
        }

        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== STATUS NOTIFICATION EMAILS ====================

async function sendExemptionStatusNotification(status, client, exType, addr, extras) {
    const templates = {
        'docs_needed': {
            subject: `Action Needed: Documents Required for Your ${exType} Exemption`,
            sms: `OverAssessed: We need a few documents to file your ${exType} exemption for ${addr}. Please check your email for details.`,
            html: buildExemptionEmail('Documents Needed 📄', `${exType} Exemption`, `
                <p>Hi ${client.name},</p>
                <p>We're working on filing your <strong>${exType}</strong> exemption for <strong>${addr}</strong>, but we need a few documents to proceed:</p>
                <div style="background:#fff8e1;border:2px solid #ffd54f;border-radius:8px;padding:20px;margin:20px 0;">
                    <p style="margin:0;font-weight:700;color:#f57f17;">📋 Required Documents:</p>
                    <p style="margin:8px 0 0;">${extras?.docsNeededNote || 'Please provide your ID, proof of residency, and any supporting documentation.'}</p>
                </div>
                <p>You can reply to this email with your documents attached, or upload them at our website.</p>
                <p>Questions? Call us at (888) 282-9165.</p>
            `)
        },
        'filed': {
            subject: `Great News — Your ${exType} Exemption Has Been Filed!`,
            sms: `OverAssessed: We've filed your ${exType} exemption for ${addr}! We'll let you know when it's confirmed.`,
            html: buildExemptionEmail('Exemption Filed! 📤', `${exType} Exemption`, `
                <p>Hi ${client.name},</p>
                <p>Great news — we've officially filed your <strong>${exType}</strong> exemption for <strong>${addr}</strong> with the appraisal district.</p>
                <div style="background:#e8f5e9;border:2px solid #66bb6a;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
                    <p style="margin:0;font-size:1.2rem;font-weight:700;color:#2e7d32;">✅ Your exemption has been filed!</p>
                    <p style="margin:8px 0 0;color:#4a5568;">We'll notify you once it's confirmed by the appraisal district.</p>
                </div>
                <p>This typically takes 2-4 weeks for the county to process. We'll monitor it and let you know as soon as it's confirmed.</p>
            `)
        },
        'confirmed': {
            subject: `🎉 Your ${exType} Exemption Has Been Approved!`,
            sms: `OverAssessed: Your ${exType} exemption for ${addr} has been approved! 🎉 Check your email for savings details.`,
            html: buildExemptionEmail('Exemption Approved! 🎉', `${exType} Exemption`, `
                <p>Hi ${client.name},</p>
                <p>Wonderful news — your <strong>${exType}</strong> exemption for <strong>${addr}</strong> has been <strong>approved</strong>!</p>
                ${extras?.estimatedSavings ? `
                <div style="background:#f8f9ff;border:2px solid #00b894;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
                    <p style="margin:0 0 5px;color:#6b7280;">Estimated Annual Tax Savings</p>
                    <p style="margin:0;font-size:32px;font-weight:800;color:#00b894;">$${Number(extras.estimatedSavings).toLocaleString()}/yr</p>
                </div>` : ''}
                <p>Your property taxes will reflect this exemption on your next tax bill. Congratulations! 🎊</p>
                <p>Know someone who might be missing out on exemptions? <a href="https://overassessed.ai/referrals" style="color:#6c5ce7;font-weight:700;">Refer them and earn rewards!</a></p>
            `)
        },
        'denied': {
            subject: `Update on Your ${exType} Exemption Application`,
            sms: `OverAssessed: Unfortunately your ${exType} exemption for ${addr} was not approved. We'll contact you about next steps.`,
            html: buildExemptionEmail('Exemption Update', `${exType} Exemption`, `
                <p>Hi ${client.name},</p>
                <p>Unfortunately, your <strong>${exType}</strong> exemption application for <strong>${addr}</strong> was not approved by the appraisal district.</p>
                <p>Don't worry — our team will review the denial and contact you about potential next steps, including appeal options.</p>
                <p>Questions? Call us at (888) 282-9165.</p>
            `)
        }
    };

    const template = templates[status];
    if (!template) return;

    // Send email to client
    if (client.email) {
        try {
            const sgMail = require('@sendgrid/mail');
            if (process.env.SENDGRID_API_KEY) {
                sgMail.setApiKey(process.env.SENDGRID_API_KEY);
                await sgMail.send({
                    to: client.email,
                    from: process.env.SENDGRID_FROM_EMAIL || 'notifications@overassessed.ai',
                    subject: template.subject,
                    html: template.html
                });
            }
        } catch (e) { console.error('[Exemptions] Client email failed:', e.message); }
    }

    // Send SMS to client
    if (client.phone) {
        try {
            const twilio = require('twilio');
            if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
                const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                let cleaned = client.phone.replace(/\D/g, '');
                if (cleaned.length === 10) cleaned = '1' + cleaned;
                if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
                await twilioClient.messages.create({
                    body: template.sms,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: cleaned
                });
            }
        } catch (e) { console.error('[Exemptions] Client SMS failed:', e.message); }
    }

    // Also notify admin
    sendNotificationSMS(`📋 Exemption ${status}: ${client.name} — ${exType} @ ${addr}`);
}

function buildExemptionEmail(title, subtitle, bodyHtml) {
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #6c5ce7, #0984e3); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">${title}</h1>
            ${subtitle ? `<p style="margin: 8px 0 0; opacity: 0.9;">${subtitle}</p>` : ''}
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
            ${bodyHtml}
        </div>
        <div style="background: #1a1a2e; color: white; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; font-size: 13px; opacity: 0.8;">
            OverAssessed, LLC — San Antonio, Texas<br>
            Questions? Reply to this email or call (888) 282-9165
        </div>
    </div>`;
}

// ==================== PUBLIC INTAKE ====================
// POST /api/exemptions/intake — public, accepts file uploads
router.post('/intake', uploadExemption.array('documents', 10), async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { ownerName, email, phone, propertyAddress, state, exemptionType, 
                currentExemptions, crossSellProtest, propertyType, yearPurchased, 
                existingExemptions,
                waAge61, waDisability, waVeteran, waIncome, waCounty } = req.body;
        
        if (!ownerName || !email || !propertyAddress || !exemptionType) {
            return res.status(400).json({ error: 'ownerName, email, propertyAddress, and exemptionType are required' });
        }

        // Upsert client by email
        let clientId;
        const { data: existingClient } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('email', email.toLowerCase())
            .single();

        if (existingClient) {
            clientId = existingClient.id;
        } else {
            const { data: newClient, error: clientErr } = await supabaseAdmin
                .from('clients')
                .insert({ name: ownerName, email: email.toLowerCase(), phone: phone || null })
                .select('id')
                .single();
            if (clientErr) throw clientErr;
            clientId = newClient.id;
        }

        // Create property record
        const { data: property, error: propErr } = await supabaseAdmin
            .from('properties')
            .insert({ 
                client_id: clientId, 
                address: propertyAddress, 
                state: state || 'TX',
                property_type: propertyType || null
            })
            .select('id')
            .single();
        if (propErr) throw propErr;

        // Build notes JSON with extra fields
        const notesData = {};
        if (currentExemptions) notesData.currentExemptions = currentExemptions;
        if (yearPurchased) notesData.yearPurchased = yearPurchased;
        if (existingExemptions) notesData.existingExemptions = existingExemptions;
        // WA-specific fields
        if (state === 'WA' && exemptionType === 'WA Senior/Disabled') {
            notesData.wa_age_61_plus = waAge61 || null;
            notesData.wa_disability_status = waDisability || null;
            notesData.wa_veteran_status = waVeteran || null;
            notesData.wa_income_range = waIncome || null;
            notesData.wa_county = waCounty || null;
        }
        if (state === 'WA' && waCounty) {
            notesData.wa_county = waCounty;
        }

        // Create exemption record
        const exemptionRow = {
            client_id: clientId,
            property_id: property.id,
            exemption_type: exemptionType,
            status: 'received',
            state: state || 'TX',
            county: (state === 'WA' && waCounty) ? waCounty : null,
            notes: Object.keys(notesData).length ? JSON.stringify(notesData) : null
        };
        // WA-specific columns
        if (state === 'WA' && exemptionType === 'WA Senior/Disabled') {
            exemptionRow.wa_age_61_plus = waAge61 || null;
            exemptionRow.wa_disability_status = waDisability || null;
            exemptionRow.wa_veteran_status = waVeteran || null;
            exemptionRow.wa_income_range = waIncome || null;
        }
        const { data: exemption, error: exErr } = await supabaseAdmin
            .from('exemptions')
            .insert(exemptionRow)
            .select('id')
            .single();
        if (exErr) throw exErr;

        // Store uploaded documents
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const filePath = `/uploads/exemptions/${file.filename}`;
                try {
                    await supabaseAdmin.from('documents').insert({
                        client_id: clientId,
                        property_id: property.id,
                        type: 'exemption_support',
                        url: filePath,
                        filename: file.originalname,
                        metadata: JSON.stringify({ exemption_id: exemption.id, size: file.size, mimetype: file.mimetype })
                    });
                } catch (docErr) {
                    console.error('[Exemptions] Doc insert error:', docErr.message);
                }
            }
        }

        // Cross-sell: create protest lead if checkbox was checked
        if (crossSellProtest === 'true' || crossSellProtest === true) {
            try {
                // Read existing submissions to get next case ID (mimics /api/intake)
                const counterPath = path.join(__dirname, '..', 'counter.json');
                let counter;
                try { counter = JSON.parse(await fs.readFile(counterPath, 'utf8')); } 
                catch { counter = { lastCaseNumber: 0 }; }
                counter.lastCaseNumber++;
                await fs.writeFile(counterPath, JSON.stringify(counter));
                const caseId = `OA-${String(counter.lastCaseNumber).padStart(4, '0')}`;

                const stateDir = { 'GA': 'ga', 'WA': 'wa', 'TX': 'tx' }[(state || 'TX').toUpperCase()] || 'tx';
                const submissionsPath = path.join(__dirname, '..', 'data', stateDir, 'submissions.json');
                let submissions = [];
                try { submissions = JSON.parse(await fs.readFile(submissionsPath, 'utf8')); } catch {}
                
                const { v4: uuidv4 } = require('uuid');
                const newSubmission = {
                    id: uuidv4(),
                    caseId,
                    ownerName,
                    email,
                    phone: phone || '',
                    propertyAddress,
                    propertyType: propertyType || 'Single Family',
                    assessedValue: '',
                    state: state || 'TX',
                    source: 'exemption-crosssell',
                    status: 'New',
                    createdAt: new Date().toISOString(),
                    notes: [{ text: `Cross-sell from exemption intake (${exemptionType})`, author: 'System', createdAt: new Date().toISOString() }]
                };
                submissions.push(newSubmission);
                await fs.writeFile(submissionsPath, JSON.stringify(submissions, null, 2));
                console.log(`[Exemptions] Cross-sell protest lead created: ${caseId}`);
            } catch (crossErr) {
                console.error('[Exemptions] Cross-sell error:', crossErr.message);
            }
        }

        // Send notification to Tyler (non-blocking)
        const fileCount = req.files ? req.files.length : 0;
        const waInfo = (state === 'WA' && exemptionType === 'WA Senior/Disabled') 
            ? `\n🌲 WA Details: Age61+=${waAge61||'?'}, Disabled=${waDisability||'?'}, Vet=${waVeteran||'?'}, Income=${waIncome||'?'}, County=${waCounty||'?'}` : '';
        const notifMsg = `🏠 New Exemption Intake!\nName: ${ownerName}\nEmail: ${email}\nProperty: ${propertyAddress}\nType: ${exemptionType}\nDocs: ${fileCount} file(s)${waInfo}${crossSellProtest === 'true' ? '\n📊 Cross-sell protest lead created!' : ''}`;
        try {
            sendNotificationSMS(notifMsg);
            sendNotificationEmail(`New Exemption Intake: ${ownerName}`,
                `<p><strong>${ownerName}</strong> submitted an exemption intake.</p>
                <p>Email: ${email}<br>Phone: ${phone || 'N/A'}<br>Property: ${propertyAddress}<br>Type: ${exemptionType}<br>Documents: ${fileCount} file(s)</p>
                ${crossSellProtest === 'true' ? '<p>📊 <strong>Cross-sell:</strong> Protest lead also created.</p>' : ''}`);
        } catch (e) {
            console.log('[Exemptions] Notification helpers not available:', e.message);
        }

        res.status(201).json({ success: true, exemption_id: exemption.id });
    } catch (err) {
        console.error('[Exemptions] Intake error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==================== FORM GENERATION ====================
// GET /api/exemptions/:id/generate-form
router.get('/:id/generate-form', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { generateExemptionForm } = require('../services/exemption-form-generator');
        
        // Get exemption with client + property data
        const { data: exemption, error } = await supabaseAdmin
            .from('exemptions')
            .select('*, clients(name, email, phone), properties(address, state)')
            .eq('id', req.params.id)
            .single();
        if (error) throw error;
        if (!exemption) return res.status(404).json({ error: 'Exemption not found' });

        const pdfPath = await generateExemptionForm(exemption);
        
        // Store document reference
        try {
            await supabaseAdmin.from('documents').insert({
                client_id: exemption.client_id,
                property_id: exemption.property_id,
                type: 'exemption_form',
                url: pdfPath,
                filename: `TX-50-114-${exemption.id}.pdf`,
                metadata: JSON.stringify({ exemption_id: exemption.id, generated_at: new Date().toISOString() })
            });
        } catch (docErr) {
            console.error('[Exemptions] Doc insert error:', docErr.message);
        }

        // Return the PDF
        const fullPath = path.join(__dirname, '..', pdfPath);
        res.download(fullPath);
    } catch (err) {
        console.error('[Exemptions] Form generation error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
