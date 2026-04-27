/* DEPRECATED — DO NOT USE FOR FILING. See PROTEST-PACKAGE-STANDARD.md. Approved: gen-taxnet-final.js / gen-taxnet-pdf.js */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { generateMapImage, geocode } = require('../services/map-generator');
const { calcAdjustments } = require('../services/taxnet-package-generator');

const FILING_DIR = path.join(__dirname, '..', 'filing-packages');
if (!fs.existsSync(FILING_DIR)) fs.mkdirSync(FILING_DIR, { recursive: true });

const caseData = {
  case_id: 'OA-0013',
  owner_name: 'Rupani, Shabir Hasanali',
  property_address: '708 Santa Lucia Dr, Anna, TX 75409',
  phone: '', email: '', county: 'Collin',
};

const property = {
  accountId: 'R-13273-00J-0230-1',
  geoId: 'R-13273-00J-0230-1',
  legalDescription: 'Mantua Point Phase 3, Block J, Lot 23',
  address: '708 Santa Lucia Dr, Anna, TX 75409',
  county: 'Collin',
  ownerName: 'Rupani, Shabir Hasanali',
  assessedValue: 399042,
  opinionOfValue: 368000,
  landValue: 125000,
  improvementValue: 274042,
  sqft: 1781,
  yearBuilt: 2024,
  effectiveYear: 2024,
  propClass: 'A1',
  conditionLabel: 'Good',
  conditionScore: 3,
  acres: 0.15,
  featureValue: 0,
  poolValue: 0,
};

const comps = [
  { propId:'R-13273-00J-0250-1', address:'740 Santa Lucia Dr, Anna, TX 75409',  sqft:1777, yearBuilt:2024, effectiveYear:2024, marketValue:359000, landValue:125000, improvValue:234000, featureValue:0, poolValue:0, propClass:'A1', conditionLabel:'Good', conditionScore:3, acres:0.14, distance:0.05 },
  { propId:'R-13273-00K-0010-1', address:'901 Portina Dr, Anna, TX 75409',       sqft:1777, yearBuilt:2024, effectiveYear:2024, marketValue:367500, landValue:125000, improvValue:242500, featureValue:0, poolValue:0, propClass:'A1', conditionLabel:'Good', conditionScore:3, acres:0.14, distance:0.16 },
  { propId:'R-13273-00J-0070-1', address:'221 Santa Lucia Dr, Anna, TX 75409',   sqft:1799, yearBuilt:2023, effectiveYear:2023, marketValue:375000, landValue:126000, improvValue:249000, featureValue:0, poolValue:0, propClass:'A1', conditionLabel:'Good', conditionScore:3, acres:0.15, distance:0.17 },
  { propId:'R-13273-00K-0040-1', address:'924 Amenduni Ln, Anna, TX 75409',      sqft:1777, yearBuilt:2024, effectiveYear:2024, marketValue:367900, landValue:125000, improvValue:242900, featureValue:0, poolValue:0, propClass:'A1', conditionLabel:'Good', conditionScore:3, acres:0.14, distance:0.20 },
  { propId:'R-13273-00L-0050-1', address:'1309 Renato Dr, Anna, TX 75409',       sqft:1799, yearBuilt:2024, effectiveYear:2024, marketValue:375000, landValue:126000, improvValue:249000, featureValue:0, poolValue:0, propClass:'A1', conditionLabel:'Good', conditionScore:3, acres:0.15, distance:0.24 },
];

const allAdj = comps.map(c => calcAdjustments(c, property));
const adjValues = allAdj.map(a => a.adjustedValue).sort((a, b) => a - b);
const minVal = adjValues[0];
const medianVal = adjValues[Math.floor(adjValues.length / 2)];
const medianIdx = allAdj.findIndex(a => a.adjustedValue === medianVal);

function fmt(n) { return '$' + Math.abs(Math.round(n)).toLocaleString(); }
function fmtAdj(dollar, pct) {
  const d = Math.round(dollar);
  const p = (Math.round(pct * 100) / 100).toFixed(2);
  const prefix = d >= 0 ? '$' : '$-';
  const val = Math.abs(d).toLocaleString();
  const pPrefix = parseFloat(p) >= 0 ? '' : '-';
  return prefix + val + ' (' + pPrefix + Math.abs(parseFloat(p)).toFixed(2) + '%)';
}

