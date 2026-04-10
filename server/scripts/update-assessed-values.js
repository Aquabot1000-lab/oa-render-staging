#!/usr/bin/env node
/**
 * Update assessed values for 3 processable customers using verified county data
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
var { createClient } = require('@supabase/supabase-js');
var sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

var updates = [
    {
        name: 'Gabe Garcia',
        client_match: { column: 'name', value: 'Gabe Garcia' },
        address: '23150 Cutcliffe, San Antonio, TX 78255',
        county: 'bexar',
        parcel_id: '1338753',
        assessed_value: 1905000,
        land_value: 285780,
        improvement_value: 1619220,
        year_built: 2021,
        sqft: 4833,
        owner: 'GARCIA GABRIEL M & GARCIA PATRICIA',
        source: 'BCAD ArcGIS (live query 2026-04-08)',
        proposed_value: 1392000 // RentCast AVM already stored
    },
    {
        name: 'Marco Aparicio',
        client_match: { column: 'name', value: 'Marco Aparicio' },
        address: '6 Davenport Lane, San Antonio, TX 78257',
        county: 'bexar',
        parcel_id: '750172',
        assessed_value: 3234370,
        land_value: 1800800,
        improvement_value: 1433570,
        year_built: 1999,
        sqft: 5620,
        owner: 'APARICIO MARCO & CLAUDIA',
        source: 'BCAD ArcGIS (live query 2026-04-08)',
        proposed_value: 3390000 // RentCast AVM already stored
    },
    {
        name: 'Olakanmi Olaojo',
        client_match: { column: 'name', value: 'Olakanmi Olaojo' },
        address: '15019 Tuff Rd, Manor, TX 78653',
        county: 'travis',
        parcel_id: '247720941',
        assessed_value: 354954,
        land_value: 79625,
        improvement_value: 275329,
        year_built: 2020,
        sqft: 2484,
        owner: 'OLAOJO OLAKANMI',
        source: 'TCAD 2026 Preliminary (from client notes, verified via prior TCAD lookup)',
        proposed_value: 425000 // RentCast AVM already stored
    }
];

async function main() {
    for (var i = 0; i < updates.length; i++) {
        var u = updates[i];
        console.log('\n=== ' + u.name + ' ===');

        // Find client
        var clientResult = await sb.from('clients')
            .select('id, name')
            .eq(u.client_match.column, u.client_match.value)
            .single();

        if (clientResult.error || !clientResult.data) {
            console.log('CLIENT NOT FOUND:', u.client_match.value);
            continue;
        }
        var clientId = clientResult.data.id;
        console.log('Client ID:', clientId);

        // Update client county if missing
        await sb.from('clients').update({ county: u.county }).eq('id', clientId);

        // Find existing property or create one
        var propResult = await sb.from('properties')
            .select('id')
            .eq('client_id', clientId)
            .limit(1);

        var propertyId = null;

        var propertyData = {
            county_assessed: {
                value: u.assessed_value,
                land: u.land_value,
                improvement: u.improvement_value,
                parcel_id: u.parcel_id,
                year_built: u.year_built,
                sqft: u.sqft,
                owner: u.owner,
                source: u.source,
                retrieved_at: new Date().toISOString()
            }
        };

        var overAssessment = u.assessed_value - u.proposed_value;
        var taxRate = u.county === 'bexar' ? 0.0225 : (u.county === 'travis' ? 0.0210 : 0.0225);
        var taxSavings = overAssessment > 0 ? Math.round(overAssessment * taxRate) : 0;

        propertyData.filing_analysis = {
            over_assessment: overAssessment,
            over_assessment_pct: Math.round(overAssessment / u.assessed_value * 1000) / 10,
            estimated_tax_savings: taxSavings,
            tax_rate: taxRate,
            recommendation: overAssessment > 0 && (overAssessment / u.assessed_value) >= 0.10
                ? 'STRONG PROTEST' : (overAssessment > 0 ? 'MODERATE PROTEST' : 'WEAK'),
            calculated_at: new Date().toISOString()
        };

        if (propResult.data && propResult.data.length > 0) {
            propertyId = propResult.data[0].id;

            // Merge into existing property_data
            var existResult = await sb.from('properties').select('property_data').eq('id', propertyId).single();
            var existingPD = (existResult.data && existResult.data.property_data) || {};
            existingPD.county_assessed = propertyData.county_assessed;
            existingPD.filing_analysis = propertyData.filing_analysis;

            var upResult = await sb.from('properties').update({
                current_assessed_value: u.assessed_value,
                proposed_value: u.proposed_value,
                property_id_county: u.parcel_id,
                county: u.county,
                property_data: existingPD
            }).eq('id', propertyId);

            if (upResult.error) {
                console.log('UPDATE ERROR:', upResult.error.message);
            } else {
                console.log('UPDATED property:', propertyId);
            }
        } else {
            // Insert new property
            var insResult = await sb.from('properties').insert({
                client_id: clientId,
                address: u.address,
                county: u.county,
                state: u.county === 'travis' ? 'TX' : 'TX',
                property_type: 'Single Family',
                year: 2026,
                current_assessed_value: u.assessed_value,
                proposed_value: u.proposed_value,
                property_id_county: u.parcel_id,
                property_data: propertyData,
                comp_results: {}
            }).select('id').single();

            if (insResult.error) {
                console.log('INSERT ERROR:', insResult.error.message);
            } else {
                propertyId = insResult.data.id;
                console.log('INSERTED property:', propertyId);
            }
        }

        // Verify
        if (propertyId) {
            var verify = await sb.from('properties')
                .select('id, address, county, current_assessed_value, proposed_value, property_id_county')
                .eq('id', propertyId)
                .single();

            if (verify.data) {
                var v = verify.data;
                var oa = v.current_assessed_value - v.proposed_value;
                console.log('VERIFIED:');
                console.log('  Address:', v.address);
                console.log('  County:', v.county);
                console.log('  Parcel ID:', v.property_id_county);
                console.log('  Assessed:', '$' + v.current_assessed_value.toLocaleString());
                console.log('  Proposed:', '$' + v.proposed_value.toLocaleString());
                console.log('  Over-assessment:', '$' + oa.toLocaleString());
                console.log('  Tax savings:', '$' + taxSavings.toLocaleString() + '/yr');
                console.log('  Filing status:', overAssessment > 0 ? 'READY' : 'NOT READY');
            }
        }
    }

    console.log('\n\n=== BLOCKED CUSTOMERS (NO ADDRESS) ===');
    console.log('Archie Myers — missing: property_address');
    console.log('Juan Villarreal — missing: property_address');
    console.log('PaTonya — missing: property_address, phone, last name');
}

main().catch(function(err) { console.error('FATAL:', err); process.exit(1); });
