#!/usr/bin/env node
/**
 * Unified recalculation — writes to verified_analysis ONLY.
 * Does NOT touch comp_results, estimated_savings, or status.
 * 
 * Uses verified-comp-engine (no RentCast, no synthetic).
 * Tax rates from tax_rates table.
 * recommended_value = median of verified comps.
 * 
 * @version 2.0.0-unified — 2026-04-10
 */

const { createClient } = require('@supabase/supabase-js');
const { findVerifiedComps } = require('../services/verified-comp-engine');
const { initAllCounties } = require('../services/local-parcel-data');

const SUPABASE_URL = 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Counties with data sources
const LOCAL_COUNTIES = new Set(['bexar', 'harris', 'tarrant', 'dallas', 'collin', 'fort bend', 'fulton', 'king', 'pierce', 'williamson', 'snohomish']);
const BIS_COUNTIES = new Set(['kaufman', 'collin', 'fort bend', 'travis', 'williamson', 'hunt', 'denton']);
const BLOCKED_COUNTIES = new Set(['travis']); // corrupted bulk data

async function main() {
    console.log('=== UNIFIED RECALCULATION (verified_analysis only) ===');
    console.log(`Started: ${new Date().toISOString()}\n`);

    // Load tax rates from DB
    const { data: taxRatesRaw, error: trErr } = await supabase
        .from('tax_rates')
        .select('state, county, rate');
    if (trErr) { console.error('Failed to load tax_rates:', trErr.message); process.exit(1); }
    
    const taxRates = {};
    for (const tr of taxRatesRaw) {
        taxRates[`${tr.state.toUpperCase()}|${tr.county.toLowerCase()}`] = parseFloat(tr.rate);
    }
    console.log(`Loaded ${Object.keys(taxRates).length} tax rates\n`);

    // Load local parcel data
    console.log('Loading local parcel data...');
    await initAllCounties();
    console.log('Local data loaded.\n');

    // Fetch target cases
    const { data: cases, error } = await supabase
        .from('submissions')
        .select('*')
        .is('deleted_at', null)
        .order('case_id', { ascending: true });
    if (error) { console.error('Failed to fetch:', error.message); process.exit(1); }

    // Filter to OA cases with status in Hold, Ready to File, or Blocked with signed agreement
    const targets = cases.filter(c => {
        const cid = c.case_id || '';
        if (!cid.startsWith('OA-')) return false;
        const status = c.status || '';
        if (['Deleted', 'No Case', 'Needs Data'].includes(status)) return false;
        // Include Hold, Ready to File, Blocked (signed only), Analysis Complete
        return ['Hold - Data Integrity Review', 'Ready to File', 'Blocked - Bad Data', 'Analysis Complete'].includes(status)
            || c.fee_agreement_signed;
    });

    console.log(`Target cases: ${targets.length}\n`);

    const results = [];

    for (const c of targets) {
        const cid = c.case_id;
        const county = (c.county || '').toLowerCase().trim();
        const state = (c.state || 'TX').toUpperCase().trim();
        const address = c.property_address || '';
        const assessedRaw = String(c.assessed_value || '0').replace(/[$,]/g, '');
        const assessedValue = parseInt(assessedRaw) || 0;

        const taxRateKey = `${state}|${county}`;
        const taxRate = taxRates[taxRateKey];

        // Check data availability
        const hasLocal = LOCAL_COUNTIES.has(county);
        const hasBIS = BIS_COUNTIES.has(county);
        const isBlocked = BLOCKED_COUNTIES.has(county);

        if (!county || (!hasLocal && !hasBIS)) {
            const result = {
                status: 'NO_DATA_SOURCE',
                reason: county ? `No data source for ${county} county` : 'No county specified',
                recommended_value: null,
                comp_median: null,
                comp_average: null,
                reduction: null,
                tax_rate_used: taxRate || null,
                estimated_savings: null,
                comps: [],
                comp_count: 0,
                data_source: null,
                confidence: null,
                variance_pct: null,
                engine_version: '2.0.0-unified',
                analyzed_at: new Date().toISOString()
            };
            await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
            results.push({ case_id: cid, name: c.owner_name, county, ...result });
            console.log(`  ${cid} | ${c.owner_name} | NO DATA SOURCE (${county || 'missing'})`);
            continue;
        }

        if (!taxRate) {
            const result = {
                status: 'NO_TAX_RATE',
                reason: `No tax rate for ${state}|${county}`,
                recommended_value: null, comp_median: null, comp_average: null,
                reduction: null, tax_rate_used: null, estimated_savings: null,
                comps: [], comp_count: 0, data_source: null, confidence: null,
                variance_pct: null, engine_version: '2.0.0-unified',
                analyzed_at: new Date().toISOString()
            };
            await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
            results.push({ case_id: cid, name: c.owner_name, county, ...result });
            console.log(`  ${cid} | ${c.owner_name} | NO TAX RATE (${taxRateKey})`);
            continue;
        }

        if (!address || address.length < 5) {
            const result = {
                status: 'BAD_ADDRESS',
                reason: `Invalid address: "${address}"`,
                recommended_value: null, comp_median: null, comp_average: null,
                reduction: null, tax_rate_used: taxRate, estimated_savings: null,
                comps: [], comp_count: 0, data_source: null, confidence: null,
                variance_pct: null, engine_version: '2.0.0-unified',
                analyzed_at: new Date().toISOString()
            };
            await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
            results.push({ case_id: cid, name: c.owner_name, county, ...result });
            console.log(`  ${cid} | ${c.owner_name} | BAD ADDRESS`);
            continue;
        }

        if (assessedValue <= 0) {
            const result = {
                status: 'NO_ASSESSED_VALUE',
                reason: `Assessed value is 0 or missing`,
                recommended_value: null, comp_median: null, comp_average: null,
                reduction: null, tax_rate_used: taxRate, estimated_savings: null,
                comps: [], comp_count: 0, data_source: null, confidence: null,
                variance_pct: null, engine_version: '2.0.0-unified',
                analyzed_at: new Date().toISOString()
            };
            await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
            results.push({ case_id: cid, name: c.owner_name, county, ...result });
            console.log(`  ${cid} | ${c.owner_name} | NO ASSESSED VALUE`);
            continue;
        }

        // Run verified comp engine
        try {
            const subject = {
                address,
                assessedValue,
                sqft: c.sqft || null,
                yearBuilt: c.year_built || null,
                bedrooms: c.bedrooms || null,
                bathrooms: c.bathrooms || null,
                propertyType: c.property_type || 'residential'
            };
            const caseData = {
                county,
                state,
                property_address: address,
                assessed_value: c.assessed_value
            };
            const analysis = await findVerifiedComps(subject, caseData);

            if (!analysis || analysis.status === 'INSUFFICIENT_DATA' || !analysis.recommendedValue) {
                const result = {
                    status: 'INSUFFICIENT_DATA',
                    reason: analysis ? (analysis.reason || `Only ${(analysis.comps||[]).length} verified comps found`) : 'Engine returned null',
                    recommended_value: null, comp_median: null, comp_average: null,
                    reduction: null, tax_rate_used: taxRate, estimated_savings: null,
                    comps: (analysis && analysis.comps) || [],
                    comp_count: (analysis && analysis.comps) ? analysis.comps.length : 0,
                    data_source: analysis ? analysis.dataSource : null,
                    confidence: null, variance_pct: null,
                    engine_version: '2.0.0-unified',
                    analyzed_at: new Date().toISOString()
                };
                await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
                results.push({ case_id: cid, name: c.owner_name, county, ...result });
                console.log(`  ${cid} | ${c.owner_name} | INSUFFICIENT DATA (${result.comp_count} comps)`);
                continue;
            }

            // Use the engine's median-based recommendedValue
            // But override with OUR rules: median only, no floor cap
            const compValues = analysis.comps
                .map(comp => comp.assessedValue)
                .filter(v => v > 0)
                .sort((a, b) => a - b);
            
            const medianValue = compValues.length > 0 
                ? compValues[Math.floor(compValues.length / 2)] 
                : 0;
            const avgValue = compValues.length > 0
                ? Math.round(compValues.reduce((a, b) => a + b, 0) / compValues.length)
                : 0;
            
            // RULE: recommended = median ONLY
            let recommendedValue = medianValue;
            let flags = [];

            // If recommended >= assessed → No Case
            if (recommendedValue >= assessedValue) {
                const result = {
                    status: 'NO_CASE',
                    reason: `Recommended ${recommendedValue} >= assessed ${assessedValue}`,
                    recommended_value: recommendedValue,
                    comp_median: medianValue,
                    comp_average: avgValue,
                    reduction: 0,
                    tax_rate_used: taxRate,
                    estimated_savings: 0,
                    comps: analysis.comps.map(c => ({
                        parcelId: c.parcelId, address: c.address,
                        assessedValue: c.assessedValue, sqft: c.sqft,
                        yearBuilt: c.yearBuilt, score: c.score,
                        source: c.source, verified: true
                    })),
                    comp_count: analysis.comps.length,
                    data_source: analysis.dataSource,
                    confidence: analysis.quality ? analysis.quality.confidenceLevel : null,
                    variance_pct: analysis.quality ? analysis.quality.variancePct : null,
                    engine_version: '2.0.0-unified',
                    analyzed_at: new Date().toISOString(),
                    flags
                };
                await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
                results.push({ case_id: cid, name: c.owner_name, county, ...result });
                console.log(`  ${cid} | ${c.owner_name} | NO CASE (rec $${recommendedValue.toLocaleString()} >= assessed $${assessedValue.toLocaleString()})`);
                continue;
            }

            // Check for extreme reduction (>25%)
            const reduction = assessedValue - recommendedValue;
            const reductionPct = (reduction / assessedValue * 100).toFixed(1);
            if (reduction > assessedValue * 0.25) {
                flags.push(`extreme_reduction_${reductionPct}pct`);
            }

            const savings = Math.round(reduction * taxRate);

            const result = {
                status: flags.length > 0 ? 'NEEDS_REVIEW' : 'VERIFIED',
                reason: flags.length > 0 ? `Flags: ${flags.join(', ')}` : null,
                recommended_value: recommendedValue,
                comp_median: medianValue,
                comp_average: avgValue,
                reduction,
                reduction_pct: parseFloat(reductionPct),
                tax_rate_used: taxRate,
                estimated_savings: savings,
                comps: analysis.comps.map(c => ({
                    parcelId: c.parcelId, address: c.address,
                    assessedValue: c.assessedValue, sqft: c.sqft,
                    yearBuilt: c.yearBuilt, score: c.score,
                    source: c.source, verified: true
                })),
                comp_count: analysis.comps.length,
                data_source: analysis.dataSource,
                confidence: analysis.quality ? analysis.quality.confidenceLevel : null,
                variance_pct: analysis.quality ? analysis.quality.variancePct : null,
                engine_version: '2.0.0-unified',
                analyzed_at: new Date().toISOString(),
                flags
            };
            await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
            results.push({ case_id: cid, name: c.owner_name, county, ...result });
            const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
            console.log(`  ${cid} | ${c.owner_name} | ${result.status} | rec $${recommendedValue.toLocaleString()} | savings $${savings.toLocaleString()}/yr${flagStr}`);

        } catch (err) {
            const result = {
                status: 'ENGINE_ERROR',
                reason: err.message,
                recommended_value: null, comp_median: null, comp_average: null,
                reduction: null, tax_rate_used: taxRate, estimated_savings: null,
                comps: [], comp_count: 0, data_source: null, confidence: null,
                variance_pct: null, engine_version: '2.0.0-unified',
                analyzed_at: new Date().toISOString()
            };
            await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
            results.push({ case_id: cid, name: c.owner_name, county, ...result });
            console.error(`  ${cid} | ${c.owner_name} | ERROR: ${err.message}`);
        }
    }

    // Summary
    const counts = {};
    for (const r of results) {
        counts[r.status] = (counts[r.status] || 0) + 1;
    }
    console.log(`\n=== SUMMARY ===`);
    console.log(`Total processed: ${results.length}`);
    for (const [k, v] of Object.entries(counts).sort()) {
        console.log(`  ${k}: ${v}`);
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
