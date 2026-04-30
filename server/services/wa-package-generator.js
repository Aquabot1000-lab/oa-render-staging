/**
 * wa-package-generator.js
 *
 * Production-callable WA filing package generator.
 *
 * Builds:
 *   1. WA DOR Form 64-0075 prefilled (Petition to County Board of Equalization)
 *   2. WA Letter of Authorization (LOA) — appoints OverAssessed as agent
 *   3. Combined signing PDF (form 64-0075 + LOA)
 *
 * Returns Buffers for all three (no disk writes inside the module — caller
 * decides where to put them). The companion script
 * `scripts/gen-oa0037-wa-package.js` continues to write to disk for OA-0037.
 *
 * Usage:
 *   const { generateWAPackage } = require('./wa-package-generator');
 *   const { petitionPdfBytes, loaPdfBytes, combinedPdfBytes } =
 *       await generateWAPackage(facts);
 *
 * Required `facts` keys (defensive defaults applied where reasonable):
 *   caseId, ownerName, propertyAddress, propertyCity, propertyState,
 *   propertyZip, parcelNumber, county, email, phone,
 *   assessmentYear, taxPayableYear,
 *   assessorLand, assessorImprovements, assessorTotal,
 *   ownerLand, ownerImprovements, ownerTotal,
 *   compMedian, compMin, compMax, compCount,
 *   agentName, agentAddress, agentPhone, agentEmail,
 *   propertyDescription (optional), lotSize (optional), zoning (optional)
 *
 * NO Texas form references. Form 64-0075 + LOA only.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'wa', '64-0075-CountyBOE-Petition.pdf');

const DEFAULT_AGENT = {
    agentName: 'OverAssessed, LLC',
    agentAddress: '6002 Camp Bullis, Suite 208, San Antonio, TX 78257',
    agentPhone: '(888) 282-9165',
    agentEmail: 'info@overassessed.ai',
};

// ===== Field name → value mapping (from gen-oa0037-wa-package.js) =====
function buildFieldMap(f) {
    const fmt$ = (n) => {
        const num = typeof n === 'number' ? n : parseInt(String(n).replace(/[^\d.-]/g, ''), 10) || 0;
        return num.toLocaleString('en-US');
    };

    const reasons = [
        `The subject property is appraised at $${fmt$(f.assessorTotal)}, which exceeds true and fair market value. `
        + `An equal & uniform analysis of ${f.compCount || 'multiple'} comparable ${f.county} County sales yielded `
        + `a median adjusted value of $${fmt$(f.compMedian)} (range: $${fmt$(f.compMin)} to $${fmt$(f.compMax)}). `
        + `After adjusting for size, age, condition, and land value, the subject should be valued at approximately `
        + `$${fmt$(f.ownerTotal)}, consistent with the median of comparable market evidence. Comp grid and `
        + `adjustments attached as supporting evidence.`,
    ].join('\n');

    return {
        'Text Field 22':  f.county,
        'Text Field 31':  String(f.assessmentYear),
        'Text Field 32':  String(f.taxPayableYear),
        'Text Field 122': f.parcelNumber,
        'Text Field 6':   f.ownerName,
        'Text Field 8':   f.propertyAddress,
        'Text Field 34':  f.propertyCity,
        'Text Field 9':   f.propertyState,
        'Text Field 10':  f.propertyZip,
        'Text Field 23':  f.phone,
        'Text Field 24':  f.email,
        'Text Field 124': f.agentName,

        'Text Field 69':  fmt$(f.assessorLand),
        'Text Field 70':  fmt$(f.assessorImprovements),
        'Text Field 71':  fmt$(f.assessorTotal),
        'Text Field 168': fmt$(f.ownerLand),
        'Text Field 169': fmt$(f.ownerImprovements),
        'Text Field 167': fmt$(f.ownerTotal),

        'Text Field 126': reasons,

        'Text Field 136': `${f.propertyAddress}, ${f.propertyCity}, ${f.propertyState} ${f.propertyZip}`,
        'Text Field 135': f.lotSize || '',
        'Text Field 134': f.zoning || 'Single Family Residential',
        'Text Field 133': f.propertyDescription || 'Single-family residential property',
    };
}

/**
 * Build the prefilled WA Form 64-0075 PDF as a Buffer.
 * Returns { petitionPdfBytes }.
 *
 * We DO NOT flatten here — Signature Field 1 + Text Field 165 (date) need to remain
 * mutable so the signing service can overlay the captured signature on top.
 * Instead we set values + rely on read-only / overlay approach. Form is flattened
 * by the SIGNING service after signature is overlaid (so the customer's prefilled
 * data is locked at signing time, same as TX flow).
 */
