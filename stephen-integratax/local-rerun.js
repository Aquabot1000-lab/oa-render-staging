#!/usr/bin/env node
/**
 * Run comp engine LOCALLY for all 23 benchmark properties + 10 OA cases.
 * Uses the local Tarrant CAD data file directly.
 */

process.env.TAD_DATA_PATH = '/Users/aquabot/Documents/OverAssessed/data/tarrant/parcels-compact.jsonl';

const fs = require('fs');
const path = require('path');

// Load server modules directly
const serverDir = '/Users/aquabot/Documents/OverAssessed/server';
const { findComparables } = require(path.join(serverDir, 'services', 'comp-engine'));
const { fetchPropertyData } = require(path.join(serverDir, 'services', 'property-data'));
const tarrantData = require(path.join(serverDir, 'services', 'tarrant-data'));

const oldResults = JSON.parse(fs.readFileSync(
    '/Users/aquabot/Documents/OverAssessed/stephen-integratax/benchmark-results.json', 'utf8'
));

const oldLookup = {};
for (const r of oldResults) oldLookup[r.caseId] = r;

async function waitForTarrantData(maxWaitMs = 60000) {
    const start = Date.now();
    // Trigger load
    tarrantData.load && tarrantData.load();
    
    while (!tarrantData.isLoaded() && (Date.now() - start) < maxWaitMs) {
        console.log('Waiting for Tarrant data to load...');
        await new Promise(r => setTimeout(r, 2000));
    }
    
    if (tarrantData.isLoaded()) {
        const stats = tarrantData.getStats ? tarrantData.getStats() : {};
        console.log(`✅ Tarrant data loaded: ${JSON.stringify(stats)}`);
        return true;
    } else {
        console.log('❌ Tarrant data failed to load within timeout');
        return false;
    }
}

async function analyzeProperty(address, assessedValue, county, caseData = {}) {
    // Build minimal case data
    const sub = {
        propertyAddress: address,
        propertyType: 'Single Family Home',
        assessedValue: String(assessedValue),
        county: county || 'Tarrant',
        state: 'TX',
        ...caseData
    };

    // Fetch property data
    const propertyData = await fetchPropertyData(sub);
    
    // Run comp engine
    const compResults = await findComparables(propertyData, sub);
    
    return {
        propertyData,
        compResults,
        recommended: compResults.recommendedValue,
        savings: compResults.estimatedSavings,
        dataSource: compResults.dataSource,
        primaryStrategy: compResults.primaryStrategy,
        compsUsed: compResults.totalComps || compResults.marketValue?.compsUsed,
        euRecommended: compResults.equalUniformAnalysis?.recommendedValue,
        euMedianPSF: compResults.equalUniformAnalysis?.medianPSF
    };
}

