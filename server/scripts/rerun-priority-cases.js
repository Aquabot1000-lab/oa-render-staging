#!/usr/bin/env node
/**
 * Priority re-run: Group A (signed) + Group B (results sent) + remaining insufficient
 * Focuses on data recovery with improved matching.
 */
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');
const { findVerifiedComps } = require('../services/verified-comp-engine');
const { getBISClient, isBISCounty } = require('../services/bis-client');
const fs = require('fs');
const path = require('path');

const supabase = createClient('https://ylxreuqvofgbpsatfsvr.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE');

const pool = new Pool({
    connectionString: 'postgresql://postgres:h1AVVY1oXH9kJcwz@db.ylxreuqvofgbpsatfsvr.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

// GROUP A: Signed clients
const GROUP_A = ['OA-0022', 'OA-0013', 'OA-0030'];
// GROUP B: Results sent
const GROUP_B = ['OA-0001', 'OA-0004', 'OA-0007', 'OA-0011', 'OA-0015', 'OA-0016', 'OA-0025', 'OA-0033'];
// Remaining insufficient from first run
const REMAINING = ['OA-0002', 'OA-0005', 'OA-0010', 'OA-0017', 'OA-0020', 'OA-0021', 'OA-0034', 'OA-0040'];

const ALL_PRIORITY = [...GROUP_A, ...GROUP_B, ...REMAINING];

function getCompSourceLink(county, parcelId) {
    const c = (county || '').toLowerCase();
    const links = {
        kaufman: pid => `https://esearch.kaufman-cad.org/Property/View?Id=${pid}&year=2026`,
        bexar: pid => `https://bexar.trueautomation.com/clientdb/Property.aspx?prop_id=${pid}`,
        collin: pid => `https://esearch.collincad.org/Property/View?Id=${pid}&year=2026`,
        travis: pid => `https://esearch.traviscad.org/Property/View?Id=${pid}&year=2026`,
        harris: pid => `https://hcad.org/property-search/real-property/real-property/?account=${pid}`,
        tarrant: pid => `https://www.tad.org/property/${pid}`,
        fulton: pid => `https://qpublic.schneidercorp.com/Application.aspx?App=FultonCountyGA&Layer=Parcels&PageType=Search&SearchVal=${pid}`,
        williamson: pid => `https://esearch.wcad.org/Property/View?Id=${pid}&year=2026`,
    };
    return links[c] ? links[c](parcelId) : `${county} CAD: ${parcelId}`;
}

async function runCase(caseId, caseData) {
    const county = (caseData.county || '').toLowerCase().trim();
    const address = caseData.property_address || '';
    const av = parseInt(String(caseData.assessed_value || '0').replace(/[$,]/g, '')) || 0;
    const group = GROUP_A.includes(caseId) ? 'A-SIGNED' : GROUP_B.includes(caseId) ? 'B-RESULTS_SENT' : 'C-PIPELINE';

    console.log(`\n${'='.repeat(70)}`);
    console.log(`${caseId} | ${caseData.owner_name} | ${county} | ${group}`);
    console.log(`  Address: "${address}" | AV: $${av.toLocaleString()}`);
    console.log(`${'='.repeat(70)}`);

    if (!address) return { caseId, status: 'NEEDS_SOURCE_DATA', reason: 'No address', group };

    const subject = {
        address,
        assessedValue: av || undefined,
        sqft: caseData.sqft ? parseInt(caseData.sqft) : null,
        yearBuilt: caseData.year_built ? parseInt(caseData.year_built) : null,
    };

    let result;
    try {
        result = await findVerifiedComps(subject, caseData);
    } catch (e) {
        console.error(`  ERROR: ${e.message}`);
        return { caseId, status: 'ERROR', reason: e.message, group };
    }

    // Get old data for comparison
    const oldReport = caseData.analysis_report;
    const oldSavings = oldReport?.estimatedTaxSavings || caseData.estimated_savings || null;

    const entry = {
        caseId,
        group,
        name: caseData.owner_name,
        county,
        address,
        assessedValue: av,
        status: result.status,
        dataSource: result.dataSource,
        subjectVerified: result.subjectVerified,
        subjectParcelId: result.subjectParcelId,
        newSavings: result.estimatedSavings,
        newReduction: result.reduction,
        newRecommended: result.recommendedValue,
        newCompsCount: result.comps?.length || 0,
        totalCompsFound: result.totalCompsFound,
        lowerComps: result.totalLowerComps,
        oldSavings,
        reason: result.reason,
        comps: result.comps || []
    };

    // Save to DB
    const compPids = (result.comps || []).map(c => c.parcelId || 'unknown');
    const compLinks = (result.comps || []).map(c => getCompSourceLink(county, c.parcelId || 'unknown'));

    try {
        // Delete old row if exists, insert new
        await pool.query('DELETE FROM analysis_verified_v1 WHERE case_id = $1', [caseId]);
        await pool.query(`
            INSERT INTO analysis_verified_v1 (
                case_id, verified_flag, status, data_source,
                subject_address, subject_county, subject_assessed_value,
                subject_parcel_id, subject_verified,
                recommended_value, reduction, estimated_savings, tax_rate,
                total_comps_found, total_lower_comps, evidence_comps_count,
                comp_parcel_ids, comp_source_links, comp_details,
                methodology, engine_version,
                old_savings, savings_change, reason, analysis_timestamp
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
        `, [
            caseId, result.status === 'VERIFIED', result.status, result.dataSource,
            address, county, av || null,
            result.subjectParcelId, result.subjectVerified || false,
            result.recommendedValue, result.reduction, result.estimatedSavings,
            result.taxRate,
            result.totalCompsFound || 0, result.totalLowerComps || 0,
            result.comps?.length || 0,
            compPids, compLinks, JSON.stringify((result.comps || []).map(c => ({
                parcelId: c.parcelId, address: c.address,
                assessedValue: c.assessedValue, score: c.score
            }))),
            result.methodology, result.engineVersion || '1.0.0-verified',
            oldSavings, (result.estimatedSavings != null && oldSavings != null) ? result.estimatedSavings - oldSavings : null,
            result.reason, result.analyzedAt || new Date().toISOString()
        ]);
    } catch(e) {
        console.error(`  DB ERROR: ${e.message}`);
    }

    if (result.status === 'VERIFIED') {
        const delta = oldSavings != null ? ` (was $${oldSavings}, Δ $${result.estimatedSavings - oldSavings})` : '';
        console.log(`  ✅ VERIFIED: ${result.comps.length} comps, savings $${result.estimatedSavings}/yr${delta}`);
        console.log(`  Subject PID: ${result.subjectParcelId}`);
        for (const c of result.comps.slice(0, 3)) {
            console.log(`    Comp: PID ${c.parcelId} | ${c.address} | $${c.assessedValue?.toLocaleString()}`);
        }
    } else {
        console.log(`  ❌ ${result.status}: ${result.reason}`);
    }

    return entry;
}

async function main() {
    console.log('=== PRIORITY RE-RUN: Group A + B + Insufficient ===\n');

    const results = { A: [], B: [], C: [] };

    for (const caseId of ALL_PRIORITY) {
        const { data } = await supabase.from('submissions').select('*').eq('case_id', caseId).single();
        if (!data) { console.log(`${caseId}: NOT FOUND`); continue; }

        const entry = await runCase(caseId, data);
        const groupKey = GROUP_A.includes(caseId) ? 'A' : GROUP_B.includes(caseId) ? 'B' : 'C';
        results[groupKey].push(entry);

        // Brief delay for BIS
        if (isBISCounty((data.county || '').toLowerCase())) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // Print summary
    console.log('\n\n' + '='.repeat(70));
    console.log('=== PRIORITY RE-RUN SUMMARY ===');
    console.log('='.repeat(70));

    for (const [group, label] of [['A', 'GROUP A — SIGNED CLIENTS'], ['B', 'GROUP B — RESULTS SENT'], ['C', 'GROUP C — REMAINING PIPELINE']]) {
        console.log(`\n--- ${label} ---`);
        for (const r of results[group]) {
            const statusIcon = r.status === 'VERIFIED' ? '✅' : '❌';
            const savings = r.newSavings != null ? `$${r.newSavings}/yr` : 'N/A';
            const delta = (r.newSavings != null && r.oldSavings != null) ? ` (was $${r.oldSavings})` : '';
            console.log(`${statusIcon} ${r.caseId} | ${(r.name || '').substring(0, 25).padEnd(25)} | ${(r.county || '').padEnd(12)} | ${r.status.padEnd(20)} | ${savings}${delta}`);
            if (r.status !== 'VERIFIED' && r.reason) {
                console.log(`   → ${r.reason.substring(0, 100)}`);
            }
        }
    }

    // Save summary
    const outputDir = '/Users/aquabot/Documents/OverAssessed/evidence-export/verified-rerun';
    fs.writeFileSync(path.join(outputDir, 'PRIORITY_RERUN_SUMMARY.json'), JSON.stringify(results, null, 2));

    await pool.end();
    console.log('\nDone.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
