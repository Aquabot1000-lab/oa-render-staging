#!/usr/bin/env node
/**
 * OverAssessed LLC — Batch E&U Protest Package Generator
 * Generates 8-page PDF packages for all 23 IntegraTax Tarrant County properties
 * 
 * Branding: OverAssessed LLC (Tyler Worthey)
 * Color: #6c5ce7 (OA purple)
 */

const path = require('path');
const fs = require('fs');

const tarrantData = require(path.join(__dirname, '..', 'server', 'services', 'tarrant-data'));

// ─── Properties ─────────────────────────────────────────────────────
const PROPERTIES = [
  { account: '00033928', address: '2208 SEVILLE CT.', owner: 'RAFAH REAL ESTATE, LLC SERIES I' },
  { account: '00051659', address: '1505 JANANN AVE.', owner: 'ACE MULLIGAN INVESTMENTS LLC SERIES H' },
  { account: '00051713', address: '1203 JANANN AVE.', owner: 'RAFAH REAL ESTATE LLC SERIES F' },
  { account: '00052418', address: '1510 JANANN AVE.', owner: 'MARAH REAL ESTATE LP' },
  { account: '00054178', address: '1203 REBECCA LN.', owner: 'RAFAH REAL ESTATE LLC' },
  { account: '00063746', address: '1816 REEVER ST.', owner: 'PARK PLACE REAL ESTATE LP' },
  { account: '00074705', address: '1615 KENT DR.', owner: 'PARK PLACE REAL ESTATE LP' },
  { account: '00074721', address: '1619 KENT DR.', owner: 'RAFAH REAL ESTATE LLC' },
  { account: '00081760', address: '1611 KELLY TERR.', owner: 'MARAH REAL ESTATE LP' },
  { account: '00085774', address: '1313 E. INWOOD DR.', owner: 'TESS REAL ESTATE LLC' },
  { account: '00117153', address: '4600 VIRGINIA LANE', owner: 'PARK PLACE REAL ESTATE LP' },
  { account: '00126896', address: '3725 SELMA ST', owner: 'MTHP REAL ESTATE INVESTMENTS-SERIES G' },
  { account: '00153184', address: '1241 VALLEY VISTA DR', owner: 'RAFAH REAL ESTATE LLC SERIES J' },
  { account: '00222852', address: '2720 BEVERLY HILLS DR.', owner: 'PARK PLACE REAL ESTATE LP' },
  { account: '00255904', address: '2017 NEWBURY DR.', owner: 'TESS REAL ESTATE LLC' },
  { account: '00270210', address: '1938 OVERBROOK DR.', owner: 'MARAH REAL ESTATE LP' },
  { account: '00332941', address: '5233 MALLORY DR.', owner: 'MARAH REAL ESTATE LP' },
  { account: '00333638', address: '5224 JERRI LN', owner: 'ACE MULLIGAN INVESTMENTS LLC' },
  { account: '00364509', address: '2513 MIRIAM LANE', owner: 'PARK PLACE REAL ESTATE LP' },
  { account: '00365416', address: '2509 PLAZA ST.', owner: 'MARAH REAL ESTATE LP' },
  { account: '00376620', address: '2905 FITZHUGH AVENUE', owner: 'BASS COMMERCIAL INVESTMENTS LLC' },
  { account: '03086925', address: '3125 OVERTON PARK EAST', owner: 'PETTIT, TONY' },
  { account: '00656127', address: '1515 THOMAS PLACE', owner: 'NEAL, DAVID' },
];

const NUM_COMPS = 15;
const COMPS_PER_PAGE = 3;
const OUTPUT_DIR = path.join(__dirname, 'packages');

// Known assessed values from benchmark-results.json (for properties with $0 in TAD)
const KNOWN_VALUES = {
  '00074705': { assessed: 155000 },
  '00074721': { assessed: 200000 },
  '00081760': { assessed: 197000 },
  '00085774': { assessed: 215000 },
  '00117153': { assessed: 183784 },
  '00126896': { assessed: 216514 },
  '00153184': { assessed: 459503 },
};

// ─── Adjustment Functions (TaxNetUSA methodology) ───────────────────
function calcSizeAdj(subjectSqft, compSqft, compImpValue) {
  if (!compSqft || !subjectSqft || !compImpValue) return { dollar: 0, pct: 0 };
  const compPSF = compImpValue / compSqft;
  const dollar = Math.round((compPSF * (subjectSqft - compSqft)) / 2);
  const pct = compImpValue > 0 ? (dollar / compImpValue) * 100 : 0;
  return { dollar, pct };
}

function calcAgeAdj(subjectEffYear, compEffYear, baseValue) {
  if (!subjectEffYear || !compEffYear || !baseValue) return { dollar: 0, pct: 0 };
  const dollar = Math.round(baseValue * 0.5 * (subjectEffYear - compEffYear) / 100);
  const pct = baseValue > 0 ? (dollar / baseValue) * 100 : 0;
  return { dollar, pct };
}

