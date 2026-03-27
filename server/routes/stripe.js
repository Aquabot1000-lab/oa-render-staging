// Initiation Fee: $79 one-time, credited toward contingency fee
const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');

// Initialize Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ============================================================
// INITIATION FEE PRODUCT & PRICE
// Stored in memory after initialization
// ============================================================
let initiationFeePriceId = null;

/**
 * Initialize Stripe Product and Price for $79 initiation fee
 * Called on server startup
 */
async function initializeInitiationFeeProduct() {
    try {
        // Check if product already exists
        const products = await stripe.products.search({
            query: "name:'OverAssessed Initiation Fee'"
        });

        let product;
        if (products.data.length > 0) {
            product = products.data[0];
            console.log('[Stripe] Found existing initiation fee product:', product.id);
        } else {
            // Create product
            product = await stripe.products.create({
                name: 'OverAssessed Initiation Fee',
                description: 'Property tax protest initiation fee — credited toward your contingency fee upon successful appeal',
                metadata: {
                    fee_type: 'initiation',
                    creditable: 'true'
                }
            });
            console.log('[Stripe] Created initiation fee product:', product.id);
        }

        // Get or create $79 price
        const prices = await stripe.prices.list({
            product: product.id,
            active: true,
            limit: 1
        });

        if (prices.data.length > 0) {
            initiationFeePriceId = prices.data[0].id;
            console.log('[Stripe] Using existing price:', initiationFeePriceId);
        } else {
            const price = await stripe.prices.create({
                product: product.id,
                unit_amount: 7900, // $79.00
                currency: 'usd',
                metadata: {
                    fee_type: 'initiation'
                }
            });
            initiationFeePriceId = price.id;
            console.log('[Stripe] Created $79 price:', initiationFeePriceId);
        }
    } catch (err) {
        console.error('[Stripe] Failed to initialize initiation fee product:', err.message);
    }
}

// Export for server.js to call on startup
router.initializeInitiationFeeProduct = initializeInitiationFeeProduct;

