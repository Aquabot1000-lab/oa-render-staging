/**
 * dashboard.js
 *
 * Dashboard API routes for viewing case queues and daily tasks
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../lib/supabase');
const { readTaxSavings } = require('../lib/metric-shim'); // Phase 0.5 — canonical metric reads

/**
 * GET /api/dashboard/daily
 * Returns daily task digest data (does not send Telegram)
 */
router.get('/daily', async (req, res) => {
    try {
        const now = new Date();

        // Pull all cases that need attention
        const { data: cases, error } = await supabaseAdmin
            .from('submissions')
            .select('case_id, owner_name, next_action, next_follow_up_at, estimated_savings, estimated_tax_savings, estimated_revenue, estimated_reduction_value, filing_ready, status')
            .lte('next_follow_up_at', now.toISOString())
            .neq('do_not_contact', true)
            .is('deleted_at', null)
            .neq('filing_submitted', true);

        if (error) {
            console.error('[Dashboard/Daily] Query error:', error);
            return res.status(500).json({ error: error.message });
        }

        if (!cases || cases.length === 0) {
            return res.json({
                as_of: now.toISOString(),
                total: 0,
                cases: []
            });
        }

        // Sort by priority
        const prioritized = {
            urgent: [],
            docs: [],
            highValue: [],
            other: []
        };

        cases.forEach(c => {
            if (c.filing_ready === true) {
                prioritized.urgent.push(c);
            } else if (['NEEDS_REVIEW', 'DOCUMENT_RECEIVED'].includes(c.status)) {
                prioritized.docs.push(c);
            } else if (readTaxSavings(c) > 5000) {
                prioritized.highValue.push(c);
            } else {
                prioritized.other.push(c);
            }
        });

        res.json({
            as_of: now.toISOString(),
            total: cases.length,
            summary: {
                urgent: prioritized.urgent.length,
                docs: prioritized.docs.length,
                high_value: prioritized.highValue.length,
                other: prioritized.other.length
            },
            cases: prioritized
        });

    } catch (err) {
        console.error('[Dashboard/Daily] Exception:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/dashboard/queue
 * Returns all cases grouped by action-required status buckets
 */
router.get('/queue', async (req, res) => {
    try {
        const now = new Date();
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

        // Get all active cases
        const { data: allCases, error } = await supabaseAdmin
            .from('submissions')
            .select('case_id, owner_name, status, next_action, next_follow_up_at, last_contact_at, filing_ready, filing_submitted, estimated_savings, estimated_tax_savings, estimated_revenue, estimated_reduction_value')
            .is('deleted_at', null)
            .neq('filing_submitted', true);

        if (error) {
            console.error('[Dashboard/Queue] Query error:', error);
            return res.status(500).json({ error: error.message });
        }

        // Bucket cases
        const buckets = {
            waiting_on_notice: [],
            waiting_on_signature: [],
            docs_received: [],
            stuck: [],
            ready_to_file: []
        };

        allCases.forEach(c => {
            // Ready to file (highest priority)
            if (c.filing_ready === true && c.filing_submitted !== true) {
                buckets.ready_to_file.push(c);
            }
            // Docs received / needs review
            else if (['NEEDS_REVIEW', 'DOCUMENT_RECEIVED'].includes(c.status)) {
                buckets.docs_received.push(c);
            }
            // Waiting on notice
            else if (['WAITING_FOR_NOTICE', 'AWAITING_NOTICE'].includes(c.status)) {
                buckets.waiting_on_notice.push(c);
            }
            // Waiting on signature
            else if (c.status && (c.status.includes('SIGN') || c.status.includes('AGREEMENT'))) {
                buckets.waiting_on_signature.push(c);
            }
            // Stuck (no recent contact and no follow-up scheduled)
            else if (c.last_contact_at && new Date(c.last_contact_at) < threeDaysAgo && !c.next_follow_up_at) {
                buckets.stuck.push(c);
            }
        });

        res.json({
            as_of: now.toISOString(),
            summary: {
                waiting_on_notice: buckets.waiting_on_notice.length,
                waiting_on_signature: buckets.waiting_on_signature.length,
                docs_received: buckets.docs_received.length,
                stuck: buckets.stuck.length,
                ready_to_file: buckets.ready_to_file.length
            },
            cases: buckets
        });

    } catch (err) {
        console.error('[Dashboard/Queue] Exception:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
