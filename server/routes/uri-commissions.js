const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');

// ============================================================
// GET /api/admin/uri-commissions
// List all Uri commissions with optional filters
// Query params: ?status=pending|accrued|paid|waived
// ============================================================
router.get('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });

    try {
        let query = supabaseAdmin
            .from('uri_commissions')
            .select('*')
            .order('billing_date', { ascending: false });

        if (req.query.status) {
            query = query.eq('status', req.query.status);
        }

        const { data, error } = await query;
        if (error) throw error;

        res.json(data || []);
    } catch (err) {
        console.error('[Uri Commissions] List error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/admin/uri-commissions/summary
// Get summary totals for Uri commissions
// ============================================================
router.get('/summary', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });

    try {
        // Get all commissions
        const { data: commissions, error } = await supabaseAdmin
            .from('uri_commissions')
            .select('billing_amount, commission_amount, status');

        if (error) throw error;

        const summary = {
            total_billed: 0,
            total_commission: 0,
            total_paid: 0,
            total_pending: 0,
            total_accrued: 0,
            count_total: commissions?.length || 0,
            count_paid: 0,
            count_pending: 0,
            count_accrued: 0
        };

        if (commissions) {
            commissions.forEach(c => {
                const billing = parseFloat(c.billing_amount) || 0;
                const commission = parseFloat(c.commission_amount) || 0;

                summary.total_billed += billing;
                summary.total_commission += commission;

                if (c.status === 'paid') {
                    summary.total_paid += commission;
                    summary.count_paid++;
                } else if (c.status === 'accrued') {
                    summary.total_accrued += commission;
                    summary.count_accrued++;
                } else if (c.status === 'pending') {
                    summary.total_pending += commission;
                    summary.count_pending++;
                }
            });
        }

        // Outstanding balance = accrued + pending (not paid, not waived)
        summary.total_outstanding = summary.total_accrued + summary.total_pending;

        res.json(summary);
    } catch (err) {
        console.error('[Uri Commissions] Summary error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/admin/uri-commissions
// Create a new Uri commission entry
// Body: { client_id?, property_id?, case_number?, client_name, property_address?,
//         billing_amount, billing_date?, notes? }
// ============================================================
router.post('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });

    try {
        const {
            client_id,
            property_id,
            case_number,
            client_name,
            property_address,
            state = 'TX',
            billing_amount,
            billing_date,
            notes
        } = req.body;

        if (!client_name || !billing_amount) {
            return res.status(400).json({ error: 'client_name and billing_amount required' });
        }

        const insertData = {
            client_id: client_id || null,
            property_id: property_id || null,
            case_number: case_number || null,
            client_name,
            property_address: property_address || null,
            state,
            billing_amount: parseFloat(billing_amount),
            billing_date: billing_date || new Date().toISOString().split('T')[0],
            notes: notes || null
        };

        const { data, error } = await supabaseAdmin
            .from('uri_commissions')
            .insert(insertData)
            .select()
            .single();

        if (error) throw error;

        console.log(`[Uri Commissions] Created: ${client_name}, $${billing_amount}`);
        res.json(data);
    } catch (err) {
        console.error('[Uri Commissions] Create error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PUT /api/admin/uri-commissions/:id
// Update a Uri commission entry
// Body: { status?, billing_amount?, paid_date?, payment_method?, payment_reference?, notes? }
// ============================================================
router.put('/:id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });

    try {
        const { id } = req.params;
        const updates = {};

        if (req.body.status) updates.status = req.body.status;
        if (req.body.billing_amount) updates.billing_amount = parseFloat(req.body.billing_amount);
        if (req.body.paid_date !== undefined) updates.paid_date = req.body.paid_date;
        if (req.body.payment_method !== undefined) updates.payment_method = req.body.payment_method;
        if (req.body.payment_reference !== undefined) updates.payment_reference = req.body.payment_reference;
        if (req.body.notes !== undefined) updates.notes = req.body.notes;

        const { data, error } = await supabaseAdmin
            .from('uri_commissions')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        console.log(`[Uri Commissions] Updated: ${id}, status=${updates.status || 'unchanged'}`);
        res.json(data);
    } catch (err) {
        console.error('[Uri Commissions] Update error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/admin/uri-commissions/:id
// Delete a Uri commission entry
// ============================================================
router.delete('/:id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });

    try {
        const { id } = req.params;

        const { error } = await supabaseAdmin
            .from('uri_commissions')
            .delete()
            .eq('id', id);

        if (error) throw error;

        console.log(`[Uri Commissions] Deleted: ${id}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[Uri Commissions] Delete error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
