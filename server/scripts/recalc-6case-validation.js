#!/usr/bin/env node
/**
 * 6-case validation run.
 * Uses CAD appraised value as authoritative assessed value.
 * Writes to verified_analysis ONLY.
 */
const { createClient } = require('@supabase/supabase-js');
const { getCountyData, initAllCounties } = require('../services/local-parcel-data');
const { findVerifiedComps } = require('../services/verified-comp-engine');

const SUPABASE_URL = 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TARGET_CASES = ['OA-0013','OA-0015','OA-0016','OA-0022','OA-0026','OA-0027'];

async function main() {
    console.log('Loading local parcel data...');
    await initAllCounties();
    console.log('Done.\n');

    // Load tax rates
    const { data: taxRatesRaw } = await supabase.from('tax_rates').select('state, county, rate');
    const taxRates = {};
    for (const tr of taxRatesRaw) taxRates[`${tr.state.toUpperCase()}|${tr.county.toLowerCase()}`] = parseFloat(tr.rate);

    const { data: cases } = await supabase
        .from('submissions')
        .select('*')
        .in('case_id', TARGET_CASES)
        .is('deleted_at', null);

    for (const c of cases.sort((a, b) => a.case_id.localeCompare(b.case_id))) {
        const cid = c.case_id;
        const county = (c.county || '').toLowerCase().trim();
        const state = (c.state || 'TX').toUpperCase().trim();
        const address = c.property_address || '';
        const dbAssessedRaw = String(c.assessed_value || '0').replace(/[$,]/g, '');
        const dbAssessed = parseInt(dbAssessedRaw) || 0;
        const taxRate = taxRates[`${state}|${county}`] || 0;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`${cid} | ${c.owner_name} | ${county} | addr: ${address}`);
        console.log(`  DB assessed (intake): $${dbAssessed.toLocaleString()}`);

        // Step 1: Look up CAD appraised value
        let cadValue = 0;
        let cadSqft = null;
        let cadYear = null;
        let cadType = null;
        let cadNbhd = null;
        let subjectFound = false;
        let cadStatus = 'NOT_FOUND';

        const localData = getCountyData(county);
        if (localData && localData.isLoaded()) {
            const subjectResults = localData.searchByAddress(address);
            if (subjectResults.length > 0) {
                subjectFound = true;
                const s = subjectResults[0];
                cadValue = s.appraisedValue || s.totalValue || 0;
                cadSqft = s.sqft || null;
                cadYear = s.yearBuilt ? parseInt(s.yearBuilt) : null;
                cadType = s.propertyType || null;
                cadNbhd = s.neighborhoodCode || null;

                if (cadValue <= 0) {
                    cadStatus = 'ZERO_OR_INPROGRESS';
                } else {
                    cadStatus = 'FOUND';
                }
            }
        }

        console.log(`  CAD appraised: $${cadValue.toLocaleString()} | status: ${cadStatus}`);
        console.log(`  CAD sqft: ${cadSqft||'?'} | year: ${cadYear||'?'} | type: ${cadType||'?'} | nbhd: ${cadNbhd||'?'}`);

        // Rule 3: If CAD value is 0/null/InProgress → NEEDS_REVIEW
        if (cadStatus !== 'FOUND') {
            const result = {
                status: 'NEEDS_REVIEW',
                reason: subjectFound
                    ? `CAD appraised value is $${cadValue} (zero or InProgress) — cannot calculate`
                    : `Subject property not found in ${county} CAD data`,
                recommended_value: null,
                comp_median: null, comp_average: null,
                reduction: null, tax_rate_used: taxRate, estimated_savings: null,
                comps: [], comp_count: 0,
                cad_appraised_value: cadValue || null,
                db_intake_assessed: dbAssessed,
                data_source: localData && localData.isLoaded() ? 'local-cad-bulk' : 'none',
                engine_version: '2.1.0-cad-authoritative',
                analyzed_at: new Date().toISOString()
            };
            await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
            console.log(`  → NEEDS_REVIEW: ${result.reason}`);
            continue;
        }

        // Use CAD value as the authoritative assessed value
        const assessedValue = cadValue;
        console.log(`  Using CAD $${assessedValue.toLocaleString()} as authoritative assessed value`);

        // Build subject with CAD-enriched data
        const subject = {
            address,
            assessedValue: assessedValue,
            sqft: cadSqft || c.sqft || null,
            yearBuilt: cadYear || c.year_built || null,
            propertyType: cadType || c.property_type || 'residential',
            neighborhoodCode: cadNbhd || null
        };
        const caseData = {
            county, state,
            property_address: address,
            assessed_value: assessedValue  // CAD value, not DB intake
        };

        try {
            const analysis = await findVerifiedComps(subject, caseData);

            if (!analysis || analysis.status === 'INSUFFICIENT_DATA' || !analysis.recommendedValue) {
                const result = {
                    status: 'INSUFFICIENT_DATA',
                    reason: analysis ? (analysis.reason || `Only ${(analysis.comps||[]).length} verified comps`) : 'Engine returned null',
                    recommended_value: null, comp_median: null, comp_average: null,
                    reduction: null, tax_rate_used: taxRate, estimated_savings: null,
                    comps: (analysis && analysis.comps) || [], comp_count: (analysis && analysis.comps) ? analysis.comps.length : 0,
                    cad_appraised_value: assessedValue,
                    db_intake_assessed: dbAssessed,
                    data_source: analysis ? analysis.dataSource : null,
                    engine_version: '2.1.0-cad-authoritative',
                    analyzed_at: new Date().toISOString()
                };
                await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
                console.log(`  → INSUFFICIENT_DATA (${result.comp_count} comps): ${result.reason}`);
                continue;
            }

            // Recalculate using OUR rules: median only, no floor cap
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

            let recommendedValue = medianValue;
            let flags = [];

            // If recommended >= assessed → No Case
            if (recommendedValue >= assessedValue) {
                const result = {
                    status: 'NO_CASE',
                    reason: `Recommended $${recommendedValue.toLocaleString()} >= CAD assessed $${assessedValue.toLocaleString()}`,
                    recommended_value: recommendedValue,
                    comp_median: medianValue, comp_average: avgValue,
                    reduction: 0, tax_rate_used: taxRate, estimated_savings: 0,
                    comps: analysis.comps.map(co => ({
                        parcelId: co.parcelId, address: co.address,
                        assessedValue: co.assessedValue, sqft: co.sqft,
                        yearBuilt: co.yearBuilt, score: co.score,
                        source: co.source, verified: true
                    })),
                    comp_count: analysis.comps.length,
                    cad_appraised_value: assessedValue,
                    db_intake_assessed: dbAssessed,
                    data_source: analysis.dataSource,
                    confidence: analysis.quality ? analysis.quality.confidenceLevel : null,
                    variance_pct: analysis.quality ? analysis.quality.variancePct : null,
                    engine_version: '2.1.0-cad-authoritative',
                    analyzed_at: new Date().toISOString(), flags
                };
                await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
                console.log(`  → NO_CASE: rec $${recommendedValue.toLocaleString()} >= assessed $${assessedValue.toLocaleString()}`);
                continue;
            }

            // Check extreme reduction
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
                comp_median: medianValue, comp_average: avgValue,
                reduction, reduction_pct: parseFloat(reductionPct),
                tax_rate_used: taxRate, estimated_savings: savings,
                comps: analysis.comps.map(co => ({
                    parcelId: co.parcelId, address: co.address,
                    assessedValue: co.assessedValue, sqft: co.sqft,
                    yearBuilt: co.yearBuilt, score: co.score,
                    source: co.source, verified: true
                })),
                comp_count: analysis.comps.length,
                cad_appraised_value: assessedValue,
                db_intake_assessed: dbAssessed,
                data_source: analysis.dataSource,
                confidence: analysis.quality ? analysis.quality.confidenceLevel : null,
                variance_pct: analysis.quality ? analysis.quality.variancePct : null,
                engine_version: '2.1.0-cad-authoritative',
                analyzed_at: new Date().toISOString(), flags
            };
            await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
            const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
            console.log(`  → ${result.status} | rec $${recommendedValue.toLocaleString()} | savings $${savings.toLocaleString()}/yr | ${analysis.comps.length} comps${flagStr}`);

        } catch (err) {
            const result = {
                status: 'ENGINE_ERROR', reason: err.message,
                recommended_value: null, comp_median: null, comp_average: null,
                reduction: null, tax_rate_used: taxRate, estimated_savings: null,
                comps: [], comp_count: 0,
                cad_appraised_value: assessedValue,
                db_intake_assessed: dbAssessed,
                engine_version: '2.1.0-cad-authoritative',
                analyzed_at: new Date().toISOString()
            };
            await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
            console.error(`  → ENGINE_ERROR: ${err.message}`);
        }
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
