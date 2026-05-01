/**
 * scripts/_metric-rebuild-preview.js
 *
 * READ-ONLY preview of Tyler's standardized metric definitions (msg 28217).
 *
 *   1. estimated_reduction_value = assessed_value - LOWEST adjusted comp value
 *   2. estimated_tax_savings     = estimated_reduction_value * estimated_tax_rate
 *   3. estimated_revenue         = estimated_tax_savings * 0.25
 *
 *   opening_anchor_value     = lowest comp (used for the anchor / opening ask)
 *   settlement_estimate_value = median comp (internal reference only)
 *
 * Eligibility filters (matching Tyler msg 28217 "active/non-test/non-DNC"):
 *   - exclude do_not_contact = true
 *   - exclude status IN (NO_OPPORTUNITY, LOST_CONTACT, CLOSED, WITHDRAWN, REJECTED, TEST)
 *   - exclude property_address LIKE '%TEST%' / owner_name LIKE '%TEST%'
 *   - require comps with marketValue > 1000
 *   - require assessed_value > 1000
 *
 * Outputs a side-by-side table of every active case + new dashboard totals.
 */

'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const COUNTY_TAX_RATES = {
  'bexar': 0.0225, 'harris': 0.0230, 'travis': 0.0210, 'fort bend': 0.0250,
  'tarrant': 0.0240, 'hunt': 0.0225, 'dallas': 0.0230, 'collin': 0.0220,
  'denton': 0.0230, 'williamson': 0.0220, 'kaufman': 0.0235, 'rockwall': 0.0235,
};
const DEFAULT_TX_TAX_RATE = 0.025;
const FEE_RATE = 0.25;

const EXCLUDED_STATUSES = new Set([
  'NO_OPPORTUNITY', 'LOST_CONTACT', 'CLOSED', 'WITHDRAWN', 'REJECTED', 'TEST', 'DUPLICATE',
]);

function looksLikeTest(row) {
  const s = (row.owner_name + ' ' + (row.property_address||'') + ' ' + (row.email||'')).toLowerCase();
  return /\b(test|dummy|fake|sample|aquabot|qa-|internal-)\b/.test(s);
}

function getTaxRate(county) {
  if (!county) return DEFAULT_TX_TAX_RATE;
  const k = county.toLowerCase().replace(/ county$/i,'').trim();
  return COUNTY_TAX_RATES[k] || DEFAULT_TX_TAX_RATE;
}

function lowestCompValue(comps) {
  if (!Array.isArray(comps) || !comps.length) return null;
  const vals = comps
    .map(c => Number(
      c.adjustedValue || c.adjusted_value || c.adjustedSalePrice || c.adjusted_sale_price ||
      c.marketValue   || c._mv             || c.market_value
    ))
    .filter(n => Number.isFinite(n) && n > 1000);
  if (!vals.length) return null;
  return Math.min(...vals);
}

function medianCompValue(comps) {
  if (!Array.isArray(comps) || !comps.length) return null;
  const vals = comps
    .map(c => Number(
      c.adjustedValue || c.adjusted_value || c.adjustedSalePrice || c.adjusted_sale_price ||
      c.marketValue   || c._mv             || c.market_value
    ))
    .filter(n => Number.isFinite(n) && n > 1000)
    .sort((a,b) => a-b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length/2);
  return vals.length % 2 ? vals[mid] : (vals[mid-1]+vals[mid])/2;
}