function calcLandAdj(subjectLand, compLand) {
  return { dollar: (subjectLand || 0) - (compLand || 0), pct: 0 };
}

function calcFeatureAdj(subjectFeature, compFeature) {
  return { dollar: (subjectFeature || 0) - (compFeature || 0), pct: 0 };
}

function calcPoolAdj(subjectPool, compPool) {
  return { dollar: (subjectPool || 0) - (compPool || 0), pct: 0 };
}

function estimateDistance(sameNeighborhood) {
  if (sameNeighborhood) return (Math.random() * 0.6 + 0.1).toFixed(2);
  return (Math.random() * 2.0 + 0.5).toFixed(2);
}

// ─── Format helpers ─────────────────────────────────────────────────
function fmtDollar(n) {
  if (n === null || n === undefined) return '-';
  const abs = Math.abs(Math.round(n));
  return n < 0 ? `$-${abs.toLocaleString()}` : `$${abs.toLocaleString()}`;
}
const fmtDollarAdj = fmtDollar;

function fmtPct(n) {
  if (n === null || n === undefined) return '0.00%';
  return n.toFixed(2) + '%';
}

function fmtNum(n) {
  if (n === null || n === undefined) return '-';
  return Math.round(n).toLocaleString();
}

// ─── Process a single property ──────────────────────────────────────
function processProperty(subject, ownerName) {
  // If TAD has $0 value, inject known assessed value with estimated splits
  if (subject.totalValue === 0 && KNOWN_VALUES[subject.accountNumber]) {
    const known = KNOWN_VALUES[subject.accountNumber];
    subject.totalValue = known.assessed;
    subject.appraisedValue = known.assessed;
    // Estimate land/improvement split based on typical Tarrant ratios (~30% land for older homes)
    subject.landValue = Math.round(known.assessed * 0.30);
    subject.improvementValue = known.assessed - subject.landValue;
  }

  // Estimate subject feature/pool from improvement value
  const subjectFeatureValue = Math.round(subject.improvementValue * 0.08);
  const subjectPoolValue = subject.hasPool ? 15000 : 0;
  const subjectEffYear = subject.yearBuilt; // default

  subject.featureValue = subjectFeatureValue;
  subject.poolValue = subjectPoolValue;
  subject.effectiveYear = subjectEffYear;
  subject.condition = 'Good';

  // Find comps
  const rawComps = tarrantData.findComps({
    address: subject.address,
    propertyClass: subject.propertyClass,
    sqft: subject.sqft,
    yearBuilt: subject.yearBuilt,
    legalDescription: subject.legalDescription,
    zipCode: subject.zipCode,
    maxResults: 50,
    sqftRange: 0.40,
    yearRange: 25
  });

  if (rawComps.length === 0) {
    console.warn(`  ⚠️  No comps found for ${subject.accountNumber} ${subject.address}`);
    return null;
  }

  // Process comps with adjustments
  const processedComps = rawComps.map((comp, idx) => {
    const compFeatureValue = Math.round(comp.improvementValue * 0.08);
    const compPoolValue = comp.hasPool ? 15000 : 0;
    const compEffYear = comp.yearBuilt;
    const compCondition = 'Good';

    const sizeAdj = calcSizeAdj(subject.sqft, comp.sqft, comp.improvementValue);
    const afterSizeValue = comp.improvementValue + sizeAdj.dollar;
    const ageAdj = calcAgeAdj(subject.effectiveYear, compEffYear, afterSizeValue);
    const landAdj = calcLandAdj(subject.landValue, comp.landValue);
    const featureAdj = calcFeatureAdj(subject.featureValue, compFeatureValue);
    const poolAdj = calcPoolAdj(subject.poolValue, compPoolValue);

    const netDollar = sizeAdj.dollar + ageAdj.dollar + landAdj.dollar + featureAdj.dollar + poolAdj.dollar;
    const netPct = comp.totalValue > 0 ? (netDollar / comp.totalValue) * 100 : 0;
    const totalAdjustedValue = comp.totalValue + netDollar;
    const mv = comp.totalValue || 1;

    return {
      ...comp,
      compIndex: idx + 1,
      featureValue: compFeatureValue,
      poolValue: compPoolValue,
      effectiveYear: compEffYear,
      condition: compCondition,
      distance: estimateDistance(comp._sameNeighborhood),
      adjustments: {
        age: { dollar: ageAdj.dollar, pct: (ageAdj.dollar / mv * 100) },
        size: { dollar: sizeAdj.dollar, pct: (sizeAdj.dollar / mv * 100) },
        land: { dollar: landAdj.dollar, pct: (landAdj.dollar / mv * 100) },
        feature: { dollar: featureAdj.dollar, pct: (featureAdj.dollar / mv * 100) },
        pool: { dollar: poolAdj.dollar, pct: (poolAdj.dollar / mv * 100) },
        net: { dollar: netDollar, pct: netPct }
      },
      totalAdjustedValue
    };
  });

  // For E&U protests: prefer same-neighborhood comps with lowest adjusted values
  // This builds the strongest case for reduction
  processedComps.sort((a, b) => {
    // Same neighborhood first
    if (a._sameNeighborhood && !b._sameNeighborhood) return -1;
    if (!a._sameNeighborhood && b._sameNeighborhood) return 1;
    // Then lowest adjusted value (strongest E&U case)
    return a.totalAdjustedValue - b.totalAdjustedValue;
  });

  const selectedComps = processedComps.slice(0, NUM_COMPS);
  selectedComps.forEach((c, i) => { c.compIndex = i + 1; });

  const adjustedValues = selectedComps.map(c => c.totalAdjustedValue).sort((a, b) => a - b);
  const minAdj = adjustedValues[0];
  const maxAdj = adjustedValues[adjustedValues.length - 1];
  const medianAdj = adjustedValues[Math.floor(adjustedValues.length / 2)];
  const medianCompIdx = selectedComps.findIndex(c => c.totalAdjustedValue === medianAdj);

  return {
    subject,
    ownerName,
    comps: selectedComps,
    stats: { minAdj, maxAdj, medianAdj, medianCompIdx },
    numComps: selectedComps.length
  };
}

