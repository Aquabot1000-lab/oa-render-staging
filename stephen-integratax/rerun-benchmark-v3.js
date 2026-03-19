#!/usr/bin/env node
/**
 * Benchmark V3 — Tests FIXED comp-engine and eu-analysis locally.
 * 
 * Fixes tested:
 *   Bug 1: $0 value comps filtered out (totalValue < $20K)
 *   Bug 2: Comp selection by similarity score, not lowest value
 *   Bug 3: E&U reduction capped at 30%
 *   Bug 4: Vacant land / no-improvement comps excluded
 *   Bug 5: Duplicate comps deduplicated by accountId/address
 */

process.env.TAD_DATA_PATH = '/Users/aquabot/Documents/OverAssessed/data/tarrant/parcels-compact.jsonl';

const fs = require('fs');
const path = require('path');

const serverDir = '/Users/aquabot/Documents/OverAssessed/server';
const { findComparables } = require(path.join(serverDir, 'services', 'comp-engine'));
const tarrantData = require(path.join(serverDir, 'services', 'tarrant-data'));

// We need property-data for fetchPropertyData, but it may make API calls.
// Instead, build subject data directly from TAD for Tarrant County properties.
const { normalizePropertyType } = require(path.join(serverDir, 'services', 'property-data'));

const oldResults = JSON.parse(fs.readFileSync(
    '/Users/aquabot/Documents/OverAssessed/stephen-integratax/benchmark-results.json', 'utf8'
));

async function waitForTarrantData(maxWaitMs = 120000) {
    const start = Date.now();
    tarrantData.loadData();

    while (!tarrantData.isLoaded() && (Date.now() - start) < maxWaitMs) {
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 2000));
    }
    console.log('');

    if (tarrantData.isLoaded()) {
        const stats = tarrantData.getStats();
        console.log(`✅ Tarrant data loaded: ${stats.totalRecords.toLocaleString()} records`);
        return true;
    }
    console.log('❌ Failed to load Tarrant data');
    return false;
}

