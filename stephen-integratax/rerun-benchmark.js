#!/usr/bin/env node
/**
 * Create benchmark submissions on Railway, analyze them, and compare results.
 */

const jwt = require('/Users/aquabot/Documents/OverAssessed/server/node_modules/jsonwebtoken');
const fs = require('fs');

const BASE_URL = 'https://disciplined-alignment-production.up.railway.app';
const JWT_SECRET = 'overassessed-ai-jwt-secret-2026-bexar-county-tax-appeals';

const token = jwt.sign(
    { userId: 'admin', email: 'tyler@overassessed.ai', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '2h' }
);

const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
};

const oldResults = JSON.parse(fs.readFileSync(
    '/Users/aquabot/Documents/OverAssessed/stephen-integratax/benchmark-results.json', 'utf8'
));

const oldLookup = {};
for (const r of oldResults) oldLookup[r.caseId] = r;

async function fetchJSON(url, options = {}) {
    const resp = await fetch(url, { headers: authHeaders, ...options });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text.substring(0, 300)}`);
    }
    return resp.json();
}

async function main() {
    console.log('=== Benchmark Re-Analysis (Create + Analyze) ===\n');

    // Step 1: Create benchmark submissions via intake
    const createdIds = [];
    
    for (let i = 0; i < oldResults.length; i++) {
        const r = oldResults[i];
        console.log(`[${i + 1}/${oldResults.length}] Creating: ${r.address}...`);
        
        try {
            const resp = await fetch(`${BASE_URL}/api/intake`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    propertyAddress: r.address,
                    propertyType: 'Single Family Home',
                    ownerName: 'IntegraTax Benchmark',
                    phone: '8177320969',
                    email: 'sdunson@integratax.net',
                    assessedValue: String(r.assessed),
                    county: 'Tarrant',
                    source: 'benchmark-rerun',
                    notificationPref: 'none'
                })
            });
            
            const data = await resp.json();
            
            if (data.duplicate) {
                console.log(`  ⚠️  Duplicate: ${data.caseId}`);
                // Need to find the existing ID
                const subs = await fetchJSON(`${BASE_URL}/api/submissions`);
                const allSubs = Array.isArray(subs) ? subs : (subs.submissions || subs.data || []);
                const existing = allSubs.find(s => s.caseId === data.caseId);
                if (existing) {
                    createdIds.push({ origCaseId: r.caseId, newCaseId: data.caseId, id: existing.id, address: r.address, assessed: r.assessed });
                }
            } else if (data.caseId) {
                // Find the ID (intake returns caseId but maybe not the uuid)
                const subs = await fetchJSON(`${BASE_URL}/api/submissions`);
                const allSubs = Array.isArray(subs) ? subs : (subs.submissions || subs.data || []);
                const newSub = allSubs.find(s => s.caseId === data.caseId);
                if (newSub) {
                    createdIds.push({ origCaseId: r.caseId, newCaseId: data.caseId, id: newSub.id, address: r.address, assessed: r.assessed });
                    console.log(`  ✅ Created: ${data.caseId} (${newSub.id})`);
                } else {
                    console.log(`  ✅ Created: ${data.caseId} (ID lookup pending)`);
                    createdIds.push({ origCaseId: r.caseId, newCaseId: data.caseId, id: null, address: r.address, assessed: r.assessed });
                }
            } else {
                console.log(`  ❌ Unexpected response:`, JSON.stringify(data).substring(0, 200));
            }
        } catch (e) {
            console.log(`  ❌ Error: ${e.message}`);
        }
        
        // Small delay
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\nCreated/found ${createdIds.length} benchmark submissions`);

    // Step 2: Fetch all submissions to get IDs we might have missed
    console.log('\nRefreshing submission list...');
    const allSubsResp = await fetchJSON(`${BASE_URL}/api/submissions`);
    const allSubs = Array.isArray(allSubsResp) ? allSubsResp : (allSubsResp.submissions || allSubsResp.data || []);
    
    // Map caseIds to IDs
    const caseIdToSub = {};
    for (const s of allSubs) caseIdToSub[s.caseId] = s;
    
    // Fill in missing IDs
    for (const c of createdIds) {
        if (!c.id && caseIdToSub[c.newCaseId]) {
            c.id = caseIdToSub[c.newCaseId].id;
        }
    }

    // Step 3: Analyze each benchmark case
    console.log('\n--- Starting Benchmark Analysis ---\n');
    const results = [];
    
    for (let i = 0; i < createdIds.length; i++) {
        const c = createdIds[i];
        if (!c.id) {
            console.log(`[${i + 1}/${createdIds.length}] ${c.origCaseId}: SKIPPED (no ID)`);
            results.push({ ...c, success: false, error: 'No submission ID' });
            continue;
        }
        
        console.log(`[${i + 1}/${createdIds.length}] Analyzing ${c.newCaseId} (${c.origCaseId}): ${c.address}...`);
        
        try {
            const result = await fetchJSON(`${BASE_URL}/api/cases/${c.id}/analyze`, { method: 'POST' });
            const cr = result.compResults || result;
            
            results.push({
                ...c,
                success: true,
                newRecommended: cr.recommendedValue,
                newSavings: cr.estimatedSavings,
                dataSource: cr.dataSource,
                compsUsed: cr.marketValue?.compsUsed || cr.totalComps,
                primaryStrategy: cr.primaryStrategy,
                euRecommended: cr.equalUniformAnalysis?.recommendedValue,
                euMedianPSF: cr.equalUniformAnalysis?.medianPSF
            });
            
            console.log(`  ✅ Recommended: $${cr.recommendedValue?.toLocaleString() || 'N/A'} | Savings: $${cr.estimatedSavings?.toLocaleString() || 'N/A'} | Source: ${cr.dataSource || 'unknown'} | Strategy: ${cr.primaryStrategy || 'N/A'}`);
        } catch (e) {
            console.log(`  ❌ Error: ${e.message}`);
            results.push({ ...c, success: false, error: e.message });
        }
        
        // 3s delay between analyses to avoid timeouts
        await new Promise(r => setTimeout(r, 3000));
    }

    // Step 4: Also re-analyze the 10 OA client cases  
    console.log('\n--- Re-Analyzing OA Client Cases ---\n');
    const oaCases = allSubs.filter(s => s.caseId?.startsWith('OA-') && !s.deletedAt);
    const oaResults = [];
    
    for (let i = 0; i < oaCases.length; i++) {
        const sub = oaCases[i];
        console.log(`[${i + 1}/${oaCases.length}] Analyzing ${sub.caseId}: ${sub.propertyAddress}...`);
        
        // Capture pre-analysis state
        const preRecommended = sub.compResults?.recommendedValue;
        const preSavings = sub.estimatedSavings || sub.compResults?.estimatedSavings;
        const preSource = sub.compResults?.dataSource;
        
        try {
            const result = await fetchJSON(`${BASE_URL}/api/cases/${sub.id}/analyze`, { method: 'POST' });
            const cr = result.compResults || result;
            
            oaResults.push({
                caseId: sub.caseId,
                id: sub.id,
                address: sub.propertyAddress,
                county: sub.county,
                assessed: sub.assessedValue,
                oldRecommended: preRecommended,
                oldSavings: preSavings,
                oldSource: preSource,
                newRecommended: cr.recommendedValue,
                newSavings: cr.estimatedSavings,
                newSource: cr.dataSource,
                primaryStrategy: cr.primaryStrategy,
                success: true
            });
            
            console.log(`  ✅ Recommended: $${cr.recommendedValue?.toLocaleString() || 'N/A'} | Savings: $${cr.estimatedSavings?.toLocaleString() || 'N/A'} | Source: ${cr.dataSource || 'unknown'}`);
        } catch (e) {
            console.log(`  ❌ Error: ${e.message}`);
            oaResults.push({
                caseId: sub.caseId,
                id: sub.id,
                address: sub.propertyAddress,
                county: sub.county,
                success: false,
                error: e.message
            });
        }
        
        await new Promise(r => setTimeout(r, 3000));
    }

    // Step 5: Build comparison and save
    console.log('\n\n========== BENCHMARK COMPARISON ==========\n');
    
    let totalOldSavings = 0;
    let totalNewSavings = 0;
    let tarrantCount = 0;
    
    for (const r of results) {
        const old = oldLookup[r.origCaseId];
        if (!old) continue;
        
        const oldRec = old.recommended;
        const newRec = r.newRecommended;
        const usedTAD = r.dataSource === 'tarrant-cad';
        if (usedTAD) tarrantCount++;
        
        totalOldSavings += old.savings || 0;
        totalNewSavings += r.newSavings || 0;
        
        const oldRecStr = oldRec ? `$${oldRec.toLocaleString()}` : 'N/A';
        const newRecStr = newRec ? `$${newRec.toLocaleString()}` : 'N/A';
        const savDelta = (r.newSavings && old.savings) ? r.newSavings - old.savings : null;
        const deltaStr = savDelta !== null ? (savDelta >= 0 ? `+$${savDelta.toLocaleString()}` : `-$${Math.abs(savDelta).toLocaleString()}`) : 'N/A';
        const source = usedTAD ? '🟢 TAD' : (r.success ? '🔴 Syn' : '❌ Err');
        
        console.log(`${r.origCaseId} | ${r.address.substring(0, 35).padEnd(35)} | Assessed: $${old.assessed.toLocaleString().padStart(10)} | Old: ${oldRecStr.padStart(10)} → New: ${newRecStr.padStart(10)} | Δ Savings: ${deltaStr.padStart(8)} | ${source}`);
    }

    console.log('\n========== OA CLIENT CASES ==========\n');
    
    for (const r of oaResults) {
        const oldRecStr = r.oldRecommended ? `$${r.oldRecommended.toLocaleString()}` : 'N/A';
        const newRecStr = r.newRecommended ? `$${r.newRecommended.toLocaleString()}` : 'N/A';
        const source = r.newSource === 'tarrant-cad' ? '🟢 TAD' : (r.success ? '🔵 Syn' : '❌ Err');
        console.log(`${r.caseId} | ${(r.address || '').substring(0, 35).padEnd(35)} | ${r.county || 'Unknown'.padEnd(10)} | Old: ${oldRecStr.padStart(10)} → New: ${newRecStr.padStart(10)} | ${source}`);
    }

    console.log('\n========== SUMMARY ==========');
    console.log(`Benchmark: ${results.filter(r => r.success).length}/${results.length} successful`);
    console.log(`OA Cases: ${oaResults.filter(r => r.success).length}/${oaResults.length} successful`);
    console.log(`Tarrant CAD data used: ${tarrantCount} benchmark cases`);
    console.log(`Benchmark old total savings: $${totalOldSavings.toLocaleString()}`);
    console.log(`Benchmark new total savings: $${totalNewSavings.toLocaleString()}`);
    console.log(`Total delta: ${totalNewSavings >= totalOldSavings ? '+' : '-'}$${Math.abs(totalNewSavings - totalOldSavings).toLocaleString()}`);

    // Save everything
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const output = {
        runDate: new Date().toISOString(),
        server: BASE_URL,
        benchmarkResults: results,
        oaClientResults: oaResults,
        summary: {
            benchmarkSuccess: results.filter(r => r.success).length,
            benchmarkTotal: results.length,
            oaSuccess: oaResults.filter(r => r.success).length,
            oaTotal: oaResults.length,
            tarrantCADUsed: tarrantCount,
            oldTotalSavings: totalOldSavings,
            newTotalSavings: totalNewSavings,
            delta: totalNewSavings - totalOldSavings
        }
    };
    
    const outputPath = `/Users/aquabot/Documents/OverAssessed/stephen-integratax/rerun-results-${dateStr}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nResults saved to: ${outputPath}`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
