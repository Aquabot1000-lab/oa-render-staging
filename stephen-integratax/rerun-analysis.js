#!/usr/bin/env node
/**
 * Re-run analysis for all 23 benchmark properties + active OA client cases
 * through the OverAssessed comp engine on Railway.
 */

const jwt = require('/Users/aquabot/Documents/OverAssessed/server/node_modules/jsonwebtoken');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://disciplined-alignment-production.up.railway.app';
const JWT_SECRET = 'overassessed-ai-jwt-secret-2026-bexar-county-tax-appeals';

// Generate admin JWT
const token = jwt.sign(
    { userId: 'admin', email: 'tyler@overassessed.ai', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '2h' }
);

const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
};

// Old benchmark results for comparison
const oldResults = JSON.parse(fs.readFileSync(
    '/Users/aquabot/Documents/OverAssessed/stephen-integratax/benchmark-results.json', 'utf8'
));
const benchmarkIds = JSON.parse(fs.readFileSync(
    '/Users/aquabot/Documents/OverAssessed/stephen-integratax/benchmark-ids.json', 'utf8'
));

// Build old results lookup by caseId
const oldLookup = {};
for (const r of oldResults) {
    oldLookup[r.caseId] = r;
}

async function fetchJSON(url, options = {}) {
    const resp = await fetch(url, { headers, ...options });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text.substring(0, 500)}`);
    }
    return resp.json();
}

async function main() {
    console.log('=== OverAssessed Re-Analysis Script ===');
    console.log(`Server: ${BASE_URL}`);
    console.log(`Time: ${new Date().toISOString()}\n`);

    // Step 1: Get all submissions to find active OA cases
    console.log('Fetching all submissions...');
    let submissions;
    try {
        submissions = await fetchJSON(`${BASE_URL}/api/submissions`);
    } catch (e) {
        console.error('Failed to fetch submissions:', e.message);
        process.exit(1);
    }

    // Handle if submissions is wrapped in an object
    const allSubs = Array.isArray(submissions) ? submissions : (submissions.submissions || submissions.data || []);
    console.log(`Total submissions: ${allSubs.length}`);

    // Identify benchmark cases (BM-*) and OA client cases  
    const bmCases = allSubs.filter(s => s.caseId && s.caseId.startsWith('BM-'));
    const oaCases = allSubs.filter(s => s.caseId && s.caseId.startsWith('OA-') && !s.deletedAt);
    
    console.log(`Benchmark cases: ${bmCases.length}`);
    console.log(`Active OA cases: ${oaCases.length}`);
    console.log('\nBenchmark case IDs:', bmCases.map(s => s.caseId).join(', '));
    console.log('OA case IDs:', oaCases.map(s => s.caseId).join(', '));

    // Combine all IDs to analyze
    const allCases = [...bmCases, ...oaCases];
    const allIds = allCases.map(s => s.id);

    console.log(`\nTotal cases to re-analyze: ${allIds.length}`);

    // Step 2: Store pre-analysis data for comparison
    const preAnalysis = {};
    for (const sub of allCases) {
        preAnalysis[sub.caseId] = {
            id: sub.id,
            caseId: sub.caseId,
            address: sub.propertyAddress,
            county: sub.county,
            assessed: sub.assessedValue,
            oldRecommended: sub.compResults?.recommendedValue || sub.compResults?.marketValue?.recommendedValue || null,
            oldSavings: sub.estimatedSavings || sub.compResults?.estimatedSavings || null,
            oldComps: sub.compResults?.marketValue?.compsUsed || sub.compResults?.comps?.length || null,
            oldSource: sub.compResults?.dataSource || null,
            hadTarrantData: sub.compResults?.dataSource === 'tarrant-cad' || false
        };
    }

    // Step 3: Re-analyze each case one at a time (to avoid overloading)
    console.log('\n--- Starting Re-Analysis ---\n');
    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < allCases.length; i++) {
        const sub = allCases[i];
        const caseId = sub.caseId;
        const id = sub.id;
        
        console.log(`[${i + 1}/${allCases.length}] Analyzing ${caseId}: ${sub.propertyAddress}...`);
        
        try {
            const result = await fetchJSON(`${BASE_URL}/api/cases/${id}/analyze`, {
                method: 'POST'
            });
            
            // Extract key metrics from result
            const compResults = result.compResults || result;
            const recommended = compResults.recommendedValue || compResults.marketValue?.recommendedValue || null;
            const savings = compResults.estimatedSavings || null;
            const dataSource = compResults.dataSource || null;
            const compsUsed = compResults.marketValue?.compsUsed || compResults.comps?.length || null;
            const euMedian = compResults.equalAndUniform?.medianPricePerSqft || null;
            
            results.push({
                caseId,
                id,
                address: sub.propertyAddress,
                county: sub.county,
                assessed: sub.assessedValue,
                newRecommended: recommended,
                newSavings: savings,
                dataSource,
                compsUsed,
                euMedian,
                success: true,
                raw: compResults
            });
            
            console.log(`  ✅ Recommended: $${recommended?.toLocaleString() || 'N/A'} | Savings: $${savings?.toLocaleString() || 'N/A'} | Source: ${dataSource || 'unknown'}`);
            successCount++;
        } catch (e) {
            console.log(`  ❌ Error: ${e.message}`);
            results.push({
                caseId,
                id,
                address: sub.propertyAddress,
                county: sub.county,
                assessed: sub.assessedValue,
                success: false,
                error: e.message
            });
            errorCount++;
        }
        
        // Small delay between requests to not hammer the server
        if (i < allCases.length - 1) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    console.log(`\n--- Analysis Complete ---`);
    console.log(`Success: ${successCount} | Errors: ${errorCount}\n`);

    // Step 4: Build comparison report
    const comparison = [];
    for (const r of results) {
        const pre = preAnalysis[r.caseId] || {};
        const old = oldLookup[r.caseId];
        
        comparison.push({
            caseId: r.caseId,
            address: r.address,
            county: r.county,
            assessed: r.assessed,
            // Old values (from benchmark-results.json if available, else from pre-analysis DB)
            oldRecommended: old?.recommended || pre.oldRecommended,
            oldSavings: old?.savings || pre.oldSavings,
            oldSource: pre.oldSource,
            // New values
            newRecommended: r.newRecommended,
            newSavings: r.newSavings,
            newSource: r.dataSource,
            newComps: r.compsUsed,
            // Deltas
            recommendedDelta: r.newRecommended && (old?.recommended || pre.oldRecommended)
                ? r.newRecommended - (old?.recommended || pre.oldRecommended)
                : null,
            savingsDelta: r.newSavings && (old?.savings || pre.oldSavings)
                ? r.newSavings - (old?.savings || pre.oldSavings)
                : null,
            usedTarrantData: r.dataSource === 'tarrant-cad',
            success: r.success,
            error: r.error || null
        });
    }

    // Step 5: Save results
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const outputPath = `/Users/aquabot/Documents/OverAssessed/stephen-integratax/rerun-results-${dateStr}.json`;
    
    fs.writeFileSync(outputPath, JSON.stringify({
        runDate: new Date().toISOString(),
        server: BASE_URL,
        summary: {
            totalCases: allCases.length,
            successful: successCount,
            errors: errorCount,
            usedTarrantCAD: results.filter(r => r.dataSource === 'tarrant-cad').length,
            usedSynthetic: results.filter(r => r.dataSource !== 'tarrant-cad' && r.success).length
        },
        comparison,
        rawResults: results
    }, null, 2));

    console.log(`Results saved to: ${outputPath}`);

    // Step 6: Print summary table
    console.log('\n========== COMPARISON REPORT ==========\n');
    console.log('BENCHMARK PROPERTIES (Tarrant County):');
    console.log('-'.repeat(120));
    
    const bmComps = comparison.filter(c => c.caseId.startsWith('BM-') || c.caseId === 'OA-0005');
    const oaComps = comparison.filter(c => c.caseId.startsWith('OA-') && c.caseId !== 'OA-0005');
    
    for (const c of bmComps) {
        const oldRec = c.oldRecommended ? `$${c.oldRecommended.toLocaleString()}` : 'N/A';
        const newRec = c.newRecommended ? `$${c.newRecommended.toLocaleString()}` : 'N/A';
        const delta = c.savingsDelta !== null ? (c.savingsDelta >= 0 ? `+$${c.savingsDelta}` : `-$${Math.abs(c.savingsDelta)}`) : 'N/A';
        const source = c.usedTarrantData ? '🟢 TAD' : '🔴 Synthetic';
        console.log(`${c.caseId} | ${c.address.substring(0, 35).padEnd(35)} | Old: ${oldRec.padStart(10)} → New: ${newRec.padStart(10)} | Savings Δ: ${delta.padStart(8)} | ${source}`);
    }

    if (oaComps.length > 0) {
        console.log('\nACTIVE OA CLIENT CASES:');
        console.log('-'.repeat(120));
        for (const c of oaComps) {
            const oldRec = c.oldRecommended ? `$${c.oldRecommended.toLocaleString()}` : 'N/A';
            const newRec = c.newRecommended ? `$${c.newRecommended.toLocaleString()}` : 'N/A';
            const delta = c.savingsDelta !== null ? (c.savingsDelta >= 0 ? `+$${c.savingsDelta}` : `-$${Math.abs(c.savingsDelta)}`) : 'N/A';
            const source = c.usedTarrantData ? '🟢 TAD' : (c.county?.toLowerCase().includes('bexar') ? '🔵 Bexar' : '⚪ Other');
            console.log(`${c.caseId} | ${c.address.substring(0, 35).padEnd(35)} | Old: ${oldRec.padStart(10)} → New: ${newRec.padStart(10)} | Savings Δ: ${delta.padStart(8)} | ${source}`);
        }
    }

    // Summary stats
    const tarrantCount = comparison.filter(c => c.usedTarrantData).length;
    const totalOldSavings = bmComps.reduce((s, c) => s + (c.oldSavings || 0), 0);
    const totalNewSavings = bmComps.filter(c => c.success).reduce((s, c) => s + (c.newSavings || 0), 0);
    
    console.log('\n========== SUMMARY ==========');
    console.log(`Tarrant CAD data used: ${tarrantCount}/${comparison.length} cases`);
    console.log(`Benchmark old total savings: $${totalOldSavings.toLocaleString()}`);
    console.log(`Benchmark new total savings: $${totalNewSavings.toLocaleString()}`);
    console.log(`Delta: ${totalNewSavings >= totalOldSavings ? '+' : '-'}$${Math.abs(totalNewSavings - totalOldSavings).toLocaleString()}`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
