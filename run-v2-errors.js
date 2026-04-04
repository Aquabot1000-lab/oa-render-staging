process.chdir('/Users/aquabot/Documents/OverAssessed/server');
require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
    process.env.SUPABASE_URL || 'https://ylxreuqvofgbpsatfsvr.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);
const { findComparables } = require('./server/services/comp-engine');

const ERROR_CASES = ['OA-0045','OA-0046','OA-0047','OA-0048','OA-0049','OA-0051','OA-0052','OA-0057'];

async function main() {
    for (const cid of ERROR_CASES) {
        const { data: rows } = await sb.from('submissions').select('*').eq('case_id', cid);
        if (!rows || !rows.length) { console.log(`${cid}: NOT FOUND`); continue; }
        const row = rows[0];
        let pd = row.property_data || {};
        if (typeof pd === 'string') pd = JSON.parse(pd);
        const subject = {
            address: row.property_address,
            assessedValue: pd.assessedValue || row.assessed_value || null,
            sqft: pd.sqft || row.sqft || null,
            yearBuilt: pd.yearBuilt || row.year_built || null,
            bedrooms: pd.bedrooms || row.bedrooms || null,
            bathrooms: pd.bathrooms || row.bathrooms || null,
            lotSize: pd.lotSize || null,
            landValue: pd.landValue || null,
            improvementValue: pd.improvementValue || null,
            propertyType: pd.propertyType || row.property_type || 'Single Family Home',
            legalDescription: pd.legalDescription || null,
            neighborhoodCode: pd.neighborhoodCode || null,
            source: pd.source || 'intake',
        };
        try {
            const result = await findComparables(subject, { county: row.county, state: row.state });
            await sb.from('submissions').update({
                comp_results: result,
                status: (row.status === 'Needs Data' || row.status === 'New Submission') ? 'Analysis Complete' : row.status,
                updated_at: new Date().toISOString()
            }).eq('case_id', cid);
            console.log(`${cid}: ✅ ${result.verificationTag} | ${(result.comps||[]).length} comps | savings $${(result.estimatedSavings||0).toLocaleString()}`);
        } catch (e) {
            console.log(`${cid}: ERROR — ${e.message}`);
        }
    }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
