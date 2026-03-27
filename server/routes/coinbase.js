/**
 * Coinbase Commerce — Bitcoin Payment Integration for OverAssessed LLC
 * 
 * Accepts $79 initiation fee in Bitcoin via Coinbase Commerce.
 * BTC routes directly to owner's self-custody wallet (no Coinbase holding).
 * 
 * Endpoints:
 *   POST /api/coinbase/create-charge     — Create a $79 BTC checkout charge
 *   POST /api/coinbase/create-invoice     — Create a BTC invoice for any amount (contingency fees)
 *   POST /api/coinbase/webhook            — Webhook handler for payment confirmations
 *   GET  /api/coinbase/charge/:chargeId   — Check charge status
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');

const COINBASE_API_URL = 'https://api.commerce.coinbase.com';
const API_VERSION = '2018-03-22';

function getApiKey() {
    return process.env.COINBASE_COMMERCE_API_KEY;
}

function getWebhookSecret() {
    return process.env.COINBASE_COMMERCE_WEBHOOK_SECRET;
}

function getBaseUrl() {
    return process.env.APP_URL || 'https://disciplined-alignment-production.up.railway.app';
}

/**
 * Make a request to Coinbase Commerce API
 */
async function coinbaseRequest(endpoint, method = 'GET', body = null) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('COINBASE_COMMERCE_API_KEY not configured');

    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-CC-Api-Key': apiKey,
            'X-CC-Version': API_VERSION,
            'Accept': 'application/json'
        }
    };

    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${COINBASE_API_URL}${endpoint}`, options);
    const data = await response.json();

    if (!response.ok) {
        const errMsg = data.error?.message || data.message || JSON.stringify(data);
        throw new Error(`Coinbase API error (${response.status}): ${errMsg}`);
    }

    return data;
}

// ============================================================
// POST /api/coinbase/create-charge
// Creates a Coinbase Commerce charge for $79 initiation fee
// Body: { submission_id, client_name, client_email, property_address, state, county }
// ============================================================
router.post('/create-charge', async (req, res) => {
    try {
        const { submission_id, client_name, client_email, property_address, state, county } = req.body;

        if (!client_email || !client_name) {
            return res.status(400).json({ error: 'client_name and client_email required' });
        }

        const baseUrl = getBaseUrl();

        const charge = await coinbaseRequest('/charges', 'POST', {
            name: 'OverAssessed LLC — Initiation Fee',
            description: 'Property tax protest initiation fee ($79) — credited toward your contingency fee upon successful appeal.',
            pricing_type: 'fixed_price',
            local_price: {
                amount: '79.00',
                currency: 'USD'
            },
            metadata: {
                submission_id: submission_id || '',
                client_name,
                client_email,
                property_address: property_address || '',
                state: state || '',
                county: county || '',
                fee_type: 'initiation',
                source: 'overassessed.ai'
            },
            redirect_url: `${baseUrl}/payment-success.html?method=bitcoin&submission_id=${submission_id || ''}`,
            cancel_url: `${baseUrl}/payment-cancel.html?method=bitcoin&submission_id=${submission_id || ''}`
        });

        console.log(`[Coinbase] Charge created: ${charge.data.id} for ${client_email}`);

        res.json({
            success: true,
            hosted_url: charge.data.hosted_url,
            charge_id: charge.data.id,
            expires_at: charge.data.expires_at,
            bitcoin_address: charge.data.addresses?.bitcoin || null,
            amount_btc: charge.data.pricing?.bitcoin?.amount || null
        });
    } catch (err) {
        console.error('[Coinbase] Create charge error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/coinbase/create-invoice
// Creates a BTC charge for any amount (contingency fee invoicing)
// Body: { client_name, client_email, amount, description, client_id, appeal_id }
// ============================================================
router.post('/create-invoice', async (req, res) => {
    try {
        const { client_name, client_email, amount, description, client_id, appeal_id } = req.body;

        if (!client_email || !client_name || !amount) {
            return res.status(400).json({ error: 'client_name, client_email, and amount required' });
        }

        const charge = await coinbaseRequest('/charges', 'POST', {
            name: `OverAssessed LLC — ${description || 'Invoice'}`,
            description: description || 'Property tax appeal services',
            pricing_type: 'fixed_price',
            local_price: {
                amount: parseFloat(amount).toFixed(2),
                currency: 'USD'
            },
            metadata: {
                client_name,
                client_email,
                client_id: client_id || '',
                appeal_id: appeal_id || '',
                fee_type: 'invoice',
                source: 'overassessed.ai'
            }
        });

        console.log(`[Coinbase] Invoice charge created: ${charge.data.id} — $${amount} for ${client_email}`);

        res.json({
            success: true,
            hosted_url: charge.data.hosted_url,
            charge_id: charge.data.id,
            expires_at: charge.data.expires_at,
            amount_usd: amount
        });
    } catch (err) {
        console.error('[Coinbase] Create invoice error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/coinbase/charge/:chargeId
// Check the status of a charge
// ============================================================
router.get('/charge/:chargeId', async (req, res) => {
    try {
        const { chargeId } = req.params;
        const charge = await coinbaseRequest(`/charges/${chargeId}`);

        res.json({
            success: true,
            id: charge.data.id,
            status: charge.data.timeline?.[charge.data.timeline.length - 1]?.status || 'unknown',
            confirmed: charge.data.confirmed_at ? true : false,
            expires_at: charge.data.expires_at,
            payments: charge.data.payments || []
        });
    } catch (err) {
        console.error('[Coinbase] Charge status error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/coinbase/webhook
// Handles Coinbase Commerce webhook events
// IMPORTANT: Must receive raw body for signature verification
// ============================================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const signature = req.headers['x-cc-webhook-signature'];
        const payload = req.body.toString();
        const webhookSecret = getWebhookSecret();

        // Verify webhook signature
        if (webhookSecret && signature) {
            const hmac = crypto.createHmac('sha256', webhookSecret);
            const computedSignature = hmac.update(payload).digest('hex');
            if (computedSignature !== signature) {
                console.error('[Coinbase Webhook] Invalid signature');
                return res.status(401).json({ error: 'Invalid signature' });
            }
        } else if (webhookSecret) {
            console.error('[Coinbase Webhook] Missing signature header');
            return res.status(401).json({ error: 'Missing signature' });
        }

        const event = JSON.parse(payload);
        const eventType = event.event?.type || event.type;
        const chargeData = event.event?.data || event.data;

        console.log(`[Coinbase Webhook] Event: ${eventType} | Charge: ${chargeData?.id}`);

        const metadata = chargeData?.metadata || {};
        const submissionId = metadata.submission_id;
        const clientEmail = metadata.client_email;
        const clientName = metadata.client_name;
        const feeType = metadata.fee_type;

        switch (eventType) {
            case 'charge:confirmed': {
                console.log(`[Coinbase] ✅ Payment CONFIRMED — ${clientName} (${clientEmail}) — Charge: ${chargeData.id}`);

                // Mark submission as paid in Supabase
                if (isSupabaseEnabled() && submissionId) {
                    try {
                        await supabaseAdmin
                            .from('submissions')
                            .update({
                                initiation_paid: true,
                                initiation_payment_id: `coinbase:${chargeData.id}`,
                                initiation_paid_at: new Date().toISOString(),
                                payment_method: 'bitcoin'
                            })
                            .eq('id', submissionId);
                        console.log(`[Coinbase] Submission ${submissionId} marked as paid`);
                    } catch (dbErr) {
                        console.error('[Coinbase] DB update error:', dbErr.message);
                    }
                }

                // Record payment in payments table
                if (isSupabaseEnabled()) {
                    try {
                        const paymentAmount = chargeData.pricing?.local?.amount || '79.00';
                        await supabaseAdmin.from('payments').insert({
                            client_id: metadata.client_id || null,
                            appeal_id: metadata.appeal_id || null,
                            stripe_payment_id: `coinbase:${chargeData.id}`,
                            amount: parseFloat(paymentAmount),
                            status: 'paid',
                            type: feeType || 'initiation',
                            payment_method: 'bitcoin',
                            metadata: {
                                coinbase_charge_id: chargeData.id,
                                bitcoin_amount: chargeData.payments?.[0]?.value?.crypto?.amount || null,
                                bitcoin_address: chargeData.addresses?.bitcoin || null
                            }
                        });
                    } catch (dbErr) {
                        console.error('[Coinbase] Payment record error:', dbErr.message);
                    }
                }

                // Send Tyler a notification
                if (process.env.NOTIFY_PHONE && process.env.TWILIO_ACCOUNT_SID) {
                    try {
                        const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                        await twilio.messages.create({
                            body: `₿ BTC Payment Confirmed!\n${clientName} (${clientEmail})\nAmount: $${chargeData.pricing?.local?.amount || '79.00'}\nCharge: ${chargeData.id}`,
                            from: process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_PHONE_NUMBER,
                            to: process.env.NOTIFY_PHONE
                        });
                    } catch (smsErr) {
                        console.error('[Coinbase] SMS notification error:', smsErr.message);
                    }
                }
                break;
            }

            case 'charge:pending': {
                console.log(`[Coinbase] ⏳ Payment PENDING (on-chain, unconfirmed) — ${clientName}`);
                break;
            }

            case 'charge:failed': {
                console.log(`[Coinbase] ❌ Payment FAILED/EXPIRED — ${clientName} (${clientEmail})`);
                break;
            }

            case 'charge:delayed': {
                console.log(`[Coinbase] ⚠️ Payment DELAYED (underpaid or late) — ${clientName}`);
                break;
            }

            default:
                console.log(`[Coinbase Webhook] Unhandled event type: ${eventType}`);
        }

        res.status(200).json({ received: true });
    } catch (err) {
        console.error('[Coinbase Webhook] Error:', err.message);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

module.exports = router;
