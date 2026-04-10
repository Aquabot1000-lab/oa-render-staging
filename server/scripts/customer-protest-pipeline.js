#!/usr/bin/env node
/**
 * Customer Protest Pipeline — Filing-Ready Engine
 * 
 * 1. Pull existing customer from clients table
 * 2. Get/create their property record
 * 3. Fetch real property data (RentCast + BCAD)
 * 4. Pull and rank comps using filing-quality logic
 * 5. Store everything in Supabase
 * 6. Output structured review
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const RENTCAST_BASE = 'https://api.rentcast.io/v1';
const RENTCAST_KEY = process.env.RENTCAST_API_KEY;
const ARCGIS_BASE = 'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query';

const COUNTY_TAX_RATES = {
    bexar: 0.0225, harris: 0.0230, travis: 0.0210, dallas: 0.0220,
    tarrant: 0.0230, williamson: 0.0215, fortbend: 0.0250
};

// Filing-quality comp scoring
function scoreComp(subject, comp) {
    let score = 0;
    let reasons = [];

    // Must be same property type (residential vs land vs commercial)
    if (comp.propertyType === 'Land' || comp.propertyType === 'Vacant Land') {
        return { score: 0, reasons: ['REJECTED: Land parcel, not comparable to residential'] };
    }

    // Distance: closer is better (max 1.5 mi for filing quality)
    if (comp.distance !== null && comp.distance !== undefined) {
        if (comp.distance <= 0.25) { score += 30; reasons.push('Excellent proximity (<0.25mi)'); }
        else if (comp.distance <= 0.5) { score += 25; reasons.push('Good proximity (<0.5mi)'); }
        else if (comp.distance <= 1.0) { score += 15; reasons.push('Acceptable proximity (<1mi)'); }
        else if (comp.distance <= 1.5) { score += 5; reasons.push('Marginal proximity (<1.5mi)'); }
        else { score -= 10; reasons.push('Too far (>1.5mi)'); }
    }

    // Square footage: within 20% of subject
    if (subject.sqft && comp.sqft) {
        var sqftRatio = comp.sqft / subject.sqft;
        if (sqftRatio >= 0.8 && sqftRatio <= 1.2) { score += 25; reasons.push('Similar size (' + comp.sqft + ' vs ' + subject.sqft + 'sqft)'); }
        else if (sqftRatio >= 0.7 && sqftRatio <= 1.3) { score += 15; reasons.push('Acceptable size range'); }
        else { score -= 5; reasons.push('Size mismatch (' + comp.sqft + ' vs ' + subject.sqft + 'sqft)'); }
    }

    // Year built: within 15 years of subject
    if (subject.yearBuilt && comp.yearBuilt) {
        var ageDiff = Math.abs(parseInt(subject.yearBuilt) - parseInt(comp.yearBuilt));
        if (ageDiff <= 5) { score += 20; reasons.push('Similar age (within 5yr)'); }
        else if (ageDiff <= 10) { score += 15; reasons.push('Acceptable age (within 10yr)'); }
        else if (ageDiff <= 15) { score += 5; reasons.push('Marginal age difference'); }
        else { score -= 5; reasons.push('Age mismatch (' + ageDiff + 'yr difference)'); }
    }

    // Bedrooms: same or +/-1
    if (subject.bedrooms && comp.bedrooms) {
        var bedDiff = Math.abs(comp.bedrooms - subject.bedrooms);
        if (bedDiff === 0) { score += 10; reasons.push('Same bed count'); }
        else if (bedDiff === 1) { score += 5; reasons.push('Similar bed count'); }
        else { score -= 5; reasons.push('Bed count mismatch'); }
    }

    // Correlation from RentCast
    if (comp.correlation) {
        if (comp.correlation >= 0.98) { score += 15; reasons.push('Very high correlation (' + comp.correlation + ')'); }
        else if (comp.correlation >= 0.96) { score += 10; reasons.push('High correlation'); }
        else if (comp.correlation >= 0.94) { score += 5; reasons.push('Good correlation'); }
    }

    // Price sanity: comp price should support a lower value than assessed
    if (comp.price && subject.assessedValue && comp.price < subject.assessedValue) {
        score += 10;
        reasons.push('Supports lower value ($' + comp.price.toLocaleString() + ' < $' + subject.assessedValue.toLocaleString() + ' assessed)');
    }

    return { score: score, reasons: reasons };
}

async function fetchBCAD(address) {
    try {
        // Try multiple address cleaning strategies
        var strategies = [];

        // Strategy 1: Street number + street name only
        var match = address.match(/^(\d+)\s+(.+?)(?:,|\s+(?:san antonio|helotes|tx|texas|\d{5}))/i);
        if (match) {
            strategies.push(match[1] + ' ' + match[2].trim().toUpperCase());
        }

        // Strategy 2: Everything before first comma
        var beforeComma = address.split(',')[0].trim().toUpperCase();
        strategies.push(beforeComma);

        for (var i = 0; i < strategies.length; i++) {
            var clean = strategies[i].replace(/'/g, "''");
            var res = await axios.get(ARCGIS_BASE, {
                params: {
                    where: "Situs LIKE '%" + clean + "%'",
                    outFields: 'PropID,Situs,TotVal,LandVal,ImprVal,YrBlt,GBA,Owner',
                    returnGeometry: false,
                    f: 'json'
                },
                timeout: 15000
            });

            if (res.data.features && res.data.features.length > 0) {
                // If multiple results, try to find the best address match
                var features = res.data.features;
                for (var j = 0; j < features.length; j++) {
                    var situs = (features[j].attributes.Situs || '').trim();
                    var searchNum = address.match(/^(\d+)/);
                    var situsNum = situs.match(/^(\d+)/);
                    if (searchNum && situsNum && searchNum[1] === situsNum[1]) {
                        return features[j].attributes;
                    }
                }
                // Fallback to first result
                return features[0].attributes;
            }
        }
        return null;
    } catch (err) {
        console.error('[BCAD] Error:', err.message);
        return null;
    }
}

async function processCustomer(client) {
    var output = {
        customer: {
            id: client.id,
            name: client.name,
            email: client.email,
            phone: client.phone
        },
        subject_property: {},
        comps: [],
        valuation: {},
        recommendation: '',
        data_sources: {},
        stored_in_supabase: false
    };

    // Find or determine property address
    var address = client.address || null;
    if (!address) {
        // Check properties table for this client
        var propResult = await sb.from('properties').select('*').eq('client_id', client.id).limit(1);
        if (propResult.data && propResult.data.length > 0) {
            address = propResult.data[0].address;
            output._existing_property_id = propResult.data[0].id;
        }
    }

    if (!address) {
        output.blocker = 'NO ADDRESS: Client ' + client.name + ' has no property address in clients or properties table';
        return output;
    }

    console.log('\nProcessing: ' + client.name + ' — ' + address);

    // Fetch RentCast AVM
    var avmData = null;
    try {
        var avmRes = await axios.get(RENTCAST_BASE + '/avm/value', {
            params: { address: address },
            headers: { 'Accept': 'application/json', 'X-Api-Key': RENTCAST_KEY },
            timeout: 15000
        });
        avmData = avmRes.data;
        output.data_sources.rentcast_avm = 'SUCCESS';
    } catch (err) {
        output.data_sources.rentcast_avm = 'FAILED: ' + (err.response ? err.response.status : err.message);
    }

    // Fetch RentCast property details
    var propertyData = null;
    try {
        var propRes = await axios.get(RENTCAST_BASE + '/properties', {
            params: { address: address },
            headers: { 'Accept': 'application/json', 'X-Api-Key': RENTCAST_KEY },
            timeout: 15000
        });
        var raw = propRes.data;
        propertyData = Array.isArray(raw) ? raw[0] || null : raw;
        output.data_sources.rentcast_property = 'SUCCESS';
    } catch (err) {
        output.data_sources.rentcast_property = 'FAILED: ' + (err.response ? err.response.status : err.message);
    }

    // Fetch BCAD data if applicable
    var county = (client.county || '').toLowerCase();
    var bcadData = null;
    if (county === 'bexar' || address.match(/san antonio|helotes|78[0-9]{3}/i)) {
        bcadData = await fetchBCAD(address);
        output.data_sources.bcad_arcgis = bcadData ? 'SUCCESS' : 'NO MATCH';
        if (!county) county = 'bexar';
    }

    // Build subject property profile
    var subject = {
        address: address,
        county: county,
        parcelId: bcadData ? bcadData.PropID : null,
        assessedValue: bcadData ? bcadData.TotVal : null,
        landValue: bcadData ? bcadData.LandVal : null,
        improvementValue: bcadData ? bcadData.ImprVal : null,
        ownerName: bcadData ? bcadData.Owner : client.name,
        sqft: (propertyData && propertyData.squareFootage) || (bcadData ? bcadData.GBA : null),
        yearBuilt: (propertyData && propertyData.yearBuilt) || (bcadData ? bcadData.YrBlt : null),
        bedrooms: propertyData ? propertyData.bedrooms : null,
        bathrooms: propertyData ? propertyData.bathrooms : null,
        propertyType: propertyData ? propertyData.propertyType : 'Single Family',
        marketValue: avmData ? (avmData.price || avmData.priceRangeLow) : null,
        marketLow: avmData ? avmData.priceRangeLow : null,
        marketHigh: avmData ? avmData.priceRangeHigh : null
    };
    output.subject_property = subject;

    // Score and rank comps
    var rawComps = (avmData && avmData.comparables) ? avmData.comparables : [];
    var scoredComps = rawComps.map(function(c) {
        var mapped = {
            address: c.formattedAddress || c.address || 'N/A',
            price: c.price || c.lastSalePrice || null,
            sqft: c.squareFootage || null,
            yearBuilt: c.yearBuilt || null,
            bedrooms: c.bedrooms || null,
            bathrooms: c.bathrooms || null,
            lotSize: c.lotSize || null,
            correlation: c.correlation || null,
            distance: c.distance || null,
            propertyType: c.propertyType || null,
            lastSaleDate: c.lastSaleDate || null
        };
        var scoring = scoreComp(subject, mapped);
        mapped.filing_score = scoring.score;
        mapped.selection_reasons = scoring.reasons;
        return mapped;
    });

    // Sort by filing score descending, take top 10
    scoredComps.sort(function(a, b) { return b.filing_score - a.filing_score; });
    var selectedComps = scoredComps.filter(function(c) { return c.filing_score > 0; }).slice(0, 10);
    output.comps = selectedComps;

    // Valuation
    var taxRate = COUNTY_TAX_RATES[county] || 0.0225;
    var overAssessment = (subject.assessedValue && subject.marketValue)
        ? subject.assessedValue - subject.marketValue : null;
    var taxSavings = (overAssessment && overAssessment > 0)
        ? Math.round(overAssessment * taxRate) : 0;

    output.valuation = {
        assessed_value: subject.assessedValue,
        market_value_estimate: subject.marketValue,
        market_range: { low: subject.marketLow, high: subject.marketHigh },
        over_assessment: overAssessment,
        tax_rate: taxRate,
        estimated_annual_savings: taxSavings,
        calculation_method: 'RentCast AVM median estimate vs BCAD assessed value',
        comp_median: selectedComps.length > 0
            ? selectedComps.reduce(function(sum, c) { return sum + (c.price || 0); }, 0) / selectedComps.length
            : null
    };

    // Recommendation
    if (!subject.assessedValue) {
        output.recommendation = 'NOT READY — No official assessed value retrieved';
    } else if (!subject.marketValue) {
        output.recommendation = 'NOT READY — No market value estimate from RentCast';
    } else if (selectedComps.length < 3) {
        output.recommendation = 'NOT READY — Insufficient quality comps (' + selectedComps.length + ' found, need 3+)';
    } else if (overAssessment > 0 && (overAssessment / subject.assessedValue) >= 0.10) {
        output.recommendation = 'STRONG PROTEST — Over-assessed by ' + Math.round(overAssessment / subject.assessedValue * 100) + '% ($' + overAssessment.toLocaleString() + ')';
    } else if (overAssessment > 0) {
        output.recommendation = 'MODERATE PROTEST — Over-assessed by ' + Math.round(overAssessment / subject.assessedValue * 100) + '% ($' + overAssessment.toLocaleString() + ')';
    } else {
        output.recommendation = 'WEAK — Property appears fairly or under-assessed';
    }

    // Store in Supabase
    var storeData = {
        property_data: {
            rentcast_avm: {
                marketValue: subject.marketValue,
                marketLow: subject.marketLow,
                marketHigh: subject.marketHigh,
                squareFootage: subject.sqft,
                yearBuilt: subject.yearBuilt,
                bedrooms: subject.bedrooms,
                bathrooms: subject.bathrooms,
                propertyType: subject.propertyType
            },
            county_parcel: bcadData ? {
                propId: bcadData.PropID,
                assessedValue: bcadData.TotVal,
                landValue: bcadData.LandVal,
                improvementValue: bcadData.ImprVal,
                yearBuilt: bcadData.YrBlt,
                sqft: bcadData.GBA,
                owner: bcadData.Owner,
                situs: bcadData.Situs
            } : null,
            filing_recommendation: output.recommendation,
            fetched_at: new Date().toISOString()
        },
        comp_results: {
            comparables: selectedComps,
            comp_count: selectedComps.length,
            total_raw_comps: rawComps.length,
            scoring_method: 'filing_quality_weighted',
            fetched_at: new Date().toISOString()
        },
        current_assessed_value: subject.assessedValue,
        proposed_value: subject.marketValue,
        county: county || null
    };

    if (bcadData && bcadData.PropID) {
        storeData.property_id_county = String(bcadData.PropID);
    }

    // Update or insert property
    if (output._existing_property_id) {
        var upResult = await sb.from('properties').update(storeData).eq('id', output._existing_property_id);
        if (upResult.error) {
            output.store_error = upResult.error.message;
        } else {
            output.stored_in_supabase = true;
            output.property_id = output._existing_property_id;
        }
    } else {
        storeData.address = address;
        storeData.client_id = client.id;
        storeData.state = 'TX';
        storeData.property_type = subject.propertyType || 'Single Family';
        storeData.year = new Date().getFullYear();
        var insResult = await sb.from('properties').insert(storeData).select('id').single();
        if (insResult.error) {
            output.store_error = insResult.error.message;
        } else {
            output.stored_in_supabase = true;
            output.property_id = insResult.data.id;
        }
    }

    return output;
}

async function main() {
    // Get all non-admin, non-test clients
    var clientResult = await sb.from('clients')
        .select('*')
        .not('lead_stage', 'eq', 'admin')
        .not('email', 'like', '%test%')
        .order('created_at', { ascending: true });

    if (clientResult.error) {
        console.error('FATAL: Cannot fetch clients:', clientResult.error.message);
        process.exit(1);
    }

    var clients = clientResult.data;
    console.log('=== CUSTOMER PROTEST PIPELINE ===');
    console.log('Existing customers found: ' + clients.length);
    console.log('Timestamp: ' + new Date().toISOString());

    var results = [];
    for (var i = 0; i < clients.length; i++) {
        var result = await processCustomer(clients[i]);
        results.push(result);
        console.log('\n' + JSON.stringify(result, null, 2));
    }

    console.log('\n\n=== PIPELINE SUMMARY ===');
    results.forEach(function(r) {
        var status = r.stored_in_supabase ? 'STORED' : 'NOT STORED';
        var ready = r.recommendation.startsWith('STRONG') || r.recommendation.startsWith('MODERATE') ? 'READY' : 'NOT READY';
        console.log(r.customer.name + ' | ' + (r.subject_property.address || 'NO ADDRESS') + ' | ' + status + ' | ' + ready + ' | ' + r.recommendation);
    });
}

main().catch(function(err) {
    console.error('PIPELINE FATAL:', err);
    process.exit(1);
});
