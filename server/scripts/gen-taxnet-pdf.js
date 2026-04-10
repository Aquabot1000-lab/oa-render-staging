const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');

function s(v) { return (v === null || v === undefined) ? '-' : String(v); }
function cur(v) { return (v === null || v === undefined) ? '-' : '$' + Number(v).toLocaleString('en-US'); }
function pct(v) { return (v === null || v === undefined) ? '-' : v.toFixed(2) + '%'; }

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
    propertyClass: 'A1',
    condition: 'Good',
    yearBuilt: '2024',
    effectiveYear: '2024',
    mainSqft: 1781,
    improvementValue: 274042,
    featureValue: 0,
    poolValue: 0,
    landValue: 125000,
    comps: [
      { taxId: 'R-13273-00J-0250-1', address: '740 SANTA LUCIA DR', marketValue: 359000, distance: 0.05, propClass: 'A1', condition: 'Good', yearBuilt: '2024', effYear: '2024', sqft: 1777, imprValue: 234000, featureValue: 0, poolValue: 0, landValue: 125000, correlation: 0.970 },
      { taxId: 'R-13273-00K-0010-1', address: '901 PORTINA DR', marketValue: 367500, distance: 0.16, propClass: 'A1', condition: 'Good', yearBuilt: '2024', effYear: '2024', sqft: 1777, imprValue: 242500, featureValue: 0, poolValue: 0, landValue: 125000, correlation: 0.968 },
      { taxId: 'R-13273-00K-0040-1', address: '924 AMENDUNI LN', marketValue: 367900, distance: 0.20, propClass: 'A1', condition: 'Good', yearBuilt: '2024', effYear: '2024', sqft: 1777, imprValue: 242900, featureValue: 0, poolValue: 0, landValue: 125000, correlation: 0.968 },
      { taxId: 'R-13273-00J-0070-1', address: '221 SANTA LUCIA DR', marketValue: 375000, distance: 0.17, propClass: 'A1', condition: 'Good', yearBuilt: '2023', effYear: '2023', sqft: 1799, imprValue: 249000, featureValue: 0, poolValue: 0, landValue: 126000, correlation: 0.940 },
      { taxId: 'R-13273-00L-0050-1', address: '1309 RENATO DR', marketValue: 375000, distance: 0.24, propClass: 'A1', condition: 'Good', yearBuilt: '2024', effYear: '2024', sqft: 1799, imprValue: 249000, featureValue: 0, poolValue: 0, landValue: 126000, correlation: 0.938 },
      { taxId: 'R-13273-00F-0120-1', address: '601 PEMBERTON DR', marketValue: 349995, distance: 0.25, propClass: 'A1', condition: 'Good', yearBuilt: '2018', effYear: '2018', sqft: 1842, imprValue: 223995, featureValue: 0, poolValue: 0, landValue: 126000, correlation: 0.934 },
      { taxId: 'R-13273-00H-0080-1', address: '1988 HELMOKEN FALLS DR', marketValue: 310000, distance: 0.38, propClass: 'A1', condition: 'Good', yearBuilt: '2005', effYear: '2005', sqft: 1787, imprValue: 185000, featureValue: 0, poolValue: 0, landValue: 125000, correlation: 0.936 },
      { taxId: 'R-13273-00C-0030-1', address: '132 BIRDBROOK DR', marketValue: 317000, distance: 0.45, propClass: 'A1', condition: 'Good', yearBuilt: '2006', effYear: '2006', sqft: 1782, imprValue: 192000, featureValue: 0, poolValue: 0, landValue: 125000, correlation: 0.936 },
      { taxId: 'R-13273-00E-0100-1', address: '910 FULBOURNE DR', marketValue: 315000, distance: 0.53, propClass: 'A1', condition: 'Good', yearBuilt: '2007', effYear: '2007', sqft: 1760, imprValue: 190000, featureValue: 0, poolValue: 0, landValue: 125000, correlation: 0.933 },
      { taxId: 'R-13273-00L-0040-1', address: '1216 RENATO DR', marketValue: 420000, distance: 0.26, propClass: 'A1', condition: 'Good', yearBuilt: '2024', effYear: '2024', sqft: 1800, imprValue: 294000, featureValue: 0, poolValue: 0, landValue: 126000, correlation: 0.938 },
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
    propertyClass: 'A1',
    condition: 'Good',
    yearBuilt: '2023',
    effectiveYear: '2023',
    mainSqft: 3718,
    improvementValue: 585736,
    featureValue: 0,
    poolValue: 0,
    landValue: 63050,
    comps: [
      { taxId: '5296-09-002-0140-901', address: '3202 MARLENE MEADOW WAY', marketValue: 739900, distance: 0.11, propClass: 'A1', condition: 'Good', yearBuilt: '2023', effYear: '2023', sqft: 3717, imprValue: 676850, featureValue: 0, poolValue: 0, landValue: 63050, correlation: 0.970 },
      { taxId: '5296-09-001-0080-901', address: '3306 WILLOW FIN WAY', marketValue: 645000, distance: 0.17, propClass: 'A1', condition: 'Good', yearBuilt: '2022', effYear: '2022', sqft: 3741, imprValue: 581950, featureValue: 0, poolValue: 0, landValue: 63050, correlation: 0.968 },
      { taxId: '5296-09-002-0170-901', address: '3215 MARLENE MEADOW WAY', marketValue: 630000, distance: 0.09, propClass: 'A1', condition: 'Good', yearBuilt: '2023', effYear: '2023', sqft: 3794, imprValue: 566950, featureValue: 0, poolValue: 0, landValue: 63050, correlation: 0.967 },
      { taxId: '5296-05-001-0120-901', address: '2111 S PECAN TRAIL DR', marketValue: 574000, distance: 1.26, propClass: 'A1', condition: 'Good', yearBuilt: '2002', effYear: '2002', sqft: 3866, imprValue: 510950, featureValue: 0, poolValue: 0, landValue: 63050, correlation: 0.971 },
      { taxId: '5296-08-003-0050-901', address: '4119 PEMBROOKE WAY', marketValue: 774999, distance: 1.29, propClass: 'A1', condition: 'Good', yearBuilt: '2003', effYear: '2003', sqft: 3895, imprValue: 711949, featureValue: 0, poolValue: 0, landValue: 63050, correlation: 0.970 },
      { taxId: '5296-05-001-0080-901', address: '2015 PECAN TRAIL DR', marketValue: 499000, distance: 1.35, propClass: 'A1', condition: 'Good', yearBuilt: '1990', effYear: '1990', sqft: 3968, imprValue: 435950, featureValue: 0, poolValue: 0, landValue: 63050, correlation: 0.966 },
      { taxId: '5296-04-002-0100-901', address: '2218 LANDSCAPE WAY', marketValue: 500000, distance: 1.57, propClass: 'A1', condition: 'Good', yearBuilt: '1989', effYear: '1989', sqft: 3269, imprValue: 436950, featureValue: 0, poolValue: 0, landValue: 63050, correlation: 0.953 },
      { taxId: '5296-06-001-0030-901', address: '3006 PECAN WAY CT', marketValue: 625000, distance: 1.05, propClass: 'A1', condition: 'Good', yearBuilt: '1998', effYear: '1998', sqft: 4723, imprValue: 561950, featureValue: 0, poolValue: 0, landValue: 63050, correlation: 0.951 },
      { taxId: '5296-10-001-0150-901', address: '8327 VALBURN DR', marketValue: 464998, distance: 1.49, propClass: 'A1', condition: 'Good', yearBuilt: '2024', effYear: '2024', sqft: 2989, imprValue: 401948, featureValue: 0, poolValue: 0, landValue: 63050, correlation: 0.945 },
      { taxId: '5296-05-002-0040-901', address: '2106 SHADE CREST DR', marketValue: 549000, distance: 1.26, propClass: 'A1', condition: 'Good', yearBuilt: '1994', effYear: '1994', sqft: 4031, imprValue: 485950, featureValue: 0, poolValue: 0, landValue: 63050, correlation: 0.938 },
    ]
  }
];

