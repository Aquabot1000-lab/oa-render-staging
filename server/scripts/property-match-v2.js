#!/usr/bin/env node
/**
 * Property Match Validation v2 — handles tarrant-data, dallas, fort-bend normalization.
 */
const { createClient } = require('@supabase/supabase-js');
const { getCountyData, initAllCounties } = require('../services/local-parcel-data');
const tarrantData = require('../services/tarrant-data');

const SUPABASE_URL = 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function getDataForCounty(county) {
    // Try hyphenated version first (fort-bend, etc)
    const hyphenated = county.replace(/\s+/g, '-');
    let d = getCountyData(hyphenated);
    if (d && d.isLoaded()) return d;
    // Try original
    d = getCountyData(county);
    if (d && d.isLoaded()) return d;
    return null;
}

function classifyMatch(intakeAssessed, cadValue, intakeSqft, cadSqft, intakeYear, cadYear, cadType) {
    if (cadValue <= 0 || (cadType && /inprogress/i.test(cadType))) {
        return { bucket: 'IN_PROGRESS_CAD', confidence: 'N/A', issue: `CAD value=$${cadValue}, type=${cadType||'?'}` };
    }
    let issues = [];
    let score = 100;
    if (intakeAssessed > 0 && cadValue > 0) {
        const ratio = cadValue / intakeAssessed;
        if (ratio < 0.5 || ratio > 2.0) { issues.push(`value ratio ${ratio.toFixed(2)}x (intake $${intakeAssessed.toLocaleString()} vs CAD $${cadValue.toLocaleString()})`); score -= 50; }
        else if (ratio < 0.75 || ratio > 1.33) { issues.push(`value divergence ${Math.round(Math.abs(1-ratio)*100)}% (intake $${intakeAssessed.toLocaleString()} vs CAD $${cadValue.toLocaleString()})`); score -= 25; }
    }
    if (intakeSqft > 0 && cadSqft > 0) {
        const r = cadSqft / intakeSqft;
        if (r < 0.5 || r > 2.0) { issues.push(`sqft mismatch (intake ${intakeSqft} vs CAD ${cadSqft})`); score -= 40; }
        else if (r < 0.75 || r > 1.33) { issues.push(`sqft divergence (intake ${intakeSqft} vs CAD ${cadSqft})`); score -= 15; }
    }
    if (intakeYear > 0 && cadYear > 0) {
        const d = Math.abs(intakeYear - cadYear);
        if (d > 30) { issues.push(`year mismatch (intake ${intakeYear} vs CAD ${cadYear})`); score -= 40; }
        else if (d > 10) { issues.push(`year divergence (intake ${intakeYear} vs CAD ${cadYear})`); score -= 10; }
    }
    if (score >= 75) return { bucket: 'VERIFIED_MATCH', confidence: score >= 90 ? 'HIGH' : 'MEDIUM', issue: issues.join('; ') || 'none' };
    return { bucket: 'POSSIBLE_MISMATCH', confidence: 'LOW', issue: issues.join('; ') };
}