const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const filePath = path.join(FILING_DIR, 'OA-0013-Filing-Package-v4.pdf');

async function build() {
  // Maps
  console.log('[Build] Geocoding...');
  let subjectMapBuf = null, compsMapBuf = null;
  try {
    const subGeo = await geocode(property.address);
    if (subGeo) {
      subjectMapBuf = await generateMapImage(subGeo.lat, subGeo.lon, 15, 3, 3, [
        { lat: subGeo.lat, lon: subGeo.lon, color: [220, 30, 30] }
      ]);
      const markers = [{ lat: subGeo.lat, lon: subGeo.lon, color: [220, 30, 30] }];
      for (let i = 0; i < comps.length; i++) {
        await new Promise(r => setTimeout(r, 400));
        const g = await geocode(comps[i].address);
        if (g) markers.push({ lat: g.lat, lon: g.lon, color: [30, 80, 180] });
      }
      const lats = markers.map(m => m.lat), lons = markers.map(m => m.lon);
      const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const cLon = (Math.min(...lons) + Math.max(...lons)) / 2;
      const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons));
      const zoom = span < 0.01 ? 15 : span < 0.05 ? 13 : 12;
      compsMapBuf = await generateMapImage(cLat, cLon, zoom, 4, 4, markers);
      console.log('[Build] Maps ready. Comps geocoded:', markers.length - 1);
    }
  } catch (e) {
    console.log('[Build] Map error (non-fatal):', e.message);
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const ML = 50, contentW = 512;
    const LABEL_W = 115;
    const COMPS_PER_PAGE = 3;
    const COL_W = Math.floor((contentW - LABEL_W) / 4); // subject + 3 comps
    const ROW_H = 14, FSZ = 6.5, FSZ_HDR = 7;
    const FOOTER_Y = 760;

    // ── PAGE 1: FORM 50-132 ──────────────────────────────────
    doc.fontSize(9).font('Helvetica').text('Form 50-132', { align: 'right' });
    doc.fontSize(14).font('Helvetica-Bold').text('Notice of Protest', ML, 50);
    doc.fontSize(11).font('Helvetica-Bold').text('Before the Appraisal Review Board');
    doc.fontSize(9).font('Helvetica').text('Tax Code Sections 41.41, 41.44, 41.45');

    let y = 115;

    doc.font('Helvetica-Bold').fontSize(11).text('STEP 1: Appraisal District', ML, y); y += 16;
    doc.font('Helvetica').fontSize(9).text('District: Collin County Appraisal District', ML, y); y += 13;
    doc.font('Helvetica').fontSize(9).text('Tax Year: 2026', ML, y); y += 22;

    doc.font('Helvetica-Bold').fontSize(11).text('STEP 2: Owner / Agent', ML, y); y += 16;
    doc.font('Helvetica').fontSize(9).text('Owner: ' + caseData.owner_name, ML, y); y += 13;
    doc.font('Helvetica').fontSize(9).text('Address: ' + caseData.property_address, ML, y); y += 13;
    doc.font('Helvetica').fontSize(9).text('Phone:', ML, y);
    doc.font('Helvetica').fontSize(9).text('Email:', ML + 280, y); y += 13;
    doc.font('Helvetica').fontSize(9).text('Agent: OverAssessed, LLC', ML, y); y += 13;
    doc.font('Helvetica').fontSize(9).text('Agent Addr: 6002 Camp Bullis, Suite 208, San Antonio, TX 78257', ML, y); y += 13;
    doc.font('Helvetica').fontSize(9).text('Agent Phone: (888) 282-9165', ML, y);
    doc.font('Helvetica').fontSize(9).text('Agent Email: info@overassessed.ai', ML + 280, y); y += 22;

    doc.font('Helvetica-Bold').fontSize(11).text('STEP 3: Property', ML, y); y += 16;
    doc.font('Helvetica').fontSize(9).text('Account #: ' + property.accountId, ML, y);
    doc.font('Helvetica').fontSize(9).text('Geo ID: ' + property.geoId, ML + 280, y); y += 13;
    doc.font('Helvetica').fontSize(9).text('Address: ' + property.address, ML, y); y += 13;
    doc.font('Helvetica').fontSize(9).text('Legal: ' + property.legalDescription, ML, y); y += 22;

    doc.font('Helvetica-Bold').fontSize(11).text('STEP 4: Protest Grounds', ML, y); y += 16;
    doc.font('Helvetica').fontSize(9).text('\u2611  Value exceeds market value (\u00a741.41(a)(1))', ML + 10, y); y += 13;
    doc.font('Helvetica').fontSize(9).text('\u2611  Value is unequal compared with similar properties (\u00a741.41(a)(2))', ML + 10, y); y += 22;

    doc.font('Helvetica-Bold').fontSize(11).text('STEP 5: Values', ML, y); y += 16;
    doc.font('Helvetica').fontSize(9).text('District Appraised: ' + fmt(property.assessedValue), ML, y); y += 13;
    doc.font('Helvetica').fontSize(9).text("Owner's Opinion of Value: " + fmt(property.opinionOfValue), ML, y); y += 22;

    doc.font('Helvetica-Bold').fontSize(11).text('STEP 6: Signature', ML, y); y += 16;
    doc.font('Helvetica').fontSize(9)
       .text('I am the owner of the property listed in this notice, or I am authorized by the owner to file this protest.', ML, y, { width: 500 }); y += 16;
    doc.font('Helvetica').fontSize(9).text('Signature: ________________________________    Date: _______________', ML, y); y += 14;
    doc.font('Helvetica').fontSize(9).text('Print Name: ' + caseData.owner_name, ML, y);

    doc.fontSize(7).fillColor('#666')
       .text('Texas Comptroller Form 50-132 \u2014 TaxNet USA Standard', ML, 730, { align: 'center', width: 500 });
    doc.fillColor('#000');

    // ── PAGES 2+: E&U COMP GRID ──────────────────────────────
    const pages = [];
    for (let i = 0; i < comps.length; i += COMPS_PER_PAGE) pages.push(comps.slice(i, i + COMPS_PER_PAGE));
    const totalGridPages = pages.length;

    for (let pg = 0; pg < pages.length; pg++) {
      doc.addPage({ size: 'LETTER', margin: 0 });
      const pageComps = pages[pg];
      const pgOffset = pg * COMPS_PER_PAGE;
      const pageAdjs = pageComps.map((_, k) => allAdj[pgOffset + k]);
      const MT = 28;

      // Navy title bar
      doc.rect(ML, MT, contentW, 22).fill('#1F3D5E');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11)
         .text('Equal & Uniform Analysis', ML, MT + 5, { width: contentW, align: 'center', lineBreak: false });
      doc.fillColor('#000');

      // Address + IDs
      doc.font('Helvetica-Bold').fontSize(10)
         .text(property.address.toUpperCase(), ML, MT + 30, { lineBreak: false });
      doc.font('Helvetica').fontSize(8)
         .text('Tax ID: ' + property.accountId, ML, MT + 43, { lineBreak: false })
         .text('Owner: ' + property.ownerName, ML + 220, MT + 43, { lineBreak: false });

      // Recommended Value (= Owner Opinion = locked anchor) — Tyler directive 2026-04-27
      // No Max/Median exposed in the grid header.
      const _recVal = property.opinionOfValue;
      doc.font('Helvetica-Bold').fontSize(10)
         .text('Recommended Value: ' + fmt(_recVal), ML, MT + 57, { lineBreak: false });
      doc.font('Helvetica').fontSize(8)
         .text('Number of Comps: ' + comps.length, ML, MT + 70, { width: contentW, lineBreak: false });

      // Separator
      doc.moveTo(ML, MT + 82).lineTo(ML + contentW, MT + 82).lineWidth(0.5).stroke('#ccc');

      // Footer
      doc.font('Helvetica').fontSize(7).fillColor('#999')
         .text(
           'Collin County   ' + today + '   Page ' + (pg + 1) + ' of ' + totalGridPages +
           '   Confidential \u00a9 2026 OverAssessed, LLC',
           ML, FOOTER_Y, { width: contentW, align: 'center', lineBreak: false }
         );
      doc.fillColor('#000');

      // Column headers — dark blue-gray
      let cy = MT + 90;
      doc.rect(ML, cy, contentW, ROW_H + 2).fill('#334E68');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(FSZ_HDR);
      const o = { lineBreak: false, ellipsis: true };
      doc.text('(CAD 2026)', ML + 2, cy + 4, { ...o, width: LABEL_W - 4 });
      doc.text('SUBJECT', ML + LABEL_W, cy + 4, { ...o, width: COL_W - 2 });
      for (let c = 0; c < pageComps.length; c++) {
        const gi = pgOffset + c;
        const lbl = (gi === medianIdx) ? 'MEDIAN COMP' : 'COMP ' + (gi + 1);
        doc.text(lbl, ML + LABEL_W + COL_W * (c + 1), cy + 4, { ...o, width: COL_W - 2 });
      }
      doc.fillColor('#000');
      cy += ROW_H + 2;

      // Grid rows — Standard Template v1 fixed order
      const subPsf = Math.round(property.assessedValue / property.sqft);
      const rows = [
        { label: 'Tax ID',                sub: property.accountId,                                      vals: pageComps.map(c => c.propId) },
        { label: 'Address',               sub: property.address.substring(0, 30),                       vals: pageComps.map(c => c.address.substring(0, 30)) },
        { label: 'Market Value',          sub: fmt(property.assessedValue),                             vals: pageComps.map(c => fmt(c.marketValue)) },
        { label: 'Distance (Miles)',      sub: '-',                                                     vals: pageComps.map(c => c.distance.toFixed(2)) },
        { label: 'Property Class',        sub: property.propClass,                                      vals: pageComps.map(c => c.propClass) },
        { label: 'Condition',             sub: property.conditionLabel,                                 vals: pageComps.map(c => c.conditionLabel) },
        { label: 'Year Built (Effective)',sub: property.yearBuilt + ' (' + property.effectiveYear + ')',vals: pageComps.map(c => c.yearBuilt + ' (' + c.effectiveYear + ')') },
        { label: 'Main SQFT (PSF)',        sub: property.sqft.toLocaleString() + ' ($' + subPsf + ')',  vals: pageComps.map(c => { const p = Math.round(c.marketValue / c.sqft); return c.sqft.toLocaleString() + ' ($' + p + ')'; }) },
        { label: 'Improvement Value',     sub: fmt(property.improvementValue),                         vals: pageComps.map(c => fmt(c.improvValue)) },
        { label: 'Feature Value',         sub: fmt(0),                                                  vals: pageComps.map(() => fmt(0)) },
        { label: 'Pool Value',            sub: fmt(0),                                                  vals: pageComps.map(() => fmt(0)) },
        { label: 'Land Value',            sub: fmt(property.landValue),                                 vals: pageComps.map(c => fmt(c.landValue)) },
        { label: 'Age Adjustment',        sub: '-', adj: true,                                          vals: pageAdjs.map(a => fmtAdj(a.ageAdj, a.agePct)) },
        { label: 'Size Adjustment',       sub: '-', adj: true,                                          vals: pageAdjs.map(a => fmtAdj(a.sizeAdj, a.sizePct)) },
        { label: 'Land Adjustment',       sub: '-', adj: true,                                          vals: pageAdjs.map(a => fmtAdj(a.landAdj, a.landPct)) },
        { label: 'Feature Adjustment',    sub: '-', adj: true,                                          vals: pageAdjs.map(() => fmtAdj(0, 0)) },
        { label: 'Pool Adjustment',       sub: '-', adj: true,                                          vals: pageAdjs.map(() => fmtAdj(0, 0)) },
        { label: 'Net Adjustment',        sub: '-', adj: true, bold: true,                              vals: pageAdjs.map(a => fmtAdj(a.netAdj, a.netPct)) },
        { label: 'Total Adjusted Value',  sub: '-', highlight: true, bold: true,                        vals: pageAdjs.map(a => fmt(a.adjustedValue)) },
      ];

      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (row.highlight) {
          doc.rect(ML, cy, contentW, ROW_H).fill('#D1EAD8');
          doc.moveTo(ML, cy).lineTo(ML + contentW, cy).lineWidth(0.5).stroke('#A2C9AF');
          doc.moveTo(ML, cy + ROW_H).lineTo(ML + contentW, cy + ROW_H).lineWidth(0.5).stroke('#A2C9AF');
        } else if (r % 2 === 0) {
          doc.rect(ML, cy, contentW, ROW_H).fill('#F1F4F6');
        }
        // Vertical dividers
        doc.save().strokeColor('#cccccc').lineWidth(0.3);
        for (let i = 0; i <= COMPS_PER_PAGE; i++) {
          const lx = ML + LABEL_W + COL_W * i;
          doc.moveTo(lx, cy).lineTo(lx, cy + ROW_H).stroke();
        }
        doc.restore();
        // Text
        doc.font('Helvetica-Bold').fontSize(FSZ).fillColor('#000')
           .text(row.label, ML + 2, cy + 3, { width: LABEL_W - 4, lineBreak: false, ellipsis: true });
        doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FSZ).fillColor('#000')
           .text(row.sub, ML + LABEL_W + 2, cy + 3, { width: COL_W - 4, lineBreak: false, ellipsis: true });
        for (let c = 0; c < pageComps.length; c++) {
          doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FSZ).fillColor('#000')
             .text(row.vals[c] || '-', ML + LABEL_W + COL_W * (c + 1) + 2, cy + 3, { width: COL_W - 4, lineBreak: false, ellipsis: true });
        }
        doc.fillColor('#000');
        cy += ROW_H;
      }
      doc.moveTo(ML, cy).lineTo(ML + contentW, cy).lineWidth(0.5).stroke('#aaa');
    }

    // ── EVIDENCE SUMMARY ────────────────────────────────────
    doc.addPage({ size: 'LETTER', margin: 50 });
    doc.fontSize(12).font('Helvetica-Bold').text('Evidence Summary & Protest Argument', { align: 'center' });
    doc.fontSize(8).font('Helvetica').text('TaxNet USA Standard \u2014 Supporting Documentation', { align: 'center' });
    doc.moveDown(0.8);

    const subPsf2 = Math.round(property.assessedValue / property.sqft);
    const compPsfs = comps.map(c => Math.round(c.marketValue / c.sqft));
    const avgPsf = Math.round(compPsfs.reduce((s, v) => s + v, 0) / compPsfs.length);
    const medPsf = compPsfs.slice().sort((a, b) => a - b)[Math.floor(compPsfs.length / 2)];

    doc.fontSize(10).font('Helvetica-Bold').text('$/Sq Ft Comparison');
    doc.moveDown(0.3);
    doc.fontSize(8).font('Helvetica');
    doc.text('Subject $/SF: $' + subPsf2 + ' (appraised ' + fmt(property.assessedValue) + ' / ' + property.sqft + ' SF)');
    doc.text('Comp Average $/SF: $' + avgPsf);
    doc.text('Subject is $' + (subPsf2 - avgPsf) + '/SF ABOVE comparable average');
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica-Bold').text('Comp Ranking (by Adjusted Value)');
    doc.moveDown(0.3);
    const ranked = comps.map((c, i) => ({ ...c, adj: allAdj[i], num: i + 1 })).sort((a, b) => a.adj.adjustedValue - b.adj.adjustedValue);
    doc.fontSize(7).font('Helvetica');
    ranked.forEach((c, i) => {
      const psf = Math.round(c.marketValue / c.sqft);
      doc.text((i + 1) + '. [Comp #' + c.num + '] ' + c.address + ' \u2014 Adj: ' + fmt(c.adj.adjustedValue) + ' ($' + psf + '/SF) \u2014 ' + c.sqft + ' SF, built ' + c.yearBuilt + ', ' + c.distance.toFixed(2) + ' mi', { width: 500 });
    });
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica-Bold').text('PROTEST ARGUMENT');
    doc.moveDown(0.3);
    doc.fontSize(8).font('Helvetica');
    const overPct = ((property.assessedValue - medianVal) / medianVal * 100).toFixed(1);
    doc.text('1. OVERVALUATION: The subject is appraised at ' + fmt(property.assessedValue) + ' ($' + subPsf2 + '/SF), which is ' + overPct + '% above the median adjusted value of ' + comps.length + ' comparable properties (' + fmt(medianVal) + '). These comparables are new-construction Class A1 homes built 2023\u20132024 in the Mantua Point subdivision within 0.25 miles.', { width: 500 }); doc.moveDown(0.2);
    doc.text('2. UNEQUAL APPRAISAL (\u00a741.41(a)(2)): After adjusting for size, age, and land value, the median adjusted value of the comparable set is ' + fmt(medianVal) + '. Under Equal & Uniform standards, the subject should not be assessed above this level.', { width: 500 }); doc.moveDown(0.2);
    doc.text('3. SAME SUBDIVISION / SAME CLASS: All 5 comparables are Mantua Point Phase 3, Anna TX \u2014 same builder, same subdivision, Class A1, Good condition, new construction 2023\u20132024. No material differences justify the ' + fmt(property.assessedValue - medianVal) + ' premium over the comparable median.', { width: 500 });
    doc.moveDown(0.6);

    doc.fontSize(10).font('Helvetica-Bold').text('REQUESTED RELIEF');
    doc.fontSize(8).font('Helvetica');
    doc.text('Reduce appraised value from ' + fmt(property.assessedValue) + ' to ' + fmt(property.opinionOfValue) + ', consistent with the median adjusted value of ' + comps.length + ' comparable new-construction properties in the same subdivision.', { width: 500 });
    doc.moveDown(1.2);
    doc.fontSize(7).fillColor('#666').text('TaxNet USA Standard  |  5 Comps  |  Source: TaxNet USA / Collin County Appraisal District  |  ' + today + '  |  OverAssessed, LLC', { align: 'center', width: 500 });
    doc.fillColor('#000');

    // ── SUBJECT MAP ──────────────────────────────────────────
    doc.addPage({ size: 'LETTER', margin: 0 });
    const ML2 = 30, cW = 552;
    doc.rect(ML2, 28, cW, 16).fill('#1F3D5E');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9)
       .text('Subject Property Location', ML2, 31, { width: cW, align: 'center', lineBreak: false });
    doc.fillColor('#000');
    doc.font('Helvetica-Bold').fontSize(8).text(property.address.toUpperCase(), ML2, 52, { lineBreak: false });
    doc.font('Helvetica').fontSize(7)
       .text('Collin County  |  Tax ID: ' + property.accountId + '  |  Assessed: ' + fmt(property.assessedValue), ML2, 63, { lineBreak: false });
    if (subjectMapBuf) {
      doc.image(subjectMapBuf, ML2, 76, { width: cW, height: 580, fit: [cW, 580] });
    } else {
      doc.rect(ML2, 76, cW, 580).fill('#f0f0f0');
      doc.fillColor('#999').fontSize(10).text('Map unavailable', ML2, 350, { width: cW, align: 'center' });
    }
    doc.fillColor('#888').font('Helvetica').fontSize(6)
       .text('Map data \u00a9 OpenStreetMap contributors', ML2, 665, { width: cW, align: 'right', lineBreak: false });
    doc.fillColor('#000');

    // ── COMPARABLES MAP ──────────────────────────────────────
    doc.addPage({ size: 'LETTER', margin: 0 });
    doc.rect(ML2, 28, cW, 16).fill('#1F3D5E');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9)
       .text('Subject & Comparable Properties Map', ML2, 31, { width: cW, align: 'center', lineBreak: false });
    doc.fillColor('#000');
    doc.font('Helvetica-Bold').fontSize(8).text(property.address.toUpperCase(), ML2, 52, { lineBreak: false });
    doc.font('Helvetica').fontSize(7)
       .text(comps.length + ' comparable properties shown  |  Collin County', ML2, 63, { lineBreak: false });
    if (compsMapBuf) {
      doc.image(compsMapBuf, ML2, 76, { width: cW, height: 530, fit: [cW, 530] });
    } else {
      doc.rect(ML2, 76, cW, 530).fill('#f0f0f0');
      doc.fillColor('#999').fontSize(10).text('Map unavailable', ML2, 330, { width: cW, align: 'center' });
    }
    const ly = 616;
    doc.rect(ML2, ly, cW, 50).fill('#f8f9fa');
    doc.rect(ML2 + 10, ly + 10, 12, 12).fill('#DC1E1E');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(7).text('SUBJECT: ' + property.address, ML2 + 26, ly + 12, { lineBreak: false });
    doc.rect(ML2 + 10, ly + 28, 12, 12).fill('#1E50B4');
    doc.font('Helvetica').fontSize(7).text(comps.length + ' Comparable Properties \u2014 Mantua Point Subdivision, Anna TX', ML2 + 26, ly + 30, { lineBreak: false });
    doc.fillColor('#888').fontSize(6).text('Map data \u00a9 OpenStreetMap contributors', ML2, ly + 44, { width: cW, align: 'right', lineBreak: false });
    doc.fillColor('#000');

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

build().then(fp => {
  const size = (require('fs').statSync(fp).size / 1024).toFixed(0);
  console.log('DONE:' + fp);
  console.log('SIZE:' + size + 'KB');
}).catch(e => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
