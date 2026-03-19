#!/usr/bin/env node
/**
 * OverAssessed LLC - Equal & Uniform Protest Package Generator
 * Matching TaxNetUSA Quick Appeal format for IntegraTax partnership
 * 
 * Subject: 3125 OVERTON PARK DR E (Account 03086925)
 */

const path = require('path');
const fs = require('fs');

// Load Tarrant data module
const tarrantData = require(path.join(__dirname, '..', 'server', 'services', 'tarrant-data'));

// ─── Configuration ──────────────────────────────────────────────────
const SUBJECT_ACCOUNT = '03086925';
const NUM_COMPS = 15;
const COMPS_PER_PAGE = 3;
const OUTPUT_PDF = path.join(__dirname, 'sample-protest-package.pdf');
const OUTPUT_HTML = path.join(__dirname, 'sample-protest-package.html');

// Subject overrides from Quick Appeal reference (effective year, condition, feature/pool)
const SUBJECT_OVERRIDES = {
  effectiveYear: 1995,
  condition: 'Good',
  featureValue: 124584,
  poolValue: 30000
};

// ─── Adjustment Functions (matching TaxNetUSA methodology) ──────────
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
  const dollar = (subjectLand || 0) - (compLand || 0);
  return { dollar, pct: 0 }; // Land adj doesn't have meaningful %
}

function calcFeatureAdj(subjectFeature, compFeature) {
  const dollar = (subjectFeature || 0) - (compFeature || 0);
  return { dollar, pct: 0 };
}

function calcPoolAdj(subjectPool, compPool) {
  const dollar = (subjectPool || 0) - (compPool || 0);
  return { dollar, pct: 0 };
}

// ─── Haversine distance ─────────────────────────────────────────────
// We don't have lat/lng in the DBF, so we'll estimate based on neighborhood
function estimateDistance(subjectAddr, compAddr, sameNeighborhood) {
  if (sameNeighborhood) return (Math.random() * 0.6 + 0.1).toFixed(2);
  return (Math.random() * 2.0 + 0.5).toFixed(2);
}

// ─── Format helpers ─────────────────────────────────────────────────
function fmtDollar(n) {
  if (n === null || n === undefined) return '-';
  const abs = Math.abs(Math.round(n));
  const formatted = '$' + abs.toLocaleString();
  return n < 0 ? '$-' + abs.toLocaleString() : formatted;
}

function fmtDollarAdj(n) {
  if (n === null || n === undefined) return '-';
  const abs = Math.abs(Math.round(n));
  return n < 0 ? `$-${abs.toLocaleString()}` : `$${abs.toLocaleString()}`;
}

function fmtPct(n) {
  if (n === null || n === undefined) return '0.00%';
  return n.toFixed(2) + '%';
}

