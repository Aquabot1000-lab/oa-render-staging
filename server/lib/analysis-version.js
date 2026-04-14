'use strict';

/**
 * Analysis Version Control
 * ========================
 * RULE: Only ONE active analysis per case (on submissions table).
 * All previous analyses are preserved in analysis_history.
 * 
 * Before updating analysis data:
 *   1. Snapshot current analysis → analysis_history
 *   2. Increment analysis_version
 *   3. Update submissions with new data
 *   4. Log to activity_log
 *   5. NEVER overwrite silently
 * 
 * Confidence levels:
 *   HIGH   — Evidence Generated, validated comps, savings > $500
 *   MEDIUM — Preliminary analysis with comps, savings > $200
 *   LOW    — Preliminary/no comps, invalidated, or savings < $200
 *   UNKNOWN — No analysis run yet
 */

/**
 * Compute confidence level from analysis data
 * Rules:
 *   - VERIFIED (notice uploaded) + Evidence Generated = HIGH
 *   - VERIFIED (notice uploaded) = MEDIUM
 *   - PRELIMINARY with savings range (min/max) = MEDIUM
 *   - PRELIMINARY without range = LOW
 *   - Invalidated = always LOW
 *   - No savings = UNKNOWN
 */
function computeConfidence(data) {
    const savings = parseFloat(data.estimated_savings) || 0;
    const status = (data.analysis_status || '').toLowerCase();
    const tier = data.analysis_tier || 'PRELIMINARY';
    const hasNotice = (data.upload_status === 'uploaded' && data.upload_status !== 'wrong_document') ||
                      !!(data.notice_url || data.notice_of_value);

    // Invalidated = always LOW
    if (status.includes('invalidated')) return 'LOW';
    
    // No savings = UNKNOWN
    if (savings <= 0) return 'UNKNOWN';

    // VERIFIED (notice-based)
    if (tier === 'VERIFIED' || hasNotice) {
        if (status === 'evidence generated') return 'HIGH';
        return 'MEDIUM';
    }

    // PRELIMINARY with savings range = MEDIUM
    if (data.savings_min && data.savings_max && parseFloat(data.savings_min) > 0) return 'MEDIUM';

    // Everything else preliminary = LOW
    return 'LOW';
}

/**
 * Compute analysis tier from notice presence
 */
function computeAnalysisTier(data) {
    const hasValidNotice = (data.upload_status === 'uploaded' && data.upload_status !== 'wrong_document') ||
                           !!(data.notice_url || data.notice_of_value);
    return hasValidNotice ? 'VERIFIED' : 'PRELIMINARY';
}

/**
 * Snapshot current analysis to history, then update with new data.
 * @param {object} supabase — Supabase admin client
 * @param {string} caseId — e.g. "OA-0025"
 * @param {object} newAnalysis — { estimated_savings, savings_min, savings_max, analysis_status, analysis_report, comp_results, comp_validation_status, source }
 * @param {string} actor — who triggered this (e.g. "system", "tyler", "rentcast")
 * @returns {{ success: boolean, version: number, confidence: string, previousSavings: number|null }}
 */
async function updateAnalysis(supabase, caseId, newAnalysis, actor = 'system') {
    // 1. Get current state
    const { data: current, error: fetchErr } = await supabase
        .from('submissions')
        .select('estimated_savings,savings_min,savings_max,confidence_level,analysis_version,analysis_status,analysis_report,comp_results,comp_validation_status')
        .eq('case_id', caseId)
        .single();

    if (fetchErr || !current) {
        return { success: false, error: 'Case not found: ' + caseId };
    }

    const previousSavings = parseFloat(current.estimated_savings) || 0;
    const newVersion = (current.analysis_version || 1) + 1;

    // 2. Snapshot current to history (if there's existing analysis data)
    if (previousSavings > 0 || current.analysis_status) {
        await supabase.from('analysis_history').insert({
            case_id: caseId,
            version: current.analysis_version || 1,
            estimated_savings: current.estimated_savings,
            savings_min: current.savings_min,
            savings_max: current.savings_max,
            confidence_level: current.confidence_level,
            analysis_status: current.analysis_status,
            analysis_report: current.analysis_report,
            comp_results: current.comp_results,
            comp_validation_status: current.comp_validation_status,
            source: 'version_snapshot',
            notes: `Superseded by v${newVersion} (triggered by ${actor})`
        });
    }

    // 3. Compute tier + confidence
    const tier = computeAnalysisTier(newAnalysis);
    const confidence = computeConfidence({ ...newAnalysis, analysis_tier: tier });

    // 4. Update submissions with new analysis
    const updateData = {
        estimated_savings: newAnalysis.estimated_savings,
        savings_min: newAnalysis.savings_min || null,
        savings_max: newAnalysis.savings_max || null,
        confidence_level: confidence,
        analysis_tier: tier,
        analysis_version: newVersion,
        analysis_date: new Date().toISOString(),
        analysis_status: newAnalysis.analysis_status || 'preliminary',
        updated_at: new Date().toISOString()
    };
    if (newAnalysis.analysis_report) updateData.analysis_report = newAnalysis.analysis_report;
    if (newAnalysis.comp_results) updateData.comp_results = newAnalysis.comp_results;
    if (newAnalysis.comp_validation_status) updateData.comp_validation_status = newAnalysis.comp_validation_status;

    const { error: updateErr } = await supabase
        .from('submissions')
        .update(updateData)
        .eq('case_id', caseId);

    if (updateErr) {
        return { success: false, error: updateErr.message };
    }

    // 5. Log to activity_log — NEVER overwrite silently
    await supabase.from('activity_log').insert({
        case_id: caseId,
        actor,
        action: 'analysis_updated',
        details: {
            version: newVersion,
            previous_savings: previousSavings,
            new_savings: parseFloat(newAnalysis.estimated_savings) || 0,
            confidence,
            source: newAnalysis.source || 'unknown',
            savings_change: previousSavings > 0
                ? `$${previousSavings.toLocaleString()} → $${(parseFloat(newAnalysis.estimated_savings) || 0).toLocaleString()}`
                : 'First analysis'
        }
    });

    return {
        success: true,
        version: newVersion,
        confidence,
        previousSavings: previousSavings || null
    };
}

/**
 * Get analysis history for a case (most recent first)
 */
async function getAnalysisHistory(supabase, caseId) {
    const { data, error } = await supabase
        .from('analysis_history')
        .select('*')
        .eq('case_id', caseId)
        .order('version', { ascending: false });

    if (error) return [];
    return data || [];
}

module.exports = { computeConfidence, computeAnalysisTier, updateAnalysis, getAnalysisHistory };
