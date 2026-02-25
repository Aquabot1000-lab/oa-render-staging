/**
 * RentCast API Integration
 * Provides AVM (Automated Valuation Model) and property data from RentCast,
 * combined with Bexar County ArcGIS parcel data.
 */

const axios = require('axios');

const RENTCAST_BASE = 'https://api.rentcast.io/v1';
const ARCGIS_BASE = 'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query';

function getApiKey() {
    const key = process.env.RENTCAST_API_KEY;
    if (!key) throw new Error('RENTCAST_API_KEY not set');
    return key;
}

const rcHeaders = () => ({
    'Accept': 'application/json',
    'X-Api-Key': getApiKey()
});

// ── RentCast AVM ──────────────────────────────────────────
async function getAVM(address) {
    const { data } = await axios.get(`${RENTCAST_BASE}/avm/value`, {
        params: { address },
        headers: rcHeaders(),
        timeout: 15000
    });
    return data;
}

// ── RentCast Property Lookup ──────────────────────────────
async function getProperty(address) {
    const { data } = await axios.get(`${RENTCAST_BASE}/properties`, {
        params: { address },
        headers: rcHeaders(),
        timeout: 15000
    });
    // API returns array; take first match
    return Array.isArray(data) ? data[0] || null : data;
}

// ── Bexar County ArcGIS Parcel Query ──────────────────────
async function getBexarParcel(address) {
    try {
        // Normalise: strip unit/apt, uppercase
        const clean = address.replace(/,?\s*(san antonio|sa|tx|texas|\d{5}(-\d{4})?)/gi, '').trim().toUpperCase();
        const { data } = await axios.get(ARCGIS_BASE, {
            params: {
                where: `SitusAddress LIKE '%${clean.replace(/'/g, "''")}%'`,
                outFields: 'PropID,SitusAddress,TotVal,LandVal,ImprVal,YrBlt,GBA,OwnerName,LegalDesc,PropertyType',
                returnGeometry: false,
                f: 'json'
            },
            timeout: 15000
        });
        if (data.features && data.features.length > 0) {
            return data.features[0].attributes;
        }
        return null;
    } catch (err) {
        console.error('[ArcGIS] Query failed:', err.message);
        return null;
    }
}

// ── Combined Analysis ─────────────────────────────────────
async function runRentCastAnalysis(address) {
    // Fire all three in parallel
    const [avm, property, parcel] = await Promise.allSettled([
        getAVM(address),
        getProperty(address),
        getBexarParcel(address)
    ]);

    const avmData = avm.status === 'fulfilled' ? avm.value : null;
    const propData = property.status === 'fulfilled' ? property.value : null;
    const parcelData = parcel.status === 'fulfilled' ? parcel.value : null;

    if (!avmData) {
        throw new Error('RentCast AVM returned no data – check address format');
    }

    const marketValue = avmData.price || avmData.priceRangeLow || 0;
    const marketLow = avmData.priceRangeLow || marketValue;
    const marketHigh = avmData.priceRangeHigh || marketValue;

    // County assessed value
    const assessedValue = parcelData ? (parcelData.TotVal || 0) : null;

    // Over-assessment
    const overAssessment = assessedValue != null ? assessedValue - marketValue : null;
    const overPct = assessedValue && marketValue ? ((assessedValue - marketValue) / marketValue * 100) : null;

    // Protest recommendation
    let recommendation = 'weak';
    if (overPct !== null) {
        if (overPct >= 30) recommendation = 'strong';
        else if (overPct >= 10) recommendation = 'moderate';
    }

    // Comparables from AVM response
    const comps = (avmData.comparables || []).map(c => ({
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
    }));

    return {
        address,
        rentcast: {
            marketValue,
            marketLow,
            marketHigh,
            confidence: avmData.confidence || null,
            comparables: comps,
            propertyType: avmData.propertyType || (propData && propData.propertyType) || null,
            squareFootage: avmData.squareFootage || (propData && propData.squareFootage) || null,
            yearBuilt: avmData.yearBuilt || (propData && propData.yearBuilt) || null,
            bedrooms: avmData.bedrooms || (propData && propData.bedrooms) || null,
            bathrooms: avmData.bathrooms || (propData && propData.bathrooms) || null
        },
        county: parcelData ? {
            propId: parcelData.PropID,
            assessedValue: parcelData.TotVal,
            landValue: parcelData.LandVal,
            improvementValue: parcelData.ImprVal,
            yearBuilt: parcelData.YrBlt,
            gba: parcelData.GBA,
            ownerName: parcelData.OwnerName,
            legalDesc: parcelData.LegalDesc,
            propertyType: parcelData.PropertyType
        } : null,
        analysis: {
            overAssessmentAmount: overAssessment,
            overAssessmentPct: overPct != null ? Math.round(overPct * 10) / 10 : null,
            recommendation,
            estimatedTaxSavings: overAssessment > 0 ? Math.round(overAssessment * 0.0225) : 0 // ~2.25% Bexar tax rate
        }
    };
}

// ── Comps-Only ────────────────────────────────────────────
async function getComps(address) {
    const avmData = await getAVM(address);
    return (avmData.comparables || []).map(c => ({
        address: c.formattedAddress || c.address || 'N/A',
        price: c.price || c.lastSalePrice || null,
        sqft: c.squareFootage || null,
        yearBuilt: c.yearBuilt || null,
        bedrooms: c.bedrooms || null,
        bathrooms: c.bathrooms || null,
        lastSaleDate: c.lastSaleDate || null,
        correlation: c.correlation || c.score || null,
        distance: c.distance || null,
        propertyType: c.propertyType || null
    }));
}

module.exports = { runRentCastAnalysis, getComps, getAVM, getProperty, getBexarParcel };
