/**
 * package-renderer.js
 * Protest Package — Spec v1.1 Renderer
 *
 * Wraps the proven services/taxnet-package-generator.js renderers with
 * Spec v1.1 overrides:
 *   - Footer: "Source: <County> CAD + OverAssessed Analysis | N Comps | ..."
 *   - Both protest grounds checked unless ctx.protestGrounds overrides
 *   - No TaxNet branding in any rendered string
 *   - calcAdjustments() from services/taxnet-package-generator.js only
 *   - Median comp identified across full N-comp set
 *   - Real OSM maps via services/map-generator.js
 *
 * Page order (Spec v1.1, mirrors OA-0037):
 *   Page 1         : Form 50-132
 *   Pages 2..G+1   : E&U Comp Grid (G = ceil(N/3) pages)
 *   Page G+2       : Evidence Summary & Protest Argument
 *   Page G+3       : Subject Property Location Map
 *   Page G+4       : Subject & Comparable Properties Map
 *   Total          : 4 + ceil(N/3)
 */

'use strict';

const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');
const { calcAdjustments } = require('../../services/taxnet-package-generator');
const { generateMapImage, geocode } = require('../../services/map-generator');
const { buildFailure } = require('./error-contract');

// ── Constants ─────────────────────────────────────────────────────────────────
const AGENT = {
  name:    'OverAssessed, LLC',
  address: '6002 Camp Bullis, Suite 208, San Antonio, TX 78257',
  phone:   '(888) 282-9165',
  email:   'info@overassessed.ai',
};

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(n) {
  return '$' + Math.abs(Math.round(n)).toLocaleString();
}
function fmtAdj(dollar, pct) {
  const d = Math.round(dollar);
  const p = Math.abs(parseFloat(pct.toFixed(2)));
  const dSign = d < 0 ? '$-' : '$';
  const pSign = dollar < 0 ? '-' : '';
  return `${dSign}${Math.abs(d).toLocaleString()} (${pSign}${p.toFixed(2)}%)`;
}
function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── PAGE 1: Form 50-132 ───────────────────────────────────────────────────────
function renderForm50132(doc, ctx) {
  // First page already open from PDFDocument constructor
  const mv = ctx.protestGrounds?.marketValue ?? true;
  const ue = ctx.protestGrounds?.unequal     ?? true;

  doc.fontSize(9).font('Helvetica').text('Form 50-132', 450, 50, { align: 'right' });
  doc.fontSize(14).font('Helvetica-Bold').text('Notice of Protest', 50, 50, { width: 400 });
  doc.fontSize(10).font('Helvetica').text('Before the Appraisal Review Board', 50, 68);
  doc.fontSize(9).text('Tax Code Sections 41.41, 41.44, 41.45', 50, 80);

  let y = 106;
  const fl = (lbl, val, x, yy, w) => {
    doc.font('Helvetica-Bold').fontSize(8).text(lbl, x, yy, { continued: true });
    doc.font('Helvetica').text(' ' + (val || ''), { width: w || 460 });
  };

  doc.font('Helvetica-Bold').fontSize(9).text('STEP 1: Appraisal District', 50, y); y += 14;
  fl('District:', ctx.appraisalDistrict, 50, y); y += 13;
  fl('Tax Year:', String(ctx.taxYear), 50, y); y += 18;

  doc.font('Helvetica-Bold').fontSize(9).text('STEP 2: Owner / Agent', 50, y); y += 14;
  fl('Owner:', ctx.ownerName, 50, y); y += 13;
  fl('Address:', ctx.ownerAddress || ctx.propertyAddress, 50, y); y += 13;
  doc.font('Helvetica-Bold').fontSize(8).text('Phone:', 50, y, { continued: true });
  doc.font('Helvetica').text(' ' + (ctx.ownerPhone || ''), { continued: true });
  doc.font('Helvetica-Bold').text('   Email:', { continued: true });
  doc.font('Helvetica').text(' ' + (ctx.ownerEmail || '')); y += 13;
  fl('Agent:', AGENT.name, 50, y); y += 13;
  fl('Agent Addr:', AGENT.address, 50, y); y += 13;
  doc.font('Helvetica-Bold').fontSize(8).text('Agent Phone:', 50, y, { continued: true });
  doc.font('Helvetica').text(' ' + AGENT.phone, { continued: true });
  doc.font('Helvetica-Bold').text('   Agent Email:', { continued: true });
  doc.font('Helvetica').text(' ' + AGENT.email); y += 18;

  doc.font('Helvetica-Bold').fontSize(9).text('STEP 3: Property', 50, y); y += 14;
  doc.font('Helvetica-Bold').fontSize(8).text('Account #:', 50, y, { continued: true });
  doc.font('Helvetica').text(' ' + (ctx.accountNumber || ''), { continued: true });
  doc.font('Helvetica-Bold').text('   Geo ID:', { continued: true });
  doc.font('Helvetica').text(' ' + (ctx.geoId || '')); y += 13;
  fl('Address:', ctx.propertyAddress, 50, y); y += 13;
  fl('Legal:', ctx.legalDescription || '', 50, y); y += 18;

  doc.font('Helvetica-Bold').fontSize(9).text('STEP 4: Protest Grounds', 50, y); y += 14;
  // Draw checkboxes as filled/empty rectangles — universal PDF reader compatibility
  function drawCheckbox(checked, x, yy) {
    doc.save();
    doc.lineWidth(0.8).strokeColor('#000');
    doc.rect(x, yy, 9, 9).stroke();
    if (checked) {
      doc.rect(x + 2, yy + 2, 5, 5).fill('#000');
    }
    doc.restore();
    doc.fillColor('#000');
  }
  doc.font('Helvetica').fontSize(8);
  drawCheckbox(mv, 60, y);
  doc.text('Value exceeds market value (§41.41(a)(1))', 75, y, { lineBreak: false }); y += 14;
  drawCheckbox(ue, 60, y);
  doc.text('Value is unequal compared with similar properties (§41.41(a)(2))', 75, y, { lineBreak: false }); y += 18;

  doc.font('Helvetica-Bold').fontSize(9).text('STEP 5: Values', 50, y); y += 14;
  fl('District Appraised:', fmt(ctx.appraisedValue), 50, y); y += 13;
  fl('Owner Opinion:', fmt(ctx.ownerOpinion || 0), 50, y); y += 22;

  doc.font('Helvetica-Bold').fontSize(9).text('STEP 6: Signature', 50, y); y += 16;
  doc.font('Helvetica').fontSize(8);
  doc.text('Signature: ________________________________    Date: ___________', 50, y); y += 14;
  doc.text('Print Name: ' + ctx.ownerName, 50, y);

  // Footer — mirrors OA-0037 Form 50-132 footer structure, TaxNet branding stripped per Spec v1.1
  doc.fontSize(7).fillColor('#666')
    .text('Texas Comptroller Form 50-132 — Equal & Uniform Protest', 50, 720, { align: 'center', width: 500 });
  doc.fillColor('#000');
}

