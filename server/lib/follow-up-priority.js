'use strict';

/**
 * Smart Follow-Up Priority Engine
 * ================================
 * Priority = savings value + engagement signals + pipeline stage + recency
 * 
 * Tiers:
 *   CRITICAL (score 80-100) — $5k+ savings OR engaged high-value. Manual call required.
 *   HIGH     (score 60-79)  — $2k+ savings OR recently engaged. Faster follow-ups.
 *   NORMAL   (score 30-59)  — Standard pipeline. Regular automation cadence.
 *   LOW      (score 10-29)  — Low value / no engagement. Slower automation.
 *   NONE     (score 0-9)    — Archived, DNC, or terminal. No follow-up.
 * 
 * Follow-up cadence:
 *   CRITICAL → 4h, then 24h, then 48h
 *   HIGH     → 24h, then 48h, then 7d
 *   NORMAL   → 48h, then 7d, then 14d
 *   LOW      → 7d, then 14d, then 30d
 *   NONE     → no follow-up scheduled
 */

const CADENCE = {
    CRITICAL: [4, 24, 48],         // hours
    HIGH:     [24, 48, 168],       // 24h, 48h, 7d
    NORMAL:   [48, 168, 336],      // 48h, 7d, 14d
    LOW:      [168, 336, 720],     // 7d, 14d, 30d
    NONE:     []
};

/**
 * Compute follow-up priority from case data
 * @param {object} lead — full submission row
 * @returns {{ priority: string, score: number, reason: string, nextFollowUpHours: number|null }}
 */
function computeFollowUpPriority(lead) {
    const status = (lead.status || '').trim();
    const savings = parseFloat(lead.estimated_savings) || 0;
    const contactAttempts = lead.contact_attempts || 0;
    const isDNC = !!lead.do_not_contact;
    const hasUploaded = lead.upload_status === 'uploaded';
    const hasWrongFile = lead.upload_status === 'wrong_document';
    const hasSigned = !!(lead.fee_agreement_signed || lead.signature);
    const hasPaid = !!lead.initiation_paid;
    const lastActivity = lead.last_activity_at ? new Date(lead.last_activity_at) : null;
    const lastContact = lead.last_contact_at ? new Date(lead.last_contact_at) : null;

    // Terminal states — no follow-up
    if (['Archived', 'No Case', 'Deleted', 'Resolved'].includes(status) || isDNC) {
        return { priority: 'NONE', score: 0, reason: isDNC ? 'Do Not Contact' : `${status} — no follow-up`, nextFollowUpHours: null };
    }

    let score = 0;
    let reasons = [];

    // === SAVINGS VALUE (0-40 points) ===
    if (savings >= 10000) { score += 40; reasons.push(`$${savings.toLocaleString()}/yr (very high value)`); }
    else if (savings >= 5000) { score += 35; reasons.push(`$${savings.toLocaleString()}/yr (high value)`); }
    else if (savings >= 2000) { score += 28; reasons.push(`$${savings.toLocaleString()}/yr (good value)`); }
    else if (savings >= 1000) { score += 20; reasons.push(`$${savings.toLocaleString()}/yr`); }
    else if (savings >= 500) { score += 12; reasons.push(`$${savings.toLocaleString()}/yr (moderate)`); }
    else if (savings > 0) { score += 5; reasons.push(`$${savings.toLocaleString()}/yr (low value)`); }

    // === ENGAGEMENT SIGNALS (0-30 points) ===
    if (hasWrongFile) { score += 25; reasons.push('Wrong file uploaded — engaged but needs help'); }
    else if (hasUploaded) { score += 20; reasons.push('Notice uploaded — actively engaged'); }
    if (hasSigned && !hasPaid) { score += 15; reasons.push('Signed but unpaid — close the deal'); }
    if (hasSigned && hasPaid) { score += 10; reasons.push('Signed + paid — ready to execute'); }

    // === PIPELINE STAGE (0-20 points) ===
    if (status === 'Ready to File') { score += 20; reasons.push('Ready to file — revenue imminent'); }
    else if (status === 'Analysis Complete') { score += 15; reasons.push('Analysis complete — move to close'); }
    else if (status === 'Awaiting Notice') { score += 8; reasons.push('Awaiting notice'); }
    else if (status === 'Needs Review') { score += 10; reasons.push('Needs review'); }
    else if (status === 'New') { score += 12; reasons.push('New lead — first contact needed'); }

    // === RECENCY (0-10 points) ===
    const now = Date.now();
    if (lastActivity) {
        const daysSinceActivity = (now - lastActivity.getTime()) / (86400000);
        if (daysSinceActivity > 14) { score += 10; reasons.push(`Stale ${Math.round(daysSinceActivity)}d — re-engage`); }
        else if (daysSinceActivity > 7) { score += 6; reasons.push(`${Math.round(daysSinceActivity)}d since activity`); }
        else if (daysSinceActivity <= 1) { score += 3; reasons.push('Recently active'); }
    } else {
        score += 5; reasons.push('No activity tracked — check status');
    }

    // === NO RESPONSE PENALTY ===
    if (contactAttempts >= 5) { score = Math.max(score - 15, 5); reasons.push(`${contactAttempts} attempts, no response — deprioritize`); }
    else if (contactAttempts >= 3) { score = Math.max(score - 8, 10); reasons.push(`${contactAttempts} attempts without response`); }

    // Cap at 100
    score = Math.min(score, 100);

    // Determine tier
    let priority;
    if (score >= 80) priority = 'CRITICAL';
    else if (score >= 60) priority = 'HIGH';
    else if (score >= 30) priority = 'NORMAL';
    else if (score >= 10) priority = 'LOW';
    else priority = 'NONE';

    // Compute next follow-up timing
    const cadence = CADENCE[priority];
    let nextFollowUpHours = null;
    if (cadence.length > 0) {
        // Use contact_attempts to determine which cadence step
        const step = Math.min(contactAttempts, cadence.length - 1);
        nextFollowUpHours = cadence[step];
    }

    return {
        priority,
        score,
        reason: reasons.join(' | '),
        nextFollowUpHours
    };
}

module.exports = { computeFollowUpPriority, CADENCE };