// ============================================================
// POST /api/stripe/initiation-checkout
// Creates a Stripe Checkout Session for $79 initiation fee
// Body: { submission_id, client_name, client_email, property_address, state, county }
// ============================================================
router.post('/initiation-checkout', async (req, res) => {
    try {
        const { submission_id, client_name, client_email, property_address, state, county } = req.body;

        if (!submission_id || !client_email || !client_name || !property_address) {
            return res.status(400).json({ error: 'submission_id, client_email, client_name, and property_address required' });
        }

        if (!initiationFeePriceId) {
            return res.status(503).json({ error: 'Initiation fee product not initialized' });
        }

        const baseUrl = process.env.APP_URL || 'https://disciplined-alignment-production.up.railway.app';

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price: initiationFeePriceId,
                quantity: 1
            }],
            mode: 'payment',
            customer_email: client_email,
            success_url: `${baseUrl}/payment-success.html?session_id={CHECKOUT_SESSION_ID}&submission_id=${submission_id}`,
            cancel_url: `${baseUrl}/payment-cancel.html?submission_id=${submission_id}`,
            metadata: {
                submission_id,
                client_name,
                property_address,
                state: state || '',
                county: county || '',
                fee_type: 'initiation',
                source: 'overassessed.ai'
            }
        });

        res.json({
            success: true,
            checkout_url: session.url,
            session_id: session.id
        });
    } catch (err) {
        console.error('[Stripe] Initiation checkout error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/stripe/create-invoice
// Creates a Stripe Invoice for a client after a successful appeal
// Body: { client_id, appeal_id, amount, description }
// ============================================================
router.post('/create-invoice', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { client_id, appeal_id, amount, description } = req.body;
        if (!client_id || !amount) {
            return res.status(400).json({ error: 'client_id and amount required' });
        }

        // Get client info from Supabase
        const { data: client, error: clientErr } = await supabaseAdmin
            .from('clients')
            .select('*')
            .eq('id', client_id)
            .single();
        if (clientErr) throw clientErr;
        if (!client) return res.status(404).json({ error: 'Client not found' });

        // Find or create Stripe customer
        let stripeCustomerId = client.stripe_customer_id;
        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                name: client.name,
                email: client.email,
                phone: client.phone || undefined,
                metadata: {
                    supabase_client_id: client_id,
                    source: 'overassessed.ai'
                }
            });
            stripeCustomerId = customer.id;

            // Save Stripe customer ID back to Supabase
            await supabaseAdmin
                .from('clients')
                .update({ stripe_customer_id: stripeCustomerId })
                .eq('id', client_id);
        }

        // Create invoice
        const invoice = await stripe.invoices.create({
            customer: stripeCustomerId,
            collection_method: 'send_invoice',
            days_until_due: 30,
            metadata: {
                client_id,
                appeal_id: appeal_id || '',
                source: 'overassessed.ai'
            }
        });

        // Add line item
        await stripe.invoiceItems.create({
            customer: stripeCustomerId,
            invoice: invoice.id,
            amount: Math.round(amount * 100), // Convert dollars to cents
            currency: 'usd',
            description: description || 'Property Tax Appeal - Contingency Fee (percentage of verified tax savings)'
        });

        // Finalize and send the invoice
        const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
        await stripe.invoices.sendInvoice(invoice.id);

        // Record payment in Supabase
        await supabaseAdmin
            .from('payments')
            .insert({
                client_id,
                appeal_id: appeal_id || null,
                stripe_payment_id: invoice.id,
                amount,
                status: 'invoiced'
            });

        res.json({
            success: true,
            invoice_id: invoice.id,
            invoice_url: finalizedInvoice.hosted_invoice_url,
            invoice_pdf: finalizedInvoice.invoice_pdf,
            amount,
            status: 'sent'
        });
    } catch (err) {
        console.error('[Stripe] Invoice creation error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/stripe/create-checkout
// Creates a Stripe Checkout Session for one-time payment
// Body: { client_id, appeal_id, amount, description, success_url, cancel_url }
// ============================================================
router.post('/create-checkout', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { client_id, appeal_id, amount, description, success_url, cancel_url } = req.body;
        if (!client_id || !amount) {
            return res.status(400).json({ error: 'client_id and amount required' });
        }

        // Get client info
        const { data: client, error: clientErr } = await supabaseAdmin
            .from('clients')
            .select('*')
            .eq('id', client_id)
            .single();
        if (clientErr) throw clientErr;
        if (!client) return res.status(404).json({ error: 'Client not found' });

        // Find or create Stripe customer
        let stripeCustomerId = client.stripe_customer_id;
        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                name: client.name,
                email: client.email,
                phone: client.phone || undefined,
                metadata: {
                    supabase_client_id: client_id,
                    source: 'overassessed.ai'
                }
            });
            stripeCustomerId = customer.id;
            await supabaseAdmin
                .from('clients')
                .update({ stripe_customer_id: stripeCustomerId })
                .eq('id', client_id);
        }

        const baseUrl = process.env.APP_URL || 'https://disciplined-alignment-production.up.railway.app';

        const session = await stripe.checkout.sessions.create({
            customer: stripeCustomerId,
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Property Tax Appeal Fee',
                        description: description || 'Contingency fee - percentage of verified tax savings'
                    },
                    unit_amount: Math.round(amount * 100) // dollars to cents
                },
                quantity: 1
            }],
            mode: 'payment',
            success_url: success_url || `${baseUrl}/portal.html?payment=success`,
            cancel_url: cancel_url || `${baseUrl}/portal.html?payment=cancelled`,
            metadata: {
                client_id,
                appeal_id: appeal_id || '',
                source: 'overassessed.ai'
            }
        });

        // Record pending payment
        await supabaseAdmin
            .from('payments')
            .insert({
                client_id,
                appeal_id: appeal_id || null,
                stripe_payment_id: session.id,
                amount,
                status: 'pending'
            });

        res.json({
            success: true,
            checkout_url: session.url,
            session_id: session.id
        });
    } catch (err) {
        console.error('[Stripe] Checkout error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/stripe/webhook
// Handles Stripe webhook events (payment confirmations, etc.)
// ============================================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        if (process.env.STRIPE_WEBHOOK_SECRET) {
            event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        } else {
            // No webhook secret configured — parse directly (dev mode)
            event = JSON.parse(req.body.toString());
        }
    } catch (err) {
        console.error('[Stripe Webhook] Signature verification failed:', err.message);
        return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    // Handle events
    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            console.log(`[Stripe] Checkout completed: ${session.id}, amount: ${session.amount_total / 100}`);

            if (isSupabaseEnabled()) {
                // Handle initiation fee payments
                if (session.metadata?.fee_type === 'initiation') {
                    const submissionId = session.metadata.submission_id;
                    console.log(`[Stripe] Initiation fee paid for submission ${submissionId}`);

                    // Update submission record
                    await supabaseAdmin
                        .from('submissions')
                        .update({
                            initiation_paid: true,
                            initiation_payment_id: session.payment_intent,
                            initiation_paid_at: new Date().toISOString()
                        })
                        .eq('id', submissionId);

                    // Get submission details for notification
                    const { data: submission } = await supabaseAdmin
                        .from('submissions')
                        .select('case_id, owner_name, property_address, state, county')
                        .eq('id', submissionId)
                        .single();

                    const clientName = submission?.owner_name || session.metadata.client_name || 'Unknown';
                    const propertyAddress = submission?.property_address || session.metadata.property_address || 'Unknown';
                    const caseId = submission?.case_id || 'Unknown';

                    console.log(`[Stripe] ✅ Initiation fee received: ${clientName} - ${propertyAddress} - $79`);

                    // Send Twilio SMS notification to Tyler (if configured)
                    if (process.env.TWILIO_ACCOUNT_SID && process.env.NOTIFY_PHONE) {
                        try {
                            const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                            await twilio.messages.create({
                                body: `💰 Initiation Fee Paid!\nCase: ${caseId}\nClient: ${clientName}\nProperty: ${propertyAddress}\nAmount: $79`,
                                from: process.env.TWILIO_PHONE_NUMBER,
                                to: process.env.NOTIFY_PHONE
                            });
                        } catch (twilioErr) {
                            console.error('[Stripe] Twilio notification failed:', twilioErr.message);
                        }
                    }

                    // Send email notification to Tyler (if configured)
                    if (process.env.SENDGRID_API_KEY && process.env.NOTIFY_EMAIL) {
                        try {
                            const sgMail = require('@sendgrid/mail');
                            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
                            await sgMail.send({
                                to: process.env.NOTIFY_EMAIL,
                                from: process.env.SENDGRID_FROM_EMAIL || 'noreply@overassessed.ai',
                                subject: `💰 Initiation Fee Paid — ${caseId} ${clientName}`,
                                html: `
                                    <h2>💰 Initiation Fee Payment Received</h2>
                                    <p><strong>Case ID:</strong> ${caseId}</p>
                                    <p><strong>Client:</strong> ${clientName}</p>
                                    <p><strong>Property:</strong> ${propertyAddress}</p>
                                    <p><strong>State/County:</strong> ${submission?.state || 'N/A'} / ${submission?.county || 'N/A'}</p>
                                    <p><strong>Amount:</strong> $79.00</p>
                                    <p><strong>Payment ID:</strong> ${session.payment_intent}</p>
                                    <hr>
                                    <p style="color: #666; font-size: 0.9em;">
                                        This fee is credited toward the final contingency fee upon successful appeal.
                                        The client's case is now ready for analysis and filing.
                                    </p>
                                `
                            });
                        } catch (emailErr) {
                            console.error('[Stripe] Email notification failed:', emailErr.message);
                        }
                    }
                } else {
                    // Handle regular appeal payments
                    // Update payment status
                    await supabaseAdmin
                        .from('payments')
                        .update({ status: 'paid', stripe_payment_id: session.payment_intent })
                        .eq('stripe_payment_id', session.id);

                    // Update appeal payment status if linked
                    if (session.metadata?.appeal_id) {
                        await supabaseAdmin
                            .from('appeals')
                            .update({ payment_status: 'paid' })
                            .eq('id', session.metadata.appeal_id);
                    }

                    // Auto-create Uri commission entry if TX client
                    if (session.metadata?.client_id) {
                        await createUriCommissionIfTX(session.metadata.client_id, session.amount_total / 100);
                    }
                }
            }
            break;
        }

        case 'invoice.paid': {
            const invoice = event.data.object;
            console.log(`[Stripe] Invoice paid: ${invoice.id}, amount: ${invoice.amount_paid / 100}`);

            if (isSupabaseEnabled()) {
                await supabaseAdmin
                    .from('payments')
                    .update({ status: 'paid' })
                    .eq('stripe_payment_id', invoice.id);

                if (invoice.metadata?.appeal_id) {
                    await supabaseAdmin
                        .from('appeals')
                        .update({ payment_status: 'paid' })
                        .eq('id', invoice.metadata.appeal_id);
                }

                // Auto-create Uri commission entry if TX client
                if (invoice.metadata?.client_id) {
                    await createUriCommissionIfTX(invoice.metadata.client_id, invoice.amount_paid / 100);
                }
            }
            break;
        }

        case 'invoice.payment_failed': {
            const invoice = event.data.object;
            console.log(`[Stripe] Invoice payment failed: ${invoice.id}`);

            if (isSupabaseEnabled()) {
                await supabaseAdmin
                    .from('payments')
                    .update({ status: 'failed' })
                    .eq('stripe_payment_id', invoice.id);
            }
            break;
        }

        case 'payment_intent.succeeded': {
            const pi = event.data.object;
            console.log(`[Stripe] PaymentIntent succeeded: ${pi.id}, amount: ${pi.amount / 100}`);
            // Auto-charge payments are already recorded inline, but update if status changed
            if (isSupabaseEnabled() && pi.metadata?.client_id) {
                await supabaseAdmin
                    .from('payments')
                    .update({ status: 'paid' })
                    .eq('stripe_payment_id', pi.id);

                // Auto-create Uri commission entry if TX client
                await createUriCommissionIfTX(pi.metadata.client_id, pi.amount / 100);
            }
            break;
        }

        case 'setup_intent.succeeded': {
            const si = event.data.object;
            console.log(`[Stripe] SetupIntent succeeded: ${si.id}, customer: ${si.customer}`);
            // Set the payment method as default for the customer
            if (si.customer && si.payment_method) {
                try {
                    await stripe.customers.update(si.customer, {
                        invoice_settings: { default_payment_method: si.payment_method }
                    });
                    console.log(`[Stripe] Set default payment method for ${si.customer}`);
                } catch (e) {
                    console.log(`[Stripe] Failed to set default PM: ${e.message}`);
                }
            }
            break;
        }

        default:
            console.log(`[Stripe] Unhandled event: ${event.type}`);
    }

    res.json({ received: true });
});

