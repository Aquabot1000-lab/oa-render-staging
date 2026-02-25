#!/usr/bin/env node
// Generate test protest packets for all 6 counties
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/test-run-results.json'), 'utf8'));
const reportsDir = path.join(__dirname, '../reports');
fs.mkdirSync(reportsDir, { recursive: true });

const PURPLE = '#6c5ce7';
const BLUE = '#0984e3';
const DARK = '#2d3436';
const GRAY = '#636e72';
const LIGHT_GRAY = '#dfe6e9';

// County-specific filing info
const filingInfo = {
  'Bexar': {
    district: 'Bexar County Appraisal District (BCAD)',
    website: 'www.bcad.org',
    portal: 'bcad.org/online-portal/',
    form: 'TX Form 50-162 (Appointment of Agent)',
    protestForm: 'Online via BCAD portal or Form 50-132',
    deadline: 'May 15, 2026 (or 30 days after notice)',
    method: 'Online (BCAD Portal), Mail, In-Person',
    hearingFormat: 'In-person, phone, or written (100% digital option available)'
  },
  'Harris': {
    district: 'Harris County Appraisal District (HCAD)',
    website: 'www.hcad.org',
    portal: 'owners.hcad.org (iFile system)',
    form: 'TX Form 50-162 (Appointment of Agent)',
    protestForm: 'Online via iFile or Form 50-132',
    deadline: 'May 15, 2026 (or 30 days after notice)',
    method: 'Online (iFile), Mail, In-Person',
    hearingFormat: 'In-person, phone, iSettle (online settlement), or ARB hearing'
  },
  'Travis': {
    district: 'Travis Central Appraisal District (TCAD)',
    website: 'www.traviscad.org',
    portal: 'traviscad.org/efile/',
    form: 'TX Form 50-162 (Appointment of Agent)',
    protestForm: 'Online via TCAD E-File or Form 50-132',
    deadline: 'May 15, 2026 (or 30 days after notice)',
    method: 'Online (E-File Portal), Mail, In-Person',
    hearingFormat: 'Online portal meetings, in-person, phone, or written'
  },
  'Dallas': {
    district: 'Dallas Central Appraisal District (DCAD)',
    website: 'www.dallascad.org',
    portal: 'dallascad.org (uFile Online Protest)',
    form: 'TX Form 50-162 (Appointment of Agent)',
    protestForm: 'Online via uFile or Form 50-132',
    deadline: 'May 15, 2026 (or 30 days after notice)',
    method: 'Online (uFile), Mail, In-Person',
    hearingFormat: 'In-person, phone, or written submission'
  },
  'Tarrant': {
    district: 'Tarrant Appraisal District (TAD)',
    website: 'www.tad.org',
    portal: 'tad.org/login (Online Protest & Value Negotiation)',
    form: 'TX Form 50-162 (Appointment of Agent)',
    protestForm: 'Online via TAD portal or Form 50-132',
    deadline: 'May 15, 2026 (or 30 days after notice)',
    method: 'Online (TAD Portal), Mail, In-Person',
    hearingFormat: 'In-person, phone, online value negotiation, or ARB hearing'
  },
  'Fulton': {
    district: 'Fulton County Board of Assessors',
    website: 'www.fultonassessor.org',
    portal: 'fultonassessor.org/property-appeals/',
    form: 'Fulton County Appeal Form (PT-311A)',
    protestForm: 'Online, mail, or in-person appeal form',
    deadline: '45 days from date of assessment notice (typically July-August)',
    method: 'Online (fultonassessor.org), Mail, In-Person at 5 locations',
    hearingFormat: 'Board of Equalization hearing (in-person) or Hearing Officer'
  }
};

