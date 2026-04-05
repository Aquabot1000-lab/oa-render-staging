/**
 * ANALYSIS WORKER — Real comp engine + QA + classification
 * 
 * Job types:
 *   - run_comps: fetch comps for a lead
 *   - run_qa: run QA checks on existing comps
 *   - classify_lead: determine stage from comp/qa results
 *   - analyze_lead: all three in sequence (comps → qa → classify)
 */

const axios = require('axios');

const RENTCAST_KEY = process.env.RENTCAST_API_KEY || '3a0f6f09999b41cc9ef23aa9d5fbab57';
const RENTCAST_BASE = 'https://api.rentcast.io/v1';

const TAX_RATES = {
    'bexar': 0.0225, 'kaufman': 0.025, 'tarrant': 0.023, 'collin': 0.022,
    'dallas': 0.023, 'harris': 0.023, 'travis': 0.021, 'williamson': 0.021,
    'fulton': 0.012, 'dekalb': 0.013, 'king': 0.010, 'pierce': 0.012,
    'snohomish': 0.010, 'kitsap': 0.0102, 'fort bend': 0.023, 'hunt': 0.025,
    'comal': 0.022, 'hays': 0.022, 'denton': 0.022, 'el paso': 0.025,
    'maricopa': 0.007, 'denver': 0.006, 'adams': 0.008, 'arapahoe': 0.006,
};

function getTaxRate(county, state) {
    const key = (county || '').toLowerCase().replace(' county', '').trim();
    if (TAX_RATES[key]) return TAX_RATES[key];
    // State defaults
    const stateDefaults = { 'TX': 0.022, 'WA': 0.010, 'GA': 0.012, 'AZ': 0.007, 'CO': 0.006 };
    return stateDefaults[(state || '').toUpperCase()] || 0.02;
}

// ── FETCH COMPS ──────────────────────────────────────────

async function fetchComps(address, state) {
    const fullAddr = `${address}${state ? ', ' + state : ''}`;
    const { data } = await axios.get(`${RENTCAST_BASE}/avm/value`, {
        params: { address: fullAddr },
        headers: { 'X-Api-Key': RENTCAST_KEY, 'Accept': 'application/json' },
        timeout: 15000
    });

    const comps = [];
    for (const c of (data.comparables || [])) {
        const saleDate = (c.removedDate || c.lastSaleDate || c.listedDate || '').substring(0, 10);
        if (!saleDate || !c.price) continue;  // Skip comps without dates or prices

        comps.push({
            address: c.formattedAddress || c.addressLine1,
            sale_price: c.price || c.lastSalePrice,
            sale_date: saleDate,
            sqft: c.squareFootage,
            bedrooms: c.bedrooms,
            bathrooms: c.bathrooms,
            year_built: c.yearBuilt,
            distance_miles: c.distance ? parseFloat(c.distance.toFixed(2)) : null,
            correlation: c.correlation || 0,
            days_on_market: c.daysOnMarket,
            listing_type: c.listingType,
            source: 'rentcast-api'
        });
    }

    // Sort by correlation, take top 5
    comps.sort((a, b) => (b.correlation || 0) - (a.correlation || 0));

    return {
        comps: comps.slice(0, 5),
        avm: data.price || null,
        avm_low: data.priceRangeLow || null,
        avm_high: data.priceRangeHigh || null,
        subject: data.subjectProperty || {}
    };
}

// ── QA CHECK ─────────────────────────────────────────────

function runQA(comps, assessed, subjectSqft) {
    const errors = [];
    const warnings = [];

    if (!comps || comps.length === 0) {
        errors.push('No comps found');
        return { passed: false, errors, warnings };
    }

    const realComps = comps.filter(c => c.source !== 'synthetic');
    if (realComps.length < 3) errors.push(`Only ${realComps.length} real comps — minimum 3 required`);

    const withDates = realComps.filter(c => c.sale_date);
    if (withDates.length < 3) errors.push(`Only ${withDates.length} comps with sale dates — minimum 3 required`);

    const withPrices = realComps.filter(c => c.sale_price > 0);
    if (withPrices.length < 3) errors.push(`Only ${withPrices.length} comps with sale prices — minimum 3 required`);

    // Check sqft similarity
    if (subjectSqft) {
        for (let i = 0; i < comps.length; i++) {
            if (comps[i].sqft) {
                const ratio = comps[i].sqft / subjectSqft;
                if (ratio < 0.5 || ratio > 2.0) {
                    warnings.push(`Comp ${i + 1}: sqft ${comps[i].sqft} vs subject ${subjectSqft} (${Math.round(ratio * 100)}%)`);
                }
            }
        }
    }

    // Check price spread
    const prices = comps.filter(c => c.sale_price).map(c => c.sale_price);
    if (prices.length >= 2) {
        const spread = (Math.max(...prices) - Math.min(...prices)) / Math.min(...prices);
        if (spread > 0.5) warnings.push(`Price spread ${Math.round(spread * 100)}% — wide range may weaken case`);
    }

    return { passed: errors.length === 0, errors, warnings };
}