async function main() {
    console.log('=== LOCAL Benchmark Re-Analysis ===');
    console.log(`Time: ${new Date().toISOString()}\n`);

    // Wait for Tarrant data to load
    const dataReady = await waitForTarrantData(120000);
    if (!dataReady) {
        console.error('Cannot proceed without Tarrant data');
        process.exit(1);
    }

    // ---- BENCHMARK PROPERTIES (23 Tarrant County) ----
    console.log('\n--- Analyzing 23 Benchmark Properties ---\n');
    const bmResults = [];

    for (let i = 0; i < oldResults.length; i++) {
        const old = oldResults[i];
        console.log(`[${i + 1}/${oldResults.length}] ${old.caseId}: ${old.address}...`);
        
        try {
            const result = await analyzeProperty(old.address, old.assessed, 'Tarrant');
            
            bmResults.push({
                caseId: old.caseId,
                address: old.address,
                county: 'Tarrant',
                assessed: old.assessed,
                oldRecommended: old.recommended,
                oldSavings: old.savings,
                oldPct: old.pct,
                newRecommended: result.recommended,
                newSavings: result.savings,
                newDataSource: result.dataSource,
                newPrimaryStrategy: result.primaryStrategy,
                newCompsUsed: result.compsUsed,
                newEuRecommended: result.euRecommended,
                newEuMedianPSF: result.euMedianPSF,
                success: true
            });
            
            const usedTAD = result.dataSource === 'tarrant-cad';
            console.log(`  ✅ Recommended: $${result.recommended?.toLocaleString() || 'N/A'} | Savings: $${result.savings?.toLocaleString() || 'N/A'} | ${usedTAD ? '🟢 TAD' : '🔴 Syn'} | Strategy: ${result.primaryStrategy || 'N/A'}`);
        } catch (e) {
            console.log(`  ❌ Error: ${e.message}`);
            bmResults.push({
                caseId: old.caseId,
                address: old.address,
                assessed: old.assessed,
                oldRecommended: old.recommended,
                oldSavings: old.savings,
                success: false,
                error: e.message
            });
        }
        
        // Brief pause
        await new Promise(r => setTimeout(r, 500));
    }

    // ---- OA CLIENT CASES ----
    // We need to get these from the Railway API or local data
    console.log('\n--- Fetching OA Client Cases from Railway ---\n');
    
    const jwt = require(path.join(serverDir, 'node_modules', 'jsonwebtoken'));
    const token = jwt.sign(
        { userId: 'admin', email: 'tyler@overassessed.ai', role: 'admin' },
        'overassessed-ai-jwt-secret-2026-bexar-county-tax-appeals',
        { expiresIn: '2h' }
    );

    let oaCases = [];
    try {
        const resp = await fetch('https://disciplined-alignment-production.up.railway.app/api/submissions', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        const allSubs = Array.isArray(data) ? data : (data.submissions || data.data || []);
        oaCases = allSubs.filter(s => s.caseId?.startsWith('OA-') && !s.deletedAt);
        console.log(`Found ${oaCases.length} OA client cases`);
    } catch (e) {
        console.log(`Failed to fetch OA cases from Railway: ${e.message}`);
    }

    const oaResults = [];
    for (let i = 0; i < oaCases.length; i++) {
        const sub = oaCases[i];
        const county = sub.county || 'Unknown';
        console.log(`[${i + 1}/${oaCases.length}] ${sub.caseId}: ${sub.propertyAddress} (${county})...`);
        
        try {
            const result = await analyzeProperty(
                sub.propertyAddress, 
                sub.assessedValue || 300000, 
                county,
                { bedrooms: sub.bedrooms, bathrooms: sub.bathrooms, sqft: sub.sqft, yearBuilt: sub.yearBuilt }
            );
            
            const preSavings = sub.estimatedSavings || sub.compResults?.estimatedSavings;
            const preRec = sub.compResults?.recommendedValue;
            
            oaResults.push({
                caseId: sub.caseId,
                address: sub.propertyAddress,
                county,
                assessed: sub.assessedValue,
                oldRecommended: preRec,
                oldSavings: preSavings,
                newRecommended: result.recommended,
                newSavings: result.savings,
                newDataSource: result.dataSource,
                newPrimaryStrategy: result.primaryStrategy,
                success: true
            });
            
            const usedTAD = result.dataSource === 'tarrant-cad';
            console.log(`  ✅ Recommended: $${result.recommended?.toLocaleString() || 'N/A'} | Savings: $${result.savings?.toLocaleString() || 'N/A'} | ${usedTAD ? '🟢 TAD' : '🔵 Other'}`);
        } catch (e) {
            console.log(`  ❌ Error: ${e.message}`);
            oaResults.push({
                caseId: sub.caseId,
                address: sub.propertyAddress,
                county,
                success: false,
                error: e.message
            });
        }
        
        await new Promise(r => setTimeout(r, 500));
    }

    // ---- REPORT ----
    console.log('\n\n' + '='.repeat(120));
    console.log('BENCHMARK COMPARISON REPORT — Tarrant County (23 Properties)');
    console.log('='.repeat(120) + '\n');
    
    let totalOldSavings = 0;
    let totalNewSavings = 0;
    let tarrantCount = 0;
    let improvedCount = 0;
    
    console.log(`${'Case'.padEnd(10)} | ${'Address'.padEnd(38)} | ${'Assessed'.padStart(12)} | ${'Old Rec'.padStart(12)} | ${'New Rec'.padStart(12)} | ${'Old Save'.padStart(9)} | ${'New Save'.padStart(9)} | ${'Δ Save'.padStart(8)} | Source`);
    console.log('-'.repeat(140));
    
    for (const r of bmResults) {
        const oldSave = r.oldSavings || 0;
        const newSave = r.newSavings || 0;
        totalOldSavings += oldSave;
        totalNewSavings += newSave;
        
        if (r.newDataSource === 'tarrant-cad') tarrantCount++;
        if (newSave > oldSave) improvedCount++;
        
        const delta = newSave - oldSave;
        const deltaStr = r.success ? (delta >= 0 ? `+$${delta.toLocaleString()}` : `-$${Math.abs(delta).toLocaleString()}`) : 'ERR';
        const src = r.newDataSource === 'tarrant-cad' ? '🟢 TAD' : (r.success ? '🔴 Syn' : '❌');
        
        console.log(
            `${r.caseId.padEnd(10)} | ${r.address.substring(0, 38).padEnd(38)} | $${(r.assessed || 0).toLocaleString().padStart(10)} | $${(r.oldRecommended || 0).toLocaleString().padStart(10)} | ${r.success ? '$' + (r.newRecommended || 0).toLocaleString().padStart(10) : 'ERROR'.padStart(11)} | $${oldSave.toLocaleString().padStart(7)} | ${r.success ? '$' + newSave.toLocaleString().padStart(7) : 'ERR'.padStart(8)} | ${deltaStr.padStart(8)} | ${src}`
        );
    }

    console.log('-'.repeat(140));
    console.log(`${'TOTALS'.padEnd(10)} | ${''.padEnd(38)} | ${''.padStart(12)} | ${''.padStart(12)} | ${''.padStart(12)} | $${totalOldSavings.toLocaleString().padStart(7)} | $${totalNewSavings.toLocaleString().padStart(7)} | ${(totalNewSavings >= totalOldSavings ? '+' : '-')}$${Math.abs(totalNewSavings - totalOldSavings).toLocaleString().padStart(6)} |`);

    if (oaResults.length > 0) {
        console.log('\n' + '='.repeat(120));
        console.log('OA CLIENT CASES (10 Active)');
        console.log('='.repeat(120) + '\n');
        
        for (const r of oaResults) {
            const src = r.newDataSource === 'tarrant-cad' ? '🟢 TAD' : (r.success ? '🔵 Other' : '❌');
            const oldStr = r.oldRecommended ? `$${r.oldRecommended.toLocaleString()}` : 'N/A';
            const newStr = r.newRecommended ? `$${r.newRecommended.toLocaleString()}` : 'N/A';
            console.log(`${r.caseId.padEnd(10)} | ${(r.address || '').substring(0, 38).padEnd(38)} | ${(r.county || '').padEnd(10)} | Old: ${oldStr.padStart(10)} → New: ${newStr.padStart(10)} | ${src}`);
        }
    }

    console.log('\n========== SUMMARY ==========');
    console.log(`Benchmark cases analyzed: ${bmResults.filter(r => r.success).length}/${bmResults.length}`);
    console.log(`OA cases analyzed: ${oaResults.filter(r => r.success).length}/${oaResults.length}`);
    console.log(`Used Tarrant CAD data: ${tarrantCount}/${bmResults.length} benchmark cases`);
    console.log(`Improved savings: ${improvedCount}/${bmResults.filter(r => r.success).length} cases`);
    console.log(`Old total benchmark savings: $${totalOldSavings.toLocaleString()}/year`);
    console.log(`New total benchmark savings: $${totalNewSavings.toLocaleString()}/year`);
    console.log(`Net change: ${totalNewSavings >= totalOldSavings ? '+' : '-'}$${Math.abs(totalNewSavings - totalOldSavings).toLocaleString()}/year`);

    // Save full results
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const output = {
        runDate: new Date().toISOString(),
        runType: 'local',
        tarrantDataLoaded: tarrantData.isLoaded(),
        benchmarkResults: bmResults,
        oaClientResults: oaResults,
        summary: {
            benchmarkSuccess: bmResults.filter(r => r.success).length,
            benchmarkTotal: bmResults.length,
            oaSuccess: oaResults.filter(r => r.success).length,
            oaTotal: oaResults.length,
            tarrantCADUsed: tarrantCount,
            oldTotalSavings: totalOldSavings,
            newTotalSavings: totalNewSavings,
            delta: totalNewSavings - totalOldSavings,
            improvedCases: improvedCount
        }
    };

    const outputPath = `/Users/aquabot/Documents/OverAssessed/stephen-integratax/rerun-results-${dateStr}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nFull results saved to: ${outputPath}`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
