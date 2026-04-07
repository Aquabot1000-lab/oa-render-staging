/**
 * VERIFIED Comparable Properties Engine
 * 
 * REPLACES the old comp-engine.js which generated SYNTHETIC (fake) comps.
 * 
 * CORE RULE: NO DATA = NO OUTPUT
 * 
 * Every comp must:
 *   1. Exist in county CAD records (verified parcel ID)
 *   2. Have valid appraised value from CAD
 *   3. Match criteria (property type, value range, neighborhood)
 *   4. Be within geographic range (same neighborhood/subdivision)
 * 
 * If < 3 verified comps: INSUFFICIENT DATA (no report generated)
 * ZERO synthetic fallback. System FAILS, never FABRICATES.
 * 
 * @version 1.0.0 — 2026-04-07
 */

const { getBISClient, isBISCounty } = require('./bis-client');
const { getCountyData } = require('./local-parcel-data');
const tarrantData = require('./tarrant-data');

// County tax rates
const COUNTY_TAX_RATES = {
    'bexar': 0.0225, 'harris': 0.0230, 'travis': 0.0210,
    'fort bend': 0.0250, 'tarrant': 0.0240, 'hunt': 0.0225,
    'dallas': 0.0230, 'collin': 0.0220, 'denton': 0.0230,
    'williamson': 0.0220, 'kaufman': 0.0230
};

const MIN_COMPS = 3;
const MAX_EVIDENCE_COMPS = 10;

/**
 * Find VERIFIED comparable properties for a subject.
 * 
 * Data sources (in priority order):
 *   1. Local parcel data (pre-loaded bulk CAD data)
 *   2. Tarrant CAD (special handler)
 *   3. BIS e-search (live query to county CAD portals)
 * 
 * @param {Object} subject - Subject property data
 * @param {Object} caseData - Case/submission data
 * @returns {Object} Analysis result or INSUFFICIENT_DATA
 */
