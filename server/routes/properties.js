const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');

// GET /api/properties
router.get('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        let query = supabaseAdmin.from('properties').select('*, clients(name, email)');
        if (req.query.client_id) query = query.eq('client_id', req.query.client_id);
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[Properties] GET error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/properties/:id
router.get('/:id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabaseAdmin
            .from('properties')
            .select('*, clients(name, email), appeals(*)')
            .eq('id', req.params.id)
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Property not found' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/properties
router.post('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { client_id, address, city, state, zip, county, property_type, current_assessed_value, proposed_value, year,
                bedrooms, bathrooms, sqft, year_built, renovations, condition_issues, recent_appraisal, appraised_value, appraisal_date } = req.body;
        if (!client_id || !address) return res.status(400).json({ error: 'client_id and address required' });

        const insertData = { client_id, address, city, state, zip, county, property_type, current_assessed_value, proposed_value, year };
        // Include optional fields only if provided
        if (bedrooms != null) insertData.bedrooms = bedrooms;
        if (bathrooms != null) insertData.bathrooms = bathrooms;
        if (sqft != null) insertData.sqft = sqft;
        if (year_built != null) insertData.year_built = year_built;
        if (renovations) insertData.renovations = renovations;
        if (condition_issues) insertData.condition_issues = condition_issues;
        if (recent_appraisal) insertData.recent_appraisal = recent_appraisal;
        if (appraised_value) insertData.appraised_value = appraised_value;
        if (appraisal_date) insertData.appraisal_date = appraisal_date;

        const { data, error } = await supabaseAdmin
            .from('properties')
            .insert(insertData)
            .select()
            .single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        console.error('[Properties] POST error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
