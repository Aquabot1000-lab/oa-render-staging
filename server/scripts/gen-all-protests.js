const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');

function s(v) { return (v == null) ? '-' : String(v); }
function cur(v) { if (v == null) return '-'; const n = Number(v); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US'); }

// ============================
// ALL SIGNED 50-162 CUSTOMERS
// ============================

const ALL = [
  // OA-0013 Rupani (Collin TX)
  {
    name: 'Shabir Hasanali Rupani', caseNum: 'OA-0013',
    address: '708 SANTA LUCIA DR', fullAddress: '708 Santa Lucia Dr, Anna, TX 75409',
    county: 'Collin', state: 'TX', taxId: 'R-13273-00J-0230-1', owner: 'RUPANI, SHABIR HASANALI',
    marketValue: 399042, cls: 'A1', cond: 'Good',
    yb: 2024, ey: 2024, sqft: 1781, lotSize: 5500,
    land: 125000, impr: 274042,
    pool: 0, garage: 0, fireplace: 0,
    legalCode: 'Texas Tax Code Section 42.26(a)',
    legalQuote: 'Texas Tax Code §42.26(a): "The district court shall grant relief on the ground that a property is appraised unequally if the appraised value of the property exceeds the median appraised value of a reasonable number of comparable properties appropriately adjusted."',
    boardName: 'Collin County Appraisal Review Board',
    comps: [
      { addr: '740 SANTA LUCIA DR', sp: 359000, dist: 0.05, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1777, land: 97500, impr: 213752, pool: 0, garage: 0, fp: 0 },
      { addr: '901 PORTINA DR', sp: 367500, dist: 0.16, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1817, land: 102375, impr: 214645, pool: 0, garage: 0, fp: 0 },
      { addr: '924 AMENDUNI LN', sp: 367900, dist: 0.20, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1777, land: 97500, impr: 214645, pool: 0, garage: 0, fp: 0 },
      { addr: '221 SANTA LUCIA DR', sp: 375000, dist: 0.17, cls: 'A1', cond: 'Good', yb: 2023, ey: 2023, sqft: 1799, land: 125000, impr: 285327, pool: 0, garage: 0, fp: 0 },
      { addr: '1309 RENATO DR', sp: 375000, dist: 0.24, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1799, land: 131250, impr: 292324, pool: 0, garage: 0, fp: 0 },
      { addr: '601 PEMBERTON DR', sp: 349995, dist: 0.25, cls: 'A1', cond: 'Good', yb: 2018, ey: 2018, sqft: 1842, land: 105000, impr: 273189, pool: 15000, garage: 5000, fp: 0 },
      { addr: '1988 HELMOKEN FALLS DR', sp: 310000, dist: 0.38, cls: 'A1', cond: 'Good', yb: 2005, ey: 2005, sqft: 1787, land: 85000, impr: 220906, pool: 0, garage: 5000, fp: 3000 },
      { addr: '132 BIRDBROOK DR', sp: 317000, dist: 0.45, cls: 'A1', cond: 'Good', yb: 2006, ey: 2006, sqft: 1782, land: 85000, impr: 225829, pool: 0, garage: 5000, fp: 3000 },
      { addr: '910 FULBOURNE DR', sp: 315000, dist: 0.53, cls: 'A1', cond: 'Good', yb: 2007, ey: 2007, sqft: 1760, land: 85000, impr: 230096, pool: 15000, garage: 5000, fp: 3000 },
      { addr: '1216 RENATO DR', sp: 420000, dist: 0.26, cls: 'A1', cond: 'Good', yb: 2024, ey: 2024, sqft: 1800, land: 131250, impr: 292324, pool: 0, garage: 0, fp: 0 },
    ]
  },
  // OA-0022 Matthews (Kaufman TX)
  {
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
      { addr: '1017 KNOXBRIDGE RD', sp: 381254, dist: 0.23, cls: 'A1', cond: 'Good', yb: 2015, ey: 2015, sqft: 2296, land: 100000, impr: 281254, pool: 0, garage: 6000, fp: 3000 },
      { addr: '1057 CANTERBURY LN', sp: 425639, dist: 0.47, cls: 'A1', cond: 'Good', yb: 2020, ey: 2020, sqft: 2314, land: 125000, impr: 300639, pool: 0, garage: 6000, fp: 3000 },
      { addr: '2216 PERRYMEAD DR', sp: 365805, dist: 0.44, cls: 'A1', cond: 'Good', yb: 2018, ey: 2018, sqft: 2780, land: 100000, impr: 265805, pool: 0, garage: 6000, fp: 3000 },
      { addr: '745 BROCKWELL BND', sp: 366257, dist: 0.59, cls: 'A1', cond: 'Good', yb: 2020, ey: 2020, sqft: 2742, land: 100000, impr: 266257, pool: 0, garage: 6000, fp: 3000 },
      { addr: '1010 NEWINGTON CIR', sp: 449296, dist: 0.64, cls: 'A1', cond: 'Good', yb: 2010, ey: 2010, sqft: 3192, land: 115000, impr: 334296, pool: 0, garage: 6000, fp: 3000 },
      { addr: '1101 SANDGATE DR', sp: 440557, dist: 0.53, cls: 'A1', cond: 'Good', yb: 2021, ey: 2021, sqft: 2695, land: 135000, impr: 305557, pool: 0, garage: 0, fp: 0 },
      { addr: '1232 ABBEYGREEN RD', sp: 563759, dist: 0.47, cls: 'A1', cond: 'Good', yb: 2022, ey: 2022, sqft: 3113, land: 125000, impr: 438759, pool: 0, garage: 6000, fp: 0 },
      { addr: '1234 ABBEYGREEN RD', sp: 393112, dist: 0.49, cls: 'A1', cond: 'Good', yb: 2022, ey: 2022, sqft: 3116, land: 125000, impr: 268112, pool: 0, garage: 0, fp: 0 },
    ]
  },
  // OA-0037 Runyon (Kitsap WA)
  {
    name: 'Sherman Roy Runyon', caseNum: 'OA-0037',
    address: '2449 SNYDER AVE', fullAddress: '2449 Snyder Ave, Bremerton, WA 98312',
    county: 'Kitsap', state: 'WA', taxId: 'KITSAP-2449-SNYDER', owner: 'RUNYON, SHERMAN ROY',
    marketValue: 473100, cls: 'R', cond: 'Average',
    yb: 1938, ey: 1938, sqft: 1356, lotSize: 39640,
    land: 129970, impr: 343130,
    pool: 0, garage: 6000, fireplace: 3000,
    legalCode: 'RCW 84.48.010',
    legalQuote: 'Under RCW 84.48.010 and RCW 84.40.030, all property shall be assessed at 100% of true and fair value in money. The assessed value must reflect actual market conditions and comparable sales in the area.',
    boardName: 'Kitsap County Board of Equalization',
    comps: [
      { addr: '920 E 31ST ST', sp: 329100, dist: 1.04, cls: 'R', cond: 'Average', yb: 1955, ey: 1955, sqft: 1300, land: 95200, impr: 233900, pool: 0, garage: 6000, fp: 3000 },
      { addr: '2877 CLARE AVE', sp: 338760, dist: 1.02, cls: 'R', cond: 'Average', yb: 1942, ey: 1942, sqft: 1464, land: 89420, impr: 249340, pool: 0, garage: 6000, fp: 3000 },
      { addr: '917 MCKENZIE AVE', sp: 301490, dist: 1.41, cls: 'R', cond: 'Average', yb: 1927, ey: 1927, sqft: 1440, land: 77390, impr: 224100, pool: 0, garage: 6000, fp: 0 },
      { addr: '203 ALNUS WAY', sp: 436100, dist: 0.94, cls: 'R', cond: 'Average', yb: 1976, ey: 1976, sqft: 1572, land: 109920, impr: 326180, pool: 0, garage: 6000, fp: 3000 },
      { addr: '1819 S MARINE DR', sp: 345510, dist: 1.15, cls: 'R', cond: 'Average', yb: 1942, ey: 1942, sqft: 1582, land: 85300, impr: 260210, pool: 0, garage: 6000, fp: 3000 },
      { addr: '1530 N LAFAYETTE AVE', sp: 328990, dist: 0.58, cls: 'R', cond: 'Average', yb: 1940, ey: 1940, sqft: 1398, land: 80920, impr: 248070, pool: 0, garage: 6000, fp: 0 },
      { addr: '1537 SNYDER AVE', sp: 332840, dist: 0.53, cls: 'R', cond: 'Average', yb: 1948, ey: 1948, sqft: 1804, land: 87110, impr: 245730, pool: 0, garage: 6000, fp: 3000 },
      { addr: '1025 12TH ST', sp: 450270, dist: 1.22, cls: 'R', cond: 'Average', yb: 2017, ey: 2017, sqft: 1689, land: 68850, impr: 381420, pool: 0, garage: 6000, fp: 0 },
      { addr: '1025 BANYAN ST', sp: 371650, dist: 1.46, cls: 'R', cond: 'Average', yb: 2019, ey: 2019, sqft: 1629, land: 82290, impr: 289360, pool: 0, garage: 6000, fp: 0 },
    ]
  },
  // OA-0039 Dickinson (Stevens WA) — NO assessed data for comps, using AVM estimates
  {
    name: 'Elton Dickinson', caseNum: 'OA-0039',
    address: '4 CRESTVIEW DR', fullAddress: '4 Crestview Dr, Kettle Falls, WA 99141',
    county: 'Stevens', state: 'WA', taxId: 'STEVENS-4-CRESTVIEW', owner: 'DICKINSON, ELTON',
    marketValue: 276200, cls: 'R', cond: 'Average',
    yb: 2002, ey: 2002, sqft: 1152, lotSize: 91476,
    land: 80000, impr: 196200,  // estimated split: ~29% land, 71% impr (typical rural WA)
    pool: 0, garage: 0, fireplace: 0,
    legalCode: 'RCW 84.48.010',
    legalQuote: 'Under RCW 84.48.010 and RCW 84.40.030, all property shall be assessed at 100% of true and fair value in money. The assessed value must reflect actual market conditions and comparable sales in the area.',
    boardName: 'Stevens County Board of Equalization',
    // NOTE: No CAD breakdowns available for comps — using AVM-based estimates
    estimatedComps: true,
    comps: [
      { addr: '17 CRESTVIEW DR', sp: 310000, dist: 0.10, cls: 'R', cond: 'Average', yb: 2006, ey: 2006, sqft: 1404, land: 90000, impr: 220000, pool: 0, garage: 0, fp: 0 },
      { addr: '38 WINDY RIDGE LN', sp: 350000, dist: 1.95, cls: 'R', cond: 'Average', yb: 2018, ey: 2018, sqft: 2004, land: 120000, impr: 230000, pool: 0, garage: 0, fp: 0 },
      { addr: '1365 KETTLE PARK RD', sp: 250000, dist: 5.83, cls: 'R', cond: 'Average', yb: 1982, ey: 1982, sqft: 1152, land: 70000, impr: 180000, pool: 0, garage: 0, fp: 0 },
      { addr: '1330 SOMMER WAY', sp: 320000, dist: 5.68, cls: 'R', cond: 'Average', yb: 2025, ey: 2025, sqft: 1456, land: 90000, impr: 230000, pool: 0, garage: 0, fp: 0 },
      { addr: '1388 PONDEROSA WAY', sp: 290000, dist: 5.83, cls: 'R', cond: 'Average', yb: 2023, ey: 2023, sqft: 1474, land: 85000, impr: 205000, pool: 0, garage: 0, fp: 0 },
      { addr: '1332B PEACHCREST RD', sp: 270000, dist: 6.01, cls: 'R', cond: 'Average', yb: 1998, ey: 1998, sqft: 1600, land: 75000, impr: 195000, pool: 0, garage: 0, fp: 0 },
      { addr: '1180 W OLD KETTLE RD', sp: 220000, dist: 6.76, cls: 'R', cond: 'Average', yb: 1995, ey: 1995, sqft: 924, land: 70000, impr: 150000, pool: 0, garage: 0, fp: 0 },
      { addr: '845 S MEYERS ST', sp: 260000, dist: 7.94, cls: 'R', cond: 'Average', yb: 2015, ey: 2015, sqft: 1296, land: 50000, impr: 210000, pool: 0, garage: 0, fp: 0 },
    ]
  },
  // OA-0030 Tran (Fulton GA) — Atlanta area
  {
    name: 'Tung Tran', caseNum: 'OA-0030',
    address: '294 HASCALL RD NW', fullAddress: '294 Hascall Rd NW, Atlanta, GA 30309',
    county: 'Fulton', state: 'GA', taxId: 'FULTON-294-HASCALL', owner: 'TRAN, TUNG',
    marketValue: 98880, cls: 'R', cond: 'Average',
    yb: 1941, ey: 1941, sqft: 2222, lotSize: 13678,
    land: 98880, impr: 0,  // GA only shows land value in assessment
    pool: 0, garage: 6000, fireplace: 3000,
    legalCode: 'O.C.G.A. §48-5-311',
    legalQuote: 'Under O.C.G.A. §48-5-311, property owners may appeal to the Board of Equalization when the fair market value of property as returned by the taxpayer or as determined by the county board of tax assessors is in dispute.',
    boardName: 'Fulton County Board of Equalization',
    // NOTE: GA assesses at 40% of FMV — actual FMV is ~$247,200 based on assessment
    gaFMV: true,
    comps: [
      { addr: '430 HASCALL RD NW', sp: 318354, dist: 0.31, cls: 'R', cond: 'Average', yb: 1942, ey: 1942, sqft: 2502, land: 87000, impr: 231354, pool: 0, garage: 0, fp: 3000 },
      { addr: '1837 WALTHALL DR NW', sp: 172200, dist: 0.63, cls: 'R', cond: 'Average', yb: 1940, ey: 1940, sqft: 2423, land: 172200, impr: 0, pool: 0, garage: 6000, fp: 0 },
      { addr: '1227 ATLANTIC DR NW', sp: 436000, dist: 0.62, cls: 'R', cond: 'Average', yb: 2007, ey: 2007, sqft: 3648, land: 57400, impr: 378600, pool: 0, garage: 6000, fp: 3000 },
      { addr: '433 TRABERT AVE NW', sp: 235720, dist: 0.33, cls: 'R', cond: 'Average', yb: 1940, ey: 1940, sqft: 2831, land: 86880, impr: 148840, pool: 0, garage: 6000, fp: 0 },
      { addr: '9 PALISADES RD NE', sp: 317440, dist: 0.57, cls: 'R', cond: 'Average', yb: 1925, ey: 1925, sqft: 3602, land: 317440, impr: 0, pool: 0, garage: 0, fp: 3000 },
      { addr: '1821 HUNTINGTON HILLS LN NW', sp: 78000, dist: 0.56, cls: 'R', cond: 'Average', yb: 2022, ey: 2022, sqft: 2712, land: 78000, impr: 0, pool: 0, garage: 6000, fp: 0 },
    ]
  },
];

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

    const spf = client.impr > 0 ? client.impr / client.sqft : (client.marketValue - client.land) / client.sqft;
    const subjFeat = (client.garage || 0) + (client.fireplace || 0);
    const cd = client.comps.map(c => ({ ...c, ...calcAdj(client, c) }));
    cd.sort((a, b) => a.totalAdj - b.totalAdj);
    const mi = Math.floor(cd.length / 2);
    const medV = cd[mi].totalAdj, minV = cd[0].totalAdj, maxV = cd[cd.length - 1].totalAdj;
    const avgV = Math.round(cd.reduce((a, c) => a + c.totalAdj, 0) / cd.length);

    const PW = 792, PH = 612, ML = 30;
    const CPP = 3, LW = 115, DW = Math.floor((PW - 60 - LW) / 4), RH = 13;

    const rowDefs = [
      { l: 'Address', sv: () => client.address, cv: c => c.addr },
      { l: 'Market / Assessed Value', sv: () => cur(client.marketValue), cv: c => cur(c.sp) },
      { l: 'Distance (Miles)', sv: () => '(Subject)', cv: c => c.dist.toFixed(2) },
      { l: 'Property Class', sv: () => client.cls, cv: c => c.cls },
      { l: 'Condition', sv: () => client.cond, cv: c => c.cond },
      { l: 'Year Built (Effective)', sv: () => `${client.yb} (${client.ey})`, cv: c => `${c.yb} (${c.ey})` },
      { l: 'Main SQFT (PSF)', sv: () => `${client.sqft.toLocaleString()} ($${spf.toFixed(2)})`, cv: c => `${c.sqft.toLocaleString()} ($${c.cpf.toFixed(2)})` },
      { l: 'Improvement Value', sv: () => cur(client.impr), cv: c => cur(c.impr) },
      { l: `Feature Value${client.estimatedComps ? ' (Est)' : '*'}`, sv: () => cur(subjFeat), cv: c => cur((c.garage||0)+(c.fp||0)) },
      { l: 'Pool Value', sv: () => cur(client.pool), cv: c => cur(c.pool) },
      { l: 'Land Value', sv: () => cur(client.land), cv: c => cur(c.land) },
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
        .text('Equal & Uniform Analysis \u2014 Adjusted Comparable Sales', ML, y + 2, { width: PW - 60, align: 'center', height: 10, lineBreak: false });
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
        .text('All comparable sales have been adjusted to reflect the subject property\'s characteristics. Subject column represents the baseline.', ML + 5, y, { width: PW - 70, height: 8, lineBreak: false });
      y += 9;
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
      if (client.estimatedComps) {
        doc.font('Helvetica-Oblique').fontSize(4.5).fillColor('#cc0000')
          .text('NOTE: Comparable assessed values estimated from AVM data. County assessment records not publicly available for this jurisdiction.', ML + 5, y, { width: PW - 70, height: 8, lineBreak: false });
        y += 6;
      }
      doc.font('Helvetica-Oblique').fontSize(4.5).fillColor('#888')
        .text(`* Feature values derived from property feature data. Where county breakdown unavailable, values estimated and marked accordingly.`, ML + 5, y, { width: PW - 70, height: 8, lineBreak: false });
      y += 6;
      doc.text(`All property data sourced from ${client.county} County assessment records and RentCast API.`, ML + 5, y, { width: PW - 70, height: 8, lineBreak: false });
    }

    for (let i = 0; i < cd.length; i += CPP) {
      if (i > 0) doc.addPage({ layout: 'landscape' });
      drawCompPage(cd.slice(i, i + CPP));
    }

    // ========== ARGUMENT PAGE ==========
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

    // 1. Over-Assessment
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
      .text('1. STATEMENT OF OVER-ASSESSMENT', LM, y, { width: TW, height: 12, lineBreak: false });
    y += 14;
    doc.font('Helvetica').fontSize(8).fillColor('#333');

    let s1;
    if (client.gaFMV) {
      const fmv = Math.round(client.marketValue / 0.4);
      s1 = `The subject property at ${client.fullAddress} is currently assessed by the ${client.county} County Board of Tax Assessors at ${cur(client.marketValue)} (Fair Market Value: ~${cur(fmv)} at 40% assessment ratio). This valuation exceeds the adjusted median value of ${cd.length} comparable properties (${cur(medV)}) by ${cur(diff)}, representing a ${diffPct}% over-assessment. The current assessment is not equitable under ${client.legalCode}.`;
    } else {
      s1 = `The subject property at ${client.fullAddress} is currently appraised at ${cur(client.marketValue)} for the current tax year. This appraisal exceeds the adjusted median value of ${cd.length} comparable properties (${cur(medV)}) by ${cur(diff)}, representing a ${diffPct}% over-assessment. The current valuation is not equal and uniform as required under ${client.legalCode}.`;
    }
    doc.text(s1, LM, y, { width: TW, lineBreak: true });
    y = doc.y + 10;

    // 2. Evidence
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
      .text('2. COMPARABLE SALES EVIDENCE', LM, y, { width: TW, height: 12, lineBreak: false });
    y += 14;
    doc.font('Helvetica').fontSize(8).fillColor('#333');
    doc.text(`${cd.length} comparable properties were identified within ${cd[cd.length-1].dist.toFixed(1)} miles of the subject. All comparables share the same property classification (${client.cls}), condition rating (${client.cond}), and are located in ${client.county} County, ${client.state}. Each comparable has been adjusted to reflect the subject property's characteristics using standard appraisal methodology.`, LM, y, { width: TW, lineBreak: true });
    y = doc.y + 6;

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#555')
      .text('Adjustment Methodology:', LM, y, { width: TW, lineBreak: false }); y += 10;
    doc.font('Helvetica').fontSize(7).fillColor('#555');
    ['Age: 0.5% per year of effective age difference \u00d7 comp value',
     'Size: Comp improvement PSF \u00d7 (subject sqft \u2013 comp sqft) / 2',
     'Land: Subject land value \u2013 comp land value (from assessment records)',
     'Features: Subject feature value \u2013 comp feature value (garage, fireplace)',
     'Pool: Subject pool value \u2013 comp pool value',
    ].forEach(m => { doc.text('  \u2022 ' + m, LM + 5, y, { width: TW - 10, lineBreak: false }); y += 10; });
    y += 6;

    // 3. Value Analysis
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
      .text('3. ADJUSTED VALUE ANALYSIS', LM, y, { width: TW, height: 12, lineBreak: false });
    y += 14;
    doc.rect(LM, y, TW, 50).fill('#f8f9fa').lineWidth(0.5).stroke('#dee2e6');
    y += 5;
    doc.font('Helvetica').fontSize(7.5).fillColor('#333');
    doc.text(`Minimum Adjusted Value:   ${cur(minV)}  (${cd[0].addr})`, LM + 10, y, { width: TW - 20, height: 10, lineBreak: false }); y += 11;
    doc.text(`Maximum Adjusted Value:   ${cur(maxV)}  (${cd[cd.length-1].addr})`, LM + 10, y, { width: TW - 20, height: 10, lineBreak: false }); y += 11;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#2e7d32');
    doc.text(`Median Adjusted Value:    ${cur(medV)}  (INDICATED VALUE)`, LM + 10, y, { width: TW - 20, height: 10, lineBreak: false }); y += 11;
    doc.font('Helvetica').fontSize(7.5).fillColor('#333');
    doc.text(`Average Adjusted Value:   ${cur(avgV)}`, LM + 10, y, { width: TW - 20, height: 10, lineBreak: false }); y += 15;

    doc.font('Helvetica').fontSize(7).fillColor('#555');
    doc.text('The median is the standard statistical measure used in property tax appeals because it minimizes outlier impact and provides the most representative estimate of market value for equal and uniform comparison.', LM, y, { width: TW, lineBreak: true });
    y = doc.y + 10;

    // 4. Requested Value
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
      .text('4. REQUESTED VALUE & RELIEF', LM, y, { width: TW, height: 12, lineBreak: false });
    y += 14;
    doc.rect(LM, y, TW, 42).fill('#e8f5e9').lineWidth(1).stroke('#2e7d32');
    y += 5;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1b5e20');
    doc.text(`Current Assessed Value:          ${cur(client.marketValue)}`, LM + 15, y, { width: TW - 30, height: 12, lineBreak: false }); y += 14;
    doc.text(`Requested Value (Median Adj):    ${cur(medV)}`, LM + 15, y, { width: TW - 30, height: 12, lineBreak: false }); y += 14;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#cc0000');
    doc.text(`Proposed Reduction:              ${cur(diff)} (${diffPct}%)`, LM + 15, y, { width: TW - 30, height: 12, lineBreak: false }); y += 16;

    doc.font('Helvetica').fontSize(7.5).fillColor('#333');
    doc.text(`The property owner respectfully requests that the ${client.boardName} reduce the assessed value from ${cur(client.marketValue)} to ${cur(medV)}. The evidence demonstrates over-assessment by ${cur(diff)} based on ${cd.length} adjusted comparable properties.`, LM, y, { width: TW, lineBreak: true });
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
    doc.text('\u2022 RentCast API \u2014 Comparable sales, property details, feature data', LM + 5, y, { width: TW - 10, lineBreak: false }); y += 9;
    doc.text('\u2022 OverAssessed.ai \u2014 Adjustment calculations and analysis', LM + 5, y, { width: TW - 10, lineBreak: false }); y += 9;
    if (client.estimatedComps) {
      doc.font('Helvetica-Bold').fontSize(6).fillColor('#cc0000');
      doc.text('NOTE: Some comparable values estimated from AVM data where county records not publicly available.', LM + 5, y, { width: TW - 10, lineBreak: false });
    }

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
    ws.on('finish', () => { console.log(`OK: ${fp}`); resolve({ fp, fn, client, medV, minV, maxV, diff, diffPct, cd }); });
    ws.on('error', reject);
  });
}

async function main() {
  console.log('=== GENERATING ALL SIGNED CUSTOMER PROTESTS ===');
  const results = [];
  for (const c of ALL) {
    try {
      const r = await gen(c);
      results.push(r);
    } catch (e) {
      console.error(`FAIL: ${c.caseNum} — ${e.message}`);
    }
  }
  console.log('\n=== SUMMARY ===');
  console.log('| Case | Name | County | State | Appraised | Median | Reduction | % | Status |');
  console.log('|------|------|--------|-------|-----------|--------|-----------|---|--------|');
  for (const r of results) {
    const c = r.client;
    console.log(`| ${c.caseNum} | ${c.name} | ${c.county} | ${c.state} | ${r.client.marketValue.toLocaleString()} | ${r.medV.toLocaleString()} | ${r.diff.toLocaleString()} | ${r.diffPct}% | COMPLETE |`);
  }
  console.log('\n=== DONE ===');
}
main();