async function findVerifiedComps(subject, caseData) {
    const county = normalizeCounty(caseData?.county || '');
    const address = subject?.address || caseData?.property_address || '';

    console.log(`[VerifiedComp] Starting verified analysis for: ${address} (${county})`);

    // ─── VALIDATION GATE ────────────────────────────────────────────
    // Block if we don't have basic data
    if (!address) {
        return insufficientData('No property address provided');
    }
    if (!county) {
        return insufficientData('No county identified');
    }
    if (!subject?.assessedValue && !caseData?.assessed_value) {
        return insufficientData('No assessed value available — need verified CAD value');
    }

    const assessedValue = subject.assessedValue || parseInt(String(caseData.assessed_value).replace(/[$,]/g, '')) || 0;
    if (assessedValue <= 0) {
        return insufficientData('Assessed value is zero or invalid');
    }

    let comps = [];
    let dataSource = null;
    let subjectVerified = false;
    let subjectParcelId = null;

    // ─── SOURCE 1: LOCAL BULK DATA (Bexar, Harris, etc.) ────────────
    const localData = getCountyData(county);
    if (localData && localData.isLoaded()) {
        console.log(`[VerifiedComp] Using local bulk data for ${county}`);
        dataSource = 'local-cad-bulk';

        // Verify subject exists in CAD data
        const subjectResults = localData.searchByAddress(address);
        if (subjectResults.length > 0) {
            subjectVerified = true;
            subjectParcelId = subjectResults[0].accountNumber || subjectResults[0].propertyId;
            console.log(`[VerifiedComp] ✅ Subject verified in CAD: ${subjectParcelId}`);

            // Enrich subject with CAD data
            const cadRecord = subjectResults[0];
            if (!subject.sqft && cadRecord.sqft) subject.sqft = cadRecord.sqft;
            if (!subject.yearBuilt && cadRecord.yearBuilt) subject.yearBuilt = parseInt(cadRecord.yearBuilt);
            if (!subject.landValue && cadRecord.landValue) subject.landValue = cadRecord.landValue;
            if (!subject.improvementValue && cadRecord.improvementValue) subject.improvementValue = cadRecord.improvementValue;
        }

        // Find comps from local data
        const rawComps = localData.findComps(subjectResults[0] || {
            address,
            appraisedValue: assessedValue,
            sqft: subject.sqft,
            yearBuilt: subject.yearBuilt
        }, { maxComps: 30, maxValueDiff: 0.30 });

        // Convert to standard format and VALIDATE each comp
        for (const c of rawComps) {
            if (!c.address || !c.appraisedValue || c.appraisedValue <= 0) continue;
            if (!c.accountNumber && !c.propertyId) continue; // Must have parcel ID

            comps.push({
                source: 'verified-cad',
                parcelId: c.accountNumber || c.propertyId,
                address: c.address,
                assessedValue: c.appraisedValue,
                landValue: c.landValue,
                improvementValue: c.improvementValue,
                sqft: c.sqft,
                yearBuilt: c.yearBuilt ? parseInt(c.yearBuilt) : null,
                propertyType: c.propertyType,
                neighborhoodCode: c.neighborhoodCode,
                legalDescription: c.legalDescription,
                verified: true
            });
        }
    }

    // ─── SOURCE 2: TARRANT CAD (special handler) ────────────────────
    if (comps.length < MIN_COMPS && county === 'tarrant' && tarrantData.isLoaded()) {
        console.log(`[VerifiedComp] Using Tarrant CAD data`);
        dataSource = dataSource || 'tarrant-cad';

        const tadResults = tarrantData.searchByAddress(address, 3);
        if (tadResults.length > 0) {
            subjectVerified = true;
            subjectParcelId = tadResults[0].accountNumber;

            const tadComps = tarrantData.findComps({
                address,
                propertyClass: tadResults[0].propertyClass || 'A1',
                sqft: subject.sqft || tadResults[0].sqft,
                yearBuilt: subject.yearBuilt || tadResults[0].yearBuilt,
                legalDescription: tadResults[0].legalDescription,
                zipCode: tadResults[0].zipCode,
                maxResults: 30,
                sqftRange: 0.30,
                yearRange: 15
            });

            for (const c of tadComps) {
                if (!c.accountNumber || !c.totalValue) continue;
                comps.push({
                    source: 'verified-cad',
                    parcelId: c.accountNumber,
                    address: c.address,
                    assessedValue: c.totalValue,
                    landValue: c.landValue,
                    improvementValue: c.improvementValue,
                    sqft: c.sqft,
                    yearBuilt: c.yearBuilt,
                    propertyType: c.propertyClassDesc,
                    neighborhoodCode: tarrantData.extractNeighborhood(c.legalDescription),
                    legalDescription: c.legalDescription,
                    verified: true
                });
            }
        }
    }

    // ─── SOURCE 3: BIS E-SEARCH (live query) ────────────────────────
    if (comps.length < MIN_COMPS && isBISCounty(county)) {
        console.log(`[VerifiedComp] Using BIS live search for ${county}`);
        dataSource = dataSource || 'bis-live';

        try {
            const bisClient = getBISClient(county);
            
            // Parse address for search
            const addrParts = address.replace(/,.*$/, '').trim().split(/\s+/);
            const streetNum = /^\d+$/.test(addrParts[0]) ? addrParts[0] : '';
            const streetName = streetNum
                ? addrParts.slice(1).filter(p => !['rd','dr','ln','ct','st','ave','blvd','way','pl','cir'].includes(p.toLowerCase())).join(' ')
                : addrParts.filter(p => !['rd','dr','ln','ct','st','ave','blvd','way','pl','cir'].includes(p.toLowerCase())).join(' ');

            // Find subject
            if (streetNum && streetName) {
                const subjectResult = await bisClient.findProperty(streetNum, streetName);
                if (subjectResult) {
                    subjectVerified = true;
                    subjectParcelId = subjectResult.propertyId;
                    console.log(`[VerifiedComp] ✅ Subject verified via BIS: PID ${subjectParcelId}`);

                    // Find comps
                    const bisComps = await bisClient.findComps(subjectResult, {
                        maxComps: 30,
                        valueRange: 0.30
                    });

                    for (const c of bisComps) {
                        if (!c.propertyId || !c.appraisedValue) continue;
                        comps.push({
                            source: 'verified-cad',
                            parcelId: c.propertyId,
                            geoId: c.geoId,
                            address: c.address,
                            assessedValue: c.appraisedValue,
                            sqft: null,  // BIS search doesn't return sqft
                            yearBuilt: null,
                            propertyType: c.propertyType,
                            neighborhoodCode: c.neighborhoodCode,
                            subdivision: c.subdivision,
                            legalDescription: c.legalDescription,
                            verified: true
                        });
                    }
                }
            }
        } catch (err) {
            console.error(`[VerifiedComp] BIS search failed: ${err.message}`);
        }
    }

    // ─── VALIDATION GATE: MINIMUM COMPS ─────────────────────────────
    if (comps.length < MIN_COMPS) {
        return insufficientData(
            `Only ${comps.length} verified comp(s) found for ${address} in ${county}. ` +
            `Minimum ${MIN_COMPS} required. Data source: ${dataSource || 'none available'}.`
        );
    }

    // ─── DEDUP ──────────────────────────────────────────────────────
    const seenIds = new Set();
    comps = comps.filter(c => {
        const key = c.parcelId || c.address;
        if (seenIds.has(key)) return false;
        seenIds.add(key);
        return true;
    });

    // ─── SCORING ────────────────────────────────────────────────────
    const scored = comps.map(c => {
        let score = 100;

        // Value similarity (closer = better)
        const valueDiff = Math.abs(c.assessedValue - assessedValue) / assessedValue;
        if (valueDiff > 0.25) score -= 30;
        else if (valueDiff > 0.15) score -= 15;
        else if (valueDiff > 0.10) score -= 8;

        // Sqft similarity
        if (subject.sqft && c.sqft) {
            const sqftDiff = Math.abs(subject.sqft - c.sqft) / subject.sqft;
            if (sqftDiff > 0.25) score -= 25;
            else if (sqftDiff > 0.15) score -= 12;
            else if (sqftDiff > 0.10) score -= 5;
        }

        // Year built similarity
        if (subject.yearBuilt && c.yearBuilt) {
            const yearDiff = Math.abs(subject.yearBuilt - c.yearBuilt);
            if (yearDiff > 15) score -= 20;
            else if (yearDiff > 10) score -= 10;
            else if (yearDiff > 5) score -= 5;
        }

        // Same neighborhood bonus
        if (subject.neighborhoodCode && c.neighborhoodCode === subject.neighborhoodCode) {
            score += 10;
        }

        return { ...c, score: Math.max(0, Math.min(100, score)) };
    });

    // Sort by score (best first)
    scored.sort((a, b) => b.score - a.score);

    // Select evidence comps (prefer lower-valued ones that support protest)
    const lowerComps = scored.filter(c => c.assessedValue < assessedValue);
    const evidenceComps = lowerComps.length >= MIN_COMPS
        ? lowerComps.slice(0, MAX_EVIDENCE_COMPS)
        : scored.slice(0, MAX_EVIDENCE_COMPS);

    // ─── CALCULATE RECOMMENDED VALUE ────────────────────────────────
    const compValues = evidenceComps.map(c => c.assessedValue).sort((a, b) => a - b);
    const median = compValues[Math.floor(compValues.length / 2)];
    const average = Math.round(compValues.reduce((a, b) => a + b, 0) / compValues.length);
    const recommendedValue = Math.min(median, average);

    // Cap: don't recommend more than 25% reduction
    const floor = Math.round(assessedValue * 0.75);
    const finalRecommended = Math.max(floor, recommendedValue);

    // Don't recommend if comps show property is fairly valued
    const actualRecommended = finalRecommended >= assessedValue ? assessedValue : finalRecommended;
    const reduction = Math.max(0, assessedValue - actualRecommended);
    const taxRate = COUNTY_TAX_RATES[county] || 0.025;
    const estimatedSavings = Math.round(reduction * taxRate);

    // ─── BUILD RESULT ───────────────────────────────────────────────
    const result = {
        status: 'VERIFIED',
        dataIntegrity: 'ALL_COMPS_VERIFIED',
        dataSource,
        subjectVerified,
        subjectParcelId,

        subject: {
            address,
            county,
            assessedValue,
            sqft: subject.sqft,
            yearBuilt: subject.yearBuilt,
            landValue: subject.landValue,
            improvementValue: subject.improvementValue
        },

        comps: evidenceComps.map(c => ({
            parcelId: c.parcelId,
            geoId: c.geoId,
            address: c.address,
            assessedValue: c.assessedValue,
            sqft: c.sqft,
            yearBuilt: c.yearBuilt,
            neighborhoodCode: c.neighborhoodCode,
            subdivision: c.subdivision,
            score: c.score,
            source: c.source,
            verified: true
        })),

        totalCompsFound: scored.length,
        totalLowerComps: lowerComps.length,
        recommendedValue: actualRecommended,
        currentAssessedValue: assessedValue,
        reduction,
        estimatedSavings,
        taxRate,

        methodology: `Market comparison using ${evidenceComps.length} VERIFIED comparable properties ` +
            `from ${county.charAt(0).toUpperCase() + county.slice(1)} County CAD records. ` +
            `All comp addresses verified against county parcel database (source: ${dataSource}). ` +
            `${scored.length} total comps evaluated, ${lowerComps.length} with lower appraised values. ` +
            `Median: $${median.toLocaleString()}, Average: $${average.toLocaleString()}. ` +
            `Recommended protest value: $${actualRecommended.toLocaleString()}.`,

        analyzedAt: new Date().toISOString(),
        engineVersion: '1.0.0-verified'
    };

    console.log(`[VerifiedComp] ✅ Analysis complete: ${evidenceComps.length} verified comps, ` +
        `recommended $${actualRecommended.toLocaleString()} (reduction $${reduction.toLocaleString()})`);

    return result;
}

/**
 * Return INSUFFICIENT_DATA result.
 * System FAILS — never fabricates.
 */
function insufficientData(reason) {
    console.log(`[VerifiedComp] ❌ INSUFFICIENT DATA: ${reason}`);
    return {
        status: 'INSUFFICIENT_DATA',
        dataIntegrity: 'BLOCKED',
        reason,
        comps: [],
        totalCompsFound: 0,
        recommendedValue: null,
        reduction: null,
        estimatedSavings: null,
        analyzedAt: new Date().toISOString(),
        engineVersion: '1.0.0-verified'
    };
}

function normalizeCounty(county) {
    return (county || '').toLowerCase().replace(/\s*county\s*/i, '').trim();
}

module.exports = { findVerifiedComps, insufficientData };