// ── PAGES 2..G+1: E&U Comp Grid ──────────────────────────────────────────────
/**
 * Renders all grid pages. Returns computed stats for use by later pages.
 * @returns {{ allAdj, adjValues, medianVal, minVal, maxVal, medianComp, medianIdx }}
 */
function renderCompGridPages(doc, ctx) {
  const subject = ctx.subject;
  const comps   = ctx.comps;
  const N = comps.length;

  // Compute all adjustments using the real service (no inline math)
  const subjectForCalc = {
    sqft:             subject.sqft,
    yearBuilt:        subject.yearBuilt,
    effectiveYear:    subject.effectiveYear,
    landValue:        subject.landValue,
    conditionScore:   subject.conditionScore,
    improvementValue: subject.improvementValue,
    featureValue:     subject.featureValue,
    poolValue:        subject.poolValue,
    assessedValue:    ctx.appraisedValue,
    address:          ctx.propertyAddress,
    county:           ctx.county,
    accountId:        ctx.accountNumber,
    ownerName:        ctx.ownerName,
  };

  const allAdj = comps.map(c => {
    const compForCalc = {
      marketValue:      c.marketValue,
      sqft:             c.sqft,
      yearBuilt:        c.yearBuilt,
      effectiveYear:    c.effectiveYear,
      landValue:        c.landValue,
      conditionScore:   c.conditionScore,
      improvementValue: c.improvementValue,
      featureValue:     c.featureValue,
      poolValue:        c.poolValue,
    };
    const result = calcAdjustments(compForCalc, subjectForCalc);
    if (!result || isNaN(result.adjustedValue)) {
      throw buildFailure({
        caseId: ctx.caseId, mode: ctx.__SAMPLE__ ? 'SAMPLE' : 'LIVE',
        stage: 'render', command: 'calcAdjustments()',
        file: 'NONE', mutated: false,
        message: `BLOCKED — calcAdjustments() failed for comp ${c.cadAccountNumber || c.seqNum}`,
        nextStep: 'Check comp data fields; calcAdjustments() returned NaN or null.',
      });
    }
    return result;
  });

  // Sort by adjusted value to find median, min, max
  const adjValues = allAdj.map(a => a.adjustedValue);
  const sorted = [...adjValues].sort((a, b) => a - b);
  const minVal    = sorted[0];
  const maxVal    = sorted[sorted.length - 1];
  const medianVal = sorted[Math.floor(N / 2)];
  const medianIdx = allAdj.findIndex(a => a.adjustedValue === medianVal);

  // Layout
  const PW = 612, PH = 792;
  const ML = 28, MR = 28, MT = 28;
  const contentW  = PW - ML - MR;   // 556
  const LABEL_W   = 130;
  const COMPS_PP  = 3;
  const COLS      = 1 + COMPS_PP;
  const COL_W     = Math.floor((contentW - LABEL_W) / COLS);
  const ROW_H     = 14;
  const FSZ       = 6.5;
  const FSZ_HDR   = 7;
  const HEADER_H  = 76;
  const FOOTER_Y  = PH - 32;

  const gridPages = Math.ceil(N / COMPS_PP);

  for (let pg = 0; pg < gridPages; pg++) {
    doc.addPage({ size: 'LETTER', margin: 0 });

    const pgComps = comps.slice(pg * COMPS_PP, pg * COMPS_PP + COMPS_PP);
    const pgAdjs  = allAdj.slice(pg * COMPS_PP, pg * COMPS_PP + COMPS_PP);
    const pgOffset = pg * COMPS_PP;

    // ── Header ──────────────────────────────────────────────────────────────
    doc.rect(ML, MT, contentW, 16).fill('#1a3a5c');
    doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(9)
      .text('Equal & Uniform Analysis', ML, MT + 3, { width: contentW, align: 'center', lineBreak: false });
    doc.fillColor('#000');

    doc.font('Helvetica-Bold').fontSize(8)
      .text(ctx.propertyAddress.toUpperCase(), ML, MT + 22, { lineBreak: false });
    doc.font('Helvetica').fontSize(7)
      .text('Tax ID: ' + (ctx.accountNumber || ''), ML, MT + 32, { lineBreak: false });
    doc.font('Helvetica').fontSize(7)
      .text('Owner: ' + ctx.ownerName, ML + 180, MT + 32, { lineBreak: false });

    // Header: show only Recommended Value (= Owner Opinion = locked anchor)
    // Max/Median Adjusted no longer rendered — Tyler directive 2026-04-27
    const _anchorVal = ctx.ownerOpinion;
    doc.font('Helvetica-Bold').fontSize(7.5)
      .text('Recommended Value: ' + fmt(_anchorVal), ML, MT + 44, { lineBreak: false });
    doc.font('Helvetica').fontSize(6.5)
      .text('Number of Comps: ' + N, ML, MT + 54, { width: contentW, lineBreak: false });

    doc.moveTo(ML, MT + 64).lineTo(ML + contentW, MT + 64).lineWidth(0.5).stroke('#aaa');

    // ── Footer ──────────────────────────────────────────────────────────────
    const footerDate = fmtDate(ctx.packageDate);
    doc.font('Helvetica').fontSize(6).fillColor('#888')
      .text(
        ctx.county + ' County   ' + footerDate +
        '   Page ' + (pg + 1) + ' of ' + gridPages +
        '   Confidential   © ' + new Date(ctx.packageDate).getFullYear() + ' OverAssessed, LLC',
        ML, FOOTER_Y, { width: contentW, align: 'center', lineBreak: false }
      );
    doc.fillColor('#000');

    // ── Column headers ───────────────────────────────────────────────────────
    let y = MT + HEADER_H;
    doc.rect(ML, y, contentW, ROW_H).fill('#2c3e50');
    doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(FSZ_HDR);
    const o = { lineBreak: false, ellipsis: true };
    doc.text('(CAD ' + ctx.taxYear + ')', ML + 2, y + 3, { ...o, width: LABEL_W - 4 });
    doc.text('SUBJECT', ML + LABEL_W, y + 3, { ...o, width: COL_W - 2 });
    for (let c = 0; c < pgComps.length; c++) {
      const globalIdx = pgOffset + c;
      const label = (globalIdx === medianIdx) ? 'MEDIAN COMP' : 'COMP ' + comps[globalIdx].seqNum;
      doc.text(label, ML + LABEL_W + COL_W * (c + 1), y + 3, { ...o, width: COL_W - 2 });
    }
    doc.fillColor('#000');
    y += ROW_H;

    // ── Helper: cell renderers ───────────────────────────────────────────────
    function cell(text, x, yy, bold, highlight) {
      const font = bold ? 'Helvetica-Bold' : 'Helvetica';
      const color = highlight ? '#1a3a5c' : '#000';
      doc.font(font).fontSize(FSZ).fillColor(color)
        .text(String(text || ''), x + 2, yy + 3, { width: COL_W - 4, lineBreak: false, ellipsis: true });
      doc.fillColor('#000');
    }
    function labelCell(text, x, yy) {
      doc.font('Helvetica-Bold').fontSize(FSZ).fillColor('#000')
        .text(String(text || ''), x + 2, yy + 3, { width: LABEL_W - 4, lineBreak: false, ellipsis: true });
    }
    function rowBg(yy, r, highlight) {
      if (highlight) {
        doc.rect(ML, yy, contentW, ROW_H).fill('#d4efdf');
      } else if (r % 2 === 0) {
        doc.rect(ML, yy, contentW, ROW_H).fill('#f4f6f7');
      }
      doc.save().strokeColor('#ccc').lineWidth(0.3);
      for (let i = 0; i <= COMPS_PP; i++) {
        const lx = ML + LABEL_W + COL_W * i;
        doc.moveTo(lx, yy).lineTo(lx, yy + ROW_H).stroke();
      }
      doc.restore();
    }

    // ── Row data ─────────────────────────────────────────────────────────────
    const subPsf = subject.sqft ? Math.round(ctx.appraisedValue / subject.sqft) : 0;
    const rows = [
      { label: 'Tax ID',
        sub: ctx.accountNumber || '',
        vals: pgComps.map(c => c.taxId || '') },
      { label: 'Address',
        sub: ctx.propertyAddress.substring(0, 30),
        vals: pgComps.map(c => c.address.substring(0, 30)) },
      { label: 'Market Value',
        sub: fmt(ctx.appraisedValue),
        vals: pgComps.map(c => fmt(c.marketValue)) },
      { label: 'Distance (Miles)',
        sub: '-',
        vals: pgComps.map(c => c.distanceMiles != null ? c.distanceMiles.toFixed(2) : '-') },
      { label: 'Property Class',
        sub: subject.propertyClass || 'A1',
        vals: pgComps.map(c => c.propertyClass || 'A1') },
      { label: 'Condition',
        sub: subject.condition || 'Average',
        vals: pgComps.map(c => c.condition || 'Average') },
      { label: 'Year Built (Effective)',
        sub: (subject.yearBuilt || '') + (subject.effectiveYear ? ' (' + subject.effectiveYear + ')' : ''),
        vals: pgComps.map(c => (c.yearBuilt || '') + (c.effectiveYear ? ' (' + c.effectiveYear + ')' : '')) },
      { label: 'Main SQFT (PSF)',
        sub: (subject.sqft || 0).toLocaleString() + ' ($' + subPsf + ')',
        vals: pgComps.map(c => {
          const psf = c.sqft ? Math.round(c.marketValue / c.sqft) : 0;
          return (c.sqft || 0).toLocaleString() + ' ($' + psf + ')';
        }) },
      { label: 'Improvement Value',
        sub: fmt(subject.improvementValue || 0),
        vals: pgComps.map(c => fmt(c.improvementValue || 0)) },
      { label: 'Feature Value',
        sub: fmt(subject.featureValue || 0),
        vals: pgComps.map(c => fmt(c.featureValue || 0)) },
      { label: 'Pool Value',
        sub: fmt(subject.poolValue || 0),
        vals: pgComps.map(c => fmt(c.poolValue || 0)) },
      { label: 'Land Value',
        sub: fmt(subject.landValue || 0),
        vals: pgComps.map(c => fmt(c.landValue || 0)) },
      { spacer: true },
      { label: 'Age Adjustment',
        sub: '-',
        vals: pgAdjs.map(a => fmtAdj(a.ageAdj, a.agePct)), adj: true },
      { label: 'Size Adjustment',
        sub: '-',
        vals: pgAdjs.map(a => fmtAdj(a.sizeAdj, a.sizePct)), adj: true },
      { label: 'Land Adjustment',
        sub: '-',
        vals: pgAdjs.map(a => fmtAdj(a.landAdj, a.landPct)), adj: true },
      { label: 'Condition Adjustment',
        sub: '-',
        vals: pgAdjs.map(a => fmtAdj(a.condAdj || 0, a.condPct || 0)), adj: true },
      { label: 'Net Adjustment',
        sub: '-',
        vals: pgAdjs.map(a => fmtAdj(a.netAdj, a.netPct)), bold: true, adj: true },
      { label: 'Total Adjusted Value',
        sub: '-',
        vals: pgAdjs.map(a => fmt(a.adjustedValue)), bold: true, highlight: true },
    ];

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (row.spacer) { y += 4; continue; }
      rowBg(y, r, row.highlight);
      labelCell(row.label, ML, y);
      cell(row.sub, ML + LABEL_W, y, row.bold, row.highlight);
      for (let c = 0; c < pgComps.length; c++) {
        cell(row.vals[c] || '', ML + LABEL_W + COL_W * (c + 1), y, row.bold, row.highlight);
      }
      y += ROW_H;
    }

    // Bottom border
    doc.moveTo(ML, y).lineTo(ML + contentW, y).lineWidth(0.5).stroke('#aaa');
  }

  return { allAdj, adjValues, sorted, medianVal, minVal, maxVal, medianIdx };
}