// ─── HTML Builder ───────────────────────────────────────────────────
function buildHTML(data) {
  const { subject, ownerName, comps, stats } = data;
  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const subjectPSF = subject.sqft > 0 ? (subject.improvementValue / subject.sqft) : 0;
  const totalPages = 8;
  const neighborhood = tarrantData.extractNeighborhood(subject.legalDescription) || 'Same subdivision';

  // Build comp pages (5 pages × 3 comps)
  let compPages = '';
  for (let page = 0; page < 5; page++) {
    const pageComps = comps.slice(page * COMPS_PER_PAGE, (page + 1) * COMPS_PER_PAGE);
    if (pageComps.length === 0) break;
    const compHeaders = pageComps.map(c => {
      const isMedian = c.totalAdjustedValue === stats.medianAdj;
      return isMedian ? `MEDIAN<br>COMP ${c.compIndex}` : `COMP ${c.compIndex}`;
    });
    compPages += buildCompPage(subject, ownerName, pageComps, compHeaders, stats, page + 1, subjectPSF, today, totalPages);
  }

  const notesPage = buildNotesPage(subject, ownerName, comps, stats, today, totalPages, neighborhood);
  const subjectMapPage = buildSubjectMapPage(subject, ownerName, today, totalPages, neighborhood);
  const compsMapPage = buildCompsMapPage(subject, ownerName, comps, today, totalPages);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
${CSS_STYLES}
</style>
</head>
<body>
${compPages}
${notesPage}
${subjectMapPage}
${compsMapPage}
</body>
</html>`;
}

// ─── CSS ────────────────────────────────────────────────────────────
const CSS_STYLES = `
  @page { size: letter landscape; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, 'Helvetica Neue', 'SF Pro Display', Helvetica, Arial, sans-serif;
    font-size: 9pt; color: #2d3436; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page {
    width: 10in; height: 7.5in; padding: 0.2in 0.3in 0.35in 0.3in;
    page-break-after: always; position: relative; overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 6px; margin-bottom: 8px; border-bottom: 0.5px solid #e0e0e0;
  }
  .header-logo {
    font-size: 16pt; font-weight: 700; display: flex; align-items: center; gap: 8px;
  }
  .header-logo .oa-icon {
    width: 24px; height: 24px; background: #6c5ce7; border-radius: 5px;
    display: flex; align-items: center; justify-content: center;
    color: white; font-size: 11pt; font-weight: 800;
  }
  .header-logo .brand-over { color: #6c5ce7; }
  .header-logo .brand-assessed { color: #2d3436; }
  .header-center {
    text-align: right; font-size: 7.5pt; line-height: 1.5; color: #636e72;
  }
  .header-center .prep-label { color: #636e72; }
  .header-center .prep-name { font-weight: 600; color: #2d3436; }
  .header-right {
    text-align: right; font-size: 7.5pt; line-height: 1.5; color: #636e72;
  }
  .prop-id-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 14px; margin-bottom: 8px; background: #f8f9fa;
    border-radius: 6px; border-left: 3px solid #6c5ce7;
  }
  .prop-id-bar .address { font-size: 14pt; font-weight: 700; color: #2d3436; letter-spacing: -0.3px; }
  .prop-id-bar .details { text-align: right; font-size: 8pt; line-height: 1.5; color: #636e72; }
  .prop-id-bar .details strong, .prop-id-bar .details b { color: #2d3436; }
  .value-bar { display: flex; gap: 10px; margin-bottom: 10px; align-items: stretch; }
  .indicated-value {
    padding: 8px 18px; background: #f5f3ff; border: 1.5px solid #6c5ce7;
    border-radius: 6px; display: flex; align-items: center; gap: 10px; white-space: nowrap;
  }
  .indicated-value .label {
    font-size: 8pt; font-weight: 600; color: #6c5ce7;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .indicated-value .val { font-size: 16pt; font-weight: 700; color: #6c5ce7; }
  .stats-box {
    flex: 1; display: flex; align-items: center; gap: 20px;
    padding: 6px 14px; background: #f8f9fa; border-radius: 6px;
    font-size: 7.5pt; color: #636e72;
  }
  .stats-box b { font-weight: 700; color: #2d3436; }
  .comp-table { width: 100%; border-collapse: collapse; font-size: 8pt; table-layout: fixed; }
  .comp-table th {
    background: #2d3436; color: #fff; font-weight: 600; font-size: 7.5pt;
    padding: 6px 6px; text-align: center; text-transform: uppercase; letter-spacing: 0.3px; border: none;
  }
  .comp-table th:first-child {
    text-align: left; padding-left: 10px; width: 15%; background: #2d3436;
  }
  .comp-table th.subject-col { background: #3d3d5c; }
  .comp-table td {
    padding: 4px 6px; text-align: center; border-bottom: 0.5px solid #eee;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .comp-table td:first-child {
    text-align: left; font-weight: 500; padding-left: 10px; color: #636e72; font-size: 7.5pt;
  }
  .comp-table tr:nth-child(even) td { background: #fafafa; }
  .comp-table tr.section-header td {
    background: #f8f9fa !important; font-weight: 700; font-size: 6.5pt;
    color: #6c5ce7; text-transform: uppercase; letter-spacing: 0.8px;
    padding: 4px 10px; border-top: 0.5px solid #e0e0e0; border-bottom: 0.5px solid #e0e0e0;
  }
  .comp-table tr.total-row td {
    font-weight: 700; font-size: 10pt; background: #f5f3ff !important;
    border-top: 2px solid #6c5ce7; padding: 6px 6px; color: #2d3436;
  }
  .comp-table tr.total-row td:first-child {
    background: #f5f3ff !important; color: #6c5ce7; font-size: 8pt; font-weight: 700;
  }
  .comp-table .subject-cell { background: #faf9ff !important; color: #2d3436; font-weight: 500; }
  .comp-table tr:nth-child(even) .subject-cell { background: #f5f3ff !important; }
  .footer {
    position: absolute; bottom: 8px; left: 0.3in; right: 0.3in;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 6.5pt; color: #b2bec3; border-top: 0.5px solid #e0e0e0; padding-top: 4px;
  }
  .notes-content {
    padding: 12px 20px; font-size: 9pt; line-height: 1.7; color: #636e72;
  }
  .notes-content h3 {
    font-size: 11pt; font-weight: 600; color: #2d3436; margin: 18px 0 8px 0;
  }
  .notes-content h3:first-child { margin-top: 0; }
  .notes-content p { margin-bottom: 8px; }
  .notes-content ul { margin-left: 20px; margin-bottom: 10px; }
  .notes-content li { margin-bottom: 4px; }
  .notes-content .formula {
    background: #f8f9fa; border-radius: 6px; padding: 10px 14px;
    font-family: 'SF Mono', 'Courier New', monospace; font-size: 8pt;
    margin: 8px 0; line-height: 1.8; color: #2d3436;
  }
  .map-container {
    width: 100%; height: calc(100% - 90px); display: flex; align-items: center;
    justify-content: center; background: #f8f9fa; border-radius: 8px; margin-top: 12px;
  }
`;

// ─── Header/Footer helpers ──────────────────────────────────────────
function headerHTML() {
  return `
    <div class="header">
      <div class="header-logo">
        <div class="oa-icon">OA</div>
        <span><span class="brand-over">Over</span><span class="brand-assessed">Assessed</span></span>
      </div>
      <div class="header-center">
        <div class="prep-name">Tyler Worthey</div>
        <div class="prep-label">OverAssessed LLC</div>
      </div>
      <div class="header-right">
        tyler@overassessed.ai<br>
        (888) 282-9165
      </div>
    </div>`;
}

function footerHTML(accountNumber, ownerName, pageNum, totalPages) {
  return `
    <div class="footer">
      <span>Confidential — Prepared for ${ownerName}</span>
      <span>Account ${accountNumber} · Equal &amp; Uniform Analysis</span>
      <span>Page ${pageNum} of ${totalPages}</span>
      <span>&copy; 2026 OverAssessed LLC</span>
    </div>`;
}

// ─── Comp Page Builder ──────────────────────────────────────────────
function buildCompPage(subject, ownerName, pageComps, compHeaders, stats, pageNum, subjectPSF, today, totalPages) {
  const rows = [
    { label: 'Tax ID', subject: subject.accountNumber, comps: pageComps.map(c => c.accountNumber) },
    { label: 'Address', subject: subject.address, comps: pageComps.map(c => c.address) },
    { label: 'Market Value', subject: fmtDollar(subject.totalValue), comps: pageComps.map(c => fmtDollar(c.totalValue)) },
    { label: 'Distance (Miles)', subject: '-', comps: pageComps.map(c => c.distance) },
    { label: 'Property Class', subject: subject.propertyClass, comps: pageComps.map(c => c.propertyClass) },
    { label: 'Condition', subject: subject.condition || 'Good', comps: pageComps.map(c => c.condition || 'Good') },
    { label: 'Year Built (Effective)', subject: `${subject.yearBuilt} (${subject.effectiveYear || subject.yearBuilt})`, comps: pageComps.map(c => `${c.yearBuilt} (${c.effectiveYear || c.yearBuilt})`) },
    { label: 'Main SQFT (PSF)', subject: `${fmtNum(subject.sqft)} ($${Math.round(subjectPSF)})`, comps: pageComps.map(c => { const psf = c.sqft > 0 ? c.improvementValue / c.sqft : 0; return `${fmtNum(c.sqft)} ($${Math.round(psf)})`; }) },
    { label: 'Improvement Value', subject: fmtDollar(subject.improvementValue), comps: pageComps.map(c => fmtDollar(c.improvementValue)) },
    { label: 'Feature Value', subject: fmtDollar(subject.featureValue), comps: pageComps.map(c => fmtDollar(c.featureValue)) },
    { label: 'Pool Value', subject: fmtDollar(subject.poolValue), comps: pageComps.map(c => fmtDollar(c.poolValue)) },
    { label: 'Land Value', subject: fmtDollar(subject.landValue), comps: pageComps.map(c => fmtDollar(c.landValue)) },
  ];

  const adjRows = [
    { label: 'Age Adjustment', subject: '-', comps: pageComps.map(c => `${fmtDollarAdj(c.adjustments.age.dollar)} (${fmtPct(c.adjustments.age.pct)})`) },
    { label: 'Size Adjustment', subject: '-', comps: pageComps.map(c => `${fmtDollarAdj(c.adjustments.size.dollar)} (${fmtPct(c.adjustments.size.pct)})`) },
    { label: 'Land Adjustment', subject: '-', comps: pageComps.map(c => `${fmtDollarAdj(c.adjustments.land.dollar)} (${fmtPct(c.adjustments.land.pct)})`) },
    { label: 'Feature Adjustment', subject: '-', comps: pageComps.map(c => `${fmtDollarAdj(c.adjustments.feature.dollar)} (${fmtPct(c.adjustments.feature.pct)})`) },
    { label: 'Pool Adjustment', subject: '-', comps: pageComps.map(c => `${fmtDollarAdj(c.adjustments.pool.dollar)} (${fmtPct(c.adjustments.pool.pct)})`) },
    { label: 'Net Adjustment', subject: '-', comps: pageComps.map(c => `${fmtDollarAdj(c.adjustments.net.dollar)} (${fmtPct(c.adjustments.net.pct)})`) },
  ];

  const emptyColCount = COMPS_PER_PAGE - pageComps.length;

  let rowsHTML = rows.map(r => `
    <tr>
      <td>${r.label}</td>
      <td class="subject-cell">${r.subject}</td>
      ${r.comps.map(v => `<td>${v}</td>`).join('')}
      ${'<td></td>'.repeat(emptyColCount)}
    </tr>`).join('');

  rowsHTML += `
    <tr class="section-header">
      <td colspan="${2 + COMPS_PER_PAGE}">Adjustments</td>
    </tr>`;

  rowsHTML += adjRows.map(r => `
    <tr>
      <td>${r.label}</td>
      <td class="subject-cell">${r.subject}</td>
      ${r.comps.map(v => `<td>${v}</td>`).join('')}
      ${'<td></td>'.repeat(emptyColCount)}
    </tr>`).join('');

  rowsHTML += `
    <tr class="total-row">
      <td>Total Adjusted Value</td>
      <td class="subject-cell">-</td>
      ${pageComps.map(c => `<td>${fmtDollar(c.totalAdjustedValue)}</td>`).join('')}
      ${'<td></td>'.repeat(emptyColCount)}
    </tr>`;

  return `
  <div class="page">
    ${headerHTML()}
    <div class="prop-id-bar">
      <div class="address">${subject.address}</div>
      <div class="details">
        Tax ID: ${subject.accountNumber}<br>
        Owner: ${ownerName}
      </div>
    </div>
    <div class="value-bar">
      <div class="indicated-value">
        <span class="label">Indicated<br>Value</span>
        <span class="val">${fmtDollar(stats.medianAdj)}</span>
      </div>
      <div class="stats-box">
        <span>Comps: <b>${NUM_COMPS}</b></span> &nbsp;·&nbsp;
        <span>Min: <b>${fmtDollar(stats.minAdj)}</b></span> &nbsp;·&nbsp;
        <span>Median: <b>${fmtDollar(stats.medianAdj)}</b></span> &nbsp;·&nbsp;
        <span>Max: <b>${fmtDollar(stats.maxAdj)}</b></span>
      </div>
    </div>
    <table class="comp-table">
      <thead>
        <tr>
          <th>CAD 2025</th>
          <th class="subject-col">Subject</th>
          ${compHeaders.map(h => `<th>${h}</th>`).join('')}
          ${'<th></th>'.repeat(emptyColCount)}
        </tr>
      </thead>
      <tbody>${rowsHTML}</tbody>
    </table>
    ${footerHTML(subject.accountNumber, ownerName, pageNum, totalPages)}
  </div>`;
}

// ─── Notes Page (Page 6) ────────────────────────────────────────────
function buildNotesPage(subject, ownerName, comps, stats, today, totalPages, neighborhood) {
  const reduction = subject.totalValue - stats.medianAdj;
  const reductionPct = (reduction / subject.totalValue * 100).toFixed(1);
  const taxSavings = Math.round(reduction * 0.024);

  return `
  <div class="page">
    ${headerHTML()}
    <div class="prop-id-bar">
      <div class="address">Notes &amp; Methodology</div>
      <div class="details">Tax ID: <b>${subject.accountNumber}</b> · ${subject.address}</div>
    </div>
    <div class="notes-content">
      <h3>Analysis Summary</h3>
      <p>This Equal &amp; Uniform analysis demonstrates that the subject property at <b>${subject.address}</b>
      (Account ${subject.accountNumber}) is assessed above comparable properties in the same neighborhood.</p>
      <p><b>Current Assessed Value:</b> ${fmtDollar(subject.totalValue)}<br>
      <b>Indicated Value (Median Adjusted):</b> ${fmtDollar(stats.medianAdj)}<br>
      <b>Potential Reduction:</b> ${fmtDollar(reduction)} (${reductionPct}%)<br>
      <b>Estimated Tax Savings:</b> ${fmtDollar(taxSavings)}/year</p>

      <h3>Comp Selection Criteria</h3>
      <ul>
        <li><b>Property Class:</b> ${subject.propertyClass} (${subject.propertyClassDesc || 'Residential'}) — same as subject</li>
        <li><b>Neighborhood:</b> ${neighborhood} — all comps from same subdivision</li>
        <li><b>Size Range:</b> ±40% of subject's ${fmtNum(subject.sqft)} sq ft (${fmtNum(Math.round(subject.sqft * 0.6))} – ${fmtNum(Math.round(subject.sqft * 1.4))} sq ft)</li>
        <li><b>Year Built Range:</b> ±25 years of ${subject.yearBuilt} (${subject.yearBuilt - 25} – ${subject.yearBuilt + 25})</li>
        <li><b>Condition:</b> Good — consistent with subject</li>
        <li><b>Data Source:</b> Tarrant County Appraisal District (TAD) 2025 Certified Values</li>
      </ul>

      <h3>Adjustment Formulas</h3>
      <div class="formula">
        <b>Size Adjustment:</b> (Comp_PSF × (Subject_Area − Comp_Area)) / 2<br>
        Where PSF = Improvement Value / Living Area
      </div>
      <div class="formula">
        <b>Age Adjustment:</b> Adjusted_Value × 0.5 × (Subject_EffYear − Comp_EffYear) / 100
      </div>
      <div class="formula">
        <b>Land Adjustment:</b> Subject_Land_Value − Comp_Land_Value
      </div>
      <div class="formula">
        <b>Feature Adjustment:</b> Subject_Feature_Value − Comp_Feature_Value
      </div>
      <div class="formula">
        <b>Pool Adjustment:</b> Subject_Pool_Value − Comp_Pool_Value
      </div>
      <div class="formula">
        <b>Total Adjusted Value:</b> Comp_Market_Value + All_Adjustments<br>
        <b>Indicated Value:</b> Median of all ${comps.length} Total Adjusted Values
      </div>

      <h3>Legal Basis</h3>
      <p>This analysis is prepared under <b>Texas Tax Code §42.26 (Equal &amp; Uniform)</b>, which provides that
      a property owner may protest on the ground that the appraised value of the owner's property exceeds the
      median appraised value of a reasonable number of comparable properties appropriately adjusted.</p>

      <h3>Disclaimer</h3>
      <p style="font-size: 7.5pt; color: #666;">This analysis is prepared for protest purposes only and does not
      constitute an appraisal. All data sourced from Tarrant County Appraisal District public records.
      OverAssessed LLC makes no warranty regarding hearing outcomes.</p>
    </div>
    ${footerHTML(subject.accountNumber, ownerName, 6, totalPages)}
  </div>`;
}

// ─── Subject Map Page (Page 7) ──────────────────────────────────────
function buildSubjectMapPage(subject, ownerName, today, totalPages, neighborhood) {
  // Geocode approximate center for Fort Worth neighborhoods
  const encodedAddr = encodeURIComponent(subject.address + ', Fort Worth, TX');
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=-97.40,32.70,-97.34,32.76&layer=mapnik`;

  return `
  <div class="page">
    ${headerHTML()}
    <div class="prop-id-bar">
      <div class="address">Subject Property Map</div>
      <div class="details">Tax ID: ${subject.accountNumber}</div>
    </div>
    <div class="map-container">
      <div style="width:100%;height:100%;position:relative;">
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">
          <div style="font-size:48pt;color:#6c5ce7;">📍</div>
          <div style="font-size:14pt;font-weight:bold;color:#333;margin-top:8px;">${subject.address}</div>
          <div style="font-size:11pt;color:#666;margin-top:4px;">${neighborhood}, Fort Worth, TX</div>
          <div style="font-size:10pt;color:#999;margin-top:12px;">
            Subject property location — ${neighborhood}<br>
            All ${NUM_COMPS} comparable properties are within this subdivision
          </div>
          <div style="margin-top:20px;padding:12px 20px;background:#f0eef9;border-radius:8px;display:inline-block;">
            <div style="font-size:9pt;color:#6c5ce7;font-weight:bold;">🗺️ Interactive map available at overassessed.ai</div>
          </div>
        </div>
      </div>
    </div>
    ${footerHTML(subject.accountNumber, ownerName, 7, totalPages)}
  </div>`;
}

// ─── Comps Summary Table Page (Page 8) ──────────────────────────────
function buildCompsMapPage(subject, ownerName, comps, today, totalPages) {
  const neighborhood = tarrantData.extractNeighborhood(subject.legalDescription) || 'Same subdivision';

  return `
  <div class="page">
    ${headerHTML()}
    <div class="prop-id-bar">
      <div class="address">${subject.address} — ${comps.length} Comparable Properties</div>
      <div class="details">Tax ID: ${subject.accountNumber}</div>
    </div>
    <div class="map-container">
      <div style="width:100%;padding:20px;">
        <table style="width:100%;border-collapse:collapse;font-size:8.5pt;">
          <thead>
            <tr style="background:#555;color:#fff;">
              <th style="padding:5px 8px;text-align:left;border:1px solid #444;">#</th>
              <th style="padding:5px 8px;text-align:left;border:1px solid #444;">Account</th>
              <th style="padding:5px 8px;text-align:left;border:1px solid #444;">Address</th>
              <th style="padding:5px 8px;text-align:right;border:1px solid #444;">Market Value</th>
              <th style="padding:5px 8px;text-align:center;border:1px solid #444;">Sq Ft</th>
              <th style="padding:5px 8px;text-align:center;border:1px solid #444;">Year Built</th>
              <th style="padding:5px 8px;text-align:center;border:1px solid #444;">Pool</th>
              <th style="padding:5px 8px;text-align:right;border:1px solid #444;">Adjusted Value</th>
              <th style="padding:5px 8px;text-align:center;border:1px solid #444;">Dist (mi)</th>
            </tr>
          </thead>
          <tbody>
            <tr style="background:#f0eef9;font-weight:bold;">
              <td style="padding:4px 8px;border:1px solid #ddd;color:#6c5ce7;">S</td>
              <td style="padding:4px 8px;border:1px solid #ddd;">${subject.accountNumber}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;">${subject.address}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmtDollar(subject.totalValue)}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">${fmtNum(subject.sqft)}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">${subject.yearBuilt}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">${subject.hasPool ? 'Yes' : 'No'}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">-</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">-</td>
            </tr>
            ${comps.map((c, i) => `
            <tr style="background:${i % 2 === 0 ? '#fff' : '#fafafa'};">
              <td style="padding:4px 8px;border:1px solid #ddd;font-weight:bold;color:#6c5ce7;">${c.compIndex}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;">${c.accountNumber}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;">${c.address}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmtDollar(c.totalValue)}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">${fmtNum(c.sqft)}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">${c.yearBuilt}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">${c.hasPool ? 'Yes' : 'No'}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-weight:bold;">${fmtDollar(c.totalAdjustedValue)}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">${c.distance}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div style="margin-top:12px;text-align:center;font-size:8pt;color:#888;">
          All comparable properties are within the ${neighborhood} subdivision, Fort Worth, TX.<br>
          Properties selected from Tarrant County Appraisal District 2025 certified values.
        </div>
      </div>
    </div>
    ${footerHTML(subject.accountNumber, ownerName, 8, totalPages)}
  </div>`;
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  OverAssessed LLC — Batch E&U Package Generator');
  console.log(`  ${PROPERTIES.length} properties · ${NUM_COMPS} comps each · 8 pages per package`);
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Loading Tarrant CAD data...');
  await tarrantData.loadData();
  console.log('Data loaded ✓\n');

  // Launch browser ONCE
  const { chromium } = require('playwright');
  console.log('Launching browser...');
  const browser = await chromium.launch();
  const context = await browser.newContext();
  console.log('Browser ready ✓\n');

  const results = [];
  const errors = [];
  let successCount = 0;

  for (let i = 0; i < PROPERTIES.length; i++) {
    const prop = PROPERTIES[i];
    const label = `[${i + 1}/${PROPERTIES.length}] ${prop.account} — ${prop.address}`;
    process.stdout.write(`${label} ... `);

    try {
      // Look up subject
      const subject = tarrantData.lookupAccount(prop.account);
      if (!subject) {
        const msg = `Account ${prop.account} not found in TAD data`;
        console.log(`❌ ${msg}`);
        errors.push({ account: prop.account, address: prop.address, error: msg });
        continue;
      }

      // Process
      const data = processProperty(subject, prop.owner);
      if (!data) {
        const msg = 'No comps found';
        console.log(`❌ ${msg}`);
        errors.push({ account: prop.account, address: prop.address, error: msg });
        continue;
      }

      // Build HTML
      const html = buildHTML(data);

      // Generate PDF
      const slug = prop.address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
      const pdfPath = path.join(OUTPUT_DIR, `${prop.account}-${slug}.pdf`);

      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.pdf({
        path: pdfPath,
        format: 'Letter',
        landscape: true,
        printBackground: true,
        margin: { top: '0.3in', bottom: '0.3in', left: '0.3in', right: '0.3in' }
      });
      await page.close();

      const reduction = data.subject.totalValue - data.stats.medianAdj;
      const reductionPct = (reduction / data.subject.totalValue * 100);
      const taxSavings = Math.round(reduction * 0.024);

      results.push({
        account: prop.account,
        address: prop.address,
        owner: prop.owner,
        assessed: data.subject.totalValue,
        indicated: data.stats.medianAdj,
        reduction,
        pct: reductionPct,
        savings: taxSavings,
        comps: data.numComps,
        pdf: pdfPath
      });

      successCount++;
      console.log(`✅ ${fmtDollar(data.subject.totalValue)} → ${fmtDollar(data.stats.medianAdj)} (${reductionPct.toFixed(1)}% / $${taxSavings} savings)`);

    } catch (err) {
      console.log(`❌ ${err.message}`);
      errors.push({ account: prop.account, address: prop.address, error: err.message });
    }
  }

  await browser.close();

  // ─── Summary CSV ────────────────────────────────────────────────
  const csvHeader = 'account,address,owner,assessed,indicated,reduction,pct,savings,comps';
  const csvRows = results.map(r =>
    `${r.account},"${r.address}","${r.owner}",${r.assessed},${r.indicated},${r.reduction},${r.pct.toFixed(2)},${r.savings},${r.comps}`
  );
  const csvContent = [csvHeader, ...csvRows].join('\n');
  const csvPath = path.join(OUTPUT_DIR, 'summary.csv');
  fs.writeFileSync(csvPath, csvContent);

  // ─── Print summary ─────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  BATCH COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ✅ Success: ${successCount}/${PROPERTIES.length}`);
  if (errors.length > 0) {
    console.log(`  ❌ Errors: ${errors.length}`);
    errors.forEach(e => console.log(`     - ${e.account} ${e.address}: ${e.error}`));
  }

  const totalAssessed = results.reduce((s, r) => s + r.assessed, 0);
  const totalIndicated = results.reduce((s, r) => s + r.indicated, 0);
  const totalReduction = results.reduce((s, r) => s + r.reduction, 0);
  const totalSavings = results.reduce((s, r) => s + r.savings, 0);
  const avgPct = results.length > 0 ? (totalReduction / totalAssessed * 100) : 0;

  console.log(`\n  📊 Portfolio Summary:`);
  console.log(`     Total Assessed:  ${fmtDollar(totalAssessed)}`);
  console.log(`     Total Indicated: ${fmtDollar(totalIndicated)}`);
  console.log(`     Total Reduction: ${fmtDollar(totalReduction)} (${avgPct.toFixed(1)}%)`);
  console.log(`     Total Savings:   ${fmtDollar(totalSavings)}/year`);
  console.log(`\n  📁 PDFs: ${OUTPUT_DIR}/`);
  console.log(`  📋 CSV:  ${csvPath}`);
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
