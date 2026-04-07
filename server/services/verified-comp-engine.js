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
 * TWO-PASS SYSTEM (v1.3):
 *   Pass 1: Same subdivision/neighborhood only
 *   Pass 2: Expanded search (wider geography, same strict filters)
 *   Passes are NEVER mixed. Pass 2 only runs if Pass 1 < MIN_COMPS.
 * 
 * @version 1.3.0 — 2026-04-07 (two-pass: local + expanded)
 */

const { getBISClient, isBISCounty } = require('./bis-client');
const { getCountyData } = require('./local-parcel-data');
const tarrantData = require('./tarrant-data');

// County tax rates
const COUNTY_TAX_RATES = {
    'bexar': 0.0225, 'harris': 0.0230,
    'fort bend': 0.0250, 'tarrant': 0.0240, 'hunt': 0.0225,
    'dallas': 0.0230, 'collin': 0.0220, 'denton': 0.0230,
    'williamson': 0.0220, 'kaufman': 0.0230
    // Travis DISABLED — bulk data corrupted ($52M values)
};

// Counties with known-bad data — block entirely
const BLOCKED_COUNTIES = new Set(['travis']);

const MIN_COMPS = 3;
const MAX_EVIDENCE_COMPS = 10;

// ─── QUALITY GATES (Tyler strict directive 2026-04-07) ─────────────
const VALUE_BAND_LOW = 0.70;
const VALUE_BAND_HIGH = 1.30;
const SQFT_TOLERANCE = 0.25;
const YEAR_TOLERANCE = 15;
const REQUIRE_PROPERTY_TYPE_MATCH = true;
const OUTLIER_MEDIAN_HIGH = 2.0;
const OUTLIER_MEDIAN_LOW = 0.5;
const MIN_AVG_QUALITY_SCORE = 50;
const MAX_VARIANCE_PCT = 25;

// ─── PASS 2: EXPANDED SEARCH ──────────────────────────────────────
const EXPANDED_MAX_COMPS = 80; // wider net, then filter strictly


// ═══════════════════════════════════════════════════════════════════
// HELPER: Apply strict filters to a comp array
// ═══════════════════════════════════════════════════════════════════
function applyStrictFilters(comps, assessedValue, subject, passLabel) {
    const valueLow = assessedValue * VALUE_BAND_LOW;
    const valueHigh = assessedValue * VALUE_BAND_HIGH;
    const subjectSqft = subject.sqft || null;
    const subjectYear = subject.yearBuilt || null;
    const subjectPropType = (subject.propertyType || '').toUpperCase();
    const rejected = { value: 0, sqft: 0, year: 0, propType: 0 };

    const filtered = comps.filter(c => {
        if (!c.assessedValue || c.assessedValue <= 0) return false;

        // 1. VALUE BAND: 70%-130%
        if (c.assessedValue < valueLow || c.assessedValue > valueHigh) {
            rejected.value++;
            return false;
        }

        // 2. SQFT: ±25%
        if (subjectSqft && c.sqft) {
            const sqftDiff = Math.abs(c.sqft - subjectSqft) / subjectSqft;
            if (sqftDiff > SQFT_TOLERANCE) {
                rejected.sqft++;
                return false;
            }
        }

        // 3. YEAR BUILT: ±15 years
        if (subjectYear && c.yearBuilt) {
            const yearDiff = Math.abs(c.yearBuilt - subjectYear);
            if (yearDiff > YEAR_TOLERANCE) {
                rejected.year++;
                return false;
            }
        }

        // 4. PROPERTY TYPE: exact match
        if (REQUIRE_PROPERTY_TYPE_MATCH && subjectPropType && c.propertyType) {
            const compType = (c.propertyType || '').toUpperCase();
            const normalize = (t) => {
                if (/SINGLE|SFR|A1|RESIDENCE/.test(t)) return 'SFR';
                if (/TOWN|ATTACH/.test(t)) return 'TOWNHOME';
                if (/CONDO|UNIT/.test(t)) return 'CONDO';
                if (/MULTI|DUPLEX|TRIPLEX|QUAD/.test(t)) return 'MULTI';
                return t;
            };
            if (normalize(subjectPropType) !== normalize(compType)) {
                rejected.propType++;
                return false;
            }
        }

        return true;
    });

    console.log(`[${passLabel}] Strict filters: ${comps.length} → ${filtered.length} ` +
        `(value:${rejected.value} sqft:${rejected.sqft} year:${rejected.year} type:${rejected.propType})`);

    // Outlier rejection: > 2x median or < 0.5x median
    if (filtered.length >= 3) {
        const sortedVals = filtered.map(c => c.assessedValue).sort((a, b) => a - b);
        const median = sortedVals[Math.floor(sortedVals.length / 2)];
        const preCount = filtered.length;
        const afterOutlier = filtered.filter(c => {
            if (c.assessedValue > median * OUTLIER_MEDIAN_HIGH || c.assessedValue < median * OUTLIER_MEDIAN_LOW) {
                console.log(`[${passLabel}] 🚫 OUTLIER: ${c.address} ($${c.assessedValue.toLocaleString()}) vs median $${median.toLocaleString()}`);
                return false;
            }
            return true;
        });
        if (preCount !== afterOutlier.length) {
            console.log(`[${passLabel}] Outlier filter: ${preCount} → ${afterOutlier.length}`);
        }
        return { comps: afterOutlier, rejected };
    }

    return { comps: filtered, rejected };
}


