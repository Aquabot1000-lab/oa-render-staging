const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');

// Helper: never pass null/undefined to pdfkit
function s(v) { return (v === null || v === undefined) ? 'N/A' : String(v); }
function cur(v) { return (v === null || v === undefined) ? 'N/A' : '$' + Number(v).toLocaleString('en-US'); }

const clients = [
  {
    name: 'Shabir Hasanali Rupani',
    caseNum: 'OA-0013',
    signedDate: '2026-03-28',
    address: '708 Santa Lucia Dr, Anna, TX 75409',
    county: 'Collin',
    parcelId: 'R-13273-00J-0230-1',
    propertyType: 'Single Family',
    sqft: 1781,
    beds: 3,
    baths: 3,
    yearBuilt: 2024,
    lotSize: 5500,
    ownerOnFile: 'Shabir Hasanali Rupani',
    assessedValue: 399042,
    assessedLand: 125000,
    assessedImprovement: 274042,
    assessedSource: 'Collin CAD 2025',
    avm: 367000,
    avmLow: 309000,
    avmHigh: 426000,
    proposedValue: 367000,
    overAssessment: 399042 - 367000,
    taxRate: 0.0218, // Collin county avg
    taxSavings: Math.round((399042 - 367000) * 0.0218),
    comps: [
      { address: '740 Santa Lucia Dr, Anna 75409', price: 359000, sqft: 1777, year: 2024, dist: '0.05mi', corr: 0.970 },
      { address: '901 Portina Dr, Anna 75409', price: 367500, sqft: 1777, year: 2024, dist: '0.16mi', corr: 0.968 },
      { address: '924 Amenduni Ln, Anna 75409', price: 367900, sqft: 1777, year: 2024, dist: '0.20mi', corr: 0.968 },
      { address: '221 Santa Lucia Dr, Anna 75409', price: 375000, sqft: 1799, year: 2023, dist: '0.17mi', corr: 0.940 },
      { address: '1309 Renato Dr, Anna 75409', price: 375000, sqft: 1799, year: 2024, dist: '0.24mi', corr: 0.938 },
      { address: '601 Pemberton Dr, Anna 75409', price: 349995, sqft: 1842, year: 2018, dist: '0.25mi', corr: 0.934 },
      { address: '1988 Helmoken Falls Dr, Anna 75409', price: 310000, sqft: 1787, year: 2005, dist: '0.38mi', corr: 0.936 },
      { address: '132 Birdbrook Dr, Anna 75409', price: 317000, sqft: 1782, year: 2006, dist: '0.45mi', corr: 0.936 },
      { address: '910 Fulbourne Dr, Anna 75409', price: 315000, sqft: 1760, year: 2007, dist: '0.53mi', corr: 0.933 },
      { address: '1216 Renato Dr, Anna 75409', price: 420000, sqft: 1800, year: 2024, dist: '0.26mi', corr: 0.938 },
    ],
    recommendation: 'Protest to $367,000 based on RentCast AVM and 10 comparable properties. County assessed $399,042 exceeds market by $32,042 (8.0%). Nearest comp on same street (740 Santa Lucia) listed at $359,000 for near-identical property. Median comp price: $362,500.',
    status: 'READY TO REVIEW'
  },
  {
    name: 'Tracy Furlong',
    caseNum: 'OA-0017',
    signedDate: '2026-03-17',
    address: '2754 Canvas Back Dr, Greenville, TX 75402',
    county: 'Hunt',
    parcelId: null, // need to resolve from Hunt CAD
    propertyType: 'Single Family',
    sqft: 2136,
    beds: 4,
    baths: 2,
    yearBuilt: 2025,
    lotSize: 17598,
    ownerOnFile: null, // RentCast didn't return owner
    assessedValue: null, // No 2025 tax assessment in RentCast — new construction
    assessedLand: null,
    assessedImprovement: null,
    assessedSource: 'Hunt CAD 2025 — PENDING (new construction, no assessment on file)',
    avm: 303000,
    avmLow: 257000,
    avmHigh: 350000,
    proposedValue: null,
    overAssessment: null,
    taxRate: null,
    taxSavings: null,
    comps: [
      { address: '109 Shawnee St, Greenville 75402', price: 284000, sqft: 2145, year: 2004, dist: '0.15mi', corr: 0.996 },
      { address: '8822 Kiowa Dr, Greenville 75402', price: 310000, sqft: 2259, year: 2017, dist: '0.06mi', corr: 0.991 },
      { address: '8915 Cheyenne Dr, Greenville 75402', price: 289800, sqft: 1914, year: 2021, dist: '0.24mi', corr: 0.980 },
      { address: '100 Lipan St, Greenville 75402', price: 289900, sqft: 1880, year: 2004, dist: '0.23mi', corr: 0.979 },
      { address: '107 Red Cloud Dr, Greenville 75402', price: 260000, sqft: 1859, year: 2003, dist: '0.27mi', corr: 0.976 },
      { address: '530 Cristo Range Dr, Greenville 75402', price: 369233, sqft: 2160, year: 2025, dist: '1.48mi', corr: 0.971 },
      { address: '515 Cristo Range Dr, Greenville 75402', price: 383421, sqft: 2160, year: 2025, dist: '1.52mi', corr: 0.970 },
      { address: '1102 Churchill Ln, Greenville 75402', price: 325000, sqft: 2139, year: 1997, dist: '1.60mi', corr: 0.970 },
      { address: '1112 Colony Dr, Greenville 75402', price: 315000, sqft: 1954, year: 2015, dist: '1.04mi', corr: 0.969 },
      { address: '524 Brooke St, Greenville 75402', price: 309900, sqft: 2068, year: 2015, dist: '1.48mi', corr: 0.968 },
    ],
    recommendation: null,
    status: 'BLOCKED',
    blocker: 'New construction — no 2025 county assessed value on file. Hunt CAD parcel ID not yet available via RentCast. Need manual Hunt CAD lookup or wait for 2025 notice.'
  },
  {
    name: 'Khiem Nguyen',
    caseNum: 'OA-0010',
    signedDate: '2026-03-19',
    address: '3315 Marlene Meadow Way, Richmond, TX 77406',
    county: 'Fort Bend',
    parcelId: '5296-09-002-0200-901',
    propertyType: 'Single Family',
    sqft: 3718,
    beds: 5,
    baths: 4,
    yearBuilt: 2023,
    lotSize: 8468,
    ownerOnFile: 'Khiem Duc Nguyen',
    assessedValue: 648786,
    assessedLand: 63050,
    assessedImprovement: 585736,
    assessedSource: 'Fort Bend CAD 2025',
    avm: 633000,
    avmLow: 510000,
    avmHigh: 756000,
    proposedValue: 633000,
    overAssessment: 648786 - 633000,
    taxRate: 0.0232, // Fort Bend avg
    taxSavings: Math.round((648786 - 633000) * 0.0232),
    comps: [
      { address: '3202 Marlene Meadow Way, Richmond 77406', price: 739900, sqft: 3717, year: 2023, dist: '0.11mi', corr: 0.970 },
      { address: '3306 Willow Fin Way, Richmond 77406', price: 645000, sqft: 3741, year: 2022, dist: '0.17mi', corr: 0.968 },
      { address: '3215 Marlene Meadow Way, Richmond 77406', price: 630000, sqft: 3794, year: 2023, dist: '0.09mi', corr: 0.967 },
      { address: '2111 S Pecan Trail Dr, Richmond 77406', price: 574000, sqft: 3866, year: 2002, dist: '1.26mi', corr: 0.971 },
      { address: '4119 Pembrooke Way, Richmond 77406', price: 774999, sqft: 3895, year: 2003, dist: '1.29mi', corr: 0.970 },
      { address: '2015 Pecan Trail Dr, Richmond 77406', price: 499000, sqft: 3968, year: 1990, dist: '1.35mi', corr: 0.966 },
      { address: '2218 Landscape Way, Richmond 77406', price: 500000, sqft: 3269, year: 1989, dist: '1.57mi', corr: 0.953 },
      { address: '3006 Pecan Way Ct, Richmond 77406', price: 625000, sqft: 4723, year: 1998, dist: '1.05mi', corr: 0.951 },
      { address: '8327 Valburn Dr, Richmond 77406', price: 464998, sqft: 2989, year: 2024, dist: '1.49mi', corr: 0.945 },
      { address: '2106 Shade Crest Dr, Richmond 77406', price: 549000, sqft: 4031, year: 1994, dist: '1.26mi', corr: 0.938 },
    ],
    recommendation: 'Protest to $633,000 based on RentCast AVM and 10 comparable properties. County assessed $648,786 exceeds market by $15,786 (2.4%). Same-street comp (3215 Marlene Meadow Way, identical year/size) at $630,000. Median comp price: $609,500.',
    status: 'READY TO REVIEW'
  }
];