async function buildPetition(facts) {
    if (!fs.existsSync(TEMPLATE_PATH)) {
        throw new Error(`WA Form 64-0075 template not found at ${TEMPLATE_PATH}`);
    }
    const tplBytes = fs.readFileSync(TEMPLATE_PATH);
    const doc = await PDFDocument.load(tplBytes);
    const form = doc.getForm();
    const fieldMap = buildFieldMap(facts);

    let filled = 0, missing = [];
    for (const [name, val] of Object.entries(fieldMap)) {
        if (val == null || val === '') continue;
        try {
            const f = form.getTextField(name);
            f.setText(String(val));
            filled++;
        } catch (e) {
            missing.push(name);
        }
    }

    // Section 5 checkboxes (residential)
    try { form.getCheckBox('Check Box 62').check(); } catch (e) {}
    try { form.getCheckBox('Check Box 66').check(); } catch (e) {}
    // Page 1 contact prefs
    try { form.getCheckBox('Check Box 60').check(); } catch (e) {}
    try { form.getCheckBox('Check Box 58').check(); } catch (e) {}

    console.log(`[wa-package] Form 64-0075 filled ${filled} fields, ${missing.length} missing`);
    if (missing.length) console.log('  missing:', missing.join(', '));

    // Note: do NOT flatten here. The signing service overlays signature + date,
    // then flattens. This preserves the same model as the TX 50-162 path.
    const bytes = await doc.save();
    return Buffer.from(bytes);
}

/**
 * Build the LOA as a Buffer.
 */
