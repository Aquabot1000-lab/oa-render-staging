const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');

function s(v) { return (v === null || v === undefined) ? '-' : String(v); }
function cur(v) { if (v === null || v === undefined) return '-'; const n = Number(v); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US'); }

const clients = [
  {
    name: 'Shabir Hasanali Rupani',
    caseNum: 'OA-0013',
    address: '708 SANTA LUCIA DR',
    fullAddress: '708 Santa Lucia Dr, Anna, TX 75409',
    county: 'Collin',
    taxId: 'R-13273-00J-0230-1',
    owner: 'RUPANI, SHABIR HASANALI',
    marketValue: 399042,
    propertyClass: 'A1', condition: 'Good',
    yearBuilt: '2024', effectiveYear: '2024',
    mainSqft: 1781,
    improvementValue: 274042, featureValue: 0, poolValue: 0, landValue: 125000,
    comps: [
      { taxId: 'R-13273-00J-0250-1', address: '740 SANTA LUCIA DR', marketValue: 359000, distance: 0.05, propClass: 'A1', condition: 'Good', yearBuilt: '2024', effYear: '2024', sqft: 1777, imprValue: 234000, featureValue: 0, poolValue: 0, landValue: 125000 },
      { taxId: 'R-13273-00K-0010-1', address: '901 PORTINA DR', marketValue: 367500, distance: 0.16, propClass: 'A1', condition: 'Good', yearBuilt: '2024', effYear: '2024', sqft: 1777, imprValue: 242500, featureValue: 0, poolValue: 0, landValue: 125000 },
      { taxId: 'R-13273-00K-0040-1', address: '924 AMENDUNI LN', marketValue: 367900, distance: 0.20, propClass: 'A1', condition: 'Good', yearBuilt: '2024', effYear: '2024', sqft: 1777, imprValue: 242900, featureValue: 0, poolValue: 0, landValue: 125000 },
      { taxId: 'R-13273-00J-0070-1', address: '221 SANTA LUCIA DR', marketValue: 375000, distance: 0.17, propClass: 'A1', condition: 'Good', yearBuilt: '2023', effYear: '2023', sqft: 1799, imprValue: 249000, featureValue: 0, poolValue: 0, landValue: 126000 },
      { taxId: 'R-13273-00L-0050-1', address: '1309 RENATO DR', marketValue: 375000, distance: 0.24, propClass: 'A1', condition: 'Good', yearBuilt: '2024', effYear: '2024', sqft: 1799, imprValue: 249000, featureValue: 0, poolValue: 0, landValue: 126000 },
      { taxId: 'R-13273-00F-0120-1', address: '601 PEMBERTON DR', marketValue: 349995, distance: 0.25, propClass: 'A1', condition: 'Good', yearBuilt: '2018', effYear: '2018', sqft: 1842, imprValue: 223995, featureValue: 0, poolValue: 0, landValue: 126000 },
      { taxId: 'R-13273-00H-0080-1', address: '1988 HELMOKEN FALLS DR', marketValue: 310000, distance: 0.38, propClass: 'A1', condition: 'Good', yearBuilt: '2005', effYear: '2005', sqft: 1787, imprValue: 185000, featureValue: 0, poolValue: 0, landValue: 125000 },
      { taxId: 'R-13273-00C-0030-1', address: '132 BIRDBROOK DR', marketValue: 317000, distance: 0.45, propClass: 'A1', condition: 'Good', yearBuilt: '2006', effYear: '2006', sqft: 1782, imprValue: 192000, featureValue: 0, poolValue: 0, landValue: 125000 },
      { taxId: 'R-13273-00E-0100-1', address: '910 FULBOURNE DR', marketValue: 315000, distance: 0.53, propClass: 'A1', condition: 'Good', yearBuilt: '2007', effYear: '2007', sqft: 1760, imprValue: 190000, featureValue: 0, poolValue: 0, landValue: 125000 },
      { taxId: 'R-13273-00L-0040-1', address: '1216 RENATO DR', marketValue: 420000, distance: 0.26, propClass: 'A1', condition: 'Good', yearBuilt: '2024', effYear: '2024', sqft: 1800, imprValue: 294000, featureValue: 0, poolValue: 0, landValue: 126000 },
    ]
  },
  {
    name: 'Khiem Nguyen',
    caseNum: 'OA-0010',
    address: '3315 MARLENE MEADOW WAY',
    fullAddress: '3315 Marlene Meadow Way, Richmond, TX 77406',
    county: 'Fort Bend',
    taxId: '5296-09-002-0200-901',
    owner: 'NGUYEN, KHIEM DUC',
    marketValue: 648786,
    propertyClass: 'A1', condition: 'Good',
    yearBuilt: '2023', effectiveYear: '2023',
    mainSqft: 3718,
    improvementValue: 585736, featureValue: 0, poolValue: 0, landValue: 63050,
    comps: [
      { taxId: '5296-09-002-0140-901', address: '3202 MARLENE MEADOW WAY', marketValue: 739900, distance: 0.11, propClass: 'A1', condition: 'Good', yearBuilt: '2023', effYear: '2023', sqft: 3717, imprValue: 676850, featureValue: 0, poolValue: 0, landValue: 63050 },
      { taxId: '5296-09-001-0080-901', address: '3306 WILLOW FIN WAY', marketValue: 645000, distance: 0.17, propClass: 'A1', condition: 'Good', yearBuilt: '2022', effYear: '2022', sqft: 3741, imprValue: 581950, featureValue: 0, poolValue: 0, landValue: 63050 },
      { taxId: '5296-09-002-0170-901', address: '3215 MARLENE MEADOW WAY', marketValue: 630000, distance: 0.09, propClass: 'A1', condition: 'Good', yearBuilt: '2023', effYear: '2023', sqft: 3794, imprValue: 566950, featureValue: 0, poolValue: 0, landValue: 63050 },
      { taxId: '5296-05-001-0120-901', address: '2111 S PECAN TRAIL DR', marketValue: 574000, distance: 1.26, propClass: 'A1', condition: 'Good', yearBuilt: '2002', effYear: '2002', sqft: 3866, imprValue: 510950, featureValue: 0, poolValue: 0, landValue: 63050 },
      { taxId: '5296-08-003-0050-901', address: '4119 PEMBROOKE WAY', marketValue: 774999, distance: 1.29, propClass: 'A1', condition: 'Good', yearBuilt: '2003', effYear: '2003', sqft: 3895, imprValue: 711949, featureValue: 0, poolValue: 0, landValue: 63050 },
      { taxId: '5296-05-001-0080-901', address: '2015 PECAN TRAIL DR', marketValue: 499000, distance: 1.35, propClass: 'A1', condition: 'Good', yearBuilt: '1990', effYear: '1990', sqft: 3968, imprValue: 435950, featureValue: 0, poolValue: 0, landValue: 63050 },
      { taxId: '5296-04-002-0100-901', address: '2218 LANDSCAPE WAY', marketValue: 500000, distance: 1.57, propClass: 'A1', condition: 'Good', yearBuilt: '1989', effYear: '1989', sqft: 3269, imprValue: 436950, featureValue: 0, poolValue: 0, landValue: 63050 },
      { taxId: '5296-06-001-0030-901', address: '3006 PECAN WAY CT', marketValue: 625000, distance: 1.05, propClass: 'A1', condition: 'Good', yearBuilt: '1998', effYear: '1998', sqft: 4723, imprValue: 561950, featureValue: 0, poolValue: 0, landValue: 63050 },
      { taxId: '5296-10-001-0150-901', address: '8327 VALBURN DR', marketValue: 464998, distance: 1.49, propClass: 'A1', condition: 'Good', yearBuilt: '2024', effYear: '2024', sqft: 2989, imprValue: 401948, featureValue: 0, poolValue: 0, landValue: 63050 },
      { taxId: '5296-05-002-0040-901', address: '2106 SHADE CREST DR', marketValue: 549000, distance: 1.26, propClass: 'A1', condition: 'Good', yearBuilt: '1994', effYear: '1994', sqft: 4031, imprValue: 485950, featureValue: 0, poolValue: 0, landValue: 63050 },
    ]
  }
];

function calcAdj(subj, comp) {
  const compPSF = comp.imprValue / comp.sqft;
  const sizeAdj = Math.round(compPSF * (subj.mainSqft - comp.sqft) / 2);
  const subjEY = parseInt(subj.effectiveYear);
  const compEY = parseInt(comp.effYear);
  const ageAdj = Math.round(0.5 * ((subjEY - compEY) / 100) * comp.marketValue);
  const landAdj = subj.landValue - comp.landValue;
  const featureAdj = subj.featureValue - comp.featureValue;
  const poolAdj = subj.poolValue - comp.poolValue;
  const netAdj = sizeAdj + ageAdj + landAdj + featureAdj + poolAdj;
  const totalAdj = comp.marketValue + netAdj;
  const psf = comp.imprValue / comp.sqft;
  return { sizeAdj, ageAdj, landAdj, featureAdj, poolAdj, netAdj, totalAdj, psf };
}

function adjStr(val, base) {
  if (base === 0) return cur(val) + ' (0.00%)';
  return cur(val) + ' (' + (val / base * 100).toFixed(2) + '%)';
}

function generatePDF(client) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 30 });
    const filename = `${client.caseNum}_${client.name.replace(/ /g, '_')}_Equal_Uniform.pdf`;
    const filePath = path.join('/tmp', filename);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const subjPSF = client.improvementValue / client.mainSqft;
    const compData = client.comps.map(c => ({ ...c, ...calcAdj(client, c) }));
    compData.sort((a, b) => a.totalAdj - b.totalAdj);

    const medIdx = Math.floor(compData.length / 2);
    const medVal = compData[medIdx].totalAdj;
    const minVal = compData[0].totalAdj;
    const maxVal = compData[compData.length - 1].totalAdj;

    const PW = doc.page.width;
    const PH = doc.page.height;
    const ML = 30; // margin left
    const COMPS_PER_PAGE = 3;
    let pageCount = 0;

    // Row labels and data extractors
    const rowDefs = [
      { label: 'Tax ID', subj: () => client.taxId, comp: c => c.taxId },
      { label: 'Address', subj: () => client.address, comp: c => c.address },
      { label: 'Market Value', subj: () => cur(client.marketValue), comp: c => cur(c.marketValue) },
      { label: 'Distance (Miles)', subj: () => '-', comp: c => c.distance.toFixed(2) },
      { label: 'Property Class', subj: () => client.propertyClass, comp: c => c.propClass },
      { label: 'Condition', subj: () => client.condition, comp: c => c.condition },
      { label: 'Year Built (Effective)', subj: () => `${client.yearBuilt} (${client.effectiveYear})`, comp: c => `${c.yearBuilt} (${c.effYear})` },
      { label: 'Main SQFT (PSF)', subj: () => `${client.mainSqft.toLocaleString()} ($${subjPSF.toFixed(2)})`, comp: c => `${c.sqft.toLocaleString()} ($${c.psf.toFixed(2)})` },
      { label: 'Improvement Value', subj: () => cur(client.improvementValue), comp: c => cur(c.imprValue) },
      { label: 'Feature Value', subj: () => cur(client.featureValue), comp: c => cur(c.featureValue) },
      { label: 'Pool Value', subj: () => cur(client.poolValue), comp: c => cur(c.poolValue) },
      { label: 'Land Value', subj: () => cur(client.landValue), comp: c => cur(c.landValue) },
      { label: 'Feature / Pool Value', subj: () => `${cur(client.featureValue)} (${cur(client.poolValue)})`, comp: c => `${cur(c.featureValue)} (${cur(c.poolValue)})` },
      { label: 'SEP', subj: () => '', comp: () => '' },
      { label: 'Age Adjustment', subj: () => '-', comp: c => adjStr(c.ageAdj, c.marketValue), isAdj: true },
      { label: 'Size Adjustment', subj: () => '-', comp: c => adjStr(c.sizeAdj, c.marketValue), isAdj: true },
      { label: 'Land Adjustment', subj: () => '-', comp: c => adjStr(c.landAdj, c.marketValue), isAdj: true },
      { label: 'Feature Adjustment', subj: () => '-', comp: c => adjStr(c.featureAdj, c.marketValue), isAdj: true },
      { label: 'Pool Adjustment', subj: () => '-', comp: c => adjStr(c.poolAdj, c.marketValue), isAdj: true },
      { label: 'Net Adjustment', subj: () => '-', comp: c => adjStr(c.netAdj, c.marketValue), isAdj: true, bold: true },
      { label: 'SEP', subj: () => '', comp: () => '' },
      { label: 'Total Adjusted Value', subj: () => '-', comp: c => cur(c.totalAdj), isTotal: true },
    ];

    function drawPage(pageComps) {
      if (pageCount > 0) doc.addPage({ layout: 'landscape' });
      pageCount++;

      const numCols = pageComps.length + 2; // label + subject + comps
      const labelW = 130;
      const dataW = (PW - 60 - labelW) / (pageComps.length + 1);
      let y = 30;

      // === HEADER BAR ===
      doc.save();
      doc.rect(ML, y, PW - 60, 22).fill('#2c3e50');
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text('OverAssessed.ai', ML + 8, y + 4, { width: 150, lineBreak: false });
      doc.fontSize(6).font('Helvetica').fillColor('#dddddd');
      doc.text(`Prepared for: ${client.name}`, ML + 8, y + 13, { width: 250, lineBreak: false });
      doc.fontSize(6).fillColor('#dddddd');
      doc.text(`${client.county} County  |  Case: ${client.caseNum}`, PW - 220, y + 8, { width: 190, lineBreak: false });
      doc.restore();
      y += 24;

      // === EQUAL & UNIFORM BANNER ===
      doc.save();
      doc.rect(ML, y, PW - 60, 16).fill('#34495e');
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text('Equal & Uniform Analysis', ML, y + 3, { width: PW - 60, align: 'center' });
      doc.restore();
      y += 18;

      // === PROPERTY LINE ===
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a1a2e');
      doc.text(client.address, ML + 5, y + 2, { width: 240, lineBreak: false });
      doc.fontSize(7).font('Helvetica').fillColor('#555');
      doc.text(`Tax ID: ${client.taxId}   Owner: ${client.owner}`, ML + 250, y + 3, { width: PW - ML - 280, lineBreak: false });
      y += 14;

      // === INDICATED VALUE BOX ===
      doc.save();
      doc.rect(ML, y, 160, 18).fill('#e8f5e9').lineWidth(0.5).stroke('#2e7d32');
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#2e7d32');
      doc.text(`Indicated Value ${cur(medVal)}`, ML + 5, y + 4, { width: 155, lineBreak: false });
      doc.rect(ML + 165, y, PW - 60 - 165, 18).fill('#f5f5f5').lineWidth(0.5).stroke('#999');
      doc.fontSize(6.5).font('Helvetica').fillColor('#333');
      doc.text(`Comps: ${compData.length}  |  Min: ${cur(minVal)}  |  Max: ${cur(maxVal)}  |  Median: ${cur(medVal)}`, ML + 172, y + 5, { width: PW - 60 - 175, lineBreak: false });
      doc.restore();
      y += 22;

      // === TABLE ===
      const tableX = ML;
      const rowH = 15;

      // Column headers
      doc.save();
      doc.rect(tableX, y, labelW, 16).fill('#dee2e6');
      doc.fontSize(6).font('Helvetica-Bold').fillColor('#333');
      doc.text('(CAD 2025)', tableX + 3, y + 4, { continued: false });

      let cx = tableX + labelW;
      doc.rect(cx, y, dataW, 16).fill('#d4edda');
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#155724');
      doc.text('SUBJECT', cx + 3, y + 4, { width: dataW - 6, align: 'center' });
      cx += dataW;

      pageComps.forEach((comp, i) => {
        const globalIdx = compData.indexOf(comp);
        const isMedian = globalIdx === medIdx;
        const bg = isMedian ? '#fff3cd' : '#e2e3e5';
        const label = isMedian ? 'MEDIAN COMP' : `COMP ${globalIdx + 1}`;
        doc.rect(cx, y, dataW, 16).fill(bg);
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#333');
        doc.text(label, cx + 3, y + 4, { width: dataW - 6, align: 'center' });
        cx += dataW;
      });
      doc.restore();
      y += 16;

      // Data rows
      rowDefs.forEach((rd, ri) => {
        if (rd.label === 'SEP') { y += 3; return; }

        const bg = rd.isAdj ? '#fafafa' : (ri % 2 === 0 ? '#ffffff' : '#f8f9fa');
        const textColor = rd.isTotal ? '#155724' : '#333333';
        const fontSize = rd.isTotal ? 8 : 6.5;
        const fontName = (rd.bold || rd.isTotal) ? 'Helvetica-Bold' : 'Helvetica';

        // Label cell
        doc.save();
        doc.rect(tableX, y, labelW, rowH).fill(bg);
        doc.moveTo(tableX, y).lineTo(tableX + labelW, y).lineWidth(0.3).stroke('#ddd');
        doc.fontSize(fontSize).font(fontName).fillColor('#333');
        doc.text(rd.label, tableX + 3, y + 3, { width: labelW - 6, continued: false });

        // Subject cell
        cx = tableX + labelW;
        doc.rect(cx, y, dataW, rowH).fill(bg);
        doc.moveTo(cx, y).lineTo(cx + dataW, y).lineWidth(0.3).stroke('#ddd');
        doc.fontSize(fontSize).font('Helvetica').fillColor(textColor);
        doc.text(s(rd.subj()), cx + 3, y + 3, { width: dataW - 6, align: 'center' });
        cx += dataW;

        // Comp cells
        pageComps.forEach(comp => {
          doc.rect(cx, y, dataW, rowH).fill(bg);
          doc.moveTo(cx, y).lineTo(cx + dataW, y).lineWidth(0.3).stroke('#ddd');
          doc.fontSize(fontSize).font(fontName).fillColor(textColor);
          doc.text(s(rd.comp(comp)), cx + 3, y + 3, { width: dataW - 6, align: 'center' });
          cx += dataW;
        });
        doc.restore();
        y += rowH;
      });

      // Bottom border
      doc.moveTo(tableX, y).lineTo(tableX + labelW + dataW * (pageComps.length + 1), y).lineWidth(0.5).stroke('#999');

      // Footer — use width constraints to prevent page overflow
      doc.fontSize(6).font('Helvetica').fillColor('#999');
      doc.text(`Account: ${client.taxId}    ${client.county} County`, ML, PH - 25, { width: 200, lineBreak: false });
      doc.text(`${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}    Page ${pageCount}`, PW / 2 - 40, PH - 25, { width: 120, lineBreak: false });
      doc.text('Confidential    Generated by OverAssessed.ai', PW - 210, PH - 25, { width: 200, lineBreak: false });
    }

    // Generate comp pages
    for (let i = 0; i < compData.length; i += COMPS_PER_PAGE) {
      drawPage(compData.slice(i, i + COMPS_PER_PAGE));
    }

    // === FORMULAS PAGE ===
    doc.addPage({ layout: 'landscape' });
    pageCount++;
    let fy = 30;
    doc.save();
    doc.rect(ML, fy, PW - 60, 22).fill('#2c3e50');
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('OverAssessed.ai', ML + 8, fy + 7, { width: 150, lineBreak: false });
    doc.restore();
    fy += 26;

    doc.rect(ML, fy, PW - 60, 16).fill('#34495e');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('Equal & Uniform Analysis — Formulas & Summary', ML, fy + 3, { width: PW - 60, align: 'center' });
    fy += 22;

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a2e');
    doc.text('Adjustment Formulas:', ML + 5, fy);
    fy += 14;
    doc.fontSize(7.5).font('Helvetica').fillColor('#555');
    const formulas = [
      'Appraised values reflect updated 2025 values, where available.',
      'Size Adjustment: (Comp Impr PSF x (Subj Main Area - Comp Main Area) / 2)',
      'Age Adjustment: (0.5 x (Subject EYOC - Comp EYOC) / 100) x Comp Market Value',
      'Land Adjustment: Subject Land Value - Comp Land Value',
      'Feature Adjustment: Subject Feature Value - Comp Feature Value',
      'Pool Adjustment: Subject Pool Value - Comp Pool Value',
      'Comps selected using Property Class, Distance, Condition, Size, and Year Built.',
    ];
    formulas.forEach(f => { doc.text('  • ' + f, ML + 10, fy); fy += 12; });

    fy += 10;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a2e');
    doc.text('Data Sources:', ML + 5, fy); fy += 14;
    doc.fontSize(7.5).font('Helvetica').fillColor('#555');
    doc.text(`  • ${client.county} County Appraisal District (2025 Values)`, ML + 10, fy); fy += 12;
    doc.text('  • RentCast API (comparable sales & AVM)', ML + 10, fy); fy += 12;
    doc.text('  • OverAssessed.ai property tax analysis engine', ML + 10, fy); fy += 20;

    const diff = client.marketValue - medVal;
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#2e7d32');
    doc.text(`INDICATED VALUE: ${cur(medVal)} (Median of ${compData.length} adjusted comparables)`, ML + 5, fy); fy += 16;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#cc0000');
    doc.text(`CURRENT CAD VALUE: ${cur(client.marketValue)}`, ML + 5, fy); fy += 16;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a1a2e');
    doc.text(`PROPOSED REDUCTION: ${cur(diff)} (${(diff / client.marketValue * 100).toFixed(1)}%)`, ML + 5, fy);

    // Footer
    doc.fontSize(6).font('Helvetica').fillColor('#999');
    doc.text(`Account: ${client.taxId}    ${client.county} County`, ML, PH - 25, { width: 200, lineBreak: false });
    doc.text(`Page ${pageCount}`, PW / 2 - 20, PH - 25, { width: 80, lineBreak: false });
    doc.text('Confidential    Generated by OverAssessed.ai', PW - 210, PH - 25, { width: 200, lineBreak: false });

    doc.end();
    stream.on('finish', () => { console.log('OK: ' + filePath); resolve(filePath); });
    stream.on('error', reject);
  });
}

async function main() {
  console.log('=== GEN TAXNET V3 ===');
  for (const c of clients) {
    try { await generatePDF(c); } catch (e) { console.error('FAIL:', c.caseNum, e.message, e.stack); }
  }
  console.log('=== DONE ===');
}
main();