function generatePacket(prop) {
  const county = prop.county;
  const filing = filingInfo[county];
  const filename = `test-run-${county.toLowerCase()}.pdf`;
  const filepath = path.join(reportsDir, filename);

  const doc = new PDFDocument({ size: 'letter', margins: { top: 50, bottom: 50, left: 60, right: 60 } });
  doc.pipe(fs.createWriteStream(filepath));

  // === COVER PAGE ===
  doc.rect(0, 0, 612, 792).fill(PURPLE);

  // Logo area
  doc.fontSize(48).fill('white').font('Helvetica-Bold')
    .text('OverAssessed', 0, 200, { align: 'center' });
  doc.fontSize(18).fill('white').font('Helvetica')
    .text('Property Tax Protest Evidence Packet', 0, 270, { align: 'center' });

  doc.moveDown(3);
  doc.fontSize(14).fill('white')
    .text(`${prop.address}`, 0, 380, { align: 'center' });
  doc.fontSize(12)
    .text(`${prop.county} County, ${prop.state}`, 0, 410, { align: 'center' });
  doc.text(`Generated: February 24, 2026`, 0, 440, { align: 'center' });

  doc.rect(206, 500, 200, 3).fill(BLUE);
  doc.fontSize(10).fill('rgba(255,255,255,0.7)')
    .text('CONFIDENTIAL — Prepared for Property Tax Protest', 0, 720, { align: 'center' });

  // === PAGE 2: PROPERTY DETAILS & VALUATION ===
  doc.addPage();

  // Header bar
  doc.rect(0, 0, 612, 60).fill(PURPLE);
  doc.fontSize(18).fill('white').font('Helvetica-Bold')
    .text('Property Details & Market Value Analysis', 60, 20);

  let y = 80;
  doc.fill(DARK).font('Helvetica-Bold').fontSize(14)
    .text('Subject Property', 60, y);
  y += 25;

  doc.font('Helvetica').fontSize(11).fill(GRAY);
  const details = [
    ['Address', prop.address],
    ['County', `${prop.county} County, ${prop.state}`],
    ['Bedrooms', prop.beds || 'N/A'],
    ['Bathrooms', prop.baths || 'N/A'],
    ['Square Footage', prop.sqft ? prop.sqft.toLocaleString() + ' sq ft' : 'N/A'],
    ['Year Built', prop.yearBuilt || 'N/A'],
  ];

  for (const [label, value] of details) {
    doc.font('Helvetica-Bold').fill(DARK).text(label + ':', 60, y, { continued: true });
    doc.font('Helvetica').fill(GRAY).text('  ' + value);
    y += 18;
  }

  y += 20;
  doc.rect(60, y, 492, 2).fill(BLUE);
  y += 15;

  // Valuation box
  doc.rect(60, y, 492, 100).lineWidth(2).stroke(PURPLE);
  doc.font('Helvetica-Bold').fontSize(14).fill(PURPLE)
    .text('RentCast AVM Valuation', 80, y + 10);
  doc.font('Helvetica-Bold').fontSize(28).fill(DARK)
    .text('$' + prop.avmValue.toLocaleString(), 80, y + 35);
  doc.font('Helvetica').fontSize(10).fill(GRAY)
    .text(`Range: $${prop.rangeLow.toLocaleString()} — $${prop.rangeHigh.toLocaleString()}`, 80, y + 70);
  doc.font('Helvetica').fontSize(10).fill(GRAY)
    .text(`Based on ${prop.compCount} comparable properties`, 300, y + 70);
  y += 120;

  // Simulated assessed value (10-20% higher than AVM for demo)
  const assessedValue = Math.round(prop.avmValue * 1.15);
  const savings = assessedValue - prop.avmValue;

  y += 10;
  doc.font('Helvetica-Bold').fontSize(14).fill(DARK)
    .text('Protest Argument Summary', 60, y);
  y += 25;

  const summaryItems = [
    ['Current Assessed Value (est.)', '$' + assessedValue.toLocaleString()],
    ['RentCast Market Value (AVM)', '$' + prop.avmValue.toLocaleString()],
    ['Recommended Protest Value', '$' + prop.rangeLow.toLocaleString()],
    ['Potential Reduction', '$' + savings.toLocaleString() + ' (' + Math.round(savings/assessedValue*100) + '%)'],
  ];

  for (const [label, value] of summaryItems) {
    doc.font('Helvetica').fontSize(11).fill(GRAY).text(label + ':', 60, y, { continued: true });
    doc.font('Helvetica-Bold').fill(DARK).text('  ' + value);
    y += 20;
  }

  y += 15;
  doc.font('Helvetica').fontSize(10).fill(GRAY)
    .text('The market value determined by RentCast\'s Automated Valuation Model (AVM) uses ' +
      'recent comparable sales, property characteristics, and market trends to arrive at a ' +
      'fair market value estimate. The assessed value exceeds this market-based estimate, ' +
      'supporting a reduction in the appraised value.', 60, y, { width: 492 });

  // === PAGE 3: COMPARABLES TABLE ===
  doc.addPage();
  doc.rect(0, 0, 612, 60).fill(BLUE);
  doc.fontSize(18).fill('white').font('Helvetica-Bold')
    .text('Comparable Properties Analysis', 60, 20);

  y = 80;
  doc.font('Helvetica-Bold').fontSize(12).fill(DARK)
    .text(`Top ${prop.topComps.length} Comparables — Ranked by Correlation Score`, 60, y);
  y += 25;

  // Table header
  const cols = [60, 220, 290, 340, 390, 450, 510];
  const headers = ['Address', 'Price', 'Sq Ft', 'Beds', 'Baths', 'Year', 'Score'];
  doc.rect(55, y - 5, 502, 20).fill(PURPLE);
  doc.font('Helvetica-Bold').fontSize(8).fill('white');
  headers.forEach((h, i) => doc.text(h, cols[i], y, { width: 60 }));
  y += 20;

  doc.font('Helvetica').fontSize(7.5).fill(DARK);
  prop.topComps.forEach((comp, idx) => {
    if (idx % 2 === 0) doc.rect(55, y - 3, 502, 30).fill('#f5f6fa');
    doc.fill(DARK);
    const shortAddr = comp.address.split(',')[0];
    doc.text(shortAddr, cols[0], y, { width: 155 });
    doc.text('$' + comp.price.toLocaleString(), cols[1], y, { width: 65 });
    doc.text(comp.sqft ? comp.sqft.toLocaleString() : 'N/A', cols[2], y, { width: 45 });
    doc.text(String(comp.beds || 'N/A'), cols[3], y, { width: 40 });
    doc.text(String(comp.baths || 'N/A'), cols[4], y, { width: 50 });
    doc.text(String(comp.yearBuilt || 'N/A'), cols[5], y, { width: 50 });
    doc.fill(PURPLE).text(comp.correlation.toFixed(4), cols[6], y, { width: 50 });
    y += 30;
  });

  y += 20;
  doc.font('Helvetica').fontSize(9).fill(GRAY)
    .text('Correlation scores range from 0 to 1, where 1.0 indicates a perfect match. ' +
      'Higher scores indicate greater similarity to the subject property in terms of ' +
      'location, size, age, and condition. All comparables are within close proximity ' +
      'to the subject property.', 60, y, { width: 492 });

  // === PAGE 4: MARKET VALUE ARGUMENT ===
  doc.addPage();
  doc.rect(0, 0, 612, 60).fill(PURPLE);
  doc.fontSize(18).fill('white').font('Helvetica-Bold')
    .text('Market Value Argument', 60, 20);

  y = 80;
  doc.font('Helvetica-Bold').fontSize(14).fill(DARK)
    .text('Evidence Supporting Value Reduction', 60, y);
  y += 30;

  const avgCompPrice = Math.round(prop.topComps.reduce((sum, c) => sum + c.price, 0) / prop.topComps.length);

  doc.font('Helvetica').fontSize(11).fill(DARK);
  const arguments_ = [
    `1. AUTOMATED VALUATION MODEL (AVM): The RentCast AVM, using current market data and ${prop.compCount} comparable properties, estimates the fair market value at $${prop.avmValue.toLocaleString()}.`,
    `2. COMPARABLE SALES: The average price of the top 5 most correlated comparable properties is $${avgCompPrice.toLocaleString()}, which ${avgCompPrice < assessedValue ? 'is below' : 'supports'} the current assessed value.`,
    `3. VALUE RANGE: The AVM confidence range of $${prop.rangeLow.toLocaleString()} to $${prop.rangeHigh.toLocaleString()} suggests the assessed value of $${assessedValue.toLocaleString()} may exceed fair market value.`,
    `4. MARKET CONDITIONS: Current market conditions in ${prop.city}, ${prop.state} show stabilizing or declining values in many neighborhoods, with extended days on market for comparable listings.`,
    `5. RECOMMENDED VALUE: Based on the evidence presented, we recommend a protest value of $${prop.rangeLow.toLocaleString()}, representing the conservative low end of the AVM range.`,
  ];

  for (const arg of arguments_) {
    doc.text(arg, 60, y, { width: 492 });
    y += doc.heightOfString(arg, { width: 492 }) + 12;
  }

  y += 20;
  doc.rect(60, y, 492, 60).lineWidth(1).stroke(BLUE);
  doc.font('Helvetica-Bold').fontSize(12).fill(BLUE)
    .text('Recommended Protest Value: $' + prop.rangeLow.toLocaleString(), 80, y + 10);
  doc.font('Helvetica').fontSize(10).fill(GRAY)
    .text(`Potential savings: $${(assessedValue - prop.rangeLow).toLocaleString()} reduction from assessed value`, 80, y + 35);

  // === PAGE 5: COUNTY FILING INFO ===
  doc.addPage();
  doc.rect(0, 0, 612, 60).fill(BLUE);
  doc.fontSize(18).fill('white').font('Helvetica-Bold')
    .text(`${county} County — Filing Information`, 60, 20);

  y = 80;
  const infoItems = [
    ['Appraisal District', filing.district],
    ['Website', filing.website],
    ['Online Portal', filing.portal],
    ['Agent Authorization Form', filing.form],
    ['Protest Form', filing.protestForm],
    ['Filing Deadline', filing.deadline],
    ['Filing Methods', filing.method],
    ['Hearing Format', filing.hearingFormat],
  ];

  for (const [label, value] of infoItems) {
    doc.font('Helvetica-Bold').fontSize(11).fill(PURPLE).text(label, 60, y);
    y += 16;
    doc.font('Helvetica').fontSize(10).fill(DARK).text(value, 60, y, { width: 492 });
    y += doc.heightOfString(value, { width: 492 }) + 12;
  }

  y += 10;
  doc.rect(60, y, 492, 2).fill(PURPLE);
  y += 15;

  doc.font('Helvetica-Bold').fontSize(12).fill(DARK).text('Next Steps', 60, y);
  y += 20;
  const steps = county === 'Fulton' ? [
    '1. Complete Fulton County Appeal Form (PT-311A)',
    '2. Attach this evidence packet with comparable sales data',
    '3. Submit online at fultonassessor.org or deliver to assessor office',
    '4. File within 45 days of receiving assessment notice',
    '5. Attend Board of Equalization hearing if scheduled',
  ] : [
    '1. File Form 50-162 (Appointment of Agent) with the appraisal district',
    '2. Submit protest online or via Form 50-132 before May 15, 2026',
    '3. Upload this evidence packet to the online portal',
    '4. Attend informal hearing (phone or in-person)',
    '5. If unresolved, proceed to ARB formal hearing',
  ];

  doc.font('Helvetica').fontSize(10).fill(DARK);
  for (const step of steps) {
    doc.text(step, 60, y, { width: 492 });
    y += 18;
  }

  // Footer
  y += 30;
  doc.rect(60, y, 492, 1).fill(LIGHT_GRAY);
  y += 10;
  doc.font('Helvetica').fontSize(8).fill(GRAY)
    .text('This report was generated by OverAssessed using RentCast AVM data. ' +
      'Values are estimates and should be verified. This document is intended for ' +
      'use in property tax protest proceedings.', 60, y, { width: 492 });

  doc.end();
  console.log(`✅ Generated: ${filename}`);
}

// Generate all 6 packets
for (const prop of data.properties) {
  generatePacket(prop);
}
console.log('\n🎉 All test packets generated in /reports/');
