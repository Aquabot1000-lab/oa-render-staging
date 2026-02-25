const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');

// GET /api/clients
router.get('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabaseAdmin
            .from('clients')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[Clients] GET error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/clients/:id
router.get('/:id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabaseAdmin
            .from('clients')
            .select('*, properties(*), appeals(*)')
            .eq('id', req.params.id)
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Client not found' });
        res.json(data);
    } catch (err) {
        console.error('[Clients] GET/:id error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/clients
router.post('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { name, email, phone, address, city, state, zip, county, notification_pref } = req.body;
        if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

        const { data, error } = await supabaseAdmin
            .from('clients')
            .insert({ name, email, phone, address, city, state, zip, county, notification_pref })
            .select()
            .single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ error: 'Client with this email already exists' });
            throw error;
        }
        res.status(201).json(data);
    } catch (err) {
        console.error('[Clients] POST error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/clients/:id
router.patch('/:id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const allowed = ['name', 'email', 'phone', 'address', 'city', 'state', 'zip', 'county', 'notification_pref'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }

        const { data, error } = await supabaseAdmin
            .from('clients')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[Clients] PATCH error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
