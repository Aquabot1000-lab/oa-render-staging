'use strict';

/**
 * SINGLE SOURCE OF TRUTH — State Support Configuration
 * =====================================================
 * ALL intake, validation, routing, CRM display, cron jobs,
 * and outreach logic MUST import from this file.
 * 
 * DO NOT hardcode state lists anywhere else in the codebase.
 * DO NOT create parallel state arrays.
 * 
 * To add a new state: add it to SUPPORTED_STATES below.
 * That's it. Everything else reads from here.
 * 
 * Updated: 2026-04-14 — Tyler directive (P0):
 *   TX, GA, CO, AZ, WA = SUPPORTED (full pipeline)
 *   Everything else = OUT_OF_STATE (waitlist)
 */

const SUPPORTED_STATES = ['TX', 'GA', 'CO', 'AZ', 'WA'];

/**
 * Is this state in the full pipeline?
 * @param {string} state — 2-letter state code
 * @returns {boolean}
 */
function isSupported(state) {
    if (!state) return false;
    return SUPPORTED_STATES.includes(state.toUpperCase().trim());
}

/**
 * Returns true if state is supported OR unknown (null/empty).
 * Use for intake — don't reject unknown states, let routing decide.
 */
function isSupportedOrUnknown(state) {
    if (!state) return true;
    return isSupported(state);
}

/**
 * Get display badge info for CRM UI
 * @param {string} state
 * @returns {{ label: string, color: string, bgColor: string, supported: boolean }}
 */
function getStateBadge(state) {
    if (isSupported(state)) {
        return { label: state?.toUpperCase() || '?', color: '#6ee7b7', bgColor: '#065f46', supported: true };
    }
    return { label: `${state?.toUpperCase() || '?'} — OUT OF STATE`, color: '#fca5a5', bgColor: '#7f1d1d', supported: false };
}

module.exports = {
    SUPPORTED_STATES,
    isSupported,
    isSupportedOrUnknown,
    getStateBadge
};