// ── PAGE G+2: Evidence Summary & Protest Argument ────────────────────────────
function renderEvidencePage(doc, ctx, stats) {
  doc.addPage({ size: 'LETTER', margin: 50 });

  const { allAdj, medianVal, minVal, maxVal } = stats;
  const N = ctx.comps.length;

  // Title — exact per Spec v1.1
  doc.fontSize(12).font('Helvetica-Bold').text('Evidence Summary & Protest Argument', { align: 'center' });
  doc.fontSize(8).font('Helvetica').text('Equal & Uniform Analysis — Supporting Documentation', { align: 'center' });
  doc.moveDown(0.8);

  // $/SF comparison
  doc.fontSize(10).font('Helvetica-Bold').text('$/Sq Ft Comparison');
  doc.moveDown(0.3);
  const subPsf = ctx.subject.sqft ? Math.round(ctx.appraisedValue / ctx.subject.sqft) : 0;
  const compPsfs = ctx.comps.filter(c => c.sqft > 0).map(c => Math.round(c.marketValue / c.sqft));
  const sortedPsfs = [...compPsfs].sort((a,b) => a - b);
  const avgPsf = Math.round(compPsfs.reduce((s,v) => s+v, 0) / compPsfs.length);
  const medPsf = sortedPsfs[Math.floor(sortedPsfs.length / 2)];
  const psfDiff = subPsf - avgPsf;

  doc.fontSize(8).font('Helvetica');
  doc.text('Subject $/SF: $' + subPsf + ' (appraised $' + ctx.appraisedValue.toLocaleString() + ' / ' + (ctx.subject.sqft || 0) + ' SF)');
  doc.text('Comp Average $/SF: $' + avgPsf);
  doc.text('Subject is $' + Math.abs(psfDiff) + '/SF ' + (psfDiff >= 0 ? 'ABOVE' : 'BELOW') + ' comparable average');
  doc.moveDown(0.5);

  // Comp ranking — sorted ascending by adjusted value
  doc.fontSize(10).font('Helvetica-Bold').text('Comp Ranking (by Adjusted Value)');
  doc.moveDown(0.3);
  doc.fontSize(7).font('Helvetica');

  const ranked = ctx.comps
    .map((c, i) => ({ ...c, adj: allAdj[i] }))
    .sort((a, b) => a.adj.adjustedValue - b.adj.adjustedValue);

  for (let i = 0; i < ranked.length; i++) {
    const c = ranked[i];
    const psf = c.sqft ? Math.round(c.adj.adjustedValue / c.sqft) : 0;
    const note = [c.sqft + 'SF', 'built ' + c.yearBuilt, c.corridorNote].filter(Boolean).join(', ');
    doc.text(
      (i + 1) + '. [Comp #' + c.seqNum + '] ' + c.address +
      ' — Adj: ' + fmt(c.adj.adjustedValue) + ' ($' + psf + '/SF) — ' + note,
      { width: 500 }
    );
  }
  doc.moveDown(0.5);

  // Protest argument
  doc.fontSize(10).font('Helvetica-Bold').text('PROTEST ARGUMENT');
  doc.moveDown(0.3);
  doc.fontSize(8).font('Helvetica');

  // Anchor = ownerOpinion (locked recommended value set by live-case-loader — Tyler v2 hard rule)
  // No min/max/median exposed in narrative — Tyler directive 2026-04-27
  const anchorVal = ctx.ownerOpinion;
  const overPct = ctx.appraisedValue > 0
    ? ((ctx.appraisedValue - anchorVal) / anchorVal * 100).toFixed(1)
    : '0.0';

  // 1. OVERVALUATION (always first) — no Range/Median exposed per Tyler directive 2026-04-27
  doc.text(
    '1. OVERVALUATION: The subject is appraised at $' + ctx.appraisedValue.toLocaleString() +
    ', which is ' + overPct + '% above the recommended adjusted value of $' +
    anchorVal.toLocaleString() + ' supported by ' + N + ' comparable properties.',
    { width: 500 }
  );
  doc.moveDown(0.2);

  // Middle arguments (case-driven)
  const middle = ctx.protestArguments?.middle || [];
  for (let i = 0; i < middle.length; i++) {
    doc.text((i + 2) + '. ' + middle[i].label + ': ' + middle[i].text, { width: 500 });
    doc.moveDown(0.2);
  }

  // Last before REQUESTED RELIEF: UNEQUAL APPRAISAL
  const lastNum = 2 + middle.length;
  doc.text(
    lastNum + '. UNEQUAL APPRAISAL (\u00a7\u0034\u0031\u002e\u0034\u0031(a)(2)): After adjusting for size, age, condition, and land, comparable market evidence supports a recommended adjusted value of $' +
    anchorVal.toLocaleString() + ' across ' + N + ' subdivision comparables.',
    { width: 500 }
  );
  doc.moveDown(0.5);

  // REQUESTED RELIEF — separate block, locked to anchor
  doc.fontSize(10).font('Helvetica-Bold').text('REQUESTED RELIEF');
  doc.fontSize(8).font('Helvetica');
  doc.text(
    'Based on comparable adjusted values, our recommended market value is $' +
    anchorVal.toLocaleString() +
    '. The subject property is therefore overvalued and should be reduced accordingly.',
    { width: 500 }
  );

  // Footer — OverAssessed branding only
  doc.moveDown(1.2);
  doc.fontSize(7).fillColor('#666');
  doc.text(
    'Source: ' + ctx.county + ' CAD + OverAssessed Analysis' +
    '  |  ' + N + ' Comps' +
    '  |  Generated: ' + new Date(ctx.packageDate).toISOString().slice(0, 10) +
    '  |  OverAssessed, LLC',
    { align: 'center', width: 500 }
  );
  doc.fillColor('#000');
}

