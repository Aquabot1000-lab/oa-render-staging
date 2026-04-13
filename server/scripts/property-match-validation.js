#!/usr/bin/env node
/**
 * Property Match Validation — all 35 cases.
 * Compares intake data vs CAD data to classify match quality.
 */
const { createClient } = require('@supabase/supabase-js');
const { getCountyData, initAllCounties } = require('../services/local-parcel-data');

const SUPABASE_URL = 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const LOCAL_COUNTIES = new Set(['bexar','harris','tarrant','dallas','collin','fort bend','fulton','king','pierce','williamson','snohomish']);

function classifyMatch(intakeAssessed, cadValue, intakeSqft, cadSqft, intakeYear, cadYear, cadType) {
    // InProgress / $0 CAD
    if (cadValue <= 0 || (cadType && /inprogress/i.test(cadType))) {
        return { bucket: 'IN_PROGRESS_CAD', confidence: 'N/A', issue: `CAD value=$${cadValue}, type=${cadType||'?'}` };
    }

    let issues = [];
    let score = 100;

    // Value comparison
    if (intakeAssessed > 0 && cadValue > 0) {
        const ratio = cadValue / intakeAssessed;
        if (ratio < 0.5 || ratio > 2.0) {
            issues.push(`value ratio ${ratio.toFixed(2)}x (intake $${intakeAssessed.toLocaleString()} vs CAD $${cadValue.toLocaleString()})`);
            score -= 50;
        } else if (ratio < 0.75 || ratio > 1.33) {
            issues.push(`value divergence ${((1-ratio)*100).toFixed(0)}% (intake $${intakeAssessed.toLocaleString()} vs CAD $${cadValue.toLocaleString()})`);
            score -= 25;
        }
    }

    // Sqft comparison
    if (intakeSqft > 0 && cadSqft > 0) {
        const sqftRatio = cadSqft / intakeSqft;
        if (sqftRatio < 0.5 || sqftRatio > 2.0) {
            issues.push(`sqft mismatch (intake ${intakeSqft} vs CAD ${cadSqft})`);
            score -= 40;
        } else if (sqftRatio < 0.75 || sqftRatio > 1.33) {
            issues.push(`sqft divergence (intake ${intakeSqft} vs CAD ${cadSqft})`);
            score -= 15;
        }
    }

    // Year comparison
    if (intakeYear > 0 && cadYear > 0) {
        const yearDiff = Math.abs(intakeYear - cadYear);
        if (yearDiff > 30) {
            issues.push(`year mismatch (intake ${intakeYear} vs CAD ${cadYear})`);
            score -= 40;
        } else if (yearDiff > 10) {
            issues.push(`year divergence (intake ${intakeYear} vs CAD ${cadYear})`);
            score -= 10;
        }
    }

    if (score >= 75) {
        return { bucket: 'VERIFIED_MATCH', confidence: score >= 90 ? 'HIGH' : 'MEDIUM', issue: issues.join('; ') || 'none' };
    } else {
        return { bucket: 'POSSIBLE_MISMATCH', confidence: 'LOW', issue: issues.join('; ') };
    }
}

