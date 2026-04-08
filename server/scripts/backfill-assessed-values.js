#!/usr/bin/env node
/**
 * Backfill assessed values for all properties using:
 * 1. Bexar ArcGIS API (address match)
 * 2. Bulk county data already loaded on Railway server
 * 3. RentCast property data (fallback)
 * 
 * Also calculates estimated_savings = assessed - proposed
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ARCGIS_BASE = 'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query';

// Query Bexar County ArcGIS for assessed value
async function getBexarAssessed(address) {
    try {
        const clean = address
            .replace(/,?\s*(helotes|san antonio|sa|tx|texas|\d{5}(-\d{4})?)/gi, '')
            .trim()
            .toUpperCase();

        const { data } = await axios.get(ARCGIS_BASE, {
            params: {
                where: "Situs LIKE '%" + clean.replace(/'/g, "''") + "%'",
                outFields: 'PropID,Situs,TotVal,LandVal,ImprVal,YrBlt,GBA',
                returnGeometry: false,
                f: 'json'
            },
            timeout: 15000
        });

        if (data.features && data.features.length > 0) {
            const a = data.features[0].attributes;
            return {
                parcelId: a.PropID,
                assessedValue: a.TotVal,
                landValue: a.LandVal,
                improvementValue: a.ImprVal,
                yearBuilt: a.YrBlt,
                sqft: a.GBA,
                source: 'BCAD_ArcGIS'
            };
        }
        return null;
    } catch (err) {
        console.error('[ArcGIS] Error for ' + address + ':', err.message);
        return null;
    }
}

// Query the live Railway server for bulk county data
async function getServerAssessed(address, token) {
    try {
        const { data } = await axios.post(
            'https://disciplined-alignment-production.up.railway.app/api/analysis/run',
            { address },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                timeout: 30000
            }
        );
        if (data.county && data.county.assessedValue) {
            return {
                parcelId: data.county.propId || null,
                assessedValue: data.county.assessedValue,
                landValue: data.county.landValue || null,
                improvementValue: data.county.improvementValue || null,
                yearBuilt: data.county.yearBuilt || null,
                sqft: data.county.gba || null,
                source: 'server_analysis'
            };
        }
        return null;
    } catch (err) {
        console.error('[Server] Error for ' + address + ':', err.message);
        return null;
    }
}

async function main() {
    console.log('=== ASSESSED VALUE BACKFILL ===');
    console.log('Started:', new Date().toISOString());

    // Generate JWT token
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
        { userId: 'admin', role: 'admin' },
        'overassessed-ai-jwt-secret-2026-bexar-county-tax-appeals',
        { expiresIn: '1h' }
    );

    // Get all properties
    const { data: properties, error } = await sb.from('properties').select('*');
    if (error) {
        console.error('Failed to fetch properties:', error.message);
        process.exit(1);
    }

    console.log('Total properties:', properties.length);
    const results = [];

    for (const prop of properties) {
        if (!prop.address) {
            console.log('SKIP: No address for property', prop.id);
            continue;
        }

        console.log('\n--- Processing:', prop.address, '---');

        let countyData = null;
        const county = (prop.county || '').toLowerCase();

        // Strategy 1: Bexar ArcGIS direct query
        if (county === 'bexar' || prop.address.match(/helotes|san antonio/i)) {
            console.log('  Trying BCAD ArcGIS...');
            countyData = await getBexarAssessed(prop.address);
            if (countyData) console.log('  ArcGIS hit:', countyData.assessedValue);
        }

        // Strategy 2: Check if property_data already has county info from RentCast analysis
        if (!countyData && prop.property_data && prop.property_data.county_parcel) {
            const cp = prop.property_data.county_parcel;
            if (cp.assessedValue) {
                countyData = {
                    parcelId: cp.propId || null,
                    assessedValue: cp.assessedValue,
                    landValue: cp.landValue || null,
                    improvementValue: cp.improvementValue || null,
                    yearBuilt: cp.yearBuilt || null,
                    sqft: cp.gba || null,
                    source: 'cached_property_data'
                };
                console.log('  Cached county data found:', countyData.assessedValue);
            }
        }

        // Build update
        const updateObj = {};

        if (countyData && countyData.assessedValue) {
            updateObj.current_assessed_value = countyData.assessedValue;
            updateObj.property_id_county = countyData.parcelId || prop.property_id_county;

            // Merge county data into property_data
            const existingPD = prop.property_data || {};
            existingPD.county_assessed = {
                value: countyData.assessedValue,
                land: countyData.landValue,
                improvement: countyData.improvementValue,
                parcel_id: countyData.parcelId,
                year_built: countyData.yearBuilt,
                sqft: countyData.sqft,
                source: countyData.source,
                retrieved_at: new Date().toISOString()
            };
            updateObj.property_data = existingPD;

            // Calculate savings (store in property_data since no column exists)
            if (prop.proposed_value) {
                const overAssessment = countyData.assessedValue - prop.proposed_value;
                const taxSavings = overAssessment > 0 ? Math.round(overAssessment * 0.0225) : 0;
                existingPD.county_assessed.estimated_tax_savings = taxSavings;
                existingPD.county_assessed.over_assessment_amount = overAssessment;
            }

            console.log('  UPDATED: assessed=' + countyData.assessedValue + ', proposed=' + prop.proposed_value + ', tax_savings=' + (existingPD.county_assessed.estimated_tax_savings || 'N/A'));
        } else {
            console.log('  NO COUNTY DATA FOUND - flagging');
            const existingPD = prop.property_data || {};
            existingPD.assessment_status = 'ASSESSMENT_DATA_MISSING';
            existingPD.assessment_attempted_at = new Date().toISOString();
            updateObj.property_data = existingPD;
        }

        // Write to Supabase
        const { error: upErr } = await sb.from('properties').update(updateObj).eq('id', prop.id);
        if (upErr) {
            console.error('  DB UPDATE FAILED:', upErr.message);
        } else {
            console.log('  DB UPDATE OK');
        }

        const taxSavings = (countyData && prop.proposed_value) 
            ? (countyData.assessedValue - prop.proposed_value > 0 ? Math.round((countyData.assessedValue - prop.proposed_value) * 0.0225) : 0)
            : null;
        results.push({
            id: prop.id,
            address: prop.address,
            county: prop.county,
            assessed: countyData ? countyData.assessedValue : null,
            proposed: prop.proposed_value,
            over_assessment: countyData && prop.proposed_value ? countyData.assessedValue - prop.proposed_value : null,
            tax_savings: taxSavings,
            source: countyData ? countyData.source : 'MISSING',
            parcelId: countyData ? countyData.parcelId : null
        });
    }

    // Final summary
    console.log('\n\n=== BACKFILL RESULTS ===');
    console.log('Processed:', results.length, 'properties');
    console.log('With assessed value:', results.filter(r => r.assessed).length);
    console.log('Missing:', results.filter(r => !r.assessed).length);

    console.log('\n=== PROPERTY DETAIL ===');
    results.forEach(r => {
        console.log(JSON.stringify(r));
    });

    // Verify from database
    console.log('\n=== DATABASE VERIFICATION ===');
    const { data: verified } = await sb.from('properties').select('id, address, county, current_assessed_value, proposed_value, property_id_county, property_data');
    verified.forEach(v => {
        const status = v.property_data && v.property_data.assessment_status ? v.property_data.assessment_status : 'OK';
        const src = v.property_data && v.property_data.county_assessed ? v.property_data.county_assessed.source : 'none';
        console.log(v.address + ' | assessed=' + v.current_assessed_value + ' | proposed=' + v.proposed_value + ' | parcel=' + v.property_id_county + ' | source=' + src + ' | status=' + status);
    });
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