// ═══════════════════════════════════════════════════════════════════
// HELPER: Score comps
// ═══════════════════════════════════════════════════════════════════
function scoreComps(comps, assessedValue, subject) {
    return comps.map(c => {
        let score = 100;

        const valueDiff = Math.abs(c.assessedValue - assessedValue) / assessedValue;
        if (valueDiff > 0.25) score -= 30;
        else if (valueDiff > 0.15) score -= 15;
        else if (valueDiff > 0.10) score -= 8;

        if (subject.sqft && c.sqft) {
            const sqftDiff = Math.abs(subject.sqft - c.sqft) / subject.sqft;
            if (sqftDiff > 0.25) score -= 25;
            else if (sqftDiff > 0.15) score -= 12;
            else if (sqftDiff > 0.10) score -= 5;
        }

        if (subject.yearBuilt && c.yearBuilt) {
            const yearDiff = Math.abs(subject.yearBuilt - c.yearBuilt);
            if (yearDiff > 15) score -= 20;
            else if (yearDiff > 10) score -= 10;
            else if (yearDiff > 5) score -= 5;
        }

        if (subject.neighborhoodCode && c.neighborhoodCode === subject.neighborhoodCode) {
            score += 10;
        }

        return { ...c, score: Math.max(0, Math.min(100, score)) };
    }).sort((a, b) => b.score - a.score);
}


