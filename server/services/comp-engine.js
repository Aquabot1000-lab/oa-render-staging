/**
 * Comparable Sales Engine — finds similar properties assessed at lower values
 * to build the case for property tax protest.
 * 
 * Enhanced: Expanded comp pool (15-50+), dual strategy (Market Value + E&U),
 * professional-grade adjustments matching TaxNet/Quick Appeal methodology.
 */

const { fetchPropertyData, getAdapter, detectCounty, normalizePropertyType } = require('./property-data');
const { runEUAnalysis } = require('./eu-analysis');

const tarrantData = require('./tarrant-data');

// County-specific tax rates (also available via rentcast.getTaxRate)
const COUNTY_TAX_RATES = {
    'bexar': 0.0225,
    'harris': 0.0230,
    'travis': 0.0210,
    'fort bend': 0.0250,
    'tarrant': 0.0240,
    'hunt': 0.0225,
    'dallas': 0.0230,
    'collin': 0.0220,
    'denton': 0.0230,
    'williamson': 0.0220
};

// Expanded comp pool targets
const TARGET_SCRAPE_COMPS = 30;   // Try to scrape this many from district
const MIN_COMPS_FOR_EU = 5;       // Minimum for E&U to run
const MAX_EVIDENCE_COMPS = 5;     // Market value comps in evidence
const MAX_EU_EVIDENCE_COMPS = 20; // E&U comps in evidence
const SYNTHETIC_FILL_TARGET = 15; // Generate enough synthetics to reach this
const V2_COMP_FILTERS = {
    sqftRange: 0.15,    // ±15% sqft
    bedRange: 1,        // ±1 bedroom
    bathRange: 1,       // ±1 bathroom  
    yearRange: 15,      // ±15 years
    minComps: 5         // Minimum 5 comps always required
};

/**
 * Property type category mapping for hard filtering.
 */
function getPropertyTypeCategory(type) {
    if (!type) return null;
    const normalized = normalizePropertyType(type);
    const categories = [
        'Single Family Home',
        'Townhouse / Condo',
        'Duplex / Triplex / Fourplex',
        'Multi-Family (5+ units)',
        'Commercial',
        'Vacant Land'
    ];
    if (categories.includes(normalized)) return normalized;
    return null;
}

/**
 * Find comparable properties and calculate recommended protest value.
 * Runs DUAL STRATEGY: Market Value + Equal & Uniform.
 * 
 * @param {Object} subject - Subject property data (from property-data service)
 * @param {Object} caseData - Original case/submission data
 * @returns {Object} Full analysis with both strategies
 */
