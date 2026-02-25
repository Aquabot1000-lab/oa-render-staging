const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');

function generateReferralCode() {
    return 'OA-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// GET /api/db/referrals
router.get('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        let query = supabaseAdmin.from('referrals').select('*').order('created_at', { ascending: false });
        if (req.query.referrer_client_id) {
            query = query.eq('referrer_client_id', req.query.referrer_client_id);
        }
        if (req.query.referral_code) {
            query = query.eq('referral_code', req.query.referral_code);
        }
        const { data, error } = await query;
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/db/referrals — create a referral
router.post('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { referrer_client_id, referred_email } = req.body;
        if (!referrer_client_id || !referred_email) return res.status(400).json({ error: 'referrer_client_id and referred_email required' });

        const referral_code = generateReferralCode();
        const { data, error } = await supabaseAdmin
            .from('referrals')
            .insert({ referrer_client_id, referred_email, referral_code, status: 'pending', reward_amount: 0 })
            .select()
            .single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/db/referrals/generate-code — generate a referral code for a client
router.post('/generate-code', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { client_id } = req.body;
        if (!client_id) return res.status(400).json({ error: 'client_id required' });
        const code = generateReferralCode();
        res.json({ referral_code: code, referral_link: `${req.protocol}://${req.get('host')}/?ref=${code}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/db/referrals/:id
router.patch('/:id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabaseAdmin
            .from('referrals')
            .update(req.body)
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== PUBLIC ENDPOINTS ====================

// POST /api/referrals/signup — public
router.post('/signup', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { yourName, yourEmail, yourCaseId } = req.body;
        if (!yourName || !yourEmail) return res.status(400).json({ error: 'yourName and yourEmail required' });

        // Find or create client
        let clientId = null;
        const { data: existing } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('email', yourEmail.toLowerCase())
            .single();

        if (existing) {
            clientId = existing.id;
        } else {
            const { data: newClient, error: cErr } = await supabaseAdmin
                .from('clients')
                .insert({ name: yourName, email: yourEmail.toLowerCase() })
                .select('id')
                .single();
            if (cErr) throw cErr;
            clientId = newClient.id;
        }

        const referral_code = generateReferralCode();
        const { data, error } = await supabaseAdmin
            .from('referrals')
            .insert({
                referrer_client_id: clientId,
                referred_email: '',
                referral_code,
                status: 'active',
                reward_amount: 0
            })
            .select()
            .single();
        if (error) throw error;

        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        res.status(201).json({
            referral_code,
            referral_link: `${baseUrl}/?ref=${referral_code}`
        });
    } catch (err) {
        console.error('[Referrals] Signup error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/referrals/claim — public
router.post('/claim', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { referral_code, name, email, phone, propertyAddress } = req.body;
        if (!referral_code || !name || !email || !propertyAddress) {
            return res.status(400).json({ error: 'referral_code, name, email, and propertyAddress required' });
        }

        // Look up referral
        const { data: referral, error: refErr } = await supabaseAdmin
            .from('referrals')
            .select('*')
            .eq('referral_code', referral_code)
            .single();
        if (refErr || !referral) return res.status(404).json({ error: 'Referral code not found' });

        // Create referred client
        let clientId;
        const { data: existing } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('email', email.toLowerCase())
            .single();

        if (existing) {
            clientId = existing.id;
        } else {
            const { data: newClient, error: cErr } = await supabaseAdmin
                .from('clients')
                .insert({ name, email: email.toLowerCase(), phone: phone || null })
                .select('id')
                .single();
            if (cErr) throw cErr;
            clientId = newClient.id;
        }

        // Create property
        const state = (propertyAddress.toLowerCase().includes('georgia') || propertyAddress.toLowerCase().includes(', ga')) ? 'GA' : 'TX';
        const { data: property, error: propErr } = await supabaseAdmin
            .from('properties')
            .insert({ client_id: clientId, address: propertyAddress, state })
            .select('id')
            .single();
        if (propErr) throw propErr;

        // Apply discount: 15% TX, 20% GA (instead of standard rates)
        const discountedRate = state === 'GA' ? 0.20 : 0.15;

        // Update referral with referred info
        await supabaseAdmin
            .from('referrals')
            .update({
                referred_client_id: clientId,
                referred_email: email.toLowerCase(),
                referred_name: name,
                referred_phone: phone || null,
                status: 'claimed'
            })
            .eq('id', referral.id);

        res.status(201).json({
            success: true,
            client_id: clientId,
            property_id: property.id,
            discounted_rate: discountedRate,
            referral_code
        });
    } catch (err) {
        console.error('[Referrals] Claim error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