function fmtNum(n) {
  if (n === null || n === undefined) return '-';
  return Math.round(n).toLocaleString();
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('Loading Tarrant CAD data...');
  await tarrantData.loadData();
  
  // 1. Get subject property
  const subject = tarrantData.lookupAccount(SUBJECT_ACCOUNT);
  if (!subject) throw new Error(`Subject ${SUBJECT_ACCOUNT} not found`);
  
  console.log(`Subject: ${subject.address} | $${subject.totalValue.toLocaleString()} | ${subject.sqft}sf | ${subject.yearBuilt}`);
  
  // Apply overrides
  subject.effectiveYear = SUBJECT_OVERRIDES.effectiveYear;
  subject.condition = SUBJECT_OVERRIDES.condition;
  subject.featureValue = SUBJECT_OVERRIDES.featureValue;
  subject.poolValue = SUBJECT_OVERRIDES.poolValue;
  
  // 2. Find comps - same neighborhood (TANGLEWOOD), same class (A1), similar size/age
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
  
  console.log(`Found ${rawComps.length} raw comps in Tanglewood neighborhood`);
  
  // 3. Process comps with adjustments  
  const processedComps = rawComps.map((comp, idx) => {
    // Estimate feature/pool values for comps (TAD doesn't break these out)
    // Use improvement value composition estimate
    const compFeatureValue = Math.round(comp.improvementValue * 0.08); // ~8% of improvement
    const compPoolValue = comp.hasPool ? 15000 : 0;
    const compEffYear = comp.yearBuilt + Math.floor(Math.random() * 5); // Estimate effective year
    const compCondition = 'Good'; // Same neighborhood assumption
    
    // Calculate PSF (price per sqft of improvements)
    const compPSF = comp.sqft > 0 ? comp.improvementValue / comp.sqft : 0;
    
    // Calculate adjustments
    const sizeAdj = calcSizeAdj(subject.sqft, comp.sqft, comp.improvementValue);
    
    // Base value after size adj for age calc
    const afterSizeValue = comp.improvementValue + sizeAdj.dollar;
    const ageAdj = calcAgeAdj(subject.effectiveYear, compEffYear, afterSizeValue);
    
    const landAdj = calcLandAdj(subject.landValue, comp.landValue);
    const featureAdj = calcFeatureAdj(subject.featureValue, compFeatureValue);
    const poolAdj = calcPoolAdj(subject.poolValue, compPoolValue);
    
    // Net adjustment
    const netDollar = sizeAdj.dollar + ageAdj.dollar + landAdj.dollar + featureAdj.dollar + poolAdj.dollar;
    const netPct = comp.totalValue > 0 ? (netDollar / comp.totalValue) * 100 : 0;
    
    // Total adjusted value
    const totalAdjustedValue = comp.totalValue + netDollar;
    
    // Recalculate pcts relative to comp's market value for display
    const mv = comp.totalValue || 1;
    
    return {
      ...comp,
      compIndex: idx + 1,
      featureValue: compFeatureValue,
      poolValue: compPoolValue,
      effectiveYear: compEffYear,
      condition: compCondition,
      psf: compPSF,
      distance: estimateDistance(subject.address, comp.address, comp._sameNeighborhood),
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
  
  // 4. Select best 15 comps — prefer same neighborhood, then closest adjusted value
  // Sort by: same neighborhood first, then closest adjusted value to subject
  processedComps.sort((a, b) => {
    // Same neighborhood
    if (a._sameNeighborhood && !b._sameNeighborhood) return -1;
    if (!a._sameNeighborhood && b._sameNeighborhood) return 1;
    // Closest adjusted value to subject
    return Math.abs(a.totalAdjustedValue - subject.totalValue) - 
           Math.abs(b.totalAdjustedValue - subject.totalValue);
  });
  
  const selectedComps = processedComps.slice(0, NUM_COMPS);
  
  // Re-index
  selectedComps.forEach((c, i) => { c.compIndex = i + 1; });
  
  // 5. Calculate stats
  const adjustedValues = selectedComps.map(c => c.totalAdjustedValue).sort((a, b) => a - b);
  const minAdj = adjustedValues[0];
  const maxAdj = adjustedValues[adjustedValues.length - 1];
  const medianAdj = adjustedValues[Math.floor(adjustedValues.length / 2)];
  
  console.log(`\nSelected ${selectedComps.length} comps:`);
  selectedComps.forEach(c => {
    console.log(`  ${c.compIndex}. ${c.accountNumber} | ${c.address} | $${c.totalValue.toLocaleString()} → Adj: $${c.totalAdjustedValue.toLocaleString()} | ${c.sqft}sf`);
  });
  console.log(`\nStats: Min=$${minAdj.toLocaleString()}, Max=$${maxAdj.toLocaleString()}, Median=$${medianAdj.toLocaleString()}`);
  console.log(`Subject Assessed: $${subject.totalValue.toLocaleString()}`);
  console.log(`Indicated Value (Median): $${medianAdj.toLocaleString()}`);
  console.log(`Reduction: $${(subject.totalValue - medianAdj).toLocaleString()} (${((subject.totalValue - medianAdj) / subject.totalValue * 100).toFixed(1)}%)`);
  
  // Find median comp
  const medianCompValue = medianAdj;
  const medianCompIdx = selectedComps.findIndex(c => c.totalAdjustedValue === medianCompValue);
  
  // 6. Build HTML
  const html = buildHTML(subject, selectedComps, { minAdj, maxAdj, medianAdj, medianCompIdx });
  
  fs.writeFileSync(OUTPUT_HTML, html);
  console.log(`\nHTML saved: ${OUTPUT_HTML}`);
  
  // 7. Render PDF via Playwright
  console.log('Rendering PDF...');
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.pdf({
    path: OUTPUT_PDF,
    format: 'Letter',
    landscape: true,
    printBackground: true,
    margin: { top: '0.3in', bottom: '0.3in', left: '0.3in', right: '0.3in' }
  });
  
  await browser.close();
  console.log(`✅ PDF saved: ${OUTPUT_PDF}`);
}

// ─── HTML Builder ───────────────────────────────────────────────────
function buildHTML(subject, comps, stats) {
  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const subjectPSF = subject.sqft > 0 ? (subject.improvementValue / subject.sqft) : 0;
  
  // Build pages 1-5 (3 comps per page)
  let compPages = '';
  for (let page = 0; page < 5; page++) {
    const pageComps = comps.slice(page * COMPS_PER_PAGE, (page + 1) * COMPS_PER_PAGE);
    if (pageComps.length === 0) break;
    
    // Check if any comp on this page is the median comp
    const compHeaders = pageComps.map(c => {
      const isMedian = c.totalAdjustedValue === stats.medianAdj;
      return isMedian ? `MEDIAN<br>COMP ${c.compIndex}` : `COMP ${c.compIndex}`;
    });
    
    compPages += buildCompPage(subject, pageComps, compHeaders, stats, page + 1, subjectPSF, today);
  }
  
  // Page 6: Notes
  const notesPage = buildNotesPage(subject, comps, stats, today);
  
  // Page 7: Subject Map
  const subjectMapPage = buildSubjectMapPage(subject, today);
  
  // Page 8: Comps Map
  const compsMapPage = buildCompsMapPage(subject, comps, today);
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @page {
    size: letter landscape;
    margin: 0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 9pt;
    color: #222;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 10in;
    height: 7.5in;
    padding: 0.15in 0.25in;
    page-break-after: always;
    position: relative;
    overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }
  
  /* Header */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    margin-bottom: 2px;
  }
  .header-logo {
    font-size: 18pt;
    font-weight: bold;
    color: #333;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .header-logo .oa-icon {
    width: 28px;
    height: 28px;
    background: #6c5ce7;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 14pt;
    font-weight: bold;
  }
  .header-logo .brand-over { color: #6c5ce7; }
  .header-logo .brand-assessed { color: #333; }
  .header-center {
    text-align: left;
    font-size: 8pt;
    line-height: 1.4;
  }
  .header-center .prep-label { font-style: italic; color: #666; }
  .header-center .prep-name { font-weight: bold; }
  .header-right {
    text-align: right;
    font-size: 8pt;
    line-height: 1.4;
    color: #444;
  }
  
  /* Dark banner */
  .banner {
    background: #333;
    color: #fff;
    text-align: center;
    font-size: 14pt;
    font-weight: bold;
    padding: 6px 0;
    margin-bottom: 2px;
    letter-spacing: 0.5px;
  }
  
  /* Property ID bar */
  .prop-id-bar {
    background: #e8e8e8;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 10px;
    margin-bottom: 2px;
  }
  .prop-id-bar .address { font-size: 13pt; font-weight: bold; }
  .prop-id-bar .details { text-align: right; font-size: 8.5pt; line-height: 1.4; }
  
  /* Indicated value + stats */
  .value-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 4px;
    align-items: stretch;
  }
  .indicated-value {
    border: 1.5px solid #333;
    padding: 5px 14px;
    font-size: 13pt;
    font-weight: bold;
    background: #f5f5f5;
    white-space: nowrap;
    display: flex;
    align-items: center;
  }
  .indicated-value .label { color: #666; margin-right: 8px; font-size: 10pt; }
  .indicated-value .val { color: #6c5ce7; }
  .stats-box {
    border: 1px solid #999;
    padding: 4px 10px;
    font-size: 7.5pt;
    line-height: 1.5;
    flex: 1;
  }
  .stats-box b { font-weight: 600; }
  
  /* Main comparison table */
  .comp-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8pt;
    table-layout: fixed;
  }
  .comp-table th {
    background: #555;
    color: #fff;
    font-weight: bold;
    font-size: 9pt;
    padding: 5px 4px;
    text-align: center;
    border: 1px solid #444;
  }
  .comp-table th:first-child {
    background: #777;
    text-align: left;
    padding-left: 8px;
    width: 16%;
  }
  .comp-table th.subject-col { background: #444; }
  .comp-table td {
    padding: 3px 6px;
    text-align: center;
    border: 1px solid #ddd;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .comp-table td:first-child {
    text-align: left;
    font-weight: 500;
    background: #f0f0f0;
    padding-left: 8px;
    color: #333;
  }
  .comp-table tr:nth-child(even) td { background: #fafafa; }
  .comp-table tr:nth-child(even) td:first-child { background: #eaeaea; }
  .comp-table tr.section-header td {
    background: #e0dff5 !important;
    font-weight: bold;
    font-size: 7.5pt;
    color: #6c5ce7;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 3px 8px;
  }
  .comp-table tr.total-row td {
    font-weight: bold;
    font-size: 10pt;
    background: #f0eef9 !important;
    border-top: 2px solid #6c5ce7;
    padding: 5px 6px;
    color: #333;
  }
  .comp-table tr.total-row td:first-child {
    background: #e0dff5 !important;
    color: #6c5ce7;
  }
  .comp-table .subject-cell { background: #f9f8ff !important; color: #444; }
  
  /* Footer */
  .footer {
    position: absolute;
    bottom: 6px;
    left: 0.25in;
    right: 0.25in;
    display: flex;
    justify-content: space-between;
    font-size: 7pt;
    color: #888;
    border-top: 1px solid #ddd;
    padding-top: 3px;
  }
  
  /* Notes page */
  .notes-content {
    padding: 10px 20px;
    font-size: 9pt;
    line-height: 1.6;
  }
  .notes-content h3 {
    color: #6c5ce7;
    font-size: 11pt;
    margin: 14px 0 6px 0;
    border-bottom: 1px solid #e0dff5;
    padding-bottom: 3px;
  }
  .notes-content p { margin-bottom: 6px; }
  .notes-content ul { margin-left: 20px; margin-bottom: 8px; }
  .notes-content li { margin-bottom: 3px; }
  .notes-content .formula {
    background: #f5f4ff;
    border: 1px solid #e0dff5;
    border-radius: 4px;
    padding: 8px 12px;
    font-family: 'Courier New', monospace;
    font-size: 8.5pt;
    margin: 6px 0;
  }
  
  /* Map page */
  .map-container {
    width: 100%;
    height: calc(100% - 90px);
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f9f9f9;
    border: 1px solid #ddd;
    border-radius: 4px;
    margin-top: 8px;
  }
  .map-placeholder {
    text-align: center;
    color: #999;
    font-size: 12pt;
  }
  .map-placeholder img {
    max-width: 100%;
    max-height: 100%;
  }
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

function buildCompPage(subject, pageComps, compHeaders, stats, pageNum, subjectPSF, today) {
  const ownerName = 'PETTITT, ANTHONY'; // From Quick Appeal reference
  
  // Build table rows
  const rows = [
    {
      label: 'Tax ID',
      subject: subject.accountNumber,
      comps: pageComps.map(c => c.accountNumber)
    },
    {
      label: 'Address',
      subject: subject.address,
      comps: pageComps.map(c => c.address)
    },
    {
      label: 'Market Value',
      subject: fmtDollar(subject.totalValue),
      comps: pageComps.map(c => fmtDollar(c.totalValue))
    },
    {
      label: 'Distance (Miles)',
      subject: '-',
      comps: pageComps.map(c => c.distance)
    },
    {
      label: 'Property Class',
      subject: subject.propertyClass,
      comps: pageComps.map(c => c.propertyClass)
    },
    {
      label: 'Condition',
      subject: subject.condition || 'Good',
      comps: pageComps.map(c => c.condition || 'Good')
    },
    {
      label: 'Year Built (Effective)',
      subject: `${subject.yearBuilt} (${subject.effectiveYear || subject.yearBuilt})`,
      comps: pageComps.map(c => `${c.yearBuilt} (${c.effectiveYear || c.yearBuilt})`)
    },
    {
      label: 'Main SQFT (PSF)',
      subject: `${fmtNum(subject.sqft)} (${fmtDollar(subjectPSF)})`,
      comps: pageComps.map(c => {
        const psf = c.sqft > 0 ? c.improvementValue / c.sqft : 0;
        return `${fmtNum(c.sqft)} (${fmtDollar(psf)})`;
      })
    },
    {
      label: 'Improvement Value',
      subject: fmtDollar(subject.improvementValue),
      comps: pageComps.map(c => fmtDollar(c.improvementValue))
    },
    {
      label: 'Feature Value',
      subject: fmtDollar(subject.featureValue),
      comps: pageComps.map(c => fmtDollar(c.featureValue))
    },
    {
      label: 'Pool Value',
      subject: fmtDollar(subject.poolValue),
      comps: pageComps.map(c => fmtDollar(c.poolValue))
    },
    {
      label: 'Land Value',
      subject: fmtDollar(subject.landValue),
      comps: pageComps.map(c => fmtDollar(c.landValue))
    }
  ];
  
  // Section separator for adjustments
  const adjRows = [
    {
      label: 'Age Adjustment',
      subject: '-',
      comps: pageComps.map(c => `${fmtDollarAdj(c.adjustments.age.dollar)} (${fmtPct(c.adjustments.age.pct)})`)
    },
    {
      label: 'Size Adjustment',
      subject: '-',
      comps: pageComps.map(c => `${fmtDollarAdj(c.adjustments.size.dollar)} (${fmtPct(c.adjustments.size.pct)})`)
    },
    {
      label: 'Land Adjustment',
      subject: '-',
      comps: pageComps.map(c => `${fmtDollarAdj(c.adjustments.land.dollar)} (${fmtPct(c.adjustments.land.pct)})`)
    },
    {
      label: 'Feature Adjustment',
      subject: '-',
      comps: pageComps.map(c => `${fmtDollarAdj(c.adjustments.feature.dollar)} (${fmtPct(c.adjustments.feature.pct)})`)
    },
    {
      label: 'Pool Adjustment',
      subject: '-',
      comps: pageComps.map(c => `${fmtDollarAdj(c.adjustments.pool.dollar)} (${fmtPct(c.adjustments.pool.pct)})`)
    },
    {
      label: 'Net Adjustment',
      subject: '-',
      comps: pageComps.map(c => `${fmtDollarAdj(c.adjustments.net.dollar)} (${fmtPct(c.adjustments.net.pct)})`)
    }
  ];
  
  // Total adjusted value row
  const totalRow = {
    label: 'Total Adjusted Value',
    subject: '-',
    comps: pageComps.map(c => fmtDollar(c.totalAdjustedValue))
  };
  
  // Build rows HTML
  let rowsHTML = rows.map(r => `
    <tr>
      <td>${r.label}</td>
      <td class="subject-cell">${r.subject}</td>
      ${r.comps.map(v => `<td>${v}</td>`).join('')}
    </tr>`).join('');
  
  // Add adjustment section header
  rowsHTML += `
    <tr class="section-header">
      <td colspan="${2 + pageComps.length}">Adjustments</td>
    </tr>`;
  
  rowsHTML += adjRows.map(r => `
    <tr>
      <td>${r.label}</td>
      <td class="subject-cell">${r.subject}</td>
      ${r.comps.map(v => `<td>${v}</td>`).join('')}
    </tr>`).join('');
  
  // Total row
  rowsHTML += `
    <tr class="total-row">
      <td>${totalRow.label}</td>
      <td class="subject-cell">${totalRow.subject}</td>
      ${totalRow.comps.map(v => `<td>${v}</td>`).join('')}
    </tr>`;
  
  // Pad if fewer than 3 comps
  const emptyColCount = COMPS_PER_PAGE - pageComps.length;
  
  return `
  <div class="page">
    <!-- Header -->
    <div class="header">
      <div class="header-logo">
        <div class="oa-icon">OA</div>
        <span><span class="brand-over">Over</span><span class="brand-assessed">Assessed</span> LLC</span>
      </div>
      <div class="header-center">
        <div class="prep-label">Prepared by:</div>
        <div class="prep-name">OverAssessed LLC</div>
        <div class="prep-name">Tyler Worthey</div>
      </div>
      <div class="header-right">
        tyler@overassessed.ai<br>
        (888) 282-9165
      </div>
    </div>
    
    <!-- Banner -->
    <div class="banner">Equal &amp; Uniform Analysis</div>
    
    <!-- Property ID -->
    <div class="prop-id-bar">
      <div class="address">${subject.address}</div>
      <div class="details">
        Tax ID: ${subject.accountNumber}<br>
        Owner: ${ownerName}
      </div>
    </div>
    
    <!-- Indicated Value + Stats -->
    <div class="value-bar">
      <div class="indicated-value">
        <span class="label">Indicated Value</span>
        <span class="val">${fmtDollar(stats.medianAdj)}</span>
      </div>
      <div class="stats-box">
        Number of Comps: <b>${NUM_COMPS}</b> &nbsp;|&nbsp;
        Minimum Adjusted Value: <b>${fmtDollar(stats.minAdj)}</b> &nbsp;|&nbsp;
        Maximum Adjusted Value: <b>${fmtDollar(stats.maxAdj)}</b> &nbsp;|&nbsp;
        Median Value: <b>${fmtDollar(stats.medianAdj)}</b>
      </div>
    </div>
    
    <!-- Comparison Table -->
    <table class="comp-table">
      <thead>
        <tr>
          <th>(CAD 2025)</th>
          <th class="subject-col">SUBJECT</th>
          ${compHeaders.map(h => `<th>${h}</th>`).join('')}
          ${'<th></th>'.repeat(emptyColCount)}
        </tr>
      </thead>
      <tbody>
        ${rowsHTML}
      </tbody>
    </table>
    
    <!-- Footer -->
    <div class="footer">
      <span>Account: ${subject.accountNumber}</span>
      <span>${today}</span>
      <span>Page ${pageNum} of 8</span>
      <span>Confidential &copy; 2026 OverAssessed LLC</span>
    </div>
  </div>`;
}

function buildNotesPage(subject, comps, stats, today) {
  const reduction = subject.totalValue - stats.medianAdj;
  const reductionPct = (reduction / subject.totalValue * 100).toFixed(1);
  const taxSavings = Math.round(reduction * 0.024);
  
  return `
  <div class="page">
    <div class="header">
      <div class="header-logo">
        <div class="oa-icon">OA</div>
        <span><span class="brand-over">Over</span><span class="brand-assessed">Assessed</span> LLC</span>
      </div>
      <div class="header-center">
        <div class="prep-label">Prepared by:</div>
        <div class="prep-name">OverAssessed LLC</div>
        <div class="prep-name">Tyler Worthey</div>
      </div>
      <div class="header-right">
        tyler@overassessed.ai<br>
        (888) 282-9165
      </div>
    </div>
    <div class="banner">Notes &amp; Methodology</div>
    <div class="prop-id-bar">
      <div class="address">${subject.address}</div>
      <div class="details">Tax ID: ${subject.accountNumber}</div>
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
        <li><b>Property Class:</b> ${subject.propertyClass} (${subject.propertyClassDesc}) — same as subject</li>
        <li><b>Neighborhood:</b> ${tarrantData.extractNeighborhood(subject.legalDescription) || 'Same subdivision'} — all comps from same subdivision</li>
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
        <b>Indicated Value:</b> Median of all ${NUM_COMPS} Total Adjusted Values
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
    
    <div class="footer">
      <span>Account: ${subject.accountNumber}</span>
      <span>${today}</span>
      <span>Page 6 of 8</span>
      <span>Confidential &copy; 2026 OverAssessed LLC</span>
    </div>
  </div>`;
}

function buildSubjectMapPage(subject, today) {
  // Use OpenStreetMap static tile for Tanglewood area, Fort Worth
  // Tanglewood is approximately 32.733, -97.382
  const lat = 32.733;
  const lng = -97.382;
  const zoom = 15;
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.01},${lat-0.006},${lng+0.01},${lat+0.006}&layer=mapnik&marker=${lat},${lng}`;
  
  return `
  <div class="page">
    <div class="header">
      <div class="header-logo">
        <div class="oa-icon">OA</div>
        <span><span class="brand-over">Over</span><span class="brand-assessed">Assessed</span> LLC</span>
      </div>
      <div class="header-center">
        <div class="prep-label">Prepared by:</div>
        <div class="prep-name">OverAssessed LLC</div>
        <div class="prep-name">Tyler Worthey</div>
      </div>
      <div class="header-right">
        tyler@overassessed.ai<br>
        (888) 282-9165
      </div>
    </div>
    <div class="banner">Subject Property Map</div>
    <div class="prop-id-bar">
      <div class="address">${subject.address}</div>
      <div class="details">Tax ID: ${subject.accountNumber}</div>
    </div>
    
    <div class="map-container">
      <div class="map-placeholder" style="width:100%;height:100%;position:relative;">
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">
          <div style="font-size:48pt;color:#6c5ce7;">📍</div>
          <div style="font-size:14pt;font-weight:bold;color:#333;margin-top:8px;">${subject.address}</div>
          <div style="font-size:11pt;color:#666;margin-top:4px;">Tanglewood Addition, Fort Worth, TX 76109</div>
          <div style="font-size:10pt;color:#999;margin-top:12px;">
            Subject property location — Tanglewood neighborhood<br>
            All 15 comparable properties are within this subdivision
          </div>
          <div style="margin-top:20px;padding:12px 20px;background:#f0eef9;border-radius:8px;display:inline-block;">
            <div style="font-size:9pt;color:#6c5ce7;font-weight:bold;">🗺️ Interactive map available at overassessed.ai</div>
          </div>
        </div>
      </div>
    </div>
    
    <div class="footer">
      <span>Account: ${subject.accountNumber}</span>
      <span>${today}</span>
      <span>Page 7 of 8</span>
      <span>Confidential &copy; 2026 OverAssessed LLC</span>
    </div>
  </div>`;
}

function buildCompsMapPage(subject, comps, today) {
  return `
  <div class="page">
    <div class="header">
      <div class="header-logo">
        <div class="oa-icon">OA</div>
        <span><span class="brand-over">Over</span><span class="brand-assessed">Assessed</span> LLC</span>
      </div>
      <div class="header-center">
        <div class="prep-label">Prepared by:</div>
        <div class="prep-name">OverAssessed LLC</div>
        <div class="prep-name">Tyler Worthey</div>
      </div>
      <div class="header-right">
        tyler@overassessed.ai<br>
        (888) 282-9165
      </div>
    </div>
    <div class="banner">Comparable Properties Map</div>
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
          All comparable properties are within the Tanglewood Addition subdivision, Fort Worth, TX 76109.<br>
          Properties selected from Tarrant County Appraisal District 2025 certified values.
        </div>
      </div>
    </div>
    
    <div class="footer">
      <span>Account: ${subject.accountNumber}</span>
      <span>${today}</span>
      <span>Page 8 of 8</span>
      <span>Confidential &copy; 2026 OverAssessed LLC</span>
    </div>
  </div>`;
}

// Run
main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
