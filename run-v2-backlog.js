// Run V2 analysis on all active leads
process.chdir('/Users/aquabot/Documents/OverAssessed/server');
require('dotenv').config({ path: '.env' });

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
    process.env.SUPABASE_URL || 'https://ylxreuqvofgbpsatfsvr.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const { findComparables } = require('./server/services/comp-engine');

async function analyzeCase(row) {
    const caseId = row.case_id;
    if (row.status === 'Deleted' || row.status === 'Duplicate') {
        return { caseId, skip: true, reason: row.status };
    }

    try {
        let propertyData = row.property_data || {};
        if (typeof propertyData === 'string') propertyData = JSON.parse(propertyData);
        
        const subject = {
            address: row.property_address,
            assessedValue: propertyData.assessedValue || row.assessed_value || null,
            sqft: propertyData.sqft || row.sqft || null,
            yearBuilt: propertyData.yearBuilt || row.year_built || null,
            bedrooms: propertyData.bedrooms || row.bedrooms || null,
            bathrooms: propertyData.bathrooms || row.bathrooms || null,
            lotSize: propertyData.lotSize || null,
            landValue: propertyData.landValue || null,
            improvementValue: propertyData.improvementValue || null,
            propertyType: propertyData.propertyType || row.property_type || 'Single Family Home',
            legalDescription: propertyData.legalDescription || null,
            neighborhoodCode: propertyData.neighborhoodCode || null,
            source: propertyData.source || 'intake',
        };

        const caseData = {
            county: row.county,
            state: row.state,
            bedrooms: row.bedrooms,
            bathrooms: row.bathrooms,
            sqft: row.sqft,
            yearBuilt: row.year_built,
        };

        const result = await findComparables(subject, caseData);
        
        const update = {
            comp_results: result,
            updated_at: new Date().toISOString()
        };
        
        if (row.status === 'Needs Data' || row.status === 'New Submission') {
            update.status = 'Analysis Complete';
        }

        await sb.from('submissions').update(update).eq('case_id', caseId);
        
        return {
            caseId,
            tag: result.verificationTag || 'unknown',
            comps: (result.comps || []).length,
            savings: result.estimatedSavings || 0,
            conservative: result.conservativeValue || 0,
            aggressive: result.aggressiveValue || 0,
            assessed: result.currentAssessedValue || 0,
            strategy: result.primaryStrategy || '?'
        };
    } catch (err) {
        return { caseId, error: err.message };
    }
}

async function main() {
    console.log('Fetching all active leads...');
    const { data: rows, error } = await sb.from('submissions')
        .select('*')
        .not('status', 'in', '("Deleted","Duplicate")')
        .order('case_id');
    
    if (error) { console.error('DB error:', error); process.exit(1); }
    console.log(`Found ${rows.length} active leads. Running V2 analysis...\n`);
    
    const results = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        process.stdout.write(`[${i+1}/${rows.length}] ${row.case_id}... `);
        const r = await analyzeCase(row);
        if (r.skip) {
            console.log(`SKIP (${r.reason})`);
        } else if (r.error) {
            console.log(`ERROR: ${r.error}`);
        } else {
            console.log(`✅ ${r.tag} | ${r.comps} comps | savings $${(r.savings || 0).toLocaleString()} | strategy: ${r.strategy}`);
        }
        results.push(r);
    }

    const analyzed = results.filter(r => !r.skip && !r.error);
    const errors = results.filter(r => r.error);
    const verified = analyzed.filter(r => r.tag === 'verified');
    const preliminary = analyzed.filter(r => r.tag === 'preliminary');
    
    console.log('\n' + '='.repeat(80));
    console.log('BACKLOG ANALYSIS COMPLETE');
    console.log('='.repeat(80));
    console.log(`Total processed: ${analyzed.length}`);
    console.log(`Verified: ${verified.length}`);
    console.log(`Preliminary: ${preliminary.length}`);
    console.log(`Errors: ${errors.length}`);
    
    const top3 = analyzed
        .filter(r => r.savings > 0)
        .sort((a, b) => b.savings - a.savings)
        .slice(0, 3);
    
    console.log('\nTOP 3 SAVINGS OPPORTUNITIES:');
    for (const r of top3) {
        console.log(`  ${r.caseId} | $${(r.savings || 0).toLocaleString()}/yr | Tag: ${r.tag} | Strategy: ${r.strategy} | Target: $${(r.aggressive || 0).toLocaleString()}-$${(r.conservative || 0).toLocaleString()}`);
    }
    
    if (errors.length > 0) {
        console.log('\nERRORS:');
        for (const r of errors) {
            console.log(`  ${r.caseId}: ${r.error}`);
        }
    }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
