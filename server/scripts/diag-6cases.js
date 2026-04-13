#!/usr/bin/env node
/**
 * Diagnostic: Compare April 7 (comp_results) vs April 10 (verified_analysis)
 * for 6 specific cases. Identify exact failure point.
 */
const { createClient } = require('@supabase/supabase-js');
const { getCountyData } = require('../services/local-parcel-data');
const { initAllCounties } = require('../services/local-parcel-data');

const SUPABASE_URL = 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TARGET_CASES = ['OA-0013','OA-0015','OA-0016','OA-0022','OA-0026','OA-0027'];

async function main() {
    console.log('Loading local parcel data...');
    await initAllCounties();
    console.log('Done.\n');

    // Also load tarrant explicitly
    const tarrantMod = require('../services/local-parcel-data');
    
    const { data: cases } = await supabase
        .from('submissions')
        .select('*')
        .in('case_id', TARGET_CASES)
        .is('deleted_at', null);

    for (const c of cases.sort((a,b) => a.case_id.localeCompare(b.case_id))) {
        const cid = c.case_id;
        const county = (c.county || '').toLowerCase().trim();
        const address = c.property_address || '';
        const assessedRaw = String(c.assessed_value || '0').replace(/[$,]/g, '');
        const assessedValue = parseInt(assessedRaw) || 0;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`CASE: ${cid} | ${c.owner_name}`);
        console.log(`  Address: ${address}`);
        console.log(`  County: ${county} | Assessed: $${assessedValue.toLocaleString()}`);
        console.log(`  SqFt: ${c.sqft || 'MISSING'} | YearBuilt: ${c.year_built || 'MISSING'} | Type: ${c.property_type || 'MISSING'}`);

        // April 7 data
        const apr7Comps = c.comp_results?.comps || [];
        const apr7Rec = c.comp_results?.recommendedValue;
        const apr7Status = c.comp_results?.status;
        const apr7Source = apr7Comps.length > 0 ? apr7Comps[0].source : 'none';
        console.log(`\n  [APR 7] Status: ${apr7Status || 'N/A'} | Comps: ${apr7Comps.length} | Rec: $${(apr7Rec||0).toLocaleString()} | Source: ${apr7Source}`);
        if (apr7Comps.length > 0) {
            console.log(`    Comp values (sale_price): ${apr7Comps.map(c => '$'+((c.sale_price||c.assessedValue||0).toLocaleString())).join(', ')}`);
        }

        // April 10 data
        const apr10 = c.verified_analysis || {};
        console.log(`  [APR 10] Status: ${apr10.status} | Comps: ${apr10.comp_count} | Rec: ${apr10.recommended_value ? '$'+apr10.recommended_value.toLocaleString() : '—'}`);
        console.log(`  [APR 10] Reason: ${apr10.reason || 'none'}`);

        // Now diagnose WHY apr10 failed
        console.log(`\n  --- DIAGNOSIS ---`);

        // Step 1: Does local data exist?
        const localData = getCountyData(county);
        const hasLocal = localData && localData.isLoaded();
        const recCount = hasLocal ? (localData.count ? localData.count() : Object.keys(localData.addressIndex || {}).length) : 0;
        console.log(`  1. Local data for ${county}: ${hasLocal ? 'YES ('+recCount+' records)' : 'NO'}`);

        if (!hasLocal && county !== 'tarrant') {
            console.log(`     → FIRST FAIL: no local dataset loaded`);
        }

        // Step 2: Can we find the subject property?
        if (hasLocal || county === 'tarrant') {
            let subjectResults = [];
            if (hasLocal) {
                subjectResults = localData.searchByAddress(address);
            }
            console.log(`  2. Subject property match (local): ${subjectResults.length > 0 ? 'YES' : 'NO'}`);
            if (subjectResults.length > 0) {
                const s = subjectResults[0];
                console.log(`     Subject CAD: value=$${(s.appraisedValue||s.totalValue||0).toLocaleString()} sqft=${s.sqft||'?'} year=${s.yearBuilt||'?'} type=${s.propertyType||'?'} nbhd=${s.neighborhoodCode||'?'}`);
            } else {
                console.log(`     → Subject address "${address}" NOT FOUND in local ${county} data`);
            }

            // Step 3: Try findComps with the subject (or fallback)
            const targetRecord = subjectResults[0] || { address, appraisedValue: assessedValue, sqft: c.sqft, yearBuilt: c.year_built };
            let rawComps = [];
            if (hasLocal) {
                rawComps = localData.findComps(targetRecord, { maxComps: 30, maxValueDiff: 0.30, sameType: true });
            }
            console.log(`  3. Raw comps from local findComps (30% band): ${rawComps.length}`);

            if (rawComps.length > 0) {
                // Check value distribution
                const compValues = rawComps.map(c => c.appraisedValue || c.totalValue || 0);
                console.log(`     Comp value range: $${Math.min(...compValues).toLocaleString()} - $${Math.max(...compValues).toLocaleString()}`);
                console.log(`     Subject assessed for value band: $${assessedValue.toLocaleString()}`);
                console.log(`     Value band (70-130%): $${Math.round(assessedValue*0.70).toLocaleString()} - $${Math.round(assessedValue*1.30).toLocaleString()}`);

                // Apply strict filter manually
                let passValue = 0, failValue = 0, passSqft = 0, failSqft = 0, passYear = 0, failYear = 0, passType = 0, failType = 0;
                for (const comp of rawComps) {
                    const cv = comp.appraisedValue || 0;
                    if (cv < assessedValue * 0.70 || cv > assessedValue * 1.30) { failValue++; continue; }
                    passValue++;
                    
                    if (c.sqft && comp.sqft) {
                        const diff = Math.abs(comp.sqft - c.sqft) / c.sqft;
                        if (diff > 0.25) { failSqft++; continue; }
                    }
                    passSqft++;
                    
                    if (c.year_built && comp.yearBuilt) {
                        const diff = Math.abs(comp.yearBuilt - c.year_built);
                        if (diff > 15) { failYear++; continue; }
                    }
                    passYear++;
                    passType++; // skip type check for now
                }
                console.log(`     After value gate: ${passValue} pass, ${failValue} fail`);
                console.log(`     After sqft gate: ${passSqft} pass, ${failSqft} fail`);
                console.log(`     After year gate: ${passYear} pass, ${failYear} fail`);
            }

            // For expanded (PASS 2)
            if (hasLocal) {
                const rawComps2 = localData.findComps(targetRecord, { maxComps: 80, maxValueDiff: 0.50, sameType: true });
                console.log(`  4. Raw comps from local findComps (50% band): ${rawComps2.length}`);
                if (rawComps2.length > 0) {
                    const compValues2 = rawComps2.map(c => c.appraisedValue || c.totalValue || 0);
                    console.log(`     Comp value range: $${Math.min(...compValues2).toLocaleString()} - $${Math.max(...compValues2).toLocaleString()}`);
                    
                    // Check what the strict filter does to these
                    let passCount = 0;
                    let failReasons = { value: 0, sqft: 0, year: 0, type: 0 };
                    for (const comp of rawComps2) {
                        const cv = comp.appraisedValue || 0;
                        if (cv < assessedValue * 0.70 || cv > assessedValue * 1.30) { failReasons.value++; continue; }
                        if (c.sqft && comp.sqft && Math.abs(comp.sqft - c.sqft)/c.sqft > 0.25) { failReasons.sqft++; continue; }
                        if (c.year_built && comp.yearBuilt && Math.abs(comp.yearBuilt - c.year_built) > 15) { failReasons.year++; continue; }
                        passCount++;
                    }
                    console.log(`     After strict filters: ${passCount} pass | value:${failReasons.value} sqft:${failReasons.sqft} year:${failReasons.year}`);
                }
            }
        }

        // April 7 comps were from RentCast API (sale_price), not CAD appraised value
        if (apr7Source === 'rentcast-api') {
            console.log(`\n  ⚠️  APR 7 SOURCE: RentCast API (sale_price-based comps)`);
            console.log(`     APR 10 SOURCE: Local CAD bulk (appraised_value-based comps)`);
            console.log(`     These are DIFFERENT datasets with DIFFERENT value types.`);
        }
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
