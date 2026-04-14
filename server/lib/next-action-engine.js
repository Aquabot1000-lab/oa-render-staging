'use strict';

/**
 * Next Action Engine — SINGLE SOURCE OF TRUTH for case next_action
 * ================================================================
 * Every case MUST have exactly ONE next_action (never null).
 * This function computes it from the case's current state.
 * 
 * Called:
 *   1. On every status change
 *   2. On document upload
 *   3. On analysis completion
 *   4. On signature/payment events
 *   5. On bulk refresh (backfill)
 * 
 * Returns: { action: string, priority: number (1-100), icon: string }
 *   Higher priority = more urgent = shows first on dashboard
 * 
 * Priority tiers:
 *   90-100  CRITICAL — revenue at risk, deadline approaching
 *   70-89   HIGH — active close opportunity
 *   50-69   MEDIUM — standard pipeline progression
 *   30-49   LOW — waiting on external input
 *   10-29   BACKGROUND — monitoring / no immediate action
 *   1-9     TERMINAL — resolved, archived, no action needed
 */

const { isSupported } = require('./supported-states');

function computeNextAction(lead) {
    const status = (lead.status || '').trim();
    const hasNotice = !!(lead.notice_url || lead.notice_file || lead.notice_of_value);
    const wrongFile = (typeof lead.notes === 'string' && lead.notes.includes('WRONG FILE')) ||
                      lead.upload_status === 'wrong_document';
    const hasSig = !!(lead.fee_agreement_signed || lead.signature);
    const feePaid = !!lead.initiation_paid;
    const savings = parseFloat(lead.estimated_savings) || 0;
    const hasComps = lead.data_validation_status !== 'insufficient_data' &&
                     !((lead.comp_validation_status || '').includes('Only 0'));
    const filing = lead.filing_status || 'not_filed';
    const isDNC = !!lead.do_not_contact;
    const state = (lead.state || '').toUpperCase();
    const isActive = !['Archived', 'No Case', 'Deleted', 'Resolved'].includes(status);
    const firstName = (lead.owner_name || '').split(' ')[0] || 'customer';

    // === TERMINAL STATES ===
    if (!isActive) {
        if (status === 'Resolved') return { action: 'Case resolved — monitor for next year', priority: 5, icon: '✅' };
        if (status === 'Archived') return { action: 'Archived — no action needed', priority: 1, icon: '🗄️' };
        if (status === 'No Case') return { action: 'No case — closed', priority: 1, icon: '⛔' };
        if (status === 'Deleted') return { action: 'Deleted', priority: 1, icon: '🗑️' };
        return { action: 'No action — inactive', priority: 1, icon: '⏸️' };
    }

    // === DNC ===
    if (isDNC) {
        return { action: `DO NOT CONTACT — ${lead.do_not_contact_reason || 'flag set'}`, priority: 10, icon: '⛔' };
    }

    // === OUT OF STATE ===
    if (state && !isSupported(state)) {
        return { action: `Out of state (${state}) — waitlist`, priority: 5, icon: '🌍' };
    }

    // === CRITICAL: Wrong document uploaded ===
    if (wrongFile) {
        return { action: `Call ${firstName} — wrong file uploaded, needs correct notice`, priority: 95, icon: '🚨' };
    }

    // === HIGH: Ready to file but missing pieces ===
    if (status === 'Ready to File') {
        if (!feePaid && !hasSig) return { action: `Get signature + $79 payment from ${firstName}`, priority: 90, icon: '💰' };
        if (!feePaid) return { action: `Confirm $79 initiation fee from ${firstName}`, priority: 88, icon: '💰' };
        if (!hasSig) return { action: `Send signing link to ${firstName}`, priority: 85, icon: '✍️' };
        if (filing === 'not_filed') return { action: `File protest with ${lead.county || ''} County`, priority: 92, icon: '📨' };
        return { action: `Verify filing status — ${lead.county || ''} County`, priority: 70, icon: '📋' };
    }

    // === HIGH: Filing stages ===
    if (status === 'Filing Prepared') {
        return { action: `Submit filing to ${lead.county || ''} County`, priority: 90, icon: '📨' };
    }
    if (status === 'Protest Filed') {
        return { action: `Monitor for hearing date — ${lead.county || ''} County`, priority: 40, icon: '📅' };
    }
    if (status === 'Hearing Scheduled') {
        return { action: `Prepare hearing evidence for ${firstName}`, priority: 85, icon: '⚖️' };
    }

    // === MEDIUM-HIGH: Analysis complete, move to close ===
    if (status === 'Analysis Complete' || (status === 'Preliminary Analysis' && savings > 0 && hasComps)) {
        if (!hasSig) return { action: `Send savings report + get signature from ${firstName} ($${savings.toLocaleString()}/yr)`, priority: 75, icon: '📊' };
        return { action: `Move ${firstName} to Ready to File ($${savings.toLocaleString()}/yr)`, priority: 72, icon: '✅' };
    }

    // === MEDIUM: Analysis in progress ===
    if (status === 'Preliminary Analysis' && savings > 0 && !hasComps) {
        return { action: `Insufficient comps for ${firstName} — manual review needed`, priority: 65, icon: '⚠️' };
    }
    if (status === 'Preliminary Analysis') {
        return { action: `Complete analysis for ${firstName}`, priority: 60, icon: '🔍' };
    }

    // === MEDIUM: Awaiting notice ===
    if (status === 'Awaiting Notice' || status === 'Notice Received') {
        if (hasNotice && !wrongFile) return { action: `Run analysis — notice received from ${firstName}`, priority: 70, icon: '📊' };
        if (savings > 0) return { action: `Get notice from ${firstName} ($${savings.toLocaleString()}/yr est.)`, priority: 55, icon: '📄' };
        return { action: `Get notice from ${firstName}`, priority: 45, icon: '📄' };
    }

    // === Needs Review / Needs Info ===
    if (status === 'Needs Review' || status === 'Hold - Data Integrity Review' || status === 'Hold') {
        if (savings > 1000) return { action: `Review ${firstName} — high value ($${savings.toLocaleString()}/yr)`, priority: 70, icon: '🔍' };
        return { action: `Review case data for ${firstName}`, priority: 55, icon: '🔍' };
    }
    if (status === 'Needs Info') {
        return { action: `Get missing info from ${firstName}`, priority: 50, icon: '❓' };
    }

    // === Data Enrichment ===
    if (status === 'Data Enrichment') {
        return { action: `Enrich property data for ${firstName}`, priority: 55, icon: '🏠' };
    }

    // === Contacted ===
    if (status === 'Contacted') {
        return { action: `Follow up with ${firstName}`, priority: 50, icon: '📞' };
    }

    // === New lead ===
    if (status === 'New') {
        return { action: `Send intro to ${firstName} — new lead`, priority: 60, icon: '📧' };
    }

    // === Fallback ===
    return { action: `Triage ${firstName} — status: ${status}`, priority: 50, icon: '🎯' };
}

module.exports = { computeNextAction };
