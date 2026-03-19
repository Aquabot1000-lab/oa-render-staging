#!/usr/bin/env node
/**
 * Re-run IntegraTax benchmark properties through the local Tarrant CAD comp engine.
 * Uses real TAD parcel data (728K records) instead of RentCast API.
 */

const path = require('path');
const fs = require('fs');

// Set up module resolution from the server directory
const SERVER_DIR = path.join(__dirname, 'server');
process.chdir(SERVER_DIR);

// Suppress any external API calls by stubbing env vars
process.env.RENTCAST_API_KEY = 'disabled-for-local-run';

const tarrantData = require('./server/services/tarrant-data');
const { findComparables } = require('./server/services/comp-engine');

const BENCHMARK_FILE = path.join(__dirname, 'stephen-integratax', 'benchmark-results.json');
const OUTPUT_FILE = path.join(__dirname, 'stephen-integratax', 'rerun-results-20260319-v2.json');
const REPORT_FILE = path.join(__dirname, 'stephen-integratax', 'comparison-report-20260319.md');

async function main() {
    console.log('=== IntegraTax Benchmark Re-Run via Local Tarrant CAD Comp Engine ===\n');

    // Step 1: Load TAD data
    console.log('Loading Tarrant CAD data (728K parcels)...');
    const loadResult = await tarrantData.loadData();
    if (!loadResult) {
        console.error('FATAL: Failed to load Tarrant CAD data');
        process.exit(1);
    }
    const stats = tarrantData.getStats();
    console.log(`Loaded: ${stats.totalRecords.toLocaleString()} parcels, ${stats.memoryMB}MB heap\n`);

    // Step 2: Load benchmark properties
    const benchmarkData = JSON.parse(fs.readFileSync(BENCHMARK_FILE, 'utf-8'));
    console.log(`Processing ${benchmarkData.length} benchmark properties...\n`);

    const results = [];

    for (let i = 0; i < benchmarkData.length; i++) {
        const bm = benchmarkData[i];
        console.log(`\n[${i + 1}/${benchmarkData.length}] ${bm.address} (assessed: $${bm.assessed.toLocaleString()})`);

        try {
            // Find the subject property in TAD data
            const addressQuery = bm.address
                .replace(/,?\s*(Fort Worth|TX)[\s,]*/gi, '')
                .replace(/\./g, '')
                .trim();
            
            const tadResults = tarrantData.searchByAddress(addressQuery, 5);
            
            let subject;
            if (tadResults.length > 0) {
                const tad = tadResults[0];
                console.log(`  Found in TAD: Account ${tad.accountNumber}, ${tad.address}, $${(tad.totalValue || 0).toLocaleString()}`);
                subject = {
                    address: bm.address,
                    assessedValue: bm.assessed, // Use benchmark assessed value
                    sqft: tad.sqft,
                    yearBuilt: tad.yearBuilt,
                    bedrooms: tad.bedrooms,
                    bathrooms: tad.bathrooms,
                    landValue: tad.landValue,
                    improvementValue: tad.improvementValue,
                    propertyType: tad.propertyClassDesc || 'Single Family Home',
                    neighborhoodCode: tarrantData.extractNeighborhood(tad.legalDescription),
                    lotSize: null,
                    marketValue: tad.totalValue
                };
            } else {
                console.log(`  ⚠️ Not found in TAD, using minimal subject data`);
                subject = {
                    address: bm.address,
                    assessedValue: bm.assessed,
                    propertyType: 'Single Family Home'
                };
            }

            // Run the comp engine analysis
            const caseData = { county: 'tarrant' };
            const analysis = await findComparables(subject, caseData);

            const result = {
                caseId: bm.caseId,
                address: bm.address,
                assessed: bm.assessed,
                tadValue: tadResults.length > 0 ? tadResults[0].totalValue : null,
                recommended: analysis.recommendedValue,
                reduction: analysis.reduction,
                savings: analysis.estimatedSavings,
                pct: bm.assessed > 0 ? (analysis.reduction / bm.assessed) * 100 : 0,
                primaryStrategy: analysis.primaryStrategy,
                totalCompsFound: analysis.totalCompsFound,
                evidenceComps: analysis.comps ? analysis.comps.length : 0,
                methodology: analysis.methodology,
                needsManualReview: analysis.needsManualReview || false,
                reviewReason: analysis.reviewReason || null,
                // Market Value details
                mvRecommended: analysis.marketValueAnalysis?.recommendedValue,
                mvReduction: analysis.marketValueAnalysis?.reduction,
                mvSavings: analysis.marketValueAnalysis?.estimatedSavings,
                // E&U details
                euRecommended: analysis.equalUniformAnalysis?.recommendedValue || null,
                euReduction: analysis.equalUniformAnalysis?.reduction || null,
                euSavings: analysis.equalUniformAnalysis?.estimatedSavings || null,
                euMedianPSF: analysis.equalUniformAnalysis?.medianPSF || null,
                euSubjectPSF: analysis.equalUniformAnalysis?.subjectPSF || null,
                euCompsUsed: analysis.equalUniformAnalysis?.compsUsed || null,
                // Top 5 comp details
                topComps: (analysis.comps || []).slice(0, 5).map(c => ({
                    address: c.address,
                    accountId: c.accountId,
                    assessed: c.assessedValue,
                    adjusted: c.adjustedValue,
                    sqft: c.sqft,
                    yearBuilt: c.yearBuilt,
                    score: c.score,
                    adjustmentBreakdown: c.adjustmentBreakdown
                }))
            };

            results.push(result);

            const stratLabel = result.primaryStrategy === 'equal_and_uniform' ? 'E&U' : 'MV';
            console.log(`  ✅ Recommended: $${result.recommended.toLocaleString()} (${stratLabel}) | Reduction: $${result.reduction.toLocaleString()} (${result.pct.toFixed(1)}%) | Comps: ${result.totalCompsFound}`);

        } catch (err) {
            console.error(`  ❌ ERROR: ${err.message}`);
            results.push({
                caseId: bm.caseId,
                address: bm.address,
                assessed: bm.assessed,
                error: err.message
            });
        }
    }

    // Step 3: Save results
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\n\nResults saved to: ${OUTPUT_FILE}`);

    // Step 4: Generate comparison report
    const report = generateComparisonReport(benchmarkData, results);
    fs.writeFileSync(REPORT_FILE, report);
    console.log(`Comparison report saved to: ${REPORT_FILE}`);

    // Summary
    console.log('\n=== SUMMARY ===');
    const successful = results.filter(r => !r.error);
    const totalOldSavings = benchmarkData.reduce((s, b) => s + b.savings, 0);
    const totalNewSavings = successful.reduce((s, r) => s + (r.savings || 0), 0);
    const totalOldReduction = benchmarkData.reduce((s, b) => s + b.reduction, 0);
    const totalNewReduction = successful.reduce((s, r) => s + (r.reduction || 0), 0);
    console.log(`Properties analyzed: ${successful.length}/${benchmarkData.length}`);
    console.log(`Total old reduction: $${totalOldReduction.toLocaleString()} (savings: $${totalOldSavings.toLocaleString()})`);
    console.log(`Total new reduction: $${totalNewReduction.toLocaleString()} (savings: $${totalNewSavings.toLocaleString()})`);
    console.log(`Improvement: $${(totalNewReduction - totalOldReduction).toLocaleString()} more in reductions`);
}

function generateComparisonReport(oldData, newData) {
    const lines = [];
    lines.push('# IntegraTax Benchmark Comparison Report');
    lines.push(`**Date:** March 19, 2026`);
    lines.push(`**Engine:** Local Tarrant CAD Comp Engine (728K real parcels)`);
    lines.push(`**Previous:** RentCast API (synthetic comps)`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');

    const successful = newData.filter(r => !r.error);
    const totalOldReduction = oldData.reduce((s, b) => s + b.reduction, 0);
    const totalNewReduction = successful.reduce((s, r) => s + (r.reduction || 0), 0);
    const totalOldSavings = oldData.reduce((s, b) => s + b.savings, 0);
    const totalNewSavings = successful.reduce((s, r) => s + (r.savings || 0), 0);

    lines.push(`| Metric | Old (RentCast) | New (TAD Comp Engine) | Delta |`);
    lines.push(`|--------|---------------|----------------------|-------|`);
    lines.push(`| Properties | ${oldData.length} | ${successful.length} | — |`);
    lines.push(`| Total Reduction | $${totalOldReduction.toLocaleString()} | $${totalNewReduction.toLocaleString()} | $${(totalNewReduction - totalOldReduction).toLocaleString()} |`);
    lines.push(`| Total Tax Savings | $${totalOldSavings.toLocaleString()} | $${totalNewSavings.toLocaleString()} | $${(totalNewSavings - totalOldSavings).toLocaleString()} |`);
    lines.push(`| Avg Reduction % | ${(oldData.reduce((s, b) => s + b.pct, 0) / oldData.length).toFixed(1)}% | ${(successful.reduce((s, r) => s + (r.pct || 0), 0) / successful.length).toFixed(1)}% | — |`);
    lines.push('');
    lines.push('## Property-by-Property Comparison');
    lines.push('');
    lines.push('| # | Address | Assessed | Old Recommended | New Recommended | Old Reduction | New Reduction | Strategy | Comps |');
    lines.push('|---|---------|----------|----------------|----------------|---------------|---------------|----------|-------|');

    for (let i = 0; i < oldData.length; i++) {
        const old = oldData[i];
        const newR = newData.find(r => r.caseId === old.caseId) || {};
        const shortAddr = old.address.replace(/, Fort Worth, TX/i, '').replace(/\./g, '');
        const strategy = newR.primaryStrategy === 'equal_and_uniform' ? 'E&U' : 'MV';
        const reductionDelta = (newR.reduction || 0) - old.reduction;
        const deltaStr = reductionDelta >= 0 ? `+$${reductionDelta.toLocaleString()}` : `-$${Math.abs(reductionDelta).toLocaleString()}`;

        lines.push(`| ${i + 1} | ${shortAddr} | $${old.assessed.toLocaleString()} | $${old.recommended.toLocaleString()} | $${(newR.recommended || 0).toLocaleString()} | $${old.reduction.toLocaleString()} | $${(newR.reduction || 0).toLocaleString()} (${deltaStr}) | ${strategy} | ${newR.totalCompsFound || 0} |`);
    }

    lines.push('');
    lines.push('## Detailed Analysis per Property');
    lines.push('');

    for (const newR of newData) {
        if (newR.error) {
            lines.push(`### ❌ ${newR.address}`);
            lines.push(`Error: ${newR.error}`);
            lines.push('');
            continue;
        }

        const old = oldData.find(o => o.caseId === newR.caseId);
        lines.push(`### ${newR.address}`);
        lines.push(`- **Case ID:** ${newR.caseId}`);
        lines.push(`- **Assessed Value:** $${newR.assessed.toLocaleString()}`);
        if (newR.tadValue) lines.push(`- **TAD Value (from data):** $${newR.tadValue.toLocaleString()}`);
        lines.push(`- **Primary Strategy:** ${newR.primaryStrategy === 'equal_and_uniform' ? 'Equal & Uniform (§42.26)' : 'Market Value Comparison'}`);
        lines.push(`- **Recommended Value:** $${newR.recommended.toLocaleString()} (was $${old ? old.recommended.toLocaleString() : 'N/A'})`);
        lines.push(`- **Reduction:** $${newR.reduction.toLocaleString()} / ${newR.pct.toFixed(1)}% (was $${old ? old.reduction.toLocaleString() : 'N/A'})`);
        lines.push(`- **Est. Tax Savings:** $${newR.savings.toLocaleString()}/yr`);
        lines.push(`- **Total Comps Found:** ${newR.totalCompsFound}`);
        if (newR.needsManualReview) lines.push(`- **⚠️ Manual Review:** ${newR.reviewReason}`);

        if (newR.euRecommended) {
            lines.push(`- **E&U Details:** Median PSF $${(newR.euMedianPSF || 0).toFixed(2)} vs Subject PSF $${(newR.euSubjectPSF || 0).toFixed(2)} (${newR.euCompsUsed} comps)`);
        }

        if (newR.mvRecommended) {
            lines.push(`- **Market Value:** $${newR.mvRecommended.toLocaleString()} (reduction $${(newR.mvReduction || 0).toLocaleString()})`);
        }

        // Top comps
        if (newR.topComps && newR.topComps.length > 0) {
            lines.push(`- **Top Comps:**`);
            for (const c of newR.topComps) {
                const adjBreak = (c.adjustmentBreakdown || []).map(a => `${a.factor}: $${a.dollar.toLocaleString()}`).join(', ');
                lines.push(`  - ${c.address} | Assessed: $${(c.assessed || 0).toLocaleString()} → Adjusted: $${(c.adjusted || 0).toLocaleString()} | ${c.sqft || '?'}sf/${c.yearBuilt || '?'} | Score: ${c.score}${adjBreak ? ' | Adj: ' + adjBreak : ''}`);
            }
        }
        lines.push('');
    }

    lines.push('---');
    lines.push('*Generated by OverAssessed Tarrant CAD Comp Engine*');

    return lines.join('\n');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