async function main() {
    console.log('Loading data...');
    await initAllCounties();
    // Load tarrant separately
    if (tarrantData.loadData) await tarrantData.loadData();
    console.log('Done.\n');

    const { data: cases } = await supabase
        .from('submissions')
        .select('*')
        .is('deleted_at', null)
        .order('case_id', { ascending: true });

    const targets = cases.filter(c => (c.case_id || '').startsWith('OA-'));
    const results = [];

    for (const c of targets) {
        const cid = c.case_id;
        const county = (c.county || '').toLowerCase().trim();
        const address = c.property_address || '';
        const intakeAssessedRaw = String(c.assessed_value || '0').replace(/[$,]/g, '');
        const intakeAssessed = parseInt(intakeAssessedRaw) || 0;
        const intakeSqft = c.sqft || 0;
        const intakeYear = c.year_built || 0;
        const signed = c.fee_agreement_signed || false;

        if (!county) {
            results.push({ cid, name: c.owner_name, county: '(none)', address, bucket: 'NO_COUNTY_DATA', confidence: 'N/A',
                intakeAssessed, cadValue: null, intakeSqft, cadSqft: null, intakeYear, cadYear: null,
                cadAddress: null, issue: 'No county specified', signed });
            continue;
        }

        // Try to find subject in data
        let subjectResult = null;
        let dataAvailable = false;

        // Try generic local-parcel-data first
        const localData = getDataForCounty(county);
        if (localData) {
            dataAvailable = true;
            const matches = localData.searchByAddress(address);
            if (matches.length > 0) subjectResult = matches[0];
        }

        // Try tarrant-data for tarrant county
        if (!subjectResult && county === 'tarrant' && tarrantData.isLoaded()) {
            dataAvailable = true;
            const streetOnly = address.replace(/,.*$/, '').replace(/\.[\s]*$/, '').trim();
            const matches = tarrantData.searchByAddress(streetOnly, 3);
            if (matches.length > 0) {
                subjectResult = {
                    address: matches[0].address,
                    appraisedValue: matches[0].totalValue || matches[0].appraisedValue || 0,
                    sqft: matches[0].sqft || 0,
                    yearBuilt: matches[0].yearBuilt || null,
                    propertyType: matches[0].propertyClassDesc || matches[0].propertyClass || '',
                    neighborhoodCode: null
                };
            }
        }

        if (!dataAvailable) {
            results.push({ cid, name: c.owner_name, county, address, bucket: 'NO_COUNTY_DATA', confidence: 'N/A',
                intakeAssessed, cadValue: null, intakeSqft, cadSqft: null, intakeYear, cadYear: null,
                cadAddress: null, issue: `No bulk data for ${county}`, signed });
            continue;
        }

        if (!subjectResult) {
            results.push({ cid, name: c.owner_name, county, address, bucket: 'NO_COUNTY_MATCH', confidence: 'N/A',
                intakeAssessed, cadValue: null, intakeSqft, cadSqft: null, intakeYear, cadYear: null,
                cadAddress: null, issue: `Address "${address}" not found in ${county} CAD`, signed });
            continue;
        }

        const cadValue = subjectResult.appraisedValue || subjectResult.totalValue || 0;
        const cadSqft = subjectResult.sqft || 0;
        const cadYear = subjectResult.yearBuilt ? parseInt(subjectResult.yearBuilt) : 0;
        const cadType = subjectResult.propertyType || '';
        const cadAddress = subjectResult.address || subjectResult.situs || '';

        const { bucket, confidence, issue } = classifyMatch(intakeAssessed, cadValue, intakeSqft, cadSqft, intakeYear, cadYear, cadType);
        results.push({ cid, name: c.owner_name, county, address, bucket, confidence,
            intakeAssessed, cadValue, intakeSqft, cadSqft: cadSqft || null, intakeYear, cadYear: cadYear || null,
            cadAddress, issue, signed });
    }

    // Priority 5
    const priority = ['OA-0015','OA-0016','OA-0027','OA-0013','OA-0022'];
    console.log('=== PRIORITY 5 CASES ===');
    for (const pid of priority) {
        const r = results.find(x => x.cid === pid);
        if (!r) { console.log(`${pid}: NOT FOUND`); continue; }
        console.log(`${r.cid} | ${r.bucket} | conf=${r.confidence}`);
        console.log(`  Intake: addr="${r.address}" val=$${(r.intakeAssessed||0).toLocaleString()} sqft=${r.intakeSqft||'?'} year=${r.intakeYear||'?'}`);
        console.log(`  CAD:    addr="${r.cadAddress||'N/A'}" val=$${(r.cadValue||0).toLocaleString()} sqft=${r.cadSqft||'?'} year=${r.cadYear||'?'}`);
        console.log(`  Issue: ${r.issue}`);
    }

    // All by bucket
    const bucketOrder = ['VERIFIED_MATCH','POSSIBLE_MISMATCH','IN_PROGRESS_CAD','NO_COUNTY_MATCH','NO_COUNTY_DATA'];
    console.log('\n=== ALL CASES BY BUCKET ===');
    for (const bucket of bucketOrder) {
        const group = results.filter(r => r.bucket === bucket);
        if (group.length === 0) continue;
        console.log(`\n--- ${bucket} (${group.length}) ---`);
        for (const r of group) {
            const s = r.signed ? ' [SIGNED]' : '';
            const val = r.cadValue != null ? `CAD $${r.cadValue.toLocaleString()} vs intake $${(r.intakeAssessed||0).toLocaleString()}` : '';
            console.log(`  ${r.cid} | ${(r.name||'').substring(0,28).padEnd(28)} | ${r.county.padEnd(12)} | ${val}${s}`);
            if (r.issue && r.issue !== 'none') console.log(`    → ${r.issue}`);
        }
    }

    // Counts
    console.log('\n=== BUCKET COUNTS ===');
    const counts = {};
    for (const r of results) counts[r.bucket] = (counts[r.bucket] || 0) + 1;
    for (const b of bucketOrder) { if (counts[b]) console.log(`  ${b}: ${counts[b]}`); }
    console.log(`  TOTAL: ${results.length}`);

    // Recommendations
    const safe = results.filter(r => r.bucket === 'VERIFIED_MATCH');
    const review = results.filter(r => ['POSSIBLE_MISMATCH','IN_PROGRESS_CAD','NO_COUNTY_MATCH'].includes(r.bucket));
    const blocked = results.filter(r => r.bucket === 'NO_COUNTY_DATA');
    console.log(`\n=== RECOMMENDATIONS ===`);
    console.log(`A. SAFE FOR RERUN (${safe.length}): ${safe.map(r=>r.cid).join(', ')}`);
    console.log(`B. NEEDS MANUAL REVIEW (${review.length}): ${review.map(r=>r.cid).join(', ')}`);
    console.log(`C. BLOCKED BY MISSING DATA (${blocked.length}): ${blocked.map(r=>r.cid).join(', ')}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
