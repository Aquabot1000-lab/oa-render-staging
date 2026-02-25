const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');

// GET /api/appeals
router.get('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        let query = supabaseAdmin.from('appeals').select('*, clients(name, email, phone), properties(address, city, state)');
        if (req.query.status) query = query.eq('status', req.query.status);
        if (req.query.state) query = query.eq('state', req.query.state.toUpperCase());
        if (req.query.client_id) query = query.eq('client_id', req.query.client_id);
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[Appeals] GET error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/appeals/:id
router.get('/:id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        // Support lookup by UUID or case_id
        const col = req.params.id.startsWith('OA-') ? 'case_id' : 'id';
        const { data, error } = await supabaseAdmin
            .from('appeals')
            .select('*, clients(name, email, phone, notification_pref), properties(address, city, state, county, property_type, current_assessed_value), documents(*)')
            .eq(col, req.params.id)
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Appeal not found' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/appeals — create a full appeal (client + property + appeal in one shot)
router.post('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const {
            // Client fields
            ownerName, email, phone, notificationPref,
            // Property fields
            propertyAddress, propertyType, assessedValue, county,
            // Appeal fields
            state, source, utm_data
        } = req.body;

        if (!ownerName || !email || !propertyAddress) {
            return res.status(400).json({ error: 'ownerName, email, and propertyAddress required' });
        }

        const appealState = (state || 'TX').toUpperCase();

        // 1. Upsert client
        let { data: client, error: clientErr } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('email', email.toLowerCase())
            .maybeSingle();

        if (!client) {
            const { data: newClient, error: insertErr } = await supabaseAdmin
                .from('clients')
                .insert({
                    name: ownerName,
                    email: email.toLowerCase(),
                    phone,
                    state: appealState,
                    county,
                    notification_pref: notificationPref || 'both'
                })
                .select()
                .single();
            if (insertErr) throw insertErr;
            client = newClient;
        }

        // 2. Create property
        const assessedNum = assessedValue ? parseInt(String(assessedValue).replace(/[^0-9]/g, '')) || null : null;
        const { data: property, error: propErr } = await supabaseAdmin
            .from('properties')
            .insert({
                client_id: client.id,
                address: propertyAddress,
                state: appealState,
                county,
                property_type: propertyType,
                current_assessed_value: assessedNum
            })
            .select()
            .single();
        if (propErr) throw propErr;

        // 3. Generate case ID
        const { data: caseIdRow, error: caseErr } = await supabaseAdmin.rpc('next_case_id');
        if (caseErr) throw caseErr;
        const caseId = caseIdRow;

        // 4. Create appeal
        const { data: appeal, error: appealErr } = await supabaseAdmin
            .from('appeals')
            .insert({
                case_id: caseId,
                property_id: property.id,
                client_id: client.id,
                state: appealState,
                county,
                status: 'intake',
                source: source || 'website',
                utm_data: utm_data || null
            })
            .select()
            .single();
        if (appealErr) throw appealErr;

        res.status(201).json({
            success: true,
            id: appeal.id,
            caseId,
            clientId: client.id,
            propertyId: property.id
        });
    } catch (err) {
        console.error('[Appeals] POST error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/appeals/:id
router.patch('/:id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const col = req.params.id.startsWith('OA-') ? 'case_id' : 'id';
        const allowed = [
            'status', 'filing_date', 'hearing_date', 'outcome',
            'estimated_savings', 'savings_amount', 'our_fee_percent', 'our_fee_amount',
            'notes', 'signature', 'drip_state', 'analysis_report', 'analysis_status',
            'evidence_packet_path', 'filing_data', 'pin'
        ];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }

        // Handle adding a note (append to JSONB array)
        if (req.body.note) {
            // Fetch current notes first
            const { data: current } = await supabaseAdmin
                .from('appeals')
                .select('notes')
                .eq(col, req.params.id)
                .single();
            const existingNotes = current?.notes || [];
            existingNotes.push({
                id: require('crypto').randomUUID(),
                text: req.body.note,
                author: req.body.author || 'admin',
                createdAt: new Date().toISOString()
            });
            updates.notes = existingNotes;
        }

        const { data, error } = await supabaseAdmin
            .from('appeals')
            .update(updates)
            .eq(col, req.params.id)
            .select('*, clients(name, email, phone), properties(address)')
            .single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[Appeals] PATCH error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/appeals/stats/pipeline
router.get('/stats/pipeline', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabaseAdmin
            .from('appeals')
            .select('status, estimated_savings, savings_amount, signature');
        if (error) throw error;

        const pipeline = {};
        let totalEstimatedSavings = 0;
        let signed = 0;

        for (const a of data) {
            pipeline[a.status] = (pipeline[a.status] || 0) + 1;
            totalEstimatedSavings += parseFloat(a.estimated_savings) || 0;
            if (a.signature) signed++;
        }

        res.json({
            pipeline,
            totalEstimatedSavings,
            totalFees: Math.round(totalEstimatedSavings * 0.20),
            signed,
            total: data.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
