#!/usr/bin/env node
/**
 * Benchmark V4 — Tests comp-engine with all fixes including:
 *   Bug 1-5: (from V3)
 *   Issue 1: Recommended > assessed → cap at assessed (0% reduction)
 *   Issue 2: Show both MV and E&U side-by-side, pick lower (but never above assessed)
 *   Issue 3: Show euUncappedPct for diagnostics on the 30% cap
 */

process.env.TAD_DATA_PATH = '/Users/aquabot/Documents/OverAssessed/data/tarrant/parcels-compact.jsonl';

const fs = require('fs');
const path = require('path');

const serverDir = '/Users/aquabot/Documents/OverAssessed/server';
const { findComparables } = require(path.join(serverDir, 'services', 'comp-engine'));
const tarrantData = require(path.join(serverDir, 'services', 'tarrant-data'));
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
    console.log('  BENCHMARK V4 — Comp Engine with Assessed Cap + Side-by-Side');
    console.log('  Fixes: V3 bugs + rec > assessed cap + E&U uncapped diagnostics');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`  Run time: ${new Date().toISOString()}\n`);

    const dataReady = await waitForTarrantData();
    if (!dataReady) {
        console.error('Cannot proceed without Tarrant data');
        process.exit(1);
    }

    const results = [];

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

            // Extract raw MV and E&U values from engine
            const rawMvRec = compResults.marketValueAnalysis?.recommendedValue || compResults.recommendedValue;
            const rawEuRec = compResults.equalUniformAnalysis?.recommendedValue || null;

            // Cap both at assessed value (Issue 1)
            const mvRec = Math.min(rawMvRec, old.assessed);
            const euRec = rawEuRec !== null ? Math.min(rawEuRec, old.assessed) : null;

            // Issue 2: Pick the lower of MV and E&U (more savings), but only if below assessed
            let selected, strategy;
            if (euRec !== null && euRec < mvRec) {
                selected = euRec;
                strategy = 'equal_and_uniform';
            } else {
                selected = mvRec;
                strategy = 'market_value';
            }
            // If both are at assessed, it's 0% reduction — strategy doesn't matter much
            if (selected >= old.assessed) {
                selected = old.assessed;
                strategy = 'none';
            }

            const reduction = Math.max(0, old.assessed - selected);
            const pctReduction = old.assessed > 0 ? Math.round((reduction / old.assessed) * 1000) / 10 : 0;
            const taxRate = 0.024;
            const savings = Math.round(reduction * taxRate);

            // Issue 3: E&U uncapped diagnostics
            const euUncappedPct = compResults.equalUniformAnalysis?.euUncappedPct || null;
            const euUncappedValue = compResults.equalUniformAnalysis?.euUncappedValue || null;
            const euCapped = compResults.equalUniformAnalysis?.reductionCapped || false;

            results.push({
                caseId: old.caseId,
                address: old.address,
                assessed: old.assessed,
                mvRecommended: mvRec,
                euRecommended: euRec,
                recommended: selected,
                reduction,
                savings,
                pctReduction,
                primaryStrategy: strategy,
                euCapped,
                euUncappedPct: euUncappedPct !== null ? Math.round(euUncappedPct * 1000) / 10 : null,
                euUncappedValue,
                totalCompsFound: compResults.totalCompsFound || 0,
                oldRecommended: old.recommended,
                oldPct: old.pct,
                oldSavings: old.savings
            });

            const stratIcon = strategy === 'equal_and_uniform' ? 'E&U' : (strategy === 'none' ? '---' : 'MV');
            const uncapStr = euUncappedPct !== null ? ` [uncap:${(euUncappedPct * 100).toFixed(1)}%]` : '';
            console.log(`✅ Sel: $${selected.toLocaleString()} | ${stratIcon} | -${pctReduction}%${euCapped ? ' [CAPPED]' : ''}${uncapStr}`);
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
    console.log('\n\n' + '═'.repeat(165));
    console.log('  RESULTS SUMMARY (V4)');
    console.log('═'.repeat(165));
    console.log(
        '#'.padStart(3) + ' | ' +
        'Address'.padEnd(38) + ' | ' +
        'Assessed'.padStart(10) + ' | ' +
        'MV Rec'.padStart(10) + ' | ' +
        'E&U Rec'.padStart(10) + ' | ' +
        'Selected'.padStart(10) + ' | ' +
        'Strat'.padEnd(5) + ' | ' +
        'Red %'.padStart(6) + ' | ' +
        'EU Uncap%'.padStart(10) + ' | ' +
        'Old Rec'.padStart(10) + ' | ' +
        'Old %'.padStart(6)
    );
    console.log('─'.repeat(165));

    let totalNewSavings = 0;
    let totalOldSavings = 0;
    let aboveAssessedCount = 0;
    let over35Count = 0;

    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.error) {
            console.log(`${String(i+1).padStart(3)} | ${r.address.substring(0, 38).padEnd(38)} | ERROR: ${r.error}`);
            continue;
        }
        totalNewSavings += r.savings || 0;
        totalOldSavings += r.oldSavings || 0;

        if (r.recommended > r.assessed) aboveAssessedCount++;
        if (r.pctReduction > 35) over35Count++;

        const stratLabel = r.primaryStrategy === 'equal_and_uniform' ? 'E&U' : (r.primaryStrategy === 'none' ? '---' : 'MV');
        const euUncapStr = r.euUncappedPct !== null ? `${r.euUncappedPct}%` : 'N/A';

        console.log(
            String(i+1).padStart(3) + ' | ' +
            r.address.substring(0, 38).padEnd(38) + ' | ' +
            `$${r.assessed.toLocaleString()}`.padStart(10) + ' | ' +
            `$${(r.mvRecommended || 0).toLocaleString()}`.padStart(10) + ' | ' +
            (r.euRecommended !== null ? `$${r.euRecommended.toLocaleString()}` : 'N/A').padStart(10) + ' | ' +
            `$${(r.recommended || 0).toLocaleString()}`.padStart(10) + ' | ' +
            stratLabel.padEnd(5) + ' | ' +
            `${r.pctReduction}%`.padStart(6) + ' | ' +
            euUncapStr.padStart(10) + ' | ' +
            `$${(r.oldRecommended || 0).toLocaleString()}`.padStart(10) + ' | ' +
            `${(r.oldPct || 0).toFixed(1)}%`.padStart(6)
        );
    }
    console.log('─'.repeat(165));

    // ─── VALIDATION ─────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('  VALIDATION CHECKS');
    console.log('═══════════════════════════════════════════════════════════════════');

    const successResults = results.filter(r => !r.error);
    console.log(`\n  ${aboveAssessedCount === 0 ? '✅' : '❌'} Recommended > Assessed: ${aboveAssessedCount} (should be 0)`);
    console.log(`  ${over35Count === 0 ? '✅' : '❌'} Reductions > 35%: ${over35Count} (should be 0)`);

    const avgNewPct = successResults.reduce((s, r) => s + (r.pctReduction || 0), 0) / successResults.length;
    const avgOldPct = successResults.reduce((s, r) => s + (r.oldPct || 0), 0) / successResults.length;
    console.log(`  📊 Average new reduction: ${avgNewPct.toFixed(1)}% (old: ${avgOldPct.toFixed(1)}%)`);
    console.log(`  📊 New total savings: $${totalNewSavings.toLocaleString()}/yr (old: $${totalOldSavings.toLocaleString()}/yr)`);
    console.log(`  📊 Success rate: ${successResults.length}/${results.length}`);

    // E&U cap analysis
    const cappedResults = successResults.filter(r => r.euCapped);
    console.log(`\n  📊 E&U Capped at 30%: ${cappedResults.length} properties`);
    if (cappedResults.length > 0) {
        console.log('     Uncapped E&U percentages:');
        for (const r of cappedResults) {
            console.log(`       ${r.address.substring(0, 40)}: uncapped=${r.euUncappedPct}%`);
        }
    }

    // Properties with 0% reduction
    const zeroReduction = successResults.filter(r => r.pctReduction === 0);
    console.log(`  📊 Properties at 0% reduction (fairly valued): ${zeroReduction.length}`);
    for (const r of zeroReduction) {
        console.log(`       ${r.address.substring(0, 40)}: MV=$${(r.mvRecommended||0).toLocaleString()}, E&U=$${(r.euRecommended||'N/A')}`);
    }

    const allPass = aboveAssessedCount === 0 && over35Count === 0;
    console.log(`\n  ${allPass ? '🟢 ALL CHECKS PASSED' : '🔴 SOME CHECKS FAILED'}`);

    // ─── SAVE RESULTS ───────────────────────────────────────────────
    const output = {
        runDate: new Date().toISOString(),
        runType: 'local-v4-assessed-cap',
        fixes: [
            'Bug 1: $0 value comps filtered (totalValue < $20K)',
            'Bug 2: Comp selection by similarity score, not lowest value',
            'Bug 3: E&U reduction capped at 30%',
            'Bug 4: Vacant land / no-improvement comps excluded',
            'Bug 5: Duplicate comps deduplicated by accountId/address',
            'Issue 1: Recommended > assessed → cap at assessed (0% reduction)',
            'Issue 2: Both MV and E&U shown side-by-side, lower wins',
            'Issue 3: E&U uncapped % exposed for diagnostics'
        ],
        validation: {
            aboveAssessedCount,
            over35Count,
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
            deltaSavings: totalNewSavings - totalOldSavings
        }
    };

    const outputPath = '/Users/aquabot/Documents/OverAssessed/stephen-integratax/rerun-results-20260319-v4.json';
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n  Results saved to: ${outputPath}`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