function buildSubjectFromTAD(address, assessedValue) {
    // Look up subject in TAD data
    const results = tarrantData.searchByAddress(address.split(',')[0].trim(), 5);
    
    let subject = {
        address,
        assessedValue,
        propertyType: 'Single Family Home',
        state: 'TX'
    };

    if (results.length > 0) {
        const tad = results[0];
        subject = {
            address,
            assessedValue: tad.totalValue || assessedValue,
            improvementValue: tad.improvementValue || 0,
            landValue: tad.landValue || 0,
            sqft: tad.sqft || 0,
            yearBuilt: tad.yearBuilt || 0,
            bedrooms: tad.bedrooms || 0,
            bathrooms: tad.bathrooms || 0,
            propertyType: tad.propertyClassDesc || 'Single Family Home',
            neighborhoodCode: tarrantData.extractNeighborhood(tad.legalDescription),
            state: 'TX',
            accountNumber: tad.accountNumber
        };
    }

    return subject;
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  BENCHMARK V3 — Fixed Comp Engine & E&U Analysis');
    console.log('  Fixes: $0 comps, selection bias, 30% cap, vacant land, dedup');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`  Run time: ${new Date().toISOString()}\n`);

    const dataReady = await waitForTarrantData();
    if (!dataReady) {
        console.error('Cannot proceed without Tarrant data');
        process.exit(1);
    }

    const results = [];
    let euExceeds35 = 0;

    for (let i = 0; i < oldResults.length; i++) {
        const old = oldResults[i];
        const label = `[${String(i + 1).padStart(2)}/${oldResults.length}]`;
        process.stdout.write(`${label} ${old.caseId}: ${old.address.substring(0, 40)}... `);

        try {
            const subject = buildSubjectFromTAD(old.address, old.assessed);
            const caseData = {
                propertyAddress: old.address,
                propertyType: 'Single Family Home',
                county: 'Tarrant',
                assessedValue: String(old.assessed)
            };

            const compResults = await findComparables(subject, caseData);

            const recommended = compResults.recommendedValue;
            const reduction = compResults.reduction || 0;
            const savings = compResults.estimatedSavings || 0;
            const strategy = compResults.primaryStrategy || 'unknown';
            const pctReduction = old.assessed > 0 ? (reduction / old.assessed * 100) : 0;

            const euRec = compResults.equalUniformAnalysis?.recommendedValue || null;
            const euReduction = euRec !== null ? Math.max(0, old.assessed - euRec) : 0;
            const euPct = old.assessed > 0 && euRec !== null ? (euReduction / old.assessed * 100) : 0;
            const euCapped = compResults.equalUniformAnalysis?.reductionCapped || false;

            if (euPct > 35) euExceeds35++;

            const mvRec = compResults.marketValueAnalysis?.recommendedValue || recommended;

            results.push({
                caseId: old.caseId,
                address: old.address,
                assessed: old.assessed,
                mvRecommended: mvRec,
                euRecommended: euRec,
                recommended,
                reduction,
                savings,
                pctReduction: Math.round(pctReduction * 10) / 10,
                primaryStrategy: strategy,
                euCapped,
                totalCompsFound: compResults.totalCompsFound || 0,
                // Old benchmark comparison
                oldRecommended: old.recommended,
                oldPct: old.pct,
                oldSavings: old.savings
            });

            const stratIcon = strategy === 'equal_and_uniform' ? 'E&U' : 'MV';
            console.log(`✅ Rec: $${recommended?.toLocaleString()} | ${stratIcon} | -${pctReduction.toFixed(1)}%${euCapped ? ' [CAPPED]' : ''}`);
        } catch (e) {
            console.log(`❌ ${e.message}`);
            results.push({
                caseId: old.caseId,
                address: old.address,
                assessed: old.assessed,
                error: e.message,
                success: false
            });
        }
    }

    // ─── SUMMARY TABLE ──────────────────────────────────────────────
    console.log('\n\n' + '═'.repeat(145));
    console.log('  RESULTS SUMMARY');
    console.log('═'.repeat(145));
    console.log(
        'Address'.padEnd(40) + ' | ' +
        'Assessed'.padStart(10) + ' | ' +
        'MV Rec'.padStart(10) + ' | ' +
        'E&U Rec'.padStart(10) + ' | ' +
        'Selected'.padStart(10) + ' | ' +
        'Strategy'.padEnd(8) + ' | ' +
        'Red %'.padStart(6) + ' | ' +
        'Old Rec'.padStart(10) + ' | ' +
        'Old %'.padStart(6) + ' | ' +
        'Δ Save'.padStart(8)
    );
    console.log('─'.repeat(145));

    let totalNewSavings = 0;
    let totalOldSavings = 0;

    for (const r of results) {
        if (r.error) {
            console.log(`${r.address.substring(0, 40).padEnd(40)} | ERROR: ${r.error}`);
            continue;
        }
        totalNewSavings += r.savings || 0;
        totalOldSavings += r.oldSavings || 0;

        const delta = (r.savings || 0) - (r.oldSavings || 0);
        const deltaStr = delta >= 0 ? `+$${delta.toLocaleString()}` : `-$${Math.abs(delta).toLocaleString()}`;
        const stratLabel = r.primaryStrategy === 'equal_and_uniform' ? 'E&U' : 'MV';

        console.log(
            r.address.substring(0, 40).padEnd(40) + ' | ' +
            `$${r.assessed.toLocaleString()}`.padStart(10) + ' | ' +
            `$${(r.mvRecommended || 0).toLocaleString()}`.padStart(10) + ' | ' +
            (r.euRecommended ? `$${r.euRecommended.toLocaleString()}` : 'N/A').padStart(10) + ' | ' +
            `$${(r.recommended || 0).toLocaleString()}`.padStart(10) + ' | ' +
            stratLabel.padEnd(8) + ' | ' +
            `${r.pctReduction}%`.padStart(6) + ' | ' +
            `$${(r.oldRecommended || 0).toLocaleString()}`.padStart(10) + ' | ' +
            `${(r.oldPct || 0).toFixed(1)}%`.padStart(6) + ' | ' +
            deltaStr.padStart(8)
        );
    }

    console.log('─'.repeat(145));
    const netDelta = totalNewSavings - totalOldSavings;
    console.log(
        'TOTALS'.padEnd(40) + ' | ' +
        ''.padStart(10) + ' | ' +
        ''.padStart(10) + ' | ' +
        ''.padStart(10) + ' | ' +
        ''.padStart(10) + ' | ' +
        ''.padEnd(8) + ' | ' +
        ''.padStart(6) + ' | ' +
        `$${totalOldSavings.toLocaleString()}`.padStart(10) + ' | ' +
        ''.padStart(6) + ' | ' +
        (netDelta >= 0 ? `+$${netDelta.toLocaleString()}` : `-$${Math.abs(netDelta).toLocaleString()}`).padStart(8)
    );

    // ─── VALIDATION ─────────────────────────────────────────────────
    console.log('\n\n═══════════════════════════════════════════════════════════════════');
    console.log('  VALIDATION CHECKS');
    console.log('═══════════════════════════════════════════════════════════════════');

    const successResults = results.filter(r => !r.error);
    const euResults = successResults.filter(r => r.euRecommended !== null && r.euRecommended !== undefined);

    // Check 1: No E&U reduction exceeds 35%
    const euOver35 = euResults.filter(r => {
        const euRedPct = (r.assessed - r.euRecommended) / r.assessed * 100;
        return euRedPct > 35;
    });
    console.log(`\n  ✅/❌ E&U reductions > 35%: ${euOver35.length} (should be 0)`);
    if (euOver35.length > 0) {
        for (const r of euOver35) {
            const pct = ((r.assessed - r.euRecommended) / r.assessed * 100).toFixed(1);
            console.log(`     ❌ ${r.address}: E&U recommends ${pct}% reduction ($${r.assessed.toLocaleString()} → $${r.euRecommended.toLocaleString()})`);
        }
    }

    // Check 2: No overall reduction exceeds 35%
    const over35 = successResults.filter(r => r.pctReduction > 35);
    console.log(`  ✅/❌ Overall reductions > 35%: ${over35.length} (should be 0)`);
    if (over35.length > 0) {
        for (const r of over35) {
            console.log(`     ❌ ${r.address}: ${r.pctReduction}% reduction via ${r.primaryStrategy}`);
        }
    }

    // Check 3: Reductions are in reasonable range (compare to original 5-13%)
    const avgNewPct = successResults.reduce((s, r) => s + (r.pctReduction || 0), 0) / successResults.length;
    const avgOldPct = successResults.reduce((s, r) => s + (r.oldPct || 0), 0) / successResults.length;
    console.log(`  📊 Average new reduction: ${avgNewPct.toFixed(1)}% (old average: ${avgOldPct.toFixed(1)}%)`);
    console.log(`  📊 New total savings: $${totalNewSavings.toLocaleString()}/yr (old: $${totalOldSavings.toLocaleString()}/yr)`);

    // Check 4: Success rate
    console.log(`  📊 Success rate: ${successResults.length}/${results.length} (${(successResults.length / results.length * 100).toFixed(0)}%)`);

    const allPass = euOver35.length === 0 && over35.length === 0;
    console.log(`\n  ${allPass ? '🟢 ALL CHECKS PASSED' : '🔴 SOME CHECKS FAILED'}`);

    // ─── SAVE RESULTS ───────────────────────────────────────────────
    const output = {
        runDate: new Date().toISOString(),
        runType: 'local-v3-fixed',
        fixes: [
            'Bug 1: $0 value comps filtered (totalValue < $20K)',
            'Bug 2: Comp selection by similarity score, not lowest value',
            'Bug 3: E&U reduction capped at 30%',
            'Bug 4: Vacant land / no-improvement comps excluded',
            'Bug 5: Duplicate comps deduplicated by accountId/address'
        ],
        validation: {
            euOver35Pct: euOver35.length,
            overallOver35Pct: over35.length,
            avgNewReductionPct: Math.round(avgNewPct * 10) / 10,
            avgOldReductionPct: Math.round(avgOldPct * 10) / 10,
            allChecksPassed: allPass
        },
        results,
        summary: {
            totalProperties: results.length,
            successful: successResults.length,
            newTotalSavings: totalNewSavings,
            oldTotalSavings: totalOldSavings,
            deltaSavings: netDelta
        }
    };

    const outputPath = '/Users/aquabot/Documents/OverAssessed/stephen-integratax/rerun-results-20260319-v3.json';
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n  Results saved to: ${outputPath}`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