async function buildLOA(facts) {
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([612, 792]);
    const { width, height } = page.getSize();

    let y = height - 60;
    const left = 72, right = width - 72;

    const drawText = (text, opts = {}) => {
        const size = opts.size || 11;
        const font = opts.bold ? helvBold : helv;
        const color = opts.color || rgb(0, 0, 0);
        page.drawText(text, { x: opts.x != null ? opts.x : left, y, size, font, color });
        y -= (opts.lineGap || size + 4);
    };

    const drawWrapped = (text, opts = {}) => {
        const size = opts.size || 11;
        const font = opts.bold ? helvBold : helv;
        const maxWidth = right - left;
        const words = String(text).split(/\s+/);
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

    drawText('LETTER OF AUTHORIZATION', {
        bold: true, size: 16,
        x: (width - helvBold.widthOfTextAtSize('LETTER OF AUTHORIZATION', 16)) / 2,
    });
    y -= 8;
    drawText('Authorization to Represent in Property Tax Appeal', {
        size: 11,
        x: (width - helv.widthOfTextAtSize('Authorization to Represent in Property Tax Appeal', 11)) / 2,
    });
    y -= 18;

    drawText('TAXPAYER INFORMATION', { bold: true, size: 12 });
    y -= 4;
    drawText(`Name:           ${facts.ownerName}`);
    drawText(`Property:       ${facts.propertyAddress}, ${facts.propertyCity}, ${facts.propertyState} ${facts.propertyZip}`);
    drawText(`Parcel No:      ${facts.parcelNumber}`);
    drawText(`County:         ${facts.county} County, Washington`);
    drawText(`Tax Year:       ${facts.assessmentYear} (taxes payable ${facts.taxPayableYear})`);
    y -= 8;

    drawText('AUTHORIZED AGENT', { bold: true, size: 12 });
    y -= 4;
    drawText(`Firm:           ${facts.agentName}`);
    drawText(`Address:        ${facts.agentAddress}`);
    drawText(`Phone:          ${facts.agentPhone}`);
    drawText(`Email:          ${facts.agentEmail}`);
    y -= 12;

    drawText('AUTHORIZATION', { bold: true, size: 12 });
    y -= 4;
    drawWrapped(
        `I, ${facts.ownerName}, the legal owner of the property described above, hereby appoint and authorize ${facts.agentName} ("Agent") to act as my representative for the purpose of appealing the ${facts.assessmentYear} assessed valuation of the above property before the ${facts.county} County Board of Equalization (BOE), the Washington State Board of Tax Appeals (BTA), and any related administrative or judicial proceedings.`
    );
    drawWrapped(`This authorization grants Agent the power to:`);
    drawWrapped('• Prepare and file Petition Form 64-0075 (Taxpayer Petition to the County Board of Equalization for Review of Real Property Valuation Determination) and any supporting evidence on my behalf.');
    drawWrapped('• Communicate with the County Assessor, the Board of Equalization, and the Department of Revenue regarding this appeal.');
    drawWrapped('• Receive notices, correspondence, and decisions related to this appeal.');
    drawWrapped('• Negotiate, settle, or withdraw the appeal subject to my prior written approval of any final settlement.');
    drawWrapped('• Represent me at any hearing before the Board of Equalization.');
    y -= 6;
    drawWrapped(
        `This authorization is effective as of the date signed below and remains in effect until the conclusion of the ${facts.assessmentYear} appeal cycle (including any subsequent BTA appeal) or until revoked in writing.`
    );
    y -= 16;

    // Property Owner signature block — coordinates we'll need to remember for overlay.
    drawText('SIGNATURE', { bold: true, size: 12 });
    y -= 14;

    // Save signature anchor for caller — stamp small invisible markers using
    // text annotations on the line so we can deterministically locate the line
    // even if layout shifts. Not strictly necessary; we'll use known offsets.
    const sigLineY = y;
    page.drawLine({ start: { x: left, y: sigLineY }, end: { x: left + 280, y: sigLineY }, thickness: 0.7, color: rgb(0, 0, 0) });
    page.drawText(`${facts.ownerName} (Property Owner)`, { x: left, y: sigLineY - 14, size: 9, font: helv, color: rgb(0.4, 0.4, 0.4) });
    page.drawLine({ start: { x: left + 320, y: sigLineY }, end: { x: right, y: sigLineY }, thickness: 0.7, color: rgb(0, 0, 0) });
    page.drawText('Date', { x: left + 320, y: sigLineY - 14, size: 9, font: helv, color: rgb(0.4, 0.4, 0.4) });
    y -= 50;

    drawText('AGENT ACCEPTANCE', { bold: true, size: 12 });
    y -= 14;
    page.drawLine({ start: { x: left, y }, end: { x: left + 280, y }, thickness: 0.7, color: rgb(0, 0, 0) });
    page.drawText('Tyler Worthey, Member, OverAssessed, LLC', { x: left, y: y - 14, size: 9, font: helv, color: rgb(0.4, 0.4, 0.4) });
    page.drawLine({ start: { x: left + 320, y }, end: { x: right, y }, thickness: 0.7, color: rgb(0, 0, 0) });
    page.drawText('Date', { x: left + 320, y: y - 14, size: 9, font: helv, color: rgb(0.4, 0.4, 0.4) });

    page.drawText(`${facts.caseId} • ${facts.agentName} • ${new Date().toISOString().substring(0, 10)}`, {
        x: left, y: 30, size: 8, font: helv, color: rgb(0.5, 0.5, 0.5),
    });

    const bytes = await doc.save();
    return {
        loaPdfBytes: Buffer.from(bytes),
        // Anchors for the signing service to overlay onto LOA page 1
        loaSignatureAnchor: {
            page: 0,
            sigLineY,
            sigLineX: left,
            sigLineWidth: 280,
            dateLineY: sigLineY,
            dateLineX: left + 320,
            dateLineWidth: right - (left + 320),
        },
    };
}

async function combinePDFs(petitionBuf, loaBuf) {
    const out = await PDFDocument.create();
    for (const buf of [petitionBuf, loaBuf]) {
        const src = await PDFDocument.load(buf);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach(pg => out.addPage(pg));
    }
    const bytes = await out.save();
    return Buffer.from(bytes);
}

/**
 * Public entry point.
 * @param {object} facts - all inputs (see file header for shape)
 * @returns {Promise<{petitionPdfBytes: Buffer, loaPdfBytes: Buffer, combinedPdfBytes: Buffer, loaSignatureAnchor: object}>}
 */
async function generateWAPackage(rawFacts) {
    const facts = {
        ...DEFAULT_AGENT,
        ...rawFacts,
    };
    // Defensive defaults
    facts.assessmentYear = facts.assessmentYear || new Date().getFullYear();
    facts.taxPayableYear = facts.taxPayableYear || (facts.assessmentYear + 1);
    facts.compCount = facts.compCount || 0;
    facts.compMedian = facts.compMedian || facts.ownerTotal || 0;
    facts.compMin = facts.compMin || 0;
    facts.compMax = facts.compMax || 0;
    facts.assessorLand = facts.assessorLand || 0;
    facts.assessorImprovements = facts.assessorImprovements || 0;
    facts.assessorTotal = facts.assessorTotal || 0;
    facts.ownerLand = facts.ownerLand || 0;
    facts.ownerImprovements = facts.ownerImprovements || 0;
    facts.ownerTotal = facts.ownerTotal || 0;

    const petitionPdfBytes = await buildPetition(facts);
    const { loaPdfBytes, loaSignatureAnchor } = await buildLOA(facts);
    const combinedPdfBytes = await combinePDFs(petitionPdfBytes, loaPdfBytes);

    return { petitionPdfBytes, loaPdfBytes, combinedPdfBytes, loaSignatureAnchor };
}

module.exports = { generateWAPackage, buildFieldMap, DEFAULT_AGENT };
