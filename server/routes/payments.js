const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');

// GET /api/payments
router.get('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        let query = supabaseAdmin.from('payments').select('*, clients(name, email), appeals(case_id)');
        if (req.query.client_id) query = query.eq('client_id', req.query.client_id);
        if (req.query.appeal_id) query = query.eq('appeal_id', req.query.appeal_id);
        if (req.query.status) query = query.eq('status', req.query.status);
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/payments
router.post('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { client_id, appeal_id, stripe_payment_id, amount, status } = req.body;
        if (!client_id || !amount) return res.status(400).json({ error: 'client_id and amount required' });

        const { data, error } = await supabaseAdmin
            .from('payments')
            .insert({
                client_id,
                appeal_id: appeal_id || null,
                stripe_payment_id: stripe_payment_id || null,
                amount,
                status: status || 'pending'
            })
            .select()
            .single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        console.error('[Payments] POST error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/payments/:id
router.patch('/:id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const allowed = ['stripe_payment_id', 'amount', 'status'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }

        const { data, error } = await supabaseAdmin
            .from('payments')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