// ============================================================
// GET /api/stripe/invoices/:client_id
// List all invoices for a client
// ============================================================
router.get('/invoices/:client_id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data: client, error } = await supabaseAdmin
            .from('clients')
            .select('stripe_customer_id')
            .eq('id', req.params.client_id)
            .single();
        if (error) throw error;
        if (!client?.stripe_customer_id) {
            return res.json([]);
        }

        const invoices = await stripe.invoices.list({
            customer: client.stripe_customer_id,
            limit: 100
        });

        res.json(invoices.data.map(inv => ({
            id: inv.id,
            amount: inv.amount_due / 100,
            status: inv.status,
            invoice_url: inv.hosted_invoice_url,
            invoice_pdf: inv.invoice_pdf,
            created: inv.created,
            due_date: inv.due_date,
            paid: inv.paid
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/stripe/setup-intent
// Creates a SetupIntent to collect CC at signup (no charge yet)
// Body: { email, name, phone }
// ============================================================
router.post('/setup-intent', async (req, res) => {
    try {
        const { email, name, phone } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });

        // Find or create Stripe customer
        const existingCustomers = await stripe.customers.list({ email: email.toLowerCase(), limit: 1 });
        let customer;

        if (existingCustomers.data.length > 0) {
            customer = existingCustomers.data[0];
        } else {
            customer = await stripe.customers.create({
                name: name || undefined,
                email: email.toLowerCase(),
                phone: phone || undefined,
                metadata: { source: 'overassessed.ai' }
            });
        }

        // Create SetupIntent — this authorizes card collection without charging
        const setupIntent = await stripe.setupIntents.create({
            customer: customer.id,
            payment_method_types: ['card'],
            metadata: {
                source: 'overassessed.ai',
                signup_date: new Date().toISOString()
            }
        });

        res.json({
            success: true,
            clientSecret: setupIntent.client_secret,
            customerId: customer.id,
            setupIntentId: setupIntent.id
        });
    } catch (err) {
        console.error('[Stripe] SetupIntent error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/stripe/charge-saved-card
// Charges a client's saved card (called by auto-invoice on win)
// Body: { client_id, appeal_id, amount, description }
// ============================================================
router.post('/charge-saved-card', async (req, res) => {
    try {
        const { client_id, appeal_id, amount, description } = req.body;
        if (!client_id || !amount) return res.status(400).json({ error: 'client_id and amount required' });

        const result = await chargeSavedCard(client_id, appeal_id, amount, description);
        if (!result) return res.status(400).json({ error: 'No saved payment method found for client' });

        res.json(result);
    } catch (err) {
        console.error('[Stripe] Charge error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Charge a client's saved card on file.
 * Used by auto-invoicing when appeal is won.
 * Returns payment result or null if no card on file (falls back to invoice).
 */
async function chargeSavedCard(clientId, appealId, amount, description) {
    if (!stripe || !isSupabaseEnabled()) return null;

    // Get client's Stripe customer ID
    const { data: client, error } = await supabaseAdmin
        .from('clients')
        .select('stripe_customer_id, name, email')
        .eq('id', clientId)
        .single();
    if (error || !client?.stripe_customer_id) return null;

    // Get the customer's default payment method
    const customer = await stripe.customers.retrieve(client.stripe_customer_id);
    let paymentMethodId = customer.invoice_settings?.default_payment_method;

    // If no default, try to get the first saved payment method
    if (!paymentMethodId) {
        const methods = await stripe.paymentMethods.list({
            customer: client.stripe_customer_id,
            type: 'card',
            limit: 1
        });
        if (methods.data.length > 0) {
            paymentMethodId = methods.data[0].id;
        }
    }

    if (!paymentMethodId) return null; // No card on file — caller should fall back to invoice

    try {
        // Create and confirm a PaymentIntent (auto-charge)
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // dollars to cents
            currency: 'usd',
            customer: client.stripe_customer_id,
            payment_method: paymentMethodId,
            off_session: true,
            confirm: true,
            description: description || 'Property Tax Appeal Fee — OverAssessed',
            metadata: {
                client_id: clientId,
                appeal_id: appealId || '',
                source: 'overassessed.ai'
            },
            receipt_email: client.email // Auto-send receipt
        });

        // Record in Supabase
        await supabaseAdmin.from('payments').insert({
            client_id: clientId,
            appeal_id: appealId || null,
            stripe_payment_id: paymentIntent.id,
            amount,
            status: paymentIntent.status === 'succeeded' ? 'paid' : 'pending'
        });

        if (appealId) {
            await supabaseAdmin
                .from('appeals')
                .update({ payment_status: 'paid' })
                .eq('id', appealId);
        }

        console.log(`[Stripe] ✅ Auto-charged ${client.email} $${amount} (${paymentIntent.id})`);
        return {
            success: true,
            payment_id: paymentIntent.id,
            amount,
            status: paymentIntent.status,
            method: 'auto_charge',
            email: client.email
        };
    } catch (err) {
        // Card declined or authentication required — fall back to invoice
        console.log(`[Stripe] Auto-charge failed for ${client.email}: ${err.message} — will send invoice instead`);
        return null;
    }
}

/**
 * Auto-create Uri commission entry if client is in Texas.
 * Tyler owes Uri 10% of ALL billing to TX customers.
 */
async function createUriCommissionIfTX(clientId, billingAmount) {
    if (!isSupabaseEnabled()) return;

    try {
        // Get client info
        const { data: client, error } = await supabaseAdmin
            .from('clients')
            .select('id, name, email, state')
            .eq('id', clientId)
            .single();

        if (error || !client) {
            console.log(`[Uri Commission] Client not found: ${clientId}`);
            return;
        }

        // Only create commission for TX clients
        if (client.state?.toUpperCase() !== 'TX') {
            return;
        }

        // Get property info if available
        const { data: properties } = await supabaseAdmin
            .from('properties')
            .select('id, address')
            .eq('client_id', clientId)
            .limit(1);

        const property = properties?.[0];

        // Check if commission entry already exists for this client/amount/date
        const today = new Date().toISOString().split('T')[0];
        const { data: existing } = await supabaseAdmin
            .from('uri_commissions')
            .select('id')
            .eq('client_id', clientId)
            .eq('billing_amount', billingAmount)
            .eq('billing_date', today)
            .limit(1);

        if (existing && existing.length > 0) {
            console.log(`[Uri Commission] Entry already exists for ${client.name} ($${billingAmount})`);
            return;
        }

        // Create commission entry
        const { data: commission, error: insertError } = await supabaseAdmin
            .from('uri_commissions')
            .insert({
                client_id: clientId,
                property_id: property?.id || null,
                client_name: client.name,
                property_address: property?.address || null,
                state: 'TX',
                billing_amount: billingAmount,
                status: 'accrued',
                billing_date: today,
                notes: 'Auto-created from Stripe payment'
            })
            .select()
            .single();

        if (insertError) throw insertError;

        console.log(`[Uri Commission] ✅ Created entry: ${client.name}, $${billingAmount} billed, $${(billingAmount * 0.1).toFixed(2)} commission`);
    } catch (err) {
        console.error(`[Uri Commission] Error creating entry:`, err.message);
    }
}

module.exports = router;
module.exports.chargeSavedCard = chargeSavedCard;
module.exports.initializeInitiationFeeProduct = initializeInitiationFeeProduct;