// ═══════════════════════════════════════════════════════════════════
// HELPER: Build result from scored comps
// ═══════════════════════════════════════════════════════════════════
function buildResult(scored, assessedValue, county, address, subject, dataSource, subjectVerified, subjectParcelId, rejected, passLabel) {
    const avgScore = scored.reduce((s, c) => s + c.score, 0) / scored.length;
    if (avgScore < MIN_AVG_QUALITY_SCORE) {
        return null; // caller should handle
    }

    const lowerComps = scored.filter(c => c.assessedValue < assessedValue);
    const evidenceComps = lowerComps.length >= MIN_COMPS
        ? lowerComps.slice(0, MAX_EVIDENCE_COMPS)
        : scored.slice(0, MAX_EVIDENCE_COMPS);

    const compValues = evidenceComps.map(c => c.assessedValue).sort((a, b) => a - b);
    const avgCompValue = Math.round(compValues.reduce((a, b) => a + b, 0) / compValues.length);
    const medianCompValue = compValues[Math.floor(compValues.length / 2)];
    const variancePct = avgCompValue > 0 ? Math.round((Math.max(...compValues) - Math.min(...compValues)) / avgCompValue * 100) : 0;

    let confidenceLevel = 'HIGH';
    if (variancePct > MAX_VARIANCE_PCT) confidenceLevel = 'LOW';
    else if (variancePct > 15 || evidenceComps.length < 5 || avgScore < 70) confidenceLevel = 'MEDIUM';

    const recommendedValue = Math.min(medianCompValue, avgCompValue);
    const floor = Math.round(assessedValue * 0.75);
    const finalRecommended = Math.max(floor, recommendedValue);
    const actualRecommended = finalRecommended >= assessedValue ? assessedValue : finalRecommended;
    const reduction = Math.max(0, assessedValue - actualRecommended);
    const taxRate = COUNTY_TAX_RATES[county] || 0.025;
    const estimatedSavings = Math.round(reduction * taxRate);

    const isExpanded = passLabel.includes('PASS 2');
    const status = isExpanded ? 'VERIFIED_EXPANDED' : 'VERIFIED';

    return {
        status,
        dataIntegrity: 'ALL_COMPS_VERIFIED',
        dataSource,
        subjectVerified,
        subjectParcelId,
        searchPass: isExpanded ? 'EXPANDED' : 'LOCAL',

        subject: {
            address, county, assessedValue,
            sqft: subject.sqft, yearBuilt: subject.yearBuilt,
            landValue: subject.landValue, improvementValue: subject.improvementValue,
            propertyType: subject.propertyType, neighborhoodCode: subject.neighborhoodCode
        },

        comps: evidenceComps.map(c => ({
            parcelId: c.parcelId, geoId: c.geoId, address: c.address,
            assessedValue: c.assessedValue, sqft: c.sqft, yearBuilt: c.yearBuilt,
            neighborhoodCode: c.neighborhoodCode, subdivision: c.subdivision,
            score: c.score, source: c.source, verified: true
        })),

        totalCompsFound: scored.length,
        totalLowerComps: lowerComps.length,
        recommendedValue: actualRecommended,
        currentAssessedValue: assessedValue,
        reduction, estimatedSavings, taxRate,

        quality: {
            compCount: evidenceComps.length,
            avgCompValue, medianCompValue, variancePct,
            avgQualityScore: Math.round(avgScore),
            confidenceLevel,
            searchPass: isExpanded ? 'EXPANDED' : 'LOCAL',
            filtersApplied: {
                valueBand: `${VALUE_BAND_LOW*100}%-${VALUE_BAND_HIGH*100}%`,
                sqftTolerance: `±${SQFT_TOLERANCE*100}%`,
                yearTolerance: `±${YEAR_TOLERANCE}yr`,
                propertyTypeMatch: REQUIRE_PROPERTY_TYPE_MATCH,
                outlierMedian: `${OUTLIER_MEDIAN_LOW}x-${OUTLIER_MEDIAN_HIGH}x`,
                rejected
            }
        },

        methodology: `${isExpanded ? 'EXPANDED SEARCH: ' : ''}Market comparison using ${evidenceComps.length} VERIFIED comparable properties ` +
            `from ${county.charAt(0).toUpperCase() + county.slice(1)} County CAD records. ` +
            `Source: ${dataSource}. Search pass: ${isExpanded ? 'EXPANDED (wider geography)' : 'LOCAL (same subdivision)'}. ` +
            `${scored.length} total comps evaluated, ${lowerComps.length} with lower appraised values. ` +
            `Median: $${medianCompValue.toLocaleString()}, Average: $${avgCompValue.toLocaleString()}. ` +
            `Variance: ${variancePct}%. Confidence: ${confidenceLevel}. ` +
            `Filters: value-band ${VALUE_BAND_LOW*100}-${VALUE_BAND_HIGH*100}%, sqft ±${SQFT_TOLERANCE*100}%, year ±${YEAR_TOLERANCE}yr. ` +
            `Recommended protest value: $${actualRecommended.toLocaleString()}.`,

        analyzedAt: new Date().toISOString(),
        engineVersion: '1.3.0-twopass'
    };
}


