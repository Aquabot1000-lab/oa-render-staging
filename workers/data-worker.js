/**
 * DATA WORKER — County imports, address validation, county resolution, sales ingest
 * 
 * Job types:
 *   - county_import: import county property data into county_properties
 *   - address_validate: validate + geocode a lead's address
 *   - county_resolve: detect county from address
 *   - sales_data_ingest: import sales records into county_sales
 */

const axios = require('axios');

const RENTCAST_KEY = process.env.RENTCAST_API_KEY || '3a0f6f09999b41cc9ef23aa9d5fbab57';

// ── ADDRESS VALIDATION ──────────────────────────────────

async function addressValidate(payload, supabase) {
    const { lead_id } = payload;
    if (!lead_id) throw new Error('lead_id required');

    const { data: lead } = await supabase
        .from('submissions')
        .select('id, case_id, owner_name, property_address, county, state')
        .eq('id', lead_id)
        .single();
    if (!lead) throw new Error(`Lead not found: ${lead_id}`);

    const addr = lead.property_address;
    if (!addr || addr.length < 5) throw new Error(`Invalid address: "${addr}"`);

    console.log(`[DATA:ADDR] ${lead.case_id} — validating "${addr}"`);

    // Use RentCast properties endpoint to validate + enrich
    const { data: props } = await axios.get('https://api.rentcast.io/v1/properties', {
        params: { address: addr },
        headers: { 'X-Api-Key': RENTCAST_KEY },
        timeout: 15000
    });

    if (!props || (Array.isArray(props) && props.length === 0)) {
        // Try with state appended
        const withState = `${addr}, ${lead.state || 'TX'}`;
        const { data: props2 } = await axios.get('https://api.rentcast.io/v1/properties', {
            params: { address: withState },
            headers: { 'X-Api-Key': RENTCAST_KEY },
            timeout: 15000
        });
        if (!props2 || (Array.isArray(props2) && props2.length === 0)) {
            throw new Error(`Address not found in RentCast: "${addr}"`);
        }
        return processPropertyResult(props2, lead, supabase);
    }

    return processPropertyResult(props, lead, supabase);
}

async function processPropertyResult(props, lead, supabase) {
    const p = Array.isArray(props) ? props[0] : props;

    const enriched = {
        property_address: p.formattedAddress || lead.property_address,
        county: p.county || lead.county,
        state: p.state || lead.state,
        sqft: p.squareFootage || null,
        bedrooms: p.bedrooms || null,
        bathrooms: p.bathrooms || null,
        year_built: p.yearBuilt || null,
        lot_size: p.lotSize || null,
        property_type: p.propertyType || null,
        latitude: p.latitude || null,
        longitude: p.longitude || null,
        address_validated: true,
        address_validated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    // Only update non-null fields
    const updates = {};
    for (const [k, v] of Object.entries(enriched)) {
        if (v !== null && v !== undefined) updates[k] = v;
    }

    await supabase.from('submissions').update(updates).eq('id', lead.id);

    console.log(`[DATA:ADDR] ${lead.case_id} — validated: ${p.formattedAddress || 'ok'} | ${p.county} ${p.state} | ${p.squareFootage}sf`);

    return {
        case_id: lead.case_id,
        validated_address: p.formattedAddress,
        county: p.county,
        state: p.state,
        sqft: p.squareFootage,
        year_built: p.yearBuilt,
        property_type: p.propertyType
    };
}

// ── COUNTY RESOLVE ──────────────────────────────────────

async function countyResolve(payload, supabase) {
    const { lead_id } = payload;
    if (!lead_id) throw new Error('lead_id required');

    const { data: lead } = await supabase
        .from('submissions')
        .select('id, case_id, owner_name, property_address, county, state')
        .eq('id', lead_id)
        .single();
    if (!lead) throw new Error(`Lead not found: ${lead_id}`);

    if (lead.county && lead.county !== 'UNKNOWN') {
        return { case_id: lead.case_id, county: lead.county, state: lead.state, already_resolved: true };
    }

    console.log(`[DATA:COUNTY] ${lead.case_id} — resolving county for "${lead.property_address}"`);

    // Use RentCast to get county
    const { data: props } = await axios.get('https://api.rentcast.io/v1/properties', {
        params: { address: `${lead.property_address}, ${lead.state || ''}`.trim() },
        headers: { 'X-Api-Key': RENTCAST_KEY },
        timeout: 15000
    });

    const p = Array.isArray(props) ? props[0] : props;
    if (!p?.county) throw new Error(`Could not resolve county for "${lead.property_address}"`);

    await supabase.from('submissions').update({
        county: p.county,
        state: p.state || lead.state,
        updated_at: new Date().toISOString()
    }).eq('id', lead.id);

    console.log(`[DATA:COUNTY] ${lead.case_id} — resolved: ${p.county}, ${p.state}`);

    return { case_id: lead.case_id, county: p.county, state: p.state };
}

// ── COUNTY IMPORT ───────────────────────────────────────

async function countyImport(payload, supabase) {
    const { state, county, source_url, file_path } = payload;
    if (!state || !county) throw new Error('state and county required');

    console.log(`[DATA:IMPORT] Starting county import: ${county}, ${state}`);

    // Check current count
    const { count: existing } = await supabase
        .from('county_properties')
        .select('id', { count: 'exact', head: true })
        .eq('state', state)
        .ilike('county', county);

    console.log(`[DATA:IMPORT] ${county}, ${state} — existing records: ${existing || 0}`);

    // For MVP, this job validates the import request and reports status
    // Actual bulk imports still require psql COPY (too large for API)
    return {
        county,
        state,
        existing_records: existing || 0,
        action: existing > 0 ? 'already_imported' : 'needs_manual_import',
        note: 'Bulk imports (>100K rows) require psql COPY. Queue this for manual execution.'
    };
}

// ── SALES DATA INGEST ───────────────────────────────────

async function salesDataIngest(payload, supabase) {
    const { state, county, source_url, file_path } = payload;
    if (!state || !county) throw new Error('state and county required');

    console.log(`[DATA:SALES] Starting sales ingest: ${county}, ${state}`);

    const { count: existing } = await supabase
        .from('county_sales')
        .select('id', { count: 'exact', head: true })
        .eq('state', state)
        .ilike('county', county);

    console.log(`[DATA:SALES] ${county}, ${state} — existing sales records: ${existing || 0}`);

    return {
        county,
        state,
        existing_sales: existing || 0,
        action: existing > 0 ? 'already_imported' : 'needs_manual_import',
        note: 'Bulk sales imports require psql COPY.'
    };
}

module.exports = {
    addressValidate,
    countyResolve,
    countyImport,
    salesDataIngest
};