// ── PAGE G+3: Subject Property Location Map ───────────────────────────────────
async function renderSubjectMapPage(doc, ctx) {
  doc.addPage({ size: 'LETTER', margin: 0 });
  const ML = 30, contentW = 612 - 60;

  doc.rect(ML, 28, contentW, 16).fill('#1a3a5c');
  doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(9)
    .text('Subject Property Location', ML, 31, { width: contentW, align: 'center', lineBreak: false });
  doc.fillColor('#000');

  doc.font('Helvetica-Bold').fontSize(8).text(ctx.propertyAddress.toUpperCase(), ML, 52, { lineBreak: false });
  doc.font('Helvetica').fontSize(7)
    .text(
      ctx.county + ' County  |  Tax ID: ' + (ctx.accountNumber || 'N/A') +
      '  |  Assessed: $' + ctx.appraisedValue.toLocaleString(),
      ML, 63, { lineBreak: false }
    );

  let mapBuf = null;
  const geo = await geocode(ctx.propertyAddress);
  if (!geo) {
    throw buildFailure({
      caseId: ctx.caseId, mode: ctx.__SAMPLE__ ? 'SAMPLE' : 'LIVE',
      stage: 'render', command: `geocode("${ctx.propertyAddress}")`,
      file: 'NONE', mutated: false,
      message: `BLOCKED — geocode failed for "${ctx.propertyAddress}"`,
      nextStep: 'Check Nominatim connectivity or verify the subject address is geocodable.',
    });
  }
  mapBuf = await generateMapImage(geo.lat, geo.lon, 15, 3, 3, [
    { lat: geo.lat, lon: geo.lon, color: [220, 30, 30] }
  ]);

  if (mapBuf) {
    doc.image(mapBuf, ML, 76, { width: contentW, height: 580, fit: [contentW, 580] });
  } else {
    doc.rect(ML, 76, contentW, 580).fill('#f0f0f0');
    doc.fillColor('#888').fontSize(10)
      .text('Map unavailable — ' + ctx.propertyAddress, ML, 340, { width: contentW, align: 'center' });
  }
  doc.fillColor('#888').font('Helvetica').fontSize(6)
    .text('Map data \u00a9 OpenStreetMap contributors', ML, 665, { width: contentW, align: 'right', lineBreak: false });
  doc.fillColor('#000');
}