// ═══════════════════════════════════════════════════════════════════
// HELPER: Gather raw comps from data sources
// ═══════════════════════════════════════════════════════════════════
async function gatherRawComps(county, address, subject, assessedValue, options = {}) {
    const { expanded = false } = options;
    const maxComps = expanded ? EXPANDED_MAX_COMPS : 30;
    const maxValueDiff = expanded ? 0.50 : 0.30; // wider initial net for expanded, strict filters still apply

    let comps = [];
    let dataSource = null;
    let subjectVerified = false;
    let subjectParcelId = null;

    // ─── SOURCE 1: LOCAL BULK DATA ──────────────────────────────────
    const localData = getCountyData(county);
    if (localData && !localData.isLoaded() && localData.loadData) {
        try { await localData.loadData(); } catch(e) { /* non-fatal */ }
    }
    if (localData && localData.isLoaded()) {
        dataSource = 'local-cad-bulk';

        const subjectResults = localData.searchByAddress(address);
        if (subjectResults.length > 0) {
            subjectVerified = true;
            subjectParcelId = subjectResults[0].accountNumber || subjectResults[0].propertyId || subjectResults[0].parcelNumber;

            // Enrich subject
            const cad = subjectResults[0];
            if (!subject.sqft && cad.sqft) subject.sqft = cad.sqft;
            if (!subject.yearBuilt && cad.yearBuilt) subject.yearBuilt = parseInt(cad.yearBuilt);
            if (!subject.landValue && cad.landValue) subject.landValue = cad.landValue;
            if (!subject.improvementValue && cad.improvementValue) subject.improvementValue = cad.improvementValue;
            if (!subject.propertyType && cad.propertyType) subject.propertyType = cad.propertyType;
            if (!subject.neighborhoodCode && cad.neighborhoodCode) subject.neighborhoodCode = cad.neighborhoodCode;
        }

        const rawComps = localData.findComps(subjectResults[0] || {
            address, appraisedValue: assessedValue, sqft: subject.sqft, yearBuilt: subject.yearBuilt
        }, { maxComps, maxValueDiff, sameType: true });

        for (const c of rawComps) {
            if (!c.address || !c.appraisedValue || c.appraisedValue <= 0) continue;
            if (!c.accountNumber && !c.propertyId && !c.parcelNumber) continue;
            comps.push({
                source: 'verified-cad',
                parcelId: c.accountNumber || c.propertyId || c.parcelNumber,
                address: c.address, assessedValue: c.appraisedValue,
                landValue: c.landValue, improvementValue: c.improvementValue,
                sqft: c.sqft, yearBuilt: c.yearBuilt ? parseInt(c.yearBuilt) : null,
                propertyType: c.propertyType, neighborhoodCode: c.neighborhoodCode,
                legalDescription: c.legalDescription, verified: true
            });
        }
    }

    // ─── SOURCE 2: TARRANT CAD ──────────────────────────────────────
    if (comps.length < MIN_COMPS && county === 'tarrant') {
        if (!tarrantData.isLoaded() && tarrantData.loadData) {
            try { await tarrantData.loadData(); } catch(e) { /* non-fatal */ }
        }
    }
    if (comps.length < MIN_COMPS && county === 'tarrant' && tarrantData.isLoaded()) {
        dataSource = dataSource || 'tarrant-cad';
        const streetOnly = address.replace(/,.*$/, '').replace(/\.[\s]*$/, '').trim();
        const tadResults = tarrantData.searchByAddress(streetOnly, 3);
        if (tadResults.length > 0) {
            subjectVerified = true;
            subjectParcelId = tadResults[0].accountNumber;
            if (!subject.sqft && tadResults[0].sqft) subject.sqft = tadResults[0].sqft;
            if (!subject.yearBuilt && tadResults[0].yearBuilt) subject.yearBuilt = tadResults[0].yearBuilt;
            if (!subject.propertyType && tadResults[0].propertyClassDesc) subject.propertyType = tadResults[0].propertyClassDesc;

            const tadComps = tarrantData.findComps({
                address, propertyClass: tadResults[0].propertyClass || 'A1',
                sqft: subject.sqft || tadResults[0].sqft,
                yearBuilt: subject.yearBuilt || tadResults[0].yearBuilt,
                legalDescription: tadResults[0].legalDescription,
                zipCode: tadResults[0].zipCode,
                maxResults: maxComps, sqftRange: expanded ? 0.35 : 0.30, yearRange: 15
            });

            for (const c of tadComps) {
                if (!c.accountNumber || !c.totalValue) continue;
                comps.push({
                    source: 'verified-cad', parcelId: c.accountNumber,
                    address: c.address, assessedValue: c.totalValue,
                    landValue: c.landValue, improvementValue: c.improvementValue,
                    sqft: c.sqft, yearBuilt: c.yearBuilt,
                    propertyType: c.propertyClassDesc,
                    neighborhoodCode: tarrantData.extractNeighborhood(c.legalDescription),
                    legalDescription: c.legalDescription, verified: true
                });
            }
        }
    }

    // ─── SOURCE 3: BIS E-SEARCH ─────────────────────────────────────
    if (comps.length < MIN_COMPS && isBISCounty(county)) {
        dataSource = dataSource || 'bis-live';
        try {
            const bisClient = getBISClient(county);
            const addrParts = address.replace(/,.*$/, '').trim().split(/\s+/);
            const streetNum = /^\d+$/.test(addrParts[0]) ? addrParts[0] : '';
            const streetName = streetNum
                ? addrParts.slice(1).filter(p => !['rd','dr','ln','ct','st','ave','blvd','way','pl','cir'].includes(p.toLowerCase())).join(' ')
                : addrParts.filter(p => !['rd','dr','ln','ct','st','ave','blvd','way','pl','cir'].includes(p.toLowerCase())).join(' ');

            if (streetNum && streetName) {
                const subjectResult = await bisClient.findProperty(streetNum, streetName);
                if (subjectResult) {
                    subjectVerified = true;
                    subjectParcelId = subjectResult.propertyId;
                    const bisComps = await bisClient.findComps(subjectResult, {
                        maxComps, valueRange: expanded ? 0.50 : 0.30
                    });
                    for (const c of bisComps) {
                        if (!c.propertyId || !c.appraisedValue) continue;
                        comps.push({
                            source: 'verified-cad', parcelId: c.propertyId, geoId: c.geoId,
                            address: c.address, assessedValue: c.appraisedValue,
                            sqft: null, yearBuilt: null, propertyType: c.propertyType,
                            neighborhoodCode: c.neighborhoodCode, subdivision: c.subdivision,
                            legalDescription: c.legalDescription, verified: true
                        });
                    }
                }
            }
        } catch (err) {
            console.error(`[VerifiedComp] BIS search failed: ${err.message}`);
        }
    }

    // Dedup
    const seenIds = new Set();
    comps = comps.filter(c => {
        const key = c.parcelId || c.address;
        if (seenIds.has(key)) return false;
        seenIds.add(key);
        return true;
    });

    return { comps, dataSource, subjectVerified, subjectParcelId };
}


