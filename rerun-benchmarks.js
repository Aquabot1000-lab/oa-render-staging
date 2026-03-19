#!/usr/bin/env node
/**
 * Re-run IntegraTax benchmark properties through the comp engine directly
 * using Tarrant CAD data. Also re-run the OA cases that failed/timed out.
 */

// Bootstrap the server environment
process.chdir('/Users/aquabot/Documents/OverAssessed/server');
process.env.NODE_ENV = 'production';

const path = require('path');
const fs = require('fs');

// Load comp engine and property data service
const { findComparables } = require('/Users/aquabot/Documents/OverAssessed/server/services/comp-engine');
const { fetchPropertyData } = require('/Users/aquabot/Documents/OverAssessed/server/services/property-data');
const tarrantData = require('/Users/aquabot/Documents/OverAssessed/server/services/tarrant-data');

// Load old benchmark results
const benchmarkPath = path.join(__dirname, 'stephen-integratax', 'benchmark-results.json');
const oldBenchmarks = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));

// Also load the previous rerun results to merge OA results
const prevRunPath = path.join(__dirname, 'stephen-integratax', 'rerun-results-20260319.json');
let prevRun = {};
try { prevRun = JSON.parse(fs.readFileSync(prevRunPath, 'utf8')); } catch {}

async function waitForTarrant() {
  // Explicitly trigger loading
  if (!tarrantData.isLoaded()) {
    console.log('Loading Tarrant data...');
    try {
      await tarrantData.loadData();
      if (!tarrantData.isLoaded()) {
        console.error('Tarrant data load completed but isLoaded() is still false!');
        loadError = 'Tarrant data load inconsistency';
        return false;
      }
      console.log('Tarrant data loaded successfully.');
      return true;
    } catch (err) {
      console.error('Error during Tarrant data loading:', err.message);
      loadError = err.message;
      return false;
    }
  }
  return true; // Already loaded
}