// ── PAGE G+4: Subject & Comparable Properties Map ─────────────────────────────
async function renderCompsMapPage(doc, ctx) {
  doc.addPage({ size: 'LETTER', margin: 0 });
  const ML = 30, contentW = 612 - 60;

  doc.rect(ML, 28, contentW, 16).fill('#1a3a5c');
  doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(9)
    .text('Subject & Comparable Properties Map', ML, 31, { width: contentW, align: 'center', lineBreak: false });
  doc.fillColor('#000');

  doc.font('Helvetica-Bold').fontSize(8).text(ctx.propertyAddress.toUpperCase(), ML, 52, { lineBreak: false });
  doc.font('Helvetica').fontSize(7)
    .text(ctx.comps.length + ' comparable properties shown  |  ' + ctx.county + ' County', ML, 63, { lineBreak: false });

  let mapBuf = null;
  const subGeo = await geocode(ctx.propertyAddress);
  if (!subGeo) {
    throw buildFailure({
      caseId: ctx.caseId, mode: ctx.__SAMPLE__ ? 'SAMPLE' : 'LIVE',
      stage: 'render', command: `geocode("${ctx.propertyAddress}") for comps map`,
      file: 'NONE', mutated: false,
      message: `BLOCKED — geocode failed for subject "${ctx.propertyAddress}" on comps map`,
      nextStep: 'Check Nominatim connectivity.',
    });
  }

  const markers = [{ lat: subGeo.lat, lon: subGeo.lon, color: [220, 30, 30], label: 'S' }];
  for (let i = 0; i < ctx.comps.length; i++) {
    await new Promise(r => setTimeout(r, 400)); // Nominatim rate limit
    const g = await geocode(ctx.comps[i].address);
    if (g) markers.push({ lat: g.lat, lon: g.lon, color: [30, 80, 180], label: String(i + 1) });
  }

  const lats = markers.map(m => m.lat);
  const lons = markers.map(m => m.lon);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons));
  const zoom = span < 0.01 ? 15 : span < 0.05 ? 13 : span < 0.15 ? 12 : span < 0.5 ? 11 : 10;

  mapBuf = await generateMapImage(centerLat, centerLon, zoom, 4, 4, markers);

  if (mapBuf) {
    doc.image(mapBuf, ML, 76, { width: contentW, height: 530, fit: [contentW, 530] });
  } else {
    doc.rect(ML, 76, contentW, 530).fill('#f0f0f0');
    doc.fillColor('#888').fontSize(10).text('Map unavailable', ML, 330, { width: contentW, align: 'center' });
  }

  const ly = 616;
  doc.rect(ML, ly, contentW, 50).fill('#f8f9fa');
  doc.rect(ML + 10, ly + 10, 12, 12).fill('#DC1E1E');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(7)
    .text('SUBJECT: ' + ctx.propertyAddress, ML + 26, ly + 12, { lineBreak: false });
  doc.rect(ML + 10, ly + 28, 12, 12).fill('#1E50B4');
  doc.font('Helvetica').fontSize(7)
    .text(ctx.comps.length + ' Comparable Properties', ML + 26, ly + 30, { lineBreak: false });
  doc.fillColor('#888').fontSize(6)
    .text('Map data \u00a9 OpenStreetMap contributors', ML, ly + 44, { width: contentW, align: 'right', lineBreak: false });
  doc.fillColor('#000');
}

module.exports = {
  renderForm50132,
  renderCompGridPages,
  renderEvidencePage,
  renderSubjectMapPage,
  renderCompsMapPage,
};
