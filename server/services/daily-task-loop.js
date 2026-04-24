/**
 * daily-task-loop.js
 *
 * Daily task digest loop
 * Pulls all cases needing attention and sends a single Telegram digest
 */

/**
 * Runs the daily task loop
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {Function} sendTelegramAlert - Telegram alert function
 * @returns {Promise<Object>} { cases_reviewed: number, digest_sent: boolean }
 */
async function runDailyTaskLoop(supabaseAdmin, sendTelegramAlert) {
    console.log('[DailyTaskLoop] Starting daily digest...');

    try {
        const now = new Date();

        // Pull all cases that need attention
        const { data: cases, error } = await supabaseAdmin
            .from('submissions')
            .select('case_id, owner_name, next_action, next_follow_up_at, estimated_savings, filing_ready, status')
            .lte('next_follow_up_at', now.toISOString())
            .neq('do_not_contact', true)
            .is('deleted_at', null)
            .neq('filing_submitted', true);

        if (error) {
            console.error('[DailyTaskLoop] Query error:', error);
            return { cases_reviewed: 0, digest_sent: false, error: error.message };
        }

        if (!cases || cases.length === 0) {
            console.log('[DailyTaskLoop] No cases need attention today');
            return { cases_reviewed: 0, digest_sent: false };
        }

        // Sort by priority
        const prioritized = {
            urgent: [],      // filing_ready = true
            docs: [],        // status = NEEDS_REVIEW or DOCUMENT_RECEIVED
            highValue: [],   // estimated_savings > 5000
            other: []        // everything else
        };

        cases.forEach(c => {
            if (c.filing_ready === true) {
                prioritized.urgent.push(c);
            } else if (['NEEDS_REVIEW', 'DOCUMENT_RECEIVED'].includes(c.status)) {
                prioritized.docs.push(c);
            } else if (c.estimated_savings && c.estimated_savings > 5000) {
                prioritized.highValue.push(c);
            } else {
                prioritized.other.push(c);
            }
        });

        // Build digest message
        const dateStr = now.toLocaleDateString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        let digest = `📋 <b>DAILY TASK DIGEST — ${dateStr}</b>\n\n`;

        // Urgent section
        if (prioritized.urgent.length > 0) {
            digest += `🔴 <b>URGENT (${prioritized.urgent.length} cases)</b>\n`;
            prioritized.urgent.forEach(c => {
                const savings = c.estimated_savings ? `$${c.estimated_savings.toLocaleString()}` : 'Unknown';
                digest += `• ${c.case_id} [${c.owner_name}] — ${c.next_action || 'Ready to file'} — savings: ${savings}\n`;
            });
            digest += '\n';
        }

        // Docs section
        if (prioritized.docs.length > 0) {
            digest += `🟡 <b>DOCS RECEIVED (${prioritized.docs.length} cases)</b>\n`;
            prioritized.docs.forEach(c => {
                const savings = c.estimated_savings ? `$${c.estimated_savings.toLocaleString()}` : 'Unknown';
                digest += `• ${c.case_id} [${c.owner_name}] — ${c.next_action || 'Review document'} — savings: ${savings}\n`;
            });
            digest += '\n';
        }

        // High value section
        if (prioritized.highValue.length > 0) {
            digest += `💰 <b>HIGH VALUE (${prioritized.highValue.length} cases)</b>\n`;
            prioritized.highValue.forEach(c => {
                const savings = c.estimated_savings ? `$${c.estimated_savings.toLocaleString()}` : 'Unknown';
                digest += `• ${c.case_id} [${c.owner_name}] — ${c.next_action || 'Follow up'} — savings: ${savings}\n`;
            });
            digest += '\n';
        }

        // Other section
        if (prioritized.other.length > 0) {
            digest += `🟢 <b>FOLLOW UP (${prioritized.other.length} cases)</b>\n`;
            prioritized.other.forEach(c => {
                const savings = c.estimated_savings ? `$${c.estimated_savings.toLocaleString()}` : 'Unknown';
                digest += `• ${c.case_id} [${c.owner_name}] — ${c.next_action || 'Follow up'} — savings: ${savings}\n`;
            });
            digest += '\n';
        }

        digest += `<b>Total: ${cases.length} cases need attention</b>`;

        // Send to Telegram
        if (typeof sendTelegramAlert === 'function') {
            await sendTelegramAlert(digest);
            console.log(`[DailyTaskLoop] Digest sent — ${cases.length} cases`);
        } else {
            console.warn('[DailyTaskLoop] sendTelegramAlert not available');
        }

        return {
            cases_reviewed: cases.length,
            digest_sent: true
        };

    } catch (err) {
        console.error('[DailyTaskLoop] Exception:', err);
        return {
            cases_reviewed: 0,
            digest_sent: false,
            error: err.message
        };
    }
}

module.exports = { runDailyTaskLoop };
