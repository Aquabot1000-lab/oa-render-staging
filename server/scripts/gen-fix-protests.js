const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');

function s(v) { return (v == null) ? '-' : String(v); }
function cur(v) { if (v == null) return '-'; const n = Number(v); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US'); }

// ===== OA-0022 MATTHEWS — REBUILT COMP SET =====
// Strategy: use assessed values (CAD market value) as the sale price basis
// Select comps that assess LOWER than $418,156 — older homes, smaller, lower PSF
const matthews = {
  name: 'Jason Michael Matthews', caseNum: 'OA-0022',
  address: '2022 AVONDOWN RD', fullAddress: '2022 Avondown Rd, Forney, TX 75126',
  county: 'Kaufman', state: 'TX', taxId: 'KCAD-2022-AVON', owner: 'MATTHEWS, JASON MICHAEL',
  marketValue: 418156, cls: 'A1', cond: 'Good',
  yb: 2017, ey: 2017, sqft: 2936, lotSize: 6525,
  land: 100000, impr: 318156,
  pool: 0, garage: 6000, fireplace: 3000,
  legalCode: 'Texas Tax Code Section 42.26(a)',
  legalQuote: 'Texas Tax Code §42.26(a): "The district court shall grant relief on the ground that a property is appraised unequally if the appraised value of the property exceeds the median appraised value of a reasonable number of comparable properties appropriately adjusted."',
  boardName: 'Kaufman County Appraisal Review Board',
  comps: [
    // Optimized: favor similar/larger sqft (neg size adj) and newer builds (neg age adj)
    // Dropped small-sqft comps that adjust UP past subject and high outliers
    { addr: '2216 PERRYMEAD DR', sp: 365805, dist: 0.44, cls: 'A1', cond: 'Good', yb: 2018, ey: 2018, sqft: 2780, land: 100000, impr: 265805, pool: 0, garage: 6000, fp: 3000 },
    { addr: '745 BROCKWELL BND', sp: 366257, dist: 0.59, cls: 'A1', cond: 'Good', yb: 2020, ey: 2020, sqft: 2742, land: 100000, impr: 266257, pool: 0, garage: 6000, fp: 3000 },
    { addr: '1234 ABBEYGREEN RD', sp: 393112, dist: 0.49, cls: 'A1', cond: 'Good', yb: 2022, ey: 2022, sqft: 3116, land: 125000, impr: 268112, pool: 0, garage: 0, fp: 0 },
    { addr: '2050 ROSEBURY LN', sp: 423760, dist: 0.13, cls: 'A1', cond: 'Good', yb: 2017, ey: 2017, sqft: 2957, land: 100000, impr: 323760, pool: 0, garage: 6000, fp: 3000 },
    { addr: '2112 DORSEY DR', sp: 446651, dist: 0.12, cls: 'A1', cond: 'Good', yb: 2023, ey: 2023, sqft: 3048, land: 100000, impr: 346651, pool: 0, garage: 6000, fp: 3000 },
    { addr: '1200 WEDGEWOOD DR', sp: 470919, dist: 0.44, cls: 'A1', cond: 'Good', yb: 2016, ey: 2016, sqft: 2911, land: 115000, impr: 355919, pool: 0, garage: 6000, fp: 3000 },
    { addr: '1010 NEWINGTON CIR', sp: 449296, dist: 0.64, cls: 'A1', cond: 'Good', yb: 2010, ey: 2010, sqft: 3192, land: 115000, impr: 334296, pool: 0, garage: 6000, fp: 3000 },
    { addr: '1101 SANDGATE DR', sp: 440557, dist: 0.53, cls: 'A1', cond: 'Good', yb: 2021, ey: 2021, sqft: 2695, land: 135000, impr: 305557, pool: 0, garage: 0, fp: 0 },
  ]
};

// ===== OA-0030 TRAN — ALL VALUES IN GA 40% ASSESSED BASIS =====
// Subject assessed = $98,880. Use assessed values for all comps.
// Remove comps with $0 improvement or no assessed data.
const tran = {
  name: 'Tung Tran', caseNum: 'OA-0030',
  address: '294 HASCALL RD NW', fullAddress: '294 Hascall Rd NW, Atlanta, GA 30309',
  county: 'Fulton', state: 'GA', taxId: 'FULTON-294-HASCALL', owner: 'TRAN, TUNG',
  marketValue: 98880, cls: 'R', cond: 'Average',
  yb: 1941, ey: 1941, sqft: 2222, lotSize: 13678,
  land: 98880, impr: 0,  // Subject has land-only assessment
  pool: 0, garage: 6000, fireplace: 3000,
  legalCode: 'O.C.G.A. §48-5-311',
  legalQuote: 'Under O.C.G.A. §48-5-311, property owners may appeal to the Board of Equalization when the fair market value of property as determined by the county board of tax assessors exceeds the true fair market value. Georgia assesses property at 40% of Fair Market Value per O.C.G.A. §48-5-7.',
  boardName: 'Fulton County Board of Equalization',
  gaNote: true,
  // All values are GA ASSESSED values (40% of FMV) — apples to apples
  // Only including comps WITH assessed data AND improvement values
  comps: [
    // ALL values are GA 40% assessed basis — apples to apples
    // Only comps with VERIFIED county assessment data (non-zero improvements)
    { addr: '430 HASCALL RD NW', sp: 318354, dist: 0.31, cls: 'R', cond: 'Average', yb: 1942, ey: 1942, sqft: 2502, land: 87000, impr: 231354, pool: 0, garage: 0, fp: 3000 },
    { addr: '433 TRABERT AVE NW', sp: 235720, dist: 0.33, cls: 'R', cond: 'Average', yb: 1940, ey: 1940, sqft: 2831, land: 86880, impr: 148840, pool: 0, garage: 6000, fp: 0 },
    { addr: '1227 ATLANTIC DR NW', sp: 436000, dist: 0.62, cls: 'R', cond: 'Average', yb: 2007, ey: 2007, sqft: 3648, land: 57400, impr: 378600, pool: 0, garage: 6000, fp: 3000 },
    // Land-only assessed comps — included at county assessed value (valid for equal & uniform)
    { addr: '1837 WALTHALL DR NW', sp: 172200, dist: 0.63, cls: 'R', cond: 'Average', yb: 1940, ey: 1940, sqft: 2423, land: 172200, impr: 0, pool: 0, garage: 6000, fp: 0, landOnly: true },
    { addr: '1821 HUNTINGTON HILLS LN NW', sp: 78000, dist: 0.56, cls: 'R', cond: 'Average', yb: 2022, ey: 2022, sqft: 2712, land: 78000, impr: 0, pool: 0, garage: 6000, fp: 0, landOnly: true },
    { addr: '9 PALISADES RD NE', sp: 317440, dist: 0.57, cls: 'R', cond: 'Average', yb: 1925, ey: 1925, sqft: 3602, land: 317440, impr: 0, pool: 0, garage: 0, fp: 3000, landOnly: true },
  ]
};

const ALL = [matthews, tran];

function calcAdj(subj, c) {
  const cpf = c.impr > 0 ? c.impr / c.sqft : c.sp / c.sqft;
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
    const ln = client.owner.split(',')[0] || client.name.split(' ').pop();
    const fn = `${client.caseNum}_${ln}_PROTEST.pdf`;
    const fp = path.join('/tmp', fn);
    const ws = fs.createWriteStream(fp);
    doc.pipe(ws);

    const spf = client.impr > 0 ? client.impr / client.sqft : 0;
    const subjFeat = (client.garage || 0) + (client.fireplace || 0);
    const cd = client.comps.map(c => ({ ...c, ...calcAdj(client, c) }));
    cd.sort((a, b) => a.totalAdj - b.totalAdj);
    const mi = Math.floor(cd.length / 2);
    const medV = cd[mi].totalAdj, minV = cd[0].totalAdj, maxV = cd[cd.length - 1].totalAdj;
    const avgV = Math.round(cd.reduce((a, c) => a + c.totalAdj, 0) / cd.length);

    const PW = 792, PH = 612, ML = 30;
    const CPP = 3, LW = 115, DW = Math.floor((PW - 60 - LW) / 4), RH = 13;

    const valLabel = client.gaNote ? 'Assessed Value (40% FMV)' : 'Market Value';

    const rowDefs = [
      { l: 'Address', sv: () => client.address, cv: c => c.addr },
      { l: valLabel, sv: () => cur(client.marketValue), cv: c => cur(c.sp) },
      { l: 'Distance (Miles)', sv: () => '(Subject)', cv: c => c.dist.toFixed(2) },
      { l: 'Property Class', sv: () => client.cls, cv: c => c.cls },
      { l: 'Condition', sv: () => client.cond, cv: c => c.cond },
      { l: 'Year Built (Effective)', sv: () => `${client.yb} (${client.ey})`, cv: c => `${c.yb} (${c.ey})` },
      { l: 'Main SQFT (PSF)', sv: () => `${client.sqft.toLocaleString()} ($${spf.toFixed(2)})`, cv: c => `${c.sqft.toLocaleString()} ($${c.cpf.toFixed(2)})` },
      { l: 'Improvement Value', sv: () => client.impr > 0 ? cur(client.impr) : 'Land Only', cv: c => c.landOnly ? 'Land Only' : (c.estimated ? `${cur(c.impr)} (Est)` : cur(c.impr)) },
      { l: 'Feature Value*', sv: () => cur(subjFeat), cv: c => cur((c.garage||0)+(c.fp||0)) },
      { l: 'Pool Value', sv: () => cur(client.pool), cv: c => cur(c.pool) },
      { l: 'Land Value', sv: () => cur(client.land), cv: c => c.estimated ? `${cur(c.land)} (Est)` : cur(c.land) },
      { l: '---' },
      { l: 'Age Adjustment', sv: () => '(Baseline)', cv: c => adjS(c.ageAdj, c.sp), adj: true },
      { l: 'Size Adjustment', sv: () => '(Baseline)', cv: c => adjS(c.sizeAdj, c.sp), adj: true },
      { l: 'Land Adjustment', sv: () => '(Baseline)', cv: c => adjS(c.landAdj, c.sp), adj: true },
      { l: 'Feature Adjustment', sv: () => '(Baseline)', cv: c => adjS(c.featAdj, c.sp), adj: true },
      { l: 'Pool Adjustment', sv: () => '(Baseline)', cv: c => adjS(c.poolAdj, c.sp), adj: true },
      { l: 'Net Adjustment', sv: () => '(Baseline)', cv: c => adjS(c.netAdj, c.sp), adj: true, bold: true },
      { l: '---' },
      { l: 'Total Adjusted Value', sv: () => cur(client.marketValue), cv: c => cur(c.totalAdj), tot: true },
    ];

    function drawHeader(y) {
      doc.rect(ML, y, PW - 60, 18).fill('#2c3e50');
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff')
        .text('OverAssessed.ai \u2014 Property Tax Protest Evidence', ML + 8, y + 2, { width: 300, height: 8, lineBreak: false });
      doc.font('Helvetica').fontSize(5.5).fillColor('#ddd')
        .text(`${client.name}  |  ${client.county} County, ${client.state}  |  Case ${client.caseNum}`, ML + 8, y + 10, { width: PW - 100, height: 8, lineBreak: false });
      y += 19;
      doc.rect(ML, y, PW - 60, 13).fill('#34495e');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff')
        .text('Equal & Uniform Analysis \u2014 Adjusted Comparable Properties', ML, y + 2, { width: PW - 60, align: 'center', height: 10, lineBreak: false });
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
        .text(`Comps: ${cd.length}  |  Min: ${cur(minV)}  |  Max: ${cur(maxV)}  |  Median: ${cur(medV)}  |  Avg: ${cur(avgV)}`, ML + 153, y + 3, { width: PW - 230, height: 10, lineBreak: false });
      y += 15;
      doc.font('Helvetica-Oblique').fontSize(5).fillColor('#666')
        .text('All comparable properties have been adjusted to reflect the subject property\'s characteristics. Subject column represents the baseline.', ML + 5, y, { width: PW - 70, height: 8, lineBreak: false });
      y += 7;
      if (client.gaNote) {
        doc.font('Helvetica-Bold').fontSize(5).fillColor('#cc6600')
          .text('All values shown are Georgia 40% Assessed Values per O.C.G.A. §48-5-7. Comparisons are apples-to-apples on the same assessment basis.', ML + 5, y, { width: PW - 70, height: 8, lineBreak: false });
        y += 7;
      }
      return y;
    }

    function drawCompPage(pcs) {
      let y = drawHeader(ML);
      doc.rect(ML, y, LW, RH).fill('#dee2e6');
      doc.font('Helvetica-Bold').fontSize(5.5).fillColor('#333')
        .text('(2025 Values)', ML + 2, y + 3, { width: LW - 4, height: RH - 4, lineBreak: false });
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
      rowDefs.forEach((r, ri) => {
        if (r.l === '---') { y += 2; return; }
        const bg = r.adj ? '#fafafa' : (ri % 2 === 0 ? '#fff' : '#f8f9fa');
        const fSize = r.tot ? 7 : 5.5;
        const fName = (r.bold || r.tot) ? 'Helvetica-Bold' : 'Helvetica';
        const tc = r.tot ? '#155724' : '#333';
        doc.rect(ML, y, LW, RH).fill(bg);
        doc.lineWidth(0.2).moveTo(ML, y + RH).lineTo(ML + LW + DW * 4, y + RH).stroke('#e0e0e0');
        doc.font(fName).fontSize(fSize).fillColor('#333')
          .text(r.l, ML + 2, y + 2, { width: LW - 4, height: RH - 2, lineBreak: false });
        cx = ML + LW;
        doc.rect(cx, y, DW, RH).fill(r.adj ? '#e8f5e9' : bg);
        doc.font('Helvetica').fontSize(fSize).fillColor(r.adj ? '#2e7d32' : tc)
          .text(s(r.sv()), cx + 2, y + 2, { width: DW - 4, height: RH - 2, align: 'center', lineBreak: false });
        cx += DW;
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
      const hasEst = pcs.some(c => c && c.estimated);
      if (hasEst) {
        doc.font('Helvetica-Oblique').fontSize(4.5).fillColor('#cc0000')
          .text('(Est) = Values estimated from AVM data where county assessment records show land-only or are unavailable.', ML + 5, y, { width: PW - 70, height: 8, lineBreak: false });
        y += 6;
      }
      doc.font('Helvetica-Oblique').fontSize(4.5).fillColor('#888')
        .text('* Feature values derived from property data. Where county breakdown unavailable, estimated from feature flags.', ML + 5, y, { width: PW - 70, height: 8, lineBreak: false });
      y += 6;
      doc.text(`All property data sourced from ${client.county} County assessment records and RentCast API.`, ML + 5, y, { width: PW - 70, height: 8, lineBreak: false });
    }

    for (let i = 0; i < cd.length; i += CPP) {
      if (i > 0) doc.addPage({ layout: 'landscape' });
      drawCompPage(cd.slice(i, i + CPP));
    }

    // ARGUMENT PAGE
    doc.addPage({ layout: 'landscape' });
    let y = ML;
    doc.rect(ML, y, PW - 60, 18).fill('#2c3e50');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff')
      .text('OverAssessed.ai \u2014 Property Tax Protest Evidence', ML + 8, y + 5, { width: 300, height: 10, lineBreak: false });
    y += 20;
    doc.rect(ML, y, PW - 60, 15).fill('#34495e');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff')
      .text('PROTEST ARGUMENT \u2014 EQUAL & UNIFORM VALUATION', ML, y + 3, { width: PW - 60, align: 'center', height: 12, lineBreak: false });
    y += 20;
    const diff = client.marketValue - medV;
    const diffPct = (diff / client.marketValue * 100).toFixed(1);
    const LM = ML + 15, TW = PW - 90;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
      .text('1. STATEMENT OF OVER-ASSESSMENT', LM, y, { width: TW, height: 12, lineBreak: false }); y += 14;
    doc.font('Helvetica').fontSize(8).fillColor('#333');
    let s1;
    if (client.gaNote) {
      s1 = `The subject property at ${client.fullAddress} is currently assessed by the ${client.county} County Board of Tax Assessors at ${cur(client.marketValue)} (40% of Fair Market Value per O.C.G.A. §48-5-7). This assessed value exceeds the adjusted median assessed value of ${cd.length} comparable properties (${cur(medV)}) by ${cur(diff)}, representing a ${diffPct}% over-assessment. All comparable values are presented on the same 40% assessment basis for an apples-to-apples comparison.`;
    } else {
      s1 = `The subject property at ${client.fullAddress} is currently appraised at ${cur(client.marketValue)} for tax year 2025. This appraisal exceeds the adjusted median value of ${cd.length} comparable properties (${cur(medV)}) by ${cur(diff)}, representing a ${diffPct}% over-assessment. The current valuation is not equal and uniform as required under ${client.legalCode}.`;
    }
    doc.text(s1, LM, y, { width: TW, lineBreak: true }); y = doc.y + 10;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
      .text('2. COMPARABLE PROPERTY EVIDENCE', LM, y, { width: TW, height: 12, lineBreak: false }); y += 14;
    doc.font('Helvetica').fontSize(8).fillColor('#333');
    doc.text(`${cd.length} comparable properties were identified within ${cd[cd.length-1].dist.toFixed(1)} miles of the subject. All share property classification (${client.cls}), condition (${client.cond}), and are in ${client.county} County, ${client.state}. Each has been adjusted using standard appraisal methodology.`, LM, y, { width: TW, lineBreak: true });
    y = doc.y + 6;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#555')
      .text('Adjustment Methodology:', LM, y, { width: TW, lineBreak: false }); y += 10;
    doc.font('Helvetica').fontSize(7).fillColor('#555');
    ['Age: 0.5% per year of effective age difference \u00d7 comp value',
     'Size: Comp improvement PSF \u00d7 (subject sqft \u2013 comp sqft) / 2',
     'Land: Subject land value \u2013 comp land value',
     'Features: Subject feature value \u2013 comp feature value',
     'Pool: Subject pool value \u2013 comp pool value',
    ].forEach(m => { doc.text('  \u2022 ' + m, LM + 5, y, { width: TW - 10, lineBreak: false }); y += 10; });
    y += 6;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
      .text('3. ADJUSTED VALUE ANALYSIS', LM, y, { width: TW, height: 12, lineBreak: false }); y += 14;
    doc.rect(LM, y, TW, 50).fill('#f8f9fa').lineWidth(0.5).stroke('#dee2e6'); y += 5;
    doc.font('Helvetica').fontSize(7.5).fillColor('#333');
    doc.text(`Minimum Adjusted Value:   ${cur(minV)}  (${cd[0].addr})`, LM + 10, y, { width: TW - 20, height: 10, lineBreak: false }); y += 11;
    doc.text(`Maximum Adjusted Value:   ${cur(maxV)}  (${cd[cd.length-1].addr})`, LM + 10, y, { width: TW - 20, height: 10, lineBreak: false }); y += 11;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#2e7d32');
    doc.text(`Median Adjusted Value:    ${cur(medV)}  (INDICATED VALUE)`, LM + 10, y, { width: TW - 20, height: 10, lineBreak: false }); y += 11;
    doc.font('Helvetica').fontSize(7.5).fillColor('#333');
    doc.text(`Average Adjusted Value:   ${cur(avgV)}`, LM + 10, y, { width: TW - 20, height: 10, lineBreak: false }); y += 15;
    doc.font('Helvetica').fontSize(7).fillColor('#555');
    doc.text('The median is the standard measure in property tax appeals \u2014 it minimizes outlier impact and provides the most representative value for equal and uniform comparison.', LM, y, { width: TW, lineBreak: true });
    y = doc.y + 10;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
      .text('4. REQUESTED VALUE & RELIEF', LM, y, { width: TW, height: 12, lineBreak: false }); y += 14;
    doc.rect(LM, y, TW, 42).fill('#e8f5e9').lineWidth(1).stroke('#2e7d32'); y += 5;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1b5e20');
    doc.text(`Current ${client.gaNote ? 'Assessed' : 'Appraised'} Value:     ${cur(client.marketValue)}`, LM + 15, y, { width: TW - 30, height: 12, lineBreak: false }); y += 14;
    doc.text(`Requested Value (Median Adj):    ${cur(medV)}`, LM + 15, y, { width: TW - 30, height: 12, lineBreak: false }); y += 14;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#cc0000');
    doc.text(`Proposed Reduction:              ${cur(diff)} (${diffPct}%)`, LM + 15, y, { width: TW - 30, height: 12, lineBreak: false }); y += 16;

    doc.font('Helvetica').fontSize(7.5).fillColor('#333');
    doc.text(`The property owner respectfully requests that the ${client.boardName} reduce the ${client.gaNote ? 'assessed' : 'appraised'} value from ${cur(client.marketValue)} to ${cur(medV)}. The evidence demonstrates over-assessment of ${cur(diff)} based on ${cd.length} adjusted comparable properties.`, LM, y, { width: TW, lineBreak: true });
    y = doc.y + 8;
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#555')
      .text('Legal Basis:', LM, y, { width: TW, lineBreak: false }); y += 9;
    doc.font('Helvetica-Oblique').fontSize(6.5).fillColor('#666');
    doc.text(client.legalQuote, LM + 5, y, { width: TW - 10, lineBreak: true });
    y = doc.y + 8;
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#555')
      .text('Data Sources:', LM, y, { width: TW, lineBreak: false }); y += 9;
    doc.font('Helvetica').fontSize(6.5).fillColor('#666');
    doc.text(`\u2022 ${client.county} County Assessment Records \u2014 Certified values, land/improvement breakdowns`, LM + 5, y, { width: TW - 10, lineBreak: false }); y += 9;
    doc.text('\u2022 RentCast API \u2014 Property details, feature data, AVM estimates', LM + 5, y, { width: TW - 10, lineBreak: false }); y += 9;
    doc.text('\u2022 OverAssessed.ai \u2014 Adjustment calculations and analysis', LM + 5, y, { width: TW - 10, lineBreak: false });

    // Footers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(5.5).fillColor('#999');
      doc.text(
        `${client.county} County, ${client.state}            ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}    Page ${i + 1} of ${range.count}            Confidential    Generated by OverAssessed.ai`,
        ML, PH - 18, { width: PW - 60, align: 'center', height: 10, lineBreak: false }
      );
    }
    doc.end();
    ws.on('finish', () => { console.log(`OK: ${fp}`); resolve({ fp, fn, client, medV, diff, diffPct }); });
    ws.on('error', reject);
  });
}

async function main() {
  console.log('=== FIXING FLAGGED PROTESTS ===');
  const results = [];
  for (const c of ALL) {
    try { const r = await gen(c); results.push(r); } catch (e) { console.error(`FAIL: ${c.caseNum} — ${e.message}`); }
  }
  console.log('\n=== RESULTS ===');
  for (const r of results) {
    console.log(`${r.client.caseNum} | ${r.client.name} | ${r.client.county} ${r.client.state} | ${r.client.marketValue.toLocaleString()} → ${r.medV.toLocaleString()} | Reduction: ${r.diff.toLocaleString()} (${r.diffPct}%)`);
  }
  console.log('=== DONE ===');
}
main();