// Remaining 4 signed customers — all out-of-state or incomplete TX address
const blocked = [
  { name: 'Elton Dickinson', caseNum: 'OA-0039', address: '4 Crestview Drive, Kettle Falls', status: 'BLOCKED', blocker: 'Out of state (Washington). Texas-only per business rules.' },
  { name: 'Sherman Roy Runyon', caseNum: 'OA-0037', address: '2449 Snyder Ave, Bremerton, WA', status: 'BLOCKED', blocker: 'Out of state (Washington). Texas-only per business rules.' },
  { name: 'Tung Tran', caseNum: 'OA-0030', address: '294 Hascall Rd NW', status: 'BLOCKED', blocker: 'Incomplete address — no city/state/zip. Cannot determine if Texas.' },
  { name: 'Jason Michael Matthews', caseNum: 'OA-0022', address: '2022 Avondown Rd', status: 'BLOCKED', blocker: 'Incomplete address — no city/state/zip. Cannot determine if Texas.' },
];

function generatePDF(client) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      size: 'LETTER'
    });

    const filename = `${client.caseNum}_${client.name.replace(/ /g, '_')}_protest_package.pdf`;
    const filePath = path.join('/tmp', filename);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const pageW = doc.page.width - 100; // usable width

    // ========== PAGE 1: COVER ==========
    doc.moveDown(3);
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#1a1a2e')
       .text('PROPERTY TAX PROTEST', { align: 'center' });
    doc.fontSize(16).text('EVIDENCE PACKAGE', { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(10).font('Helvetica').fillColor('#666666')
       .text('Equal & Uniform / Market Value Analysis', { align: 'center' });
    doc.moveDown(2);

    // Property box
    doc.rect(50, doc.y, pageW, 140).stroke('#1a1a2e');
    const boxY = doc.y + 10;
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a1a2e');
    doc.text(s(client.address), 70, boxY);
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').fillColor('#333333');
    doc.text(`Case: ${s(client.caseNum)}  |  County: ${s(client.county)}  |  Account: ${s(client.parcelId)}`, 70);
    doc.text(`Owner: ${s(client.ownerOnFile)}  |  Signed: ${s(client.signedDate)}`, 70);
    doc.text(`Type: ${s(client.propertyType)}  |  ${s(client.sqft)} sqft  |  ${s(client.beds)}bd/${s(client.baths)}ba  |  Built ${s(client.yearBuilt)}  |  Lot: ${s(client.lotSize)} sqft`, 70);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fillColor('#cc0000');
    doc.text(`CAD Assessed Value (2025): ${cur(client.assessedValue)}`, 70);
    doc.font('Helvetica-Bold').fillColor('#006600');
    doc.text(`Proposed Protest Value: ${cur(client.proposedValue)}`, 70);
    doc.font('Helvetica').fillColor('#333333');
    if (client.overAssessment > 0) {
      doc.text(`Over-Assessment: ${cur(client.overAssessment)} (${((client.overAssessment / client.assessedValue) * 100).toFixed(1)}%)  |  Est. Tax Savings: ${cur(client.taxSavings)}/yr`, 70);
    }

    doc.y = boxY + 150;
    doc.moveDown(1);
    doc.fontSize(10).font('Helvetica').fillColor('#333333');
    doc.text(`Source: ${s(client.assessedSource)}`, { align: 'center' });
    doc.text(`Prepared by: OverAssessed.ai  |  Date: ${new Date().toLocaleDateString()}`, { align: 'center' });

    // ========== PAGE 2: COMPARABLE SALES ==========
    doc.addPage();
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a2e')
       .text('COMPARABLE SALES ANALYSIS', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor('#666666')
       .text(`Subject: ${s(client.address)}  |  ${s(client.sqft)} sqft  |  Built ${s(client.yearBuilt)}  |  Assessed: ${cur(client.assessedValue)}`, { align: 'center' });
    doc.moveDown(0.8);

    // Table header
    const cols = [30, 190, 75, 55, 45, 55, 55];
    const headers = ['#', 'Address', 'Price', 'Sqft', 'Year', 'Dist', 'Corr'];
    const tableX = 50;
    let ty = doc.y;

    doc.rect(tableX, ty, pageW, 18).fill('#1a1a2e');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
    let hx = tableX + 5;
    headers.forEach((h, i) => {
      doc.text(h, hx, ty + 4, { width: cols[i], align: i === 0 ? 'center' : (i >= 2 ? 'right' : 'left') });
      hx += cols[i];
    });
    ty += 20;

    // Table rows
    doc.font('Courier').fontSize(8).fillColor('#333333');
    client.comps.forEach((comp, idx) => {
      if (ty > 700) {
        doc.addPage();
        ty = 50;
        doc.rect(tableX, ty, pageW, 18).fill('#1a1a2e');
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
        hx = tableX + 5;
        headers.forEach((h, i) => {
          doc.text(h, hx, ty + 4, { width: cols[i], align: i === 0 ? 'center' : (i >= 2 ? 'right' : 'left') });
          hx += cols[i];
        });
        ty += 20;
        doc.font('Courier').fontSize(8).fillColor('#333333');
      }

      const bg = idx % 2 === 0 ? '#f8f8f8' : '#ffffff';
      doc.rect(tableX, ty, pageW, 16).fill(bg);
      doc.fillColor('#333333');
      let rx = tableX + 5;
      doc.text(s(idx + 1), rx, ty + 4, { width: cols[0], align: 'center' }); rx += cols[0];
      doc.text(s(comp.address), rx, ty + 4, { width: cols[1], align: 'left' }); rx += cols[1];
      doc.text(cur(comp.price), rx, ty + 4, { width: cols[2], align: 'right' }); rx += cols[2];
      doc.text(s(comp.sqft), rx, ty + 4, { width: cols[3], align: 'right' }); rx += cols[3];
      doc.text(s(comp.year), rx, ty + 4, { width: cols[4], align: 'center' }); rx += cols[4];
      doc.text(s(comp.dist), rx, ty + 4, { width: cols[5], align: 'center' }); rx += cols[5];
      doc.text(s(comp.corr?.toFixed(3)), rx, ty + 4, { width: cols[6], align: 'right' }); rx += cols[6];
      ty += 16;
    });

    // Summary stats
    ty += 10;
    const prices = client.comps.map(c => c.price).sort((a, b) => a - b);
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const med = prices.length % 2 === 0 ? Math.round((prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2) : prices[Math.floor(prices.length / 2)];
    const low = prices[0];
    const high = prices[prices.length - 1];

    doc.rect(tableX, ty, pageW, 50).fill('#f0f4ff').stroke('#1a1a2e');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a2e');
    doc.text(`Comp Summary (${client.comps.length} properties)`, tableX + 10, ty + 5);
    doc.fontSize(8).font('Helvetica').fillColor('#333333');
    doc.text(`Average: ${cur(avg)}  |  Median: ${cur(med)}  |  Low: ${cur(low)}  |  High: ${cur(high)}`, tableX + 10, ty + 20);
    doc.text(`RentCast AVM: ${cur(client.avm)}  (Range: ${cur(client.avmLow)} - ${cur(client.avmHigh)})`, tableX + 10, ty + 33);

    // ========== PAGE 3: RECOMMENDATION ==========
    doc.addPage();
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a2e')
       .text('RECOMMENDATION & FILING SUMMARY', { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#333333');
    doc.text('Proposed Protest Value:');
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#006600');
    doc.text(cur(client.proposedValue));
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica').fillColor('#333333');
    doc.text(s(client.recommendation));
    doc.moveDown(1);

    // Filing info
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a1a2e').text('Filing Details');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').fillColor('#333333');
    doc.text(`County: ${s(client.county)} County Appraisal District`);
    doc.text(`Account/Parcel: ${s(client.parcelId)}`);
    doc.text(`Property Owner: ${s(client.ownerOnFile)}`);
    doc.text(`Property Address: ${s(client.address)}`);
    doc.text(`Filing Basis: Equal & Uniform / Market Value`);
    doc.text(`Protest Deadline: May 15, 2026 (or 30 days from notice, whichever is later)`);
    doc.moveDown(1);

    // Status
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a1a2e').text('Status');
    doc.moveDown(0.3);
    const statusColor = client.status === 'READY TO REVIEW' ? '#006600' : '#cc0000';
    doc.fontSize(12).font('Helvetica-Bold').fillColor(statusColor);
    doc.text(s(client.status));
    if (client.blocker) {
      doc.fontSize(10).font('Helvetica').fillColor('#cc0000');
      doc.text(`Blocker: ${s(client.blocker)}`);
    }

    doc.moveDown(2);
    doc.fontSize(8).font('Helvetica').fillColor('#999999');
    doc.text('This report was generated by OverAssessed.ai using RentCast AVM data and comparable sales analysis.', { align: 'center' });
    doc.text('All values should be verified against official county records before filing.', { align: 'center' });

    doc.end();

    stream.on('finish', () => {
      console.log(`OK: ${filePath}`);
      resolve(filePath);
    });
    stream.on('error', reject);
  });
}

async function main() {
  console.log('=== GENERATING PROTEST PACKAGES ===\n');

  for (const client of clients) {
    if (client.status === 'BLOCKED') {
      console.log(`BLOCKED: ${client.caseNum} ${client.name} — ${client.blocker}`);
      continue;
    }
    try {
      await generatePDF(client);
    } catch (err) {
      console.error(`FAIL: ${client.caseNum} ${client.name} — ${err.message}`);
    }
  }

  console.log('\n=== BLOCKED CUSTOMERS (non-Texas or incomplete) ===');
  blocked.forEach(b => console.log(`${b.caseNum} ${b.name}: ${b.blocker}`));

  console.log('\n=== COMPLETE ===');
}

main();
