#!/usr/bin/env node
/**
 * Re-run verified analysis on all verifiable OA cases.
 * 
 * - Uses verified-comp-engine (NO synthetic data)
 * - Stores results in verified_analysis field (separate from old invalid data)
 * - Does NOT send anything to customers
 * - Does NOT overwrite evidence exports
 * 
 * @version 1.0.0 — 2026-04-07
 */

const { createClient } = require('@supabase/supabase-js');
const { findVerifiedComps } = require('../services/verified-comp-engine');
const { initAllCounties } = require('../services/local-parcel-data');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Counties with local bulk data
const LOCAL_COUNTIES = new Set(['bexar', 'harris', 'tarrant', 'dallas', 'collin', 'fort-bend', 'fort bend', 'fulton', 'king', 'pierce', 'williamson', 'snohomish']);
// Counties with BIS live search
const BIS_COUNTIES = new Set(['kaufman', 'collin', 'fort bend', 'travis', 'williamson', 'hunt', 'denton']);

async function main() {
    console.log('=== OA VERIFIED RE-ANALYSIS ===');
    console.log(`Started: ${new Date().toISOString()}\n`);

    // Step 1: Load local parcel data
    console.log('Loading local parcel data...');
    await initAllCounties();
    console.log('Local data loaded.\n');

    // Step 2: Fetch all OA cases
    const { data: cases, error } = await supabase
        .from('submissions')
        .select('*')
        .order('case_id', { ascending: true })
        .limit(200);

    if (error) {
        console.error('Failed to fetch cases:', error.message);
        process.exit(1);
    }

    const oaCases = cases.filter(c => (c.case_id || '').startsWith('OA-'));
    console.log(`Total OA cases: ${oaCases.length}\n`);

    // Step 3: Determine which cases are verifiable
    const results = [];
    const outputDir = path.join(__dirname, '..', '..', 'evidence-export', 'verified-rerun');
    fs.mkdirSync(outputDir, { recursive: true });

    for (const c of oaCases) {
        const cid = c.case_id;
        const county = (c.county || '').toLowerCase().trim();
        const countyNorm = county.replace(/\s+/g, '-');
        const address = c.property_address || '';
        const assessedValue = parseInt(String(c.assessed_value || '0').replace(/[$,]/g, '')) || 0;
        const status = c.status || '';
        const name = c.owner_name || '';

        // Skip deleted/blocked
        if (['Deleted', 'Blocked - Bad Data'].includes(status)) {
            results.push({
                case_id: cid, name, county, status: 'SKIPPED',
                reason: `Current status: ${status}`, savings: null
            });
            continue;
        }

        // Check if verifiable
        const hasLocal = LOCAL_COUNTIES.has(county) || LOCAL_COUNTIES.has(countyNorm);
        const hasBIS = BIS_COUNTIES.has(county);

        if (!hasLocal && !hasBIS) {
            results.push({
                case_id: cid, name, county: county || 'MISSING',
                status: county ? 'MISSING_COUNTY_DATA' : 'NO_COUNTY',
                reason: county
                    ? `No data source for ${county} county`
                    : 'No county specified',
                savings: null
            });
            continue;
        }

        if (!address) {
            results.push({
                case_id: cid, name, county,
                status: 'NEEDS_SOURCE_DATA',
                reason: 'No property address',
                savings: null
            });
            continue;
        }

        if (assessedValue <= 0) {
            results.push({
                case_id: cid, name, county,
                status: 'NEEDS_NOTICE',
                reason: 'No assessed value — need Notice of Appraised Value',
                savings: null
            });
            continue;
        }

        // Run verified analysis
        console.log(`\n--- ${cid} | ${name} | ${county} | ${address} ---`);
        try {
            const subject = {
                address,
                assessedValue,
                sqft: c.sqft ? parseInt(c.sqft) : null,
                yearBuilt: c.year_built ? parseInt(c.year_built) : null,
            };

            const analysis = await findVerifiedComps(subject, c);

            // Get old claimed savings for comparison
            const oldAnalysis = c.analysis_report;
            const oldSavings = oldAnalysis?.estimatedTaxSavings || c.estimated_savings || null;
            const oldComps = (c.comp_results?.comps || []).length;

            const entry = {
                case_id: cid,
                name,
                county,
                address,
                assessed_value: assessedValue,
                status: analysis.status,
                data_source: analysis.dataSource,
                subject_verified: analysis.subjectVerified,
                subject_parcel_id: analysis.subjectParcelId,
                new_savings: analysis.estimatedSavings,
                new_reduction: analysis.reduction,
                new_recommended: analysis.recommendedValue,
                new_comps_count: analysis.comps?.length || 0,
                total_comps_found: analysis.totalCompsFound,
                lower_valued_comps: analysis.totalLowerComps,
                old_savings: oldSavings,
                old_comps_count: oldComps,
                savings_change: (analysis.estimatedSavings != null && oldSavings != null)
                    ? analysis.estimatedSavings - oldSavings
                    : null,
                reason: analysis.reason || null,
                methodology: analysis.methodology || null
            };

            results.push(entry);

            // Save individual case result
            if (analysis.status === 'VERIFIED') {
                fs.writeFileSync(
                    path.join(outputDir, `${cid}_verified.json`),
                    JSON.stringify(analysis, null, 2)
                );
                console.log(`  ✅ VERIFIED: ${analysis.comps.length} comps, savings $${analysis.estimatedSavings}/yr`);
            } else {
                fs.writeFileSync(
                    path.join(outputDir, `${cid}_insufficient.json`),
                    JSON.stringify(analysis, null, 2)
                );
                console.log(`  ❌ ${analysis.status}: ${analysis.reason}`);
            }

            // Store verified analysis in Supabase (separate field)
            await supabase.from('submissions').update({
                data_validation_status: analysis.status === 'VERIFIED' ? 'verified' : 'insufficient_data',
                comp_validation_status: analysis.status === 'VERIFIED'
                    ? `${analysis.comps.length} verified comps, ${analysis.totalLowerComps} lower`
                    : analysis.reason,
                data_sources: JSON.stringify({
                    engine: 'verified-comp-engine-1.0.0',
                    source: analysis.dataSource,
                    subjectParcelId: analysis.subjectParcelId,
                    subjectVerified: analysis.subjectVerified,
                    analyzedAt: analysis.analyzedAt,
                    compsCount: analysis.comps?.length || 0,
                    totalFound: analysis.totalCompsFound,
                    recommendedValue: analysis.recommendedValue,
                    estimatedSavings: analysis.estimatedSavings
                })
            }).eq('case_id', cid);

            // Brief delay between BIS queries to avoid rate limiting
            if (hasBIS && !hasLocal) {
                await new Promise(r => setTimeout(r, 1000));
            }

        } catch (err) {
            console.error(`  💥 ERROR: ${err.message}`);
            results.push({
                case_id: cid, name, county,
                status: 'ERROR',
                reason: err.message,
                savings: null
            });
        }
    }

    // Save full results
    const summary = {
        generated_at: new Date().toISOString(),
        total_cases: oaCases.length,
        results
    };

    fs.writeFileSync(
        path.join(outputDir, 'RERUN_SUMMARY.json'),
        JSON.stringify(summary, null, 2)
    );

    // Print summary
    console.log('\n\n========================================');
    console.log('=== RE-ANALYSIS SUMMARY ===');
    console.log('========================================\n');

    const verified = results.filter(r => r.status === 'VERIFIED');
    const insufficient = results.filter(r => r.status === 'INSUFFICIENT_DATA');
    const missingCounty = results.filter(r => ['MISSING_COUNTY_DATA', 'NO_COUNTY'].includes(r.status));
    const needsData = results.filter(r => ['NEEDS_NOTICE', 'NEEDS_SOURCE_DATA'].includes(r.status));
    const skipped = results.filter(r => r.status === 'SKIPPED');
    const errors = results.filter(r => r.status === 'ERROR');

    console.log(`VERIFIED:           ${verified.length}`);
    console.log(`INSUFFICIENT DATA:  ${insufficient.length}`);
    console.log(`MISSING COUNTY:     ${missingCounty.length}`);
    console.log(`NEEDS DATA:         ${needsData.length}`);
    console.log(`SKIPPED:            ${skipped.length}`);
    console.log(`ERRORS:             ${errors.length}`);

    // Verified cases with savings
    console.log('\n--- VERIFIED CASES ---');
    for (const r of verified) {
        const delta = r.savings_change != null ? ` (was $${r.old_savings}, Δ ${r.savings_change >= 0 ? '+' : ''}$${r.savings_change})` : '';
        console.log(`${r.case_id} | ${r.name.substring(0, 25).padEnd(25)} | ${r.county.padEnd(12)} | ` +
            `Comps: ${r.new_comps_count}/${r.total_comps_found} | ` +
            `Savings: $${r.new_savings}/yr${delta} | ` +
            `PID: ${r.subject_parcel_id}`);
    }

    // Insufficient data
    if (insufficient.length > 0) {
        console.log('\n--- INSUFFICIENT DATA ---');
        for (const r of insufficient) {
            console.log(`${r.case_id} | ${r.name.substring(0, 25).padEnd(25)} | ${r.county.padEnd(12)} | ${r.reason}`);
        }
    }

    // Missing county
    if (missingCounty.length > 0) {
        console.log('\n--- MISSING COUNTY DATA ---');
        for (const r of missingCounty) {
            console.log(`${r.case_id} | ${r.name.substring(0, 25).padEnd(25)} | ${r.county.padEnd(12)} | ${r.reason}`);
        }
    }

    // Needs data
    if (needsData.length > 0) {
        console.log('\n--- NEEDS SOURCE DATA ---');
        for (const r of needsData) {
            console.log(`${r.case_id} | ${r.name.substring(0, 25).padEnd(25)} | ${r.county.padEnd(12)} | ${r.reason}`);
        }
    }

    // Material savings changes
    const materialDrops = verified.filter(r => r.savings_change != null && r.savings_change < -50);
    if (materialDrops.length > 0) {
        console.log('\n--- MATERIAL SAVINGS DROPS ---');
        for (const r of materialDrops) {
            console.log(`${r.case_id} | ${r.name.substring(0, 25).padEnd(25)} | Old: $${r.old_savings}/yr → New: $${r.new_savings}/yr (Δ $${r.savings_change})`);
        }
    }

    console.log(`\nResults saved to: ${outputDir}/`);
    console.log(`Done: ${new Date().toISOString()}`);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
