#!/usr/bin/env node
/**
 * Single Property Pipeline
 * 1. Pull 1 real property from Supabase
 * 2. Fetch comps via RentCast
 * 3. Store results back in Supabase
 * 4. Output structured JSON
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const RENTCAST_BASE = 'https://api.rentcast.io/v1';
const RENTCAST_KEY = process.env.RENTCAST_API_KEY;
const ARCGIS_BASE = 'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query';

async function main() {
    console.log('=== STEP 1: PULL PROPERTY FROM SUPABASE ===');

    const { data: props, error: propErr } = await sb
        .from('properties')
        .select('*')
        .not('county', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

    if (propErr) { console.error('DB ERROR:', propErr.message); process.exit(1); }
    if (!props || props.length === 0) { console.error('NO PROPERTIES FOUND'); process.exit(1); }

    const prop = props[0];
    console.log('INPUT RECORD:');
    console.log(JSON.stringify({
        id: prop.id,
        address: prop.address,
        county: prop.county,
        current_assessed_value: prop.current_assessed_value,
        proposed_value: prop.proposed_value,
        property_id_county: prop.property_id_county
    }, null, 2));

    // ── STEP 2: FETCH COMPS VIA RENTCAST ──
    console.log('\n=== STEP 2: FETCH COMPS FROM RENTCAST ===');

    let avmData = null;
    let propertyData = null;

    try {
        const avmRes = await axios.get(RENTCAST_BASE + '/avm/value', {
            params: { address: prop.address },
            headers: { 'Accept': 'application/json', 'X-Api-Key': RENTCAST_KEY },
            timeout: 15000
        });
        avmData = avmRes.data;
        console.log('AVM Response:', JSON.stringify({
            marketValue: avmData.price || avmData.priceRangeLow,
            marketLow: avmData.priceRangeLow,
            marketHigh: avmData.priceRangeHigh,
            compCount: (avmData.comparables || []).length
        }));
    } catch (err) {
        console.error('AVM FETCH ERROR:', err.response ? err.response.status + ' ' + JSON.stringify(err.response.data) : err.message);
    }

    try {
        const propRes = await axios.get(RENTCAST_BASE + '/properties', {
            params: { address: prop.address },
            headers: { 'Accept': 'application/json', 'X-Api-Key': RENTCAST_KEY },
            timeout: 15000
        });
        const raw = propRes.data;
        propertyData = Array.isArray(raw) ? raw[0] || null : raw;
        if (propertyData) {
            console.log('Property Details:', JSON.stringify({
                sqft: propertyData.squareFootage,
                yearBuilt: propertyData.yearBuilt,
                bedrooms: propertyData.bedrooms,
                bathrooms: propertyData.bathrooms,
                propertyType: propertyData.propertyType
            }));
        }
    } catch (err) {
        console.error('PROPERTY FETCH ERROR:', err.response ? err.response.status : err.message);
    }

    // Fetch BCAD assessed value if Bexar
    let bcadData = null;
    if ((prop.county || '').toLowerCase() === 'bexar') {
        console.log('\nFetching BCAD ArcGIS data...');
        try {
            const clean = prop.address
                .replace(/,?\s*(helotes|san antonio|sa|tx|texas|\d{5}(-\d{4})?)/gi, '')
                .trim()
                .toUpperCase();
            const arcRes = await axios.get(ARCGIS_BASE, {
                params: {
                    where: "Situs LIKE '%" + clean.replace(/'/g, "''") + "%'",
                    outFields: 'PropID,Situs,TotVal,LandVal,ImprVal,YrBlt,GBA',
                    returnGeometry: false,
                    f: 'json'
                },
                timeout: 15000
            });
            if (arcRes.data.features && arcRes.data.features.length > 0) {
                bcadData = arcRes.data.features[0].attributes;
                console.log('BCAD Data:', JSON.stringify(bcadData));
            } else {
                console.log('BCAD: No match found');
            }
        } catch (err) {
            console.error('BCAD ERROR:', err.message);
        }
    }

    // Build comps array
    const comps = (avmData && avmData.comparables ? avmData.comparables : []).map(function(c) {
        return {
            address: c.formattedAddress || c.address || 'N/A',
            price: c.price || c.lastSalePrice || null,
            sqft: c.squareFootage || null,
            yearBuilt: c.yearBuilt || null,
            bedrooms: c.bedrooms || null,
            bathrooms: c.bathrooms || null,
            lotSize: c.lotSize || null,
            lastSaleDate: c.lastSaleDate || null,
            correlation: c.correlation || c.score || null,
            distance: c.distance || null,
            propertyType: c.propertyType || null
        };
    });

    console.log('\nCOMPS RETRIEVED:', comps.length);
    comps.slice(0, 5).forEach(function(c, i) {
        console.log('  Comp ' + (i + 1) + ': ' + c.address + ' | $' + c.price + ' | ' + c.sqft + 'sqft | ' + c.yearBuilt + ' | ' + c.distance + 'mi | corr:' + c.correlation);
    });

    // ── STEP 3: STORE RESULTS IN SUPABASE ──
    console.log('\n=== STEP 3: STORE IN SUPABASE ===');

    const marketValue = avmData ? (avmData.price || avmData.priceRangeLow || null) : null;
    const assessedValue = bcadData ? bcadData.TotVal : prop.current_assessed_value;

    const updatedPropertyData = {
        rentcast_avm: {
            marketValue: marketValue,
            marketLow: avmData ? avmData.priceRangeLow : null,
            marketHigh: avmData ? avmData.priceRangeHigh : null,
            squareFootage: propertyData ? propertyData.squareFootage : null,
            yearBuilt: propertyData ? propertyData.yearBuilt : null,
            bedrooms: propertyData ? propertyData.bedrooms : null,
            bathrooms: propertyData ? propertyData.bathrooms : null,
            propertyType: propertyData ? propertyData.propertyType : null
        },
        county_parcel: bcadData ? {
            propId: bcadData.PropID,
            assessedValue: bcadData.TotVal,
            landValue: bcadData.LandVal,
            improvementValue: bcadData.ImprVal,
            yearBuilt: bcadData.YrBlt,
            sqft: bcadData.GBA
        } : null,
        fetched_at: new Date().toISOString()
    };

    const updatedCompResults = {
        comparables: comps,
        comp_count: comps.length,
        fetched_at: new Date().toISOString()
    };

    const updateObj = {
        property_data: updatedPropertyData,
        comp_results: updatedCompResults,
        proposed_value: marketValue,
        current_assessed_value: assessedValue || prop.current_assessed_value
    };

    if (bcadData && bcadData.PropID) {
        updateObj.property_id_county = String(bcadData.PropID);
    }

    const { error: updateErr } = await sb
        .from('properties')
        .update(updateObj)
        .eq('id', prop.id);

    if (updateErr) {
        console.error('DB UPDATE ERROR:', updateErr.message);
        process.exit(1);
    }
    console.log('DB UPDATE: SUCCESS');

    // ── STEP 4: VERIFY AND OUTPUT JSON ──
    console.log('\n=== STEP 4: VERIFY FROM DATABASE ===');

    const { data: verified, error: verErr } = await sb
        .from('properties')
        .select('*')
        .eq('id', prop.id)
        .single();

    if (verErr) { console.error('VERIFY ERROR:', verErr.message); process.exit(1); }

    const overAssessment = (verified.current_assessed_value && verified.proposed_value)
        ? verified.current_assessed_value - verified.proposed_value
        : null;
    const taxSavings = overAssessment && overAssessment > 0 ? Math.round(overAssessment * 0.0225) : 0;

    const output = {
        pipeline_status: 'SUCCESS',
        timestamp: new Date().toISOString(),
        subject_property: {
            id: verified.id,
            address: verified.address,
            county: verified.county,
            parcel_id: verified.property_id_county,
            assessed_value: verified.current_assessed_value,
            proposed_value: verified.proposed_value,
            over_assessment: overAssessment,
            estimated_tax_savings: taxSavings
        },
        comps: verified.comp_results.comparables.slice(0, 10).map(function(c, i) {
            return {
                rank: i + 1,
                address: c.address,
                price: c.price,
                sqft: c.sqft,
                year_built: c.yearBuilt,
                distance_mi: c.distance,
                correlation: c.correlation,
                property_type: c.propertyType
            };
        }),
        comp_count: verified.comp_results.comp_count,
        data_sources: {
            avm: 'RentCast API',
            county: bcadData ? 'BCAD ArcGIS' : 'none',
            fetched_at: verified.property_data.fetched_at
        },
        property_data_stored: JSON.stringify(verified.property_data) !== '{}',
        comp_results_stored: JSON.stringify(verified.comp_results) !== '{}'
    };

    console.log('\n=== FINAL OUTPUT (STRUCTURED JSON) ===');
    console.log(JSON.stringify(output, null, 2));
}

main().catch(function(err) {
    console.error('PIPELINE FATAL ERROR:', err);
    process.exit(1);
});