function calcAdjustments(subject, comp) {
  const subjImprPSF = subject.improvementValue / subject.mainSqft;
  const compImprPSF = comp.imprValue / comp.sqft;
  
  const subjEY = parseInt(subject.effectiveYear);
  const compEY = parseInt(comp.effYear);
  
  const sizeAdj = Math.round(compImprPSF * (subject.mainSqft - comp.sqft) / 2);
  const ageAdj = Math.round(0.5 * ((subjEY - compEY) / 100) * comp.marketValue);
  const landAdj = Math.round(comp.marketValue - comp.landValue + subject.landValue) - comp.marketValue;
  const featureAdj = subject.featureValue - comp.featureValue;
  const poolAdj = subject.poolValue - comp.poolValue;
  const netAdj = sizeAdj + ageAdj + landAdj + featureAdj + poolAdj;
  const totalAdjValue = comp.marketValue + netAdj;
  const psf = (comp.marketValue - comp.landValue) / comp.sqft;

  return { sizeAdj, ageAdj, landAdj, featureAdj, poolAdj, netAdj, totalAdjValue, psf };
}

function generatePDF(client) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margins: { top: 60, bottom: 60, left: 40, right: 40 },
      size: 'LETTER',
      layout: 'landscape'
    });

    const filename = `${client.caseNum}_${client.name.replace(/ /g, '_')}_Equal_Uniform.pdf`;
    const filePath = path.join('/tmp', filename);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Calculate all adjustments
    const compData = client.comps.map(comp => {
      const adj = calcAdjustments(client, comp);
      return { ...comp, ...adj };
    });

    // Sort by totalAdjValue
    compData.sort((a, b) => a.totalAdjValue - b.totalAdjValue);

    // Find median
    const medianIdx = Math.floor(compData.length / 2);
    const medianValue = compData[medianIdx].totalAdjValue;
    const minValue = compData[0].totalAdjValue;
    const maxValue = compData[compData.length - 1].totalAdjValue;

    // Subject PSF
    const subjPSF = (client.marketValue - client.landValue) / client.mainSqft;

    // Pages: 3 comps per page
    const compsPerPage = 3;
    const totalPages = Math.ceil(compData.length / compsPerPage) + 1; // +1 for summary
    let pageNum = 0;

    function drawHeader() {
      pageNum++;
      const pw = doc.page.width;
      const ph = doc.page.height;

      // Top bar - company info
      doc.rect(0, 0, pw, 40).fill('#2c3e50');
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text('OverAssessed.ai', 40, 12);
      doc.fontSize(7).font('Helvetica').fillColor('#cccccc');
      doc.text('Property Tax Protest Analysis', 40, 24);
      doc.fontSize(7).fillColor('#cccccc');
      doc.text(`Prepared for: ${client.name}`, pw / 2 - 80, 12);
      doc.text(`${client.fullAddress}`, pw / 2 - 80, 24);
      doc.text(`${client.county} County`, pw - 200, 12);
      doc.text(`Case: ${client.caseNum}`, pw - 200, 24);

      // Equal & Uniform banner
      doc.rect(0, 42, pw, 25).fill('#34495e');
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text('Equal & Uniform Analysis', 0, 48, { width: pw, align: 'center' });

      // Property info line
      doc.y = 72;
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a1a2e');
      doc.text(client.address, 40, 72);
      doc.fontSize(9).font('Helvetica').fillColor('#555555');
      doc.text(`Tax ID: ${client.taxId}    Owner: ${client.owner}`, 40, 86);

      // Indicated value box
      doc.rect(40, 100, 200, 30).fill('#e8f5e9').stroke('#2e7d32');
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#2e7d32');
      doc.text(`Indicated Value ${cur(medianValue)}`, 50, 108);

      doc.rect(250, 100, 480, 30).fill('#f5f5f5').stroke('#999999');
      doc.fontSize(8).font('Helvetica').fillColor('#333333');
      doc.text(`Number of Comps: ${compData.length}  |  Min Adjusted: ${cur(minValue)}  |  Max Adjusted: ${cur(maxValue)}  |  Median: ${cur(medianValue)}`, 260, 108);

      // Footer
      doc.fontSize(7).font('Helvetica').fillColor('#999999');
      doc.text(`Account: ${client.taxId}    ${client.county} County`, 40, ph - 30);
      doc.text(`${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}    Page ${pageNum}`, pw / 2 - 40, ph - 30);
      doc.text('Confidential    Generated by OverAssessed.ai', pw - 220, ph - 30);
    }

    function drawCompPage(pageComps) {
      drawHeader();

      const startY = 140;
      const labelW = 140;
      const colW = (doc.page.width - 80 - labelW) / (pageComps.length + 1); // +1 for subject
      const startX = 40;

      // Row definitions
      const rows = [
        { label: 'Tax ID', subjVal: client.taxId, compKey: 'taxId' },
        { label: 'Address', subjVal: client.address, compKey: 'address' },
        { label: 'Market Value', subjVal: cur(client.marketValue), compKey: (c) => cur(c.marketValue) },
        { label: 'Distance (Miles)', subjVal: '-', compKey: (c) => s(c.distance) },
        { label: 'Property Class', subjVal: client.propertyClass, compKey: 'propClass' },
        { label: 'Condition', subjVal: client.condition, compKey: 'condition' },
        { label: 'Year Built (Effective)', subjVal: `${client.yearBuilt} (${client.effectiveYear})`, compKey: (c) => `${c.yearBuilt} (${c.effYear})` },
        { label: 'Main SQFT (PSF)', subjVal: `${client.mainSqft.toLocaleString()} (${cur(subjPSF.toFixed(2))})`, compKey: (c) => `${c.sqft.toLocaleString()} (${cur(c.psf.toFixed(2))})` },
        { label: 'Improvement Value', subjVal: cur(client.improvementValue), compKey: (c) => cur(c.imprValue) },
        { label: 'Feature Value', subjVal: cur(client.featureValue), compKey: (c) => cur(c.featureValue) },
        { label: 'Pool Value', subjVal: cur(client.poolValue), compKey: (c) => cur(c.poolValue) },
        { label: 'Land Value', subjVal: cur(client.landValue), compKey: (c) => cur(c.landValue) },
        { label: '', subjVal: '', compKey: () => '' }, // separator
        { label: 'Age Adjustment', subjVal: '-', compKey: (c) => `${cur(c.ageAdj)} (${pct(c.ageAdj / c.marketValue * 100)})`, isAdj: true },
        { label: 'Size Adjustment', subjVal: '-', compKey: (c) => `${cur(c.sizeAdj)} (${pct(c.sizeAdj / c.marketValue * 100)})`, isAdj: true },
        { label: 'Land Adjustment', subjVal: '-', compKey: (c) => `${cur(c.landAdj)} (${pct(c.landAdj / c.marketValue * 100)})`, isAdj: true },
        { label: 'Feature Adjustment', subjVal: '-', compKey: (c) => `${cur(c.featureAdj)} (${pct(c.featureAdj / c.marketValue * 100)})`, isAdj: true },
        { label: 'Pool Adjustment', subjVal: '-', compKey: (c) => `${cur(c.poolAdj)} (${pct(c.poolAdj / c.marketValue * 100)})`, isAdj: true },
        { label: 'Net Adjustment', subjVal: '-', compKey: (c) => `${cur(c.netAdj)} (${pct(c.netAdj / c.marketValue * 100)})`, isAdj: true, isBold: true },
        { label: '', subjVal: '', compKey: () => '' }, // separator
        { label: 'Total Adjusted Value', subjVal: '-', compKey: (c) => cur(c.totalAdjValue), isTotal: true },
      ];

      const rowH = 18;

      // Column headers
      let hx = startX;
      doc.rect(hx, startY, labelW, 22).fill('#ecf0f1');
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#2c3e50');
      doc.text('(CAD 2025)', hx + 4, startY + 6, { width: labelW - 8 });
      hx += labelW;

      // Subject header
      doc.rect(hx, startY, colW, 22).fill('#d5e8d4');
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#2c3e50');
      doc.text('SUBJECT', hx + 4, startY + 6, { width: colW - 8, align: 'center' });
      hx += colW;

      // Comp headers
      pageComps.forEach((comp, i) => {
        const isMedian = comp === compData[medianIdx];
        const bg = isMedian ? '#fff3cd' : '#e8eaf6';
        doc.rect(hx, startY, colW, 22).fill(bg);
        const label = isMedian ? 'MEDIAN COMP' : `COMP ${compData.indexOf(comp) + 1}`;
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#2c3e50');
        doc.text(label, hx + 4, startY + 6, { width: colW - 8, align: 'center' });
        hx += colW;
      });

      // Data rows
      let ry = startY + 22;
      rows.forEach((row, ri) => {
        if (row.label === '') { ry += 4; return; } // separator

        const bg = row.isAdj ? '#fafafa' : (ri % 2 === 0 ? '#ffffff' : '#f8f9fa');

        // Label
        doc.rect(startX, ry, labelW, rowH).fill(bg).stroke('#e0e0e0');
        const labelFont = row.isBold || row.isTotal ? 'Helvetica-Bold' : 'Helvetica';
        const labelSize = row.isTotal ? 8 : 7;
        doc.fontSize(labelSize).font(labelFont).fillColor('#333333');
        doc.text(row.label, startX + 4, ry + 4, { width: labelW - 8 });

        // Subject value
        let cx = startX + labelW;
        doc.rect(cx, ry, colW, rowH).fill(bg).stroke('#e0e0e0');
        doc.fontSize(7).font('Helvetica').fillColor('#333333');
        doc.text(s(row.subjVal), cx + 4, ry + 4, { width: colW - 8, align: 'center' });
        cx += colW;

        // Comp values
        pageComps.forEach(comp => {
          doc.rect(cx, ry, colW, rowH).fill(bg).stroke('#e0e0e0');
          let val;
          if (typeof row.compKey === 'function') {
            val = row.compKey(comp);
          } else {
            val = s(comp[row.compKey]);
          }
          const font = row.isTotal ? 'Helvetica-Bold' : 'Helvetica';
          const size = row.isTotal ? 9 : 7;
          const color = row.isTotal ? '#2e7d32' : '#333333';
          doc.fontSize(size).font(font).fillColor(color);
          doc.text(s(val), cx + 4, ry + 4, { width: colW - 8, align: 'center' });
          cx += colW;
        });

        ry += rowH;
      });
    }

    // Generate pages
    for (let i = 0; i < compData.length; i += compsPerPage) {
      if (i > 0) doc.addPage({ layout: 'landscape' });
      const pageComps = compData.slice(i, i + compsPerPage);
      drawCompPage(pageComps);
    }

    // Summary page
    doc.addPage({ layout: 'landscape' });
    drawHeader();

    doc.y = 145;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a1a2e');
    doc.text('Adjustment Formulas:', 40);
    doc.moveDown(0.3);
    doc.fontSize(8).font('Helvetica').fillColor('#555555');
    doc.text('• Appraised values reflect updated 2025 values, where available.');
    doc.text('• Size Adjustment: (Comp Impr PSF x (Subj Main Area - Comp Main Area) / 2)');
    doc.text('• Age Adjustment: (0.5 x (Subject EYOC - Comp EYOC) / 100) x Comp Market Value');
    doc.text('• Land Adjustment: (Comp Market Value - Comp Land Value + Subj Land Value) - Comp Market Value');
    doc.text('• Feature Adjustment: (Subj Feature Value - Comp Feature Value)');
    doc.text('• Pool Adjustment: (Subj Pool Value - Comp Pool Value)');
    doc.text('• Comps were selected using Property Class, Distance, Condition, Size, and Year Built.');
    doc.moveDown(1);

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a1a2e');
    doc.text('Data Sources:');
    doc.moveDown(0.3);
    doc.fontSize(8).font('Helvetica').fillColor('#555555');
    doc.text(`• ${client.county} County Appraisal District (2025 Certified Values)`);
    doc.text('• RentCast API (comparable sales and automated valuation model)');
    doc.text('• OverAssessed.ai property tax analysis engine');
    doc.moveDown(1);

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#2e7d32');
    doc.text(`INDICATED VALUE: ${cur(medianValue)} (Median of ${compData.length} adjusted comparables)`);
    doc.fontSize(9).font('Helvetica').fillColor('#cc0000');
    doc.text(`CURRENT CAD VALUE: ${cur(client.marketValue)}`);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a2e');
    const diff = client.marketValue - medianValue;
    doc.text(`PROPOSED REDUCTION: ${cur(diff)} (${(diff / client.marketValue * 100).toFixed(1)}%)`);

    doc.end();

    stream.on('finish', () => {
      console.log(`OK: ${filePath}`);
      resolve(filePath);
    });
    stream.on('error', reject);
  });
}

async function main() {
  console.log('=== GENERATING TAXNET-STYLE EQUAL & UNIFORM PDFS ===\n');
  for (const client of clients) {
    try {
      await generatePDF(client);
    } catch (err) {
      console.error(`FAIL: ${client.caseNum} — ${err.message}`);
      console.error(err.stack);
    }
  }
  console.log('\n=== COMPLETE ===');
}

main();