// ═══════════════════════════════════════════════════════════════════
// MAIN: Find verified comps (two-pass system)
// ═══════════════════════════════════════════════════════════════════
async function findVerifiedComps(subject, caseData) {
    const county = normalizeCounty(caseData?.county || '');
    const address = subject?.address || caseData?.property_address || '';

    console.log(`[VerifiedComp] Starting verified analysis for: ${address} (${county})`);

    // ─── VALIDATION GATE ────────────────────────────────────────────
    if (!address) return insufficientData('No property address provided');
    if (!county) return insufficientData('No county identified');
    if (BLOCKED_COUNTIES.has(county)) {
        return insufficientData(`${county} county is BLOCKED — data source corrupted/unverified. Manual rebuild required.`);
    }
    if (!subject?.assessedValue && !caseData?.assessed_value) {
        return insufficientData('No assessed value available — need verified CAD value');
    }

    const assessedValue = subject.assessedValue || parseInt(String(caseData.assessed_value).replace(/[$,]/g, '')) || 0;
    if (assessedValue <= 0) return insufficientData('Assessed value is zero or invalid');

    // ═══════════════════════════════════════════════════════════════
    // PASS 1: LOCAL (same subdivision / neighborhood)
    // ═══════════════════════════════════════════════════════════════
    console.log(`[PASS 1] Local search for ${address}`);
    const pass1Raw = await gatherRawComps(county, address, subject, assessedValue, { expanded: false });

    if (pass1Raw.comps.length >= MIN_COMPS) {
        const { comps: pass1Filtered, rejected: pass1Rejected } = applyStrictFilters(
            pass1Raw.comps, assessedValue, subject, 'PASS 1'
        );

        if (pass1Filtered.length >= MIN_COMPS) {
            const scored = scoreComps(pass1Filtered, assessedValue, subject);
            const avgScore = scored.reduce((s, c) => s + c.score, 0) / scored.length;

            if (avgScore >= MIN_AVG_QUALITY_SCORE) {
                const result = buildResult(scored, assessedValue, county, address, subject,
                    pass1Raw.dataSource, pass1Raw.subjectVerified, pass1Raw.subjectParcelId,
                    pass1Rejected, 'PASS 1 LOCAL');

                if (result) {
                    console.log(`[PASS 1] ✅ ${result.comps.length} comps, ` +
                        `$${result.recommendedValue.toLocaleString()} (savings: $${result.estimatedSavings}/yr) ` +
                        `[${result.quality.confidenceLevel}]`);
                    return result;
                }
            }
            console.log(`[PASS 1] ❌ Quality score too low (${avgScore.toFixed(0)})`);
        } else {
            console.log(`[PASS 1] ❌ Only ${pass1Filtered.length} comps after strict filters`);
        }
    } else {
        console.log(`[PASS 1] ❌ Only ${pass1Raw.comps.length} raw comps found`);
    }

    // ═══════════════════════════════════════════════════════════════
    // PASS 2: EXPANDED (wider geography, same strict filters)
    // ═══════════════════════════════════════════════════════════════
    console.log(`[PASS 2] Expanded search for ${address} (wider geography, same strict filters)`);
    const pass2Raw = await gatherRawComps(county, address, subject, assessedValue, { expanded: true });

    if (pass2Raw.comps.length < MIN_COMPS) {
        return insufficientData(
            `PASS 1 + PASS 2 failed. Only ${pass2Raw.comps.length} raw comps found for ${address} in ${county}. ` +
            `Minimum ${MIN_COMPS} required. Data source: ${pass2Raw.dataSource || 'none'}.`
        );
    }

    const { comps: pass2Filtered, rejected: pass2Rejected } = applyStrictFilters(
        pass2Raw.comps, assessedValue, subject, 'PASS 2'
    );

    if (pass2Filtered.length < MIN_COMPS) {
        return insufficientData(
            `PASS 2: Only ${pass2Filtered.length} comp(s) remain after strict filtering for ${address} in ${county}. ` +
            `Rejected: value=${pass2Rejected.value}, sqft=${pass2Rejected.sqft}, ` +
            `year=${pass2Rejected.year}, type=${pass2Rejected.propType}. ` +
            `Started with ${pass2Raw.comps.length}. Both passes failed. NO FALLBACK.`
        );
    }

    const scored2 = scoreComps(pass2Filtered, assessedValue, subject);
    const avgScore2 = scored2.reduce((s, c) => s + c.score, 0) / scored2.length;

    if (avgScore2 < MIN_AVG_QUALITY_SCORE) {
        return insufficientData(
            `PASS 2: Avg comp score ${avgScore2.toFixed(0)}/100 below minimum ${MIN_AVG_QUALITY_SCORE}. ` +
            `${pass2Filtered.length} comps exist but too dissimilar.`
        );
    }

    const result2 = buildResult(scored2, assessedValue, county, address, subject,
        pass2Raw.dataSource, pass2Raw.subjectVerified, pass2Raw.subjectParcelId,
        pass2Rejected, 'PASS 2 EXPANDED');

    if (result2) {
        console.log(`[PASS 2] ✅ EXPANDED: ${result2.comps.length} comps, ` +
            `$${result2.recommendedValue.toLocaleString()} (savings: $${result2.estimatedSavings}/yr) ` +
            `[${result2.quality.confidenceLevel}]`);
        return result2;
    }

    return insufficientData(`Both passes failed for ${address} in ${county}. No valid result could be built.`);
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
        engineVersion: '1.3.0-twopass'
    };
}

function normalizeCounty(county) {
    return (county || '').toLowerCase().replace(/\s*county\s*/i, '').trim();
}

module.exports = { findVerifiedComps, insufficientData };