// ── CLASSIFY ─────────────────────────────────────────────

function classify(comps, savings, qaPassed) {
    if (qaPassed && comps.length >= 3 && savings > 0) return 'Pending Approval';
    if (qaPassed && savings <= 0) return 'No Case';
    if (comps.length < 3) return 'Needs Analysis';
    return 'Needs Analysis';
}

// ── JOB HANDLERS ─────────────────────────────────────────

async function runComps(payload, supabase) {
    const { lead_id } = payload;
    if (!lead_id) throw new Error('lead_id required');

    // Get lead data
    const { data: lead, error } = await supabase
        .from('submissions')
        .select('id, case_id, owner_name, property_address, county, state, assessed_value, sqft')
        .eq('id', lead_id)
        .single();

    if (error || !lead) throw new Error(`Lead not found: ${lead_id}`);

    const address = lead.property_address;
    if (!address) throw new Error(`No address for lead ${lead.case_id}`);

    console.log(`[COMPS] ${lead.case_id} — ${lead.owner_name} — ${address}`);

    const result = await fetchComps(address, lead.state);
    const comps = result.comps;
    const prices = comps.filter(c => c.sale_price).map(c => c.sale_price);
    const proposed = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    const assessed = parseFloat(String(lead.assessed_value || '0').replace(/[,$]/g, ''));
    const taxRate = getTaxRate(lead.county, lead.state);
    const savingsVal = Math.max(0, assessed - proposed);
    const annualSavings = Math.round(savingsVal * taxRate);

    // Save to DB
    await supabase.from('submissions').update({
        comp_results: {
            comps,
            avm: result.avm,
            avm_low: result.avm_low,
            avm_high: result.avm_high,
            confidence: comps.length >= 3 ? 'high' : 'insufficient_data',
            fetched_at: new Date().toISOString(),
            data_sources: [{ source: 'rentcast-api', comps_found: comps.length }]
        },
        estimated_savings: annualSavings,
        updated_at: new Date().toISOString()
    }).eq('id', lead_id);

    console.log(`[COMPS] ${lead.case_id} — ${comps.length} comps, $${annualSavings}/yr savings`);

    return { case_id: lead.case_id, comps_count: comps.length, savings: annualSavings, proposed, assessed };
}

async function runQAJob(payload, supabase) {
    const { lead_id } = payload;
    if (!lead_id) throw new Error('lead_id required');

    const { data: lead } = await supabase
        .from('submissions')
        .select('id, case_id, comp_results, assessed_value, sqft')
        .eq('id', lead_id)
        .single();

    if (!lead) throw new Error(`Lead not found: ${lead_id}`);

    const comps = lead.comp_results?.comps || [];
    const assessed = parseFloat(String(lead.assessed_value || '0').replace(/[,$]/g, ''));
    const qa = runQA(comps, assessed, lead.sqft);

    await supabase.from('submissions').update({
        qa_status: qa.passed ? 'passed' : 'failed',
        qa_result: qa,
        qa_run_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }).eq('id', lead_id);

    console.log(`[QA] ${lead.case_id} — ${qa.passed ? 'PASSED' : 'FAILED'} (${qa.errors.length} errors)`);

    return { case_id: lead.case_id, qa_passed: qa.passed, errors: qa.errors, warnings: qa.warnings };
}

async function classifyLead(payload, supabase) {
    const { lead_id } = payload;
    if (!lead_id) throw new Error('lead_id required');

    const { data: lead } = await supabase
        .from('submissions')
        .select('id, case_id, comp_results, estimated_savings, qa_status, qa_result')
        .eq('id', lead_id)
        .single();

    if (!lead) throw new Error(`Lead not found: ${lead_id}`);

    const comps = lead.comp_results?.comps || [];
    const savings = lead.estimated_savings || 0;
    const qaPassed = lead.qa_status === 'passed';
    const stage = classify(comps, savings, qaPassed);

    await supabase.from('submissions').update({
        status: stage,
        updated_at: new Date().toISOString()
    }).eq('id', lead_id);

    console.log(`[CLASSIFY] ${lead.case_id} → ${stage} ($${savings}/yr, ${comps.length} comps, QA=${qaPassed})`);

    return { case_id: lead.case_id, stage, savings, comps: comps.length, qa: qaPassed };
}

async function analyzeLead(payload, supabase) {
    // Combined: comps → qa → classify
    const compsResult = await runComps(payload, supabase);
    const qaResult = await runQAJob(payload, supabase);
    const classifyResult = await classifyLead(payload, supabase);

    return {
        case_id: compsResult.case_id,
        comps: compsResult.comps_count,
        savings: compsResult.savings,
        qa_passed: qaResult.qa_passed,
        stage: classifyResult.stage
    };
}

module.exports = {
    runComps,
    runQA: runQAJob,
    classifyLead,
    analyzeLead
};