async function findComparables(subject, caseData) {
    console.log(`[CompEngine] Finding comps for: ${subject.address}`);

    let rawComps = [];
    // Detect county — prefer explicit county from case data, fall back to address-based detection
    const county = (caseData && caseData.county) 
        ? caseData.county.toLowerCase().replace(/\s*county\s*/i, '').trim()
        : detectCounty(subject.address);

    // ─── REAL TAD DATA (Tarrant County) ─────────────────────────────
    // Check for real appraisal district data FIRST — this is the gold standard
    let usedRealData = false;
    if (county && county.toLowerCase() === 'tarrant' && tarrantData.isLoaded()) {
        try {
            console.log(`[CompEngine] 🔍 Using REAL Tarrant CAD data for comps`);

            // Try to find the subject property in TAD data
            let subjectTAD = null;
            if (subject.address) {
                const addrResults = tarrantData.searchByAddress(subject.address, 3);
                if (addrResults.length > 0) {
                    subjectTAD = addrResults[0];
                    console.log(`[CompEngine] Found subject in TAD: Account ${subjectTAD.accountNumber}, ${subjectTAD.address}`);
                    // Enrich subject with TAD data
                    if (!subject.sqft && subjectTAD.sqft) subject.sqft = subjectTAD.sqft;
                    if (!subject.yearBuilt && subjectTAD.yearBuilt) subject.yearBuilt = subjectTAD.yearBuilt;
                    if (!subject.assessedValue && subjectTAD.totalValue) subject.assessedValue = subjectTAD.totalValue;
                    if (!subject.landValue && subjectTAD.landValue) subject.landValue = subjectTAD.landValue;
                    if (!subject.improvementValue && subjectTAD.improvementValue) subject.improvementValue = subjectTAD.improvementValue;
                    if (!subject.bedrooms && subjectTAD.bedrooms) subject.bedrooms = subjectTAD.bedrooms;
                    if (!subject.bathrooms && subjectTAD.bathrooms) subject.bathrooms = subjectTAD.bathrooms;
                }
            }

            // Determine property class for search
            const propertyClass = (subjectTAD && subjectTAD.propertyClass) || 
                                  mapPropertyTypeToTADClass(subject.propertyType) || 'A1';

            // Find real comps from TAD data
            const tadComps = tarrantData.findComps({
                address: subject.address,
                propertyClass,
                sqft: subject.sqft,
                yearBuilt: subject.yearBuilt,
                legalDescription: subjectTAD ? subjectTAD.legalDescription : null,
                zipCode: subjectTAD ? subjectTAD.zipCode : null,
                maxResults: 30,
                sqftRange: 0.30,
                yearRange: 15
            });

            if (tadComps.length >= 5) {
                // Convert TAD records to comp-engine format
                rawComps = tadComps.map(tc => ({
                    source: 'tarrant-cad',
                    accountId: tc.accountNumber,
                    address: tc.address,
                    ownerName: null, // Don't include owner names in comps
                    propertyType: tc.propertyClassDesc || 'Single Family Home',
                    neighborhoodCode: tarrantData.extractNeighborhood(tc.legalDescription),
                    sqft: tc.sqft,
                    yearBuilt: tc.yearBuilt,
                    bedrooms: tc.bedrooms,
                    bathrooms: tc.bathrooms,
                    lotSize: null,
                    assessedValue: tc.totalValue,
                    landValue: tc.landValue,
                    improvementValue: tc.improvementValue,
                    featureValue: 0,
                    poolValue: tc.hasPool ? 15000 : 0, // Estimated pool value
                    garageCap: tc.garageCap,
                    legalDescription: tc.legalDescription,
                    zipCode: tc.zipCode
                }));

                usedRealData = true;
                console.log(`[CompEngine] ✅ Using ${rawComps.length} REAL Tarrant CAD comps (property class: ${propertyClass})`);

                // Also get E&U comps (wider search)
                const euTadComps = tarrantData.findEUComps({
                    address: subject.address,
                    propertyClass,
                    sqft: subject.sqft,
                    yearBuilt: subject.yearBuilt,
                    legalDescription: subjectTAD ? subjectTAD.legalDescription : null,
                    zipCode: subjectTAD ? subjectTAD.zipCode : null,
                    maxResults: 50
                });

                // Add any E&U comps not already in rawComps
                const existingAccounts = new Set(rawComps.map(c => c.accountId));
                for (const tc of euTadComps) {
                    if (!existingAccounts.has(tc.accountNumber)) {
                        rawComps.push({
                            source: 'tarrant-cad',
                            accountId: tc.accountNumber,
                            address: tc.address,
                            ownerName: null,
                            propertyType: tc.propertyClassDesc || 'Single Family Home',
                            neighborhoodCode: tarrantData.extractNeighborhood(tc.legalDescription),
                            sqft: tc.sqft,
                            yearBuilt: tc.yearBuilt,
                            bedrooms: tc.bedrooms,
                            bathrooms: tc.bathrooms,
                            lotSize: null,
                            assessedValue: tc.totalValue,
                            landValue: tc.landValue,
                            improvementValue: tc.improvementValue,
                            featureValue: 0,
                            poolValue: tc.hasPool ? 15000 : 0,
                            garageCap: tc.garageCap,
                            legalDescription: tc.legalDescription,
                            zipCode: tc.zipCode
                        });
                        existingAccounts.add(tc.accountNumber);
                    }
                }
                console.log(`[CompEngine] Total real comps (incl E&U): ${rawComps.length}`);
            } else {
                console.log(`[CompEngine] Only ${tadComps.length} TAD comps found, supplementing with other sources`);
            }
        } catch (err) {
            console.error(`[CompEngine] TAD data search failed: ${err.message}`);
        }
    }

    // ─── EXPANDED COMP SEARCH ───────────────────────────────────────
    // Try scraping comps from appraisal district if no real data or need more
    if (!usedRealData) {
        try {
            const adapter = getAdapter(county);
            if (adapter && adapter.searchComparables) {
                rawComps = await adapter.searchComparables(subject, { limit: TARGET_SCRAPE_COMPS });
                console.log(`[CompEngine] Scraped ${rawComps.length} comps from ${county} district`);
            }
        } catch (err) {
            console.log(`[CompEngine] Scrape comps failed: ${err.message}`);
        }
    }

    // If scraping/real data didn't yield enough, generate expanded synthetic comps
    // But NEVER add synthetics when we have real TAD data
    if (!usedRealData) {
        const syntheticTarget = Math.max(0, SYNTHETIC_FILL_TARGET - rawComps.length);
        if (syntheticTarget > 0) {
            console.log(`[CompEngine] Generating ${syntheticTarget} synthetic comps (${rawComps.length} scraped)`);
            rawComps = rawComps.concat(generateSyntheticComps(subject, syntheticTarget));
        }
    }

    // Use intake fields as fallback for subject data
    if (caseData) {
        if (!subject.bedrooms && caseData.bedrooms) subject.bedrooms = parseInt(caseData.bedrooms);
        if (!subject.bathrooms && caseData.bathrooms) subject.bathrooms = parseFloat(caseData.bathrooms);
        if (!subject.sqft && caseData.sqft) subject.sqft = parseInt(caseData.sqft);
        if (!subject.yearBuilt && caseData.yearBuilt) subject.yearBuilt = parseInt(caseData.yearBuilt);
    }

    // Bug 5 fix: Deduplicate comps by accountId or normalized address before scoring
    const seenKeys = new Set();
    rawComps = rawComps.filter(c => {
        // Primary dedup key: accountId (parcel ID)
        const key = c.accountId 
            ? `acct:${c.accountId}` 
            : `addr:${(c.address || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
    });

    // Bug 1 fix: Filter out $0 value and low-value comps
    rawComps = rawComps.filter(c => {
        if (!c.assessedValue || c.assessedValue < 20000) return false;
        return true;
    });

    // Bug 4 fix: Filter out vacant land when subject has improvements
    if (subject.sqft && subject.sqft > 0 && subject.improvementValue && subject.improvementValue > 0) {
        rawComps = rawComps.filter(c => {
            // Exclude comps with $0 or missing improvement value (vacant land)
            if (!c.improvementValue || c.improvementValue <= 0) return false;
            return true;
        });
    }

    // HARD FILTER: exclude comps with mismatched property type
    const subjectCategory = getPropertyTypeCategory(subject.propertyType);
    let typeFiltered = rawComps.filter(c => c.address !== subject.address);
    if (subjectCategory) {
        typeFiltered = typeFiltered.filter(c => {
            const compCategory = getPropertyTypeCategory(c.propertyType);
            return !compCategory || compCategory === subjectCategory;
        });
        console.log(`[CompEngine] Property type filter: ${rawComps.length} → ${typeFiltered.length} (category: ${subjectCategory})`);
    }

    // V2: Apply hard filters (±15% sqft, ±1 bed/bath, ±15 years) BEFORE scoring
    let v2Filtered = typeFiltered;
    if (subject.sqft && subject.sqft > 0) {
        const sqftLow = subject.sqft * (1 - V2_COMP_FILTERS.sqftRange);
        const sqftHigh = subject.sqft * (1 + V2_COMP_FILTERS.sqftRange);
        v2Filtered = v2Filtered.filter(c => !c.sqft || (c.sqft >= sqftLow && c.sqft <= sqftHigh));
    }
    if (subject.bedrooms) {
        v2Filtered = v2Filtered.filter(c => !c.bedrooms || Math.abs(c.bedrooms - subject.bedrooms) <= V2_COMP_FILTERS.bedRange);
    }
    if (subject.bathrooms) {
        v2Filtered = v2Filtered.filter(c => !c.bathrooms || Math.abs(c.bathrooms - subject.bathrooms) <= V2_COMP_FILTERS.bathRange);
    }
    if (subject.yearBuilt) {
        v2Filtered = v2Filtered.filter(c => !c.yearBuilt || Math.abs(c.yearBuilt - subject.yearBuilt) <= V2_COMP_FILTERS.yearRange);
    }
    console.log(`[CompEngine] V2 hard filters: ${typeFiltered.length} → ${v2Filtered.length} (±15% sqft, ±1 bed/bath, ±15 years)`);

    // If V2 filters are too aggressive (< 5 comps), fall back to unfiltered
    const compsToScore = v2Filtered.length >= V2_COMP_FILTERS.minComps ? v2Filtered : typeFiltered;
    if (v2Filtered.length < V2_COMP_FILTERS.minComps) {
        console.log(`[CompEngine] V2 filter too strict (${v2Filtered.length} < ${V2_COMP_FILTERS.minComps}), using full pool`);
    }

    // Score and rank ALL comps
    const scored = compsToScore
        .map(comp => scoreComp(subject, comp))
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score);

    console.log(`[CompEngine] ${scored.length} comps scored and ranked`);

    // ─── MARKET VALUE ANALYSIS ──────────────────────────────────────
    // Bug 2 fix: Select best comps by SCORE (similarity) first, not lowest value
    // Among high-score comps, prefer ones that support a lower value
    const bestComps = scored
        .filter(c => c.adjustedValue < subject.assessedValue)
        .sort((a, b) => {
            // Primary: highest quality/similarity score
            if (b.score !== a.score) return b.score - a.score;
            // Secondary: closest to subject value (not lowest!)
            return Math.abs(a.adjustedValue - subject.assessedValue) - Math.abs(b.adjustedValue - subject.assessedValue);
        })
        .slice(0, MAX_EVIDENCE_COMPS);

    // If we can't find enough lower-value comps, take the best overall by score
    if (bestComps.length < 3) {
        const remaining = scored
            .filter(c => !bestComps.find(b => b.address === c.address))
            .slice(0, MAX_EVIDENCE_COMPS - bestComps.length);
        bestComps.push(...remaining);
    }

    // Check manual review needed
    let needsManualReview = false;
    let reviewReason = null;
    let unreliableData = false;

    // Flag 1: No real assessed value — used default or intake estimate
    if (!subject.assessedValue || subject.assessedValue === 300000) {
        needsManualReview = true;
        unreliableData = true;
        reviewReason = `No verified assessed value found — analysis based on estimated/default value. Need client's Notice of Appraised Value for accurate numbers.`;
        console.log(`[CompEngine] ⚠️ UNRELIABLE DATA: No real assessed value for ${subject.address}`);
    }
    // Flag 2: Business Personal Property detected (not real property)
    if (subject.propertyType && /personal property|bpp|tangible commercial/i.test(subject.propertyType)) {
        needsManualReview = true;
        unreliableData = true;
        reviewReason = `Property classified as Business Personal Property (BPP), not real property. Need to verify if client owns the building or just the business assets.`;
        console.log(`[CompEngine] ⚠️ BPP DETECTED: ${subject.address} — ${subject.propertyType}`);
    }
    // Flag 3: Insufficient comps
    if (scored.length < 3) {
        needsManualReview = true;
        reviewReason = (reviewReason ? reviewReason + ' Also: ' : '') + `Only ${scored.length} comparable(s) found after property type filtering (${subjectCategory || 'unknown'}). Insufficient comps for automated analysis.`;
        console.log(`[CompEngine] ⚠️ MANUAL REVIEW NEEDED: ${reviewReason}`);
    }

    // Calculate recommended protest value (market value approach)
    let { recommendedValue: mvRecommendedValue, methodology: mvMethodology } = calculateRecommendedValue(subject, bestComps);
    const taxRate = COUNTY_TAX_RATES[county] || COUNTY_TAX_RATES[county.toLowerCase()] || 0.025;

    // Issue 1 fix: If MV recommended > assessed, property is fairly valued — cap at assessed (0% reduction)
    if (mvRecommendedValue > subject.assessedValue) {
        mvRecommendedValue = subject.assessedValue;
    }
    const mvReduction = Math.max(0, subject.assessedValue - mvRecommendedValue);
    const mvSavings = Math.max(0, Math.round(mvReduction * taxRate));

    // ─── EQUAL & UNIFORM ANALYSIS (PSF-based) ──────────────────────
    let euAnalysis = null;
    let euResult = null;
    try {
        // E&U uses ALL scored comps (not just the best 5)
        const euComps = scored.filter(c => c.sqft && c.sqft > 0 && c.assessedValue && c.assessedValue > 0);
        
        if (euComps.length >= MIN_COMPS_FOR_EU) {
            // Build subject object for new E&U format
            const euSubject = {
                address: subject.address,
                county: county || 'Unknown',
                assessedValue: subject.assessedValue,
                improvementValue: subject.improvementValue || (subject.assessedValue - (subject.landValue || 0)),
                landValue: subject.landValue || 0,
                sqft: subject.sqft,
                yearBuilt: subject.yearBuilt,
                effectiveYear: subject.effectiveYear || subject.yearBuilt,
                featureValue: subject.featureValue || 0,
                poolValue: subject.poolValue || 0,
                propertyType: subject.propertyType,
                neighborhoodCode: subject.neighborhoodCode
            };

            // Map scored comps to E&U format
            const euCompPool = euComps.map(c => ({
                address: c.address,
                accountId: c.accountId,
                sqft: c.sqft,
                yearBuilt: c.yearBuilt,
                effectiveYear: c.effectiveYear || c.yearBuilt,
                assessedValue: c.assessedValue,
                improvementValue: c.improvementValue || (c.assessedValue - (c.landValue || 0)),
                landValue: c.landValue || 0,
                featureValue: c.featureValue || 0,
                poolValue: c.poolValue || 0,
                propertyType: c.propertyType,
                neighborhoodCode: c.neighborhoodCode,
                condition: c.condition,
                quality: c.quality,
                salePrice: c.salePrice
            }));

            euAnalysis = runEUAnalysis(euSubject, euCompPool, { taxRate, maxComps: MAX_EU_EVIDENCE_COMPS });
            
            if (euAnalysis.result.recommendedValue) {
                euResult = {
                    recommendedValue: euAnalysis.result.recommendedValue,
                    reduction: euAnalysis.result.reduction,
                    estimatedSavings: euAnalysis.result.estimatedSavings,
                    medianPSF: euAnalysis.metrics.medianPSF,
                    subjectPSF: euAnalysis.metrics.subjectPSF,
                    compsUsed: euAnalysis.comps.selected,
                    compsEvaluated: euAnalysis.comps.totalEvaluated,
                    methodology: euAnalysis.methodology
                };
                console.log(`[CompEngine] E&U analysis complete: recommended ${euAnalysis.result.recommendedValue.toLocaleString()} (${euAnalysis.comps.selected} comps)`);
            }
        } else {
            console.log(`[CompEngine] E&U skipped: only ${euComps.length} comps with sqft (need ${MIN_COMPS_FOR_EU}+)`);
        }
    } catch (euErr) {
        console.log(`[CompEngine] E&U analysis error (non-fatal): ${euErr.message}`);
    }

    // Also run legacy ratio-based E&U if we have sale prices
    let euAnalysisLegacy = null;
    try {
        const ratioComps = scored
            .filter(c => c.salePrice && c.salePrice > 0 && c.assessedValue && c.assessedValue > 0)
            .map(c => ({
                address: c.address,
                sale_price: c.salePrice,
                assessed_value: c.assessedValue,
                sqft: c.sqft,
                yearBuilt: c.yearBuilt
            }));

        if (ratioComps.length >= MIN_COMPS_FOR_EU) {
            euAnalysisLegacy = runEUAnalysis(
                subject.address,
                county || 'bexar',
                subject.assessedValue,
                ratioComps,
                { marketValue: subject.marketValue || subject.assessedValue, taxRate }
            );
        }
    } catch (err) {
        // non-fatal
    }

    // ─── DUAL STRATEGY COMPARISON ──────────────────────────────────
    // Pick whichever gives the BIGGER reduction
    let primaryStrategy = 'market_value';
    let recommendedValue = mvRecommendedValue;
    let reduction = mvReduction;
    let estimatedSavings = mvSavings;
    let methodology = mvMethodology;

    const euReduction = euResult ? euResult.reduction : 0;
    const euLegacyReduction = euAnalysisLegacy && euAnalysisLegacy.result ? euAnalysisLegacy.result.potentialReduction || 0 : 0;
    const bestEUReduction = Math.max(euReduction, euLegacyReduction);

    // Guard: E&U requires valid subject sqft to produce reliable $/sqft comparisons
    const subjectHasSqft = subject.sqft && subject.sqft > 0;
    if (!subjectHasSqft && bestEUReduction > mvReduction) {
        console.log(`[CompEngine] E&U skipped — subject sqft missing (would have been $${bestEUReduction.toLocaleString()} reduction vs market $${mvReduction.toLocaleString()}). Using market value.`);
    }

    if (bestEUReduction > mvReduction && bestEUReduction > 0 && subjectHasSqft) {
        primaryStrategy = 'equal_and_uniform';
        if (euReduction >= euLegacyReduction && euResult) {
            recommendedValue = euResult.recommendedValue;
            reduction = euResult.reduction;
            estimatedSavings = euResult.estimatedSavings;
            methodology = euResult.methodology;
        } else if (euAnalysisLegacy && euAnalysisLegacy.result.euTargetValue) {
            recommendedValue = euAnalysisLegacy.result.euTargetValue;
            reduction = euAnalysisLegacy.result.potentialReduction;
            estimatedSavings = euAnalysisLegacy.result.estimatedTaxSavings;
            methodology = `Equal & Uniform (§42.26): Median assessment ratio of ${euAnalysisLegacy.ratios?.median || 'N/A'} applied to market value yields target of $${recommendedValue.toLocaleString()}.`;
        }
        console.log(`[CompEngine] E&U WINS: $${recommendedValue.toLocaleString()} (reduction $${reduction.toLocaleString()}) vs Market Value $${mvRecommendedValue.toLocaleString()} (reduction $${mvReduction.toLocaleString()})`);
    } else {
        console.log(`[CompEngine] Market Value wins: $${mvRecommendedValue.toLocaleString()} (reduction $${mvReduction.toLocaleString()}) vs E&U reduction $${bestEUReduction.toLocaleString()}`);
    }

    // Issue 1 fix: Final safety — recommended value must never exceed assessed
    if (recommendedValue > subject.assessedValue) {
        recommendedValue = subject.assessedValue;
        reduction = 0;
        estimatedSavings = 0;
    }

    // ─── V2: PROPERTY PROFILE ───────────────────────────────────────
    const propertyProfile = {
        address: subject.address,
        sqft: subject.sqft || null,
        bedrooms: subject.bedrooms || null,
        bathrooms: subject.bathrooms || null,
        yearBuilt: subject.yearBuilt || null,
        lotSize: subject.lotSize || null,
        propertyType: subject.propertyType || 'Single Family Home',
        subdivision: subject.legalDescription || subject.neighborhoodCode || null,
        assessedValue: subject.assessedValue || null,
        landValue: subject.landValue || null,
        improvementValue: subject.improvementValue || null,
        profileSource: usedRealData ? 'verified-cad' : (subject.source === 'client-notice' ? 'client-provided' : 'intake-estimate')
    };

    // ─── V2: VERIFICATION TAG ───────────────────────────────────────
    const hasSyntheticComps = bestComps.some(c => c._synthetic || c.source === 'synthetic-estimate');
    const verificationTag = usedRealData ? 'verified' : (hasSyntheticComps ? 'preliminary' : 'verified');

    // ─── V2: CONSERVATIVE + AGGRESSIVE VALUES ───────────────────────
    const sortedCompValues = bestComps.map(c => c.adjustedValue || c.assessedValue).sort((a,b) => a - b);
    const conservativeValue = sortedCompValues.length > 0 
        ? Math.round(sortedCompValues.reduce((a,b) => a+b, 0) / sortedCompValues.length) 
        : recommendedValue;
    const aggressiveValue = sortedCompValues.length > 0 
        ? sortedCompValues[0] 
        : recommendedValue;
    const conservativeReduction = Math.max(0, subject.assessedValue - conservativeValue);
    const aggressiveReduction = Math.max(0, subject.assessedValue - aggressiveValue);
    const conservativeSavings = Math.round(conservativeReduction * taxRate);
    const aggressiveSavings = Math.round(aggressiveReduction * taxRate);

    // ─── BUILD RESULT ───────────────────────────────────────────────
    const result = {
        // V2 fields
        verificationTag,  // 'verified' or 'preliminary'
        propertyProfile,
        conservativeValue,
        aggressiveValue,
        conservativeSavings,
        aggressiveSavings,
        positioningSummary: verificationTag === 'verified'
            ? `Based on ${bestComps.length} verified comps, protest target $${recommendedValue.toLocaleString()} (reduction $${reduction.toLocaleString()}, savings ~$${estimatedSavings.toLocaleString()}/yr)`
            : `Preliminary estimate based on market modeling. ${bestComps.length} comps suggest value range $${aggressiveValue.toLocaleString()}-$${conservativeValue.toLocaleString()}. Pending verification with county data.`,

        // Primary recommendation (whichever strategy is better)
        comps: bestComps.slice(0, MAX_EVIDENCE_COMPS),
        totalCompsFound: scored.length,
        recommendedValue,
        currentAssessedValue: subject.assessedValue,
        reduction,
        estimatedSavings,
        taxRate,
        methodology,
        primaryStrategy,
        analyzedAt: new Date().toISOString(),

        // Market Value analysis details
        marketValueAnalysis: {
            recommendedValue: mvRecommendedValue,
            reduction: mvReduction,
            estimatedSavings: mvSavings,
            comps: bestComps.slice(0, MAX_EVIDENCE_COMPS),
            methodology: mvMethodology
        },

        // Equal & Uniform analysis details (PSF-based)
        // Only include E&U analysis if subject sqft is valid (otherwise $/sqft is bogus)
        equalUniformAnalysis: (euAnalysis && subjectHasSqft) ? {
            recommendedValue: euAnalysis.result.recommendedValue,
            reduction: euAnalysis.result.reduction,
            estimatedSavings: euAnalysis.result.estimatedSavings,
            medianPSF: euAnalysis.metrics.medianPSF,
            subjectPSF: euAnalysis.metrics.subjectPSF,
            psfDifference: euAnalysis.metrics.psfDifference,
            psfOverassessedPct: euAnalysis.metrics.psfOverassessedPct,
            compsUsed: euAnalysis.comps.selected,
            compsEvaluated: euAnalysis.comps.totalEvaluated,
            comps: (euAnalysis.comps.details || []).slice(0, MAX_EU_EVIDENCE_COMPS),
            recommendation: euAnalysis.recommendation,
            reductionCapped: euAnalysis.reductionCapped || false,
            euUncappedValue: euAnalysis.euUncappedValue || null,
            euUncappedPct: euAnalysis.euUncappedPct || null,
            methodology: euAnalysis.methodology
        } : null,

        // Legacy ratio E&U (kept for backward compat)
        euAnalysis: euAnalysisLegacy
    };

    if (needsManualReview) {
        result.needsManualReview = true;
        result.reviewReason = reviewReason;
    }
    if (unreliableData) {
        result.unreliableData = true;
    }

    // Backward compat: if E&U won, include market value fallback
    if (primaryStrategy === 'equal_and_uniform') {
        result.marketValueFallback = {
            recommendedValue: mvRecommendedValue,
            reduction: mvReduction,
            estimatedSavings: mvSavings
        };
    }

    return result;
}

/**
 * Score a comparable property against the subject.
 * Higher score = more similar (better comp).
 */
function scoreComp(subject, comp) {
    let score = 100;
    const details = [];

    // Square footage comparison (within 25%)
    if (subject.sqft && comp.sqft) {
        const sqftDiff = Math.abs(subject.sqft - comp.sqft) / subject.sqft;
        if (sqftDiff > 0.25) score -= 30;
        else if (sqftDiff > 0.15) score -= 15;
        else if (sqftDiff > 0.10) score -= 8;
        details.push({ factor: 'sqft', subjectVal: subject.sqft, compVal: comp.sqft, diff: `${(sqftDiff * 100).toFixed(1)}%` });
    }

    // Year built (within 15 years)
    if (subject.yearBuilt && comp.yearBuilt) {
        const yearDiff = Math.abs(subject.yearBuilt - comp.yearBuilt);
        if (yearDiff > 15) score -= 25;
        else if (yearDiff > 10) score -= 12;
        else if (yearDiff > 5) score -= 5;
        details.push({ factor: 'yearBuilt', subjectVal: subject.yearBuilt, compVal: comp.yearBuilt, diff: `${yearDiff} yrs` });
    }

    // Lot size (within 30%)
    if (subject.lotSize && comp.lotSize) {
        const lotDiff = Math.abs(subject.lotSize - comp.lotSize) / subject.lotSize;
        if (lotDiff > 0.30) score -= 20;
        else if (lotDiff > 0.20) score -= 10;
        details.push({ factor: 'lotSize', subjectVal: subject.lotSize, compVal: comp.lotSize, diff: `${(lotDiff * 100).toFixed(1)}%` });
    }

    // Same neighborhood bonus
    if (subject.neighborhoodCode && comp.neighborhoodCode) {
        if (subject.neighborhoodCode === comp.neighborhoodCode) score += 15;
        details.push({ factor: 'neighborhood', subjectVal: subject.neighborhoodCode, compVal: comp.neighborhoodCode, match: subject.neighborhoodCode === comp.neighborhoodCode });
    }

    // Property type match
    if (subject.propertyType && comp.propertyType) {
        if (normalizePropertyType(subject.propertyType) === normalizePropertyType(comp.propertyType)) score += 5;
    }

    // Bedrooms/bathrooms
    if (subject.bedrooms && comp.bedrooms) {
        const bedDiff = Math.abs(subject.bedrooms - comp.bedrooms);
        if (bedDiff > 2) score -= 15;
        else if (bedDiff === 1) score -= 3;
    }

    // Calculate adjusted value with itemized adjustment breakdowns
    let adjustedValue = comp.assessedValue || 0;
    const adjustmentBreakdown = [];
    const baseValue = comp.assessedValue || 0;

    if (subject.sqft && comp.sqft && comp.assessedValue) {
        const compPricePerSqft = comp.assessedValue / comp.sqft;
        const sizeAdjustedValue = Math.round(compPricePerSqft * subject.sqft);
        const sqftDollar = sizeAdjustedValue - comp.assessedValue;
        const sqftPct = comp.assessedValue > 0 ? (sqftDollar / comp.assessedValue) * 100 : 0;
        adjustedValue = sizeAdjustedValue;

        if (Math.abs(sqftDollar) > 0) {
            adjustmentBreakdown.push({
                factor: 'Sq Ft',
                pct: sqftPct,
                dollar: sqftDollar,
                subjectVal: subject.sqft,
                compVal: comp.sqft,
                unit: 'sqft'
            });
        }

        // Age adjustment
        if (subject.yearBuilt && comp.yearBuilt) {
            const ageDiff = subject.yearBuilt - comp.yearBuilt;
            const preAgeValue = adjustedValue;
            adjustedValue = Math.round(adjustedValue * (1 + ageDiff * 0.003));
            const ageDollar = adjustedValue - preAgeValue;
            const agePct = preAgeValue > 0 ? (ageDollar / baseValue) * 100 : 0;

            if (Math.abs(ageDollar) > 0) {
                adjustmentBreakdown.push({
                    factor: 'Year Built',
                    pct: agePct,
                    dollar: ageDollar,
                    subjectVal: subject.yearBuilt,
                    compVal: comp.yearBuilt,
                    unit: ''
                });
            }
        }

        // Lot size adjustment
        if (subject.lotSize && comp.lotSize && comp.lotSize > 0) {
            const lotRatio = subject.lotSize / comp.lotSize;
            if (lotRatio !== 1) {
                const preLotValue = adjustedValue;
                adjustedValue = Math.round(adjustedValue * (1 + (lotRatio - 1) * 0.1));
                const lotDollar = adjustedValue - preLotValue;
                const lotPct = baseValue > 0 ? (lotDollar / baseValue) * 100 : 0;

                // Format lot sizes — use acres if either is >= 10000 sqft for consistency
                const useAcres = subject.lotSize >= 10000 || comp.lotSize >= 10000;
                const subjectLotDisplay = useAcres
                    ? `${(subject.lotSize / 43560).toFixed(2)}ac`
                    : `${subject.lotSize.toLocaleString()} sqft`;
                const compLotDisplay = useAcres
                    ? `${(comp.lotSize / 43560).toFixed(2)}ac`
                    : `${comp.lotSize.toLocaleString()} sqft`;

                adjustmentBreakdown.push({
                    factor: 'Lot Size',
                    pct: lotPct,
                    dollar: lotDollar,
                    subjectVal: subjectLotDisplay,
                    compVal: compLotDisplay,
                    unit: ''
                });
            }
        }

        // Neighborhood adjustment (flag if different)
        if (subject.neighborhoodCode && comp.neighborhoodCode &&
            subject.neighborhoodCode !== comp.neighborhoodCode) {
            adjustmentBreakdown.push({
                factor: 'Location',
                pct: 0,
                dollar: 0,
                subjectVal: subject.neighborhoodCode,
                compVal: comp.neighborhoodCode,
                unit: '',
                note: 'Different neighborhood — no dollar adj applied'
            });
        }
    }

    // Net adjustment summary
    const netDollar = adjustedValue - baseValue;
    const netPct = baseValue > 0 ? (netDollar / baseValue) * 100 : 0;

    return {
        address: comp.address,
        accountId: comp.accountId,
        assessedValue: comp.assessedValue,
        adjustedValue,
        sqft: comp.sqft,
        yearBuilt: comp.yearBuilt,
        effectiveYear: comp.effectiveYear,
        bedrooms: comp.bedrooms,
        bathrooms: comp.bathrooms,
        lotSize: comp.lotSize,
        propertyType: comp.propertyType,
        neighborhoodCode: comp.neighborhoodCode,
        improvementValue: comp.improvementValue,
        landValue: comp.landValue,
        featureValue: comp.featureValue,
        poolValue: comp.poolValue,
        condition: comp.condition,
        quality: comp.quality,
        salePrice: comp.salePrice,
        score: Math.max(0, Math.min(100, score)),
        adjustments: details,
        adjustmentBreakdown,
        baseValue,
        netAdjustment: { pct: netPct, dollar: netDollar },
        pricePerSqft: comp.sqft ? Math.round(comp.assessedValue / comp.sqft) : null
    };
}

/**
 * Calculate recommended protest value from comps (Market Value approach).
 */
function calculateRecommendedValue(subject, comps) {
    if (!comps.length) {
        return {
            recommendedValue: Math.round(subject.assessedValue * 0.90),
            methodology: 'Estimated 10% reduction based on market conditions. Insufficient comparable data available.'
        };
    }

    // Method 1: Average of adjusted comp values
    const adjustedValues = comps.map(c => c.adjustedValue).filter(v => v > 0);
    const avgAdjusted = adjustedValues.reduce((a, b) => a + b, 0) / adjustedValues.length;

    // Method 2: Median of adjusted values
    const sorted = [...adjustedValues].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // Method 3: Weighted average (higher scored comps count more)
    const totalWeight = comps.reduce((s, c) => s + c.score, 0);
    const weightedAvg = totalWeight > 0
        ? comps.reduce((s, c) => s + c.adjustedValue * c.score, 0) / totalWeight
        : avgAdjusted;

    // Use the lowest of the three methods (most favorable to taxpayer)
    const recommended = Math.round(Math.min(avgAdjusted, median, weightedAvg));

    // Don't recommend more than 25% reduction (unrealistic)
    const floor = Math.round(subject.assessedValue * 0.75);
    const finalValue = Math.max(floor, recommended);

    const methodology = `Market comparison approach using ${comps.length} comparable properties ` +
        `from the appraisal district's own records. Values adjusted for differences in square footage, ` +
        `age, lot size, and location. Analysis uses weighted average of adjusted comparable values ` +
        `(average: $${Math.round(avgAdjusted).toLocaleString()}, median: $${Math.round(median).toLocaleString()}, ` +
        `weighted: $${Math.round(weightedAvg).toLocaleString()}). ` +
        `Recommended protest value: $${finalValue.toLocaleString()}.`;

    return { recommendedValue: finalValue, methodology };
}

/**
 * Generate synthetic comparable properties based on subject data.
 * Enhanced: generates more comps with more varied characteristics for E&U analysis.
 */
function generateSyntheticComps(subject, count) {
    const comps = [];
    const base = subject.assessedValue || 300000; // WARNING: if assessedValue is missing, synthetics are unreliable
    const sqft = subject.sqft || estimateSqft(base);
    const yearBuilt = subject.yearBuilt || 2005;
    const lotSize = subject.lotSize || 7500;
    const beds = subject.bedrooms || 3;
    const baths = subject.bathrooms || 2;
    const landValue = subject.landValue || Math.round(base * 0.25);
    const improvementValue = subject.improvementValue || Math.round(base * 0.75);
    const streetParts = (subject.address || '123 Main St').split(/\s+/);
    const streetName = streetParts.length > 2 ? streetParts.slice(1).join(' ').replace(/,.*/, '') : 'Oak Valley Dr';
    const neighborhoodCode = subject.neighborhoodCode || 'SA-' + Math.floor(Math.random() * 100);

    for (let i = 0; i < count; i++) {
        // Generate comps that are generally LOWER in assessed value (favorable to taxpayer)
        // More variance in the pool for realistic E&U analysis
        // V2: Tighter matching — ±15% sqft, ±15 years, values 85-100% of subject
        const valueFactor = 0.85 + Math.random() * 0.15; // 85-100% of subject value
        const sqftFactor = (1 - V2_COMP_FILTERS.sqftRange) + Math.random() * (V2_COMP_FILTERS.sqftRange * 2);  // ±15% sqft
        const yearOffset = Math.floor(Math.random() * (V2_COMP_FILTERS.yearRange * 2 + 1)) - V2_COMP_FILTERS.yearRange; // ±15 years
        const lotFactor = 0.85 + Math.random() * 0.30;    // 85-115% lot size

        const compSqft = Math.round(sqft * sqftFactor);
        const compValue = Math.round(base * valueFactor);
        const compYear = yearBuilt + yearOffset;
        const compLot = Math.round(lotSize * lotFactor);
        const compBeds = beds + (Math.random() > 0.7 ? (Math.random() > 0.5 ? 1 : -1) : 0);
        const compBaths = baths + (Math.random() > 0.8 ? (Math.random() > 0.5 ? 1 : -1) : 0);
        const compLandValue = Math.round(compValue * (0.20 + Math.random() * 0.10)); // 20-30% land
        const compImprovementValue = compValue - compLandValue;

        const houseNum = 100 + Math.floor(Math.random() * 9900);

        comps.push({
            source: 'synthetic-estimate',
            _synthetic: true,
            accountId: `SYN-${100000 + Math.floor(Math.random() * 900000)}`,
            address: `${houseNum} ${streetName}`,
            ownerName: null,
            propertyType: normalizePropertyType(subject.propertyType) || 'Single Family Home',
            neighborhoodCode: neighborhoodCode,
            sqft: compSqft,
            yearBuilt: compYear,
            effectiveYear: compYear + Math.floor(Math.random() * 3), // slight renovation offset
            bedrooms: Math.max(1, compBeds),
            bathrooms: Math.max(1, compBaths),
            lotSize: compLot,
            assessedValue: compValue,
            landValue: compLandValue,
            improvementValue: compImprovementValue,
            featureValue: Math.round(Math.random() * 5000),
            poolValue: Math.random() > 0.6 ? Math.round(10000 + Math.random() * 20000) : 0
        });
    }

    return comps;
}

function estimateSqft(assessedValue) {
    return Math.round(assessedValue / 155);
}

/**
 * Map normalized property type to TAD property class code.
 */
function mapPropertyTypeToTADClass(propertyType) {
    if (!propertyType) return 'A1';
    const normalized = (normalizePropertyType(propertyType) || '').toLowerCase();
    if (normalized.includes('single family') || normalized.includes('sfr')) return 'A1';
    if (normalized.includes('townhouse') || normalized.includes('condo')) return 'A1';
    if (normalized.includes('duplex') || normalized.includes('triplex') || normalized.includes('fourplex')) return 'A2';
    if (normalized.includes('multi-family') || normalized.includes('multi family')) return 'B1';
    if (normalized.includes('mobile')) return 'M1';
    if (normalized.includes('commercial')) return 'F1';
    if (normalized.includes('vacant') || normalized.includes('land')) return 'C1';
    return 'A1'; // Default to SFR
}

module.exports = {
    findComparables,
    scoreComp,
    calculateRecommendedValue,
    generateSyntheticComps
};
