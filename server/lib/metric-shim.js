/**
 * lib/metric-shim.js
 *
 * Single helper for reading the canonical Tyler-spec metric bundle (msg 28217)
 * with safe fallback to the legacy `estimated_savings` column for any row that
 * hasn't been touched by rebuildAllMetrics() yet.
 *
 * USE THIS for ALL read-paths that surface savings/revenue numbers to the
 * dashboard, pipeline list, case detail, exports, alerts, etc.
 *
 * NEVER write directly to estimated_savings / estimated_revenue /
 * estimated_tax_savings / estimated_reduction_value / estimated_tax_rate /
 * comp_low_anchor_value / settlement_estimate_value — all writes go through
 * services/state-controller.js (rebuildAllMetrics or updateCaseState).
 *
 * Authorized: Tyler msg 28217 / 28231 / 28321 (CRM Operator Mode Phase 0.5)
 */

'use strict';

const FEE_RATE = 0.25;

/**
 * Annual customer tax savings — the headline "Estimated Tax Savings" number.
 * Falls back to legacy estimated_savings if the new field hasn't populated yet.
 */
function readTaxSavings(row) {
  if (!row) return 0;
  const n = Number(row.estimated_tax_savings);
  if (Number.isFinite(n) && n > 0) return n;
  const legacy = Number(row.estimated_savings);
  return Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
}

/**
 * OverAssessed revenue (25 % fee on actual tax savings).
 * Falls back to readTaxSavings(row) × 0.25 when the canonical field isn't set.
 */
function readRevenue(row) {
  if (!row) return 0;
  const n = Number(row.estimated_revenue);
  if (Number.isFinite(n) && n > 0) return n;
  return Math.round(readTaxSavings(row) * FEE_RATE);
}

/**
 * Reduction value = assessed - lowest comp. The opening anchor for negotiation.
 * Returns 0 if no defensible reduction can be calculated.
 */
function readReductionValue(row) {
  if (!row) return 0;
  const n = Number(row.estimated_reduction_value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Effective tax rate used for the calculation (county-specific, e.g. 0.025).
 */
function readTaxRate(row) {
  if (!row) return null;
  const n = Number(row.estimated_tax_rate);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Lowest adjusted comp value — the aggressive opening ask.
 */
function readCompLowAnchor(row) {
  if (!row) return null;
  const n = Number(row.comp_low_anchor_value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Median comp value — internal settlement target only, NOT a customer-facing number.
 */
function readSettlementEstimate(row) {
  if (!row) return null;
  const n = Number(row.settlement_estimate_value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Whole metric bundle in one call.  Every value zero/null when not computable.
 */
function readMetrics(row) {
  return {
    tax_savings:         readTaxSavings(row),
    revenue:             readRevenue(row),
    reduction_value:     readReductionValue(row),
    tax_rate:            readTaxRate(row),
    comp_low_anchor:     readCompLowAnchor(row),
    settlement_estimate: readSettlementEstimate(row),
  };
}

/**
 * Sum the metrics over an array of rows.  Returns the same shape as readMetrics().
 */
function sumMetrics(rows) {
  const out = {
    tax_savings: 0, revenue: 0, reduction_value: 0,
    tax_rate: null, comp_low_anchor: null, settlement_estimate: null,
    cases_with_metric: 0,
  };
  for (const r of rows || []) {
    const ts = readTaxSavings(r);
    if (ts > 0) {
      out.cases_with_metric++;
      out.tax_savings     += ts;
      out.revenue         += readRevenue(r);
      out.reduction_value += readReductionValue(r);
    }
  }
  return out;
}

module.exports = {
  FEE_RATE,
  readTaxSavings,
  readRevenue,
  readReductionValue,
  readTaxRate,
  readCompLowAnchor,
  readSettlementEstimate,
  readMetrics,
  sumMetrics,
};
