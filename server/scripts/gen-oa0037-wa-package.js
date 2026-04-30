#!/usr/bin/env node
/**
 * OA-0037 WA Protest Package Generator
 *
 * Builds:
 *   1. WA DOR Form 64-0075 prefilled (Petition to Kitsap County BOE)
 *   2. WA Letter of Authorization (LOA) — appoints OverAssessed as agent
 *   3. Combined signing PDF (form 64-0075 + LOA)
 *
 * Owner Opinion: $451,532 (per Tyler msg 27685)
 * Subject: 2449 Snyder Ave, Bremerton, WA 98312
 * Parcel: 102401-4-037-2004
 *
 * NO Texas form references. Form 64-0075 + LOA only.
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'wa', '64-0075-CountyBOE-Petition.pdf');
const OUT_DIR = path.join(__dirname, '..', 'filing-packages');

// ===== Sherman / OA-0037 facts =====
const FACTS = {
  caseId: 'OA-0037',
  ownerName: 'Sherman Roy Runyon',
  propertyAddress: '2449 Snyder Ave',
  propertyCity: 'Bremerton',
  propertyState: 'WA',
  propertyZip: '98312',
  parcelNumber: '102401-4-037-2004',
  county: 'Kitsap',
  email: 'sealance2449@gmail.com',
  phone: '(360) 440-0620',

  assessmentYear: 2026,
  taxPayableYear: 2027,

  assessorLand: 129970,
  assessorImprovements: 343130,
  assessorTotal: 473100,

  // Owner opinion = $451,532 (Tyler msg 27685). Keep land at assessor value (defensive),
  // drop improvements to balance.
  ownerLand: 129970,
  ownerImprovements: 451532 - 129970, // 321562
  ownerTotal: 451532,

  // Independent comp evidence (from existing approved package)
  compMedian: 451525,
  compMin: 344666,
  compMax: 543430,
  compCount: 10,

  // Agent
  agentName: 'OverAssessed, LLC',
  agentAddress: '6002 Camp Bullis, Suite 208, San Antonio, TX 78257',
  agentPhone: '(888) 282-9165',
  agentEmail: 'info@overassessed.ai',
};

// ===== Field name → value (mapped from visual debug pass) =====
function buildFieldMap(f) {
  const fmt$ = (n) => n.toLocaleString('en-US');
  const reasons = [
    `The subject property is appraised at $${fmt$(f.assessorTotal)}, which exceeds true and fair market value. An equal & uniform analysis of ${f.compCount} comparable Kitsap County sales yielded a median adjusted value of $${fmt$(f.compMedian)} (range: $${fmt$(f.compMin)} to $${fmt$(f.compMax)}). After adjusting for size, age, condition, and land value, the subject should be valued at approximately $${fmt$(f.ownerTotal)}, consistent with the median of comparable market evidence. Comp grid and adjustments attached as supporting evidence.`,
  ].join('\n');

  return {
    'Text Field 22':  f.county,                                  // County name
    'Text Field 31':  String(f.assessmentYear),                  // Assessment year
    'Text Field 32':  String(f.taxPayableYear),                  // Tax payable year
    'Text Field 122': f.parcelNumber,                            // Parcel/Account #
    'Text Field 6':   f.ownerName,                               // Owner name
    'Text Field 8':   f.propertyAddress,                         // Owner mailing street
    'Text Field 34':  f.propertyCity,                            // City
    'Text Field 9':   f.propertyState,                           // State
    'Text Field 10':  f.propertyZip,                             // Zip
    'Text Field 23':  f.phone,                                   // Phone
    'Text Field 24':  f.email,                                   // Email
    'Text Field 124': f.agentName,                               // Petitioner / agent name

    'Text Field 69':  fmt$(f.assessorLand),                      // Assessor Land
    'Text Field 70':  fmt$(f.assessorImprovements),              // Assessor Improvements
    'Text Field 71':  fmt$(f.assessorTotal),                     // Assessor Total
    'Text Field 168': fmt$(f.ownerLand),                         // Petitioner Land
    'Text Field 169': fmt$(f.ownerImprovements),                 // Petitioner Improvements
    'Text Field 167': fmt$(f.ownerTotal),                        // Petitioner Total
    // 'Text Field 166': notice mail date — LEFT BLANK; Sherman fills in

    'Text Field 126': reasons,                                   // Reasons narrative
    // 'Text Field 165': signature date — LEFT BLANK; Sherman fills in

    'Text Field 136': `${f.propertyAddress}, ${f.propertyCity}, ${f.propertyState} ${f.propertyZip}`,
    'Text Field 135': '0.91 acres (39,640 sq ft)',               // Lot size
    'Text Field 134': 'Single Family Residential',                // Zoning
    'Text Field 133': '1,356 sq ft single-family home, built 1938 (effective 1938), wood frame, "Average" condition',
  };
}

async function generatePetition() {
  const tplBytes = fs.readFileSync(TEMPLATE_PATH);
  const doc = await PDFDocument.load(tplBytes);
  const form = doc.getForm();
  const fieldMap = buildFieldMap(FACTS);

  let filled = 0, missing = [];
  for (const [name, val] of Object.entries(fieldMap)) {
    try {
      const f = form.getTextField(name);
      f.setText(val);
      filled++;
    } catch (e) {
      missing.push(name);
    }
  }
  // Section 5: CB62=Residential land, CB66=Residential building (check all that apply)
  try { form.getCheckBox('Check Box 62').check(); } catch(e) { console.log('CB62:', e.message); }
  try { form.getCheckBox('Check Box 66').check(); } catch(e) { console.log('CB66:', e.message); }
  // Page 1: CB60=assessor info request Yes, CB58=email contact Yes
  // (CB57 was No, CB58 is Yes — confirmed via QA)
  try { form.getCheckBox('Check Box 60').check(); } catch(e) {}
  try { form.getCheckBox('Check Box 58').check(); } catch(e) {}

  console.log(`[64-0075] filled ${filled} fields, ${missing.length} missing`);
  if (missing.length) console.log('  missing:', missing.join(', '));

  // Flatten so customer can't change values, but signature stays blank
  form.flatten();

  const outPath = path.join(OUT_DIR, 'OA-0037-WA-Form-64-0075-Petition.pdf');
  fs.writeFileSync(outPath, await doc.save());
  console.log('Wrote:', outPath);
  return outPath;
}

async function generateLOA() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]); // US Letter
  const { width, height } = page.getSize();

  let y = height - 60;
  const left = 72, right = width - 72;

  const drawText = (text, opts = {}) => {
    const size = opts.size || 11;
    const font = opts.bold ? helvBold : helv;
    const color = opts.color || rgb(0, 0, 0);
    page.drawText(text, { x: opts.x || left, y, size, font, color });
    y -= (opts.lineGap || size + 4);
  };

  const drawWrapped = (text, opts = {}) => {
    const size = opts.size || 11;
    const font = opts.bold ? helvBold : helv;
    const maxWidth = right - left;
    const words = text.split(/\s+/);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      const ww = font.widthOfTextAtSize(test, size);
      if (ww > maxWidth) {
        page.drawText(line, { x: left, y, size, font });
        y -= size + 4;
        line = w;
      } else {
        line = test;
      }
    }
    if (line) {
      page.drawText(line, { x: left, y, size, font });
      y -= size + 4;
    }
    y -= 4;
  };

  // Title
  drawText('LETTER OF AUTHORIZATION', { bold: true, size: 16, x: (width - helvBold.widthOfTextAtSize('LETTER OF AUTHORIZATION', 16)) / 2 });
  y -= 8;
  drawText('Authorization to Represent in Property Tax Appeal', { size: 11, x: (width - helv.widthOfTextAtSize('Authorization to Represent in Property Tax Appeal', 11)) / 2 });
  y -= 18;

  drawText('TAXPAYER INFORMATION', { bold: true, size: 12 });
  y -= 4;
  drawText(`Name:           ${FACTS.ownerName}`);
  drawText(`Property:       ${FACTS.propertyAddress}, ${FACTS.propertyCity}, ${FACTS.propertyState} ${FACTS.propertyZip}`);
  drawText(`Parcel No:      ${FACTS.parcelNumber}`);
  drawText(`County:         ${FACTS.county} County, Washington`);
  drawText(`Tax Year:       ${FACTS.assessmentYear} (taxes payable ${FACTS.taxPayableYear})`);
  y -= 8;

  drawText('AUTHORIZED AGENT', { bold: true, size: 12 });
  y -= 4;
  drawText(`Firm:           ${FACTS.agentName}`);
  drawText(`Address:        ${FACTS.agentAddress}`);
  drawText(`Phone:          ${FACTS.agentPhone}`);
  drawText(`Email:          ${FACTS.agentEmail}`);
  y -= 12;

  drawText('AUTHORIZATION', { bold: true, size: 12 });
  y -= 4;
  drawWrapped(
    `I, ${FACTS.ownerName}, the legal owner of the property described above, hereby appoint and authorize OverAssessed, LLC ("Agent") to act as my representative for the purpose of appealing the ${FACTS.assessmentYear} assessed valuation of the above property before the ${FACTS.county} County Board of Equalization (BOE), the Washington State Board of Tax Appeals (BTA), and any related administrative or judicial proceedings.`
  );
  drawWrapped(
    `This authorization grants Agent the power to:`
  );
  drawWrapped('• Prepare and file Petition Form 64-0075 (Taxpayer Petition to the County Board of Equalization for Review of Real Property Valuation Determination) and any supporting evidence on my behalf.');
  drawWrapped('• Communicate with the County Assessor, the Board of Equalization, and the Department of Revenue regarding this appeal.');
  drawWrapped('• Receive notices, correspondence, and decisions related to this appeal.');
  drawWrapped('• Negotiate, settle, or withdraw the appeal subject to my prior written approval of any final settlement.');
  drawWrapped('• Represent me at any hearing before the Board of Equalization.');
  y -= 6;
  drawWrapped(
    `This authorization is effective as of the date signed below and remains in effect until the conclusion of the ${FACTS.assessmentYear} appeal cycle (including any subsequent BTA appeal) or until revoked in writing.`
  );
  y -= 16;

  // Signature block
  drawText('SIGNATURE', { bold: true, size: 12 });
  y -= 14;
  page.drawLine({ start: { x: left, y }, end: { x: left + 280, y }, thickness: 0.7, color: rgb(0, 0, 0) });
  page.drawText(`${FACTS.ownerName} (Property Owner)`, { x: left, y: y - 14, size: 9, font: helv, color: rgb(0.4, 0.4, 0.4) });
  page.drawLine({ start: { x: left + 320, y }, end: { x: right, y }, thickness: 0.7, color: rgb(0, 0, 0) });
  page.drawText('Date', { x: left + 320, y: y - 14, size: 9, font: helv, color: rgb(0.4, 0.4, 0.4) });
  y -= 50;

  drawText('AGENT ACCEPTANCE', { bold: true, size: 12 });
  y -= 14;
  page.drawLine({ start: { x: left, y }, end: { x: left + 280, y }, thickness: 0.7, color: rgb(0, 0, 0) });
  page.drawText('Tyler Worthey, Member, OverAssessed, LLC', { x: left, y: y - 14, size: 9, font: helv, color: rgb(0.4, 0.4, 0.4) });
  page.drawLine({ start: { x: left + 320, y }, end: { x: right, y }, thickness: 0.7, color: rgb(0, 0, 0) });
  page.drawText('Date', { x: left + 320, y: y - 14, size: 9, font: helv, color: rgb(0.4, 0.4, 0.4) });

  // Footer
  page.drawText(`OA-0037 • OverAssessed, LLC • ${new Date().toISOString().substring(0, 10)}`, {
    x: left, y: 30, size: 8, font: helv, color: rgb(0.5, 0.5, 0.5),
  });

  const outPath = path.join(OUT_DIR, 'OA-0037-WA-LOA.pdf');
  fs.writeFileSync(outPath, await doc.save());
  console.log('Wrote:', outPath);
  return outPath;
}

async function combinePDFs(petitionPath, loaPath) {
  const out = await PDFDocument.create();
  for (const p of [petitionPath, loaPath]) {
    const src = await PDFDocument.load(fs.readFileSync(p));
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(pg => out.addPage(pg));
  }
  const outPath = path.join(OUT_DIR, 'OA-0037-WA-Signing-Package.pdf');
  fs.writeFileSync(outPath, await out.save());
  console.log('Wrote:', outPath);
  return outPath;
}

(async () => {
  const petition = await generatePetition();
  const loa = await generateLOA();
  const combined = await combinePDFs(petition, loa);
  console.log('\n=== DONE ===');
  console.log('Petition:  ', petition);
  console.log('LOA:       ', loa);
  console.log('Combined:  ', combined);
})();
