'use strict';

/**
 * lib/next-action-engine.js — Phase 2 (Tyler msg 28507, 2026-05-01)
 * ================================================================
 * PURE READ-ONLY. NEVER MUTATES STATE.
 *
 * Computes the canonical next action for a case from canonical fields only:
 *   - aoa_signed (bool)
 *   - notice_received (bool)
 *   - estimated_tax_savings (numeric, via metric-shim.readTaxSavings)
 *   - filing_ready (bool)
 *   - filing_status (string)
 *   - manual_status_lock (bool)
 *   - last_outreach_at (timestamp; canonical equivalent of outreach_sent_at)
 *   - outcome (string; optional — sourced from filing_status terminal values when present)
 *   - status_lock_reason (string; optional)
 *
 * All comp/savings reads go through metric-shim. NO legacy field access
 * outside the shim's internal fallback.
 *
 * RETURN SHAPE (Tyler-approved):
 *   {
 *     action:   string,
 *     priority: "p1" | "p2" | "p3" | "p4",
 *     color:    "red" | "orange" | "yellow" | "blue" | "green" | "gray",
 *     reason:   string,
 *
 *     // back-compat fields for legacy callers (server.js writes
 *     // next_action / next_action_priority / icon to submissions); these are
 *     // computed from the canonical p1-p4 + action so old callers keep working.
 *     icon:                 string,
 *     legacy_priority:      number,   // 1-100 scale (90=p1, 70=p2, 50=p3, 20=p4)
 *   }
 *
 * RULES:
 *   - Order matters; first matching rule wins.
 *   - Pure function. No side effects. No DB writes. No event triggers.
 *   - Reads only the fields listed above.
 */

const { readTaxSavings } = require('./metric-shim');
const { classifyFilingWindow } = require('./filing-window');

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

// Map p-level → display color + legacy numeric priority for back-compat callers
const PRIORITY_TO_LEGACY = { p1: 90, p2: 70, p3: 50, p4: 20 };

/**
 * Returns the comp count for a case using canonical reads only.
 * comp_results may be a JSON array of comp objects, or null. Anything else → 0.
 */
function compsCount(row) {
  if (!row) return 0;
  const c = row.comp_results;
  if (Array.isArray(c)) return c.length;
  if (typeof c === 'string') {
    try { const arr = JSON.parse(c); return Array.isArray(arr) ? arr.length : 0; }
    catch (_) { return 0; }
  }
  return 0;
}

/**
 * Days since the most recent outreach (last_outreach_at).
 * Returns Infinity if never sent.
 */
function daysSinceOutreach(row) {
  const t = row && row.last_outreach_at;
  if (!t) return Infinity;
  const d = new Date(t);
  if (isNaN(d.getTime())) return Infinity;
  return (Date.now() - d.getTime()) / (24 * 60 * 60 * 1000);
}

/**
 * Pure compute. No side effects.
 */