function compute(row) {
  const out = {
    case_id: row.case_id,
    status: row.status,
    eligible: true,
    skip_reason: null,
    assessed: Number(row.assessed_value || row.property_data?.assessedValue || 0),
    county: row.county || row.property_data?.county || null,
    tax_rate: null,
    comp_low_anchor_value: null,
    settlement_estimate_value: null,
    estimated_reduction_value: null,
    estimated_tax_savings: null,
    estimated_revenue: null,
    db_old_estimated_savings: Number(row.estimated_savings || 0),
    comps_count: 0,
  };

  if (row.do_not_contact)                     { out.eligible=false; out.skip_reason='dnc'; return out; }
  if (EXCLUDED_STATUSES.has(row.status))      { out.eligible=false; out.skip_reason=`status=${row.status}`; return out; }
  if (looksLikeTest(row))                     { out.eligible=false; out.skip_reason='test_or_dummy'; return out; }
  if (!out.assessed || out.assessed < 1000)   { out.eligible=false; out.skip_reason='no_assessed'; return out; }

  let comps = null;
  if (Array.isArray(row.comp_results)) comps = row.comp_results;
  else if (row.comp_results?.comps) comps = row.comp_results.comps;
  else if (row.property_data?.comps) comps = row.property_data.comps;

  if (!comps || !comps.length) { out.skip_reason='no_comps'; return out; }
  out.comps_count = comps.length;
  out.tax_rate = getTaxRate(out.county);

  const low = lowestCompValue(comps);
  const med = medianCompValue(comps);
  out.comp_low_anchor_value = low;
  out.settlement_estimate_value = med ? Math.round(med) : null;

  if (low == null) { out.skip_reason='comps_have_no_values'; return out; }
  if (low >= out.assessed) { out.skip_reason='no_reduction_possible'; return out; }

  out.estimated_reduction_value = Math.round(out.assessed - low);
  out.estimated_tax_savings = Math.round(out.estimated_reduction_value * out.tax_rate);
  out.estimated_revenue = Math.round(out.estimated_tax_savings * FEE_RATE);
  return out;
}

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: rows, error } = await sb.from('submissions')
    .select('case_id,owner_name,email,property_address,county,status,assessed_value,property_data,comp_results,do_not_contact,estimated_savings,manual_only')
    .order('case_id', { ascending: true });
  if (error) throw error;

  let oldTotal = 0;
  let newSavTotal = 0;
  let newRevTotal = 0;
  let eligibleCount = 0;
  let withReductionCount = 0;
  const allEval = [];
  for (const r of rows) {
    const m = compute(r);
    allEval.push(m);
    oldTotal += m.db_old_estimated_savings || 0;
    if (m.eligible) eligibleCount++;
    if (m.estimated_tax_savings != null) {
      withReductionCount++;
      newSavTotal += m.estimated_tax_savings;
      newRevTotal += m.estimated_revenue;
    }
  }

  // Top 10 cases by new tax savings
  const top = allEval
    .filter(m => m.estimated_tax_savings)
    .sort((a,b) => b.estimated_tax_savings - a.estimated_tax_savings)
    .slice(0, 12);

  console.log('\n========================================================================');
  console.log('  METRIC REBUILD PREVIEW — Tyler msg 28217 (READ-ONLY, no DB writes)');
  console.log('========================================================================\n');

  console.log(`Total cases scanned:           ${rows.length}`);
  console.log(`Eligible (active, non-test):   ${eligibleCount}`);
  console.log(`With computable reduction:     ${withReductionCount}`);
  console.log('');
  console.log('DASHBOARD TOTALS:');
  console.log(`  OLD: sum(estimated_savings)     = $${oldTotal.toLocaleString()}`);
  console.log(`  NEW: sum(estimated_tax_savings) = $${newSavTotal.toLocaleString()}`);
  console.log(`  NEW: sum(estimated_revenue)     = $${newRevTotal.toLocaleString()}`);

  console.log('\nTOP 12 ELIGIBLE CASES (sorted by new estimated_tax_savings):\n');
  console.log('Case      | Status                   | Assessed   | LowestComp | Reduction  | TaxRate | TaxSavings | Revenue');
  console.log('----------|--------------------------|------------|------------|------------|---------|------------|--------');
  for (const m of top) {
    console.log(
      `${m.case_id.padEnd(9)} | ${(m.status||'').padEnd(24).slice(0,24)} | ` +
      `$${m.assessed.toLocaleString().padStart(9)} | ` +
      `$${(m.comp_low_anchor_value||0).toLocaleString().padStart(9)} | ` +
      `$${(m.estimated_reduction_value||0).toLocaleString().padStart(9)} | ` +
      `${(m.tax_rate*100).toFixed(2)}%  | ` +
      `$${(m.estimated_tax_savings||0).toLocaleString().padStart(9)} | ` +
      `$${(m.estimated_revenue||0).toLocaleString().padStart(7)}`
    );
  }

  // Skip-reason breakdown
  const skips = {};
  for (const m of allEval) {
    if (m.skip_reason) skips[m.skip_reason] = (skips[m.skip_reason]||0) + 1;
  }
  console.log('\nSKIP REASONS:');
  for (const [k,v] of Object.entries(skips).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`);
  }

  // Pull out 3 sample cases for Tyler's table
  const samples = allEval.filter(m => m.estimated_tax_savings).slice(0, 3);
  console.log('\nSAMPLE CASES (first 3 with reduction):\n');
  console.log('| Case | Assessed | Lowest Comp | Reduction | Tax Savings | Revenue |');
  console.log('|------|----------|-------------|-----------|-------------|---------|');
  for (const s of samples) {
    console.log(`| ${s.case_id} | $${s.assessed.toLocaleString()} | $${s.comp_low_anchor_value.toLocaleString()} | $${s.estimated_reduction_value.toLocaleString()} | $${s.estimated_tax_savings.toLocaleString()} | $${s.estimated_revenue.toLocaleString()} |`);
  }
  console.log('\n========================================================================\n');

  // Emit JSON for downstream use
  require('fs').writeFileSync('/tmp/metric-preview.json', JSON.stringify({ totals: { oldTotal, newSavTotal, newRevTotal, eligibleCount, withReductionCount }, top, samples, allEval }, null, 2));
  console.log('Full result written to /tmp/metric-preview.json\n');
})().catch(e => { console.error(e); process.exit(1); });
