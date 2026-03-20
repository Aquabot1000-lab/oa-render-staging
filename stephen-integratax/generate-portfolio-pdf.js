#!/usr/bin/env node
/**
 * OverAssessed LLC — Portfolio Assessment PDF Generator (v3)
 * Apple-level design quality. McKinsey meets Apple product page.
 * 
 * Client: Dario Properties LTD / Bijan Bonakchi
 * Uses Playwright for HTML→PDF rendering
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_PDF = path.join(__dirname, '..', 'evidence-packets', 'Dario-Properties-Portfolio-Assessment-v3.pdf');
const OUTPUT_HTML = path.join(__dirname, 'portfolio-report-v3.html');

// ─── Portfolio Data (parsed from analysis markdown files) ───────────
const CLIENT = {
  name: 'Bijan Bonakchi',
  entity: 'Dario Properties LTD',
  totalProperties: 11,
  commercialCount: 5,
  personalCount: 6,
  totalMarketValue: 13700000,
  annualCommercialTax: 203000,
  currentAgent: 'Code 60476 / 60585',
};

const PROPERTIES = [
  {
    id: 1,
    address: '12840 W Interstate 10',
    city: 'San Antonio, TX 78249',
    type: 'Strip Center',
    typeCode: '325',
    sqft: 6681,
    yearBuilt: 2007,
    acres: 0.68,
    improvementValue: 817240,
    landValue: 1097760,
    totalAssessed: 1915000,
    impPSF: 122.33,
    totalPSF: 286.64,
    annualTax: 43857,
    taxRate: 2.290174,
    valueTrend: [
      { year: 2022, value: 1825000 },
      { year: 2023, value: 1900000 },
      { year: 2024, value: 1910000 },
      { year: 2025, value: 1915000 },
    ],
    recommendedValue: 1725000,
    estimatedSavings: 4351,
    protestStrategy: 'Focus on improvement overvaluation — argue the $817K improvement value should be closer to $550K–$600K based on age/condition depreciation. E&U supports marginal reduction (median $1.88M).',
    agentGrade: 'F',
    agentNote: 'Value increased every year. +$90K (+5%) over 4 years.',
    euSupports: true,
    euNote: 'Marginal — median of best 5 comps: $1,880,544',
  },
  {
    id: 2,
    address: '12830 Silicon Dr',
    city: 'San Antonio, TX 78249',
    type: 'Strip Center (Tommy\'s)',
    typeCode: '224',
    sqft: 9300,
    yearBuilt: 2017,
    acres: 2.13,
    improvementValue: 1493790,
    landValue: 1756210,
    totalAssessed: 3250000,
    impPSF: 160.62,
    totalPSF: 349.46,
    annualTax: 74431,
    taxRate: 2.290174,
    valueTrend: [
      { year: 2022, value: 2995000 },
      { year: 2023, value: 3200000 },
      { year: 2024, value: 3162000 },
      { year: 2025, value: 3250000 },
    ],
    recommendedValue: 2875000,
    estimatedSavings: 8588,
    protestStrategy: 'Challenge improvement value — $1.49M for 9,300 SF of 8-year-old strip center is high. Comparable strip center improvements average $80–$120/SF. Reducing improvements to $1.1M brings total to ~$2.85M.',
    agentGrade: 'F',
    agentNote: 'Value increased +$255K (+9%) over 4 years.',
    euSupports: false,
    euNote: 'Not analyzed via E&U — income/improvement approach recommended',
  },
  {
    id: 3,
    address: '15910 University Oaks',
    city: 'San Antonio, TX 78249',
    type: 'Storage Warehouse',
    typeCode: '320',
    sqft: 19040,
    yearBuilt: 2024,
    acres: 1.88,
    improvementValue: 122880,
    landValue: 627120,
    totalAssessed: 750000,
    impPSF: 6.45,
    totalPSF: 39.39,
    annualTax: 17176,
    taxRate: 2.290174,
    valueTrend: [
      { year: 2022, value: 459180 },
      { year: 2023, value: 467000 },
      { year: 2024, value: 490000 },
      { year: 2025, value: 750000 },
    ],
    recommendedValue: 675000,
    estimatedSavings: 1718,
    protestStrategy: 'New construction in 2024 — protest the $260K jump from $490K. Improvement value ($6.45/SF) is already very low. Focus protest on land value ($333K/acre vs market).',
    agentGrade: 'N/A',
    agentNote: 'New construction — value jump expected.',
    euSupports: false,
    euNote: 'DO NOT PROTEST via E&U — all comps far above ($2.8M–$3.5M). Currently assessed favorably.',
    caution: true,
  },
  {
    id: 4,
    address: '14988 Potranco Rd',
    city: 'San Antonio, TX 78245',
    type: 'Vacant Commercial Land',
    typeCode: '099',
    sqft: 253476,
    yearBuilt: null,
    acres: 5.819,
    improvementValue: 0,
    landValue: 990000,
    totalAssessed: 990000,
    impPSF: null,
    totalPSF: 3.90,
    annualTax: 18182,
    taxRate: 1.836516,
    valueTrend: [
      { year: 2022, value: 875760 },
      { year: 2023, value: 950000 },
      { year: 2024, value: 950000 },
      { year: 2025, value: 990000 },
    ],
    recommendedValue: 925000,
    estimatedSavings: 1194,
    protestStrategy: 'Market value / income approach — compare to actual sale prices and absorption rates. Argue value should hold at 2023–2024 level of $950K. At $170K/acre, already lowest among Potranco comps.',
    agentGrade: 'D',
    agentNote: 'Value increased +$114K (+13%) over 4 years.',
    euSupports: false,
    euNote: 'E&U does not support — all nearby vacant parcels assessed higher ($253K–$869K/acre).',
  },
  {
    id: 5,
    address: '12300 W Interstate 10',
    city: 'San Antonio, TX 78230',
    type: 'Strip Center (Rug Store)',
    typeCode: '224',
    sqft: 17570,
    yearBuilt: 1982,
    acres: 1.90,
    improvementValue: 737250,
    landValue: 1412750,
    totalAssessed: 2150000,
    impPSF: 41.96,
    totalPSF: 122.37,
    annualTax: 49239,
    taxRate: 2.290174,
    entity: 'I-10 Rug Centr LTD',
    valueTrend: [
      { year: 2022, value: 2400000 },
      { year: 2023, value: 2400000 },
      { year: 2024, value: 2350000 },
      { year: 2025, value: 2150000 },
    ],
    recommendedValue: 1950000,
    estimatedSavings: 4580,
    protestStrategy: 'Income approach + condition/obsolescence — 43-year-old building with significant depreciation. Two E&U comps adjust below subject ($1.74M, $1.90M). Push for further reduction below $2M.',
    agentGrade: 'B+',
    agentNote: 'Only property with reductions — down $250K (-10%) over 4 years. ✓',
    euSupports: false,
    euNote: 'Median above subject, but 2 comps below. Use selective comp presentation + income approach.',
  },
];

const PORTFOLIO_SUMMARY = {
  currentTotal: 9055000,
  recommendedTotal: 8150000,
  totalReduction: 905000,
  reductionPct: 10,
  annualSavings: 20431,
  oaFee: 4086,
};

// ─── Formatting Helpers ─────────────────────────────────────────────
function fmtDollar(n) {
  if (n === null || n === undefined) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  return Math.round(n).toLocaleString('en-US');
}
function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  return n.toFixed(1) + '%';
}

// ─── Grade color helper ─────────────────────────────────────────────
function gradeColor(grade) {
  if (grade === 'F') return '#e74c3c';
  if (grade === 'D') return '#e67e22';
  if (grade === 'N/A') return '#95a5a6';
  if (grade.startsWith('B')) return '#27ae60';
  if (grade.startsWith('A')) return '#2ecc71';
  return '#95a5a6';
}

// ─── Trend arrow ────────────────────────────────────────────────────
function trendArrow(trend) {
  if (!trend || trend.length < 2) return '';
  const first = trend[0].value;
  const last = trend[trend.length - 1].value;
  const diff = last - first;
  if (diff > 0) return `<span style="color:#e74c3c;">↑ +${fmtDollar(diff)}</span>`;
  if (diff < 0) return `<span style="color:#27ae60;">↓ ${fmtDollar(diff)}</span>`;
  return `<span style="color:#95a5a6;">→ Flat</span>`;
}

// ─── Savings bar width ──────────────────────────────────────────────
function savingsBarWidth(savings, maxSavings) {
  return Math.max(8, Math.round((savings / maxSavings) * 100));
}

// ─── Build HTML ─────────────────────────────────────────────────────
function buildHTML() {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const maxSavings = Math.max(...PROPERTIES.map(p => p.estimatedSavings));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, 'Helvetica Neue', 'SF Pro Display', Helvetica, Arial, sans-serif;
    font-size: 10pt;
    color: #2d3436;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    line-height: 1.5;
  }

  /* ── Page Container ── */
  .page {
    width: 8.5in;
    height: 11in; overflow: hidden;
    padding: 0;
    page-break-after: always;
    position: relative;
    overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }
  .page-inner {
    padding: 0.6in 0.7in 0.8in 0.7in;
  }

  /* ── Footer (every page) ── */
  .page-footer {
    position: absolute;
    bottom: 0.35in;
    left: 0.7in;
    right: 0.7in;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 7pt;
    color: #666;
    border-top: 0.5px solid #ccc;
    padding-top: 6px;
  }

  /* ── Cover Page ── */
  .cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 11in;
    text-align: center;
    padding: 1.5in 1in;
  }
  .cover-logo {
    font-size: 42pt;
    font-weight: 700;
    letter-spacing: -1px;
    margin-bottom: 6px;
  }
  .cover-logo .over { color: #6c5ce7; }
  .cover-logo .assessed { color: #2d3436; }
  .cover-tagline {
    font-size: 10pt;
    color: #666;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 48px;
  }
  .cover-rule {
    width: 60px;
    height: 2px;
    background: #6c5ce7;
    margin: 0 auto 48px auto;
  }
  .cover-title {
    font-size: 24pt;
    font-weight: 600;
    color: #2d3436;
    margin-bottom: 12px;
    line-height: 1.2;
  }
  .cover-subtitle {
    font-size: 14pt;
    font-weight: 400;
    color: #636e72;
    margin-bottom: 6px;
  }
  .cover-client {
    font-size: 13pt;
    font-weight: 500;
    color: #2d3436;
    margin-top: 36px;
  }
  .cover-date {
    font-size: 10pt;
    color: #666;
    margin-top: 8px;
  }
  .cover-prepared {
    font-size: 9pt;
    color: #b2bec3;
    margin-top: 32px;
    font-style: italic;
  }
  .cover-contact {
    font-size: 8pt;
    color: #b2bec3;
    margin-top: 80px;
    line-height: 1.8;
  }

  /* ── Section Headers ── */
  .section-title {
    font-size: 20pt;
    font-weight: 600;
    color: #2d3436;
    margin-bottom: 4px;
    letter-spacing: -0.5px;
  }
  .section-subtitle {
    font-size: 10pt;
    color: #666;
    margin-bottom: 28px;
  }
  .section-rule {
    width: 40px;
    height: 2px;
    background: #6c5ce7;
    margin-bottom: 24px;
  }

  /* ── Executive Summary ── */
  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 16px;
    margin-bottom: 28px;
  }
  .stat-card {
    text-align: center;
    padding: 14px 10px;
    border-radius: 8px;
    background: #edf0f2;
  }
  .stat-card .stat-value {
    font-size: 22pt;
    font-weight: 700;
    color: #6c5ce7;
    margin-bottom: 4px;
  }
  .stat-card .stat-label {
    font-size: 8pt;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .stat-card.highlight {
    background: #6c5ce7;
  }
  .stat-card.highlight .stat-value { color: #fff; }
  .stat-card.highlight .stat-label { color: rgba(255,255,255,0.7); }

  /* ── Portfolio Table ── */
  .portfolio-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8.5pt;
    margin-bottom: 14px;
  }
  .portfolio-table th {
    text-align: left;
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #666;
    font-weight: 600;
    padding: 8px 10px;
    border-bottom: 1.5px solid #2d3436;
  }
  .portfolio-table th:last-child,
  .portfolio-table td:last-child { text-align: right; }
  .portfolio-table td {
    padding: 10px 10px;
    border-bottom: 0.5px solid #eee;
    vertical-align: middle;
  }
  .portfolio-table tr:last-child td {
    border-bottom: none;
  }
  .portfolio-table .total-row td {
    font-weight: 700;
    border-top: 1.5px solid #2d3436;
    padding-top: 12px;
    font-size: 9pt;
  }
  .portfolio-table .prop-name {
    font-weight: 600;
    color: #2d3436;
  }
  .portfolio-table .prop-type {
    font-size: 7.5pt;
    color: #666;
  }

  /* ── Agent Scorecard ── */
  .scorecard-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8.5pt;
    margin-bottom: 16px;
  }
  .scorecard-table th {
    text-align: left;
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #666;
    font-weight: 600;
    padding: 8px 10px;
    border-bottom: 1.5px solid #2d3436;
  }
  .scorecard-table td {
    padding: 8px 10px;
    border-bottom: 0.5px solid #eee;
    vertical-align: middle;
  }
  .grade-badge {
    display: inline-block;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: #fff;
    font-weight: 700;
    font-size: 10pt;
    text-align: center;
    line-height: 28px;
  }

  /* ── Property Card Pages ── */
  .property-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 0.5px solid #eee;
  }
  .property-number {
    font-size: 11pt;
    font-weight: 700;
    color: #6c5ce7;
    margin-bottom: 2px;
  }
  .property-address {
    font-size: 18pt;
    font-weight: 600;
    color: #2d3436;
    letter-spacing: -0.5px;
    margin-bottom: 2px;
  }
  .property-city {
    font-size: 10pt;
    color: #666;
  }
  .property-type-badge {
    display: inline-block;
    padding: 4px 14px;
    border-radius: 20px;
    background: #edf0f2;
    font-size: 8pt;
    font-weight: 600;
    color: #636e72;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* ── Metrics Grid ── */
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 20px;
  }
  .metric-box {
    padding: 14px 12px;
    background: #edf0f2;
    border-radius: 6px;
  }
  .metric-box .metric-label {
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #666;
    margin-bottom: 4px;
  }
  .metric-box .metric-value {
    font-size: 14pt;
    font-weight: 600;
    color: #2d3436;
  }
  .metric-box .metric-sub {
    font-size: 7.5pt;
    color: #b2bec3;
    margin-top: 2px;
  }

  /* ── Savings Indicator ── */
  .savings-section {
    display: flex;
    gap: 16px;
    margin-bottom: 20px;
    align-items: stretch;
  }
  .savings-box {
    flex: 1;
    padding: 16px;
    border-radius: 8px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
  }
  .savings-box .savings-label {
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #16a34a;
    margin-bottom: 6px;
  }
  .savings-box .savings-value {
    font-size: 18pt;
    font-weight: 700;
    color: #16a34a;
  }
  .savings-box .savings-sub {
    font-size: 8pt;
    color: #86efac;
    margin-top: 2px;
  }
  .recommended-box {
    flex: 1;
    padding: 16px;
    border-radius: 8px;
    background: #f5f3ff;
    border: 1px solid #ddd6fe;
  }
  .recommended-box .rec-label {
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #6c5ce7;
    margin-bottom: 6px;
  }
  .recommended-box .rec-value {
    font-size: 18pt;
    font-weight: 700;
    color: #6c5ce7;
  }
  .recommended-box .rec-sub {
    font-size: 8pt;
    color: #a78bfa;
    margin-top: 2px;
  }
  .trend-box {
    flex: 0.8;
    padding: 16px;
    border-radius: 8px;
    background: #edf0f2;
  }
  .trend-box .trend-label {
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #666;
    margin-bottom: 6px;
  }
  .trend-box .trend-value {
    font-size: 11pt;
    font-weight: 600;
  }

  /* ── Value Trend Mini-Chart ── */
  .trend-mini {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 32px;
    margin-top: 6px;
  }
  .trend-bar {
    flex: 1;
    background: #e0e0e0;
    border-radius: 2px 2px 0 0;
    min-height: 4px;
    position: relative;
  }
  .trend-bar.current { background: #6c5ce7; }
  .trend-bar-label {
    position: absolute;
    bottom: -14px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 5.5pt;
    color: #b2bec3;
    white-space: nowrap;
  }

  /* ── Strategy Callout ── */
  .strategy-box {
    padding: 16px 20px;
    border-left: 3px solid #6c5ce7;
    background: #fafafe;
    border-radius: 0 6px 6px 0;
    margin-bottom: 16px;
  }
  .strategy-box .strategy-title {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #6c5ce7;
    font-weight: 700;
    margin-bottom: 6px;
  }
  .strategy-box .strategy-text {
    font-size: 9pt;
    color: #636e72;
    line-height: 1.6;
  }

  /* ── Agent Grade ── */
  .agent-section {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: #edf0f2;
    border-radius: 6px;
  }
  .agent-section .agent-text {
    font-size: 8.5pt;
    color: #636e72;
    line-height: 1.5;
  }

  /* ── Caution Banner ── */
  .caution-banner {
    padding: 10px 16px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 6px;
    margin-bottom: 16px;
    font-size: 8.5pt;
    color: #92400e;
  }
  .caution-banner strong { color: #78350f; }

  /* ── Next Steps Page ── */
  .steps-list {
    counter-reset: step;
    list-style: none;
    padding: 0;
  }
  .steps-list li {
    counter-increment: step;
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 20px;
    padding-bottom: 20px;
    border-bottom: 0.5px solid #eee;
  }
  .steps-list li:last-child { border-bottom: none; }
  .step-number {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #6c5ce7;
    color: #fff;
    font-size: 14pt;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .step-content h4 {
    font-size: 11pt;
    font-weight: 600;
    color: #2d3436;
    margin-bottom: 4px;
  }
  .step-content p {
    font-size: 9pt;
    color: #636e72;
    line-height: 1.6;
  }

  /* ── Guarantee Box ── */
  .guarantee-box {
    padding: 24px;
    background: #f5f3ff;
    border-radius: 8px;
    text-align: center;
    margin-top: 32px;
  }
  .guarantee-box .guarantee-title {
    font-size: 14pt;
    font-weight: 700;
    color: #6c5ce7;
    margin-bottom: 8px;
  }
  .guarantee-box .guarantee-text {
    font-size: 9.5pt;
    color: #636e72;
    line-height: 1.6;
    max-width: 420px;
    margin: 0 auto;
  }
</style>
</head>
<body>

<!-- ════════════════════════════════════════════════════════════════ -->
<!-- COVER PAGE                                                     -->
<!-- ════════════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="cover">
    <div class="cover-logo">
      <span class="over">Over</span><span class="assessed">Assessed</span>
    </div>
    <div class="cover-tagline">Real Experts · Real Results · Guaranteed</div>
    <div class="cover-rule"></div>
    <div class="cover-title">Commercial Property Tax<br>Portfolio Assessment</div>
    <div class="cover-subtitle">Comprehensive Analysis & Protest Strategy</div>
    <div class="cover-client">${CLIENT.entity}</div>
    <div class="cover-client" style="font-weight:400; font-size:11pt; color:#636e72;">${CLIENT.name}</div>
    <div class="cover-date">${today}</div>
    <div class="cover-prepared">Prepared exclusively for ${CLIENT.name}</div>
    <div class="cover-contact">
      tyler@overassessed.ai&nbsp;&nbsp;·&nbsp;&nbsp;(888) 282-9165&nbsp;&nbsp;·&nbsp;&nbsp;overassessed.ai
    </div>
  </div>
  <div class="page-footer">
    <span>Confidential — Prepared for ${CLIENT.name}</span>
    <span>Page 1</span>
    <span>© 2026 OverAssessed LLC</span>
  </div>
</div>

<!-- ════════════════════════════════════════════════════════════════ -->
<!-- EXECUTIVE SUMMARY                                              -->
<!-- ════════════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-inner">
    <div class="section-title">Executive Summary</div>
    <div class="section-subtitle">Portfolio overview and opportunity assessment</div>
    <div class="section-rule"></div>

    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-value">${CLIENT.commercialCount}</div>
        <div class="stat-label">Commercial Properties</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtDollar(PORTFOLIO_SUMMARY.currentTotal)}</div>
        <div class="stat-label">Current Assessed Value</div>
      </div>
      <div class="stat-card highlight">
        <div class="stat-value">${fmtDollar(PORTFOLIO_SUMMARY.annualSavings)}</div>
        <div class="stat-label">Estimated Annual Savings</div>
      </div>
    </div>

    <!-- Portfolio Table -->
    <table class="portfolio-table">
      <thead>
        <tr>
          <th>Property</th>
          <th>Type</th>
          <th>Current Value</th>
          <th>Recommended</th>
          <th>Annual Savings</th>
        </tr>
      </thead>
      <tbody>
        ${PROPERTIES.map(p => `
        <tr>
          <td>
            <div class="prop-name">${p.address}</div>
            <div class="prop-type">${p.city}</div>
          </td>
          <td><span class="property-type-badge" style="font-size:7pt;padding:2px 8px;">${p.type}</span></td>
          <td>${fmtDollar(p.totalAssessed)}</td>
          <td style="color:#6c5ce7;font-weight:600;">${fmtDollar(p.recommendedValue)}</td>
          <td style="color:#16a34a;font-weight:600;">${fmtDollar(p.estimatedSavings)}/yr</td>
        </tr>`).join('')}
        <tr class="total-row">
          <td colspan="2">Portfolio Total</td>
          <td>${fmtDollar(PORTFOLIO_SUMMARY.currentTotal)}</td>
          <td style="color:#6c5ce7;">${fmtDollar(PORTFOLIO_SUMMARY.recommendedTotal)}</td>
          <td style="color:#16a34a;">${fmtDollar(PORTFOLIO_SUMMARY.annualSavings)}/yr</td>
        </tr>
      </tbody>
    </table>

    <!-- Agent Scorecard -->
    <div style="margin-top: 20px;">
      <div style="font-size:12pt;font-weight:600;color:#2d3436;margin-bottom:4px;">Current Agent Performance</div>
      <div style="font-size:8pt;color:#666;margin-bottom:12px;">4-year value change under existing representation (2022–2025)</div>
      <table class="scorecard-table">
        <thead>
          <tr>
            <th>Property</th>
            <th>2022 Value</th>
            <th>2025 Value</th>
            <th>Change</th>
            <th>Grade</th>
          </tr>
        </thead>
        <tbody>
          ${PROPERTIES.map(p => {
            const v22 = p.valueTrend.find(t => t.year === 2022);
            const v25 = p.valueTrend.find(t => t.year === 2025);
            const change = v25 && v22 ? v25.value - v22.value : 0;
            const changePct = v22 && v22.value ? ((change / v22.value) * 100).toFixed(1) : '—';
            return `
          <tr>
            <td style="font-weight:500;">${p.address}</td>
            <td>${v22 ? fmtDollar(v22.value) : '—'}</td>
            <td>${v25 ? fmtDollar(v25.value) : '—'}</td>
            <td>${change > 0 ? '<span style="color:#e74c3c;">+' + fmtDollar(change) + ' (' + changePct + '%)</span>' : change < 0 ? '<span style="color:#27ae60;">' + fmtDollar(change) + ' (' + changePct + '%)</span>' : '<span style="color:#95a5a6;">Flat</span>'}</td>
            <td><span class="grade-badge" style="background:${gradeColor(p.agentGrade)};">${p.agentGrade}</span></td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="font-size:8pt;color:#666;margin-top:8px;">Overall Grade: <strong style="color:#e74c3c;">D</strong> — Only 1 of 5 commercial properties saw a reduction under current agent.</div>
    </div>
  </div>
  <div class="page-footer">
    <span>Confidential — Prepared for ${CLIENT.name}</span>
    <span>Page 2</span>
    <span>© 2026 OverAssessed LLC</span>
  </div>
</div>

<!-- ════════════════════════════════════════════════════════════════ -->
<!-- PROPERTY DETAIL PAGES                                          -->
<!-- ════════════════════════════════════════════════════════════════ -->
${PROPERTIES.map((p, idx) => {
  const maxVal = Math.max(...p.valueTrend.map(t => t.value));
  const minVal = Math.min(...p.valueTrend.map(t => t.value));
  const range = maxVal - minVal || 1;

  return `
<div class="page">
  <div class="page-inner">
    <div class="property-header">
      <div>
        <div class="property-number">Property ${p.id} of ${PROPERTIES.length}</div>
        <div class="property-address">${p.address}</div>
        <div class="property-city">${p.city}${p.entity ? ' · ' + p.entity : ''}</div>
      </div>
      <div class="property-type-badge">${p.type}</div>
    </div>

    <!-- Key Metrics -->
    <div class="metrics-grid">
      <div class="metric-box">
        <div class="metric-label">Assessed Value</div>
        <div class="metric-value">${fmtDollar(p.totalAssessed)}</div>
        <div class="metric-sub">Tax Year 2025</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">${p.improvementValue > 0 ? 'Improvements' : 'Land Value'}</div>
        <div class="metric-value">${fmtDollar(p.improvementValue > 0 ? p.improvementValue : p.landValue)}</div>
        <div class="metric-sub">${p.impPSF ? fmtDollar(p.impPSF) + '/SF' : fmtDollar(p.totalPSF) + '/SF'}</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">${p.sqft > 100000 ? 'Acreage' : 'Building Size'}</div>
        <div class="metric-value">${p.yearBuilt ? fmtNum(p.sqft) + ' SF' : p.acres + ' acres'}</div>
        <div class="metric-sub">${p.yearBuilt ? 'Built ' + p.yearBuilt : fmtNum(p.sqft) + ' SF'}</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Annual Tax</div>
        <div class="metric-value">${fmtDollar(p.annualTax)}</div>
        <div class="metric-sub">Rate: ${p.taxRate.toFixed(4)}%</div>
      </div>
    </div>

    <!-- Savings + Recommended -->
    <div class="savings-section">
      <div class="recommended-box">
        <div class="rec-label">Recommended Protest Value</div>
        <div class="rec-value">${fmtDollar(p.recommendedValue)}</div>
        <div class="rec-sub">Reduction of ${fmtDollar(p.totalAssessed - p.recommendedValue)} (${((p.totalAssessed - p.recommendedValue) / p.totalAssessed * 100).toFixed(1)}%)</div>
      </div>
      <div class="savings-box">
        <div class="savings-label">Estimated Annual Tax Savings</div>
        <div class="savings-value">${fmtDollar(p.estimatedSavings)}</div>
        <div class="savings-sub">per year</div>
      </div>
      <div class="trend-box">
        <div class="trend-label">4-Year Trend</div>
        <div class="trend-value">${trendArrow(p.valueTrend)}</div>
        <div class="trend-mini">
          ${p.valueTrend.map((t, i) => {
            const h = Math.max(8, ((t.value - minVal) / range) * 28 + 4);
            const isCurrent = i === p.valueTrend.length - 1;
            return `<div class="trend-bar${isCurrent ? ' current' : ''}" style="height:${h}px;"><span class="trend-bar-label">${t.year}</span></div>`;
          }).join('')}
        </div>
      </div>
    </div>

    ${p.caution ? `
    <div class="caution-banner">
      <strong>⚠ Caution:</strong> This property is assessed very favorably relative to comparable properties. 
      Protesting via E&U could draw scrutiny and result in a value <em>increase</em>. Proceed with care.
    </div>` : ''}

    <!-- Strategy -->
    <div class="strategy-box">
      <div class="strategy-title">Protest Strategy</div>
      <div class="strategy-text">${p.protestStrategy}</div>
    </div>

    <!-- E&U Status -->
    <div style="display:flex;gap:12px;margin-bottom:16px;">
      <div style="flex:1;padding:12px 16px;border-radius:6px;background:${p.euSupports ? '#f0fdf4' : '#fef2f2'};border:1px solid ${p.euSupports ? '#bbf7d0' : '#fecaca'};">
        <div style="font-size:7pt;text-transform:uppercase;letter-spacing:0.5px;color:${p.euSupports ? '#16a34a' : '#dc2626'};font-weight:700;margin-bottom:4px;">
          Equal & Uniform Analysis
        </div>
        <div style="font-size:8.5pt;color:${p.euSupports ? '#166534' : '#991b1b'};">${p.euNote}</div>
      </div>
    </div>

    <!-- Agent Grade -->
    <div class="agent-section">
      <span class="grade-badge" style="background:${gradeColor(p.agentGrade)};">${p.agentGrade}</span>
      <div class="agent-text">
        <strong>Current Agent Performance:</strong> ${p.agentNote}
      </div>
    </div>
  </div>
  <div class="page-footer">
    <span>Confidential — Prepared for ${CLIENT.name}</span>
    <span>Page ${idx + 3}</span>
    <span>© 2026 OverAssessed LLC</span>
  </div>
</div>`;
}).join('')}

<!-- ════════════════════════════════════════════════════════════════ -->
<!-- NEXT STEPS PAGE                                                -->
<!-- ════════════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-inner">
    <div class="section-title">Next Steps</div>
    <div class="section-subtitle">How OverAssessed delivers results for your portfolio</div>
    <div class="section-rule"></div>

    <ol class="steps-list">
      <li>
        <div class="step-number">1</div>
        <div class="step-content">
          <h4>Authorize OverAssessed as Your Agent</h4>
          <p>Sign Form 50-162 (Designation of Agent) for each commercial property. This authorizes us to represent you before the Appraisal Review Board and file protests on your behalf.</p>
        </div>
      </li>
      <li>
        <div class="step-number">2</div>
        <div class="step-content">
          <h4>We File Protests Immediately</h4>
          <p>Upon receiving your 2026 Notice of Appraised Value, we file protests for each property using our data-driven evidence packets — comparable property analysis, income approach, and condition documentation.</p>
        </div>
      </li>
      <li>
        <div class="step-number">3</div>
        <div class="step-content">
          <h4>Evidence-Based Informal Hearings</h4>
          <p>We present comprehensive evidence packets at informal hearings with the appraisal district. Our analysis includes Equal & Uniform comparables, income capitalization, and improvement depreciation arguments tailored to each property.</p>
        </div>
      </li>
      <li>
        <div class="step-number">4</div>
        <div class="step-content">
          <h4>Formal ARB Hearings if Needed</h4>
          <p>If informal hearings don't achieve our target, we escalate to the Appraisal Review Board with enhanced evidence and expert testimony. We don't settle for less than your properties deserve.</p>
        </div>
      </li>
      <li>
        <div class="step-number">5</div>
        <div class="step-content">
          <h4>You Only Pay When We Save You Money</h4>
          <p>Our fee is 20% of actual, documented tax savings — nothing upfront, no hidden charges. If we don't reduce your taxes, you owe us nothing. Estimated annual savings for your portfolio: <strong style="color:#6c5ce7;">${fmtDollar(PORTFOLIO_SUMMARY.annualSavings)}</strong>.</p>
        </div>
      </li>
    </ol>

    <div class="guarantee-box">
      <div class="guarantee-title">Our Guarantee</div>
      <div class="guarantee-text">
        No reduction, no fee. We only succeed when you save money.<br>
        Your worst case is $0 cost. Your best case is ${fmtDollar(PORTFOLIO_SUMMARY.annualSavings)}+ in annual savings.
      </div>
    </div>

    <div style="margin-top:36px;text-align:center;color:#666;font-size:8.5pt;">
      <div style="font-weight:600;color:#6c5ce7;font-size:10pt;margin-bottom:4px;">Ready to get started?</div>
      tyler@overassessed.ai&nbsp;&nbsp;·&nbsp;&nbsp;(888) 282-9165&nbsp;&nbsp;·&nbsp;&nbsp;overassessed.ai
    </div>
  </div>
  <div class="page-footer">
    <span>Confidential — Prepared for ${CLIENT.name}</span>
    <span>Page ${PROPERTIES.length + 3}</span>
    <span>© 2026 OverAssessed LLC</span>
  </div>
</div>

<!-- ════════════════════════════════════════════════════════════════ -->
<!-- DISCLAIMER PAGE                                                -->
<!-- ════════════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-inner">
    <div class="section-title">Notes & Disclaimer</div>
    <div class="section-subtitle">Methodology and legal information</div>
    <div class="section-rule"></div>

    <div style="font-size:9pt;color:#636e72;line-height:1.8;">
      <h3 style="font-size:11pt;font-weight:600;color:#2d3436;margin-bottom:8px;">Methodology</h3>
      <p style="margin-bottom:16px;">
        This portfolio assessment analyzes each property using multiple approaches including Equal & Uniform (E&U) 
        comparable analysis under Texas Tax Code §42.26, market value comparison, income capitalization, and 
        condition/depreciation review. Data is sourced from Bexar County Appraisal District (BCAD) 2025 certified values 
        via bexar.trueautomation.com.
      </p>

      <h3 style="font-size:11pt;font-weight:600;color:#2d3436;margin-bottom:8px;">Equal & Uniform Analysis</h3>
      <p style="margin-bottom:8px;">
        Under Texas Tax Code §42.26, a property owner may protest that their property's appraised value exceeds 
        the median appraised value of comparable properties appropriately adjusted. Our E&U analysis:
      </p>
      <div style="background:#f8f9fa;border-radius:6px;padding:12px 16px;font-family:'SF Mono','Courier New',monospace;font-size:8pt;line-height:1.8;margin-bottom:16px;">
        Size Adjustment = (Comp_PSF × (Subject_Area − Comp_Area)) / 2<br>
        Age Adjustment = Adjusted_Value × 0.5 × (Subject_EffYear − Comp_EffYear) / 100<br>
        Land Adjustment = Subject_Land_Value − Comp_Land_Value<br>
        Indicated Value = Median of all adjusted comparable values
      </div>

      <h3 style="font-size:11pt;font-weight:600;color:#2d3436;margin-bottom:8px;">Tax Rate Information</h3>
      <p style="margin-bottom:16px;">
        Tax rates used: City of San Antonio properties at 2.290174%. Potranco Rd (outside city limits) at 1.836516%. 
        Actual savings will depend on 2026 tax rates set by local taxing authorities.
      </p>

      <h3 style="font-size:11pt;font-weight:600;color:#2d3436;margin-bottom:8px;">Important Disclosures</h3>
      <p style="margin-bottom:16px;">
        Recommended values are estimates based on comparable property data and professional judgment. 
        Actual outcomes depend on appraisal district negotiations and ARB hearing results. Past performance 
        of current or prior agents does not guarantee future results. OverAssessed LLC is not a licensed appraiser; 
        this analysis is prepared for property tax protest purposes only and does not constitute a formal appraisal.
      </p>
    </div>

    <div style="margin-top:40px;padding-top:16px;border-top:0.5px solid #eee;font-size:7.5pt;color:#b2bec3;line-height:1.7;">
      This document is confidential and prepared exclusively for ${CLIENT.name} / ${CLIENT.entity}. 
      It may not be distributed, reproduced, or shared without the express written consent of OverAssessed LLC. 
      All data sourced from public appraisal district records. OverAssessed LLC makes no warranty regarding 
      protest outcomes or guaranteed savings amounts. Fee structure: 20% of documented first-year tax savings; 
      $0 if no reduction achieved.
    </div>
  </div>
  <div class="page-footer">
    <span>Confidential — Prepared for ${CLIENT.name}</span>
    <span>Page ${PROPERTIES.length + 4}</span>
    <span>© 2026 OverAssessed LLC</span>
  </div>
</div>

</body>
</html>`;
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('Building portfolio assessment HTML...');
  const html = buildHTML();
  
  // Ensure output dirs exist
  const evidenceDir = path.dirname(OUTPUT_PDF);
  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });
  
  fs.writeFileSync(OUTPUT_HTML, html, 'utf8');
  console.log(`✅ HTML saved: ${OUTPUT_HTML}`);
  
  // Render PDF via Playwright
  console.log('Rendering PDF via Playwright...');
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.pdf({
    path: OUTPUT_PDF,
    format: 'Letter',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });
  
  await browser.close();
  
  const stats = fs.statSync(OUTPUT_PDF);
  console.log(`✅ PDF saved: ${OUTPUT_PDF} (${(stats.size / 1024).toFixed(0)} KB)`);
  console.log(`\n📊 Portfolio Summary:`);
  console.log(`   Properties: ${PROPERTIES.length} commercial`);
  console.log(`   Current Total: ${fmtDollar(PORTFOLIO_SUMMARY.currentTotal)}`);
  console.log(`   Recommended: ${fmtDollar(PORTFOLIO_SUMMARY.recommendedTotal)}`);
  console.log(`   Reduction Target: ${fmtDollar(PORTFOLIO_SUMMARY.totalReduction)} (${PORTFOLIO_SUMMARY.reductionPct}%)`);
  console.log(`   Annual Savings: ${fmtDollar(PORTFOLIO_SUMMARY.annualSavings)}`);
  console.log(`   Pages: ${PROPERTIES.length + 4}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