async function main() {
    console.log('Loading local parcel data...');
    await initAllCounties();
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

        // No county data available
        if (!county) {
            results.push({ cid, name: c.owner_name, county: '(none)', address, bucket: 'NO_COUNTY_DATA', confidence: 'N/A',
                intakeAssessed, cadValue: null, intakeSqft, cadSqft: null, intakeYear, cadYear: null,
                cadAddress: null, issue: 'No county specified', signed });
            continue;
        }

        const hasLocal = LOCAL_COUNTIES.has(county);
        if (!hasLocal) {
            // Check if we have any data at all
            const localData = getCountyData(county);
            if (!localData || !localData.isLoaded()) {
                results.push({ cid, name: c.owner_name, county, address, bucket: 'NO_COUNTY_DATA', confidence: 'N/A',
                    intakeAssessed, cadValue: null, intakeSqft, cadSqft: null, intakeYear, cadYear: null,
                    cadAddress: null, issue: `No bulk data for ${county}`, signed });
                continue;
            }
        }

        const localData = getCountyData(county);
        if (!localData || !localData.isLoaded()) {
            results.push({ cid, name: c.owner_name, county, address, bucket: 'NO_COUNTY_DATA', confidence: 'N/A',
                intakeAssessed, cadValue: null, intakeSqft, cadSqft: null, intakeYear, cadYear: null,
                cadAddress: null, issue: `${county} data not loaded`, signed });
            continue;
        }

        const subjectResults = localData.searchByAddress(address);
        if (subjectResults.length === 0) {
            results.push({ cid, name: c.owner_name, county, address, bucket: 'NO_COUNTY_MATCH', confidence: 'N/A',
                intakeAssessed, cadValue: null, intakeSqft, cadSqft: null, intakeYear, cadYear: null,
                cadAddress: null, issue: `Address "${address}" not found in ${county} CAD`, signed });
            continue;
        }

        const s = subjectResults[0];
        const cadValue = s.appraisedValue || s.totalValue || 0;
        const cadSqft = s.sqft || 0;
        const cadYear = s.yearBuilt ? parseInt(s.yearBuilt) : 0;
        const cadType = s.propertyType || '';
        const cadAddress = s.address || s.situs || '';

        const { bucket, confidence, issue } = classifyMatch(intakeAssessed, cadValue, intakeSqft, cadSqft, intakeYear, cadYear, cadType);

        results.push({ cid, name: c.owner_name, county, address, bucket, confidence,
            intakeAssessed, cadValue, intakeSqft, cadSqft: cadSqft || null, intakeYear, cadYear: cadYear || null,
            cadAddress, issue, signed });
    }

    // Print priority cases first
    const priority = ['OA-0015','OA-0016','OA-0027','OA-0013','OA-0022'];
    console.log('=== PRIORITY 5 CASES ===');
    console.log('Case     | Intake Address                          | CAD Address                             | Intake Sqft/Year | CAD Sqft/Year | Same? | Confidence | Issue');
    console.log('-'.repeat(180));
    for (const pid of priority) {
        const r = results.find(x => x.cid === pid);
        if (!r) continue;
        const iAddr = (r.address || '').substring(0, 40).padEnd(40);
        const cAddr = (r.cadAddress || 'N/A').substring(0, 40).padEnd(40);
        const iSY = `${r.intakeSqft||'?'}/${r.intakeYear||'?'}`.padEnd(17);
        const cSY = `${r.cadSqft||'?'}/${r.cadYear||'?'}`.padEnd(14);
        const same = r.bucket === 'VERIFIED_MATCH' ? 'YES' : r.bucket === 'POSSIBLE_MISMATCH' ? 'MAYBE' : 'N/A';
        console.log(`${r.cid.padEnd(9)}| ${iAddr}| ${cAddr}| ${iSY}| ${cSY}| ${same.padEnd(6)}| ${(r.confidence||'').padEnd(11)}| ${r.issue}`);
    }

    // Print all 35
    console.log('\n=== ALL CASES BY BUCKET ===');
    const bucketOrder = ['VERIFIED_MATCH','POSSIBLE_MISMATCH','IN_PROGRESS_CAD','NO_COUNTY_MATCH','NO_COUNTY_DATA'];
    for (const bucket of bucketOrder) {
        const group = results.filter(r => r.bucket === bucket);
        if (group.length === 0) continue;
        console.log(`\n--- ${bucket} (${group.length}) ---`);
        for (const r of group) {
            const signedStr = r.signed ? ' [SIGNED]' : '';
            const valStr = r.cadValue != null ? `CAD $${r.cadValue.toLocaleString()} vs intake $${r.intakeAssessed.toLocaleString()}` : '';
            console.log(`  ${r.cid} | ${(r.name||'').substring(0,25).padEnd(25)} | ${r.county.padEnd(12)} | ${valStr} | ${r.issue}${signedStr}`);
        }
    }

    // Counts
    console.log('\n=== BUCKET COUNTS ===');
    const counts = {};
    for (const r of results) counts[r.bucket] = (counts[r.bucket] || 0) + 1;
    for (const b of bucketOrder) {
        if (counts[b]) console.log(`  ${b}: ${counts[b]}`);
    }
    console.log(`  TOTAL: ${results.length}`);

    // Recommendations
    const safe = results.filter(r => r.bucket === 'VERIFIED_MATCH').map(r => r.cid);
    const review = results.filter(r => r.bucket === 'POSSIBLE_MISMATCH' || r.bucket === 'IN_PROGRESS_CAD' || r.bucket === 'NO_COUNTY_MATCH').map(r => r.cid);
    const blocked = results.filter(r => r.bucket === 'NO_COUNTY_DATA').map(r => r.cid);
    console.log(`\n=== RECOMMENDATIONS ===`);
    console.log(`A. SAFE FOR RERUN (${safe.length}): ${safe.join(', ')}`);
    console.log(`B. NEEDS MANUAL REVIEW (${review.length}): ${review.join(', ')}`);
    console.log(`C. BLOCKED BY MISSING DATA (${blocked.length}): ${blocked.join(', ')}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
