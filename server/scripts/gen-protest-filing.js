const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');

function s(v) { return (v == null) ? '-' : String(v); }
function cur(v) { if (v == null) return '-'; const n = Number(v); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US'); }

// ===== RUPANI (Collin County) =====
const rupani = {
  name: 'Shabir Hasanali Rupani', caseNum: 'OA-0013',
  address: '708 SANTA LUCIA DR', fullAddress: '708 Santa Lucia Dr, Anna, TX 75409',
  county: 'Collin', taxId: 'R-13273-00J-0230-1', owner: 'RUPANI, SHABIR HASANALI',
  marketValue: 399042, cls: 'A1', cond: 'Good',
  yb: 2024, ey: 2024, sqft: 1781, lotSize: 5500,
  land: 125000, impr: 274042,
  pool: 0, garage: 0, fireplace: 0,
  comps: [
    { tid: 'R-13273-00J-0250-1', addr: '740 SANTA LUCIA DR', sp: 359000, dist: 0.05, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1777, land: 97500, impr: 213752, pool: 0, garage: 0, fp: 0 },
    { tid: 'R-13273-00K-0010-1', addr: '901 PORTINA DR', sp: 367500, dist: 0.16, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1817, land: 102375, impr: 214645, pool: 0, garage: 0, fp: 0 },
    { tid: 'R-13273-00K-0040-1', addr: '924 AMENDUNI LN', sp: 367900, dist: 0.20, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1777, land: 97500, impr: 214645, pool: 0, garage: 0, fp: 0 },
    { tid: 'R-13273-00J-0070-1', addr: '221 SANTA LUCIA DR', sp: 375000, dist: 0.17, cls: 'A1', cond: 'Good', yb: 2023, ey: 2023, sqft: 1799, land: 125000, impr: 285327, pool: 0, garage: 0, fp: 0 },
    { tid: 'R-13273-00L-0050-1', addr: '1309 RENATO DR', sp: 375000, dist: 0.24, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1799, land: 131250, impr: 292324, pool: 0, garage: 0, fp: 0 },
    { tid: 'R-13273-00F-0120-1', addr: '601 PEMBERTON DR', sp: 349995, dist: 0.25, cls: 'A1', cond: 'Good', yb: 2018, ey: 2018, sqft: 1842, land: 105000, impr: 273189, pool: 15000, garage: 5000, fp: 0 },
    { tid: 'R-13273-00H-0080-1', addr: '1988 HELMOKEN FALLS DR', sp: 310000, dist: 0.38, cls: 'A1', cond: 'Good', yb: 2005, ey: 2005, sqft: 1787, land: 85000, impr: 220906, pool: 0, garage: 5000, fp: 3000 },
    { tid: 'R-13273-00C-0030-1', addr: '132 BIRDBROOK DR', sp: 317000, dist: 0.45, cls: 'A1', cond: 'Good', yb: 2006, ey: 2006, sqft: 1782, land: 85000, impr: 225829, pool: 0, garage: 5000, fp: 3000 },
    { tid: 'R-13273-00E-0100-1', addr: '910 FULBOURNE DR', sp: 315000, dist: 0.53, cls: 'A1', cond: 'Good', yb: 2007, ey: 2007, sqft: 1760, land: 85000, impr: 230096, pool: 15000, garage: 5000, fp: 3000 },
    { tid: 'R-13273-00L-0040-1', addr: '1216 RENATO DR', sp: 420000, dist: 0.26, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1800, land: 131250, impr: 292324, pool: 0, garage: 0, fp: 0 },
  ]
};

// ===== NGUYEN (Fort Bend County) =====
const nguyen = {
  name: 'Khiem Nguyen', caseNum: 'OA-0010',
  address: '3315 MARLENE MEADOW WAY', fullAddress: '3315 Marlene Meadow Way, Richmond, TX 77406',
  county: 'Fort Bend', taxId: '5296-09-002-0200-901', owner: 'NGUYEN, KHIEM DUC',
  marketValue: 648786, cls: 'A1', cond: 'Good',
  yb: 2023, ey: 2023, sqft: 3718, lotSize: 8468,
  land: 63050, impr: 585736,
  pool: 0, garage: 8000, fireplace: 4000,
  comps: [
    { tid: '5296-09-002-0140-901', addr: '3202 MARLENE MEADOW WAY', sp: 739900, dist: 0.11, cls: 'A1', cond: 'Good', yb: 2023, ey: 2023, sqft: 3717, land: 110968, impr: 570463, pool: 0, garage: 8000, fp: 4000 },
    { tid: '5296-09-001-0080-901', addr: '3306 WILLOW FIN WAY', sp: 645000, dist: 0.17, cls: 'A1', cond: 'Good', yb: 2022, ey: 2022, sqft: 3741, land: 63050, impr: 544921, pool: 0, garage: 8000, fp: 4000 },
    { tid: '5296-09-002-0170-901', addr: '3215 MARLENE MEADOW WAY', sp: 630000, dist: 0.09, cls: 'A1', cond: 'Good', yb: 2023, ey: 2023, sqft: 3794, land: 66203, impr: 593430, pool: 0, garage: 8000, fp: 4000 },
    { tid: '5296-05-001-0120-901', addr: '2111 S PECAN TRAIL DR', sp: 574000, dist: 1.26, cls: 'A1', cond: 'Good', yb: 2002, ey: 2002, sqft: 3866, land: 109915, impr: 549739, pool: 25000, garage: 10000, fp: 4000 },
    { tid: '5296-08-003-0050-901', addr: '4119 PEMBROOKE WAY', sp: 774999, dist: 1.29, cls: 'A1', cond: 'Good', yb: 2003, ey: 2003, sqft: 3895, land: 343026, impr: 526086, pool: 0, garage: 8000, fp: 4000 },
    { tid: '5296-05-001-0080-901', addr: '2015 PECAN TRAIL DR', sp: 499000, dist: 1.35, cls: 'A1', cond: 'Good', yb: 1990, ey: 1990, sqft: 3968, land: 122200, impr: 424461, pool: 0, garage: 8000, fp: 4000 },
    { tid: '5296-04-002-0100-901', addr: '2218 LANDSCAPE WAY', sp: 500000, dist: 1.57, cls: 'A1', cond: 'Good', yb: 1989, ey: 1989, sqft: 3269, land: 97500, impr: 347182, pool: 0, garage: 6000, fp: 4000 },
    { tid: '5296-06-001-0030-901', addr: '3006 PECAN WAY CT', sp: 625000, dist: 1.05, cls: 'A1', cond: 'Good', yb: 1998, ey: 1998, sqft: 4723, land: 122200, impr: 507293, pool: 0, garage: 6000, fp: 4000 },
    { tid: '5296-10-001-0150-901', addr: '8327 VALBURN DR', sp: 464998, dist: 1.49, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 2989, land: 63050, impr: 401948, pool: 0, garage: 0, fp: 0 },
    { tid: '5296-05-002-0040-901', addr: '2106 SHADE CREST DR', sp: 549000, dist: 1.26, cls: 'A1', cond: 'Good', yb: 1994, ey: 1994, sqft: 4031, land: 115700, impr: 446945, pool: 25000, garage: 10000, fp: 4000 },
  ]
};

const ALL = [rupani, nguyen];

function calcAdj(subj, c) {
  const cpf = c.impr / c.sqft;
  const sizeAdj = Math.round(cpf * (subj.sqft - c.sqft) / 2);
  const ageDiff = subj.ey - c.ey;
  const ageAdj = Math.round(0.005 * ageDiff * c.sp);
  const landAdj = subj.land - c.land;
  const subjFeat = (subj.garage || 0) + (subj.fireplace || 0);
  const compFeat = (c.garage || 0) + (c.fp || 0);
  const featAdj = subjFeat - compFeat;
  const poolAdj = (subj.pool || 0) - (c.pool || 0);
  const netAdj = sizeAdj + ageAdj + landAdj + featAdj + poolAdj;
  return { cpf, sizeAdj, ageAdj, landAdj, featAdj, poolAdj, netAdj, totalAdj: c.sp + netAdj };
}

function adjS(val, base) {
  const p = base ? (val / base * 100).toFixed(2) : '0.00';
  return `${cur(val)} (${p}%)`;
}

function gen(client) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 30, bufferPages: true });
    const fn = `${client.caseNum}_${client.name.replace(/ /g, '_')}_Protest_Filing.pdf`;
    const fp = path.join('/tmp', fn);
    const ws = fs.createWriteStream(fp);
    doc.pipe(ws);

    const spf = client.impr / client.sqft;
    const subjFeat = (client.garage || 0) + (client.fireplace || 0);
    const cd = client.comps.map(c => ({ ...c, ...calcAdj(client, c) }));
    cd.sort((a, b) => a.totalAdj - b.totalAdj);
    const mi = Math.floor(cd.length / 2);
    const medV = cd[mi].totalAdj, minV = cd[0].totalAdj, maxV = cd[cd.length - 1].totalAdj;
    const prices = cd.map(c => c.totalAdj);
    const avgV = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

    const PW = 792, PH = 612, ML = 30;
    const CPP = 3, LW = 115, DW = Math.floor((PW - 60 - LW) / 4), RH = 13;

    // Subject baseline values for display
    const subjRow = {
      tid: client.taxId, addr: client.address, sp: client.marketValue,
      dist: '-', cls: client.cls, cond: client.cond,
      yb: client.yb, ey: client.ey, sqft: client.sqft,
      land: client.land, impr: client.impr, pool: client.pool,
      garage: client.garage, fp: client.fireplace, cpf: spf,
      // Subject is BASELINE — adjustments are 0
      sizeAdj: 0, ageAdj: 0, landAdj: 0, featAdj: 0, poolAdj: 0, netAdj: 0, totalAdj: client.marketValue
    };

    const rowDefs = [
      { l: 'Tax ID', sv: () => client.taxId, cv: c => c.tid },
      { l: 'Address', sv: () => client.address, cv: c => c.addr },
      { l: 'Market Value', sv: () => cur(client.marketValue), cv: c => cur(c.sp) },
      { l: 'Distance (Miles)', sv: () => '(Subject)', cv: c => c.dist.toFixed(2) },
      { l: 'Property Class', sv: () => client.cls, cv: c => c.cls },
      { l: 'Condition', sv: () => client.cond, cv: c => c.cond },
      { l: 'Year Built (Effective)', sv: () => `${client.yb} (${client.ey})`, cv: c => `${c.yb} (${c.ey})` },
      { l: 'Main SQFT (PSF)', sv: () => `${client.sqft.toLocaleString()} ($${spf.toFixed(2)})`, cv: c => `${c.sqft.toLocaleString()} ($${c.cpf.toFixed(2)})` },
      { l: 'Improvement Value', sv: () => cur(client.impr), cv: c => cur(c.impr) },
      { l: 'Feature Value*', sv: () => cur(subjFeat), cv: c => cur((c.garage||0)+(c.fp||0)) },
      { l: 'Pool Value', sv: () => cur(client.pool), cv: c => cur(c.pool) },
      { l: 'Land Value', sv: () => cur(client.land), cv: c => cur(c.land) },
      { l: '---' },
      { l: 'Age Adjustment', sv: () => '(Baseline)', cv: c => adjS(c.ageAdj, c.sp), adj: true },
      { l: 'Size Adjustment', sv: () => '(Baseline)', cv: c => adjS(c.sizeAdj, c.sp), adj: true },
      { l: 'Land Adjustment', sv: () => '(Baseline)', cv: c => adjS(c.landAdj, c.sp), adj: true },
      { l: 'Feature Adjustment*', sv: () => '(Baseline)', cv: c => adjS(c.featAdj, c.sp), adj: true },
      { l: 'Pool Adjustment', sv: () => '(Baseline)', cv: c => adjS(c.poolAdj, c.sp), adj: true },
      { l: 'Net Adjustment', sv: () => '(Baseline)', cv: c => adjS(c.netAdj, c.sp), adj: true, bold: true },
      { l: '---' },
      { l: 'Total Adjusted Value', sv: () => cur(client.marketValue), cv: c => cur(c.totalAdj), tot: true },
    ];

    function drawHeader(y) {
      doc.rect(ML, y, PW - 60, 18).fill('#2c3e50');
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff')
        .text('OverAssessed.ai — Property Tax Protest Evidence', ML + 8, y + 2, { width: 300, height: 8, lineBreak: false });
      doc.font('Helvetica').fontSize(5.5).fillColor('#ddd')
        .text(`${client.name}  |  ${client.county} County  |  Case ${client.caseNum}`, ML + 8, y + 10, { width: PW - 100, height: 8, lineBreak: false });
      y += 19;
      doc.rect(ML, y, PW - 60, 13).fill('#34495e');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff')
        .text('Equal & Uniform Analysis — Adjusted Comparable Sales', ML, y + 2, { width: PW - 60, align: 'center', height: 10, lineBreak: false });
      y += 14;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#1a1a2e')
        .text(client.address, ML + 5, y + 1, { width: 200, height: 10, lineBreak: false });
      doc.font('Helvetica').fontSize(6.5).fillColor('#555')
        .text(`Tax ID: ${client.taxId}   Owner: ${client.owner}`, ML + 210, y + 2, { width: PW - 250, height: 10, lineBreak: false });
      y += 12;
      doc.rect(ML, y, 145, 14).fill('#e8f5e9').lineWidth(0.5).stroke('#2e7d32');
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#2e7d32')
        .text(`Indicated Value ${cur(medV)}`, ML + 4, y + 2, { width: 140, height: 10, lineBreak: false });
      doc.rect(ML + 148, y, PW - 60 - 148, 14).fill('#f5f5f5').lineWidth(0.5).stroke('#999');
      doc.font('Helvetica').fontSize(5.5).fillColor('#333')
        .text(`Comps: ${cd.length}  |  Min Adj: ${cur(minV)}  |  Max Adj: ${cur(maxV)}  |  Median Adj: ${cur(medV)}  |  Avg Adj: ${cur(avgV)}`, ML + 153, y + 3, { width: PW - 230, height: 10, lineBreak: false });
      y += 15;
      // Adjustment statement
      doc.font('Helvetica-Oblique').fontSize(5).fillColor('#666')
        .text('All comparable sales have been adjusted to reflect the subject property\'s characteristics. Subject column represents the baseline.', ML + 5, y, { width: PW - 70, height: 8, lineBreak: false });
      y += 9;
      return y;
    }

    function drawCompPage(pcs) {
      let y = drawHeader(ML);

      // Column headers
      doc.rect(ML, y, LW, RH).fill('#dee2e6');
      doc.font('Helvetica-Bold').fontSize(5.5).fillColor('#333')
        .text('(CAD 2025)', ML + 2, y + 3, { width: LW - 4, height: RH - 4, lineBreak: false });
      let cx = ML + LW;
      doc.rect(cx, y, DW, RH).fill('#c8e6c9');
      doc.font('Helvetica-Bold').fontSize(5.5).fillColor('#1b5e20')
        .text('SUBJECT', cx + 2, y + 3, { width: DW - 4, height: RH - 4, align: 'center', lineBreak: false });
      cx += DW;
      for (let ci = 0; ci < 3; ci++) {
        const comp = pcs[ci];
        if (comp) {
          const gi = cd.indexOf(comp);
          const isMed = gi === mi;
          doc.rect(cx, y, DW, RH).fill(isMed ? '#fff3cd' : '#e2e3e5');
          doc.font('Helvetica-Bold').fontSize(5.5).fillColor('#333')
            .text(isMed ? 'MEDIAN COMP' : `COMP ${gi + 1}`, cx + 2, y + 3, { width: DW - 4, height: RH - 4, align: 'center', lineBreak: false });
        } else {
          doc.rect(cx, y, DW, RH).fill('#f0f0f0');
        }
        cx += DW;
      }
      y += RH;

      // Data rows
      rowDefs.forEach((r, ri) => {
        if (r.l === '---') { y += 2; return; }
        const bg = r.adj ? '#fafafa' : (ri % 2 === 0 ? '#fff' : '#f8f9fa');
        const fSize = r.tot ? 7 : 5.5;
        const fName = (r.bold || r.tot) ? 'Helvetica-Bold' : 'Helvetica';
        const tc = r.tot ? '#155724' : '#333';
        // Label
        doc.rect(ML, y, LW, RH).fill(bg);
        doc.lineWidth(0.2).moveTo(ML, y + RH).lineTo(ML + LW + DW * 4, y + RH).stroke('#e0e0e0');
        doc.font(fName).fontSize(fSize).fillColor('#333')
          .text(r.l, ML + 2, y + 2, { width: LW - 4, height: RH - 2, lineBreak: false });
        // Subject
        cx = ML + LW;
        doc.rect(cx, y, DW, RH).fill(r.adj ? '#e8f5e9' : bg);
        doc.font('Helvetica').fontSize(fSize).fillColor(r.adj ? '#2e7d32' : tc)
          .text(s(r.sv()), cx + 2, y + 2, { width: DW - 4, height: RH - 2, align: 'center', lineBreak: false });
        cx += DW;
        // Comps
        for (let ci = 0; ci < 3; ci++) {
          const comp = pcs[ci];
          doc.rect(cx, y, DW, RH).fill(bg);
          if (comp) {
            doc.font(fName).fontSize(fSize).fillColor(tc)
              .text(s(r.cv(comp)), cx + 2, y + 2, { width: DW - 4, height: RH - 2, align: 'center', lineBreak: false });
          }
          cx += DW;
        }
        y += RH;
      });
      doc.lineWidth(0.5).moveTo(ML, y).lineTo(ML + LW + DW * 4, y).stroke('#999');
      y += 4;
      // Feature footnote
      doc.font('Helvetica-Oblique').fontSize(4.5).fillColor('#888')
        .text('* Feature values derived from RentCast property data (garage, fireplace presence). Where CAD feature breakdown unavailable, values estimated from feature flags.', ML + 5, y, { width: PW - 70, height: 8, lineBreak: false });
      y += 6;
      doc.text(`All property data sourced from ${client.county} County Appraisal District records and RentCast API.`, ML + 5, y, { width: PW - 70, height: 8, lineBreak: false });
    }

    // Comp pages
    for (let i = 0; i < cd.length; i += CPP) {
      if (i > 0) doc.addPage({ layout: 'landscape' });
      drawCompPage(cd.slice(i, i + CPP));
    }

    // ========== ARGUMENT PAGE ==========
    doc.addPage({ layout: 'landscape' });
    let y = ML;
    doc.rect(ML, y, PW - 60, 18).fill('#2c3e50');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff')
      .text('OverAssessed.ai — Property Tax Protest Evidence', ML + 8, y + 5, { width: 300, height: 10, lineBreak: false });
    y += 20;
    doc.rect(ML, y, PW - 60, 15).fill('#34495e');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff')
      .text('PROTEST ARGUMENT — EQUAL & UNIFORM VALUATION', ML, y + 3, { width: PW - 60, align: 'center', height: 12, lineBreak: false });
    y += 20;

    const diff = client.marketValue - medV;
    const diffPct = (diff / client.marketValue * 100).toFixed(1);
    const LM = ML + 15;
    const TW = PW - 90;

    // Section 1: Statement of Over-Assessment
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
      .text('1. STATEMENT OF OVER-ASSESSMENT', LM, y, { width: TW, height: 12, lineBreak: false });
    y += 14;
    doc.font('Helvetica').fontSize(8).fillColor('#333');
    const s1 = `The subject property at ${client.fullAddress} (Account ${client.taxId}) is currently appraised by the ${client.county} County Appraisal District at ${cur(client.marketValue)} for tax year 2025. This appraisal exceeds the adjusted median value of ${cd.length} comparable properties (${cur(medV)}) by ${cur(diff)}, representing a ${diffPct}% over-assessment. The current appraisal is not equal and uniform as required under Texas Tax Code Section 42.26(a).`;
    doc.text(s1, LM, y, { width: TW, lineBreak: true });
    y = doc.y + 12;

    // Section 2: Evidence Summary
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
      .text('2. COMPARABLE SALES EVIDENCE', LM, y, { width: TW, height: 12, lineBreak: false });
    y += 14;
    doc.font('Helvetica').fontSize(8).fillColor('#333');
    const s2 = `${cd.length} comparable properties were identified within ${cd[cd.length-1].dist.toFixed(1)} miles of the subject property. All comparables share the same property classification (${client.cls}), condition rating (${client.cond}), and are located within ${client.county} County. Each comparable has been adjusted to reflect the subject property's characteristics using standard appraisal methodology for age, size, land value, features, and pool.`;
    doc.text(s2, LM, y, { width: TW, lineBreak: true });
    y = doc.y + 8;

    // Adjustment methodology
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#555')
      .text('Adjustment Methodology:', LM, y, { width: TW, lineBreak: false });
    y += 10;
    doc.font('Helvetica').fontSize(7).fillColor('#555');
    const methods = [
      'Age Adjustment: 0.5% per year of effective age difference, applied to comparable sale price',
      'Size Adjustment: Comparable improvement PSF \u00d7 (subject sqft - comp sqft) / 2',
      'Land Adjustment: Subject land value minus comparable land value (from CAD records)',
      'Feature Adjustment: Subject feature value minus comparable feature value (garage, fireplace)',
      'Pool Adjustment: Subject pool value minus comparable pool value',
    ];
    methods.forEach(m => {
      doc.text('  \u2022 ' + m, LM + 5, y, { width: TW - 10, lineBreak: false });
      y += 10;
    });
    y += 8;

    // Section 3: Adjusted Value Analysis
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
      .text('3. ADJUSTED VALUE ANALYSIS', LM, y, { width: TW, height: 12, lineBreak: false });
    y += 14;
    doc.font('Helvetica').fontSize(8).fillColor('#333');

    // Value summary box
    doc.rect(LM, y, TW, 55).fill('#f8f9fa').lineWidth(0.5).stroke('#dee2e6');
    y += 5;
    doc.font('Helvetica').fontSize(7.5).fillColor('#333');
    doc.text(`Minimum Adjusted Value:   ${cur(minV)}  (${cd[0].addr})`, LM + 10, y, { width: TW - 20, height: 10, lineBreak: false }); y += 11;
    doc.text(`Maximum Adjusted Value:   ${cur(maxV)}  (${cd[cd.length-1].addr})`, LM + 10, y, { width: TW - 20, height: 10, lineBreak: false }); y += 11;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#2e7d32');
    doc.text(`Median Adjusted Value:    ${cur(medV)}  (INDICATED VALUE)`, LM + 10, y, { width: TW - 20, height: 10, lineBreak: false }); y += 11;
    doc.font('Helvetica').fontSize(7.5).fillColor('#333');
    doc.text(`Average Adjusted Value:   ${cur(avgV)}`, LM + 10, y, { width: TW - 20, height: 10, lineBreak: false }); y += 15;

    doc.font('Helvetica').fontSize(7.5).fillColor('#555');
    doc.text('The median adjusted value is used as the indicated value because it is the standard statistical measure that minimizes the impact of outlier sales, providing the most representative estimate of market value for equal and uniform comparison.', LM, y, { width: TW, lineBreak: true });
    y = doc.y + 12;

    // Section 4: Requested Value
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
      .text('4. REQUESTED VALUE & RELIEF', LM, y, { width: TW, height: 12, lineBreak: false });
    y += 14;

    doc.rect(LM, y, TW, 45).fill('#e8f5e9').lineWidth(1).stroke('#2e7d32');
    y += 6;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1b5e20');
    doc.text(`Current CAD Appraised Value:     ${cur(client.marketValue)}`, LM + 15, y, { width: TW - 30, height: 12, lineBreak: false }); y += 14;
    doc.text(`Requested Value (Median Adj):    ${cur(medV)}`, LM + 15, y, { width: TW - 30, height: 12, lineBreak: false }); y += 14;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#cc0000');
    doc.text(`Proposed Reduction:              ${cur(diff)} (${diffPct}%)`, LM + 15, y, { width: TW - 30, height: 12, lineBreak: false }); y += 18;

    doc.font('Helvetica').fontSize(8).fillColor('#333');
    const s4 = `Based on the adjusted comparable sales analysis, the property owner respectfully requests that the ${client.county} County Appraisal Review Board reduce the appraised value of the subject property from ${cur(client.marketValue)} to ${cur(medV)}. The evidence demonstrates that the current appraisal exceeds the median adjusted value of comparable properties and is therefore not equal and uniform under Texas Tax Code Section 42.26(a).`;
    doc.text(s4, LM, y, { width: TW, lineBreak: true });
    y = doc.y + 10;

    // Legal basis
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#555')
      .text('Legal Basis:', LM, y, { width: TW, lineBreak: false });
    y += 9;
    doc.font('Helvetica-Oblique').fontSize(6.5).fillColor('#666');
    doc.text('Texas Tax Code \u00A742.26(a): "The district court shall grant relief on the ground that a property is appraised unequally if the appraised value of the property exceeds the median appraised value of a reasonable number of comparable properties appropriately adjusted."', LM + 5, y, { width: TW - 10, lineBreak: true });
    y = doc.y + 10;

    // Source traceability
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#555')
      .text('Data Sources & Traceability:', LM, y, { width: TW, lineBreak: false });
    y += 9;
    doc.font('Helvetica').fontSize(6.5).fillColor('#666');
    doc.text(`\u2022 ${client.county} County Appraisal District — 2025 certified property values, land/improvement breakdowns`, LM + 5, y, { width: TW - 10, lineBreak: false }); y += 9;
    doc.text('\u2022 RentCast API — Comparable property details, sale prices, feature data, lot sizes', LM + 5, y, { width: TW - 10, lineBreak: false }); y += 9;
    doc.text('\u2022 OverAssessed.ai — Adjustment calculations and analysis engine', LM + 5, y, { width: TW - 10, lineBreak: false }); y += 9;
    doc.text('\u2022 Feature values (garage, fireplace, pool) derived from property feature flags where CAD breakdown unavailable; marked with asterisk (*)', LM + 5, y, { width: TW - 10, lineBreak: false });

    // Buffered footers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(5.5).fillColor('#999');
      doc.text(
        `Account: ${client.taxId}    ${client.county} County            ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}    Page ${i + 1} of ${range.count}            Confidential    Generated by OverAssessed.ai`,
        ML, PH - 18, { width: PW - 60, align: 'center', height: 10, lineBreak: false }
      );
    }

    doc.end();
    ws.on('finish', () => { console.log('OK: ' + fp); resolve(fp); });
    ws.on('error', reject);
  });
}

async function main() {
  console.log('=== FILING-GRADE PROTEST PACKAGES ===');
  for (const c of ALL) {
    try { await gen(c); } catch (e) { console.error('FAIL:', c.caseNum, e.message, e.stack); }
  }
  console.log('=== DONE ===');
}
main();
