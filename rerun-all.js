#!/usr/bin/env node
/**
 * Re-run all OverAssessed cases and IntegraTax benchmark properties
 * through the live production comp engine with Tarrant CAD data.
 * 
 * Run: node rerun-all.js
 */

const jwt = require('./server/node_modules/jsonwebtoken');
const fs = require('fs');
const path = require('path');

const SERVER = 'https://disciplined-alignment-production.up.railway.app';
const JWT_SECRET = 'overassessed-ai-jwt-secret-2026-bexar-county-tax-appeals';

// Generate admin JWT
const TOKEN = jwt.sign({ id: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

// OA case IDs from production
const OA_CASES = [
  { caseId: 'OA-0001', id: '54a4cddd-8f7a-49d3-9e9a-93a242187280', address: '10243 Ellafalls' },
  { caseId: 'OA-0004', id: 'e3ea0018-12bb-4a90-870e-cd86fd9fa688', address: '12348 Tierra Buena Dr' },
  { caseId: 'OA-0003', id: '17113292-de0a-4f48-bac4-7a57c573f5a0', address: '2870 Rebecca Creek Rd' },
  { caseId: 'OA-0017', id: '51c7bde8-f4a4-421c-8800-2c2e940c6a18', address: '2754 Canvas Back Dr, Frisco, TX 75034' },
  { caseId: 'OA-0016', id: '154dc14f-9c3b-442b-9124-dd48e36abfaa', address: '2318 Andros pl' },
  { caseId: 'OA-0015', id: '388dde43-d055-4cbe-9666-a91cf706e81f', address: '902 Summit Rd' },
  { caseId: 'OA-0013', id: '4626b0cb-5337-48f8-be38-08e17da92c25', address: '708 Santa Lucia Dr Anna Texas 75409' },
  { caseId: 'OA-0011', id: '1d7776ba-d98f-4b3d-8287-9c114ffa8bc0', address: '5402 Lampasas St, Houston, TX' },
  { caseId: 'OA-0010', id: '547402c9-541f-42dc-8693-8aa56646f5b2', address: '3315 Marlene Meadow Way, Richmond, TX 77406' },
  { caseId: 'OA-0007', id: '5321ed10-c4f8-4d8d-b050-133f69c2ed9f', address: '18236 Crimson Apple Way, San Antonio, TX' },
];

// Load benchmark results
const benchmarkPath = path.join(__dirname, 'stephen-integratax', 'benchmark-results.json');
const oldBenchmarks = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await resp.text();
  try { return JSON.parse(text); }
  catch { return { error: text, status: resp.status }; }
}

async function rerunOACase(c) {
  console.log(`\n🔄 Re-running ${c.caseId}: ${c.address}`);
  try {
    const result = await fetchJSON(`${SERVER}/api/cases/${c.id}/analyze`, { method: 'POST' });
    if (result.error) {
      console.log(`  ❌ Error: ${result.error}`);
      return { caseId: c.caseId, address: c.address, error: result.error };
    }
    const savings = result.compResults?.estimatedSavings || result.estimatedSavings || 0;
    const recommended = result.compResults?.recommendedValue || 0;
    const reduction = result.compResults?.reduction || 0;
    const compsFound = result.compResults?.totalCompsFound || result.compResults?.comps?.length || 0;
    const strategy = result.compResults?.primaryStrategy || 'unknown';
    console.log(`  ✅ Recommended: $${recommended.toLocaleString()} | Reduction: $${reduction.toLocaleString()} | Savings: $${savings.toLocaleString()} | Strategy: ${strategy} | Comps: ${compsFound}`);
    return {
      caseId: c.caseId,
      address: c.address,
      recommended,
      reduction,
      savings,
      strategy,
      compsFound,
      fullResult: result
    };
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
    return { caseId: c.caseId, address: c.address, error: err.message };
  }
}

async function rerunBenchmark(bm) {
  console.log(`\n🔄 Re-running benchmark ${bm.caseId}: ${bm.address}`);
  try {
    // Use the analysis/run endpoint which takes an address
    const result = await fetchJSON(`${SERVER}/api/analysis/run`, {
      method: 'POST',
      body: JSON.stringify({ address: bm.address })
    });
    if (result.error) {
      console.log(`  ❌ Error: ${result.error}`);
      return { caseId: bm.caseId, address: bm.address, error: result.error };
    }
    console.log(`  ✅ Got result`);
    return {
      caseId: bm.caseId,
      address: bm.address,
      oldRecommended: bm.recommended,
      oldReduction: bm.reduction,
      oldSavings: bm.savings,
      oldComps: bm.comps,
      newResult: result
    };
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
    return { caseId: bm.caseId, address: bm.address, error: err.message };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  OverAssessed + IntegraTax Benchmark Re-Run');
  console.log('  Server:', SERVER);
  console.log('  Date:', new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════════');

  // Save pre-run state of OA cases
  console.log('\n📋 Fetching current OA case state...');
  const currentCases = await fetchJSON(`${SERVER}/api/submissions`);
  const preRunState = {};
  if (Array.isArray(currentCases)) {
    for (const c of currentCases) {
      preRunState[c.caseId] = {
        assessed: parseInt(String(c.assessedValue).replace(/[^0-9]/g, '')) || 0,
        recommended: c.analysisReport?.estimatedMarketValue || c.analysisReport?.equalUniformAnalysis?.recommendedValue || 0,
        reduction: c.analysisReport?.estimatedReduction || 0,
        savings: c.estimatedSavings || 0,
        strategy: c.analysisReport?.primaryStrategy || 'unknown',
        comps: c.compResults?.totalCompsFound || c.compResults?.comps?.length || 0
      };
    }
  }

  // ──────── Part 1: Re-run OA Cases ────────
  console.log('\n\n╔════════════════════════════════════════╗');
  console.log('║  PART 1: Re-running OA Cases (10)      ║');
  console.log('╚════════════════════════════════════════╝');

  const oaResults = [];
  for (const c of OA_CASES) {
    const result = await rerunOACase(c);
    oaResults.push(result);
    // Brief pause between cases
    await new Promise(r => setTimeout(r, 2000));
  }

  // ──────── Part 2: Re-run Benchmark Properties ────────
  console.log('\n\n╔════════════════════════════════════════╗');
  console.log('║  PART 2: Re-running Benchmarks (23)     ║');
  console.log('╚════════════════════════════════════════╝');

  const bmResults = [];
  for (const bm of oldBenchmarks) {
    const result = await rerunBenchmark(bm);
    bmResults.push(result);
    await new Promise(r => setTimeout(r, 2000));
  }

  // ──────── Save Results ────────
  const allResults = {
    runDate: new Date().toISOString(),
    server: SERVER,
    oaCases: oaResults.map(r => ({
      caseId: r.caseId,
      address: r.address,
      pre: preRunState[r.caseId] || null,
      post: r.error ? { error: r.error } : {
        recommended: r.recommended,
        reduction: r.reduction,
        savings: r.savings,
        strategy: r.strategy,
        compsFound: r.compsFound
      }
    })),
    benchmarks: bmResults.map(r => ({
      caseId: r.caseId,
      address: r.address,
      old: r.error ? null : {
        recommended: r.oldRecommended,
        reduction: r.oldReduction,
        savings: r.oldSavings,
        comps: r.oldComps
      },
      new: r.error ? { error: r.error } : r.newResult,
      error: r.error || null
    }))
  };

  const outPath = path.join(__dirname, 'stephen-integratax', 'rerun-results-20260319.json');
  fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
  console.log(`\n✅ Results saved to: ${outPath}`);

  // ──────── Print Comparison ────────
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  COMPARISON REPORT');
  console.log('═══════════════════════════════════════════════════════════════');

  console.log('\n--- OA Cases ---');
  console.log(String('Case').padEnd(10) + String('Address').padEnd(45) + String('Old Savings').padStart(12) + String('New Savings').padStart(12) + String('Change').padStart(10));
  console.log('-'.repeat(89));
  for (const r of allResults.oaCases) {
    const oldS = r.pre?.savings || 0;
    const newS = r.post?.savings || 0;
    const change = newS - oldS;
    const changeStr = change > 0 ? `+$${change}` : change < 0 ? `-$${Math.abs(change)}` : '$0';
    console.log(
      r.caseId.padEnd(10) +
      (r.address || '').substring(0, 43).padEnd(45) +
      `$${oldS.toLocaleString()}`.padStart(12) +
      `$${newS.toLocaleString()}`.padStart(12) +
      changeStr.padStart(10)
    );
  }

  console.log('\n--- Benchmark Properties ---');
  console.log(String('Case').padEnd(10) + String('Address').padEnd(45) + String('Old Red.').padStart(12) + String('New Red.').padStart(12) + String('Change').padStart(10));
  console.log('-'.repeat(89));
  for (const r of allResults.benchmarks) {
    const oldR = r.old?.reduction || 0;
    // The /api/analysis/run returns different structure; extract what we can
    const newR = r.new?.reduction || r.new?.compResults?.reduction || 0;
    const change = newR - oldR;
    const changeStr = change > 0 ? `+$${change}` : change < 0 ? `-$${Math.abs(change)}` : '$0';
    console.log(
      (r.caseId || '').padEnd(10) +
      (r.address || '').substring(0, 43).padEnd(45) +
      `$${oldR.toLocaleString()}`.padStart(12) +
      `$${newR.toLocaleString()}`.padStart(12) +
      changeStr.padStart(10)
    );
  }

  console.log('\n✅ Re-run complete!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