function computeNextAction(caseRow) {
  const row = caseRow || {};

  // ── canonical reads only ──
  const locked         = row.manual_status_lock === true;
  const lockReason     = row.status_lock_reason || row.manual_lock_reason || 'manual hold';
  const aoaSigned      = row.aoa_signed === true;
  const noticeReceived = row.notice_received === true;
  const filingReady    = row.filing_ready === true;
  const filingStatus   = (row.filing_status || '').toUpperCase();
  const taxSavings     = readTaxSavings(row);
  const outreachAtMs   = row.last_outreach_at ? new Date(row.last_outreach_at).getTime() : null;
  const hasOutreach    = !!outreachAtMs && !isNaN(outreachAtMs);
  const outreachAgeDays = hasOutreach ? (Date.now() - outreachAtMs) / 86400000 : null;
  const comps          = compsCount(row);
  const outcome        = (row.outcome || '').toUpperCase();

  // ── Filing-window awareness (Tyler msg 34818, 2026-05-16) ──
  // Compute classification once; rules below short-circuit to late-remedy / 2027
  // tracks when the standard window is closed.
  const filingWindow = classifyFilingWindow(row);
  const windowClosed = filingWindow === 'LATE_REMEDY_REVIEW'
    || filingWindow === 'MISSED_STANDARD_DEADLINE'
    || filingWindow === '2027_CANDIDATE';

  // ── ordered rules (first match wins) ──

  // 0. Manual lock — always first
  if (locked) {
    return wrap({
      action: `🔒 Status locked: ${lockReason}`,
      priority: 'p4',
      color: 'gray',
      reason: 'manual_status_lock=true',
      icon: '🔒',
    });
  }

  // 0b. Window closed + no signature — do NOT push standard "Send AOA" CTA.
  //     Route to late-remedy / 2027 tracking instead.
  if (!aoaSigned && windowClosed) {
    if (filingWindow === '2027_CANDIDATE') {
      return wrap({
        action: 'Monitor for 2027 cycle',
        priority: 'p4',
        color: 'gray',
        reason: 'tagged as 2027_PROTEST_CANDIDATE / NEW_CONSTRUCTION_POTENTIAL',
        icon: '📅',
      });
    }
    if (filingWindow === 'LATE_REMEDY_REVIEW') {
      return wrap({
        action: 'Late-remedy review (§25.25 / no-notice / certified-roll)',
        priority: 'p3',
        color: 'yellow',
        reason: 'standard window closed; data-rich case eligible for late-remedy evaluation',
        icon: '🔎',
      });
    }
    // MISSED_STANDARD_DEADLINE
    return wrap({
      action: 'Late follow-up + 2027 candidate',
      priority: 'p3',
      color: 'yellow',
      reason: 'standard window closed; data-poor lead — send late follow-up and preserve for 2027',
      icon: '⏳',
    });
  }

  // 1. AOA not signed, never reached out (ACTIVE WINDOW only)
  if (!aoaSigned && !hasOutreach) {
    return wrap({
      action: 'Send AOA request',
      priority: 'p1',
      color: 'red',
      reason: 'aoa_signed=false and no outreach yet',
      icon: '📤',
    });
  }

  // 2. AOA not signed, outreached < 14d
  if (!aoaSigned && hasOutreach && outreachAgeDays < 14) {
    return wrap({
      action: 'Awaiting AOA signature',
      priority: 'p2',
      color: 'orange',
      reason: `outreach sent ${Math.floor(outreachAgeDays)}d ago, signature pending`,
      icon: '⏳',
    });
  }

  // 3. AOA not signed, outreached ≥ 14d
  if (!aoaSigned && hasOutreach && outreachAgeDays >= 14) {
    return wrap({
      action: 'Re-send AOA / review lead',
      priority: 'p2',
      color: 'orange',
      reason: `outreach sent ${Math.floor(outreachAgeDays)}d ago, no signature — stale`,
      icon: '🔁',
    });
  }

  // 4. AOA signed, no notice
  if (aoaSigned && !noticeReceived) {
    return wrap({
      action: 'Request Notice of Value (NOV)',
      priority: 'p2',
      color: 'yellow',
      reason: 'aoa_signed=true but notice_received=false',
      icon: '📄',
    });
  }

  // 5. Notice received, no comps
  if (noticeReceived && comps === 0) {
    return wrap({
      action: 'Run comps',
      priority: 'p2',
      color: 'blue',
      reason: 'notice_received=true and 0 comps in comp_results',
      icon: '📊',
    });
  }

  // 6. Comps run but no savings
  if (comps > 0 && taxSavings <= 0) {
    return wrap({
      action: 'No savings — review / deny',
      priority: 'p1',
      color: 'red',
      reason: `comps=${comps} but estimated_tax_savings=${taxSavings}`,
      icon: '⛔',
    });
  }

  // 7. Comps + savings, package not built
  if (comps > 0 && taxSavings > 0 && !filingReady) {
    return wrap({
      action: 'Build filing package',
      priority: 'p3',
      color: 'blue',
      reason: `comps=${comps}, savings=$${Math.round(taxSavings).toLocaleString()}, filing_ready=false`,
      icon: '📦',
    });
  }

  // 8. Filing ready, not yet filed
  //    If window is closed, recharacterize as late-remedy / internal review candidate
  //    (Tyler msg 34818: no more "ready for filing approval" urgency for closed-window cases).
  if (filingReady && filingStatus !== 'FILED') {
    if (windowClosed) {
      return wrap({
        action: 'Late-remedy / internal review candidate',
        priority: 'p3',
        color: 'yellow',
        reason: `filing_ready=true but filing window=${filingWindow}; route to late-remedy review (no urgent approval)`,
        icon: '🔎',
      });
    }
    return wrap({
      action: 'Approve for filing',
      priority: 'p1',
      color: 'green',
      reason: `filing_ready=true and filing_status=${filingStatus || 'not_filed'}`,
      icon: '✅',
    });
  }

  // 9. Filed, awaiting hearing/outcome
  if (filingStatus === 'FILED' && !outcome) {
    return wrap({
      action: 'Awaiting hearing',
      priority: 'p4',
      color: 'gray',
      reason: 'filing_status=FILED, no outcome yet',
      icon: '⚖️',
    });
  }

  // 10. Won
  if (outcome === 'WIN') {
    return wrap({
      action: 'Send invoice / close',
      priority: 'p4',
      color: 'green',
      reason: 'outcome=WIN',
      icon: '💰',
    });
  }

  // 11. Lost
  if (outcome === 'LOSS') {
    return wrap({
      action: 'Close case',
      priority: 'p4',
      color: 'gray',
      reason: 'outcome=LOSS',
      icon: '🏁',
    });
  }

  // Fallback — should be unreachable in practice if a case has any state at all
  return wrap({
    action: 'Review case',
    priority: 'p4',
    color: 'gray',
    reason: 'no rule matched (case state is undefined or terminal)',
    icon: '🔍',
  });
}

// ── helpers ──

function wrap(out) {
  // Compute legacy back-compat fields so existing server.js callers keep working
  const legacy_priority = PRIORITY_TO_LEGACY[out.priority] || 20;
  return {
    action: out.action,
    priority: out.priority,         // p1-p4 (new canonical)
    color:   out.color,
    reason:  out.reason,
    icon:    out.icon || '',
    // legacy back-compat shape:
    legacy_priority,
  };
}

module.exports = {
  computeNextAction,
  // exported for tests
  _internals: { compsCount, daysSinceOutreach, FOURTEEN_DAYS_MS },
};