async function runBenchmark(bm) {
  console.log(`\n🔄 ${bm.caseId}: ${bm.address}`);
  try {
    // Build subject data - simulate what fetchPropertyData would return
    const subject = {
      address: bm.address,
      assessedValue: bm.assessed,
      propertyType: 'Single Family Home',
      source: 'benchmark-rerun'
    };

    // Build caseData
    const caseData = {
      caseId: bm.caseId,
      propertyAddress: bm.address,
      assessedValue: String(bm.assessed),
      county: 'Tarrant',
      propertyType: 'Single Family Home'
    };

    // Try fetchPropertyData first to get TAD enrichment
    let enrichedSubject;
    try {
      enrichedSubject = await fetchPropertyData(caseData);
    } catch (err) {
      console.log(`  ⚠️ fetchPropertyData failed (${err.message}), using basic subject`);
      enrichedSubject = subject;
    }

    // Run comp engine
    const result = await findComparables(enrichedSubject, caseData);
    
    const rec = result.recommendedValue || 0;
    const red = result.reduction || 0;
    const sav = result.estimatedSavings || 0;
    const strategy = result.primaryStrategy || 'unknown';
    const comps = result.totalCompsFound || result.comps?.length || 0;
    const usedRealData = result.comps?.some(c => c.accountId && !c.accountId.startsWith('R')) || false;
    
    console.log(`  ✅ Recommended: $${rec.toLocaleString()} | Reduction: $${red.toLocaleString()} | Savings: $${sav.toLocaleString()} | Strategy: ${strategy} | Comps: ${comps}`);
    
    return {
      caseId: bm.caseId,
      address: bm.address,
      assessed: bm.assessed,
      oldRecommended: bm.recommended,
      oldReduction: bm.reduction,
      oldSavings: bm.savings,
      oldComps: bm.comps,
      newRecommended: rec,
      newReduction: red,
      newSavings: sav,
      newStrategy: strategy,
      newComps: comps,
      newCompsDetail: result.comps?.slice(0, 5).map(c => ({
        address: c.address,
        accountId: c.accountId,
        assessed: c.assessedValue,
        sqft: c.sqft,
        yearBuilt: c.yearBuilt,
        psf: c.pricePerSqft
      })),
      euAnalysis: result.equalUniformAnalysis ? {
        recommended: result.equalUniformAnalysis.recommendedValue,
        medianPSF: result.equalUniformAnalysis.medianPSF,
        subjectPSF: result.equalUniformAnalysis.subjectPSF,
        compsUsed: result.equalUniformAnalysis.compsUsed
      } : null,
      marketAnalysis: result.marketValueAnalysis ? {
        recommended: result.marketValueAnalysis.recommendedValue,
        reduction: result.marketValueAnalysis.reduction
      } : null
    };
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
    return {
      caseId: bm.caseId,
      address: bm.address,
      assessed: bm.assessed,
      error: err.message
    };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  IntegraTax Benchmark Re-Run (Direct Comp Engine)');
  console.log('  Date:', new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════════');

  // Wait for Tarrant data
  const loaded = await waitForTarrant();
  if (!loaded) {
    console.error('❌ Tarrant data did not load!');
    process.exit(1);
  }
  const stats = tarrantData.getStats();
  console.log(`✅ Tarrant data loaded: ${stats.totalParcels?.toLocaleString() || 'unknown'} parcels`);

  // Run all 23 benchmarks
  const results = [];
  for (const bm of oldBenchmarks) {
    const result = await runBenchmark(bm);
    results.push(result);
    // Small pause
    await new Promise(r => setTimeout(r, 500));
  }

  // Build final output
  const output = {
    runDate: new Date().toISOString(),
    engine: 'direct-comp-engine',
    tarrantParcels: stats.totalParcels,
    oaCases: prevRun.oaCases || [],
    benchmarks: results
  };

  // Save
  const outPath = path.join(__dirname, 'stephen-integratax', 'rerun-results-20260319.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ Results saved to: ${outPath}`);

  // Print comparison table
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  BENCHMARK COMPARISON: Old (Synthetic) vs New (Real TAD)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(
    'Case'.padEnd(10) +
    'Address'.padEnd(40) +
    'Assessed'.padStart(12) +
    'Old Rec.'.padStart(12) +
    'New Rec.'.padStart(12) +
    'Old Sav'.padStart(10) +
    'New Sav'.padStart(10) +
    'Strategy'.padStart(10)
  );
  console.log('-'.repeat(106));

  let totalOldSav = 0, totalNewSav = 0, totalOldRed = 0, totalNewRed = 0;
  for (const r of results) {
    if (r.error) {
      console.log(r.caseId.padEnd(10) + r.address.substring(0, 38).padEnd(40) + '  ERROR: ' + r.error);
      continue;
    }
    totalOldSav += r.oldSavings || 0;
    totalNewSav += r.newSavings || 0;
    totalOldRed += r.oldReduction || 0;
    totalNewRed += r.newReduction || 0;
    console.log(
      r.caseId.padEnd(10) +
      r.address.substring(0, 38).padEnd(40) +
      `$${(r.assessed||0).toLocaleString()}`.padStart(12) +
      `$${(r.oldRecommended||0).toLocaleString()}`.padStart(12) +
      `$${(r.newRecommended||0).toLocaleString()}`.padStart(12) +
      `$${(r.oldSavings||0).toLocaleString()}`.padStart(10) +
      `$${(r.newSavings||0).toLocaleString()}`.padStart(10) +
      (r.newStrategy||'').padStart(10)
    );
  }

  console.log('-'.repeat(106));
  console.log(
    'TOTALS'.padEnd(50) +
    ''.padStart(12) +
    ''.padStart(12) +
    ''.padStart(12) +
    `$${totalOldSav.toLocaleString()}`.padStart(10) +
    `$${totalNewSav.toLocaleString()}`.padStart(10)
  );
  console.log(`\nTotal Old Reduction: $${totalOldRed.toLocaleString()}`);
  console.log(`Total New Reduction: $${totalNewRed.toLocaleString()}`);
  
  console.log('\n✅ Benchmark re-run complete!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
