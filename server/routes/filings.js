const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');
const { generateForm, COUNTY_PORTALS } = require('../services/form-generator');
const { sendFilingNotification } = require('../services/notifications');
const { fetchPropertyData } = require('../services/property-data');
const { findComparables } = require('../services/comp-engine');

// GET /api/filings/stats — must be before /:id
router.get('/stats', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabaseAdmin
            .from('filings')
            .select('status, county, state, savings, original_value, final_value, created_at');
        if (error) throw error;

        const byStatus = {};
        const byCounty = {};
        let totalSavings = 0;
        let totalFilings = data.length;

        for (const f of data) {
            byStatus[f.status] = (byStatus[f.status] || 0) + 1;
            if (f.county) byCounty[f.county] = (byCounty[f.county] || 0) + 1;
            totalSavings += parseFloat(f.savings) || 0;
        }

        res.json({ totalFilings, byStatus, byCounty, totalSavings, portalLinks: COUNTY_PORTALS });
    } catch (err) {
        console.error('[Filings] Stats error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/filings — list all with filters
router.get('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        let query = supabaseAdmin
            .from('filings')
            .select('*, clients(name, email, phone), properties(address, city, state, county, current_assessed_value), appeals(case_id)');

        if (req.query.county) query = query.eq('county', req.query.county.toLowerCase());
        if (req.query.status) query = query.eq('status', req.query.status);
        if (req.query.state) query = query.eq('state', req.query.state.toUpperCase());
        if (req.query.from) query = query.gte('created_at', req.query.from);
        if (req.query.to) query = query.lte('created_at', req.query.to);

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('[Filings] GET error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/filings/:id
router.get('/:id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabaseAdmin
            .from('filings')
            .select('*, clients(name, email, phone, address, city, state, zip), properties(address, city, state, county, property_type, current_assessed_value), appeals(case_id, status, analysis_report, evidence_packet_path)')
            .eq('id', req.params.id)
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Filing not found' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/filings — create
router.post('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const {
            client_id, property_id, appeal_id, county, state,
            portal_url, portal_pin, portal_account_id,
            original_value, notes
        } = req.body;

        if (!client_id || !property_id) {
            return res.status(400).json({ error: 'client_id and property_id required' });
        }

        // Auto-set portal URL from county
        const countyLower = (county || '').toLowerCase();
        const autoPortalUrl = portal_url || COUNTY_PORTALS[countyLower] || null;

        const { data, error } = await supabaseAdmin
            .from('filings')
            .insert({
                client_id,
                property_id,
                appeal_id: appeal_id || null,
                county: countyLower || null,
                state: (state || 'TX').toUpperCase(),
                status: 'draft',
                portal_url: autoPortalUrl,
                portal_pin: portal_pin || null,
                portal_account_id: portal_account_id || null,
                original_value: original_value || null,
                notes: notes || null
            })
            .select('*, clients(name, email), properties(address)')
            .single();

        if (error) throw error;

        // Send filing created notification
        if (data?.clients?.email) {
            sendFilingNotification(data.clients.email, 'filing_created', {
                name: data.clients.name || 'there',
                propertyAddress: data.properties?.address || '',
                county: (data.county || '').charAt(0).toUpperCase() + (data.county || '').slice(1),
                portalUrl: 'https://overassessed.ai/portal'
            }).catch(e => console.error('[Filings] Notification error:', e.message));
        }

        res.status(201).json(data);
    } catch (err) {
        console.error('[Filings] POST error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Filing status change notification emails
const FILING_STATUS_EMAILS = {
    draft: { subject: 'Your Filing Has Been Created', body: 'We\'ve created your property tax filing and are preparing your documents.' },
    form_generated: { subject: 'Your Authorization Form is Ready to Sign', body: 'Your Form 50-162 (or Letter of Authorization) is ready for your signature. Please log into your portal to review and sign.' },
    form_signed: { subject: 'Authorization Form Received', body: 'We\'ve received your signed authorization form. We\'ll proceed with filing your protest.' },
    filed: { subject: 'Your Protest Has Been Filed! 📤', body: 'Your property tax protest has been officially filed with the appraisal district. We\'ll handle everything from here.' },
    hearing_scheduled: { subject: 'Your Hearing is Scheduled 🏛️', body: 'A hearing has been scheduled for your property tax protest. Our team will represent you — no action needed on your part.' },
    hearing_complete: { subject: 'Your Hearing is Complete', body: 'Your hearing has concluded. We\'re reviewing the results and will update you shortly.' },
    settled: { subject: 'Your Case Has Been Settled! ✅', body: 'Great news — your property tax protest has been settled!' },
    closed: { subject: 'Your Case is Closed', body: 'Your property tax protest case has been closed. Thank you for choosing OverAssessed.' }
};

// PUT /api/filings/:id — update
router.put('/:id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        // Get current filing for status comparison
        const { data: currentFiling } = await supabaseAdmin.from('filings').select('status, clients(name, email, phone)').eq('id', req.params.id).single();
        const oldStatus = currentFiling?.status;

        const allowed = [
            'status', 'county', 'state', 'portal_url', 'portal_pin', 'portal_account_id',
            'form_50_162_signed', 'form_50_162_url', 'evidence_packet_url',
            'filing_date', 'filing_confirmation', 'hearing_date', 'hearing_type', 'hearing_format',
            'settlement_offer', 'settlement_accepted', 'final_value', 'original_value', 'savings', 'notes'
        ];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }

        // Auto-calculate savings if final and original provided
        if (updates.final_value !== undefined || updates.original_value !== undefined) {
            const { data: current } = await supabaseAdmin.from('filings').select('original_value, final_value').eq('id', req.params.id).single();
            const orig = updates.original_value ?? current?.original_value;
            const fin = updates.final_value ?? current?.final_value;
            if (orig && fin) updates.savings = orig - fin;
        }

        const { data, error } = await supabaseAdmin
            .from('filings')
            .update(updates)
            .eq('id', req.params.id)
            .select('*, clients(name, email, phone), properties(address)')
            .single();

        if (error) throw error;

        // Send notifications on status change
        const newStatus = data?.status;
        const clientEmail = data?.clients?.email;
        if (clientEmail && newStatus && newStatus !== oldStatus) {
            const vars = {
                name: data.clients?.name || 'there',
                propertyAddress: data.properties?.address || '',
                county: (data.county || '').charAt(0).toUpperCase() + (data.county || '').slice(1),
                portalUrl: 'https://overassessed.ai/portal',
                confirmationNumber: data.filing_confirmation || '',
                hearingDate: data.hearing_date ? new Date(data.hearing_date).toLocaleDateString() : '',
                hearingType: data.hearing_type || '',
                hearingFormat: data.hearing_format || '',
                settlementOffer: data.settlement_offer ? '$' + Number(data.settlement_offer).toLocaleString() : '',
                originalValue: data.original_value ? '$' + Number(data.original_value).toLocaleString() : '',
                finalValue: data.final_value ? '$' + Number(data.final_value).toLocaleString() : '',
                savings: data.savings ? '$' + Number(data.savings).toLocaleString() : ''
            };
            const stageMap = {
                form_generated: 'form_ready',
                filed: 'filed',
                hearing_scheduled: 'hearing_scheduled',
                closed: 'case_closed'
            };
            if (newStatus === 'settled' && data.settlement_offer) {
                sendFilingNotification(clientEmail, 'settlement_offer', vars).catch(() => {});
            } else if (stageMap[newStatus]) {
                sendFilingNotification(clientEmail, stageMap[newStatus], vars).catch(() => {});
            }
        }

        res.json(data);
    } catch (err) {
        console.error('[Filings] PUT error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/filings/:id/generate-form — generate Form 50-162 or GA POA
router.post('/:id/generate-form', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data: filing, error: fetchErr } = await supabaseAdmin
            .from('filings')
            .select('*, clients(name, email, phone, address, city, state, zip), properties(address, city, state, county, property_type)')
            .eq('id', req.params.id)
            .single();
        if (fetchErr) throw fetchErr;
        if (!filing) return res.status(404).json({ error: 'Filing not found' });

        const result = await generateForm(filing, filing.clients, filing.properties);

        // Update filing with form URL
        const newStatus = filing.status === 'draft' ? 'form_generated' : filing.status;
        await supabaseAdmin.from('filings').update({
            form_50_162_url: result.url,
            status: newStatus
        }).eq('id', req.params.id);

        res.json({ success: true, url: result.url, filename: result.filename });
    } catch (err) {
        console.error('[Filings] Generate form error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/filings/:id/generate-packet — generate evidence packet
router.post('/:id/generate-packet', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data: filing, error: fetchErr } = await supabaseAdmin
            .from('filings')
            .select('*, clients(name, email), properties(address, current_assessed_value), appeals(case_id, analysis_report, evidence_packet_path)')
            .eq('id', req.params.id)
            .single();
        if (fetchErr) throw fetchErr;
        if (!filing) return res.status(404).json({ error: 'Filing not found' });

        // If appeal has evidence packet, use it
        if (filing.appeals?.evidence_packet_path) {
            await supabaseAdmin.from('filings').update({
                evidence_packet_url: filing.appeals.evidence_packet_path
            }).eq('id', req.params.id);
            return res.json({ success: true, url: filing.appeals.evidence_packet_path, source: 'appeal' });
        }

        // Fetch property data if not fully available
        let subjectProperty = filing.properties;
        // Check if essential data for comp engine is missing
        if (!subjectProperty.sqft || !subjectProperty.assessedValue || !subjectProperty.propertyType) {
             console.log(`[Filing] Fetching property data for ${address}`);
             const fetchedProperty = await fetchPropertyData(address, county);
             subjectProperty = { ...subjectProperty, ...fetchedProperty };
             if (!subjectProperty.address) subjectProperty.address = address; // Ensure address is present
        }

        // Run the comp engine analysis
        console.log(`[Filing] Running comp engine for ${subjectProperty.address || address}`);
        const analysisResult = await findComparables(subjectProperty, { county: county });

        // Format for evidence generator
        const sub = {
            caseId: filing.appeals?.case_id || filing.id.slice(0, 8),
            propertyAddress: subjectProperty.address || address, // Use updated address if fetched
            ownerName: filing.clients?.name || 'Owner',
            state: filing.state || 'TX'
        };

        const evidencePath = await generateEvidencePacket(sub, subjectProperty, analysisResult);

        // After evidence packet is ready, move to approval queue
        await supabaseAdmin.from('filings').update({
            evidence_packet_url: evidencePath,
            status: 'queued_for_approval'
        }).eq('id', req.params.id);

        res.json({ success: true, url: evidencePath, source: 'generated' });
    } catch (err) {
        console.error('[Filings] Generate packet error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/filings/:id/auto-file — trigger browser automation
router.post('/:id/auto-file', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data: filing, error: fetchErr } = await supabaseAdmin
            .from('filings')
            .select('*, clients(name, email, phone, address, city, state, zip), properties(address, city, state, county)')
            .eq('id', req.params.id)
            .single();
        if (fetchErr) throw fetchErr;
        if (!filing) return res.status(404).json({ error: 'Filing not found' });

        if (!filing.portal_account_id || !filing.portal_pin) {
            return res.status(400).json({ error: 'Portal account ID and PIN are required for automation' });
        }

        // Mark as running
        await supabaseAdmin.from('filings').update({
            automation_log: [...(filing.automation_log || []), { timestamp: new Date().toISOString(), message: 'Automation started', level: 'info' }]
        }).eq('id', req.params.id);

        // Run automation asynchronously
        const { autoFile } = require('../services/county-automation');
        const headless = req.body.headless !== false;

        // Respond immediately, run in background
        res.json({ success: true, message: 'Automation started', filingId: filing.id });

        // Background execution
        const result = await autoFile(filing, { headless });

        // Update filing with results
        const updates = {
            automation_log: [...(filing.automation_log || []), ...result.log],
        };

        if (result.success) {
            updates.status = 'filed';
            updates.filing_date = new Date().toISOString();
            updates.filing_confirmation = result.confirmationNumber;
        } else {
            updates.status = 'automation_failed';
            updates.notes = (filing.notes || '') + `\n[Automation Failed] ${result.error || result.failedStep || 'Unknown error'}`;
        }

        await supabaseAdmin.from('filings').update(updates).eq('id', req.params.id);

        // Send notification email on success
        if (result.success && filing.clients?.email) {
            try {
                const { sendStageNotification } = require('../services/notifications');
                await sendStageNotification(filing.clients.email, filing.clients.name, 'filed', {
                    confirmationNumber: result.confirmationNumber,
                    county: filing.county,
                    propertyAddress: filing.properties?.address
                });
            } catch (emailErr) {
                console.error('[Filings] Email notification error:', emailErr.message);
            }
        }

    } catch (err) {
        console.error('[Filings] Auto-file error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: err.message });
    }
});

// POST /api/filings/:id/upload-evidence — upload evidence to county portal via automation
router.post('/:id/upload-evidence', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data: filing, error: fetchErr } = await supabaseAdmin
            .from('filings')
            .select('*, clients(name, email), properties(address)')
            .eq('id', req.params.id)
            .single();
        if (fetchErr) throw fetchErr;
        if (!filing) return res.status(404).json({ error: 'Filing not found' });

        if (!filing.evidence_packet_url) {
            return res.status(400).json({ error: 'No evidence packet generated. Generate one first.' });
        }
        if (!filing.portal_account_id || !filing.portal_pin) {
            return res.status(400).json({ error: 'Portal credentials required' });
        }

        res.json({ success: true, message: 'Evidence upload started' });

        const { uploadEvidence } = require('../services/county-automation');
        const result = await uploadEvidence(filing, { headless: req.body.headless !== false });

        await supabaseAdmin.from('filings').update({
            automation_log: [...(filing.automation_log || []), ...result.log]
        }).eq('id', req.params.id);

    } catch (err) {
        console.error('[Filings] Upload evidence error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: err.message });
    }
});

// GET /api/filings/:id/automation-log — view automation steps/screenshots
router.get('/:id/automation-log', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabaseAdmin
            .from('filings')
            .select('id, automation_log, status, filing_confirmation')
            .eq('id', req.params.id)
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Filing not found' });

        // Also check for screenshots on disk
        const fs = require('fs').promises;
        const screenshotDir = require('path').join(__dirname, '..', '..', 'data', 'automation-screenshots', req.params.id);
        let screenshots = [];
        try {
            const files = await fs.readdir(screenshotDir);
            screenshots = files.filter(f => f.endsWith('.png')).map(f => ({
                filename: f,
                path: `/data/automation-screenshots/${req.params.id}/${f}`
            }));
        } catch { /* no screenshots dir */ }

        res.json({
            id: data.id,
            status: data.status,
            filingConfirmation: data.filing_confirmation,
            log: data.automation_log || [],
            screenshots
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/filings/approval-queue — returns all filings queued for approval
router.get('/approval-queue', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabaseAdmin
            .from('filings')
            .select(`
                *,
                clients(name, email, phone),
                properties(address, city, state, county, current_assessed_value),
                appeals(case_id, estimated_savings, analysis_report)
            `)
            .eq('status', 'queued_for_approval')
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Calculate days until deadline and add urgency flag
        const now = new Date();
        const enrichedData = (data || []).map(filing => {
            let daysUntilDeadline = null;
            let isUrgent = false;

            if (filing.deadline_date) {
                const deadline = new Date(filing.deadline_date);
                const diffTime = deadline - now;
                daysUntilDeadline = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                isUrgent = daysUntilDeadline <= 7 && daysUntilDeadline > 0;
            }

            return {
                ...filing,
                daysUntilDeadline,
                isUrgent
            };
        });

        // Sort by urgency (urgent first, then by days remaining)
        enrichedData.sort((a, b) => {
            if (a.isUrgent && !b.isUrgent) return -1;
            if (!a.isUrgent && b.isUrgent) return 1;
            if (a.daysUntilDeadline !== null && b.daysUntilDeadline !== null) {
                return a.daysUntilDeadline - b.daysUntilDeadline;
            }
            return 0;
        });

        res.json(enrichedData);
    } catch (err) {
        console.error('[Filings] Approval queue error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/filings/:id/approve — approve a filing
router.patch('/:id/approve', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { approved_by } = req.body;

        const { data, error } = await supabaseAdmin
            .from('filings')
            .update({
                status: 'approved',
                approved_by: approved_by || 'admin',
                approved_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .eq('status', 'queued_for_approval')
            .select('*, clients(name, email), properties(address)')
            .single();

        if (error) throw error;
        if (!data) {
            return res.status(404).json({ error: 'Filing not found or not in queued_for_approval status' });
        }

        res.json(data);
    } catch (err) {
        console.error('[Filings] Approve error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/filings/:id/reject — reject a filing
router.patch('/:id/reject', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { rejection_reason, rejected_by } = req.body;

        if (!rejection_reason) {
            return res.status(400).json({ error: 'rejection_reason is required' });
        }

        const { data, error } = await supabaseAdmin
            .from('filings')
            .update({
                status: 'rejected',
                rejection_reason,
                rejected_by: rejected_by || 'admin',
                rejected_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .eq('status', 'queued_for_approval')
            .select('*, clients(name, email), properties(address)')
            .single();

        if (error) throw error;
        if (!data) {
            return res.status(404).json({ error: 'Filing not found or not in queued_for_approval status' });
        }

        res.json(data);
    } catch (err) {
        console.error('[Filings] Reject error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/filings/dashboard — filing stats and deadline alerts
router.get('/dashboard', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabaseAdmin
            .from('filings')
            .select('id, status, state, county, deadline_date, created_at, savings');

        if (error) throw error;

        // Stats by state
        const byState = {};
        const byCounty = {};
        const byStatus = {};
        let totalSavings = 0;

        const now = new Date();
        const deadlineAlerts = [];

        for (const filing of data || []) {
            // State stats
            const state = filing.state || 'Unknown';
            byState[state] = (byState[state] || 0) + 1;

            // County stats
            const county = filing.county || 'Unknown';
            byCounty[county] = (byCounty[county] || 0) + 1;

            // Status stats
            const status = filing.status || 'Unknown';
            byStatus[status] = (byStatus[status] || 0) + 1;

            // Savings
            totalSavings += parseFloat(filing.savings) || 0;

            // Deadline alerts (within 7 days, not approved)
            if (filing.deadline_date && filing.status !== 'approved' && filing.status !== 'filed') {
                const deadline = new Date(filing.deadline_date);
                const diffTime = deadline - now;
                const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (daysRemaining <= 7 && daysRemaining > 0) {
                    deadlineAlerts.push({
                        filing_id: filing.id,
                        status: filing.status,
                        state: filing.state,
                        county: filing.county,
                        deadline_date: filing.deadline_date,
                        daysRemaining
                    });
                }
            }
        }

        // Sort alerts by days remaining
        deadlineAlerts.sort((a, b) => a.daysRemaining - b.daysRemaining);

        res.json({
            totalFilings: data.length,
            byState,
            byCounty,
            byStatus,
            totalSavings,
            deadlineAlerts
        });
    } catch (err) {
        console.error('[Filings] Dashboard error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
