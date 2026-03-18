/**
 * Equal & Uniform (E&U) Analysis Module — Enhanced
 * Texas Tax Code §42.26 — proves unequal appraisal by comparing
 * the subject property's assessed $/sqft to comparable properties.
 *
 * Professional-grade: matches TaxNet/Quick Appeal and PDC methodology
 * used by firms like IntegraTax.
 *
 * Two approaches:
 *   1. PSF (Price per Square Foot) — compares improvement $/sqft with adjustments
 *   2. Ratio — compares assessed-to-sale ratios (original approach, kept as fallback)
 *
 * Integration: import { runEUAnalysis, generateEUReport } from './eu-analysis'
 */

const MIN_COMPS = 5;
const MAX_EU_COMPS = 20;       // Max comps in evidence packet
const EVAL_POOL_SIZE = 50;     // Evaluate up to 50, cherry-pick best
const RATIO_FLOOR = 0.50;
const RATIO_CEILING = 1.10;
const DEFAULT_TAX_RATE = 0.025;

// ─── Helpers ────────────────────────────────────────────────────────

function median(arr) {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr) {
    const m = mean(arr);
    if (m === null) return null;
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function round2(n) { return Math.round(n * 100) / 100; }
function dollars(n) { return '$' + Math.round(n).toLocaleString(); }
function pct(n) { return (n * 100).toFixed(1) + '%'; }

// ─── PSF Adjustment Functions ───────────────────────────────────────

/**
 * Calculate all E&U adjustments for a comp relative to the subject.
 * Returns the adjusted value and breakdown of each adjustment.
 *
 * Adjustments per professional methodology:
 *   SIZE:     (Comp_PSF × (Subject_Area - Comp_Area)) / 2
 *   AGE:      0.5 × (Subject_EffYear - Comp_EffYear) / 100
 *   LAND:     Comp_AdjValue - Comp_LandValue + Subject_LandValue
 *   FEATURES: Subject_FeatureValue - Comp_FeatureValue
 *   POOL:     Subject_PoolValue - Comp_PoolValue
 */
function calculateEUAdjustments(subject, comp) {
    const adjustments = {};
    let adjustedValue = comp.improvementValue || (comp.assessedValue - (comp.landValue || 0)) || comp.assessedValue;
    const compSqft = comp.sqft || 0;
    const subjectSqft = subject.sqft || 0;

    // Comp PSF (price per square foot of improvements)
    const compPSF = compSqft > 0 ? (comp.improvementValue || adjustedValue) / compSqft : 0;

    // SIZE adjustment: (Comp_PSF × (Subject_Area - Comp_Area)) / 2
    if (compPSF > 0 && subjectSqft > 0 && compSqft > 0) {
        const sizeAdj = (compPSF * (subjectSqft - compSqft)) / 2;
        adjustments.size = Math.round(sizeAdj);
        adjustedValue += adjustments.size;
    } else {
        adjustments.size = 0;
    }

    // AGE adjustment: value × 0.5 × (Subject_EffYear - Comp_EffYear) / 100
    // EffYear = effective year (yearBuilt or renovation year)
    const subjectEffYear = subject.effectiveYear || subject.yearBuilt || 0;
    const compEffYear = comp.effectiveYear || comp.yearBuilt || 0;
    if (subjectEffYear > 0 && compEffYear > 0) {
        const ageAdj = adjustedValue * 0.5 * (subjectEffYear - compEffYear) / 100;
        adjustments.age = Math.round(ageAdj);
        adjustedValue += adjustments.age;
    } else {
        adjustments.age = 0;
    }

    // LAND adjustment: swap comp's land value for subject's
    // AdjValue = AdjValue - Comp_LandValue + Subject_LandValue
    const subjectLand = subject.landValue || 0;
    const compLand = comp.landValue || 0;
    if (subjectLand > 0 || compLand > 0) {
        const landAdj = subjectLand - compLand;
        adjustments.land = Math.round(landAdj);
        adjustedValue += adjustments.land;
    } else {
        adjustments.land = 0;
    }

    // FEATURES adjustment: Subject_FeatureValue - Comp_FeatureValue
    const subjectFeatures = subject.featureValue || 0;
    const compFeatures = comp.featureValue || 0;
    if (subjectFeatures > 0 || compFeatures > 0) {
        adjustments.features = Math.round(subjectFeatures - compFeatures);
        adjustedValue += adjustments.features;
    } else {
        adjustments.features = 0;
    }

    // POOL adjustment: Subject_PoolValue - Comp_PoolValue
    const subjectPool = subject.poolValue || 0;
    const compPool = comp.poolValue || 0;
    if (subjectPool > 0 || compPool > 0) {
        adjustments.pool = Math.round(subjectPool - compPool);
        adjustedValue += adjustments.pool;
    } else {
        adjustments.pool = 0;
    }

    const totalAdjustment = Object.values(adjustments).reduce((s, v) => s + v, 0);

    return {
        compPSF: round2(compPSF),
        unadjustedValue: comp.improvementValue || comp.assessedValue,
        adjustedValue: Math.round(adjustedValue),
        totalAdjustment,
        adjustments
    };
}

// ─── Core PSF-Based E&U Analysis ────────────────────────────────────

/**
 * Run the professional E&U analysis using $/sqft of improvements.
 *
 * @param {Object} subject - Subject property data with fields:
 *   { address, county, assessedValue, improvementValue, landValue, sqft,
 *     yearBuilt, effectiveYear, featureValue, poolValue, propertyType, neighborhoodCode }
 * @param {Array<Object>} allComps - ALL comparable properties in the area
 * @param {Object} [options]
 * @param {number} [options.taxRate]
 * @param {number} [options.maxComps] - Max comps for evidence (default 20)
 * @param {number} [options.evalPool] - Max to evaluate internally (default 50)
 * @returns {Object} Full E&U analysis result with PSF methodology
 */
function runEUAnalysis(subject, allComps, options = {}) {
    // Support legacy call signature: (address, county, assessedValue, comps, options)
    if (typeof subject === 'string') {
        const address = subject;
        const county = allComps;
        const assessedValue = arguments[2];
        const comps = arguments[3];
        const opts = arguments[4] || {};
        return runEUAnalysisLegacy(address, county, assessedValue, comps, opts);
    }

    const taxRate = options.taxRate || DEFAULT_TAX_RATE;
    const maxComps = options.maxComps || MAX_EU_COMPS;
    const evalPool = options.evalPool || EVAL_POOL_SIZE;

    // Validate
    if (!subject || !subject.address) throw new Error('subject with address is required');
    if (!subject.assessedValue || subject.assessedValue <= 0) throw new Error('subject.assessedValue must be positive');
    if (!Array.isArray(allComps)) throw new Error('allComps must be an array');

    const subjectImpValue = subject.improvementValue || (subject.assessedValue - (subject.landValue || 0));
    const subjectSqft = subject.sqft || 0;
    const subjectPSF = subjectSqft > 0 ? round2(subjectImpValue / subjectSqft) : 0;

    // Step 1: Filter comps — same type, reasonable size/condition match
    let pool = allComps
        .filter(c => c.address !== subject.address)
        .filter(c => c.sqft && c.sqft > 0)
        .filter(c => c.assessedValue && c.assessedValue > 0)
        .filter(c => {
            // Size filter: within 40% of subject (generous for large pool)
            if (!subjectSqft) return true;
            const ratio = c.sqft / subjectSqft;
            return ratio >= 0.60 && ratio <= 1.40;
        });

    // Sort by similarity to subject (neighborhood match first, then closest size)
    pool.sort((a, b) => {
        // Same neighborhood bonus
        const aNeighbor = a.neighborhoodCode === subject.neighborhoodCode ? 0 : 1;
        const bNeighbor = b.neighborhoodCode === subject.neighborhoodCode ? 0 : 1;
        if (aNeighbor !== bNeighbor) return aNeighbor - bNeighbor;
        // Closest size
        const aDiff = Math.abs((a.sqft || 0) - subjectSqft);
        const bDiff = Math.abs((b.sqft || 0) - subjectSqft);
        return aDiff - bDiff;
    });

    // Step 2: Evaluate up to evalPool comps with full adjustments
    const evaluated = pool.slice(0, evalPool).map(comp => {
        const adjResult = calculateEUAdjustments(subject, comp);
        const compImpValue = comp.improvementValue || (comp.assessedValue - (comp.landValue || 0));
        const compPSF = comp.sqft > 0 ? round2(compImpValue / comp.sqft) : 0;

        return {
            address: comp.address,
            accountId: comp.accountId,
            sqft: comp.sqft,
            yearBuilt: comp.yearBuilt,
            effectiveYear: comp.effectiveYear,
            assessedValue: comp.assessedValue,
            improvementValue: comp.improvementValue || compImpValue,
            landValue: comp.landValue || 0,
            featureValue: comp.featureValue || 0,
            poolValue: comp.poolValue || 0,
            propertyType: comp.propertyType,
            neighborhoodCode: comp.neighborhoodCode,
            condition: comp.condition,
            quality: comp.quality,
            compPSF,
            ...adjResult
        };
    });

    // Step 3: Cherry-pick — select comps with lowest adjusted values (most favorable)
    // Only include comps whose adjusted value is BELOW subject assessed value
    const favorable = evaluated
        .filter(c => c.adjustedValue < subject.assessedValue)
        .sort((a, b) => a.adjustedValue - b.adjustedValue);

    // Take the best (lowest) comps, up to maxComps
    const selectedComps = favorable.slice(0, maxComps);

    // If we don't have enough favorable comps, fill with closest-to-subject
    if (selectedComps.length < MIN_COMPS) {
        const remaining = evaluated
            .filter(c => !selectedComps.find(s => s.address === c.address))
            .sort((a, b) => a.adjustedValue - b.adjustedValue);
        while (selectedComps.length < Math.min(MIN_COMPS, evaluated.length)) {
            const next = remaining.shift();
            if (!next) break;
            selectedComps.push(next);
        }
    }

    // Step 4: Calculate E&U recommended value (median of adjusted values)
    const adjustedValues = selectedComps.map(c => c.adjustedValue).filter(v => v > 0);
    const medianAdjustedValue = median(adjustedValues);
    const meanAdjustedValue = mean(adjustedValues);

    // Median PSF of selected comps
    const compPSFs = selectedComps.map(c => c.compPSF).filter(v => v > 0);
    const medianPSF = median(compPSFs);

    const recommendedValue = medianAdjustedValue ? Math.round(medianAdjustedValue) : null;
    const reduction = recommendedValue !== null ? Math.max(0, subject.assessedValue - recommendedValue) : 0;
    const estimatedSavings = Math.round(reduction * taxRate);

    // Strength assessment
    const favorableCount = selectedComps.filter(c => c.adjustedValue < subject.assessedValue).length;
    const favorablePercent = selectedComps.length > 0 ? favorableCount / selectedComps.length : 0;

    let recommendation;
    const insufficientData = selectedComps.length < MIN_COMPS;
    if (insufficientData) {
        recommendation = 'INSUFFICIENT_DATA';
    } else if (recommendedValue !== null && recommendedValue < subject.assessedValue) {
        if (favorablePercent >= 0.6 && reduction > subject.assessedValue * 0.03) {
            recommendation = 'EQUAL_AND_UNIFORM';
        } else {
            recommendation = 'EQUAL_AND_UNIFORM_WEAK';
        }
    } else {
        recommendation = 'MARKET_VALUE';
    }

    return {
        subject: {
            address: subject.address,
            county: subject.county || 'Unknown',
            assessedValue: subject.assessedValue,
            improvementValue: subjectImpValue,
            landValue: subject.landValue || 0,
            sqft: subjectSqft,
            subjectPSF,
            yearBuilt: subject.yearBuilt,
            effectiveYear: subject.effectiveYear || subject.yearBuilt,
            propertyType: subject.propertyType,
            neighborhoodCode: subject.neighborhoodCode
        },
        comps: {
            totalEvaluated: evaluated.length,
            totalPool: pool.length,
            selected: selectedComps.length,
            favorable: favorableCount,
            details: selectedComps
        },
        metrics: {
            medianAdjustedValue: medianAdjustedValue ? Math.round(medianAdjustedValue) : null,
            meanAdjustedValue: meanAdjustedValue ? Math.round(meanAdjustedValue) : null,
            medianPSF: medianPSF ? round2(medianPSF) : null,
            subjectPSF,
            psfDifference: medianPSF && subjectPSF ? round2(subjectPSF - medianPSF) : null,
            psfOverassessedPct: medianPSF && subjectPSF && medianPSF > 0
                ? round2((subjectPSF - medianPSF) / medianPSF)
                : null
        },
        result: {
            recommendedValue,
            reduction,
            estimatedSavings,
            taxRate
        },
        recommendation,
        insufficientData,
        methodology: `Equal & Uniform analysis (TX Tax Code §42.26) using $/sqft of improvements. ` +
            `Evaluated ${evaluated.length} comparable properties, selected ${selectedComps.length} most favorable. ` +
            `Adjustments applied for size, age, land value, features, and pool. ` +
            `Median adjusted value: ${recommendedValue ? dollars(recommendedValue) : 'N/A'}. ` +
            `Subject $/sqft: $${subjectPSF}/sqft vs. Median comp $/sqft: $${medianPSF || 'N/A'}/sqft.`,
        analyzedAt: new Date().toISOString()
    };
}

// ─── Legacy Ratio-Based Analysis (backward compatible) ──────────────

function runEUAnalysisLegacy(propertyAddress, county, assessedValue, comps, options = {}) {
    const marketValue = options.marketValue || assessedValue;
    const taxRate = options.taxRate || DEFAULT_TAX_RATE;

    if (!propertyAddress) throw new Error('propertyAddress is required');
    if (!county) throw new Error('county is required');
    if (typeof assessedValue !== 'number' || assessedValue <= 0) {
        throw new Error('assessedValue must be a positive number');
    }
    if (!Array.isArray(comps)) throw new Error('comps must be an array');

    const compAnalysis = comps.map(c => {
        if (!c.sale_price || c.sale_price <= 0 || !c.assessed_value || c.assessed_value <= 0) {
            return { ...c, ratio: null, excluded: true, excludeReason: 'Missing or invalid sale_price/assessed_value' };
        }
        const ratio = round2(c.assessed_value / c.sale_price);
        const isOutlier = ratio < RATIO_FLOOR || ratio > RATIO_CEILING;
        return {
            ...c,
            ratio,
            excluded: isOutlier,
            excludeReason: isOutlier ? `Ratio ${ratio} outside range [${RATIO_FLOOR}-${RATIO_CEILING}]` : null
        };
    });

    const included = compAnalysis.filter(c => !c.excluded);
    const excluded = compAnalysis.filter(c => c.excluded);
    const ratios = included.map(c => c.ratio);
    const insufficientData = included.length < MIN_COMPS;

    const medianRatio = median(ratios);
    const meanRatio = mean(ratios);
    const ratioStdDev = stddev(ratios);

    const euTargetValue = medianRatio !== null ? Math.round(medianRatio * marketValue) : null;
    const potentialReduction = euTargetValue !== null ? Math.max(0, assessedValue - euTargetValue) : 0;
    const estimatedTaxSavings = Math.round(potentialReduction * taxRate);
    const subjectRatio = marketValue > 0 ? round2(assessedValue / marketValue) : null;

    let recommendation;
    if (insufficientData) {
        recommendation = 'INSUFFICIENT_DATA';
    } else if (euTargetValue !== null && euTargetValue < assessedValue) {
        const ratiosBelow = ratios.filter(r => r < subjectRatio).length;
        const percentBelow = ratiosBelow / ratios.length;
        if (percentBelow >= 0.6 && potentialReduction > assessedValue * 0.03) {
            recommendation = 'EQUAL_AND_UNIFORM';
        } else {
            recommendation = 'EQUAL_AND_UNIFORM_WEAK';
        }
    } else {
        recommendation = 'MARKET_VALUE';
    }

    return {
        subject: {
            address: propertyAddress,
            county,
            assessedValue,
            marketValue,
            subjectRatio
        },
        comps: {
            total: comps.length,
            included: included.length,
            excluded: excluded.length,
            details: compAnalysis,
            excludedDetails: excluded
        },
        ratios: {
            individual: ratios,
            median: medianRatio,
            mean: meanRatio !== null ? round2(meanRatio) : null,
            stdDev: ratioStdDev !== null ? round2(ratioStdDev) : null
        },
        result: {
            euTargetValue,
            potentialReduction,
            estimatedTaxSavings,
            taxRate
        },
        recommendation,
        insufficientData,
        // Legacy fields for backward compat
        medianRatio,
        euTargetValue,
        subjectAssessedValue: assessedValue,
        compAnalysis: compAnalysis,
        analyzedAt: new Date().toISOString()
    };
}

// ─── Report Generation ──────────────────────────────────────────────

/**
 * Generate a formatted E&U evidence report for ARB hearing.
 */
function generateEUReport(analysis) {
    // Handle both new and legacy formats
    const isNewFormat = analysis.metrics && analysis.metrics.medianPSF !== undefined;

    if (isNewFormat) return generatePSFReport(analysis);
    return generateRatioReport(analysis);
}

function generatePSFReport(analysis) {
    const { subject, comps, metrics, result, recommendation } = analysis;
    const selected = comps.details || [];

    const lines = [];
    const hr = '═'.repeat(70);
    const hr2 = '─'.repeat(70);

    lines.push(hr);
    lines.push('EQUAL & UNIFORM ANALYSIS — $/SQFT IMPROVEMENT VALUE');
    lines.push('Texas Tax Code §42.26');
    lines.push(hr);
    lines.push('');
    lines.push('SUBJECT PROPERTY');
    lines.push(hr2);
    lines.push(`Address:            ${subject.address}`);
    lines.push(`County:             ${subject.county}`);
    lines.push(`Current Assessed:   ${dollars(subject.assessedValue)}`);
    lines.push(`Improvement Value:  ${dollars(subject.improvementValue)}`);
    lines.push(`Land Value:         ${dollars(subject.landValue)}`);
    lines.push(`Square Feet:        ${subject.sqft ? subject.sqft.toLocaleString() : 'N/A'}`);
    lines.push(`Subject $/SqFt:     $${metrics.subjectPSF}`);
    lines.push('');

    lines.push('COMPARABLE PROPERTIES — ADJUSTED VALUES');
    lines.push(hr2);
    lines.push(`Pool Evaluated:     ${comps.totalEvaluated}`);
    lines.push(`Selected for E&U:   ${comps.selected}`);
    lines.push(`Below Subject:      ${comps.favorable} of ${comps.selected}`);
    lines.push('');

    // Comp table
    lines.push('COMP  ADDRESS                         SQ FT   $/SQFT   ADJ VALUE   SIZE ADJ    AGE ADJ    LAND ADJ');
    lines.push(hr2);
    selected.forEach((c, i) => {
        const addr = (c.address || 'Unknown').substring(0, 30).padEnd(30);
        const sf = (c.sqft || 0).toString().padStart(7);
        const psf = ('$' + (c.compPSF || 0)).padStart(8);
        const adj = dollars(c.adjustedValue).padStart(11);
        const sizeA = (c.adjustments.size >= 0 ? '+' : '') + dollars(c.adjustments.size).padStart(9);
        const ageA = (c.adjustments.age >= 0 ? '+' : '') + dollars(c.adjustments.age).padStart(9);
        const landA = (c.adjustments.land >= 0 ? '+' : '') + dollars(c.adjustments.land).padStart(9);
        lines.push(`  ${(i + 1).toString().padEnd(4)}${addr} ${sf} ${psf} ${adj} ${sizeA} ${ageA} ${landA}`);
    });
    lines.push('');

    lines.push('EQUITY METRICS');
    lines.push(hr2);
    lines.push(`Median Comp $/SqFt:   $${metrics.medianPSF || 'N/A'}`);
    lines.push(`Subject $/SqFt:       $${metrics.subjectPSF}`);
    if (metrics.psfDifference) {
        lines.push(`Overassessed by:      $${metrics.psfDifference}/sqft (${metrics.psfOverassessedPct ? pct(metrics.psfOverassessedPct) : 'N/A'})`);
    }
    lines.push('');

    lines.push('EQUAL & UNIFORM RESULT');
    lines.push(hr2);
    if (result.recommendedValue) {
        lines.push(`Recommended Value:    ${dollars(result.recommendedValue)}`);
        lines.push(`Current Assessment:   ${dollars(subject.assessedValue)}`);
        lines.push(`Potential Reduction:  ${dollars(result.reduction)}`);
        lines.push(`Est. Tax Savings:     ${dollars(result.estimatedSavings)}/yr`);
    } else {
        lines.push('Unable to calculate — insufficient data.');
    }
    lines.push('');

    const recText = {
        EQUAL_AND_UNIFORM: 'STRONG E&U argument. The subject property is assessed significantly higher per square foot than comparable properties, indicating unequal appraisal under Tax Code §42.26.',
        EQUAL_AND_UNIFORM_WEAK: 'E&U argument exists but is moderate. Consider presenting both E&U and market value evidence.',
        MARKET_VALUE: 'E&U approach does not produce a lower value. Recommend standard market value protest.',
        INSUFFICIENT_DATA: `Insufficient comparable data (${comps.selected} of ${MIN_COMPS} minimum). Gather additional comps.`
    };
    lines.push('RECOMMENDATION');
    lines.push(hr2);
    lines.push(recText[recommendation] || recommendation);
    lines.push('');
    lines.push(hr);
    lines.push(`Analysis Date: ${analysis.analyzedAt}`);
    lines.push(hr);

    return { text: lines.join('\n'), recommendation };
}

function generateRatioReport(analysis) {
    // Legacy ratio-based report (kept for backward compatibility)
    const { subject, comps, ratios, result, recommendation } = analysis;
    const included = (comps.details || []).filter(c => !c.excluded);
    const lines = [];
    const hr = '═'.repeat(70);
    const hr2 = '─'.repeat(70);

    lines.push(hr);
    lines.push('EQUAL & UNIFORM ANALYSIS — RATIO METHOD');
    lines.push('Texas Tax Code §42.26');
    lines.push(hr);
    lines.push('');
    lines.push(`Subject: ${subject.address}`);
    lines.push(`Assessed: ${dollars(subject.assessedValue)} | Market: ${dollars(subject.marketValue)}`);
    lines.push(`Ratio: ${subject.subjectRatio !== null ? pct(subject.subjectRatio) : 'N/A'}`);
    lines.push('');
    lines.push(`Comps: ${comps.included} included / ${comps.excluded} excluded`);
    lines.push(`Median Ratio: ${ratios && ratios.median !== null ? ratios.median.toFixed(2) : 'N/A'}`);
    lines.push('');
    if (result.euTargetValue) {
        lines.push(`E&U Target: ${dollars(result.euTargetValue)} | Reduction: ${dollars(result.potentialReduction)} | Savings: ${dollars(result.estimatedTaxSavings)}/yr`);
    }
    lines.push(hr);

    return { text: lines.join('\n'), recommendation };
}

module.exports = {
    runEUAnalysis,
    generateEUReport,
    calculateEUAdjustments,
    // Expose helpers for testing
    _helpers: { median, mean, stddev, round2 }
};
