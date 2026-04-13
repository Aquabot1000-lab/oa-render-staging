#!/usr/bin/env node
/**
 * Segmented run: 17 VERIFIED_MATCH cases only.
 * Engine v2.1.0 — CAD appraised value as authoritative.
 * Writes to verified_analysis ONLY.
 */
const { createClient } = require('@supabase/supabase-js');
const { getCountyData, initAllCounties } = require('../services/local-parcel-data');
const { findVerifiedComps } = require('../services/verified-comp-engine');
const tarrantData = require('../services/tarrant-data');

const SUPABASE_URL = 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const VERIFIED_MATCH_CASES = [
    'OA-0005','OA-0016','OA-0018','OA-0019','OA-0021','OA-0023','OA-0025','OA-0026',
    'OA-0032','OA-0033','OA-0034','OA-0041','OA-0046','OA-0048','OA-0049','OA-0054','OA-0056'
];

function getDataForCounty(county) {
    const hyphenated = county.replace(/\s+/g, '-');
    let d = getCountyData(hyphenated);
    if (d && d.isLoaded()) return d;
    d = getCountyData(county);
    if (d && d.isLoaded()) return d;
    return null;
}

async function main() {
    console.log('Loading data...');
    await initAllCounties();
    if (tarrantData.loadData) await tarrantData.loadData();
    console.log('Done.\n');

    // Load tax rates
    const { data: taxRatesRaw } = await supabase.from('tax_rates').select('state, county, rate');
    const taxRates = {};
    for (const tr of taxRatesRaw) taxRates[`${tr.state.toUpperCase()}|${tr.county.toLowerCase()}`] = parseFloat(tr.rate);

    const { data: cases } = await supabase
        .from('submissions')
        .select('*')
        .in('case_id', VERIFIED_MATCH_CASES)
        .is('deleted_at', null);

    const results = [];

    for (const c of cases.sort((a, b) => a.case_id.localeCompare(b.case_id))) {
        const cid = c.case_id;
        const county = (c.county || '').toLowerCase().trim();
        const state = (c.state || 'TX').toUpperCase().trim();
        const address = c.property_address || '';
        const dbAssessedRaw = String(c.assessed_value || '0').replace(/[$,]/g, '');
        const dbAssessed = parseInt(dbAssessedRaw) || 0;
        const taxRate = taxRates[`${state}|${county}`] || 0;
        const oldSavings = c.estimated_savings || 0;
        const oldRec = c.comp_results?.recommendedValue || null;
        const oldStatus = c.status || '';

        // Step 1: Look up CAD value
        let cadValue = 0, cadSqft = null, cadYear = null, cadType = null, cadNbhd = null;
        let subjectFound = false;

        // Try generic local data
        const localData = getDataForCounty(county);
        if (localData) {
            const matches = localData.searchByAddress(address);
            if (matches.length > 0) {
                subjectFound = true;
                const s = matches[0];
                cadValue = s.appraisedValue || s.totalValue || 0;
                cadSqft = s.sqft || null;
                cadYear = s.yearBuilt ? parseInt(s.yearBuilt) : null;
                cadType = s.propertyType || null;
                cadNbhd = s.neighborhoodCode || null;
            }
        }

        // Try tarrant-data
        if (!subjectFound && county === 'tarrant' && tarrantData.isLoaded()) {
            const streetOnly = address.replace(/,.*$/, '').replace(/\.[\s]*$/, '').trim();
            const matches = tarrantData.searchByAddress(streetOnly, 3);
            if (matches.length > 0) {
                subjectFound = true;
                const s = matches[0];
                cadValue = s.totalValue || s.appraisedValue || 0;
                cadSqft = s.sqft || null;
                cadYear = s.yearBuilt || null;
                cadType = s.propertyClassDesc || s.propertyClass || null;
                cadNbhd = null;
            }
        }

        if (!subjectFound || cadValue <= 0) {
            const result = {
                status: 'NEEDS_REVIEW',
                reason: !subjectFound ? `Subject not found in ${county} CAD` : `CAD value is $${cadValue}`,
                recommended_value: null, comp_median: null, comp_average: null,
                reduction: null, tax_rate_used: taxRate, estimated_savings: null,
                comps: [], comp_count: 0,
                cad_appraised_value: cadValue || null, db_intake_assessed: dbAssessed,
                data_source: 'none', engine_version: '2.1.0-cad-authoritative',
                analyzed_at: new Date().toISOString()
            };
            await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
            results.push({ cid, name: c.owner_name, county, oldStatus, oldRec, oldSavings,
                newStatus: 'NEEDS_REVIEW', newRec: null, newSavings: null, compCount: 0,
                cadValue, dbAssessed, reason: result.reason });
            console.log(`${cid} | ${c.owner_name} | NEEDS_REVIEW: ${result.reason}`);
            continue;
        }

        const assessedValue = cadValue;

        // Build subject with CAD data
        const subject = {
            address, assessedValue,
            sqft: cadSqft || c.sqft || null,
            yearBuilt: cadYear || c.year_built || null,
            propertyType: cadType || c.property_type || 'residential',
            neighborhoodCode: cadNbhd || null
        };
        const caseData = { county, state, property_address: address, assessed_value: assessedValue };

        try {
            const analysis = await findVerifiedComps(subject, caseData);

            if (!analysis || analysis.status === 'INSUFFICIENT_DATA' || !analysis.recommendedValue) {
                const result = {
                    status: 'INSUFFICIENT_DATA',
                    reason: analysis ? (analysis.reason || `Only ${(analysis.comps||[]).length} comps`) : 'Engine null',
                    recommended_value: null, comp_median: null, comp_average: null,
                    reduction: null, tax_rate_used: taxRate, estimated_savings: null,
                    comps: (analysis?.comps) || [], comp_count: (analysis?.comps?.length) || 0,
                    cad_appraised_value: assessedValue, db_intake_assessed: dbAssessed,
                    data_source: analysis?.dataSource || null,
                    engine_version: '2.1.0-cad-authoritative',
                    analyzed_at: new Date().toISOString()
                };
                await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
                results.push({ cid, name: c.owner_name, county, oldStatus, oldRec, oldSavings,
                    newStatus: 'INSUFFICIENT_DATA', newRec: null, newSavings: null, compCount: result.comp_count,
                    cadValue: assessedValue, dbAssessed, reason: result.reason });
                console.log(`${cid} | ${c.owner_name} | INSUFFICIENT_DATA (${result.comp_count} comps)`);
                continue;
            }

            // Median-only recommendation
            const compValues = analysis.comps.map(co => co.assessedValue).filter(v => v > 0).sort((a, b) => a - b);
            const medianValue = compValues.length > 0 ? compValues[Math.floor(compValues.length / 2)] : 0;
            const avgValue = compValues.length > 0 ? Math.round(compValues.reduce((a, b) => a + b, 0) / compValues.length) : 0;

            let recommendedValue = medianValue;
            let flags = [];

            if (recommendedValue >= assessedValue) {
                const result = {
                    status: 'NO_CASE', reason: `Rec $${recommendedValue.toLocaleString()} >= CAD $${assessedValue.toLocaleString()}`,
                    recommended_value: recommendedValue, comp_median: medianValue, comp_average: avgValue,
                    reduction: 0, tax_rate_used: taxRate, estimated_savings: 0,
                    comps: analysis.comps.map(co => ({ parcelId: co.parcelId, address: co.address, assessedValue: co.assessedValue, sqft: co.sqft, yearBuilt: co.yearBuilt, score: co.score, source: co.source, verified: true })),
                    comp_count: analysis.comps.length,
                    cad_appraised_value: assessedValue, db_intake_assessed: dbAssessed,
                    data_source: analysis.dataSource,
                    confidence: analysis.quality?.confidenceLevel || null,
                    variance_pct: analysis.quality?.variancePct || null,
                    engine_version: '2.1.0-cad-authoritative',
                    analyzed_at: new Date().toISOString(), flags
                };
                await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
                results.push({ cid, name: c.owner_name, county, oldStatus, oldRec, oldSavings,
                    newStatus: 'NO_CASE', newRec: recommendedValue, newSavings: 0, compCount: analysis.comps.length,
                    cadValue: assessedValue, dbAssessed, reason: result.reason });
                console.log(`${cid} | ${c.owner_name} | NO_CASE (rec $${recommendedValue.toLocaleString()} >= $${assessedValue.toLocaleString()})`);
                continue;
            }

            const reduction = assessedValue - recommendedValue;
            const reductionPct = (reduction / assessedValue * 100).toFixed(1);
            if (reduction > assessedValue * 0.25) flags.push(`extreme_reduction_${reductionPct}pct`);

            const savings = Math.round(reduction * taxRate);

            const result = {
                status: flags.length > 0 ? 'NEEDS_REVIEW' : 'VERIFIED',
                reason: flags.length > 0 ? `Flags: ${flags.join(', ')}` : null,
                recommended_value: recommendedValue, comp_median: medianValue, comp_average: avgValue,
                reduction, reduction_pct: parseFloat(reductionPct),
                tax_rate_used: taxRate, estimated_savings: savings,
                comps: analysis.comps.map(co => ({ parcelId: co.parcelId, address: co.address, assessedValue: co.assessedValue, sqft: co.sqft, yearBuilt: co.yearBuilt, score: co.score, source: co.source, verified: true })),
                comp_count: analysis.comps.length,
                cad_appraised_value: assessedValue, db_intake_assessed: dbAssessed,
                data_source: analysis.dataSource,
                confidence: analysis.quality?.confidenceLevel || null,
                variance_pct: analysis.quality?.variancePct || null,
                engine_version: '2.1.0-cad-authoritative',
                analyzed_at: new Date().toISOString(), flags
            };
            await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
            const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
            results.push({ cid, name: c.owner_name, county, oldStatus, oldRec, oldSavings,
                newStatus: result.status, newRec: recommendedValue, newSavings: savings, compCount: analysis.comps.length,
                cadValue: assessedValue, dbAssessed, reason: flagStr || null });
            console.log(`${cid} | ${c.owner_name} | ${result.status} | rec $${recommendedValue.toLocaleString()} | savings $${savings.toLocaleString()}/yr${flagStr}`);

        } catch (err) {
            const result = {
                status: 'ENGINE_ERROR', reason: err.message,
                recommended_value: null, comp_median: null, comp_average: null,
                reduction: null, tax_rate_used: taxRate, estimated_savings: null,
                comps: [], comp_count: 0,
                cad_appraised_value: cadValue, db_intake_assessed: dbAssessed,
                engine_version: '2.1.0-cad-authoritative',
                analyzed_at: new Date().toISOString()
            };
            await supabase.from('submissions').update({ verified_analysis: result }).eq('id', c.id);
            results.push({ cid, name: c.owner_name, county, oldStatus, oldRec, oldSavings,
                newStatus: 'ENGINE_ERROR', newRec: null, newSavings: null, compCount: 0,
                cadValue, dbAssessed, reason: err.message });
            console.error(`${cid} | ${c.owner_name} | ENGINE_ERROR: ${err.message}`);
        }
    }

    // Summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('DIFF REPORT');
    console.log('='.repeat(80));
    console.log(`${'Case'.padEnd(10)}${'Name'.padEnd(25)}${'County'.padEnd(10)}${'CAD Assessed'.padEnd(14)}${'Old Rec'.padEnd(14)}${'New Rec'.padEnd(14)}${'Old Savings'.padEnd(13)}${'New Savings'.padEnd(13)}${'Comps'.padEnd(6)}${'New Status'.padEnd(20)}Flags`);
    console.log('-'.repeat(150));

    for (const r of results) {
        const cadStr = r.cadValue ? `$${r.cadValue.toLocaleString()}` : '—';
        const oldRecStr = r.oldRec ? `$${r.oldRec.toLocaleString()}` : '—';
        const newRecStr = r.newRec ? `$${r.newRec.toLocaleString()}` : '—';
        const oldSavStr = r.oldSavings ? `$${r.oldSavings.toLocaleString()}` : '—';
        const newSavStr = r.newSavings != null ? `$${r.newSavings.toLocaleString()}` : '—';
        console.log(`${r.cid.padEnd(10)}${(r.name||'').substring(0,24).padEnd(25)}${r.county.padEnd(10)}${cadStr.padEnd(14)}${oldRecStr.padEnd(14)}${newRecStr.padEnd(14)}${oldSavStr.padEnd(13)}${newSavStr.padEnd(13)}${String(r.compCount).padEnd(6)}${r.newStatus.padEnd(20)}${r.reason||''}`);
    }

    // Counts
    const counts = {};
    for (const r of results) counts[r.newStatus] = (counts[r.newStatus] || 0) + 1;
    console.log(`\nCOUNTS:`);
    for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);
    console.log(`  TOTAL: ${results.length}`);

    // Failures
    const failures = results.filter(r => ['ENGINE_ERROR','NEEDS_REVIEW','INSUFFICIENT_DATA'].includes(r.newStatus));
    if (failures.length > 0) {
        console.log(`\nUNEXPECTED FAILURES (${failures.length}):`);
        for (const f of failures) console.log(`  ${f.cid} | ${f.newStatus} | ${f.reason}`);
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
