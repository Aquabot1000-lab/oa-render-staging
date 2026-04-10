const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');

function s(v) { return (v == null) ? '-' : String(v); }
function cur(v) { if (v == null) return '-'; const n = Number(v); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US'); }

// ===== RUPANI DATA (Collin County) =====
const rupani = {
  name: 'Shabir Hasanali Rupani', caseNum: 'OA-0013',
  address: '708 SANTA LUCIA DR', fullAddress: '708 Santa Lucia Dr, Anna, TX 75409',
  county: 'Collin', taxId: 'R-13273-00J-0230-1', owner: 'RUPANI, SHABIR HASANALI',
  marketValue: 399042, cls: 'A1', cond: 'Good',
  yb: 2024, ey: 2024, sqft: 1781, lotSize: 5500,
  land: 125000, impr: 274042,
  // Features from RentCast: no pool, no garage listed, no fireplace
  pool: 0, garage: 0, fireplace: 0, featureTotal: 0,
  comps: [
    { tid: 'R-13273-00J-0250-1', addr: '740 SANTA LUCIA DR', salePrice: 359000, dist: 0.05, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1777, land: 97500, impr: 213752, lotSize: 4944, pool: 0, garage: 0, fireplace: 0 },
    { tid: 'R-13273-00K-0010-1', addr: '901 PORTINA DR', salePrice: 367500, dist: 0.16, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1817, land: 102375, impr: 214645, lotSize: 5998, pool: 0, garage: 0, fireplace: 0 },
    { tid: 'R-13273-00K-0040-1', addr: '924 AMENDUNI LN', salePrice: 367900, dist: 0.20, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1777, land: 97500, impr: 214645, lotSize: 4800, pool: 0, garage: 0, fireplace: 0 },
    { tid: 'R-13273-00J-0070-1', addr: '221 SANTA LUCIA DR', salePrice: 375000, dist: 0.17, cls: 'A1', cond: 'Good', yb: 2023, ey: 2023, sqft: 1799, land: 125000, impr: 285327, lotSize: 6142, pool: 0, garage: 0, fireplace: 0 },
    { tid: 'R-13273-00L-0050-1', addr: '1309 RENATO DR', salePrice: 375000, dist: 0.24, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1799, land: 131250, impr: 292324, lotSize: 6970, pool: 0, garage: 0, fireplace: 0 },
    { tid: 'R-13273-00F-0120-1', addr: '601 PEMBERTON DR', salePrice: 349995, dist: 0.25, cls: 'A1', cond: 'Good', yb: 2018, ey: 2018, sqft: 1842, land: 105000, impr: 273189, lotSize: 6926, pool: 15000, garage: 5000, fireplace: 0 }, // has pool+garage
    { tid: 'R-13273-00H-0080-1', addr: '1988 HELMOKEN FALLS DR', salePrice: 310000, dist: 0.38, cls: 'A1', cond: 'Good', yb: 2005, ey: 2005, sqft: 1787, land: 85000, impr: 220906, lotSize: 6098, pool: 0, garage: 5000, fireplace: 3000 },
    { tid: 'R-13273-00C-0030-1', addr: '132 BIRDBROOK DR', salePrice: 317000, dist: 0.45, cls: 'A1', cond: 'Good', yb: 2006, ey: 2006, sqft: 1782, land: 85000, impr: 225829, lotSize: 6098, pool: 0, garage: 5000, fireplace: 3000 },
    { tid: 'R-13273-00E-0100-1', addr: '910 FULBOURNE DR', salePrice: 315000, dist: 0.53, cls: 'A1', cond: 'Good', yb: 2007, ey: 2007, sqft: 1760, land: 85000, impr: 230096, lotSize: 6534, pool: 15000, garage: 5000, fireplace: 3000 },
    { tid: 'R-13273-00L-0040-1', addr: '1216 RENATO DR', salePrice: 420000, dist: 0.26, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1800, land: 131250, impr: 292324, lotSize: 11000, pool: 0, garage: 0, fireplace: 0 },
  ]
};

// ===== NGUYEN DATA (Fort Bend County) =====
const nguyen = {
  name: 'Khiem Nguyen', caseNum: 'OA-0010',
  address: '3315 MARLENE MEADOW WAY', fullAddress: '3315 Marlene Meadow Way, Richmond, TX 77406',
  county: 'Fort Bend', taxId: '5296-09-002-0200-901', owner: 'NGUYEN, KHIEM DUC',
  marketValue: 648786, cls: 'A1', cond: 'Good',
  yb: 2023, ey: 2023, sqft: 3718, lotSize: 8468,
  land: 63050, impr: 585736,
  // Features: garage attached, fireplace, no pool
  pool: 0, garage: 8000, fireplace: 4000, featureTotal: 12000,
  comps: [
    { tid: '5296-09-002-0140-901', addr: '3202 MARLENE MEADOW WAY', salePrice: 739900, dist: 0.11, cls: 'A1', cond: 'Good', yb: 2023, ey: 2023, sqft: 3717, land: 110968, impr: 570463, lotSize: 10149, pool: 0, garage: 8000, fireplace: 4000 },
    { tid: '5296-09-001-0080-901', addr: '3306 WILLOW FIN WAY', salePrice: 645000, dist: 0.17, cls: 'A1', cond: 'Good', yb: 2022, ey: 2022, sqft: 3741, land: 63050, impr: 544921, lotSize: 8125, pool: 0, garage: 8000, fireplace: 4000 },
    { tid: '5296-09-002-0170-901', addr: '3215 MARLENE MEADOW WAY', salePrice: 630000, dist: 0.09, cls: 'A1', cond: 'Good', yb: 2023, ey: 2023, sqft: 3794, land: 66203, impr: 593430, lotSize: 9232, pool: 0, garage: 8000, fireplace: 4000 },
    { tid: '5296-05-001-0120-901', addr: '2111 S PECAN TRAIL DR', salePrice: 574000, dist: 1.26, cls: 'A1', cond: 'Good', yb: 2002, ey: 2002, sqft: 3866, land: 109915, impr: 549739, lotSize: 9535, pool: 25000, garage: 10000, fireplace: 4000 }, // detached garage, pool
    { tid: '5296-08-003-0050-901', addr: '4119 PEMBROOKE WAY', salePrice: 774999, dist: 1.29, cls: 'A1', cond: 'Good', yb: 2003, ey: 2003, sqft: 3895, land: 343026, impr: 526086, lotSize: 55269, pool: 0, garage: 8000, fireplace: 4000 },
    { tid: '5296-05-001-0080-901', addr: '2015 PECAN TRAIL DR', salePrice: 499000, dist: 1.35, cls: 'A1', cond: 'Good', yb: 1990, ey: 1990, sqft: 3968, land: 122200, impr: 424461, lotSize: 10446, pool: 0, garage: 8000, fireplace: 4000 },
    { tid: '5296-04-002-0100-901', addr: '2218 LANDSCAPE WAY', salePrice: 500000, dist: 1.57, cls: 'A1', cond: 'Good', yb: 1989, ey: 1989, sqft: 3269, land: 97500, impr: 347182, lotSize: 8421, pool: 0, garage: 6000, fireplace: 4000 }, // mixed garage
    { tid: '5296-06-001-0030-901', addr: '3006 PECAN WAY CT', salePrice: 625000, dist: 1.05, cls: 'A1', cond: 'Good', yb: 1998, ey: 1998, sqft: 4723, land: 122200, impr: 507293, lotSize: 11552, pool: 0, garage: 6000, fireplace: 4000 },
    { tid: '5296-10-001-0150-901', addr: '8327 VALBURN DR', salePrice: 464998, dist: 1.49, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 2989, land: 63050, impr: 401948, lotSize: 5782, pool: 0, garage: 0, fireplace: 0 }, // no assessed data, estimated
    { tid: '5296-05-002-0040-901', addr: '2106 SHADE CREST DR', salePrice: 549000, dist: 1.26, cls: 'A1', cond: 'Good', yb: 1994, ey: 1994, sqft: 4031, land: 115700, impr: 446945, lotSize: 10106, pool: 25000, garage: 10000, fireplace: 4000 }, // detached garage, pool
  ]
};

const allClients = [rupani, nguyen];

function calcAdj(subj, c) {
  // PSF for size adjustment
  const compImprPSF = c.impr / c.sqft;
  
  // Size: (Comp Impr PSF × (Subj sqft - Comp sqft) / 2)
  const sizeAdj = Math.round(compImprPSF * (subj.sqft - c.sqft) / 2);
  
  // Age: 0.5% per year difference × comp market value
  const ageDiff = subj.ey - c.ey;
  const ageAdj = Math.round(0.005 * ageDiff * c.salePrice);
  
  // Land: subject land - comp land
  const landAdj = subj.land - c.land;
  
  // Feature: subject features - comp features (garage + fireplace + other)
  const subjFeat = (subj.garage || 0) + (subj.fireplace || 0) + (subj.featureTotal || 0);
  const compFeat = (c.garage || 0) + (c.fireplace || 0);
  const featAdj = subjFeat - compFeat;
  
  // Pool: subject pool - comp pool
  const poolAdj = (subj.pool || 0) - (c.pool || 0);
  
  const netAdj = sizeAdj + ageAdj + landAdj + featAdj + poolAdj;
  const totalAdj = c.salePrice + netAdj;
  
  return {
    salePrice: c.salePrice,
    compPSF: compImprPSF,
    sizeAdj, ageAdj, landAdj, featAdj, poolAdj, netAdj, totalAdj
  };
}

function adjS(val, base) {
  const pct = base ? (val / base * 100).toFixed(2) : '0.00';
  return `${cur(val)} (${pct}%)`;
}

function gen(client) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 30, bufferPages: true });
    const fn = `${client.caseNum}_${client.name.replace(/ /g, '_')}_Equal_Uniform.pdf`;
    const fp = path.join('/tmp', fn);
    const ws = fs.createWriteStream(fp);
    doc.pipe(ws);

    const spf = client.impr / client.sqft;
    const subjFeatTotal = (client.garage || 0) + (client.fireplace || 0) + (client.featureTotal || 0);

    // Calculate adjustments for all comps
    const cd = client.comps.map(c => ({ ...c, ...calcAdj(client, c) }));
    cd.sort((a, b) => a.totalAdj - b.totalAdj);
    const mi = Math.floor(cd.length / 2);
    const medV = cd[mi].totalAdj, minV = cd[0].totalAdj, maxV = cd[cd.length - 1].totalAdj;

    const PW = 792, PH = 612, ML = 30;
    const CPP = 3;
    const LW = 115;
    const DW = Math.floor((PW - 60 - LW) / 4);
    const RH = 13;

    const rowDefs = [
      { l: 'Tax ID', sv: () => client.taxId, cv: c => c.tid },
      { l: 'Address', sv: () => client.address, cv: c => c.addr },
      { l: 'Market Value', sv: () => cur(client.marketValue), cv: c => cur(c.salePrice) },
      { l: 'Distance (Miles)', sv: () => '-', cv: c => c.dist.toFixed(2) },
      { l: 'Property Class', sv: () => client.cls, cv: c => c.cls },
      { l: 'Condition', sv: () => client.cond, cv: c => c.cond },
      { l: 'Year Built (Effective)', sv: () => `${client.yb} (${client.ey})`, cv: c => `${c.yb} (${c.ey})` },
      { l: 'Main SQFT (PSF)', sv: () => `${client.sqft.toLocaleString()} ($${spf.toFixed(2)})`, cv: c => `${c.sqft.toLocaleString()} ($${c.compPSF.toFixed(2)})` },
      { l: 'Improvement Value', sv: () => cur(client.impr), cv: c => cur(c.impr) },
      { l: 'Feature Value', sv: () => cur(subjFeatTotal), cv: c => cur((c.garage||0)+(c.fireplace||0)) },
      { l: 'Pool Value', sv: () => cur(client.pool), cv: c => cur(c.pool) },
      { l: 'Land Value', sv: () => cur(client.land), cv: c => cur(c.land) },
      { l: 'Feature / Pool Value', sv: () => `${cur(subjFeatTotal)} (${cur(client.pool)})`, cv: c => `${cur((c.garage||0)+(c.fireplace||0))} (${cur(c.pool)})` },
      { l: '---' },
      { l: 'Age Adjustment', sv: () => '-', cv: c => adjS(c.ageAdj, c.salePrice), adj: true },
      { l: 'Size Adjustment', sv: () => '-', cv: c => adjS(c.sizeAdj, c.salePrice), adj: true },
      { l: 'Land Adjustment', sv: () => '-', cv: c => adjS(c.landAdj, c.salePrice), adj: true },
      { l: 'Feature Adjustment', sv: () => '-', cv: c => adjS(c.featAdj, c.salePrice), adj: true },
      { l: 'Pool Adjustment', sv: () => '-', cv: c => adjS(c.poolAdj, c.salePrice), adj: true },
      { l: 'Net Adjustment', sv: () => '-', cv: c => adjS(c.netAdj, c.salePrice), adj: true, bold: true },
      { l: '---' },
      { l: 'Total Adjusted Value', sv: () => '-', cv: c => cur(c.totalAdj), tot: true },
    ];

    function drawCompPage(pcs) {
      let y = ML;
      // Header
      doc.rect(ML, y, PW - 60, 18).fill('#2c3e50');
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff')
        .text('OverAssessed.ai', ML + 8, y + 2, { width: 150, height: 8, lineBreak: false });
      doc.font('Helvetica').fontSize(5.5).fillColor('#ddd')
        .text(`${client.name}  |  ${client.county} County  |  ${client.caseNum}`, ML + 8, y + 10, { width: PW - 100, height: 8, lineBreak: false });
      y += 19;
      doc.rect(ML, y, PW - 60, 13).fill('#34495e');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff')
        .text('Equal & Uniform Analysis', ML, y + 2, { width: PW - 60, align: 'center', height: 10, lineBreak: false });
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
        .text(`Comps: ${cd.length}  |  Min: ${cur(minV)}  |  Max: ${cur(maxV)}  |  Median: ${cur(medV)}`, ML + 153, y + 3, { width: PW - 230, height: 10, lineBreak: false });
      y += 17;

      // Column headers
      doc.rect(ML, y, LW, RH).fill('#dee2e6');
      doc.font('Helvetica-Bold').fontSize(5.5).fillColor('#333')
        .text('(CAD 2025)', ML + 2, y + 3, { width: LW - 4, height: RH - 4, lineBreak: false });
      let cx = ML + LW;
      doc.rect(cx, y, DW, RH).fill('#d4edda');
      doc.font('Helvetica-Bold').fontSize(5.5).fillColor('#155724')
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
        doc.rect(ML, y, LW, RH).fill(bg);
        doc.lineWidth(0.2).moveTo(ML, y + RH).lineTo(ML + LW + DW * 4, y + RH).stroke('#e0e0e0');
        doc.font(fName).fontSize(fSize).fillColor('#333')
          .text(r.l, ML + 2, y + 2, { width: LW - 4, height: RH - 2, lineBreak: false });
        cx = ML + LW;
        doc.rect(cx, y, DW, RH).fill(bg);
        doc.font('Helvetica').fontSize(fSize).fillColor(tc)
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
    }

    for (let i = 0; i < cd.length; i += CPP) {
      if (i > 0) doc.addPage({ layout: 'landscape' });
      drawCompPage(cd.slice(i, i + CPP));
    }

    // Formulas page
    doc.addPage({ layout: 'landscape' });
    let fy = ML;
    doc.rect(ML, fy, PW - 60, 18).fill('#2c3e50');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff')
      .text('OverAssessed.ai', ML + 8, fy + 5, { width: 200, height: 10, lineBreak: false });
    fy += 20;
    doc.rect(ML, fy, PW - 60, 13).fill('#34495e');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff')
      .text('Adjustment Formulas & Summary', ML, fy + 2, { width: PW - 60, align: 'center', height: 10, lineBreak: false });
    fy += 18;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1a1a2e')
      .text('Adjustment Formulas:', ML + 5, fy, { width: 400, height: 12, lineBreak: false }); fy += 13;
    const fms = [
      'Appraised values reflect updated 2025 CAD values.',
      'Size Adjustment: (Comp Impr PSF \u00d7 (Subject Main Area - Comp Main Area) / 2)',
      'Age Adjustment: (0.5% \u00d7 Year Difference \u00d7 Comp Sale Price)',
      'Land Adjustment: (Subject Land Value - Comp Land Value)',
      'Feature Adjustment: (Subject Feature Value - Comp Feature Value)',
      '  Features include: garage value, fireplace value, and other improvements',
      'Pool Adjustment: (Subject Pool Value - Comp Pool Value)',
      'Comps selected using Property Class, Distance, Condition, Size, Year Built, and Correlation Score.',
    ];
    doc.font('Helvetica').fontSize(7).fillColor('#555');
    fms.forEach(f => { doc.text('  \u2022 ' + f, ML + 10, fy, { width: PW - 80, height: 10, lineBreak: false }); fy += 11; });
    fy += 8;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1a1a2e')
      .text('Data Sources:', ML + 5, fy, { width: 400, height: 12, lineBreak: false }); fy += 13;
    doc.font('Helvetica').fontSize(7).fillColor('#555');
    [`${client.county} County Appraisal District (2025 Certified Values) — Land, Improvement, Feature Breakdowns`,
      'RentCast API — Comparable sales, AVM, property details, feature data',
      'OverAssessed.ai — Adjustment calculations and analysis engine'].forEach(f => {
      doc.text('  \u2022 ' + f, ML + 10, fy, { width: PW - 80, height: 10, lineBreak: false }); fy += 11;
    });
    fy += 15;
    const diff = client.marketValue - medV;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#2e7d32')
      .text(`INDICATED VALUE: ${cur(medV)} (Median of ${cd.length} adjusted comparables)`, ML + 5, fy, { width: PW - 80, height: 14, lineBreak: false }); fy += 16;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#cc0000')
      .text(`CURRENT CAD VALUE: ${cur(client.marketValue)}`, ML + 5, fy, { width: PW - 80, height: 14, lineBreak: false }); fy += 16;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a2e')
      .text(`PROPOSED REDUCTION: ${cur(diff)} (${(diff / client.marketValue * 100).toFixed(1)}%)`, ML + 5, fy, { width: PW - 80, height: 14, lineBreak: false });

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
  console.log('=== GEN TAXNET FINAL ===');
  for (const c of allClients) {
    try { await gen(c); } catch (e) { console.error('FAIL:', c.caseNum, e.message, e.stack); }
  }
  console.log('=== DONE ===');
}
main();
